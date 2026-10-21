import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as XLSX from 'xlsx';
import { monthKey, number, percent, buildDataset, parseAkkSummary, parseErSummary } from '../lib/workbook-data.js';
import { parseWorkbook } from '../lib/workbook-loader.js';
import { importWorkbook } from '../lib/import.js';
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../public/analytics.js', import.meta.url), 'utf8'), ctx);
const model = ctx.BI2Model;
const rows = n => Array.from({length:n}, () => []);
function summary(kind) {
  const a = rows(7), h = kind === 'er' ? 3 : 2;
  a[h][7] = '01.08.2026'; a[h][10] = '01.01.2024';
  if (kind === 'er') { a[1][7] = 'Наша база'; a[1][10] = 'Наша база'; }
  a[4] = [null,null,'','','Вся сеть',26,62.25,26/62.25,0,10,0];
  a[5] = [null,null,'Ф2','B','Город теста',26,62.25,26/62.25,0,10,0];
  return a;
}
function fixture() {
  const akk = summary('akk'); akk[5][5] = 35; akk[5][6] = 41.5; akk[5][7] = 35/41.5;
  const cash = rows(5); cash[3][4] = '2026-08'; cash[4][1] = 'Город теста'; cash[4][4] = 83;
  const raw = rows(2); raw.push(['2026-08-12','Ф2','Город теста','август 2026','Альфа',100,null,null,null,70]);
  raw.push(['2026-08-15','Ф2','Город теста','август 2026','Альфа НС',200,null,null,40,160]);
  const erRaw = [['Категория','Месяц','ЮЛ','Город']];
  for(let i=0;i<26;i++) erRaw.push(['Ф2','август 2026','Организация','Город теста']);
  return { 'Свод ЭР':summary('er'), 'Свод АКК':akk, 'BI+Космос':cash, 'АКК Data':raw, 'ЭР Data':erRaw };
}
function book(sources) {
  const wb = XLSX.utils.book_new();
  for(const [name,a] of Object.entries(sources)) XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(a),name);
  return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
}

