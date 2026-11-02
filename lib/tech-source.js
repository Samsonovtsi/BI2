// Read-only Google techlist loader. Responses are aggregated; individual client rows never leave the server.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SOURCE_ID,csvRows,buildTechSnapshot} from './tech-model.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const CACHE=process.env.TECH_CACHE_FILE||path.join(__dirname,'..','data','tech-cache.json');
const TTL=24*60*60*1000;
const WAIT=60*1000;
const MAX_BYTES=32*1024*1024;
const SHEETS={
  cash:['1. 6. Сделки с наличными по город',873703202],
  median:['3. 6. Сумма сделок за наличку',1444811463],
  er:['9. 398. Кол-во ЭР по городам',1064449887],
  matrix:['Матрица выплат',1967009773],
  shares:['% ЦО от КВ банка',2138321416],
  registry:['2. 242. Аккредитивы',1023639430],
  'ДомРФ':['2. 242. Кол-во ДОМ.РФ',1083624613],
  'Т-Банк':['3. 242. Кол-во Т-Банк',956533946],
  'Альфа НС':['4. 242. Кол-во Альфа',224528771],
  'ВТБ':['5. 242. Кол-во ВТБ',897439102],
  'Сбер':['6. 242. Кол-во Сбер',1615258198],
  'Совкомбанк':['7. 242. Кол-во Совкомбанк',1692108419],
  'ДомКлик':['8. 242. Кол-во ДомКлик',1554084749],
};
let cache=null,inFlight=null,lastAttempt=0,sourceError=null;
const neverLog=(e)=>e instanceof Error?e.message:'Ошибка загрузки';
function readDisk(){
  try{
    const data=JSON.parse(fs.readFileSync(CACHE,'utf8'));
    if(data?.sourceId===SOURCE_ID&&Array.isArray(data.rows)&&Array.isArray(data.matrix)&&Array.isArray(data.shares))return data;
  }catch{}return null;
}
function persist(data){
  try{fs.mkdirSync(path.dirname(CACHE),{recursive:true});const tmp=CACHE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data));fs.renameSync(tmp,CACHE);}
  catch(e){console.warn('[techlist] Кэш на диске недоступен:',neverLog(e));}
}
async function download(tab){
  const item=SHEETS[tab];
  if(!item)throw Error('Неизвестный лист');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),WAIT);
  try{
    const url='https://docs.google.com/spreadsheets/d/'+SOURCE_ID+'/export?format=csv&gid='+item[1];
    const response=await fetch(url,{signal:controller.signal,headers:{'accept':'text/csv,text/plain;q=0.9,*/*;q=0.2'}});
    if(!response.ok)throw Error('HTTP '+response.status);
    const length=Number(response.headers.get('content-length')||0);
    if(length>MAX_BYTES)throw Error('Размер CSV превышает 32 МБ');
    const type=response.headers.get('content-type')||'';
    if(type.includes('text/html'))throw Error('Вместо CSV открывается HTML (проверьте доступ на чтение Google-таблицы)');
    const text=await response.text();
    if(text.length>MAX_BYTES)throw Error('CSV слишком большой');
    if(!text.trim()||text.trimStart().startsWith('<!DOCTYPE')||text.trimStart().startsWith('<html'))throw Error('Лист вернул не CSV');
    const rows=csvRows(text);
    if(rows.length<2)throw Error('В CSV нет строк данных');
    return rows;
  }finally{clearTimeout(timer);}
}
export async function refreshTechData(){
  if(inFlight)return inFlight;
  lastAttempt=Date.now();
  inFlight=(async()=>{
    const required=['cash','er','matrix','shares','ДомРФ','Т-Банк','Сбер','ВТБ','Совкомбанк'];
    const optional=['median','Альфа НС','ДомКлик'];
    const keys=[...required,...optional];
    const settled=await Promise.allSettled(keys.map(download));
    const files={},warnings=[];
    for(let i=0;i<keys.length;i++){
      const s=settled[i],name=keys[i];
      if(s.status==='fulfilled')files[name]=s.value;
      else if(required.includes(name))throw Error('Лист «'+SHEETS[name][0]+'» недоступен: '+neverLog(s.reason));
      else warnings.push('Лист «'+SHEETS[name][0]+'» недоступен, показатель скрыт.');
    }
    // Registry is optional and large; capture its aggregates only, never client names.
    try{files.registry=await download('registry');}
    catch(e){warnings.push('Реестр АКК недоступен: фактические комиссии не рассчитываются.');}
    const bankPivots={};for(const name of ['ДомРФ','Т-Банк','Сбер','ВТБ','Совкомбанк','Альфа НС','ДомКлик'])if(files[name])bankPivots[name]=files[name];
    const output=buildTechSnapshot({cash:files.cash,er:files.er,median:files.median,matrix:files.matrix,shares:files.shares,bankPivots,registry:files.registry});
    if(!output.diagnostics.cashEntries||!output.diagnostics.matrixRules||!output.diagnostics.erEntries)throw Error('Обязательные данные пусты после разбора; прежний срез сохранён.');
    output.warnings=warnings;
    output.sourceSheetNames=Object.fromEntries(Object.entries(SHEETS).map(([key,x])=>[key,x[0]]));
    cache=output;sourceError=null;persist(output);
    return output;
  })();
  try{return await inFlight;}catch(e){sourceError=neverLog(e);console.warn('[techlist] Ошибка синхронизации:',sourceError);throw e;}
  finally{inFlight=null;}
}
export async function getTechData() {
  if(!cache)cache=readDisk();
  const fresh=cache?.generatedAt&&Date.now()-new Date(cache.generatedAt).getTime()<TTL;
  if(fresh)return {...cache,refreshError:sourceError};
  if(cache){
    if(Date.now()-lastAttempt>10*60*1000)refreshTechData().catch(()=>{});
    return {...cache,refreshError:sourceError,stale:true};
  }
  try{return await refreshTechData();}
  catch(e){throw Error('Источник техлиста недоступен: '+neverLog(e)+'. Для серверной выгрузки нужен доступ Google Sheets на чтение без авторизации.');}
}
