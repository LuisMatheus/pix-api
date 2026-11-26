import { isDeepStrictEqual } from 'node:util';
import { demand, money, Problem, transition } from '../common.mjs';
import { erase, find, get, save, transaction } from '../store.mjs';
import { completeSettlement, prepareSettlement } from '../payments.mjs';
import { movimentar, saldo } from './contas.mjs';
import { e2ePattern, lerPacs002, lerPacs008, pacs002, pacs008, pagador, recebedor, spi } from './mensagens.mjs';
import { exigirSpi, spiSimulado } from './transporte.mjs';

const bucket = 'spi-payment';
const cenarios = ['normal', 'recebedor_rejeita', 'resposta_perdida'];
const concluida = op => ['LIQUIDADA', 'REJEITADA'].includes(op.status);
const gravar = op => save(bucket, op.endToEndId, op);

function iniciar(body) {
  demand(body && typeof body === 'object' && !Array.isArray(body), 'Informe os dados da liquidação.');
  const { cenario = 'normal', ...input } = body;
  demand(cenarios.includes(cenario), 'Cenário inválido.');
  const anterior = input.endToEndId && find(bucket, input.endToEndId);
  if (anterior) {
    demand(isDeepStrictEqual(anterior.plano.input, input) && anterior.cenario === cenario,
      'Este endToEndId já identifica outro pagamento.', 409);
    return { op: anterior, nova: false };
  }
  demand(!input.txid || find('tx-kind', input.txid) === 'cob', 'O ciclo SPI suporta Cob imediata e Pix avulso.');
  const plano = prepareSettlement(input);
  demand(!plano.completed, 'Este endToEndId já identifica um pagamento.', 409);
  demand(!plano.charge?.valor.retirada && !plano.charge?.tributo, 'Use uma Cob sem retirada ou tributo.');
  const { id, payment } = plano;
  demand(e2ePattern.test(id) && id.slice(1, 9) === pagador, 'Use um endToEndId do pagador fictício ' + pagador + '.');
  const valor = money(payment.valor);
  demand(saldo('pagador').gte(valor), 'Saldo insuficiente na conta do pagador simulado.', 422);
  const xml = pacs008(payment, plano.payer);
  lerPacs008(xml);
  movimentar('pagador', valor.negated());
  if (payment.txid) save('spi-charge', payment.txid, id);
  const op = { endToEndId: id, cenario, plano, mensagens: { ordem: xml }, contas: { pagador: 'BLOQUEIO', recebedor: 'SEM_CREDITO' } };
  transition(op, 'AGUARDANDO_SPI');
  return { op: gravar(op), nova: true };
}

function prepararResposta(e2e, encaminhada) {
  const ordem = lerPacs008(encaminhada);
  return transaction(() => {
    const op = get(bucket, e2e);
    if (concluida(op) || op.mensagens.aceiteRecebedor) return op;
    demand(ordem.e2e === e2e && ordem.de === spi && ordem.para === recebedor && ordem.valor === op.plano.payment.valor,
      'A ordem encaminhada não corresponde ao pagamento.');
    const aceito = op.cenario !== 'recebedor_rejeita';
    const resposta = pacs002({ e2e, de: recebedor, para: spi, codigo: aceito ? 'ACSP' : 'RJCT', motivo: aceito ? undefined : 'AC06' });
    op.mensagens.encaminhamento = encaminhada;
    op.mensagens.aceiteRecebedor = resposta;
    if (aceito) op.contas.recebedor = 'CREDITO_PROVISORIO';
    transition(op, 'AGUARDANDO_CONFIRMACAO_SPI');
    return gravar(op);
  });
}

function finalizar(e2e, retorno) {
  const resultado = lerPacs002(retorno.pagador);
  const confirmacao = retorno.recebedor && lerPacs002(retorno.recebedor);
  return transaction(() => {
    const op = get(bucket, e2e);
    if (concluida(op)) return op;
    const { plano, mensagens, contas } = op;
    const { payment } = plano;
    const liquidado = resultado.codigo === 'ACCC';
    demand(resultado.de === spi && resultado.para === pagador && resultado.e2e === e2e
      && (liquidado || resultado.codigo === 'RJCT'), 'A resposta do SPI não corresponde ao pagamento.');
    const comEncaminhamento = Boolean(mensagens.encaminhamento);
    demand(comEncaminhamento === Boolean(confirmacao) && (!liquidado || contas.recebedor === 'CREDITO_PROVISORIO'),
      'A resposta chegou fora da sequência esperada.');
    if (confirmacao) {
      demand(confirmacao.de === spi && confirmacao.para === recebedor && confirmacao.e2e === e2e
        && confirmacao.codigo === resultado.codigo && confirmacao.motivo === resultado.motivo
        && confirmacao.liquidacao === resultado.liquidacao, 'As respostas do SPI divergem.');
      mensagens.resultadoRecebedor = retorno.recebedor;
    }
    mensagens.resultadoPagador = retorno.pagador;
    op.codigoSpi = resultado.codigo;
    if (liquidado) {
      movimentar('recebedor', payment.valor);
      op.pix = completeSettlement({ ...plano, payment: { ...payment, horario: resultado.liquidacao } });
      op.contas = { pagador: 'DEBITO_EFETIVO', recebedor: 'CREDITO_EFETIVO' };
    } else {
      movimentar('pagador', payment.valor);
      op.contas = { pagador: 'DESBLOQUEIO', recebedor: 'SEM_CREDITO' };
      op.motivo = resultado.motivo;
    }
    if (payment.txid) erase('spi-charge', payment.txid);
    return gravar(transition(op, liquidado ? 'LIQUIDADA' : 'REJEITADA'));
  });
}

async function avancar(op, reconciliar = false) {
  const e2e = op.endToEndId;
  try {
    let retorno = reconciliar ? await spiSimulado.consultar(e2e) : undefined;
    retorno ??= await spiSimulado.enviarOrdem(op.mensagens.ordem);
    if (retorno.encaminhada) op = prepararResposta(e2e, retorno.encaminhada);
    if (concluida(op)) return op;
    if (!retorno.pagador) {
      retorno = await spiSimulado.responder(op.mensagens.aceiteRecebedor);
      if (!reconciliar && op.cenario === 'resposta_perdida') throw new Error('Perda de resposta simulada.');
    }
    return finalizar(e2e, retorno);
  } catch (error) {
    if (!(error instanceof Problem) && op.cenario !== 'resposta_perdida') console.error('Falha no ciclo SPI:', error.message);
    return transaction(() => {
      const atual = get(bucket, e2e);
      if (concluida(atual) || atual.status === 'RESULTADO_DESCONHECIDO') return atual;
      return gravar(transition(atual, 'RESULTADO_DESCONHECIDO'));
    });
  }
}

const publico = ({ plano, ...op }) => ({ ...op, valor: plano.payment.valor, txid: plano.payment.txid });

export async function iniciarSpi(body) {
  exigirSpi();
  const { op, nova } = transaction(() => iniciar(body));
  const atual = nova ? await avancar(op) : op;
  return { status: concluida(atual) ? (nova ? 201 : 200) : 202, body: publico(atual) };
}

export function consultarSpi(e2e) {
  return publico(get(bucket, e2e));
}

export async function reconciliarSpi(e2e) {
  exigirSpi();
  const op = get(bucket, e2e);
  const atual = concluida(op) ? op : await avancar(op, true);
  return { status: concluida(atual) ? 200 : 202, body: publico(atual) };
}
