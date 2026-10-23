(function(global) {
  'use strict';
  const key = v => String(v ?? '').trim().replace(/\s+/g,' ').replace(/^г\.?\s+/i,'').toLowerCase().replace(/ё/g,'е').replace(/[-‐‑–—]/g,' ');
  const finite = v => typeof v==='number' && Number.isFinite(v);
  const sum = a => a.length && a.every(finite) ? a.reduce((n,v)=>n+v,0) : null;
  const previousMonth = m => { const d=new Date(m+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7); };
  const dateToday = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Yekaterinburg',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  function rowsFor(sheet, filters={}, directory=[]) {
    const catalog=new Map(directory.map(c=>[key(c.city),c]));
    return sheet.dataRows.filter(r=>{
      if(filters.city && key(filters.city)!==r.cityKey) return false;
      if(!filters.cat && !filters.grade) return true;
      const c=catalog.get(r.cityKey); if(!c) return false;
      return global.BI2Model.matches(c,filters);
    });
  }
  function pivotValue(sheet, month, filters={}, directory=[]) {
    if(!sheet) return null;
    const i=sheet.months.indexOf(month);if(i<0) return null;
    if(!filters.city && !filters.cat && !filters.grade) return sheet.totals[i];
    const rows=rowsFor(sheet,filters,directory);
    // Distinct objects cannot be summed across cities, or across duplicate rows.
    if(sheet.aggregation==='unique' && rows.length!==1) return null;
    return sum(rows.map(r=>r.values[i]));
  }
  function mapReconciliation(data, month) {
    if(!data.cosmos || !data.analytics) return [];
    const comparisons=[];
    for(const [kind,metric,field] of [['cash','cashRaw',null],['er','er','rawCount'],['akk','akk','rawCount']]) {
      const s=data.cosmos.sheets[kind];if(!s || !s.months.includes(month)) continue;
      for(const record of data.analytics.records.filter(r=>r.month===month)) {
        const old=field?record[metric]?.[field]:record[metric];
        const current=pivotValue(s,month,{city:record.city});
        if(!finite(old)||!finite(current)) continue;
        comparisons.push({kind,city:record.city,month,map:old,cosmos:current,delta:current-old});
      }
    }
    return comparisons;
  }
  function planProgress(plan, data) {
    const a=data.analytics;
    if(!a) return {...plan,actual:null,base:null,count:null,gapCount:null,attainment:null};
    const records=global.BI2Model.getRecords(a,{city:plan.city},plan.month,plan.month);
    const m=global.BI2Model.metric(records,plan.metric,plan.method);
    return {...plan,actual:m.pct,base:m.base,count:m.count,
      gapCount:finite(m.base)&&m.base>0&&finite(m.count)?Math.max(0,Math.ceil(plan.targetPct*m.base/100-m.count-1e-9)):null,
      attainment:finite(m.pct)&&plan.targetPct>0?100*m.pct/plan.targetPct:null,
      delta:finite(m.pct)?m.pct-plan.targetPct:null};
  }
  function quality(data, today=dateToday()) {
    const output=[];
    for(const s of Object.values(data.cosmos?.sheets || {})) {
      const age=s.asOfDate?Math.floor((Date.parse(today)-Date.parse(s.asOfDate))/86400000):null;
      if(age==null || age>2) output.push({severity:'warning',kind:s.kind,city:'Вся выгрузка',month:s.months.at(-1),code:'freshness',message:age==null?'Нет даты актуальности источника':`Дата источника отстаёт на ${age} дн. (лимит ТЗ — 2 дня)`});
      const lastComplete=previousMonth(today.slice(0,7));
      if(s.months.at(-1)<lastComplete) output.push({severity:'warning',kind:s.kind,city:'Вся выгрузка',month:s.months.at(-1),code:'coverage',message:`Последний месяц — ${s.months.at(-1)}. Нет данных до ${lastComplete}; дата загрузки не подтверждает полноту.`});
      if(['er','akk'].includes(s.kind)) {
        const groups=new Map();
        for(const r of s.dataRows) {if(r.unknown)continue;const a=groups.get(r.cityKey)||[];a.push(r);groups.set(r.cityKey,a);}
        for(const rows of groups.values()) for(let i=0;i<s.months.length;i++) {
          const month=s.months[i],p=s.months.indexOf(previousMonth(month));
          if(p<0||month>=today.slice(0,7))continue;
          const current=sum(rows.map(r=>r.values[i])),prior=sum(rows.map(r=>r.values[p]));
          if(finite(current)&&finite(prior)&&prior>=20&&prior-current>=5&&current<=prior*0.8)
            output.push({severity:'warning',kind:s.kind+' (Космос)',city:rows[0].label,month,code:'count_drop',
              message:`Операции: ${prior} → ${current} (${((current/prior-1)*100).toFixed(1)}%). Снижение объёма; проверьте число доступных сделок и полноту источника перед оценкой проникновения.`});
        }
      }
    }
    const a=data.analytics;if(!a) return output;
    const ordered=new Map();
    for(const r of a.records) { if(!ordered.has(r.cityKey))ordered.set(r.cityKey,new Map());ordered.get(r.cityKey).set(r.month,r); }
    for(const months of ordered.values()) for(const r of months.values()) {
      // Incomplete current month is not compared with a complete prior month.
      if(r.month>=today.slice(0,7)) continue;
      for(const metric of ['er','akk']) {
        const m=r[metric],p=months.get(previousMonth(r.month))?.[metric];
        if(finite(m?.summaryPct)&&m.summaryPct>100) output.push({severity:'warning',kind:metric,city:r.city,month:r.month,code:'above100',message:'Процент выше 100%. Проверьте знаменатель, повторы и состав операций.'});
        if(finite(m?.summaryPct)&&finite(p?.summaryPct)&&m.summaryBase>=20&&p.summaryBase>=20&&Math.abs(m.summaryPct-p.summaryPct)>=20)
          output.push({severity:'warning',kind:metric,city:r.city,month:r.month,code:'jump',message:`Изменение на ${(m.summaryPct-p.summaryPct).toFixed(1)} п.п. к предыдущему месяцу при базе ≥20`});
        const before=months.get(previousMonth(previousMonth(r.month)))?.[metric];
        if([m,p,before].every(x=>x?.summaryCount===0&&x.summaryBase>0)) output.push({severity:'warning',kind:metric,city:r.city,month:r.month,code:'zero_run',message:'Три месяца без операций при положительной базе'});
      }
    }
    return output.sort((a,b)=>(b.month||'').localeCompare(a.month||''));
  }
  function rollingSeries(analytics, city, metric, method, months, mode) {
    return months.map((month,i)=>{
      const start=mode==='cumulative'?months[0]:mode==='rolling3'?previousMonth(previousMonth(month)):month;
      const records=global.BI2Model.getRecords(analytics,{city},start,month);
      const expected=mode==='rolling3'?3:mode==='cumulative'?i+1:1;
      if(new Set(records.map(r=>r.month)).size!==expected) return null;
      return global.BI2Model.metric(records,metric,method).pct;
    });
  }
  global.BI2Insights={key,sum,pivotValue,rowsFor,mapReconciliation,planProgress,quality,rollingSeries,previousMonth,dateToday};
})(globalThis);
