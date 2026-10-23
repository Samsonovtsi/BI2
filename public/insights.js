(function(global) {
  'use strict';
  const M=global.BI2Insights, H=global.BI2Model.html;
  const fmt=(v,d=2)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('ru-RU',{maximumFractionDigits:d}):'—';
  const pct=v=>v==null?'—':fmt(v)+'%';
  const title={cash:'Объекты без ипотеки',akk:'АКК без ДомКлик',er:'ЭР (398)',seva:'Отправки SEVA (335)',sber:'Заявки Сбер (328)',income:'Комиссия участников услуг (534)'};
  const table=(headers,rows)=>`<div class="table-wrap details-table"><table><thead><tr>${headers.map(v=>`<th>${H(v)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(v=>`<td>${H(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const options=(items,value)=>items.map(x=>`<option value="${H(x)}" ${x===value?'selected':''}>${H(x)}</option>`).join('');
  let data={},filters={},month='',plans=[],history=[],apiError='',qualityMonth='',exports={};
  const directory=()=>data.analytics?.directory || [];
  function cities() {
    return [...new Set([...directory().map(c=>c.city),...Object.values(data.cosmos?.sheets || {}).filter(s=>s.kind!=='akkBanks').flatMap(s=>s.dataRows.filter(r=>!r.unknown).map(r=>r.label))])].sort((a,b)=>a.localeCompare(b,'ru'));
  }
  const periods=()=>[...new Set([...(data.analytics?.records || []).map(r=>r.month),...Object.values(data.cosmos?.sheets || {}).flatMap(s=>s.months)])].sort();
  const scope=()=>filters.city || filters.cat || 'Вся выгрузка';
  function cosmos() {
    const root=document.getElementById('cosmosDetails'), c=data.cosmos;
    if(!c) {root.innerHTML='<div class="panel"><h3>Сводная метрик Космос</h3><p>Загрузите Excel с отчётами 6, 242, 398, 335, 328 и 534. Книга дополняет Карту онлайн. Можно загружать отдельные листы.</p></div>';return;}
    const sheets=c.sheets, ms=periods(), i=ms.indexOf(month), shown=ms.slice(Math.max(0,i-11),i+1);
    const rows=Object.entries(title).filter(([kind])=>sheets[kind]).map(([kind,label])=>[label,...shown.map(m=>fmt(M.pivotValue(sheets[kind],m,filters,directory())))]);
    exports.cosmos=[['Показатель',...shown],...rows];
    const comparison=c.comparisons.filter(x=>x.month===month).map(x=>[x.type==='akk_banks'?'АКК города / банки без ДомКлик':'ЭР общий / по сервисам',x.month,fmt(x.source),fmt(x.compared),x.status==='match'?'Совпадает':x.status==='mismatch'?'Расхождение':'Недостаточно условий']);
    const match=M.mapReconciliation(data,month), differences=match.filter(r=>r.delta!==0);
    exports.reconciliation=[['Показатель','Город','Месяц','Карта онлайн','Космос','Разница'],...match.map(r=>[title[r.kind],r.city,r.month,r.map,r.cosmos,r.delta])];
    const cross=table(['Показатель','Город','Карта онлайн','Космос','Разница'],differences.slice(0,100).map(r=>[title[r.kind],r.city,fmt(r.map),fmt(r.cosmos),fmt(r.delta)]));
    const freshness=Object.values(sheets).map(s=>[s.name,s.asOfText,s.exportedText,`${s.months[0]} — ${s.months.at(-1)}`,fmt(s.grandTotal),fmt(s.undatedTotal)]);
    let banks='<p>Для банковской детализации в этой выгрузке нет разреза города. Выберите «Все города» и очистите ФиФ/грейд либо используйте раздел «Банки и комиссии» Карты онлайн.</p>';
    if(sheets.akkBanks&&!filters.city&&!filters.cat&&!filters.grade) {
      const s=sheets.akkBanks,j=s.months.indexOf(month);
      const b=s.dataRows.map(r=>[r.label,j<0?'—':fmt(r.values[j]),/домклик/i.test(r.label)?'Исключён из городского АКК':r.unknown?'Не указан банк':'Включён в банковскую выгрузку']);
      banks=table(['Банк/продукт','Операций за месяц','Состав'],b);exports.cosmosBanks=[['Банк/продукт','Операций','Состав'],...b];
    }
    const current=month===M.dateToday().slice(0,7)?'<p class="callout">Текущий месяц неполный. Сравнение с полным предыдущим месяцем не используется для сигналов падения.</p>':'';
    root.innerHTML=`<div class="panel details-controls"><div class="field"><label for="cosmosMonth">Месяц сверки</label><select id="cosmosMonth">${options(ms,month)}</select></div><p>Город, ФиФ и грейд — в верхних фильтрах.</p></div>${current}
      <div class="panel"><h3>Космос — ${H(scope())}</h3><p class="panel-note">Сохранены исходные единицы и фильтры. Пустая ячейка внутри сводной означает пустую группу (0); отсутствующий месяц — «—». Столбцы темпов роста не складываются с количествами.</p>
      ${table(['Показатель',...shown],rows)}<button class="reset" data-insight-export="cosmos">Скачать CSV</button>
      <p class="callout">Отчёты 6 и 335 считают уникальные объекты/сделки. Итог сети берётся из исходной строки «Итого»; сумма нескольких городов для таких показателей недоступна без ID. Отношение числа операций ЭР/АКК к объектам здесь не выдаётся за конверсию.</p></div>
      <div class="panel"><h3>Банки, ${H(month)}</h3>${banks}</div>
      <div class="panel"><h3>Сверка сопоставимых сводов</h3>${table(['Проверка','Месяц','Основной свод','Детализация','Результат'],comparison)}<p>АКК сверяется на общих месяцах после исключения ДомКлик. ЭР сверяется также по городам. 335 и 328 не прибавляются к 398.</p></div>
      <div class="panel"><h3>Сравнение с Картой онлайн за ${H(month)}</h3><p>Сопоставлено значений: ${match.length}; отличается: ${differences.length}. Сравниваются исходные количества по одинаковому названию города и месяцу. Разные даты среза и состав продуктов требуют проверки; значения автоматически не заменяются.</p>${cross}<button class="reset" data-insight-export="reconciliation">Скачать полную сверку CSV</button></div>
      <div class="panel"><h3>Дата среза и контрольные итоги</h3>${table(['Источник','Дата актуальности','Дата выгрузки','Доступные месяцы','Итог всего источника','Без месяца'],freshness)}<p>Времена сохранены как в выгрузке. Дата обновления источника не подтверждает ежедневную полноту операций. Итоги в этой таблице относятся ко всему исходному периоду, включая записи без месяца.</p>
      ${Object.values(sheets).map(s=>`<details><summary>${H(s.name)} — фильтры и единицы</summary><p>${H(s.dimension)} · ${H(s.dateField)} · ${H(s.aggregation)} · ${H(s.unit)}</p><p>${H(s.filters.join('\n'))}</p></details>`).join('')}</div>
      <div class="panel"><h3>Проверки выгрузки</h3><ul class="diagnostics">${c.findings.map(f=>`<li><b>${H(f.sheet)}:</b> ${H(f.message)}${f.count!=null?` · ${fmt(f.count)}`:''}${f.labels?` · ${H(f.labels.join(', '))}`:''}</li>`).join('')}</ul></div>`;
  }
  function renderPlans() {
    const allCities=cities(), ms=periods(), selected=filters.city || allCities[0] || '';
    const relevant=plans.filter(p=>!filters.city||M.key(p.city)===M.key(filters.city)).map(p=>M.planProgress(p,data));
    const rows=relevant.map(p=>[p.city,p.month,p.metric.toUpperCase(),p.method==='new'?'NEW':'Исходный свод',pct(p.targetPct),pct(p.actual),pct(p.attainment),fmt(p.gapCount,0),p.updatedAt.slice(0,10)]);
    exports.plans=[['Город','Месяц','Продукт','Методика','План','Факт','Выполнение','Не хватает операций','Обновлён'],...rows];
    document.getElementById('plansDetails').innerHTML=`<div class="panel"><h3>Планы городов</h3><p>Планы задаются отдельно для месяца, продукта и методики. «Не хватает операций» рассчитывается при текущем знаменателе. Общих планов и утверждённых порогов в ТЗ нет — значения вводит пользователь.</p>
      ${apiError?`<p class="callout">${H(apiError)}</p>`:''}<form id="planForm" class="details-controls"><div class="field"><label>Город<select name="city" required>${options(allCities,selected)}</select></label></div><div class="field"><label>Месяц<input name="month" type="month" required value="${H(month || ms.at(-1) || '')}"></label></div>
      <div class="field"><label>Продукт<select name="metric"><option value="er">ЭР</option><option value="akk">АКК</option></select></label></div><div class="field"><label>Методика<select name="method"><option value="summary">Исходный свод</option><option value="new">NEW</option></select></label></div>
      <div class="field"><label>План, %<input name="targetPct" type="number" min="0" max="100" step="0.1" required placeholder="Например, 60"></label></div><button class="reset" type="submit">Сохранить план</button></form><p id="planMessage" role="status"></p>
      ${table(exports.plans[0],rows)}<button class="reset" data-insight-export="plans">Скачать CSV</button>
      <details><summary>Удалить план</summary><select id="deletePlanId">${relevant.map(p=>`<option value="${H(p.id)}">${H(p.city)} · ${H(p.month)} · ${H(p.metric)} · ${H(p.method)}</option>`).join('')}</select><button class="reset" id="deletePlan">Удалить выбранный план</button></details></div>
      <div class="panel"><h3>Что нужно для персональных планов</h3><p>Для РОП → МОП → риелтор → клиент нужны стабильные ID сотрудника, руководителей, сделки и клиента, даты событий, признак сделки с наличными и продукт. В месячной выгрузке этих полей нет. Сопоставление клиентов по одному ФИО не используется.</p></div>`;
  }
  function renderQuality() {
    const ms=periods(), notices=[...(data.refreshWarnings || []),...(data.storageWarnings || [])];
    const findings=M.quality(data).filter(f=>(!qualityMonth || f.month===qualityMonth || ['coverage','freshness'].includes(f.code))&&(!filters.city||f.city==='Вся выгрузка'||M.key(f.city)===M.key(filters.city)));
    const rows=findings.map(f=>[f.city,f.kind,f.month,f.message]);exports.quality=[['Город','Показатель','Месяц','Сигнал'],...rows];
    document.getElementById('qualityDetails').innerHTML=`<div class="panel"><h3>Отклонения и полнота</h3><p>Автоматические сигналы для проверки: выше 100%; изменение ≥20 п.п. при базе ≥20; три последовательных нулевых месяца при положительной базе; падение операций ЭР/АКК Космос ≥20% и ≥5 при прошлом объёме ≥20; дата источника старше двух дней; отсутствующие завершённые месяцы. Это диагностические правила, не утверждённые оценки работы сотрудника.</p>
      ${apiError?`<p class="callout">${H(apiError)}</p>`:''}${notices.map(x=>`<p class="callout">${H(x)}</p>`).join('')}<label>Месяц <select id="qualityMonth"><option value="">Вся история</option>${options(ms,qualityMonth)}</select></label>
      <p>Сигналов по выборке: ${findings.length}. Текущий неполный месяц исключён из сигналов скачков и серий нулей.</p>${table(exports.quality[0],rows.slice(0,250))}${rows.length>250?'<p>На экране первые 250 строк, CSV содержит все.</p>':''}<button class="reset" data-insight-export="quality">Скачать сигналы CSV</button>
      <p>Рассылка ответственному не настроена. Для автоматической доставки нужен согласованный канал и доступ к нему.</p></div>
      <div class="panel"><h3>История срезов</h3><p>После загрузки сохраняются версии завершённых месяцев за последние 36 месяцев. Дата фиксации указана явно: поздняя загрузка не выдаётся за срез, сделанный в последний день месяца. Одинаковые данные повторно не архивируются. Архивы требуют постоянного диска на хостинге.</p>
      ${history.length?table(['Месяц','Зафиксирован','Записей Карты','Источников Космос'],history.slice(0,36).map(s=>[s.month,new Date(s.capturedAt).toLocaleString('ru-RU'),s.mapRows,s.cosmosSources])):'<p>Срезов пока нет. Они появятся после успешной загрузки данных.</p>'}
      ${history.length?`<label>Скачать срез <select id="snapshotId">${history.map(s=>`<option value="${H(s.id)}">${H(s.month)} · ${H(s.capturedAt)}</option>`).join('')}</select></label><button class="reset" id="downloadSnapshot">Скачать JSON</button>`:''}</div>`;
  }
  function render(f=filters) {filters=f;cosmos();renderPlans();renderQuality();}
  async function refreshOperations() {
    const results=await Promise.allSettled([fetch('/api/plans').then(async r=>{if(!r.ok)throw Error('Планы недоступны');return r.json();}),fetch('/api/snapshots').then(async r=>{if(!r.ok)throw Error('История недоступна');return r.json();})]);
    if(results[0].status==='fulfilled'&&Array.isArray(results[0].value)) plans=results[0].value;
    if(results[1].status==='fulfilled'&&Array.isArray(results[1].value)) history=results[1].value;
    apiError=results.filter(r=>r.status==='rejected').map(r=>r.reason.message).join('. ');render(filters);
  }
  function update(d,f={}) {data=d;filters=f;const ms=periods();if(!month||!ms.includes(month)){
    const common=['cash','er','akk'].map(k=>data.cosmos?.sheets[k]?.months).filter(Boolean);
    month=common.length?common[0].filter(m=>common.every(a=>a.includes(m))).at(-1):data.monthKeys?.at(-1);
    month=month||ms.at(-1)||'';qualityMonth=month;
  }render(f);refreshOperations();}
  function download(name,text,type) {const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  document.addEventListener('change',e=>{if(e.target.id==='cosmosMonth'){month=e.target.value;cosmos();}if(e.target.id==='qualityMonth'){qualityMonth=e.target.value;renderQuality();}});
  document.addEventListener('submit',async e=>{
    if(e.target.id!=='planForm')return;e.preventDefault();const v=Object.fromEntries(new FormData(e.target));v.targetPct=Number(v.targetPct);
    const button=e.target.querySelector('button');button.disabled=true;
    try{const r=await fetch('/api/plans',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(v)}),j=await r.json();if(!r.ok)throw Error(j.message||'Не удалось сохранить');plans=j;apiError='';renderPlans();document.getElementById('planMessage').textContent='План сохранён.';global.dispatchEvent(new Event('bi2-plans-changed'));}
    catch(err){document.getElementById('planMessage').textContent=err.message;button.disabled=false;}
  });
  document.addEventListener('click',async e=>{
    const b=e.target.closest('[data-insight-export]');if(b){const rows=exports[b.dataset.insightExport];if(!rows)return;const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';download(`BI2-${b.dataset.insightExport}-${month}.csv`,'\ufeff'+rows.map(r=>r.map(cell).join(';')).join('\r\n'),'text/csv;charset=utf-8');}
    if(e.target.id==='deletePlan') {const id=document.getElementById('deletePlanId').value;if(!id)return;try{const r=await fetch('/api/plans/'+encodeURIComponent(id),{method:'DELETE'});if(!r.ok)throw Error('Удаление не удалось');plans=await r.json();renderPlans();}catch(err){document.getElementById('planMessage').textContent=err.message;}}
    if(e.target.id==='downloadSnapshot'){const id=document.getElementById('snapshotId').value;try{const r=await fetch('/api/snapshots/'+encodeURIComponent(id));if(!r.ok)throw Error('Срез недоступен');download(`BI2-snapshot-${id}.json`,JSON.stringify(await r.json(),null,2),'application/json');}catch(err){apiError=err.message;renderPlans();}}
  });
  global.BI2Operations={update,render,getPlans:()=>plans};
})(globalThis);
