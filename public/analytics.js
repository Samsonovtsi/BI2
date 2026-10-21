/* Aggregation is shared by the interactive card, bank view and printable report. */
(function (global) {
  'use strict';
  const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  const key = v => clean(v).replace(/^г\.?\s+/i, '').toLowerCase().replace(/ё/g, 'е').replace(/[-‐‑–—]/g, ' ').replace(/\s+/g, ' ');
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const sum = values => values.length && values.every(finite) ? values.reduce((a, b) => a + b, 0) : null;
  const ratio = (n, d) => finite(n) && finite(d) && d > 0 ? 100 * n / d : null;
  const html = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, digits = 2) => finite(v) ? v.toLocaleString('ru-RU', { maximumFractionDigits: digits }) : '—';
  const pct = v => finite(v) ? `${fmt(v)}%` : '—';
  const rub = v => finite(v) ? `${fmt(v)} ₽` : '—';
  const shortMonth = m => /^\d{4}-\d{2}$/.test(m || '') ? `${m.slice(5)}.${m.slice(0, 4)}` : '—';
  function matches(city, filters = {}) {
    if (filters.city && key(city.city) !== key(filters.city)) return false;
    if (!filters.city && city.excluded) return false;
    if (filters.grade && city.grade !== filters.grade) return false;
    if (filters.cat === 'Ф1, Ф3' || filters.cat === 'Ф1, Ф3 (без ТМН)') {
      if (!['Ф1', 'Ф3'].includes(city.cat)) return false;
      if (filters.cat.includes('без ТМН') && key(city.city) === 'тюмень') return false;
    } else if (filters.cat && city.cat !== filters.cat) return false;
    if (!filters.city && !filters.cat && ['Ф4', 'Ф5'].includes(city.cat)) return false;
    return true;
  }
  function getRecords(a, filters, from, to) {
    const directory = new Map(a.directory.map(c => [key(c.city), c]));
    return a.records.filter(r => r.month >= from && r.month <= to && matches(directory.get(r.cityKey) || { city: r.city }, filters));
  }
  function metric(records, metricKey, method) {
    const counts = records.map(r => r[metricKey]?.[method === 'new' ? 'rawCount' : 'summaryCount']);
    const bases = records.map(r => method === 'new' ? r.newBase : r[metricKey]?.summaryBase);
    const count = sum(counts), base = sum(bases);
    return { count, base, pct: method === 'summary' && records.length === 1 ? records[0][metricKey]?.summaryPct ?? null : ratio(count, base) };
  }
  function products(records, catalog, coverage, months) {
    const covered = months.length > 0 && months.every(m => coverage.includes(m));
    return catalog.map(p => {
      const parts = records.map(r => r.products[p.id]).filter(Boolean);
      const counts = parts.reduce((n, r) => n + r.count, 0);
      const total = field => !covered || !records.length ? null : parts.some(r => r['missing' + field[0].toUpperCase() + field.slice(1)] > 0) ? null : parts.reduce((n, r) => n + r[field], 0);
      return { ...p, count: covered && records.length ? counts : null, fee: total('fee'), centralIncome: total('centralIncome'), cityIncome: total('cityIncome') };
    });
  }
  function summarize(a, filters, from, to, method = 'summary') {
    const allMonths = [...new Set(a.records.map(r => r.month))].sort();
    const months = allMonths.filter(m => m >= from && m <= to);
    const records = getRecords(a, filters, from, to);
    function rollup(selected, periodMonths) {
      const bankRows = products(selected, a.products, a.coverage['АКК Data'] || [], periodMonths);
      const weighted = selected.length && selected.every(r => finite(r.averageCash) && finite(r.cashRaw));
      const cashRaw = sum(selected.map(r => r.cashRaw));
      return { cashRaw, newBase: sum(selected.map(r => r.newBase)),
        averageCash: weighted && cashRaw > 0 ? selected.reduce((n, r) => n + r.averageCash * r.cashRaw, 0) / cashRaw : null,
        er: metric(selected, 'er', method), akk: metric(selected, 'akk', method), domklik: metric(selected, 'domklik', method),
        products: bankRows, cityIncome: sum(bankRows.map(p => p.cityIncome)), fee: sum(bankRows.map(p => p.fee)), centralIncome: sum(bankRows.map(p => p.centralIncome)) };
    }
    return { months, records, total: rollup(records, months), byMonth: months.map(m => ({ month: m, ...rollup(records.filter(r => r.month === m), [m]) })) };
  }
  global.BI2Model = { sum, ratio, html, matches, getRecords, metric, summarize };
  if (typeof document === 'undefined') return;

  let dataset = null, analytics = null, filters = {}, from = '', to = '', method = 'summary', lastPeriod = '', exports = {};
  const scope = f => f.city || (f.cat ? f.cat : 'Вся сеть') + (f.grade ? ` · грейд ${f.grade}` : '');
  const allMonths = () => [...new Set([...(analytics?.records || []).map(r => r.month), ...(analytics?.nominal || []).map(r => r.month)])].sort();
  const option = (v, label, selected) => `<option value="${html(v)}" ${v === selected ? 'selected' : ''}>${html(label)}</option>`;
  function controls(prefix) {
    const months = allMonths();
    return `<div class="panel details-controls"><div class="field"><label for="${prefix}-from">Период с</label><select id="${prefix}-from" data-detail-from>${months.map(m => option(m, shortMonth(m), from)).join('')}</select></div>
      <div class="field"><label for="${prefix}-to">по</label><select id="${prefix}-to" data-detail-to>${months.map(m => option(m, shortMonth(m), to)).join('')}</select></div>
      <div class="field"><label for="${prefix}-method">Методика процентов</label><select id="${prefix}-method" data-detail-method>${option('summary', 'Исходные своды', method)}${option('new', 'Свод по городу NEW', method)}</select></div>
      <div class="panel-note">Город, ФиФ и грейд выбираются в фильтрах сверху. Период общий для карточки, банков и номинальных счетов.</div></div>`;
  }
  function note() {
    return `<div class="callout">${html(analytics.methods[method])} Пустые или ошибочные значения показаны как «—». При неполных данных итог также не рассчитывается. Нулевой результат сохраняется как 0.</div>`;
  }
  function kpi(label, value) { return `<div class="kpi"><div class="lbl">${html(label)}</div><div class="val">${value}</div></div>`; }
  function table(headers, rows) {
    return `<div class="table-wrap details-table"><table><thead><tr>${headers.map(h => `<th>${html(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((v, i) => `<td${i === 0 ? ' class="city-cell"' : ''}>${html(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function card(s, title, exportKey = '') {
    const defs = [
      ['Сделки с наличными — исходное количество', d => d.cashRaw, fmt],
      ['Расчётная база NEW', d => d.newBase, fmt],
      ['Средняя сумма сделки, ₽', d => d.averageCash, fmt],
      ['Количество ЭР', d => d.er.count, fmt], ['Знаменатель ЭР', d => d.er.base, fmt], ['Проникновение ЭР', d => d.er.pct, pct],
      ['Количество ДомКлик', d => d.domklik.count, fmt], ['Знаменатель ДомКлик', d => d.domklik.base, fmt], ['Проникновение ДомКлик', d => d.domklik.pct, pct],
      ['Количество АКК / СБР', d => d.akk.count, fmt], ['Знаменатель АКК / СБР', d => d.akk.base, fmt], ['Проникновение АКК / СБР', d => d.akk.pct, pct],
      ['Вознаграждение от банков, ₽', d => d.fee, fmt], ['Доход ЦО, ₽', d => d.centralIncome, fmt], ['Доход города, ₽', d => d.cityIncome, fmt],
    ];
    for (const p of analytics.products) {
      defs.push([`${p.bank} · ${p.type} — количество`, d => d.products.find(x => x.id === p.id)?.count, fmt]);
      defs.push([`${p.bank} · ${p.type} — доход города, ₽`, d => d.products.find(x => x.id === p.id)?.cityIncome, fmt]);
    }
    const headers = ['Показатель', ...s.months.map(shortMonth), 'За период'];
    const rows = defs.map(([name, get, format]) => [name, ...s.byMonth.map(m => format(get(m))), format(get(s.total))]);
    if (exportKey) exports[exportKey] = [headers, ...rows];
    return `<h3>${html(title)}</h3><div class="panel-note">${shortMonth(from)} – ${shortMonth(to)}. Процент за период = сумма операций / сумма расчётных баз. Количества и доходы по банкам — из «АКК Data».</div>
      <div class="kpis">${kpi('ЭР за период', fmt(s.total.er.count))}${kpi('АКК / СБР за период', fmt(s.total.akk.count))}${kpi('Проникновение ЭР', pct(s.total.er.pct))}${kpi('Доход города', rub(s.total.cityIncome))}</div>
      ${table(headers, rows)}<p class="panel-note">Средняя сумма сделки сохраняет значение источника «Сумма BI+Космос». Нули и пропуски в источнике требуют проверки. Показатели группы рассчитаны по входящим городам; они могут отличаться от отдельной итоговой строки книги.</p>`;
  }
  function renderCity() {
    const s = summarize(analytics, filters, from, to, method);
    document.getElementById('cityDetails').innerHTML = `${controls('city')}${note()}<div class="panel">${card(s, scope(filters), 'city')}<button class="reset" data-export="city">Скачать таблицу CSV</button></div>`;
    const banks = s.total.products;
    const rows = banks.map(p => [`${p.bank} · ${p.type}`, fmt(p.count, 0), rub(p.fee), rub(p.centralIncome), rub(p.cityIncome)]);
    const headers = ['Банк и продукт', 'Операций', 'Вознаграждение', 'Доход ЦО', 'Доход города'];
    rows.push(['Итого', fmt(sum(banks.map(p => p.count)), 0), rub(s.total.fee), rub(s.total.centralIncome), rub(s.total.cityIncome)]);
    exports.banks = [headers, ...rows];
    document.getElementById('bankDetails').innerHTML = `${controls('bank')}<div class="panel"><h3>Фактические комиссии — ${html(scope(filters))}</h3>
      <p class="panel-note">Источник — «АКК Data»: F — вознаграждение, I — доход ЦО, J — доход города. Пропуск дохода ЦО не приравнивается к нулю. Продукты одного банка показаны отдельно.</p>${table(headers, rows)}<button class="reset" data-export="banks">Скачать CSV</button></div>`;
  }
  function renderNominal() {
    const directory = new Map(analytics.directory.map(c => [key(c.city), c]));
    const selected = analytics.nominal.filter(r => r.month >= from && r.month <= to && matches(directory.get(r.cityKey) || { city: r.city }, filters));
    const rows = selected.sort((a, b) => a.month.localeCompare(b.month) || a.city.localeCompare(b.city, 'ru')).map(r => [r.city, shortMonth(r.month), r.basis === 'disclosure' ? 'Раскрытие' : 'Пополнение, нет даты раскрытия', fmt(r.count, 0), rub(r.amount), fmt(r.daysCount ? r.daysSum / r.daysCount : null), rub(r.missing.income ? null : r.income), rub(r.missing.cityIncome ? null : r.cityIncome), Object.entries(r.statuses).map(([k, v]) => `${k}: ${v}`).join('; ')]);
    const headers = ['Город', 'Месяц', 'Основание периода', 'Счетов', 'Сумма', 'Средний срок, дней', 'Доход компании', 'Доход города', 'Статусы'];
    exports.nominal = [headers, ...rows];
    document.getElementById('nominalDetails').innerHTML = `${controls('nominal')}<div class="panel"><h3>Номинальные счета — ${html(scope(filters))}</h3>
      <p class="panel-note">Источник — «Тех. лист. номинальный счет». Период: месяц раскрытия; если его нет — месяц пополнения, с отдельной отметкой. Доходы взяты из источника, ставки повторно не применяются.</p>
      <div class="kpis">${kpi('Счетов', fmt(sum(selected.map(r => r.count)), 0))}${kpi('Сумма', rub(sum(selected.map(r => r.amount))))}${kpi('Доход компании', rub(sum(selected.map(r => r.missing.income ? null : r.income))))}${kpi('Доход города', rub(sum(selected.map(r => r.missing.cityIncome ? null : r.cityIncome))))}</div>
      ${rows.length ? table(headers, rows) : '<p>Нет данных по выбранному городу и периоду.</p>'}<button class="reset" data-export="nominal">Скачать CSV</button></div>`;
  }
  function renderSources() {
    const rows = Object.entries(analytics.sources).map(([name, meta]) => [name, meta.source === 'live' ? 'Google Sheets' : 'Excel', new Date(meta.loadedAt).toLocaleString('ru-RU'), meta.monthFrom ? `${shortMonth(meta.monthFrom)} – ${shortMonth(meta.monthTo)}` : 'Не определён', fmt(meta.errors, 0)]);
    document.getElementById('sourceDetails').innerHTML = `<div class="panel"><h3>Источники и актуальность</h3><p class="panel-note">Время загрузки и последний месяц данных — разные показатели. Источник может успешно обновиться, но содержать старые данные.</p>
      ${table(['Лист', 'Источник', 'Загружен', 'Период в данных', 'Ошибки'], rows)}</div>
      <div class="panel"><h3>Проверки (${analytics.diagnostics.length})</h3>${analytics.diagnostics.length ? `<ul class="diagnostics">${analytics.diagnostics.slice(0, 100).map(d => `<li><b>${html(d.sheet)}:</b> ${html(d.message)}${d.count != null ? ` (${fmt(d.count, 0)})` : ''}${d.cells?.length ? ` · ${html(d.cells.join(', '))}` : ''}</li>`).join('')}</ul>` : '<p>Ошибок в проверяемых диапазонах не найдено.</p>'}</div>
      <div class="panel"><h3>Методика</h3><p>${html(analytics.methods.summary)}</p><p>${html(analytics.methods.new)}</p><p>Категории Ф4/Ф5 и исключённые города не входят в общий итог карточки. Проверить отдельный город можно через фильтр.</p>
      ${analytics.ignoredSheets?.length ? `<details><summary>Листы вне этого этапа переноса (${analytics.ignoredSheets.length})</summary><p>${html(analytics.ignoredSheets.join(', '))}</p></details>` : ''}</div>`;
  }
  function render(currentFilters = filters) {
    filters = currentFilters;
    if (!analytics) {
      for (const id of ['cityDetails', 'bankDetails', 'nominalDetails', 'sourceDetails']) document.getElementById(id).innerHTML = '<div class="panel"><h3>Нужны данные полной книги</h3><p>Загрузите Excel-файл «Карта онлайн» или нажмите «Обновить сейчас». Старый резервный снимок не содержит исходных количеств и комиссий.</p></div>';
      return;
    }
    renderCity(); renderNominal(); renderSources();
  }
  function update(data, currentFilters = {}) {
    dataset = data; analytics = data.analytics || null; filters = currentFilters;
    const months = allMonths();
    if (!months.length) { render(); return; }
    const preferred = data.monthKeys?.at(-1) || months.at(-1);
    if (!to || !months.includes(to)) to = preferred;
    if (!from || !months.includes(from)) from = months[Math.max(0, months.indexOf(to) - 11)];
    lastPeriod = preferred; render();
  }
  function syncPeriod(period) {
    if (period && period !== lastPeriod && allMonths().includes(period)) { to = period; if (from > to) from = to; lastPeriod = period; }
  }
  function report(city, month, chosenMethod = method) {
    if (!analytics) return '<div class="report-note">Для полного отчёта загрузите Карту онлайн.</div>';
    const f = { city, cat: '', grade: '' }, s = summarize(analytics, f, month, month, chosenMethod);
    const prevFrom = from, prevTo = to; from = month; to = month;
    const result = `<div class="report-doc"><h1>Отчёт по городу: ${html(city)}</h1><p class="report-sub">Период: ${shortMonth(month)} · ${html(analytics.methods[chosenMethod])}</p>${card(s, 'Показатели за выбранный месяц')}<p class="report-note">Сформировано: ${new Date().toLocaleString('ru-RU')}. Все блоки используют один месяц. Источник: ${html(dataset.sourceFile || 'Google Sheets')}.</p></div>`;
    from = prevFrom; to = prevTo; return result;
  }
  document.addEventListener('change', e => {
    if (e.target.matches('[data-detail-from]')) { from = e.target.value; if (to < from) to = from; render(); }
    if (e.target.matches('[data-detail-to]')) { to = e.target.value; if (from > to) from = to; render(); }
    if (e.target.matches('[data-detail-method]')) { method = e.target.value; render(); }
  });
  document.addEventListener('click', e => {
    const button = e.target.closest('[data-export]'); if (!button) return;
    const rows = exports[button.dataset.export]; if (!rows) return;
    const csvCell = v => { let s = String(v ?? ''); if (/^[=+@-]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; };
    const csv = '\ufeff' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
    const a = document.createElement('a'), url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.href = url; a.download = `BI2-${button.dataset.export}-${from}-${to}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  global.BI2Analytics = { update, render, report, syncPeriod, getMethod: () => method };
})(globalThis);
