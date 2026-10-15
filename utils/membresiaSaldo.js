const { money, pagoDelPeriodo } = require('./membresiaPeriodos');

function montoAnterior(mem, pagos) {
  if (mem.monto_total != null) return mem.monto_total;
  const expected = pagos.map(p => p.total_esperado).filter(n => n != null);
  return expected.length ? Math.max(...expected) : money(pagos.reduce((s, p) => s + p.monto, 0));
}

function saldosPeriodos(mem, pagos) {
  const periods = mem.periodos?.length ? mem.periodos : [null];
  return periods.map(periodo => {
    const actuales = pagos.filter(p => pagoDelPeriodo(p, periodo));
    const total_plan = periodo?.monto_total ?? montoAnterior(mem, actuales);
    const total_pagado = money(actuales.filter(p => p.estado === 'pagado').reduce((s, p) => s + p.monto, 0));
    return { periodo, actuales, total_plan, total_pagado,
      pendiente: money(Math.max(0, total_plan - total_pagado)), completado: total_pagado >= total_plan };
  });
}

module.exports = { montoAnterior, saldosPeriodos };
