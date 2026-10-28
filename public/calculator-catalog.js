const BANKS=['Т-Банк','ДомРФ','Сбер','ВТБ','Совкомбанк','Альфа'];
const SOURCE='https://docs.google.com/spreadsheets/d/1es-6KsSYuDKYCfusMtFwFQCqQWnI7-WdhnOO-LTNkz8/edit';
const money=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(n)+' ₽';
const numeric=v=>Number(String(v||'').replace(/[\s\u00a0\u202f]/g,'').replace(',','.'));
let built=false;
function mark(title,gid,description){
  return '<a class="catalog-source" href="'+SOURCE+'?gid='+gid+'" target="_blank" rel="noopener noreferrer"><b>'+title+'</b><small>'+description+'</small><span>Открыть ↗</span></a>';
}
function mount(root){
  root.innerHTML=[
    '<div class="workspace-intro"><div><span class="workspace-eyebrow">03 / Калькулятор</span><h2>Каталоги КВ и удержаний ЦО</h2><p>Отдельный сценарий «правильного выбора» без изменения согласованного расчёта в Карте.</p></div>',
    '<a class="workspace-source" target="_blank" rel="noopener noreferrer" href="'+SOURCE+'">Исходный калькулятор ↗</a></div>',
    '<div class="workspace-warning">Это <b>сценарный расчёт</b>, а не действующий тариф банка. Для автоматической сверки каждой сделки требуются версии матриц выплат, критерии доступности банков, сроки, суммы, даты и ID операций. Правки ниже не изменяют Google Sheets и не сохраняются на сервере.</div>',
    '<div class="catalog-grid">',
    mark('Калькулятор','1180972308','Исходная модель и группировки по чекам'),
    mark('Детализация по сделкам','489943861','Сравнение фактического и потенциального КВ'),
    mark('Матрицы выплат','802839738','Банковские ставки, суммы, сроки, периоды'),
    mark('Базовые % города','200246777','Доля ЦО и выплачиваемый городу процент'),
    '</div>',
    '<div class="panel catalog-panel"><h3>Сценарий для одной сделки</h3>',
    '<p class="rl-soft">Укажите сумму сделки, срок, КВ каждого доступного банка и удержание ЦО. Для Т-Банка можно рассчитать банковскую КВ по годовой ставке: сумма × дни × ставка / 365.</p>',
    '<div class="catalog-params"><label>Сумма сделки, ₽<input id="caAmount" type="number" min="0" step="10000" value="5000000"></label><label>Срок, дней<input id="caTerm" type="number" min="1" max="365" value="5"></label><label>Ставка Т-Банка, % годовых (необяз.)<input id="caTbankRate" type="number" step="0.1" min="0" max="100" placeholder="Из актуальной матрицы"></label><label>Фактический банк<select id="caActual"><option value="">Выберите банк</option>'+BANKS.map(x=>'<option value="'+x+'">'+x+'</option>').join('')+'</select></label></div>',
    '<div class="rl-table-wrap"><table class="rl-table catalog-table"><thead><tr><th>Банк</th><th>КВ от банка, ₽</th><th>Удержание ЦО, %</th><th>КВ города после ЦО</th><th>Сравнение</th></tr></thead><tbody id="caRows"></tbody></table></div>',
    '<div class="catalog-result" id="caResult">Введите действующие значения КВ и удержаний для доступных банков. Неизвестные ставки исключаются из выбора.</div>',
    '<button class="workspace-ghost" id="caReset" type="button">Очистить сценарий</button></div>',
    '<div class="workspace-footnote">Значения КВ для ДомРФ, Сбера, ВТБ и других банков необходимо брать из тарифной матрицы с соответствующими диапазонами сумм и сроков; одна годовая ставка для них не подставляется. Расчёт не учитывает льготы, лимиты и ограничения банка, пока эти данные не подключены.</div>'
  ].join('');
  const body=root.querySelector('#caRows');
  body.innerHTML=BANKS.map((bank,i)=>'<tr data-bank="'+bank+'"><td><strong>'+bank+'</strong></td><td><input type="number" min="0" step="0.01" class="caGross" placeholder="Введите КВ" aria-label="КВ банка '+bank+'"></td><td><input type="number" min="0" max="100" step="0.1" class="caCo" placeholder="%" aria-label="Удержание ЦО '+bank+'"></td><td class="caNet">—</td><td class="caCompare">—</td></tr>').join('');
  const all=[...body.querySelectorAll('tr')];
  function calculate() {
    const amount=numeric(root.querySelector('#caAmount').value);
    const term=numeric(root.querySelector('#caTerm').value);
    const rateString=root.querySelector('#caTbankRate').value;
    const annualRate=rateString?numeric(rateString):null;
    const tbankGross=annualRate!==null&&annualRate>=0&&amount>0&&term>0?amount*term*(annualRate/100)/365:null;
    const tbankGrossField=all[0].querySelector('.caGross');
    if(annualRate!==null&&Number.isFinite(tbankGross)){
      tbankGrossField.value=tbankGross.toFixed(2);tbankGrossField.disabled=true;
    }else{
      if(tbankGrossField.disabled)tbankGrossField.value='';
      tbankGrossField.disabled=false;
    }
    const options=all.map((tr,i)=>{
      const grossText=tr.querySelector('.caGross').value;
      const coText=tr.querySelector('.caCo').value;
      const gross=grossText===''?null:numeric(grossText);
      const co=coText===''?null:numeric(coText);
      const net=gross!==null&&gross>=0&&Number.isFinite(gross)&&co!==null&&co>=0&&co<=100&&Number.isFinite(co)?gross*(1-co/100):null;
      tr.querySelector('.caNet').textContent=net===null?'—':money(net);
      tr.querySelector('.caCompare').textContent=net===null?'Нет данных':'Доступный вариант';
      return {bank:BANKS[i],net};
    });
    const valid=options.filter(v=>v.net!==null);
    const result=root.querySelector('#caResult');
    if(!valid.length){result.textContent='Нет рассчитанных банков: заполните КВ и процент удержания ЦО минимум для одного банка.';return;}
    valid.sort((a,b)=>b.net-a.net);
    const best=valid[0],actual=options.find(v=>v.bank===root.querySelector('#caActual').value);
    const margin=actual?.net!==null&&actual?.net!==undefined?Math.max(0,best.net-actual.net):null;
    all.forEach(tr=>{if(tr.dataset.bank===best.bank)tr.querySelector('.caCompare').textContent='Максимальное КВ города';});
    result.innerHTML='<div><small>Лучший из введённых вариантов</small><strong>'+best.bank+'</strong></div>'+
      '<div><small>Доход города</small><strong>'+money(best.net)+'</strong></div>'+
      '<div><small>Потенциал к фактическому банку</small><strong>'+(margin===null?'Выберите банк и его ставку':money(margin))+'</strong></div>';
  }
  root.querySelectorAll('input,select').forEach(input=>input.addEventListener('input',calculate));
  root.querySelector('#caReset').addEventListener('click',()=>{
    root.querySelector('#caActual').value='';root.querySelector('#caTbankRate').value='';
    all.forEach(tr=>{tr.querySelector('.caGross').value='';tr.querySelector('.caGross').disabled=false;tr.querySelector('.caCo').value='';});
    calculate();
  });
  calculate();
}
export function mountCalcCatalog(el){if(built)return;built=true;mount(el);}
