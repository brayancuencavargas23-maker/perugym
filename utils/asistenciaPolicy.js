const DAY = 86400000;
const OFFSET = 5 * 3600000; // America/Lima: UTC-05, sin horario de verano.

function periodosLima(now = new Date()) {
  const local = new Date(now.getTime() - OFFSET);
  const dia = local.toISOString().slice(0, 10);
  const inicioDia = new Date(`${dia}T05:00:00.000Z`);
  const inicioSemana = new Date(inicioDia.getTime() - ((local.getUTCDay() + 6) % 7) * DAY);
  return { dia, inicioDia, finDia: new Date(+inicioDia + DAY), inicioSemana,
    finSemana: new Date(+inicioSemana + 7 * DAY), semana: inicioSemana.toISOString().slice(0, 10) };
}

function condicionesPlan(plan) {
  return { limite_semanal: plan.limite_semanal ?? null, limite_diario: 1 };
}

module.exports = { periodosLima, condicionesPlan };
