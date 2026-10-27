/* BI2 Светофор: чистые расчёты. Клиентские записи обрабатываются только в памяти браузера. */
export const PRODUCT_CODES = ['ЭР', 'АКК', 'НС'];
const ALIASES = {
  dealId: ['deal_id','id сделки','id_сделки','сделка id'],
  employeeId: ['employee_id','id сотрудника','id риелтора','табельный номер'],
  name: ['employee_name','фио сотрудника','фио риелтора','фио'],
  date: ['deal_date','дата сделки','финансовая дата'],
  product: ['product','продукт','тип услуги'],
  cash: ['eligible_cash','сделка с наличными','с наличными','подходящая сделка'],
  city: ['city','город'],
  partner: ['partner','партнёр'],
  seniorPartner: ['senior_partner','старший партнёр'],
  rop: ['rop','роп'],
  mop: ['mop','моп'],
  spn: ['spn','спн'],
  tenure: ['tenure_months','стаж мес','стаж месяцев'],
  client: ['client_id','id клиента'],
  commission: ['commission','комиссия','вознаграждение'],
  commissionId: ['commission_id','id начисления']
};
const canon = s => String(s ?? '').trim().toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').replace(/[-_]/g,' ');
export function readCsv(csv) {
  const text = String(csv || '').replace(/^\uFEFF/,'');
  if (!text.trim()) throw Error('Файл пустой');
  const first = text.split(/\r?\n/).find(x=>x.trim()) || '';
  const countSep = sep => {let q=false,n=0;for(let i=0;i<first.length;i++){if(first[i]==='"')q=!q;else if(first[i]===sep&&!q)n++;}return n;};
  const separator = countSep(';') >= countSep(',') ? ';' : ',';
  const out=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(c===separator&&!quoted){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quoted){
      if(c==='\r'&&text[i+1]==='\n')i++;
      row.push(cell);if(row.some(x=>String(x).trim()))out.push(row);row=[];cell='';
    }else cell+=c;
  }
  if(quoted)throw Error('Некорректная CSV: незакрытые кавычки');
  row.push(cell);if(row.some(x=>String(x).trim()))out.push(row);
  return out;
}
function dateISO(value) {
  const s=String(value??'').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
  const m=s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if(m)return m[3]+'-'+m[2]+'-'+m[1];
  return '';
}
function number(value) {
  if(typeof value==='number')return value;
  const n=Number(String(value??'').replace(/[ \u00a0\u202f₽%]/g,'').replace(',','.'));
  return Number.isFinite(n)?n:NaN;
}
function yn(v) {
  const s=canon(v);
  if(['1','да','true','yes','y'].includes(s))return true;
  if(['0','нет','false','no','n'].includes(s))return false;
  return null;
}
function product(v) {
  const s=canon(v).replace(/\./g,'');
  if(!s)return '';
  if(['эр','er','электронная регистрация'].includes(s))return 'ЭР';
  if(['акк','akk','аккредитив','аккредитивы'].includes(s))return 'АКК';
  if(['нс','ns','номинальный счет','номинальный счёт'].includes(s))return 'НС';
  return null;
}
export function parseRealtorCsv(csv) {
  const cells=readCsv(csv);
  if(cells.length<2)throw Error('Нужны заголовок и хотя бы одна строка');
  const headers=cells[0].map(canon);
  const positions={};
  for(const [key,names] of Object.entries(ALIASES)) {
    positions[key]=headers.findIndex(h=>names.some(n=>canon(n)===h));
  }
  const missing=['dealId','employeeId','name','date','product','cash'].filter(k=>positions[k]<0);
  if(missing.length)throw Error('Не хватает столбцов: '+missing.map(k=>ALIASES[k][0]).join(', '));
  const value=(row,key)=>positions[key]<0?'':String(row[positions[key]]??'').trim();
  const rows=[],bad=[];
  for(let index=1;index<cells.length;index++){
    const cellsRow=cells[index],line=index+1;
    const dealId=value(cellsRow,'dealId'),employeeId=value(cellsRow,'employeeId');
    const name=value(cellsRow,'name'),date=dateISO(value(cellsRow,'date'));
    const cash=yn(value(cellsRow,'cash')),p=product(value(cellsRow,'product'));
    const fee=value(cellsRow,'commission')?number(value(cellsRow,'commission')):0;
    const tenure=value(cellsRow,'tenure')?number(value(cellsRow,'tenure')):null;
    if(!dealId||!employeeId||!name||!date||cash===null||p===null||!Number.isFinite(fee)||tenure!==null&&(!Number.isFinite(tenure)||tenure<0)){bad.push(line);continue;}
    rows.push({
      dealId, employeeId, name, date, cash, product:p, fee, tenure,
      city:value(cellsRow,'city'), partner:value(cellsRow,'partner'),
      seniorPartner:value(cellsRow,'seniorPartner'), rop:value(cellsRow,'rop'),
      mop:value(cellsRow,'mop'), spn:value(cellsRow,'spn'),
      clientId:value(cellsRow,'client'), commissionId:value(cellsRow,'commissionId')
    });
  }
  if(!rows.length)throw Error('Нет корректных строк; проверьте ID, даты, продукт и признак наличных');
  return {rows,rejectedLines:bad.slice(0,30),rejectedCount:bad.length,sourceCount:cells.length-1};
}
export function periodsFromRows(rows) {
  const d=new Set(['all']);
  for(const r of rows){d.add(r.date.slice(0,4));d.add(r.date.slice(0,7));}
  return [...d].sort((a,b)=>a==='all'?-1:b==='all'?1:b.localeCompare(a));
}
export function filterRows(rows, filters={}) {
  const q=canon(filters.search);
  return rows.filter(r=>
    (!filters.period||filters.period==='all'||r.date.startsWith(filters.period)) &&
    (!filters.city||r.city===filters.city) &&
    (!filters.rop||r.rop===filters.rop) &&
    (!filters.mop||r.mop===filters.mop) &&
    (!q||[r.name,r.employeeId,r.partner,r.seniorPartner].some(t=>canon(t).includes(q)))
  );
}
export function aggregateRealtors(rows,filters={}) {
  const chosen=new Set(filters.products || PRODUCT_CODES);
  const grouped=new Map();
  const scope=filterRows(rows,filters);
  for(const r of scope) {
    if(!grouped.has(r.employeeId))grouped.set(r.employeeId,{
      id:r.employeeId,name:r.name,city:r.city,partner:r.partner,seniorPartner:r.seniorPartner,
      rop:r.rop,mop:r.mop,spn:r.spn,tenure:r.tenure,
      eligible:new Set(),active:new Set(),serviceKeys:new Set(),fees:0,
      feeIds:new Set(),monthly:new Map(),deals:new Map(), productCounts:{'ЭР':0,'АКК':0,'НС':0}
    });
    const g=grouped.get(r.employeeId);
    if(r.cash)g.eligible.add(r.dealId);
    if(!r.product||!chosen.has(r.product))continue;
    if(r.cash)g.active.add(r.dealId);
    const itemKey=r.product+'|'+r.dealId;
    if(!g.serviceKeys.has(itemKey)){g.serviceKeys.add(itemKey);g.productCounts[r.product]++;}
    const feeKey=r.commissionId?'id:'+r.commissionId:null;
    if(feeKey&&g.feeIds.has(feeKey))continue;
    if(feeKey)g.feeIds.add(feeKey);
    g.fees+=r.fee;
    const month=r.date.slice(0,7);
    g.monthly.set(month,(g.monthly.get(month)||0)+r.fee);
    g.deals.set(r.dealId,(g.deals.get(r.dealId)||0)+r.fee);
  }
  const list=[...grouped.values()].map(g=>{
    const eligible=g.eligible.size,active=g.active.size;
    return {
      id:g.id,name:g.name,city:g.city,partner:g.partner,seniorPartner:g.seniorPartner,
      rop:g.rop,mop:g.mop,spn:g.spn,tenure:g.tenure, eligible, active,
      penetration:eligible?active/eligible*100:null,
      operations:g.serviceKeys.size,productCounts:g.productCounts,
      fees:g.fees, maxMonth:g.monthly.size?Math.max(...g.monthly.values()):0,
      maxDeal:g.deals.size?Math.max(...g.deals.values()):0
    };
  });
  const byId=new Map(list.map(x=>[x.id,x]));
  const scopedProductRows=scope.filter(r=>r.product&&chosen.has(r.product));
  const eligible=new Set(scope.filter(r=>r.cash).map(r=>r.employeeId+'|'+r.dealId));
  const active=new Set(scopedProductRows.filter(r=>r.cash).map(r=>r.employeeId+'|'+r.dealId));
  const totalCommission=list.reduce((a,v)=>a+v.fees,0);
  list.sort((a,b)=>b.penetration-a.penetration||b.fees-a.fees||a.name.localeCompare(b.name,'ru'));
  const biggest=(set,selector)=>set.length?set.reduce((a,b)=>selector(b)>selector(a)?b:a):null;
  const productLeader=p=>biggest(list,x=>x.productCounts[p]);
  const dealCommissionFor=(codes)=>{
    const sums=new Map();
    for(const r of scope){
      if(!codes.has(r.product))continue;
      const key=r.employeeId+'|'+r.dealId;
      sums.set(key,(sums.get(key)||0)+r.fee);
    }
    return biggest([...sums].map(([key,fee])=>({id:key.split('|')[0],fee})),x=>x.fee);
  };
  return {
    list,byId,coverage:{employees:list.length,eligible:eligible.size,active:active.size,
      penetration:eligible.size?active.size/eligible.size*100:null,totalCommission},
    records:{
      total:biggest(list,x=>x.fees),
      er:chosen.has('ЭР')?productLeader('ЭР'):null,
      maxDeal:biggest(list,x=>x.maxDeal),
      maxMonth:biggest(list,x=>x.maxMonth),
      nsDeal:chosen.has('НС')?dealCommissionFor(new Set(['НС'])):null,
      nsAkk:chosen.has('НС')&&chosen.has('АКК')?biggest(
        aggregateRealtorsCore(scope,new Set(['НС','АКК'])),x=>x.fees
      ):null
    }
  };
}
function aggregateRealtorsCore(rows,chosen) {
  const fees=new Map();
  for(const r of rows){if(!chosen.has(r.product))continue;fees.set(r.employeeId,(fees.get(r.employeeId)||0)+r.fee);}
  return [...fees].map(([id,fee])=>({id,fees:fee}));
}
export function hierarchyByOrganisation(rows,filters={}) {
  const selected=new Set(filters.products||PRODUCT_CODES);
  const root=[];
  const keys=[['city','Город'],['rop','РОП'],['mop','МОП'],['spn','СПН']];
  const getOrCreate=(group,label)=>{let found=group.find(x=>x.label===label);if(!found){found={label,children:[],eligible:new Set(),active:new Set(),clients:new Set()};group.push(found);}return found;};
  for(const r of filterRows(rows,filters)){
    let group=root;
    for(const [field] of keys){
      const val=r[field]||'Не назначен';
      const node=getOrCreate(group,val);
      const dealKey=r.employeeId+'|'+r.dealId;
      if(r.cash)node.eligible.add(dealKey);
      if(r.cash&&selected.has(r.product))node.active.add(dealKey);
      if(r.clientId)node.clients.add(r.clientId);
      group=node.children;
    }
  }
  const finalize=nodes=>nodes.map(n=>({
    label:n.label,eligible:n.eligible.size,active:n.active.size,clients:n.clients.size,
    penetration:n.eligible.size?n.active.size/n.eligible.size*100:null,
    children:finalize(n.children)
  })).sort((a,b)=>a.label.localeCompare(b.label,'ru'));
  return finalize(root);
}
