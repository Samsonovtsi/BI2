import { clean, cityKey, monthKey, number } from './workbook-data.js';

export function cosmosKind(name) {
  const s = clean(name).toLowerCase();
  if (/\b6\./.test(s) && /нал/.test(s)) return 'cash';
  if (/242/.test(s)) return /разбивка/.test(s) ? 'akkBanks' : 'akk';
  if (/398/.test(s)) return /разбивка/.test(s) ? 'erServices' : 'er';
  if (/335/.test(s)) return 'seva';
  if (/328/.test(s)) return 'sber';
  if (/534/.test(s)) return 'income';
  return null;
}
const DEFINITIONS = {
  cash: ['Объекты без ипотеки', 'unique', 'шт.'],
  akk: ['АКК по городам, без ДомКлик', 'count', 'шт.'],
  akkBanks: ['АКК по банкам, включая ДомКлик', 'count', 'шт.'],
  er: ['ЭР, отчёт 398', 'count', 'шт.'],
  erServices: ['ЭР по сервисам, отчёт 398', 'count', 'шт.'],
  seva: ['SEVA, отправка в Росреестр', 'unique', 'шт.'],
  sber: ['Заявки Сбер, интеграция 328', 'count', 'шт.'],
  income: ['Комиссия участников услуг, отчёт 534', 'sum', '₽'],
};
const unknown = v => !clean(v) || /^(null|undefined)$/i.test(clean(v));
const strictSum = a => a.length && a.every(v => typeof v === 'number' && Number.isFinite(v)) ? a.reduce((n, v) => n + v, 0) : null;
const equal = (a, b) => a != null && b != null && Math.abs(a - b) < 0.011;
export const sourceDate = v => { const m = clean(v).match(/(\d{2})\.(\d{2})\.(20\d{2})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const column = n => { let s = ''; for(n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };

export function parseCosmosSheet(name, rows) {
  const kind = cosmosKind(name), [label, aggregation, unit] = DEFINITIONS[kind];
  const header = rows[1] || [], totalColumn = header.findIndex(v => clean(v).toLowerCase() === 'итого');
  const totalRow = rows.findIndex((r, i) => i > 2 && clean(r?.[0]).toLowerCase() === 'итого');
  if (totalColumn < 0 || totalRow < 3) throw new Error(`${name}: не найдены итоговая строка и столбец`);
  const slots = header.map((v, c) => ({ c, month: monthKey(v) })).filter(s => s.month && s.c < totalColumn);
  if (!slots.length || new Set(slots.map(s => s.month)).size !== slots.length) throw new Error(`${name}: отсутствуют или повторяются месяцы`);
  const undatedCols = header.map((v, c) => ({ v, c })).filter(x => /^null$/i.test(clean(x.v)) && x.c < totalColumn).map(x => x.c);
  const side = rows.flatMap(r => r.slice(totalColumn + 1).filter(v => typeof v === 'string').map(clean));
  const start = side.indexOf('Фильтры:'), end = side.indexOf('Создатель:');
  const filters = start < 0 ? [] : side.slice(start + 1, end > start ? end : undefined).filter(v => v && !v.endsWith(':'));
  const findings = [];
  function finding(code, severity, message, extra = {}) { findings.push({ code, severity, sheet: name, message, ...extra }); }
  function value(v, cell) {
    // In an exported pivot, an empty intersection is an empty group (zero).
    // A missing month column or an error cell is never converted to zero.
    if (v == null || v === '') return 0;
    const n = number(v);
    if (n == null || (aggregation !== 'sum' && (n < 0 || !Number.isInteger(n)))) {
      finding('invalid_value', 'error', 'Нечисловое значение или недопустимое количество', { cells: [cell] }); return null;
    }
    return n;
  }
  const read = (r, c) => value(rows[r]?.[c], `${column(c)}${r + 1}`);
  const dataRows = [];
  for (let r = 3; r < totalRow; r++) {
    if (!rows[r]?.some(v => v != null && v !== '')) continue;
    const rawLabel = clean(rows[r][0]), missing = unknown(rawLabel);
    dataRows.push({ label: missing ? 'Не указан' : rawLabel, cityKey: missing ? '__unknown__' : cityKey(rawLabel), unknown: missing,
      secondary: kind === 'erServices' ? clean(rows[r][1]) : '', sourceRow: r + 1,
      values: slots.map(s => read(r, s.c)), undated: undatedCols.length ? strictSum(undatedCols.map(c => read(r, c))) : 0,
      total: read(r, totalColumn) });
  }
  const months = slots.map(s => s.month), totals = slots.map(s => read(totalRow, s.c));
  const undatedTotal = undatedCols.length ? strictSum(undatedCols.map(c => read(totalRow, c))) : 0;
  const grandTotal = read(totalRow, totalColumn);
  const monthChecks = months.map((month, i) => ({ month, source: totals[i], sum: strictSum(dataRows.map(r => r.values[i])) }));
  const periodSum = strictSum([...totals, undatedTotal]), rowSum = strictSum(dataRows.map(r => r.total));
  const differentMonths = monthChecks.filter(r => !equal(r.source, r.sum));
  const differentRows = dataRows.filter(r => !equal(r.total, strictSum([...r.values, r.undated])));
  if (aggregation === 'unique') {
    if (!equal(grandTotal, periodSum) || !equal(grandTotal, rowSum) || differentMonths.length) finding('non_additive', 'info',
      'Уникальные значения: суммы месяцев и городов могут превышать общий distinct-итог. Для пересчёта произвольного периода нужны ID объектов/сделок.',
      { source: grandTotal, sumMonths: periodSum, sumRows: rowSum, count: differentMonths.length });
  } else {
    if (!equal(grandTotal, periodSum) || !equal(grandTotal, rowSum) || differentMonths.length || differentRows.length) finding('totals_mismatch', 'error',
      'Итоги не сходятся с детализацией', { source: grandTotal, sumMonths: periodSum, sumRows: rowSum, count: differentMonths.length + differentRows.length });
  }
  if (undatedTotal !== 0) finding('undated', 'warning', 'Записи без месяца сохранены отдельно и не включены в месячные показатели', { count: undatedTotal });
  const unknownRows = dataRows.filter(r => r.unknown);
  if (unknownRows.length) finding('unknown_dimension', 'warning', kind === 'akkBanks' ? 'Не указан банк' : 'Не указан город', { count: strictSum(unknownRows.map(r => r.total)) });
  const grouped = new Map();
  for (const r of dataRows) { const k = `${r.cityKey}|${r.secondary}`; if (!grouped.has(k)) grouped.set(k, []); grouped.get(k).push(r); }
  const duplicates = [...grouped.values()].filter(a => a.length > 1).map(a => ({ labels: a.map(r => r.label), rows: a.map(r => r.sourceRow) }));
  if (duplicates.length) finding('duplicate_labels', 'warning', 'Город встречается в нескольких строках после нормализации регистра и пробелов', { count: duplicates.length, duplicates });
  const mixed = dataRows.filter(r => /[а-яё]/i.test(r.label) && /[a-z]/i.test(r.label));
  if (mixed.length) finding('mixed_alphabet', 'warning', 'Латинские и кириллические буквы в названии. Автоматическое объединение не выполнено.', { labels: [...new Set(mixed.map(r => r.label))] });
  const asOfText = clean(rows[0]?.[1]), exportedText = clean(rows[0]?.[4]);
  return { kind, name, label, aggregation, unit, dimension: clean(rows[2]?.[0]), dateField: clean(header.find(v => typeof v === 'string' && /^Дата|^Год и месяц/i.test(v))),
    asOfText, asOfDate: sourceDate(asOfText), exportedText, exportDate: sourceDate(exportedText), filters,
    months, dataRows, totals, undatedTotal, grandTotal,
    checks: { monthChecks, periodSum, rowSum, differentRows: differentRows.length }, findings };
}

export function reconcileCosmos(sheets) {
  const findings = [], comparisons = [];
  const { akk, akkBanks: banks, er, erServices: services } = sheets;
  if (akk && banks) {
    const excluded = banks.dataRows.filter(r => cityKey(r.label).replaceAll(' ', '') === 'домклик');
    const filterConfirmed = akk.filters.some(f => /Банк.*исключено.*домклик/i.test(f));
    for (const month of akk.months.filter(m => banks.months.includes(m))) {
      const i = banks.months.indexOf(month), source = akk.totals[akk.months.indexOf(month)];
      const competitor = excluded.length ? strictSum(excluded.map(r => r.values[i])) : null;
      const adjusted = banks.totals[i] == null || competitor == null ? null : banks.totals[i] - competitor;
      comparisons.push({ type: 'akk_banks', month, source, allBanks: banks.totals[i], excluded: competitor, compared: adjusted,
        status: !filterConfirmed || adjusted == null ? 'unavailable' : equal(source, adjusted) ? 'match' : 'mismatch' });
    }
    findings.push({ code: 'bank_scope', severity: 'info', sheet: banks.name, message: 'Банковская сводная и городская сводная имеют разные фильтры. Сверка выполняется по общим месяцам после исключения ДомКлик.' });
  }
  if (er && services) {
    for (const month of er.months.filter(m => services.months.includes(m))) {
      const ei = er.months.indexOf(month), si = services.months.indexOf(month);
      const grouped = new Map();
      for (const r of services.dataRows) { const a = grouped.get(r.cityKey) || []; a.push(r.values[si]); grouped.set(r.cityKey, a); }
      const erGrouped = new Map();
      for (const r of er.dataRows) { const a = erGrouped.get(r.cityKey) || []; a.push(r.values[ei]); erGrouped.set(r.cityKey, a); }
      let mismatchedCities = 0;
      for (const key of new Set([...grouped.keys(), ...erGrouped.keys()])) if (!equal(strictSum(grouped.get(key) || [0]), strictSum(erGrouped.get(key) || [0]))) mismatchedCities++;
      comparisons.push({ type: 'er_services', month, source: er.totals[ei], compared: services.totals[si], mismatchedCities,
        status: equal(er.totals[ei], services.totals[si]) && !mismatchedCities ? 'match' : 'mismatch' });
    }
  }
  if (sheets.seva || sheets.sber) findings.push({ code: 'event_scope', severity: 'info', sheet: '335 / 328 / 398',
    message: 'Отправка SEVA, создание заявки Сбер и факт ЭР — разные события и городские привязки. Их нельзя складывать или считать расхождение потерянными сделками без ID и дат событий.' });
  if (sheets.income) findings.push({ code: 'income_scope', severity: 'info', sheet: sheets.income.name,
    message: 'Комиссия 534 ограничена фильтром городов и датой закрытия месяца. Это сумма по участникам услуги, не общий доход сети и не доход на одну сделку.' });
  const mismatches = comparisons.filter(r => r.status === 'mismatch');
  if (mismatches.length) findings.push({ code: 'cross_source_mismatch', severity: 'error', sheet: 'Космос', message: 'Обнаружены расхождения сопоставимых сводов', count: mismatches.length });
  return { comparisons, findings };
}

export function parseCosmos(sources, options = {}) {
  const sheets = {};
  for (const [name, rows] of Object.entries(sources)) {
    const kind = cosmosKind(name); if (!kind) continue;
    if (sheets[kind]) throw new Error(`Два листа одного вида: ${sheets[kind].name} и ${name}`);
    sheets[kind] = parseCosmosSheet(name, rows);
  }
  const { comparisons, findings } = reconcileCosmos(sheets);
  return { version: 1, loadedAt: options.generatedAt || Date.now(), sourceFile: options.sourceFile || '', sheets, comparisons,
    findings: [...Object.values(sheets).flatMap(s => s.findings), ...findings] };
}

export function mergeCosmos(previous, incoming) {
  if (!previous) return incoming;
  const sheets = { ...previous.sheets };
  for (const [kind, sheet] of Object.entries(incoming.sheets)) {
    const old = sheets[kind];
    if (old?.asOfDate && sheet.asOfDate && sheet.asOfDate < old.asOfDate) throw new Error(`${sheet.name}: дата источника старше уже загруженной. Старый срез не заменил текущий.`);
    // Replacing a whole named pivot avoids retaining deleted rows and inventing
    // distinct-count period totals. Other report kinds remain intact.
    sheets[kind] = sheet;
  }
  const { comparisons, findings } = reconcileCosmos(sheets);
  return { ...incoming, sheets, comparisons, findings: [...Object.values(sheets).flatMap(s => s.findings), ...findings] };
}
