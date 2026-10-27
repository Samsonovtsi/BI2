import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const html=readFileSync(new URL('../public/index.html', import.meta.url),'utf8');
const unified=readFileSync(new URL('../public/unified.js', import.meta.url),'utf8');
const css=readFileSync(new URL('../public/unified.css', import.meta.url),'utf8');

test('three primary product areas with all original pages kept',()=>{
  const nav=html.slice(html.indexOf('<nav id="nav"'),html.indexOf('</nav>')+6);
  const areas=[...nav.matchAll(/data-area="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(areas,['map','realtors','calc']);
  for(const id of ['overview','analytics','city','banks','nominal','traffic','plans','reports','cosmos','quality','sources','realtors','calc','calc-deals','calc-rates'])
    assert.ok(html.includes('id="tab-'+id+'"'),id);
  assert.ok(html.includes('id="reportOutput"'));
  assert.ok(html.includes('id="calcBody"'));
  assert.ok(html.includes('id="compareChart"'));
});

test('heatmap separates target achievement, penetration and missing plan',()=>{
  assert.match(html,/id="heatMode"/);
  assert.match(html,/function heatPlanTarget/);
  assert.match(html,/method==='summary'/);
  assert.match(html,/План не задан/);
  assert.match(html,/VOLUME_GRADE_RANK/);
});

test('realtor and tariff screens are honest about missing primary data',()=>{
  assert.match(html,/Нет подключённой связки/);
  assert.match(html,/Разрез по сделке ещё не импортируется/);
  assert.match(html,/Редактирование тарифов на сайте пока не включено/);
  assert.match(css,/body\[data-area="realtors"\]/);
});

test('client script syntax is valid',()=>{
  new Script(unified);
  const inline=html.split('<script>').slice(1).map(part=>part.split('</script>')[0]);
  assert.equal(inline.length,1);
  new Script(inline[0]);
});
