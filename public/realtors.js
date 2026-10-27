import {PRODUCT_CODES,parseRealtorCsv,aggregateRealtors,periodsFromRows,hierarchyByOrganisation} from './realtor-model.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(v||0);
const rub=v=>num(v)+' ₽';
const pct=v=>v==null?'—':num(v)+'%';
const TEMPLATE='deal_id;employee_id;employee_name;deal_date;eligible_cash;product;commission;commission_id;city;partner;senior_partner;rop;mop;spn;tenure_months;client_id\r\n';
let mounted=false,rows=[],status='',page=0;
let filter={period:'all',city:'',rop:'',mop:'',search:'',sort:'penetration',products:new Set(PRODUCT_CODES)};
const targets=new Map(),E=id=>document.getElementById(id);
function setup(root){
  root.innerHTML=[
    '<div class="workspace-intro"><div><span class="workspace-eyebrow">02 / Сотрудники</span><h2>Светофор риелторов</h2><p>Рейтинг по ЭР, АКК и НС — уникальные сделки, рекорды комиссий и индивидуальные планы.</p></div>',
    '<a class="workspace-source" href="https://docs.google.com/document/d/1yQlVdJuMKvRsxfkYh9VZrvpSheFHK6pbg4Pn_getSu0/edit" target="_blank" rel="noopener noreferrer">Техническое задание ↗</a></div>',
    '<div class="workspace-warning">В Карте онлайн нет подтверждённой связки сотрудник → сделка → услуга. Рейтинг работает с локально загруженной выгрузкой CSV из BI/CRM. Файл обрабатывается только браузером и не передаётся на сервер. Для сетевой версии нужны API источника и ролевые права.</div>',
    '<div class="rl-toolbar"><div><label class="workspace-primary" for="rlFile">Загрузить CSV</label><input id="rlFile" type="file" accept=".csv,text/csv" hidden><button class="workspace-ghost" type="button" id="rlTemplate">Скачать шаблон</button></div><span id="rlStatus">Источник сотрудников не подключен.</span></div>',
    '<div class="rl-filterbar"><label>Период<select id="rlPeriod"><option value="all">Всё время</option></select></label><label>Город<select id="rlCity"><option value="">Все города</option></select></label><label>РОП<select id="rlRop"><option value="">Все РОП</option></select></label><label>МОП<select id="rlMop"><option value="">Все МОП</option></select></label><label>Поиск<input id="rlSearch" type="search" placeholder="ФИО, партнёр, старший партнёр"></label></div>',
    '<div class="rl-product-bar"><b>Продукты</b>',
    PRODUCT_CODES.map(p=>'<label class="rl-product"><input type="checkbox" value="'+p+'" checked><span>'+p+'</span></label>').join(''),
    '<span class="rl-soft">Совмещённые продукты в сделке не дублируют сделку</span></div>',
    '<div class="rl-kpis" id="rlKpis"></div><div class="rl-body"><aside class="rl-records"><h3>Рекорды компании</h3><p class="rl-soft">По выбранному периоду и продуктам</p><div id="rlRecords"></div></aside>',
    '<section class="rl-ranking"><div class="rl-ranking-head"><div><h3>Рейтинг сотрудников</h3><p>По уникальным подходящим сделкам с наличными.</p></div><label>Сортировка<select id="rlSort"><option value="penetration">Проникновение ↓</option><option value="fees">Комиссия ↓</option><option value="operations">Продукты ↓</option><option value="maxMonth">Рекорд месяца ↓</option><option value="name">ФИО А–Я</option></select></label></div>',
    '<div class="rl-table-wrap"><table class="rl-table"><thead><tr><th>№</th><th>Сотрудник / город</th><th>Стаж</th><th>Сделки с наличными</th><th>С доппродуктами</th><th>Проникновение</th><th>План, %</th><th>Комиссия</th><th>Рекорд месяца</th></tr></thead><tbody id="rlTableBody"></tbody></table></div>',
    '<div class="rl-pages"><span id="rlPageNote"></span><div><button id="rlPrev" class="workspace-ghost">Назад</button><button id="rlNext" class="workspace-ghost">Далее</button></div></div></section></div>',
    '<section class="rl-hierarchy"><h3>Город → РОП → МОП → СПН → клиент</h3><p class="rl-soft">Роли раскрываются. На уровне клиента отображается только количество связанных идентификаторов — без имён и персональных карточек до внедрения ролевого доступа.</p><div id="rlHierarchy"></div></section>',
    '<div class="workspace-footnote">Персональный план — сценарий в текущей вкладке, без сохранения и синхронизации. Для финансовой сверки необходимы уникальные ID начислений, для клиентской детализации — CRM ID и авторизация.</div>'
  ].join('');
}
function choose(k){return [...new Set(rows.map(r=>r[k]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));}
function opts(list,all){return '<option value="">'+esc(all)+'</option>'+list.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');}
function record(label,r,value,namer) {
  return '<div class="rl-record"><span>'+esc(label)+'</span><strong>'+esc(r?value(r):'—')+'</strong><small>'+esc(r?namer(r):'Нет данных')+'</small></div>';
}
function tree(nodes,depth=0) {
  if(depth>3)return '';
  return nodes.slice(0,40).map(n=>{
    const info='<strong>'+esc(n.label)+'</strong><span>'+num(n.active)+' / '+num(n.eligible)+' · '+pct(n.penetration)+' · клиентов: '+num(n.clients)+'</span>';
    return n.children.length?'<details class="rl-tree-level"><summary>'+info+'</summary><div class="rl-nested">'+tree(n.children,depth+1)+'</div></details>':'<div class="rl-hierarchy-leaf">'+info+'</div>';
  }).join('')+(nodes.length>40?'<div class="rl-soft">Показаны первые 40 групп; уточните фильтры.</div>':'');
}
function render(){
  const report=aggregateRealtors(rows,{...filter,products:[...filter.products]});
  const list=[...report.list];
  if(filter.sort==='name')list.sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  else list.sort((a,b)=>(b[filter.sort]??-Infinity)-(a[filter.sort]??-Infinity)||a.name.localeCompare(b.name,'ru'));
  E('rlStatus').textContent=status||'Источник сотрудников не подключен.';
  const k=report.coverage;
  E('rlKpis').innerHTML=[
    ['Сотрудников',num(k.employees),'В выборке'],['Сделок с наличными',num(k.eligible),'Уникальных'],
    ['С доппродуктами',num(k.active),'Уникальных'],['Проникновение',pct(k.penetration),'По общей базе'],
    ['Сумма комиссий',rub(k.totalCommission),'По выбранным продуктам']
  ].map(x=>'<div class="rl-kpi"><span>'+x[0]+'</span><b>'+x[1]+'</b><small>'+x[2]+'</small></div>').join('');
  const r=report.records,person=x=>report.byId.get(x.id)?.name||x.id;
  E('rlRecords').innerHTML=
    record('Максимальная общая комиссия',r.total,x=>rub(x.fees),x=>x.name)+
    record('Больше всего ЭР',r.er,x=>num(x.productCounts['ЭР']),x=>x.name)+
    record('Самая большая КВ по НС за сделку',r.nsDeal,x=>rub(x.fee),person)+
    record('Комиссии НС + АКК',r.nsAkk,x=>rub(x.fees),person)+
    record('Рекорд комиссии за месяц',r.maxMonth,x=>rub(x.maxMonth),x=>x.name);
  const sz=15;page=Math.min(page,Math.max(0,Math.ceil(list.length/sz)-1));
  E('rlTableBody').innerHTML=list.slice(page*sz,(page+1)*sz).map((x,i)=>{
    const key=x.id+'|'+filter.period,goal=targets.get(key)||'';
    const progress=goal>0&&x.penetration!=null?num(x.penetration/goal*100)+'% плана':'';
    return '<tr><td>'+(i+1+page*sz)+'</td><td><b>'+esc(x.name)+'</b><div class="rl-soft">'+esc(x.city||'—')+' · '+esc(x.partner||'—')+'</div></td>'+
      '<td>'+(x.tenure==null?'—':num(x.tenure)+' мес.')+'</td><td>'+num(x.eligible)+'</td><td>'+num(x.active)+' <small>('+num(x.operations)+' прод.)</small></td>'+
      '<td><strong>'+pct(x.penetration)+'</strong></td><td><div class="rl-target"><input type="number" min="1" max="100" step="1" placeholder="—" data-plan="'+esc(x.id)+'" value="'+esc(goal)+'" aria-label="Целевой процент"><span>'+esc(progress)+'</span></div></td>'+
      '<td>'+rub(x.fees)+'</td><td>'+rub(x.maxMonth)+'</td></tr>';
  }).join('')||'<tr><td colspan="9" class="rl-empty">Нет данных — загрузите CSV или измените фильтры.</td></tr>';
  E('rlPageNote').textContent=list.length?'Показано '+(page*sz+1)+'–'+Math.min((page+1)*sz,list.length)+' из '+list.length:'Нет сотрудников';
  E('rlPrev').disabled=page===0;E('rlNext').disabled=(page+1)*sz>=list.length;
  E('rlHierarchy').innerHTML=tree(hierarchyByOrganisation(rows,{...filter,products:[...filter.products]}))||'<div class="rl-empty">Нет данных по оргструктуре.</div>';
}
function csvTemplate() {
  const u=URL.createObjectURL(new Blob(['\ufeff'+TEMPLATE],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=u;a.download='BI2-реестр-светофора.csv';a.click();
  setTimeout(()=>URL.revokeObjectURL(u),300);
}
function bind(){
  E('rlTemplate').addEventListener('click',csvTemplate);
  E('rlFile').addEventListener('change',async evt=>{
    const f=evt.target.files?.[0];if(!f)return;
    try {
      if(f.size>12*1024*1024)throw Error('Файл больше 12 МБ; нужна защищённая серверная загрузка');
      const out=parseRealtorCsv(await f.text());
      if(out.rows.length>150000)throw Error('Лимит локального прототипа: 150 000 строк');
      rows=out.rows;page=0;filter={...filter,period:'all',city:'',rop:'',mop:'',search:''};
      status='Загружено '+num(rows.length)+' из '+num(out.sourceCount)+' строк; отклонено '+num(out.rejectedCount)+
        (out.rejectedCount?' (например: '+out.rejectedLines.slice(0,8).join(', ')+')':'')+'. Данные остались в браузере.';
      E('rlPeriod').innerHTML=periodsFromRows(rows).map(p=>'<option value="'+esc(p)+'">'+(p==='all'?'Всё время':p.length===4?p+' год':new Date(p+'-01T12:00:00').toLocaleDateString('ru-RU',{month:'long',year:'numeric'}))+'</option>').join('');
      E('rlCity').innerHTML=opts(choose('city'),'Все города');E('rlRop').innerHTML=opts(choose('rop'),'Все РОП');E('rlMop').innerHTML=opts(choose('mop'),'Все МОП');
      for(const id of ['rlSearch','rlCity','rlRop','rlMop'])E(id).value='';
      E('rlPeriod').value='all';
    }catch(err){status='Ошибка импорта: '+err.message;}
    evt.target.value='';render();
  });
  for(const [id,key] of [['rlPeriod','period'],['rlCity','city'],['rlRop','rop'],['rlMop','mop'],['rlSearch','search'],['rlSort','sort']])
    E(id).addEventListener(id==='rlSearch'?'input':'change',e=>{filter[key]=e.target.value;page=0;render();});
  E('rlPrev').addEventListener('click',()=>{page=Math.max(0,page-1);render();});
  E('rlNext').addEventListener('click',()=>{page++;render();});
  document.querySelectorAll('.rl-product input').forEach(input=>input.addEventListener('change',()=>{
    filter.products=new Set([...document.querySelectorAll('.rl-product input:checked')].map(e=>e.value));page=0;render();
  }));
  E('rlTableBody').addEventListener('change',e=>{
    const id=e.target.dataset.plan;if(!id)return;
    const val=Number(e.target.value),key=id+'|'+filter.period;
    if(e.target.value&&Number.isFinite(val)&&val>=1&&val<=100)targets.set(key,val);
    else targets.delete(key);
    render();
  });
}
export function mountRealtors(root){if(mounted)return;mounted=true;setup(root);bind();render();}
