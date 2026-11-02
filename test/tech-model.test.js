import test from 'node:test';
import assert from 'node:assert/strict';
import {amount,month,isoDay,csvRows,cityKey,bankKey,parseMonthly,parsePivot,parseMatrix,
  parseCentralOffice,getCityShare,calculateOptions,buildTechSnapshot} from '../lib/tech-model.js';

const matrix=[['month','type','city','bank','periodFrom','periodTo','min','max','rate','fixed','dateFrom','dateTo','minDays','maxDays','cap'],
  ['01.09.2026','Матрицы выплат','Сеть','Т-Банк','','','','','0,08','','01.09.2026','30.09.2026','1','999',''],
  ['','Матрицы выплат','Сеть','Сбер','','','1','6 999 999','','3000','01.01.2000','01.01.2099','1','999',''],
  ['','Матрицы выплат','Сеть','Совкомбанк','','','2 000 000','','0','','01.01.2000','01.01.2099','1','999','25000']];
const shares=[['month','bank','city','co'],
  ['01.09.2026','Т-Банк','Тюмень','10,00%'],
  ['01.09.2026','Т-Банк','','35,00%'],
  ['01.09.2026','Сбер','','18,00%']];

test('money, month and date parse Russian/ISO and reject impossible calendar dates',()=>{
  assert.equal(amount('25\u00a0000,00'),25000);
  assert.equal(amount('нет данных'),null);
  assert.equal(month('01.09.2026'),'2026-09');
  assert.equal(isoDay('31.02.2026'),null);
});
test('bank normalization handles Latin first letter and T-Bank hyphen',()=>{
  assert.equal(cityKey('Cалехард'),cityKey('Салехард'));
  assert.equal(bankKey('Т-Банк'),'Т-Банк');
  assert.equal(bankKey('домклик'),'ДомКлик');
  assert.equal(bankKey('Альфа НС'),'Альфа НС');
});
test('CSV honors embedded commas and multiline quoted values',()=>{
  assert.deepEqual(csvRows('a,b\n"x,y","z""q"\n'),[['a','b'],['x,y','z"q']]);
});
test('cash monthly parser uses unique city-month and flags duplicates',()=>{
  const result=parseMonthly([['metadata'],['header'],['2026-09','Тюмень','100'],['2026-09','Тюмень','110']],'cash');
  assert.equal(result.records.get('тюмень|2026-09').value,100);
  assert.equal(result.counts.duplicates,1);
});
test('bank/ER pivot reads real headers and skips grand-total columns',()=>{
  const rows=[['meta'],['Город','Банк','Год и месяц комиссии','2026-09','Итого'],['Город','Банк'],['Тюмень','Т-Банк','','15','15']];
  const parsed=parsePivot(rows,'bank');
  assert.equal(parsed.entries.get('тюмень|2026-09').value,15);
  assert.deepEqual([...parsed.coverage],['2026-09']);
});
test('matrix respects fixed amount, percentage and city-specific central-office share',()=>{
  const candidates=calculateOptions({date:'2026-09-15',city:'Тюмень',sum:5000000,days:5},parseMatrix(matrix),parseCentralOffice(shares));
  assert.equal(candidates.length,2);
  const tbank=candidates.find(x=>x.bank==='Т-Банк'),sber=candidates.find(x=>x.bank==='Сбер');
  assert.ok(Math.abs(tbank.bankFee-5479.4520548)<0.001);
  assert.equal(tbank.coShare,0.1);
  assert.equal(sber.bankFee,3000);
  assert.equal(sber.cityFee,2460);
  assert.ok(!candidates.some(x=>x.bank==='Совкомбанк'),'zero rate with cap is not valid payout');
});
test('missing month-specific CO share cannot be borrowed from another month',()=>{
  assert.equal(getCityShare(parseCentralOffice(shares),'Т-Банк','Тюмень','2026-10'),null);
});
test('no cash data => no penetration, missing registry => commission unknown',()=>{
  const piv=[['meta'],['City','Bank','Month','2026-09'],['City','Bank'],['Тюмень','Т-Банк','','10']];
  const bankPivots=Object.fromEntries(['ДомРФ','Т-Банк','Сбер','ВТБ','Совкомбанк'].map(k=>[k,piv]));
  const snapshot=buildTechSnapshot({
    cash:[['meta'],['head'],['2026-09','Тюмень','100']],
    er:[['meta'],['City','Date','2026-09'],['City'],['Тюмень','','45']],
    bankPivots,matrix,shares
  });
  const row=snapshot.rows[0];
  assert.equal(row.cash,100);
  assert.equal(row.er,45);
  assert.equal(row.akk,50);
  assert.equal(row.erPenetration,45);
  assert.equal(row.akkPenetration,50);
  assert.equal(row.commission,null);
  assert.equal(snapshot.diagnostics.registryAvailable,false);
});
test('not present period does not become zero when sources have no coverage',()=>{
  const bankPivots=Object.fromEntries(['ДомРФ','Т-Банк','Сбер','ВТБ','Совкомбанк'].map(k=>[k,
    [['meta'],['City','Bank','Date','2026-09'],['City'],['Тюмень',k,'','1']]]));
  const snapshot=buildTechSnapshot({
    cash:[['meta'],['header'],['2026-10','Тюмень','100']],
    er:[['meta'],['City','Date','2026-09'],['City'],['Тюмень','','15']],
    bankPivots,matrix,shares
  });
  const october=snapshot.rows.find(x=>x.month==='2026-10');
  assert.equal(october.akk,null);
  assert.equal(october.er,null);
  assert.equal(october.akkPenetration,null);
});
