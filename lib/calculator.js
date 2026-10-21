import { clean, number, percent } from './workbook-data.js';

// Compatibility with the existing, separately maintained calculator template.
export function buildCalcData(rows) {
  const rawTarget = rows[2]?.[18];
  const targetPct = (typeof rawTarget === 'number' && rawTarget <= 1 ? percent(rawTarget) : number(rawTarget)) ?? 27;
  const text = (r, c) => clean(rows[r]?.[c]);
  const num = (r, c) => number(rows[r]?.[c]) ?? 0;
  const city = text(6, 3) || text(6, 2) || '—';
  const period = `${text(3, 3)} ${text(3, 4)} – ${text(4, 3)} ${text(4, 4)}`.trim();
  const buckets = [];
  for (let r = 10; r < 40; r++) {
    const label = text(r, 2);
    if (!label || /итого/i.test(label)) break;
    buckets.push({ label, cash: num(r, 3), sum: num(r, 4), accred: num(r, 6), actualComm: num(r, 9), possible27: num(r, 16),
      banks: { tbank: num(r, 18), domrf: num(r, 19), sber: num(r, 20), vtb: num(r, 21), sovkom: num(r, 22), alfa: num(r, 23) } });
  }
  return { targetPct, period, city, buckets };
}
