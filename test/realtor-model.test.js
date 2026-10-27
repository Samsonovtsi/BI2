import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRealtorCsv,aggregateRealtors,hierarchyByOrganisation,readCsv,periodsFromRows} from '../public/realtor-model.js';

const header='deal_id;employee_id;employee_name;deal_date;eligible_cash;product;commission;commission_id;city;partner;senior_partner;rop;mop;spn;tenure_months;client_id';
const events=[
  '1;A;Иван;2026-10-02;да;ЭР;1000;a1;Тюмень;П1;СП1;Р1;М1;С1;12;K1',
  '1;A;Иван;2026-10-02;да;АКК;2000;a2;Тюмень;П1;СП1;Р1;М1;С1;12;K1',
  '2;A;Иван;2026-10-12;да;;0;;Тюмень;П1;СП1;Р1;М1;С1;12;K2',
  '3;B;Мария;2026-10-15;да;НС;4500;b1;Москва;П2;СП2;Р2;М2;С2;6;K3',
  '4;B;Мария;2026-09-19;нет;АКК;1000;b2;Москва;П2;СП2;Р2;М2;С2;6;K4'
];
const sample=()=>parseRealtorCsv([header,...events].join('\r\n')).rows;

test('CSV parsing keeps semicolons inside quoted fields and handles BOM',()=>{
  const rows=readCsv('\ufeffa;b\r\n"x;y";"z""q"\r\n');
  assert.deepEqual(rows,[['a','b'],['x;y','z"q']]);
});
test('two products in one deal count once in penetration',()=>{
  const output=aggregateRealtors(sample());
  const a=output.byId.get('A');
  assert.equal(a.eligible,2);
  assert.equal(a.active,1);
  assert.equal(a.operations,2);
  assert.equal(a.penetration,50);
  assert.equal(a.fees,3000);
  assert.equal(output.coverage.eligible,3);
  assert.equal(output.coverage.active,2);
});
test('turning off AKK removes its fee without removing base cash deals',()=>{
  const result=aggregateRealtors(sample(),{products:['ЭР']});
  const a=result.byId.get('A');
  assert.equal(a.eligible,2);
  assert.equal(a.active,1);
  assert.equal(a.fees,1000);
  assert.equal(result.byId.get('B').fees,0);
});
test('period and city filters share the correct cohort',()=>{
  const result=aggregateRealtors(sample(),{period:'2026-10',city:'Москва',products:['НС']});
  assert.equal(result.list.length,1);
  assert.equal(result.coverage.eligible,1);
  assert.equal(result.coverage.active,1);
  assert.equal(result.list[0].fees,4500);
  assert.deepEqual(periodsFromRows(sample()).slice(0,2),['all','2026-10']);
});
test('commission_id deduplicates the same payment event',()=>{
  const rows=sample();rows.push({...rows[0]});
  const result=aggregateRealtors(rows);
  assert.equal(result.byId.get('A').fees,3000);
  assert.equal(result.records.er.productCounts['ЭР'],1);
});
test('hierarchy aggregates distinct deals and only counts clients',()=>{
  const hierarchy=hierarchyByOrganisation(sample());
  const tyumen=hierarchy.find(v=>v.label==='Тюмень');
  assert.equal(tyumen.eligible,2);
  assert.equal(tyumen.active,1);
  assert.equal(tyumen.clients,2);
  assert.equal(tyumen.children[0].label,'Р1');
});
test('bad date, missing cash flag, unsupported product are rejected',()=>{
  const csv=[header,'1;A;Иван;2026-99-41;да;ЭР;1;z;Тюмень;;;;;;;;',
    '2;A;Иван;2026-10-12;;ЭР;1;z;Тюмень;;;;;;;;',
    '3;A;Иван;2026-10-12;да;СЕКРЕТ;1;z;Тюмень;;;;;;;;',events[0]].join('\n');
  const result=parseRealtorCsv(csv);
  assert.equal(result.rows.length,1);
  assert.equal(result.rejectedCount,3);
});
test('CSV requires source identifiers and includes no default employee records',()=>{
  assert.throws(()=>parseRealtorCsv('name;date\nA;2026-10-01'),/Не хватает столбцов/);
  assert.deepEqual(aggregateRealtors([]).list,[]);
});
