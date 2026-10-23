import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { cityKey, monthKey } from './workbook-data.js';

const root = () => process.env.BI2_STATE_DIR || path.join(path.dirname(process.env.CACHE_FILE || 'data/cache.json'), 'operations');
function read(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch(e) { if(e.code === 'ENOENT') return fallback; throw e; } }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive:true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)); fs.renameSync(tmp, file); }
export const businessDate = (now = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone:'Asia/Yekaterinburg', year:'numeric', month:'2-digit', day:'2-digit' }).format(now);
export function validatePlan(input) {
  const { city, metric, month, targetPct, method } = input || {};
  if (typeof city !== 'string' || !city.trim() || city.length > 150 || /[<>\x00-\x1f]/.test(city)) throw new Error('Нужен город');
  if (!['er','akk'].includes(metric) || !['summary','new'].includes(method)) throw new Error('Недопустимые показатель или методика');
  if (!/^20\d{2}-\d{2}$/.test(month || '') || monthKey(month) !== month) throw new Error('Нужен месяц в формате ГГГГ-ММ');
  if (typeof targetPct !== 'number' || !Number.isFinite(targetPct) || targetPct < 0 || targetPct > 100) throw new Error('План должен быть числом от 0 до 100%');
  const normalized = { city:city.trim(), cityKey:cityKey(city), metric, month, targetPct, method };
  return { ...normalized, id:createHash('sha256').update([normalized.cityKey,metric,month,method].join('|')).digest('hex').slice(0,24) };
}
export function getPlans() { return read(path.join(root(),'plans.json'), []); }
export function savePlan(input) {
  const plan = { ...validatePlan(input), updatedAt:new Date().toISOString() }, plans = getPlans().filter(p => p.id !== plan.id);
  plans.push(plan); write(path.join(root(),'plans.json'),plans); return plans;
}
export function deletePlan(id) { const plans = getPlans().filter(p=>p.id !== id); write(path.join(root(),'plans.json'),plans); return plans; }
export function listSnapshots() { return read(path.join(root(),'history','index.json'),[]).sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt)); }
export function getSnapshot(id) {
  if (!/^[a-f0-9]{24}$/.test(id) || !listSnapshots().some(s=>s.id===id)) return null;
  return JSON.parse(gunzipSync(fs.readFileSync(path.join(root(),'history',id+'.json.gz'))));
}

export function captureSnapshots(data, now = new Date()) {
  const today = businessDate(now), currentMonth = today.slice(0,7), cutoffDate = new Date(`${currentMonth}-01T00:00:00Z`);
  cutoffDate.setUTCMonth(cutoffDate.getUTCMonth()-36); const cutoff = cutoffDate.toISOString().slice(0,7);
  const months = [...new Set([...(data.analytics?.records || []).map(r=>r.month), ...Object.values(data.cosmos?.sheets || {}).flatMap(s=>s.months)])]
    .filter(m=>m>=cutoff && m<currentMonth).sort();
  const folder = path.join(root(),'history'), existing = listSnapshots(), index = existing.filter(s=>s.month>=cutoff);
  const ids = new Set(index.map(s=>s.id)); let added=0;
  for (const month of months) {
    const mapRows = (data.analytics?.records || []).filter(r=>r.month===month);
    const cosmos = {};
    for (const [kind,s] of Object.entries(data.cosmos?.sheets || {})) {
      const i=s.months.indexOf(month); if(i<0) continue;
      cosmos[kind]={ name:s.name, aggregation:s.aggregation, dimension:s.dimension, dateField:s.dateField, unit:s.unit, filters:s.filters,
        total:s.totals[i], rows:s.dataRows.map(r=>({label:r.label,cityKey:r.cityKey,secondary:r.secondary,value:r.values[i]})) };
    }
    const values={month,mapRows,methods:data.analytics?.methods || null,cosmos};
    const hash=createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0,24);
    if(ids.has(hash)) continue;
    const capturedAt=now.toISOString(), snapshot={id:hash,capturedAt,sourceDates:Object.fromEntries(Object.entries(data.cosmos?.sheets || {}).map(([k,s])=>[k,s.asOfText])),...values};
    write(path.join(folder,hash+'.json.gz'),gzipSync(JSON.stringify(snapshot)));
    index.push({id:hash,month,capturedAt,kind:'observed',mapRows:mapRows.length,cosmosSources:Object.keys(cosmos).length});ids.add(hash);added++;
  }
  write(path.join(folder,'index.json'),index);
  for(const old of existing.filter(s=>s.month<cutoff)) { try { fs.unlinkSync(path.join(folder,old.id+'.json.gz')); } catch(e) { if(e.code!=='ENOENT') throw e; } }
  return {added,total:index.length};
}
