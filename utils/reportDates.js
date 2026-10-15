const DAY = 86400000;
const limaDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(date);

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Fecha inválida. Usa AAAA-MM-DD.');
  const date = new Date(`${value}T00:00:00-05:00`);
  if (!Number.isFinite(date.getTime()) || limaDate(date) !== value) throw new Error('Fecha inválida.');
  return date;
}

function dateFilter(from, to) {
  const filter = {};
  if (from) filter.$gte = parseDate(from);
  if (to) filter.$lt = new Date(parseDate(to).getTime() + DAY);
  if (from && to && filter.$gte >= filter.$lt) throw new Error('La fecha inicial debe ser anterior o igual a la final.');
  return filter;
}

function period(query = {}, now = new Date()) {
  const today = limaDate(now);
  const from = query.from || `${today.slice(0, 7)}-01`;
  const to = query.to || today;
  const range = dateFilter(from, to);
  const days = Math.round((range.$lt - range.$gte) / DAY);
  if (days > 366) throw new Error('Selecciona un período de hasta 366 días.');
  if (to > today) throw new Error('El período no puede incluir días futuros.');
  const previousStart = new Date(range.$gte.getTime() - days * DAY);
  return { from, to, days, start: range.$gte, end: range.$lt, previousStart,
    previousFrom: limaDate(previousStart), previousTo: limaDate(new Date(range.$gte - DAY)) };
}

module.exports = { DAY, limaDate, parseDate, dateFilter, period };
