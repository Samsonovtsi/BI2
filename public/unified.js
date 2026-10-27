/* BI2: three top-level work areas. Legacy analytics pages and methods are preserved. */
(() => {
  'use strict';
  const groups = {
    map: {
      label: 'Карта онлайн',
      tabs: [
        ['overview', 'Обзор показателей'],
        ['analytics', 'Сравнение и тепловая карта'],
        ['city', 'Карточка города'],
        ['banks', 'Банки и доходность'],
        ['nominal', 'Номинальные счета'],
        ['traffic', 'Светофор городов'],
        ['plans', 'Планы городов'],
        ['reports', 'Отчёты'],
        ['cosmos', 'Космос и сверка'],
        ['quality', 'Отклонения и срезы'],
        ['sources', 'Источники']
      ]
    },
    realtors: {label: 'Светофор риелторов', tabs: [['realtors', 'Сотрудники и рекорды']]},
    calc: {
      label: 'Калькулятор АКК',
      tabs: [['calc', 'Расчёт по чекам'], ['calc-deals', 'По сделкам'], ['calc-rates', 'Тарифы и удержания']]
    }
  };
  const sections = new Map(Object.entries(groups).flatMap(([area,g]) => g.tabs.map(([id,label]) => [id,{area,label}])));
  const nav = [...document.querySelectorAll('#nav .navlink[data-area]')];
  const subnav = document.getElementById('sectionSubnav');
  const previous = {map: 'overview', realtors: 'realtors', calc: 'calc'};
  const periodCaption = document.getElementById('realtorSelectedProducts');
  let currentArea = 'map';

  function activate(tabId) {
    const meta = sections.get(tabId);
    if (!meta) return;
    const area = meta.area;
    const target = document.getElementById('tab-' + tabId);
    if (!target) return;
    previous[area] = tabId;
    currentArea = area;
    document.body.dataset.area = area;
    for (const el of document.querySelectorAll('.tabpage')) el.classList.toggle('active',el === target);
    for (const el of nav) {
      const chosen = el.dataset.area === area;
      el.classList.toggle('active', chosen);
      el.setAttribute('aria-current', chosen ? 'page' : 'false');
    }
    subnav.replaceChildren();
    for (const [id,label] of groups[area].tabs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'area-subtab' + (id === tabId ? ' active' : '');
      button.textContent = label;
      button.dataset.tab = id;
      button.setAttribute('aria-current', id === tabId ? 'page' : 'false');
      button.addEventListener('click', () => activate(id));
      subnav.appendChild(button);
    }
    document.getElementById('pageTitle').textContent = groups[area].label;
    document.getElementById('pageDesc').textContent = meta.label;
    // The calculator owns its city/period; the employee prototype has separate filters.
  }

  for (const link of nav) {
    link.addEventListener('click', () => activate(previous[link.dataset.area] || link.dataset.tab));
  }

  function refreshProducts() {
    if (!periodCaption) return;
    const picked = [...document.querySelectorAll('#realtorProducts input:checked')].map(el => el.dataset.product);
    periodCaption.textContent = picked.length
      ? 'Выбрано: ' + picked.join(' + ') + '. Статистика сотрудников появится после подключения сделок, сотрудников и комиссий.'
      : 'Выберите хотя бы один продукт для будущего расчёта.';
  }
  document.querySelectorAll('#realtorProducts input').forEach(input => input.addEventListener('change',refreshProducts));
  document.getElementById('realtorSearch')?.addEventListener('input', (event) => {
    const el = document.getElementById('realtorSearchNote');
    el.textContent = event.target.value.trim()
      ? 'Поиск будет применяться к ФИО, партнёру и старшему партнёру после подключения источника сотрудников.'
      : 'Для поиска необходима связанная выгрузка сотрудников.';
  });
  refreshProducts();

  async function loadPlans() {
    try {
      const response = await fetch('/api/plans', {cache:'no-store'});
      if (!response.ok) throw new Error('plans_unavailable');
      const plans = await response.json();
      window.BI2UnifiedPlans = Array.isArray(plans) ? plans : [];
      if (currentArea === 'map' && previous.map === 'analytics' && typeof renderHeatTable === 'function') renderHeatTable();
    } catch (_error) {
      window.BI2UnifiedPlans = null; // Distinguish missing plans from an empty list.
    }
  }
  window.addEventListener('bi2-plans-changed',loadPlans);
  loadPlans();
  activate('overview');
})();