test('dates come from headers; numeric, Russian and ISO representations agree',()=>{
  for(const value of ['авг.26','август 2026','01.08.2026','2026-08-01',46235]) assert.equal(monthKey(value),'2026-08');
  assert.equal(monthKey('2026-13'),null);
  assert.equal(monthKey('#REF!'),null);
  const a=parseAkkSummary(summary('akk'));
  assert.deepEqual(a.monthKeys,['2024-01','2026-08']);
  assert.deepEqual(a.cities[0].counts,[0,26]);
  assert.equal(a.cities[0].values[0],0);
  assert.equal(a.trimmedCount,0);
});
test('duplicate summary periods are rejected rather than shifted or overwritten',()=>{
  for(const kind of ['er','akk']) {
    const a=summary(kind); a[kind==='er'?3:2][10]='2026-08';
    assert.throws(()=>kind==='er'?parseErSummary(a):parseAkkSummary(a),/повторяющиеся/);
  }
});
test('missing, error, and zero remain distinct; percentages are not rounded on import',()=>{
  for(const v of [null,undefined,'','#REF!','#DIV/0!']) assert.equal(number(v),null);
  assert.equal(number('0'),0); assert.equal(number('1 234,50'),1234.5);
  assert.equal(percent(0.125),12.5); assert.equal(percent('12,5%'),12.5);
});
test('source and NEW methods keep their own denominators and raw counts',()=>{
  const {analytics:a}=buildDataset(fixture());
  const original=model.summarize(a,{city:'Город теста'},'2026-08','2026-08','summary');
  const modern=model.summarize(a,{city:'Город теста'},'2026-08','2026-08','new');
  assert.equal(original.total.er.count,26); assert.equal(original.total.er.base,62.25);
  assert.equal(original.total.akk.base,41.5); assert.equal(original.total.akk.count,35);
  assert.equal(modern.total.er.base,53.95); assert.equal(modern.total.er.count,26);
  assert.equal(modern.total.akk.count,2); // Raw fixture intentionally differs: diagnostics must expose it.
  assert(a.diagnostics.some(d=>d.code==='counts_mismatch'));
  assert(Math.abs(modern.total.er.pct-48.19277108433735)<1e-10);
});
test('period totals use weighted penetration and never coerce missing bases to zero',()=>{
  const r=(n,d)=>({er:{summaryCount:n,summaryBase:d,summaryPct:100*n/d}});
  assert.equal(model.metric([r(1,2),r(9,90)],'er','summary').pct,1000/92);
  assert.equal(model.metric([r(1,2),r(9,null)],'er','summary').pct,null);
  assert.equal(model.sum([0,0]),0); assert.equal(model.sum([1,null]),null);
});
test('bank products stay separate, missing central income stays unknown, absent months stay unknown',()=>{
  const {analytics:a}=buildDataset(fixture());
  const s=model.summarize(a,{city:'Город теста'},'2026-08','2026-08');
  assert.equal(a.products.length,2); assert.equal(s.total.fee,300); assert.equal(s.total.cityIncome,230);
  assert.equal(s.total.centralIncome,null);
  const old=model.summarize(a,{city:'Город теста'},'2024-01','2024-01');
  assert.equal(old.total.fee,null); assert.equal(old.total.akk.count,0);
});
test('combined categories exclude Tyumen; explicit city can inspect an excluded city',()=>{
  const f={cat:'Ф1, Ф3 (без ТМН)'};
  assert.equal(model.matches({city:'Тюмень',cat:'Ф1'},f),false);
  assert.equal(model.matches({city:'Москва',cat:'Ф3'},f),true);
  assert.equal(model.matches({city:'Другой',cat:'Ф4'},{}),false);
  assert.equal(model.matches({city:'Другой',excluded:true},{city:'Другой'}),true);
});
test('nominal import retains only aggregates and clearly separates disclosure and funding periods',()=>{
  const a=rows(3); a[0]=['ФИО','Город'];
  for(let r=1;r<3;r++){a[r][0]='PRIVATE_CLIENT_SENTINEL';a[r][1]='Город теста';a[r][3]='2026-07-15';a[r][8]=100000;a[r][9]='В работе';a[r][12]=5;a[r][23]=100;}
  a[1][27]='2026-08'; a[2][21]=0;
  const data=buildDataset({'Тех. лист. номинальный счет':a});
  assert.equal(data.analytics.nominal.length,2);
  assert.equal(data.analytics.nominal[0].basis,'disclosure');assert.equal(data.analytics.nominal[1].basis,'funding');
  assert.equal(data.analytics.nominal[0].missing.income,1);assert.equal(data.analytics.nominal[1].income,0);
  assert(!JSON.stringify(data).includes('PRIVATE_CLIENT_SENTINEL'));
});
test('XLSX worker returns validated aggregates and propagates malformed workbook errors',async()=>{
  const buffer=book(fixture());
  const imported=await importWorkbook(buffer,{source:'upload'});
  assert.equal(imported.data.schemaVersion,3);
  assert.equal(imported.data.akk.monthKeys.at(-1),'2026-08');
  assert.equal(imported.data.analytics.products.length,2);
  await assert.rejects(importWorkbook(book({'Не тот лист':[['nothing']]})),/Не найдены листы/);
});
test('standalone calculator import remains supported and percent cells are read correctly',()=>{
  const a=rows(12);a[2][18]=0.27;a[6][3]='Город калькулятора';a[10][2]='до 1 млн';a[10][3]=2;
  const result=parseWorkbook(book({'Калькулятор':a}));
  assert(result.calculatorOnly);assert.equal(result.data.calc.targetPct,27);assert.equal(result.data.calc.buckets.length,1);
});
