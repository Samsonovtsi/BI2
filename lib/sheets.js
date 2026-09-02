// lib/sheets.js
// Загрузка данных из Google Sheets (CSV-экспорт, без бэкенд-ключей — таблицы
// открыты по ссылке "Читатель"), разбор в структуры дашборда, кэш в памяти
// + на диске, фоновое обновление раз в сутки.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SHEET_MAP = { id: '1dkA1CUyrYh5qd2MmeLJ2qzXcqMTHVGDIX0S8mZQ7JMs', gid: '0' };
const SHEET_CALC = { id: '1es-6KsSYuDKYCfusMtFwFQCqQWnI7-WdhnOO-LTNkz8', gid: '1180972308' };

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 часа
const CACHE_FILE = path.join(__dirname, '..', 'data', 'cache.json');
const FETCH_TIMEOUT_MS = 20000;

/* ---------------------------------------------------------------------- */
/* Резервный снимок — если Google недоступен и на диске нет кэша          */
/* ---------------------------------------------------------------------- */
export const DEFAULT_DATA = {
  months: ['дек.24', 'дек.25', 'февр.26', 'апр.26', 'июн.26', 'июл.26'],
  aggs: [
    { city: 'Вся сеть', cat: '', grade: '', agg: true, values: [54.14, 44.17, 45.37, 52.05, 46.69, 43.01] },
    { city: 'Ф1', cat: 'Ф1', grade: '', agg: true, values: [67.99, 60.93, 65.51, 75.37, 69.33, 64.20] },
    { city: 'Ф2', cat: 'Ф2', grade: '', agg: true, values: [50.76, 35.20, 36.41, 42.85, 38.28, 33.80] },
    { city: 'Ф3', cat: 'Ф3', grade: '', agg: true, values: [40.66, 57.69, 50.39, 55.45, 42.03, 37.04] },
  ],
  cities: [
    { city: 'Москва', cat: 'Ф3', grade: 'A++', values: [27.16, 25.43, 33.27, 43.07, 27.15, 25.10] },
    { city: 'Санкт-Петербург', cat: 'Ф1', grade: 'A++', values: [30.22, 31.14, 31.39, 45.96, 41.38, 37.64] },
    { city: 'Сургут', cat: 'Ф1', grade: 'A++', values: [50.44, 54.37, 64.15, 82.77, 54.37, 56.60] },
    { city: 'Тюмень', cat: 'Ф1', grade: 'A++', values: [66.09, 61.76, 60.49, 71.42, 67.73, 59.96] },
    { city: 'Владивосток', cat: 'Ф2', grade: 'A++', values: [67.39, 95.08, 106.87, 120.21, 89.55, 100.33] },
    { city: 'Воронеж', cat: 'Ф2', grade: 'A++', values: [18.82, 5.43, 14.48, 10.61, 7.27, 3.10] },
    { city: 'Екатеринбург', cat: 'Ф2', grade: 'A++', values: [50.88, 52.32, 68.24, 76.45, 66.67, 61.73] },
    { city: 'Казань', cat: 'Ф2', grade: 'A++', values: [87.50, 76.92, 70.51, 126.86, 129.15, 91.31] },
    { city: 'Калининград', cat: 'Ф2', grade: 'A++', values: [54.65, 70.05, 77.85, 90.06, 85.47, 94.79] },
    { city: 'Красноярск', cat: 'Ф2', grade: 'A++', values: [21.50, 37.89, 40.72, 24.46, 38.63, 14.51] },
    { city: 'Тула', cat: 'Ф2', grade: 'A++', values: [55.45, 52.41, 67.69, 86.65, 31.16, 25.08] },
    { city: 'Хабаровск', cat: 'Ф2', grade: 'A++', values: [30.85, 98.58, 86.79, 101.54, 75.25, 64.10] },
    { city: 'Ростов-на-Дону', cat: 'Ф1', grade: 'A+', values: [50.94, 38.46, 16.46, 37.04, 27.43, 17.78] },
    { city: 'Благовещенск', cat: 'Ф2', grade: 'A+', values: [24.36, 18.10, 4.88, 4.86, 12.38, 15.56] },
    { city: 'Калуга', cat: 'Ф2', grade: 'A+', values: [10.39, 0.00, 0.00, 3.62, 2.08, 0.00] },
    { city: 'Кемерово', cat: 'Ф2', grade: 'A+', values: [37.93, 48.35, 23.14, 28.07, 36.97, 28.67] },
    { city: 'Краснодар', cat: 'Ф2', grade: 'A+', values: [0.00, 22.30, 11.54, 17.09, 19.23, 2.80] },
    { city: 'Омск', cat: 'Ф1', grade: 'A+', values: [46.28, 47.16, 60.51, 48.22, 51.59, 52.76] },
    { city: 'Симферополь', cat: 'Ф2', grade: 'A+', values: [47.27, 40.82, 101.31, 124.26, 110.30, 47.62] },
    { city: 'Тверь', cat: 'Ф2', grade: 'A+', values: [20.22, 26.00, 24.73, 21.30, 14.36, 9.32] },
    { city: 'Томск', cat: 'Ф2', grade: 'A+', values: [79.82, 92.01, 77.95, 131.62, 128.21, 108.36] },
    { city: 'Улан-Удэ', cat: 'Ф2', grade: 'A+', values: [33.98, 64.99, 53.05, 63.61, 46.30, 55.13] },
    { city: 'Уфа', cat: 'Ф2', grade: 'A+', values: [3.81, 3.71, 0.00, 0.00, 0.00, 0.00] },
  ],
  calc: {
    targetPct: 27,
    period: 'янв.26 – авг.26',
    city: 'Тамбов',
    buckets: [
      { label: 'нет данных', cash: 1, sum: 0, accred: 37, actualComm: 0, possible27: 1, banks: { tbank: 0, domrf: 0, sber: 0, vtb: 0, sovkom: 0, alfa: 0 } },
      { label: 'до 0,5 млн', cash: 10, sum: 3258000, accred: 3, actualComm: 4500, possible27: 3, banks: { tbank: 1096, domrf: 0, sber: 7380, vtb: 6150, sovkom: 0, alfa: 870 } },
      { label: '0,5–1 млн', cash: 26, sum: 18369000, accred: 2, actualComm: 3000, possible27: 7, banks: { tbank: 5547, domrf: 0, sber: 17220, vtb: 14350, sovkom: 0, alfa: 4400 } },
      { label: '1–2 млн', cash: 35, sum: 50085000, accred: 14, actualComm: 23880, possible27: 10, banks: { tbank: 16052, domrf: 12300, sber: 24600, vtb: 20500, sovkom: 0, alfa: 12731 } },
      { label: '2–3 млн', cash: 60, sum: 151620800, accred: 24, actualComm: 45551, possible27: 17, banks: { tbank: 48188, domrf: 55760, sber: 41820, vtb: 34850, sovkom: 0, alfa: 38218 } },
      { label: '3–4 млн', cash: 106, sum: 363884000, accred: 24, actualComm: 46560, possible27: 29, banks: { tbank: 111670, domrf: 154570, sber: 71340, vtb: 71340, sovkom: 0, alfa: 88567 } },
      { label: '4–5 млн', cash: 103, sum: 459169000, accred: 22, actualComm: 39720, possible27: 28, banks: { tbank: 140015, domrf: 160720, sber: 68880, vtb: 68880, sovkom: 0, alfa: 111048 } },
      { label: '5–6 млн', cash: 50, sum: 272370000, accred: 8, actualComm: 16452, possible27: 14, banks: { tbank: 85546, domrf: 91840, sber: 34440, vtb: 45920, sovkom: 0, alfa: 67847 } },
      { label: '6–7 млн', cash: 42, sum: 269830000, accred: 5, actualComm: 8460, possible27: 12, banks: { tbank: 86478, domrf: 88560, sber: 29520, vtb: 39360, sovkom: 0, alfa: 68586 } },
      { label: '7–8 млн', cash: 16, sum: 116150000, accred: 3, actualComm: 7500, possible27: 5, banks: { tbank: 40715, domrf: 41000, sber: 20500, vtb: 24600, sovkom: 0, alfa: 32291 } },
      { label: '8–9 млн', cash: 6, sum: 50350000, accred: 5, actualComm: 15700, possible27: 2, banks: { tbank: 18826, domrf: 18040, sber: 8200, vtb: 9840, sovkom: 0, alfa: 14931 } },
      { label: '9–10 млн', cash: 5, sum: 46900000, accred: 0, actualComm: 0, possible27: 2, banks: { tbank: 21043, domrf: 19680, sber: 8200, vtb: 11480, sovkom: 0, alfa: 16690 } },
      { label: '10 млн и более', cash: 17, sum: 233250000, accred: 6, actualComm: 18200, possible27: 5, banks: { tbank: 76953, domrf: 51250, sber: 20500, vtb: 28700, sovkom: 0, alfa: 61032 } },
    ],
  },
};

