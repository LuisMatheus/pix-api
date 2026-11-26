import { Decimal } from '../common.mjs';
import { find, save } from '../store.mjs';

// Cada processo tem seu próprio SQLite. O saldo disponível já desconta reservas.
const iniciais = { pagador: '1000000.00', recebedor: '0.00', piPagador: '100000.00', piRecebedor: '0.00' };

export function saldo(conta) {
  return new Decimal(find('spi-account', conta)?.disponivel ?? iniciais[conta]);
}

export function movimentar(conta, valor) {
  save('spi-account', conta, { disponivel: saldo(conta).plus(valor).toFixed(2) });
}
