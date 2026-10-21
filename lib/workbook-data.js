// Pure parsers shared by Excel imports and Google workbook exports.
// Dates and products are read from the source. Missing values remain null.
export const SCHEMA_VERSION = 3;
export const SOURCE_NAMES = ['Свод ЭР', 'Свод АКК', 'ДомКлик', 'ЭР Data', 'АКК Data',
  'BI+Космос', 'Сумма BI+Космос', 'Каталог городов', 'Переход на Космос',
  'Тех. лист. номинальный счет', 'Ставка Т банк', 'Свод по городу NEW', 'Калькулятор'];
export const GROUPS = ['Вся сеть', 'Ф1', 'Ф2', 'Ф3', 'Ф1, Ф3', 'Ф1, Ф3 (без ТМН)'];
const MONTHS = ['янв', 'февр', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сент', 'окт', 'нояб', 'дек'];
const RU_MONTH = ['январ', 'феврал', 'март', 'апрел', 'май', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
export const clean = v => String(v ?? '').replace(/[\s\u00a0]+/g, ' ').trim();
export const cityKey = v => clean(v).replace(/^г\.?\s+/i, '').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[-‐‑–—]/g, ' ').replace(/\s+/g, ' ');
const isCity = v => /[а-яa-z]/i.test(clean(v)) && !/^#/.test(clean(v));
export function number(v) {
  if (v === null || v === undefined || clean(v) === '' || typeof v === 'boolean') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = clean(v).replace(/[\s\u00a0₽%]/g, '').replace(',', '.');
  return /^[-+]?\d*\.?\d+(?:e[-+]?\d+)?$/i.test(t) ? Number(t) : null;
}
export const percent = v => { const n = number(v); return n === null ? null : n * (String(v).includes('%') ? 1 : 100); };
export function monthKey(v) {
  if (v instanceof Date && !Number.isNaN(+v)) return v.toISOString().slice(0, 7);
  const n = typeof v === 'number' ? v : (/^\d{5}(\.\d+)?$/.test(clean(v)) ? +v : null);
  if (n !== null && n >= 36526 && n < 73416) return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 7);
  let t = clean(v).toLowerCase(), m;
  if ((m = t.match(/^(20\d\d)[-/.](\d{1,2})(?:[-/.]\d{1,2}(?:[ t].*)?)?$/))) return validMonth(+m[1], +m[2]);
  if ((m = t.match(/^(?:\d{1,2}[./])?(\d{1,2})[./](20\d\d)$/))) return validMonth(+m[2], +m[1]);
  if ((m = t.match(/^([а-яё]+)[.\s-]+(\d{2}|20\d\d)$/))) {
    let i = MONTHS.findIndex(x => x === m[1]);
    if (i < 0) i = RU_MONTH.findIndex(x => x.startsWith(m[1]) || m[1].startsWith(x));
    if (i >= 0) return validMonth(+m[2] < 100 ? 2000 + +m[2] : +m[2], i + 1);
  }
  return null;
}
function validMonth(y, m) { return y >= 2000 && y <= 2100 && m >= 1 && m <= 12 ? `${y}-${String(m).padStart(2, '0')}` : null; }
export function monthLabel(key) { const k = monthKey(key); return k ? `${MONTHS[+k.slice(5) - 1]}.${k.slice(2, 4)}` : ''; }
export const ratio = (n, d) => n != null && d != null && d > 0 ? n / d * 100 : null;
function colName(i) { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; }
const productMap = {
  'сбер': ['sber', 'Сбер', 'АКК'], 'сбербанк': ['sber', 'Сбер', 'АКК'],
  'домрф': ['domrf', 'Дом.РФ', 'АКК'], 'дом.рф': ['domrf', 'Дом.РФ', 'АКК'],
  'втб': ['vtb', 'ВТБ', 'СБР М2'], 'т-банк': ['tbank', 'Т-Банк', 'НС'], 'т банк': ['tbank', 'Т-Банк', 'НС'],
  'альфа': ['alfa', 'Альфа', 'АКК'], 'альфа нс': ['alfa_ns', 'Альфа', 'НС'],
  'совкомбанк': ['sovkom', 'Совкомбанк', 'АКК'], 'уралсиб': ['uralsib', 'Уралсиб', 'АКК'],
  'т-банк задаток': ['tbank_deposit', 'Т-Банк', 'Задаток'],
};
export function product(v) {
  const label = clean(v), found = productMap[label.toLowerCase()];
  return found ? { id: found[0], bank: found[1], type: found[2], label } : { id: `other:${label.toLowerCase()}`, bank: label, type: 'Не классифицирован', label };
}
export function parseErSummary(rows) {
  const slots = [];
  for (let c = 2; c < (rows[3]?.length || 0); c++) {
    const key = monthKey(rows[3][c]), kind = clean(rows[1]?.[c]).toLowerCase();
    if (key && (kind === 'наша база' || /дом\s?клик/.test(kind))) slots.push({ c, key, kind: kind === 'наша база' ? 'er' : 'domklik' });
  }
  if (!slots.some(x => x.kind === 'er')) throw new Error('Свод ЭР: не найдены заголовки «Наша база» с датами в строке 4');
  if (new Set(slots.map(x => `${x.kind}:${x.key}`)).size !== slots.length) throw new Error('Свод ЭР: найдены повторяющиеся заголовки месяцев');
  const keys = [...new Set(slots.map(x => x.key))].sort(), aggs = [], cities = [];
  for (let r = 4; r < rows.length; r++) {
    const city = clean(rows[r]?.[4]); if (!isCity(city)) continue;
    const e = { city, cat: clean(rows[r][2]), grade: clean(rows[r][3]), agg: GROUPS.includes(city),
      values: keys.map(() => null), counts: keys.map(() => null), denominators: keys.map(() => null),
      domklik: keys.map(() => null), domklikCounts: keys.map(() => null), domklikDenominators: keys.map(() => null) };
    for (const slot of slots) {
      const i = keys.indexOf(slot.key), er = slot.kind === 'er';
      e[er ? 'values' : 'domklik'][i] = percent(rows[r][slot.c]);
      e[er ? 'counts' : 'domklikCounts'][i] = number(rows[r][slot.c - 2]);
      e[er ? 'denominators' : 'domklikDenominators'][i] = number(rows[r][slot.c - 1]);
    }
    (e.agg ? aggs : cities).push(e);
  }
  if (!aggs.some(x => x.city === 'Вся сеть')) throw new Error('Свод ЭР: не найдена строка «Вся сеть»');
  return { months: keys.map(monthLabel), monthKeys: keys, aggs, cities };
}
export function parseAkkSummary(rows) {
  const slots = (rows[2] || []).map((v, c) => ({ c, key: monthKey(v) })).filter(x => x.key && x.c >= 2).sort((a, b) => a.key.localeCompare(b.key));
  if (!slots.length) throw new Error('Свод АКК: не найдены даты в строке 3');
  if (new Set(slots.map(s => s.key)).size !== slots.length) throw new Error('Свод АКК: найдены повторяющиеся заголовки месяцев');
  const keys = slots.map(s => s.key), aggs = [], cities = []; let current = null;
  const read = (r, offset, pct = false) => slots.map(s => pct ? percent(rows[r]?.[s.c + offset]) : number(rows[r]?.[s.c + offset]));
  for (let r = 3; r < rows.length; r++) {
    const name = clean(rows[r]?.[4]); if (!isCity(name)) continue;
    const bank = productMap[name.toLowerCase()];
    if (bank && current) {
      current.banks[bank[0]] = read(r, 0, true);
      current.bankCounts[bank[0]] = read(r, -2);
      current.bankDenominators[bank[0]] = read(r, -1);
      current.bankLabels[bank[0]] = name;
      continue;
    }
    current = { name, cat: clean(rows[r][2]), grade: clean(rows[r][3]), agg: GROUPS.includes(name),
      values: read(r, 0, true), counts: read(r, -2), denominators: read(r, -1), banks: {}, bankCounts: {}, bankDenominators: {}, bankLabels: {} };
    (current.agg ? aggs : cities).push(current);
  }
  if (!aggs.some(x => x.name === 'Вся сеть')) throw new Error('Свод АКК: не найдена строка «Вся сеть»');
  return { months: keys.map(monthLabel), monthKeys: keys, aggs, cities, trimmedCount: 0, trimmedFrom: null };
}
export function buildDataset(sources, { generatedAt = Date.now(), source = 'upload', sourceFile = '', sourceTimes = {} } = {}) {
  const er = sources['Свод ЭР'] ? parseErSummary(sources['Свод ЭР']) : null;
  const akk = sources['Свод АКК'] ? parseAkkSummary(sources['Свод АКК']) : null;
  const diagnostics = [], metadata = {}, directory = new Map(), records = new Map(), coverage = {};
  function issue(code, sheet, message, details = {}) { diagnostics.push({ code, sheet, message, ...details }); }
  function addCity(name, fields = {}) {
    const key = cityKey(name); if (!isCity(name) || GROUPS.includes(clean(name))) return null;
    const prev = directory.get(key) || { city: clean(name), cat: '', grade: '', active: null, excluded: false };
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== '') prev[k] = v;
    directory.set(key, prev); return key;
  }
  function record(name, month) {
    const city = addCity(name); if (!city || !month) return null;
    const key = `${city}|${month}`;
    if (!records.has(key)) records.set(key, { city: directory.get(city).city, cityKey: city, month, cashRaw: null, averageCash: null, er: {}, akk: {}, domklik: {}, products: {} });
    return records.get(key);
  }
  function cover(sheet, keys) { coverage[sheet] = [...new Set(keys)].sort(); }
  for (const [sheet, rows] of Object.entries(sources)) {
    let count = 0; const samples = [];
    for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
      if (/^#(?:REF!|VALUE!|DIV\/0!|N\/A|NAME\?|NUM!|NULL!)/.test(clean(rows[r][c]))) { count++; if (samples.length < 5) samples.push(`${colName(c)}${r + 1}`); }
    }
    if (count) issue('source_errors', sheet, `Ошибок в сохранённых значениях: ${count}`, { count, cells: samples });
    metadata[sheet] = { loadedAt: sourceTimes[sheet] ?? generatedAt, rows: rows.length, errors: count, source };
  }
  const catalog = sources['Каталог городов'] || [];
  for (let r = 3; r < catalog.length; r++) {
    const a = catalog[r]; addCity(a[0], { cat: clean(a[3]), grade: clean(a[5]), id: a[12] ?? null,
      active: /^(да|нет)$/i.test(clean(a[13])) ? clean(a[13]).toLowerCase() === 'да' : null, excluded: clean(a[15]).toLowerCase() === 'да' });
  }
  for (const e of er?.cities || []) addCity(e.city, { cat: e.cat, grade: e.grade });
  for (const e of akk?.cities || []) addCity(e.name, { cat: e.cat, grade: e.grade });
  const cosmos = sources['Переход на Космос'] || [];
  for (let r = 3; r < cosmos.length; r++) addCity(cosmos[r][0], { cosmosMonth: monthKey(cosmos[r][2]) });
  function summaryEntries(data, kind) {
    if (!data) return;
    cover(kind === 'er' ? 'Свод ЭР' : 'Свод АКК', data.monthKeys);
    for (const e of data.cities) data.monthKeys.forEach((m, i) => {
      const rec = record(e.city || e.name, m); if (!rec) return;
      rec[kind] = { summaryCount: e.counts[i], summaryBase: e.denominators[i], summaryPct: e.values[i] };
      if (kind === 'er') rec.domklik = { summaryCount: e.domklikCounts[i], summaryBase: e.domklikDenominators[i], summaryPct: e.domklik[i] };
    });
  }
  summaryEntries(er, 'er'); summaryEntries(akk, 'akk');
  for (const [sheet, field] of [['BI+Космос', 'cashRaw'], ['Сумма BI+Космос', 'averageCash']]) {
    const rows = sources[sheet]; if (!rows) continue;
    const cols = (rows[3] || []).map((v, c) => ({ c, m: monthKey(v) })).filter(x => x.m);
    if (!cols.length) issue('invalid_headers', sheet, 'Не найдены даты в строке 4');
    cover(sheet, cols.map(x => x.m));
    for (let r = 4; r < rows.length; r++) {
      const name = clean(rows[r][1]); if (!isCity(name)) continue;
      for (const { c, m } of cols) {
        const rec = record(name, m); if (!rec) continue;
        const value = number(rows[r][c]);
        if (rec[field] != null && value != null && rec[field] !== value) { issue('duplicate_city_month', sheet, 'Повтор города и месяца с разными значениями', { city: name, month: m }); rec[field] = null; }
        else rec[field] = value;
      }
    }
  }
  const dkRows = sources['ДомКлик'];
  if (dkRows) {
    const cols = (dkRows[0] || []).map((v, c) => ({ c, m: monthKey(v) })).filter(x => x.m && x.c >= 2);
    if (!cols.length) issue('invalid_headers', 'ДомКлик', 'Не распознаны месяцы строки 1');
    cover('ДомКлик', cols.map(x => x.m));
    for (let r = 2; r < dkRows.length; r++) for (const { c, m } of cols) {
      const rec = record(dkRows[r][1], m); if (rec) rec.domklik.rawCount = number(dkRows[r][c]);
    }
  }
  const erRows = sources['ЭР Data'];
  if (erRows) {
    const periods = [];
    for (let r = 1; r < erRows.length; r++) {
      const a = erRows[r], m = monthKey(a[1]); if (!m || !isCity(a[3])) continue;
      const rec = record(a[3], m); if (!rec) continue;
      rec.er.rawCount = (rec.er.rawCount || 0) + 1; periods.push(m);
      addCity(a[3], { cat: clean(a[0]).startsWith('#') ? '' : clean(a[0]) });
    }
    cover('ЭР Data', periods);
  }
  const products = new Map(), akkRows = sources['АКК Data'];
  if (akkRows) {
    const periods = [];
    for (let r = 2; r < akkRows.length; r++) {
      const a = akkRows[r], m = monthKey(a[3]); if (!m || !isCity(a[2]) || !clean(a[4]) || /^#/.test(clean(a[4]))) continue;
      const rec = record(a[2], m); if (!rec) continue;
      const p = product(a[4]); products.set(p.id, p);
      rec.akk.rawCount = (rec.akk.rawCount || 0) + 1; periods.push(m);
      const item = rec.products[p.id] ||= { count: 0, fee: 0, centralIncome: 0, cityIncome: 0, missingFee: 0, missingCentralIncome: 0, missingCityIncome: 0 };
      item.count++;
      for (const [field, col, missing] of [['fee', 5, 'missingFee'], ['centralIncome', 8, 'missingCentralIncome'], ['cityIncome', 9, 'missingCityIncome']]) {
        const v = number(a[col]); if (v == null) item[missing]++; else item[field] += v;
      }
    }
    cover('АКК Data', periods);
    for (const p of products.values()) if (p.type === 'Не классифицирован') issue('unknown_product', 'АКК Data', `Нужна классификация продукта: ${p.label}`);
  }
  // Zero is justified only within months observed in the corresponding registry.
  for (const rec of records.values()) for (const [sheet, metric] of [['ЭР Data', 'er'], ['АКК Data', 'akk']]) {
    if (coverage[sheet]?.includes(rec.month) && rec[metric].rawCount == null) rec[metric].rawCount = 0;
  }
  const nominalRows = sources['Тех. лист. номинальный счет'], nominal = new Map();
  if (nominalRows) {
    const periods = [];
    for (let r = 1; r < nominalRows.length; r++) {
      const a = nominalRows[r], city = addCity(a[1]); if (!city) continue;
      const disclosed = monthKey(a[27]) || monthKey(a[11]);
      const month = disclosed || monthKey(a[3]) || monthKey(a[2]); if (!month || number(a[8]) == null) continue;
      const basis = disclosed ? 'disclosure' : 'funding', k = `${city}|${month}|${basis}`;
      const e = nominal.get(k) || { city: directory.get(city).city, cityKey: city, month, basis, count: 0, amount: 0, income: 0, centralIncome: 0, cityIncome: 0, realtorIncome: 0, daysSum: 0, daysCount: 0, statuses: {}, missing: {} };
      e.count++; e.amount += number(a[8]); const status = clean(a[9]) || 'Не указан'; e.statuses[status] = (e.statuses[status] || 0) + 1;
      const days = number(a[12]); if (days != null && days >= 0) { e.daysSum += days; e.daysCount++; }
      for (const [field, c] of [['income', 21], ['centralIncome', 22], ['cityIncome', 23], ['realtorIncome', 24]]) {
        const v = number(a[c]); if (v == null) e.missing[field] = (e.missing[field] || 0) + 1; else e[field] += v;
      }
      nominal.set(k, e); periods.push(month);
    }
    cover('Тех. лист. номинальный счет', periods);
  }
  // Keep rates for inspection; no rate from an old date is silently applied to a new date.
  const rates = (sources['Ставка Т банк'] || []).slice(1).map(r => ({ month: monthKey(r[1]), rate: number(r[2]) })).filter(r => r.month && r.rate != null);
  cover('Ставка Т банк', rates.map(r => r.month));
  const referenceRows = sources['Свод по городу NEW']; let reference = null;
  if (referenceRows && isCity(referenceRows[6]?.[4])) {
    const city = clean(referenceRows[6][4]); reference = { city, months: [] };
    for (let c = 5; c < (referenceRows[9]?.length || 0); c++) {
      const month = monthKey(referenceRows[9][c]); if (!month) continue;
      reference.months.push({ month, base: number(referenceRows[10]?.[c]), er: number(referenceRows[12]?.[c]), akk: number(referenceRows[17]?.[c]), erPct: percent(referenceRows[13]?.[c]), akkPct: percent(referenceRows[18]?.[c]) });
    }
    cover('Свод по городу NEW', reference.months.map(m => m.month));
  }
  let differingBases = 0, rawCountDifferences = 0;
  for (const rec of records.values()) {
    const coefficient = cityKey(rec.city) === cityKey('Москва') ? 0.5 : cityKey(rec.city) === cityKey('Тюмень') ? 1 : 0.65;
    rec.newCoefficient = coefficient; rec.newBase = rec.cashRaw == null ? null : rec.cashRaw * coefficient;
    for (const key of ['er', 'akk']) {
      const metric = rec[key];
      if (metric.summaryBase != null && rec.newBase != null && Math.abs(metric.summaryBase - rec.newBase) > 0.01) differingBases++;
      if (metric.rawCount != null && metric.summaryCount != null && metric.rawCount !== metric.summaryCount) rawCountDifferences++;
    }
  }
  if (differingBases) issue('different_methods', 'Своды', 'Знаменатели сводов и методики NEW различаются. Режим расчёта выбирается явно.', { count: differingBases });
  if (rawCountDifferences) issue('counts_mismatch', 'Своды', 'Количество операций в сводах отличается от исходных реестров.', { count: rawCountDifferences });
  for (const [sheet, meta] of Object.entries(metadata)) { const ms = coverage[sheet] || []; meta.monthFrom = ms[0] || null; meta.monthTo = ms.at(-1) || null; meta.monthCount = ms.length; }
  const keys = [...new Set([...(er?.monthKeys || []), ...(akk?.monthKeys || []), ...[...records.values()].map(r => r.month)])].sort();
  const analytics = { records: [...records.values()], directory: [...directory.values()], products: [...products.values()], nominal: [...nominal.values()], coverage, sources: metadata, diagnostics, reference,
    rateCoverage: { monthFrom: coverage['Ставка Т банк']?.[0] || null, monthTo: coverage['Ставка Т банк']?.at(-1) || null },
    methods: { summary: 'Исходные своды: сохраняются их числители, знаменатели и проценты.', new: 'NEW по городам: BI+Космос × коэффициент (Москва 0,5; Тюмень 1; остальные 0,65). Для группы суммируются базы городов. Это не исправление исходной книги.' } };
  return { schemaVersion: SCHEMA_VERSION, generatedAt, source, sourceFile, months: er?.months || keys.map(monthLabel), monthKeys: er?.monthKeys || keys,
    aggs: er?.aggs || [], cities: er?.cities || [], akk: akk || { months: [], monthKeys: [], aggs: [], cities: [] }, analytics };
}