/* ---------------------------------------------------------------------- */
/* CSV: загрузка и парсинг                                                */
/* ---------------------------------------------------------------------- */
function csvUrl({ id, gid }) {
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

async function fetchCsv(sheet) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(csvUrl(sheet), { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} при загрузке листа ${sheet.id}#${sheet.gid}`);
    const text = await res.text();
    if (/<html/i.test(text.slice(0, 200))) {
      throw new Error('Google вернул HTML вместо CSV — вероятно, таблица закрыта от публичного доступа');
    }
    return parseCsv(text);
  } finally {
    clearTimeout(timer);
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r') {
      // skip
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1; // 0-based
}
function cell(rows, row1, colLetters) {
  const r = rows[row1 - 1];
  if (!r) return '';
  return r[colIndex(colLetters)] ?? '';
}
function toNum(raw) {
  if (raw == null) return 0;
  let t = String(raw).trim();
  if (!t) return 0;
  t = t.replace(/[\s\u00A0]/g, '').replace('%', '').replace(',', '.');
  const v = parseFloat(t);
  return Number.isNaN(v) ? 0 : v;
}
function toStr(raw) {
  return (raw ?? '').toString().trim();
}
const numCell = (rows, row1, col) => toNum(cell(rows, row1, col));
const strCell = (rows, row1, col) => toStr(cell(rows, row1, col));

/* ---------------------------------------------------------------------- */
/* Лист "Карта онлайн" — проникновение ЭР по городам                      */
/* ---------------------------------------------------------------------- */
const MAP_TRIPLES = [
  ['BW', 'BX', 'BY'], ['EN', 'EO', 'EP'], ['HH', 'HI', 'HJ'], ['HK', 'HL', 'HM'], ['HN', 'HO', 'HP'],
  ['HQ', 'HR', 'HS'], ['HT', 'HU', 'HV'], ['HW', 'HX', 'HY'], ['HZ', 'IA', 'IB'], ['IC', 'ID', 'IE'],
  ['IF', 'IG', 'IH'], ['II', 'IJ', 'IK'], ['IL', 'IM', 'IN'], ['IO', 'IP', 'IQ'], ['IR', 'IS', 'IT'],
  ['IU', 'IV', 'IW'], ['IX', 'IY', 'IZ'], ['JA', 'JB', 'JC'],
];
// "Наша база"-слоты (1-индекс) и подписи месяцев
const MAP_NASHA_BAZA_SLOTS = [
  ['дек.24', 2], ['дек.25', 3], ['янв.26', 5], ['февр.26', 7], ['мар.26', 9],
  ['апр.26', 11], ['мая.26', 13], ['июн.26', 15], ['июл.26', 17],
];

function buildMapData(rows) {
  const months = MAP_NASHA_BAZA_SLOTS.map((m) => m[0]);
  const rowValues = (row1) => MAP_NASHA_BAZA_SLOTS.map(([, slot]) => {
    const pctCol = MAP_TRIPLES[slot - 1][2];
    return numCell(rows, row1, pctCol);
  });

  const aggs = [
    { city: 'Вся сеть', cat: '', grade: '', agg: true, values: rowValues(5) },
    { city: 'Ф1', cat: 'Ф1', grade: '', agg: true, values: rowValues(6) },
    { city: 'Ф2', cat: 'Ф2', grade: '', agg: true, values: rowValues(7) },
    { city: 'Ф3', cat: 'Ф3', grade: '', agg: true, values: rowValues(8) },
  ];

  const cities = [];
  let emptyStreak = 0;
  for (let r = 11; r <= 260; r++) {
    const cityName = strCell(rows, r, 'E');
    if (!cityName) {
      emptyStreak++;
      if (emptyStreak >= 3) break;
      continue;
    }
    emptyStreak = 0;
    cities.push({
      city: cityName,
      cat: strCell(rows, r, 'C'),
      grade: strCell(rows, r, 'D'),
      values: rowValues(r),
    });
  }
  return { months, aggs, cities };
}

/* ---------------------------------------------------------------------- */
/* Лист "Калькулятор" — разбивка по чекам сделок                          */
/* ---------------------------------------------------------------------- */
function buildCalcData(rows) {
  const targetPct = Math.round(numCell(rows, 3, 'S')) || 27;
  const periodFrom = `${strCell(rows, 4, 'D')} ${strCell(rows, 4, 'E')}`.trim();
  const periodTo = `${strCell(rows, 5, 'D')} ${strCell(rows, 5, 'E')}`.trim();
  const city = strCell(rows, 7, 'D') || strCell(rows, 7, 'C') || '—';

  const buckets = [];
  for (let r = 11; r <= 40; r++) {
    const label = strCell(rows, r, 'C');
    if (!label) break;
    if (label.toLowerCase().includes('итого')) break;
    buckets.push({
      label,
      cash: numCell(rows, r, 'D'),
      sum: numCell(rows, r, 'E'),
      accred: numCell(rows, r, 'G'),
      actualComm: numCell(rows, r, 'J'),
      possible27: numCell(rows, r, 'Q'),
      banks: {
        tbank: numCell(rows, r, 'S'),
        domrf: numCell(rows, r, 'T'),
        sber: numCell(rows, r, 'U'),
        vtb: numCell(rows, r, 'V'),
        sovkom: numCell(rows, r, 'W'),
        alfa: numCell(rows, r, 'X'),
      },
    });
  }
  return { targetPct, period: `${periodFrom} – ${periodTo}`, city, buckets };
}

/* ---------------------------------------------------------------------- */
/* Загрузка "вживую" + кэш (память + диск) + фоновое обновление           */
/* ---------------------------------------------------------------------- */
async function fetchLive() {
  const [mapRows, calcRows] = await Promise.all([fetchCsv(SHEET_MAP), fetchCsv(SHEET_CALC)]);
  const map = buildMapData(mapRows);
  const calc = buildCalcData(calcRows);
  return {
    generatedAt: Date.now(),
    source: 'live',
    months: map.months,
    aggs: map.aggs,
    cities: map.cities,
    calc,
  };
}

function loadDiskCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function saveDiskCache(data) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf8');
  } catch (e) {
    console.warn('Не удалось сохранить кэш на диск:', e.message);
  }
}

