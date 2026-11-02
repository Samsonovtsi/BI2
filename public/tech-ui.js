// New read-only panels powered exclusively by "Карта внедрения по городам техлист".
// Do not alter legacy BI2 reports or realtor traffic light.
const SOURCE='https://docs.google.com/spreadsheets/d/1lJbEfg6IVThe9vXDYAueJRfztzOvq13oxMw9ttek3M0/edit';
const BANKS=['ДомРФ','Т-Банк','Сбер','ВТБ','Совкомбанк','Альфа НС','ДомКлик'];
const num=n=>n==null?'—':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(n);
const rub=n=>n==null?'—':num(n)+' ₽';
const pct=n=>n==null?'—':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(n)+'%';
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let result=null,loader=null;
let mapMounted=false,calcMounted=false;
const getData=async()=>{
  if(result)return result;
  if(loader)return loader;
  loader=fetch('/api/tech/data',{cache:'no-store'}).then(async response=>{
    const data=await response.json();
    if(!response.ok)throw Error(data.message||'HTTP '+response.status);
    result=data;return data;
  }).finally(()=>loader=null);
  return loader;
};
const block=(label,value,note)=>'<div class="rl-kpi"><span>'+esc(label)+'</span><b>'+esc(value)+'</b><small>'+esc(note||'')+'</small></div>';
function summary(rows) {
  // Sum only when all requested city-month rows have a known denominator/metric.
  const sum=key=>rows.length&&rows.every(r=>r[key]!=null)?rows.reduce((s,r)=>s+r[key],0):null;
  const cash=sum('cash'),er=sum('er'),akk=sum('akk'),actual=sum('commission'),operations=sum('operations');
  return {cash,er,akk,actual,operations,erPct:cash>0&&er!=null?er/cash*100:null,
    akkPct:cash>0&&akk!=null?akk/cash*100:null,avg:operations>0&&actual!=null?actual/operations:null};
}
const plot=(mount,months,city,metric,rows)=>{
  const selected=rows.filter(r=>r.city===city),pairs=months.map(m=>{
    const items=rows.filter(r=>r.month===m&&r.cash>=20&&r[metric]!=null);
    const ratios=items.map(r=>r[metric]/r.cash*100);
    const chosen=selected.find(r=>r.month===m);
    return {m,best:ratios.length?Math.max(...ratios):null,worst:ratios.length?Math.min(...ratios):null,
      current:chosen?.cash>0&&chosen[metric]!=null?chosen[metric]/chosen.cash*100:null};
  });
  if(!city){mount.innerHTML='<div class="rl-empty">Выберите город для красной линии. Лучший и худший показатели считаются среди городов с базой от 20 сделок.</div>';return;}
  const valid=pairs.flatMap(o=>[o.best,o.worst,o.current]).filter(x=>x!=null);
  if(!valid.length){mount.textContent='Нет сопоставимых данных за период';return;}
  const max=Math.max(100,...valid)*1.1,W=760,H=240,pad=36;
  const x=i=>pad+(W-2*pad)*(months.length<2?0.5:i/(months.length-1));
  const y=v=>H-pad-(H-2*pad)*v/max;
  const points=field=>pairs.map((p,i)=>p[field]===null?null:[x(i),y(p[field])]);
  const path=field=>{let d='',open=false;for(const p of points(field)){if(p){d+=(open?' L':' M')+p[0].toFixed(1)+' '+p[1].toFixed(1);open=true;}else open=false;}return d;};
  // Build closed islands only where both extrema have known values.
  const chunks=[];let start=-1;
  for(let i=0;i<=pairs.length;i++){
    const ok=i<pairs.length&&pairs[i].best!==null&&pairs[i].worst!==null;
    if(ok&&start<0)start=i;
    if(!ok&&start>=0){
      const inds=Array.from({length:i-start},(_,n)=>start+n);
      const coords=inds.map(j=>x(j)+','+y(pairs[j].best)).concat(inds.reverse().map(j=>x(j)+','+y(pairs[j].worst)));
      chunks.push('<polygon points="'+coords.join(' ')+'" fill="#adb4af" opacity=".28"/>');start=-1;
    }
  }
  const last=pairs.length-1;
  mount.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Линия города и диапазон лучшей и худшей практики" style="width:100%;max-height:280px">'+
    [0,25,50,75,100].map(v=>'<line x1="'+pad+'" x2="'+(W-pad)+'" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#edf0ed"/><text x="4" y="'+(y(v)+4)+'" font-size="11" fill="#76867c">'+v+'%</text>').join('')+
    chunks.join('')+
    '<path d="'+path('best')+'" fill="none" stroke="#8d9690" stroke-width="1.5" stroke-dasharray="5 4"/>'+
    '<path d="'+path('worst')+'" fill="none" stroke="#a3aaa5" stroke-width="1.5" stroke-dasharray="5 4"/>'+
    '<path d="'+path('current')+'" fill="none" stroke="#b74945" stroke-width="3"/>'+
    months.map((m,i)=>i%Math.max(1,Math.ceil(months.length/8))===0||i===last?
      '<text x="'+x(i)+'" y="'+(H-9)+'" fill="#738375" text-anchor="middle" font-size="10">'+esc(m.slice(2))+'</text>':'').join('')+
    '</svg><p class="rl-soft">Серое поле — диапазон лучших и худших городов по каждому месяцу при базе не менее 20 сделок; красная линия — выбранный город. Периоды комиссий банка и сделки с наличными отличаются.</p>';
};
function mapHTML(root){
  root.innerHTML='<div class="workspace-intro"><div><span class="workspace-eyebrow">НОВЫЙ ИСТОЧНИК / ТЕХЛИСТ</span><h2>Карта внедрения ЭР и АКК</h2><p>Расчёты по исходным выгрузкам, без копирования старых сводных процентов.</p></div><a class="workspace-source" target="_blank" rel="noopener noreferrer" href="'+SOURCE+'">Открыть Google-источник ↗</a></div>'+
    '<div class="workspace-warning">База — уникальные наличные сделки по месяцу закрытия; ЭР — по дате регистрации; банки — по месяцу комиссии. Проценты показывают отношение разных операционных когорт, а не подтверждённую конверсию одной сделки. Даты и число сделок могут расходиться.</div>'+
    '<div class="rl-filterbar tech-filter"><label>Период<select id="tmMonth"></select></label><label>Город<select id="tmCity"></select></label><label>Банк<select id="tmBank"><option value="">Все АКК</option>'+BANKS.map(b=>'<option>'+esc(b)+'</option>').join('')+'</select></label><label>График<select id="tmMetric"><option value="er">ЭР / наличные</option><option value="akk">АКК / наличные</option></select></label></div>'+
    '<div id="tmStatus" class="rl-soft"></div><div id="tmKpis" class="rl-kpis"></div>'+
    '<div class="panel"><h3>Город vs лучшая / худшая практика</h3><div id="tmChart"></div></div>'+
    '<div class="panel"><h3>Города за выбранный месяц</h3><p class="rl-soft">Сортировка — по выбранному проникновению; неизвестные показатели не заменяются нулём.</p><div class="rl-table-wrap"><table class="rl-table"><thead><tr><th>Город</th><th>Наличные сделки</th><th>ЭР</th><th>ЭР / наличные</th><th>АКК</th><th>АКК / наличные</th><th>Выбранный банк</th><th>Медиана чека</th><th>Средняя комиссия банка</th></tr></thead><tbody id="tmRows"></tbody></table></div><div id="tmCount" class="rl-soft"></div></div>'+
    '<div class="workspace-footnote" id="tmDiag">Вычисления не загружены.</div>';
}
function renderMap(data){
  const q=id=>document.getElementById(id).value;
  const m=q('tmMonth'),city=q('tmCity'),bank=q('tmBank'),metric=q('tmMetric');
  const byMonth=data.rows.filter(r=>r.month===m);
  const filtered=city?byMonth.filter(r=>r.city===city):byMonth;
  const totals=summary(filtered);
  const bankCount=bank?filtered.every(r=>r.banks[bank]!=null)?filtered.reduce((s,r)=>s+r.banks[bank],0):null:null;
  const bankPct=bank&&totals.cash>0&&bankCount!=null?bankCount/totals.cash*100:null;
  document.getElementById('tmKpis').innerHTML=[
    block('Наличные сделки',num(totals.cash),'Уникальные объекты'),
    block('ЭР',num(totals.er),pct(totals.erPct)+' к наличным'),
    block('Аккредитивы',num(totals.akk),pct(totals.akkPct)+' к наличным; без НС и ДомКлик'),
    block(bank||'Средняя комиссия',bank?num(bankCount):rub(totals.avg),bank?pct(bankPct)+' к наличным':'от банка / операция'),
    block('Комиссия от банка',rub(totals.actual),'Реестр услуг, дата оказания')
  ].join('');
  const active=byMonth.filter(r=>r.cash!==null||r.er!==null||r.akk!==null);
  const sorted=[...active].sort((a,b)=>{
    const key=metric==='er'?'erPenetration':'akkPenetration';
    return (b[key]??-Infinity)-(a[key]??-Infinity);
  });
  document.getElementById('tmRows').innerHTML=sorted.slice(0,150).map(r=>
    '<tr><td><b>'+esc(r.city)+'</b></td><td>'+num(r.cash)+'</td><td>'+num(r.er)+'</td><td>'+pct(r.erPenetration)+'</td><td>'+num(r.akk)+'</td><td>'+pct(r.akkPenetration)+'</td><td>'+ (bank?num(r.banks[bank]):'—')+'</td><td>'+rub(r.median)+'</td><td>'+rub(r.avgCommission)+'</td></tr>'
  ).join('')||'<tr><td colspan="9" class="rl-empty">По выбранному месяцу данных нет.</td></tr>';
  document.getElementById('tmCount').textContent='Показано '+Math.min(150,sorted.length)+' из '+sorted.length+' городов';
  const chartMonths=data.months.slice(-18);
  plot(document.getElementById('tmChart'),chartMonths,city,metric,data.rows);
}
export function mountTechMap(root) {
  if(mapMounted)return;mapMounted=true;mapHTML(root);
  const status=document.getElementById('tmStatus');status.textContent='Чтение исходной Google-таблицы…';
  getData().then(data=>{
    const months=data.months.filter(m=>m>='2025-01');
    document.getElementById('tmMonth').innerHTML=months.map(m=>'<option value="'+esc(m)+'">'+esc(m)+'</option>').join('');
    const lastUseful=months.filter(m=>data.rows.some(r=>r.month===m&&r.akk!==null&&r.cash>0));
    document.getElementById('tmMonth').value=lastUseful.at(-1)||months.at(-1);
    document.getElementById('tmCity').innerHTML='<option value="">Вся сеть</option>'+data.cities.map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('');
    const loaded=new Date(data.generatedAt).toLocaleString('ru-RU');
    status.textContent='Синхронизировано: '+loaded+(data.stale?' • показан предыдущий срез':'')+
      (data.refreshError?' • ошибка обновления: '+data.refreshError:'');
    document.getElementById('tmDiag').textContent='Строк базы с наличными: '+num(data.diagnostics.cashEntries)+
      '; банковских периодов: '+Object.keys(data.diagnostics.bankCoverage).length+
      '; строк реестра комиссий: '+num(data.diagnostics.registryRecords)+
      '; правил выплат: '+num(data.diagnostics.matrixRules)+
      '; строк удержаний ЦО: '+num(data.diagnostics.centralOfficeRules)+'. '+
      (data.warnings||[]).join(' ');
    for(const id of ['tmMonth','tmCity','tmBank','tmMetric'])document.getElementById(id).addEventListener('change',()=>renderMap(data));
    renderMap(data);
  }).catch(e=>{status.textContent='Невозможно загрузить техлист: '+e.message+
    '. Убедитесь, что у Timeweb есть право на чтение Google Sheets в формате CSV.';});
}
function calcHTML(root){
  root.innerHTML='<div class="workspace-intro"><div><span class="workspace-eyebrow">ИСХОДНЫЕ СТАВКИ / ТЕХЛИСТ</span><h2>Калькулятор правильного выбора АКК</h2><p>Фактическая матрица выплат и удержания ЦО из новой Google-таблицы.</p></div><a class="workspace-source" href="'+SOURCE+'" target="_blank" rel="noopener noreferrer">Матрица выплат ↗</a></div>'+
    '<div class="workspace-warning">Расчёт учитывает дату, сумму, срок, банк, город и долю ЦО. Показывается максимум из банков, для которых в источнике найдена однозначная подходящая тарифная строка. Операционная доступность конкретного банка и договорные ограничения не проверяются.</div>'+
    '<div class="catalog-params"><label>Город<select id="tcCity"></select></label><label>Дата сделки<input id="tcDate" type="date" value="2026-09-15"></label><label>Сумма АКК, ₽<input id="tcAmount" type="number" min="1" max="9999999999" value="5000000" step="10000"></label><label>Срок размещения, дней<input id="tcTerm" type="number" min="1" max="1000" value="5"></label><label>Фактически выбранный банк<select id="tcActual"><option value="">—</option>'+BANKS.map(b=>'<option>'+esc(b)+'</option>').join('')+'</select></label></div>'+
    '<div class="panel"><h3>Возможные выплаты по банкам</h3><div id="tcStatus" class="rl-soft"></div><div class="rl-table-wrap"><table class="rl-table"><thead><tr><th>Банк</th><th>КВ от банка</th><th>Удержание ЦО</th><th>КВ города</th><th>Строка матрицы</th></tr></thead><tbody id="tcRows"></tbody></table></div><div class="catalog-result" id="tcResult">Рассчитываем тарифы…</div></div>'+
    '<p class="workspace-footnote">Процентная ставка в источнике — доля (например, 0,08 означает 8% годовых), формула: сумма × срок × ставка / 365. Фиксированные КВ зависят от интервала суммы и дней. Пустые и неоднозначные тарифы не подставляются. Альфа НС — отдельный номинальный продукт.</p>';
}
export function mountTechCalculator(root){
  if(calcMounted)return;calcMounted=true;calcHTML(root);
  const status=document.getElementById('tcStatus');
  getData().then(data=>{
    document.getElementById('tcCity').innerHTML=data.cities.map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('');
    document.getElementById('tcCity').value=data.cities.includes('Тюмень')?'Тюмень':data.cities[0];
    const quote=async()=>{
      const params={date:document.getElementById('tcDate').value,
        city:document.getElementById('tcCity').value,
        sum:Number(document.getElementById('tcAmount').value),
        days:Number(document.getElementById('tcTerm').value)};
      const actual=document.getElementById('tcActual').value;
      if(!params.date||!params.city||params.sum<=0||params.days<=0){status.textContent='Заполните параметры сделки.';return;}
      const run=++quote.serial;status.textContent='Вычисляю подходящие тарифы…';
      try{
        const res=await fetch('/api/tech/quote',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify(params)});
        const payload=await res.json();if(!res.ok)throw Error(payload.message||'Ошибка расчёта');
        if(run!==quote.serial)return;
        const options=payload.options||[],best=options.find(x=>x.cityFee!==null);
        document.getElementById('tcRows').innerHTML=options.map(x=>
          '<tr><td><strong>'+esc(x.bank)+'</strong></td><td>'+rub(x.bankFee)+'</td><td>'+pct(x.coShare===null?null:x.coShare*100)+'</td><td>'+rub(x.cityFee)+'</td><td>#'+x.ruleRow+'</td></tr>').join('')||
          '<tr><td colspan="5" class="rl-empty">Не найдено ни одной однозначной тарифной строки.</td></tr>';
        const actualOption=options.find(x=>x.bank===actual),diff=best&&actualOption?.cityFee!=null?Math.max(0,best.cityFee-actualOption.cityFee):null;
        document.getElementById('tcResult').innerHTML=best?
          '<div><small>Лучший из рассчитанных</small><strong>'+esc(best.bank)+'</strong></div><div><small>Доход города</small><strong>'+rub(best.cityFee)+'</strong></div><div><small>Потенциал к выбранному банку</small><strong>'+rub(diff)+'</strong></div>':
          'Нет банка с рассчитанным доходом города. Проверьте тарифы, удержания ЦО и дату.';
        status.textContent='Подходящих тарифов: '+options.length+'. Источник: '+new Date(payload.generatedAt).toLocaleString('ru-RU');
      }catch(e){if(run===quote.serial){status.textContent='Ошибка: '+e.message;document.getElementById('tcResult').textContent='Расчёт недоступен';}}
    };
    quote.serial=0;
    for(const id of ['tcCity','tcDate','tcAmount','tcTerm','tcActual'])document.getElementById(id).addEventListener('change',quote);
    quote();
  }).catch(e=>{status.textContent='Источник недоступен: '+e.message;document.getElementById('tcResult').textContent='Невозможно определить ставки';});
}
