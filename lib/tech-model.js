// Public-source BI calculations. Pure functions, no credentials or personal client data.
export const SOURCE_ID='1lJbEfg6IVThe9vXDYAueJRfztzOvq13oxMw9ttek3M0';
export const BANKS=['ДомРФ','Т-Банк','Сбер','ВТБ','Совкомбанк','Альфа НС','ДомКлик'];
export const AKK_BANKS=['ДомРФ','Т-Банк','Сбер','ВТБ','Совкомбанк'];
const canon=s=>String(s??'').trim().replace(/\u00a0/g,' ').replace(/\s+/g,' ');
export function cityKey(s){
  const x=canon(s).toLocaleLowerCase('ru-RU').replace(/ё/g,'е');
  return /^c(?=[а-я])/u.test(x)?'с'+x.slice(1):x;
}
export function bankKey(s) {
  const k=canon(s).toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/[. \-]/g,'');
  if(k==='домрф'||k==='дом.рф')return 'ДомРФ';
  if(k==='тбанк'||k==='тинькофф')return 'Т-Банк';
  if(k==='сбер'||k==='сбербанк')return 'Сбер';
  if(k==='втб')return 'ВТБ';
  if(k==='совкомбанк')return 'Совкомбанк';
  if(k==='альфанс'||k==='альфабанкнс')return 'Альфа НС';
  if(k==='альфа'||k==='альфабанк')return 'Альфа НС';
  if(k==='домклик')return 'ДомКлик';
  return null;
}
export function amount(s){
  if(s==null||String(s).trim()==='')return null;
  if(typeof s==='number')return Number.isFinite(s)?s:null;
  const cleaned=String(s).replace(/[ \u00a0\u202f₽%]/g,'').replace(',','.');
  if(!/^-?\d+(?:\.\d+)?$/.test(cleaned))return null;
  const n=Number(cleaned);return Number.isFinite(n)?n:null;
}
export function month(s){
  const x=String(s??'').trim();const m=x.match(/^(\d{4})-(\d{2})/);
  if(m&&+m[2]>=1&&+m[2]<=12)return m[1]+'-'+m[2];
  const ru=x.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return ru&&+ru[2]>=1&&+ru[2]<=12?ru[3]+'-'+ru[2]:null;
}
export function isoDay(s) {
  const x=String(s??'').trim();
  const ru=x.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  const d=ru?ru[3]+'-'+ru[2]+'-'+ru[1]:x;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return null;
  const dt=new Date(d+'T00:00:00Z');
  return Number.isFinite(dt.getTime())&&dt.toISOString().slice(0,10)===d?d:null;
}
export function csvRows(text) {
  const s=String(text??'').replace(/^\uFEFF/,'');const result=[];
  let row=[],cell='',quote=false;
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(c==='"'){if(quote&&s[i+1]==='"'){cell+='"';i++;}else quote=!quote;}
    else if(c===','&&!quote){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quote){
      if(c==='\r'&&s[i+1]==='\n')i++;
      row.push(cell);if(row.some(x=>x.trim()))result.push(row);cell='';row=[];
    }else cell+=c;
  }
  if(quote)throw Error('Malformed CSV: unclosed quotation');
  row.push(cell);if(row.some(x=>x.trim()))result.push(row);
  return result;
}
const pair=(city,m)=>cityKey(city)+'|'+m;
export function parseMonthly(rows,kind) {
  const records=new Map();
  const counts={invalid:0,accepted:0,duplicates:0};
  // Cash/median: headers row 2, A=month, B=city, C=unique count or median.
  for(const r of rows.slice(2)){
    const m=month(r[0]),city=canon(r[1]),n=amount(r[2]);
    if(!m||!city||n===null){counts.invalid++;continue;}
    const key=pair(city,m);
    if(records.has(key)){counts.duplicates++;continue;} // no invented aggregation for duplicates
    if(kind==='cash'&&(!Number.isInteger(n)||n<0)){counts.invalid++;continue;}
    records.set(key,{city,month:m,value:n});counts.accepted++;
  }
  return {records,counts};
}
export function parsePivot(rows,kind,bankLabel=null) {
  const header=rows[1]||[];
  const indexes=header.map((v,i)=>({m:month(v),i})).filter(x=>x.m);
  if(!indexes.length)throw Error('No monthly header in '+kind);
  const entries=new Map(),coverage=new Set(indexes.map(x=>x.m));
  let rejects=0;
  for(const row of rows.slice(3)){
    const city=canon(row[0]);if(!city||/^(итого|вся сеть|всего)$/iu.test(city))continue;
    for(const {m,i} of indexes){
      const val=amount(row[i]);if(val===null)continue;
      if(!Number.isInteger(val)||val<0){rejects++;continue;}
      const key=pair(city,m),old=entries.get(key);
      if(old){old.value+=val;old.mergedRows++;}else entries.set(key,{city,month:m,value:val,mergedRows:1});
    }
  }
  return {entries,coverage,bank:bankLabel,kind,rejects};
}
export function parseMatrix(rows){
  return rows.slice(1).flatMap((r,i)=>{
    const bank=bankKey(r[3]),start=isoDay(r[10]),end=isoDay(r[11]),rate=amount(r[8]),fixed=amount(r[9]),max=amount(r[14]);
    if(!bank||!start||!end||(rate===null&&fixed===null))return [];
    return [{sourceRow:i+2,bank,city:canon(r[2]),start,end,
      minAmount:amount(r[6])??0,maxAmount:amount(r[7])??Infinity,
      minDays:amount(r[12])??0,maxDays:amount(r[13])??Infinity,
      rate,fixed,cap:max}];
  });
}
export function parseCentralOffice(rows) {
  return rows.slice(1).flatMap((r,i)=>{
    const m=month(r[0]),bank=bankKey(r[1]),part=amount(r[3]);
    if(!m||!bank||part===null||part<0||part>100)return [];
    const pct=String(r[3]).includes('%')?part/100:part;
    if(pct<0||pct>1)return [];
    return [{month:m,bank,city:canon(r[2]),share:pct,sourceRow:i+2}];
  });
}
export function getCityShare(shares,bank,city,m){
  const applicable=shares.filter(x=>x.month===m&&x.bank===bank&&(!x.city||cityKey(x.city)===cityKey(city)));
  applicable.sort((a,b)=>Number(Boolean(b.city))-Number(Boolean(a.city)));
  return applicable[0]?.share??null;
}
export function calculateOptions({date,city,sum,days},matrix,shares){
  const d=isoDay(date),value=amount(sum),term=amount(days);
  if(!d||!city||value===null||value<=0||term===null||term<=0)return [];
  const output=[];
  for(const bank of BANKS.filter(x=>x!=='ДомКлик')){
    const exact=matrix.filter(r=>r.bank===bank&&(r.city==='Сеть'||!r.city||cityKey(r.city)===cityKey(city))&&
      r.start<=d&&r.end>=d&&value>=r.minAmount&&value<=r.maxAmount&&term>=r.minDays&&term<=r.maxDays);
    exact.sort((a,b)=>Number(cityKey(b.city)===cityKey(city))-Number(cityKey(a.city)===cityKey(city)));
    if(!exact.length)continue;
    // Ambiguous rows for same city and date: skip, don't guess between tariffs.
    const bestCity=cityKey(exact[0].city)===cityKey(city);
    const candidates=exact.filter(r=>(cityKey(r.city)===cityKey(city))===bestCity);
    if(candidates.length!==1)continue;
    const rule=candidates[0];
    // Rate is stored as a FRACTION (0.08 = 8%), not a percent string.
    const gross=rule.fixed!==null?rule.fixed:rule.rate!==null&&rule.rate>0?value*term*rule.rate/365:null;
    // A zero-rate row with only a maximum payout is not a complete payout rule.
    if(gross===null)continue;
    const bankFee=rule.cap!==null?Math.min(rule.cap,gross):gross;
    const co=getCityShare(shares,bank,city,month(d));
    output.push({bank,bankFee,cityFee:co===null?null:bankFee*(1-co),coShare:co,
      ruleRow:rule.sourceRow});
  }
  return output.sort((a,b)=>(b.cityFee??-Infinity)-(a.cityFee??-Infinity));
}
export function buildTechSnapshot(raw) {
  const cash=parseMonthly(raw.cash,'cash'),median=raw.median?parseMonthly(raw.median,'median'):null;
  const er=parsePivot(raw.er,'er');
  const banks={};for(const [name,rows] of Object.entries(raw.bankPivots))banks[name]=parsePivot(rows,'bank',name);
  const matrix=parseMatrix(raw.matrix),shares=parseCentralOffice(raw.shares);
  const all=new Map(), ensure=(city,m)=>{const key=pair(city,m);if(!all.has(key))all.set(key,{city,month:m,cash:null,er:null,median:null,banks:{},commission:null,operations:null,cityIncome:null});return all.get(key);};
  for(const v of cash.records.values())ensure(v.city,v.month).cash=v.value;
  for(const v of er.entries.values())ensure(v.city,v.month).er=v.value;
  for(const [bank,parsed] of Object.entries(banks))for(const v of parsed.entries.values())ensure(v.city,v.month).banks[bank]=(ensure(v.city,v.month).banks[bank]??0)+v.value;
  if(median)for(const v of median.records.values())ensure(v.city,v.month).median=v.value;
  let registryRecords=0,registryRejected=0,registryNotAKK=0;const totals=new Map();
  if(raw.registry){
    for(const r of raw.registry.slice(2)){
      const date=isoDay(r[0]),city=canon(r[1]),bank=bankKey(r[2]),fee=amount(r[5]);
      if(!date||!city||!bank||fee===null){registryRejected++;continue;}
      // "домклик" and "Альфа НС" are reported separately from accredited AKK banks.
      if(!AKK_BANKS.includes(bank)){registryNotAKK++;continue;}
      registryRecords++;
      const key=pair(city,month(date)),obj=totals.get(key)||{sum:0,count:0,net:0,known:0};
      const share=getCityShare(shares,bank,city,month(date));
      obj.sum+=fee;obj.count++;
      if(share!==null){obj.net+=fee*(1-share);obj.known++;}
      totals.set(key,obj);
      ensure(city,month(date));
    }
    for(const [key,val] of totals){
      const item=all.get(key);
      item.commission=val.sum;
      item.operations=val.count;
      item.cityIncome=val.known===val.count?val.net:null;
    }
  }
  const bankCoverage=Object.fromEntries(Object.entries(banks).map(([k,v])=>[k,[...v.coverage]]));
  const rows=[...all.values()].map(v=>{
    const monthBanks=Object.fromEntries(BANKS.map(b=>[b,banks[b]?.coverage.has(v.month)?v.banks[b]??0:null]));
    const sumKeys=AKK_BANKS.map(b=>monthBanks[b]);
    const akk=sumKeys.every(n=>n!==null)?sumKeys.reduce((a,b)=>a+b,0):null;
    return {...v,banks:monthBanks,akk,nominal:monthBanks['Альфа НС'],domklik:monthBanks['ДомКлик'],
      er:v.er??(er.coverage.has(v.month)?0:null),
      erPenetration:v.cash>0&&er.coverage.has(v.month)?(v.er??0)/v.cash*100:null,
      akkPenetration:v.cash>0&&akk!==null?akk/v.cash*100:null,
      avgCommission:v.operations>0?v.commission/v.operations:null};
  }).sort((a,b)=>a.month.localeCompare(b.month)||a.city.localeCompare(b.city,'ru'));
  return {sourceId:SOURCE_ID,generatedAt:new Date().toISOString(),
    months:[...new Set(rows.map(r=>r.month))].sort(),cities:[...new Set(rows.map(r=>r.city))].sort((a,b)=>a.localeCompare(b,'ru')),
    rows,matrix,shares,diagnostics:{
      cashEntries:cash.counts.accepted,cashDuplicateKeys:cash.counts.duplicates,medianEntries:median?.counts.accepted??0,
      erEntries:er.entries.size,bankCoverage,bankEntries:Object.fromEntries(Object.entries(banks).map(([k,x])=>[k,x.entries.size])),
      matrixRules:matrix.length,centralOfficeRules:shares.length,registryRecords,registryRejected,registryNotAKK,
      registryAvailable:Boolean(raw.registry),medianAvailable:Boolean(raw.median)
    }};
}
export function sumForView(rows,filters={}) {
  const matched=rows.filter(r=>(!filters.month||r.month===filters.month)&&(!filters.city||cityKey(r.city)===cityKey(filters.city)));
  const sumField=f=>matched.every(r=>r[f]!==null&&r[f]!==undefined)?matched.reduce((a,r)=>a+r[f],0):null;
  const eligible=matched.filter(r=>r.cash!==null);
  const cash=eligible.length===matched.length?sumField('cash'):null;
  const er=sumField('er'),akk=sumField('akk'),nominal=sumField('nominal'),domklik=sumField('domklik');
  const commissions=sumField('commission'),operations=sumField('operations');
  return {cities:new Set(matched.map(x=>cityKey(x.city))).size,cash,er,akk,nominal,domklik,
    erPenetration:cash>0&&er!==null?er/cash*100:null,akkPenetration:cash>0&&akk!==null?akk/cash*100:null,
    commissions,operations,avgCommission:operations>0&&commissions!==null?commissions/operations:null};
}
