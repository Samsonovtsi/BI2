import * as XLSX from 'xlsx';
import { buildDataset, SOURCE_NAMES, clean } from './workbook-data.js';
import { buildCalcData } from './calculator.js';

export function workbookRows(buffer) {
  const names = XLSX.read(buffer, { type: 'buffer', bookSheets: true }).SheetNames;
  const selected = names.filter(n => SOURCE_NAMES.some(s => clean(n).toLowerCase() === s.toLowerCase()));
  if (!selected.length) throw new Error('Не найдены листы Карты онлайн. Ожидаются «Свод ЭР», «Свод АКК» или исходные реестры.');
  const wb = XLSX.read(buffer, { type: 'buffer', sheets: selected, cellText: false, cellStyles: false, cellFormula: false, cellHTML: false });
  const sources = {};
  for (const originalName of selected) {
    const ws = wb.Sheets[originalName]; if (!ws?.['!ref']) continue;
    const name = SOURCE_NAMES.find(s => s.toLowerCase() === clean(originalName).toLowerCase());
    const range = XLSX.utils.decode_range(ws['!ref']);
    if (range.e.r > 500000 || range.e.c > 1500) throw new Error(`Слишком большой диапазон на листе «${name}»`);
    const rows = Array.from({ length: range.e.r + 1 }, () => []);
    for (const [addr, cell] of Object.entries(ws)) {
      if (addr.startsWith('!')) continue;
      const { r, c } = XLSX.utils.decode_cell(addr);
      rows[r][c] = cell.t === 'e' ? (cell.w || ({ 0:'#NULL!', 7:'#DIV/0!', 15:'#VALUE!', 23:'#REF!', 29:'#NAME?', 36:'#NUM!', 42:'#N/A' }[cell.v]) || '#VALUE!') : (cell.v ?? null);
    }
    sources[name] = rows;
  }
  return { sources, names };
}

export function parseWorkbook(buffer, options = {}) {
  const { sources, names } = workbookRows(buffer);
  const data = buildDataset(sources, options);
  data.analytics.ignoredSheets = names.filter(n => !Object.keys(sources).some(s => clean(n).toLowerCase() === s.toLowerCase()));
  if (sources['Калькулятор']) {
    const calc = buildCalcData(sources['Калькулятор']);
    if (calc.city !== '—' && calc.buckets.length) {
      data.calc = calc;
      data.calcSource = { source: options.source || 'upload', loadedAt: data.generatedAt };
    }
  }
  const hasAnalytics = data.analytics.records.length || data.analytics.nominal.length;
  if (!hasAnalytics && !data.calc) throw new Error('В книге не найдено данных по городам и месяцам');
  const services = Object.entries(data.analytics.sources).map(([sheet, meta]) => ({ service: sheet, sheet,
    monthFrom: meta.monthFrom, monthTo: meta.monthTo, monthCount: meta.monthCount, citiesCount: data.analytics.directory.length,
    note: meta.errors ? `Ошибок источника: ${meta.errors}` : undefined }));
  // Return aggregates only. Customer names, phones, links and registry rows are never cached or sent to the browser.
  return { data, calculatorOnly: !hasAnalytics, sheetsFound: names, services };
}
