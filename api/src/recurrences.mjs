import { demand, identifier, instant, ISPB, merge, money, now, pick, receiver, today, transition } from './common.mjs';
import { find, get, list, save } from './store.mjs';
import { attach, compoundPaymentLocation, qr } from './locations.mjs';
import { businessDay, daysBetween, stampTax } from './amounts.mjs';
import { notify } from './webhooks.mjs';

const pending = status => ['CRIADA','ENVIADA','RECEBIDA'].includes(status);
function persist(kind, id, value) {
  save(kind, id, value);
  notify(kind, value);
  return value;
}
export function recurrencePayload(rec) {
  demand(['CRIADA','APROVADA'].includes(rec.status), 'Recorrência encerrada.', 400, 'RecPayloadInvalido');
  return {
    ...pick(rec, ['idRec','vinculo','calendario','valor','politicaRetentativa','atualizacao']),
    recebedor: { ...pick(rec.recebedor, ['cnpj','nome']), ispbParticipante: ISPB },
  };
}
function activation(txid) {
  const kind = find('tx-kind', txid);
  demand(kind === 'cob' || kind === 'cobv', 'O txid de ativação precisa identificar uma Cob ou CobV.');
  demand(kind !== 'cob' || !get(kind, txid).valor.retirada, 'QR composto não admite Pix Saque ou Pix Troco.', 400, 'RecConsultaInvalida');
  return { tipoJornada: kind === 'cob' ? 'JORNADA_3' : 'JORNADA_4', dadosJornada: { txid } };
}
export function recurrenceView(rec, txid) {
  const requests = list('solicrec').filter(solic => solic.idRec === rec.idRec);
  const result = { ...rec };
  if (requests.length) result.solicitacao = requests;
  if (txid) {
    const journey = activation(txid);
    const kind = find('tx-kind', txid);
    const configured = rec.ativacao;
    if (configured?.dadosJornada && kind === 'cob') demand(configured.dadosJornada.txid === txid, 'A ativação usa outra cobrança.');
    if (['JORNADA_3','JORNADA_4'].includes(configured?.tipoJornada)) demand(journey.tipoJornada === configured.tipoJornada, 'Cobrança incompatível com a jornada.');
    const location = get(kind, txid).loc;
    if (rec.loc && location) {
      const paymentUrl = kind === 'cob' ? compoundPaymentLocation(location.location) : location.location;
      result.dadosQR = { jornada: journey.tipoJornada, pixCopiaECola: qr(paymentUrl, rec.loc.location) };
    }
  } else if (rec.loc) result.dadosQR = { jornada: 'JORNADA_2', pixCopiaECola: qr(null, rec.loc.location) };
  return result;
}
export function writeRec(id, input) {
  const old = id ? get('rec', id) : undefined;
  const patch = pick(input, ['vinculo','calendario','valor','politicaRetentativa']);
  const rec = old ? merge(old, patch) : patch;
  if (old) {
    demand(['CRIADA','APROVADA'].includes(old.status), 'A recorrência está encerrada.');
    demand(Object.keys(input).length > 0, 'Informe uma alteração.');
    demand(old.status === 'CRIADA' || !(input.loc || input.calendario || input.vinculo), 'Estes campos só podem mudar em uma recorrência criada.');
    if (input.status) demand(Object.keys(input).length === 1, 'Envie o cancelamento isoladamente.');
  } else {
    rec.idRec = identifier(rec.politicaRetentativa === 'NAO_PERMITE' ? 'RN' : 'RR');
    rec.recebedor = { ...pick(receiver, ['nome','cnpj']), ...input.recebedor };
    rec.ativacao = { tipoJornada: 'AGUARDANDO_DEFINICAO' };
    transition(rec, 'CRIADA');
  }
  const calendar = rec.calendario;
  demand(calendar.dataInicial >= rec.atualizacao[0].data.slice(0,10) && (!calendar.dataFinal || calendar.dataFinal >= calendar.dataInicial), 'Datas de recorrência inválidas.');
  if (rec.valor) {
    const values = Object.values(rec.valor);
    demand(values.length === 1 && money(values[0]).gt(0), 'Informe um único valor fixo ou mínimo positivo.');
  }
  if (input.loc !== undefined) rec.loc = attach('rec', rec.idRec, input.loc, old?.loc);
  if (input.ativacao?.dadosJornada) rec.ativacao = activation(input.ativacao.dadosJornada.txid);
  if (input.status) {
    transition(rec, 'CANCELADA');
    rec.encerramento = { cancelamento: { solicitante: 'USUARIO_RECEBEDOR', codigo: 'SLCR', descricao: 'Cancelamento solicitado pelo recebedor.' } };
    closeDependents(rec.idRec);
  }
  return persist('rec', rec.idRec, rec);
}
function closeDependents(id) {
  for (const solic of list('solicrec')) if (solic.idRec === id && pending(solic.status)) {
    transition(solic, 'CANCELADA');
    save('solicrec', solic.idSolicRec, solic);
  }
  for (const charge of list('cobr')) if (charge.idRec === id && ['CRIADA','ATIVA'].includes(charge.status)) cancelRecurring(charge, true);
}
export function writeRequest(id, input) {
  if (id) {
    const req = get('solicrec', id);
    demand(pending(req.status), 'A solicitação está encerrada.');
    return save('solicrec', id, transition(req, input.status));
  }
  const rec = get('rec', input.idRec);
  demand(rec.status === 'CRIADA', 'A recorrência precisa aguardar autorização.');
  demand(Date.parse(input.calendario.dataExpiracaoSolicitacao) > now(), 'A expiração da solicitação deve ser futura.');
  demand(!list('solicrec').some(s => s.idRec === rec.idRec && pending(s.status)), 'Já existe uma solicitação ativa.');
  const request = { ...input, idSolicRec: identifier('SC'), recPayload: recurrencePayload(rec) };
  transition(request, 'CRIADA');
  transition(request, 'ENVIADA');
  return save('solicrec', request.idSolicRec, request);
}
export function decideRec(id, decision) {
  const rec = get('rec', id);
  demand(['APROVADA','REJEITADA'].includes(decision), 'Use APROVADA ou REJEITADA.');
  if (rec.status === decision) return rec;
  demand(rec.status === 'CRIADA', 'A recorrência já recebeu uma decisão.');
  const req = list('solicrec').find(s => s.idRec === id && pending(s.status));
  if (req) {
    transition(req, 'RECEBIDA');
    save('solicrec', req.idSolicRec, transition(req, decision === 'APROVADA' ? 'ACEITA' : 'REJEITADA'));
    rec.ativacao = { tipoJornada: 'JORNADA_1' };
  } else if (rec.ativacao.tipoJornada === 'AGUARDANDO_DEFINICAO') {
    demand(rec.loc, 'Para autorizar via QR, associe uma location ou envie uma solicitação.');
    rec.ativacao = { tipoJornada: 'JORNADA_2' };
  }
  if (decision === 'APROVADA') {
    if (rec.ativacao.tipoJornada === 'JORNADA_3') {
      const charge = get('cob', rec.ativacao.dadosJornada.txid);
      demand(charge.status === 'CONCLUIDA' && charge.pix?.length, 'Confirme a liquidação da cobrança imediata antes de aprovar a Jornada 3.', 400, 'RecOperacaoInvalida');
    }
    rec.pagador = { ispbParticipante: req?.destinatario.ispbParticipante || ISPB,
      ...pick(req?.destinatario || rec.vinculo.devedor, ['cpf','cnpj']) };
  } else rec.encerramento = { rejeicao: { codigo: 'AP13', descricao: 'Autorização recusada na simulação.' } };
  return persist('rec', id, transition(rec, decision));
}
function cycle(rec, due) {
  const { dataInicial: start, periodicidade: period } = rec.calendario;
  if (period === 'SEMANAL') return Math.floor(daysBetween(start, due) / 7);
  const first = new Date(start), date = new Date(due);
  let months = (date.getUTCFullYear() - first.getUTCFullYear()) * 12 + date.getUTCMonth() - first.getUTCMonth();
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  if (date.getUTCDate() < Math.min(first.getUTCDate(), lastDay)) months--;
  return Math.floor(months / { MENSAL: 1, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12 }[period]);
}
function attempt(date, type) {
  return transition({ dataLiquidacao: date, tipo: type, endToEndId: identifier('E') }, 'SOLICITADA');
}
function liquidationDay(charge) {
  const due = charge.calendario.dataDeVencimento;
  return charge.ajusteDiaUtil ? businessDay(due, get('rec', charge.idRec).pagador?.codMun) : due;
}
export function createRecurring(txid, input) {
  demand(!find('tx-kind', txid) && !find('charge-batch', txid), 'O txid já está em uso.');
  const rec = get('rec', input.idRec);
  demand(rec.status === 'APROVADA', 'A recorrência precisa estar aprovada.');
  const due = input.calendario.dataDeVencimento;
  demand(due >= today() && due >= rec.calendario.dataInicial && (!rec.calendario.dataFinal || due <= rec.calendario.dataFinal), 'Vencimento fora da vigência.');
  demand(daysBetween(today(), liquidationDay(input)) >= 2, 'O agendamento original exige pelo menos dois dias corridos de antecedência.', 400, 'CobROperacaoInvalida');
  const amount = money(input.valor.original);
  demand(amount.gt(0) && (!rec.valor?.valorRec || amount.eq(rec.valor.valorRec)) && amount.gte(rec.valor?.valorMinimoRecebedor || 0), 'Valor incompatível com a recorrência.');
  demand(!list('cobr').some(c => c.idRec === rec.idRec && !['REJEITADA','CANCELADA'].includes(c.status) && cycle(rec, c.calendario.dataDeVencimento) === cycle(rec, due)), 'Já existe cobrança neste ciclo.');
  const charge = { ...input, txid, recebedor: { ...rec.recebedor, ...input.recebedor },
    calendario: { ...input.calendario, criacao: today() }, politicaRetentativa: rec.politicaRetentativa,
    tentativas: [] };
  if (input.tributo) stampTax(charge, input.tributo, rec.vinculo.devedor);
  transition(charge, 'CRIADA');
  save('tx-kind', txid, 'cobr');
  return persist('cobr', txid, charge);
}
export function cancelRecurring(charge, inherited = false) {
  demand(['CRIADA','ATIVA'].includes(charge.status), 'A cobrança recorrente está encerrada.');
  demand(inherited || today() < (charge.tentativas[0]?.dataLiquidacao ?? liquidationDay(charge)), 'O prazo para cancelamento terminou.');
  for (const item of charge.tentativas) if (['SOLICITADA','AGENDADA'].includes(item.status)) transition(item, 'CANCELADA');
  charge.encerramento = { cancelamento: { solicitante: 'USUARIO_RECEBEDOR', codigo: 'SLCR', descricao: 'Cancelamento pelo recebedor.' } };
  return persist('cobr', charge.txid, transition(charge, 'CANCELADA'));
}
export function failAttempt(txid) {
  const charge = get('cobr', txid);
  const item = charge.tentativas.at(-1);
  demand(charge.status === 'ATIVA' && item?.status === 'AGENDADA', 'Nenhuma tentativa agendada.');
  demand(item.dataLiquidacao <= today(), 'A data prevista de liquidação ainda não chegou.');
  transition(item, 'EXPIRADA');
  if (charge.politicaRetentativa === 'NAO_PERMITE' || charge.tentativas.length >= 4) {
    transition(charge, 'EXPIRADA');
  }
  return persist('cobr', txid, charge);
}
export function confirmSchedule(txid, endToEndId) {
  const charge = get('cobr', txid);
  const item = charge.tentativas.at(-1);
  demand(charge.status === 'ATIVA' && item && item.endToEndId === endToEndId, 'A tentativa não está aguardando confirmação.');
  if (item.status === 'AGENDADA') return charge;
  demand(item.status === 'SOLICITADA' && today() < item.dataLiquidacao, 'A tentativa não está aguardando confirmação.');
  transition(item, 'AGENDADA');
  return persist('cobr', txid, charge);
}
export function retry(charge, date) {
  const last = charge.tentativas.at(-1);
  // REJEITADA representa a falha simulada nas versões anteriores do banco.
  const unpaid = last.status === 'EXPIRADA' || (last.status === 'REJEITADA' && last.rejeicao?.codigo === 'AM02');
  demand(charge.status === 'ATIVA' && charge.politicaRetentativa === 'PERMITE_3R_7D' && unpaid && last.dataLiquidacao <= today(), 'Retentativa não autorizada.');
  demand(charge.tentativas.length < 4 && date > today() && date > last.dataLiquidacao && daysBetween(charge.tentativas[0].dataLiquidacao, date) <= 7, 'Data fora da janela de retentativas.');
  charge.tentativas.push(attempt(date, 'NTAG'));
  return persist('cobr', charge.txid, charge);
}
export function updateLifecycle() {
  const current = now(), day = today();
  for (const req of list('solicrec')) if (pending(req.status) && Date.parse(req.calendario.dataExpiracaoSolicitacao) <= current) {
    save('solicrec', req.idSolicRec, transition(req, 'EXPIRADA'));
  }
  for (const rec of list('rec')) if (['CRIADA','APROVADA'].includes(rec.status) && rec.calendario.dataFinal && rec.calendario.dataFinal < day) {
    persist('rec', rec.idRec, transition(rec, 'EXPIRADA'));
    closeDependents(rec.idRec);
  }
  for (const charge of list('cobr')) {
    if (charge.status === 'CRIADA') {
      const date = liquidationDay(charge);
      const days = daysBetween(day, date);
      if (days < 2) persist('cobr', charge.txid, transition(charge, 'EXPIRADA'));
      else if (days <= 10) {
        charge.tentativas.push(attempt(date, 'AGND'));
        persist('cobr', charge.txid, transition(charge, 'ATIVA'));
      }
      continue;
    }
    if (charge.status !== 'ATIVA') continue;
    const last = charge.tentativas.at(-1);
    const attemptExpired = ['SOLICITADA','AGENDADA'].includes(last.status) && last.dataLiquidacao < day;
    if (attemptExpired) transition(last, 'EXPIRADA');
    const windowExpired = daysBetween(charge.tentativas[0].dataLiquidacao, day) >= 7;
    if (last.status === 'EXPIRADA' && (charge.politicaRetentativa === 'NAO_PERMITE' || windowExpired || charge.tentativas.length >= 4)) {
      persist('cobr', charge.txid, transition(charge, 'EXPIRADA'));
    } else if (attemptExpired) persist('cobr', charge.txid, charge);
  }
}