let memCache = null;
let refreshInFlight = null;

export async function refreshData() {
  if (refreshInFlight) return refreshInFlight; // не дублируем параллельные запросы
  refreshInFlight = (async () => {
    const data = await fetchLive();
    memCache = data;
    saveDiskCache(data);
    return data;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export async function getData() {
  if (memCache) {
    if (Date.now() - memCache.generatedAt > CACHE_TTL_MS) {
      refreshData().catch((e) => console.warn('Фоновое обновление не удалось:', e.message));
    }
    return memCache;
  }
  const disk = loadDiskCache();
  if (disk) {
    memCache = disk;
    if (Date.now() - disk.generatedAt > CACHE_TTL_MS) {
      refreshData().catch((e) => console.warn('Фоновое обновление не удалось:', e.message));
    }
    return memCache;
  }
  try {
    return await refreshData();
  } catch (e) {
    console.warn('Первая загрузка из Google Sheets не удалась, используем резервный снимок:', e.message);
    memCache = { ...DEFAULT_DATA, generatedAt: Date.now(), source: 'fallback' };
    return memCache;
  }
}

// Проверяем раз в час, обновляем, если кэшу больше 24 часов —
// так дашборд освежается сам, даже если на сайт никто не заходит.
export function startScheduler() {
  setInterval(() => {
    if (!memCache || Date.now() - memCache.generatedAt > CACHE_TTL_MS) {
      refreshData().catch((e) => console.warn('Плановое обновление не удалось:', e.message));
    }
  }, 60 * 60 * 1000);
}
