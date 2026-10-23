import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { parseCosmosSheet,parseCosmos,mergeCosmos } from '../lib/cosmos.js';
import { validatePlan,savePlan,getPlans,captureSnapshots,listSnapshots,getSnapshot,businessDate } from '../lib/operations.js';
const ctx=vm.createContext({});for(const f of ['analytics.js','insight-model.js']) vm.runInContext(fs.readFileSync(new URL('../public/'+f,import.meta.url),'utf8'),ctx);
const M=ctx.BI2Insights;
function pivot(rows,totals,options={}) {
  const columns=options.columns||['2026-01','2026-02'];
  return [['Дата актуальности:','03:00:00 22.10.2026',null,'Дата выгрузки:','12:00:00 22.10.2026'],
    [null,'Дата ЭР',...columns,'Итого'],['Город'],...rows.map(r=>[r[0],null,...r.slice(1)]),['Итого',null,...totals]];
}
const cashName='1. 6. Сделки с налом Сеть',akkName='2. 242. Колво акк Сеть',bankName='3. 242. Колво акк разбивка по б';

test('distinct controls stay authoritative instead of summing cities or months',()=>{
  const s=parseCosmosSheet(cashName,pivot([['Город А',5,5,8],['Город Б',4,4,7]],[8,8,14]));
  assert.equal(s.grandTotal,14);assert.equal(s.checks.periodSum,16);assert.equal(s.checks.rowSum,15);
  assert(s.findings.some(f=>f.code==='non_additive'));assert(!s.findings.some(f=>f.code==='totals_mismatch'));
  assert.equal(M.pivotValue(s,'2026-01'),8);
  assert.equal(M.pivotValue(s,'2026-01',{city:'Город А'}),5);
  assert.equal(M.pivotValue(s,'2026-01',{cat:'Ф1'},[{city:'Город А',cat:'Ф1'},{city:'Город Б',cat:'Ф1'}]),null);
  assert.equal(M.pivotValue(s,'2026-03'),null);
});
test('pivot growth columns are ignored while source month values and totals survive',()=>{
  const a=pivot([['Город А',5,null,10,1,15]],[5,null,10,1,15],{columns:['2026-01',null,'2026-02',null]});
  const s=parseCosmosSheet('6. 335. Сева',a);
  assert.deepEqual(s.months,['2026-01','2026-02']);assert.deepEqual(s.dataRows[0].values,[5,10]);assert.equal(s.grandTotal,15);
});
test('null month and null dimension stay explicit, not a fake city or current period',()=>{
  const s=parseCosmosSheet(akkName,pivot([['Город А',2,null,0,2],['null',1,null,4,5]],[3,0,4,7],{columns:['2026-01','2026-02','null']}));
  assert.equal(s.undatedTotal,4);assert.equal(s.grandTotal,7);assert.equal(s.dataRows[1].unknown,true);
  assert.equal(s.dataRows[0].values[1],0);assert.equal(s.findings.find(x=>x.code==='unknown_dimension').count,5);
  assert(!s.findings.some(x=>x.code==='totals_mismatch'));
});
test('bank reconciliation excludes only the stated competitor and uses shared periods',()=>{
  const a=pivot([['Город А',2,3,5]],[2,3,5]);a[3][6]='Фильтры:';a[4][6]='Банк (исключено 1): домклик';a.push([null,null,null,null,null,null,'Создатель:']);
  const b=pivot([['Сбер',2,3,5],['домклик',4,5,9]],[6,8,14]);
  const c=parseCosmos({[akkName]:a,[bankName]:b});
  assert.equal(c.comparisons.length,2);assert(c.comparisons.every(x=>x.status==='match'));
  assert.equal(c.comparisons[1].allBanks,8);assert.equal(c.comparisons[1].compared,3);
});
test('duplicate city spellings aggregate count metrics and are diagnosed',()=>{
  const s=parseCosmosSheet(akkName,pivot([['Город А',2,3,5],['город а',1,1,2]],[3,4,7]));
  assert.equal(M.pivotValue(s,'2026-01',{city:'ГОРОД А'}),3);assert(s.findings.some(f=>f.code==='duplicate_labels'));
});
test('partial import replaces its report only; stale source cannot overwrite a newer snapshot',()=>{
  const old=parseCosmos({[cashName]:pivot([['Город А',1,2,3]],[1,2,3])});
  const incoming=parseCosmos({[akkName]:pivot([['Город А',2,3,5]],[2,3,5])});
  const merged=mergeCosmos(old,incoming);assert(merged.sheets.cash);assert(merged.sheets.akk);
  const stale=structuredClone(old);stale.sheets.cash.asOfDate='2026-10-01';assert.throws(()=>mergeCosmos(merged,stale),/старше/);
});
test('invalid count cells remain unknown and duplicate months fail import',()=>{
  const s=parseCosmosSheet(akkName,pivot([['Город А','#REF!',3,5]],[2,3,5]));
  assert.equal(s.dataRows[0].values[0],null);assert(s.findings.some(f=>f.code==='invalid_value'));
  assert.throws(()=>parseCosmosSheet(akkName,pivot([['Город А',2,3,5]],[2,3,5],{columns:['2026-01','2026-01']})),/повторяются/);
});
test('zero target is preserved; invalid plan and missing actuals are not invented',()=>{
  const p=validatePlan({city:'Город А',metric:'er',method:'summary',month:'2026-08',targetPct:0});
  assert.equal(p.targetPct,0);assert.throws(()=>validatePlan({...p,targetPct:101}));
  assert.throws(()=>validatePlan({...p,month:'2026-13'}));assert.equal(M.planProgress(p,{}).actual,null);
  const data={analytics:{directory:[{city:'Город А'}],records:[{city:'Город А',cityKey:'город а',month:'2026-08',er:{summaryCount:26,summaryBase:62.25,summaryPct:26/62.25*100}}]}};
  const result=M.planProgress({...p,targetPct:60},data);assert.equal(result.gapCount,12);assert(result.attainment<100);
});
test('source freshness differs from loaded time and completed-month coverage',()=>{
  const c=parseCosmos({[akkName]:pivot([['Город А',2,3,5]],[2,3,5])});
  assert(M.quality({cosmos:c},'2026-10-22').some(x=>x.code==='coverage'));
  assert(!M.quality({cosmos:c},'2026-10-22').some(x=>x.code==='freshness'));
  assert(M.quality({cosmos:c},'2026-10-25').some(x=>x.code==='freshness'));
});
test('monthly history is immutable, deduplicated, and labelled by capture time',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'bi2-test-')),old=process.env.BI2_STATE_DIR;process.env.BI2_STATE_DIR=folder;
  try{
    const cosmos=parseCosmos({[akkName]:pivot([['Город А',2,3,5]],[2,3,5])}),data={cosmos};
    assert.equal(captureSnapshots(data,new Date('2026-10-22T12:00:00Z')).added,2);
    assert.equal(captureSnapshots(data,new Date('2026-10-23T12:00:00Z')).added,0);
    const list=listSnapshots();assert.equal(list.length,2);const snapshot=getSnapshot(list[0].id);
    assert(snapshot.capturedAt.startsWith('2026-10-22'));assert.equal(list[0].kind,'observed');assert.equal(getSnapshot('../index'),null);
    const before=snapshot.cosmos.akk.total;data.cosmos.sheets.akk.totals[0]=100;
    assert.equal(captureSnapshots(data,new Date('2026-10-24T12:00:00Z')).added,1);
    assert.equal(getSnapshot(list[0].id).cosmos.akk.total,before);
    savePlan({city:'Город А',metric:'er',method:'summary',month:'2026-08',targetPct:0});assert.equal(getPlans()[0].targetPct,0);
    assert.equal(businessDate(new Date('2026-10-21T20:00:00Z')),'2026-10-22');
  }finally{if(old===undefined)delete process.env.BI2_STATE_DIR;else process.env.BI2_STATE_DIR=old;fs.rmSync(folder,{recursive:true,force:true});}
});
test('volume drops use normalized city totals and skip the current incomplete month',()=>{
  const c=parseCosmos({[akkName]:pivot([['Город А',20,8,28],['город а',10,7,17]],[30,15,45])});
  const signals=M.quality({cosmos:c},'2026-03-01').filter(x=>x.code==='count_drop');
  assert.equal(signals.length,1);assert(signals[0].message.includes('30 → 15'));
  assert.equal(M.quality({cosmos:c},'2026-02-20').filter(x=>x.code==='count_drop').length,0);
});
test('average income divides matching source income by source operations',()=>{
  assert.equal(ctx.BI2Model.average(1000,4),250);assert.equal(ctx.BI2Model.average(null,4),null);assert.equal(ctx.BI2Model.average(0,4),0);assert.equal(ctx.BI2Model.average(1000,0),null);
});
