// Private Google Sheets techlist integration via service account (read-only).
// Raw bank registry with client names is only processed in memory; only aggregates are cached.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSign} from 'node:crypto';
import {SOURCE_ID,buildTechSnapshot} from './tech-model.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const CACHE=process.env.TECH_CACHE_FILE||path.join(__dirname,'..','data','tech-cache.json');
const TTL=24*60*60*1000;
const REQUEST_TIMEOUT=45000;
const BATCH_ROWS=7000;
const MAX_SHEET_ROWS=150000;
const SHEETS={
  cash:'1. 6. Сделки с наличными по город',
  median:'3. 6. Сумма сделок за наличку',
  er:'9. 398. Кол-во ЭР по городам',
  matrix:'Матрица выплат',
  shares:'% ЦО от КВ банка',
  registry:'2. 242. Аккредитивы',
  'ДомРФ':'2. 242. Кол-во ДОМ.РФ',
  'Т-Банк':'3. 242. Кол-во Т-Банк',
  'Альфа НС':'4. 242. Кол-во Альфа',
  'ВТБ':'5. 242. Кол-во ВТБ',
  'Сбер':'6. 242. Кол-во Сбер',
  'Совкомбанк':'7. 242. Кол-во Совкомбанк',
  'ДомКлик':'8. 242. Кол-во ДомКлик',
};
const must=['cash','er','matrix','shares','ДомРФ','Т-Банк','Сбер','ВТБ','Совкомбанк'];
let cache=null,refresh=null,lastAttempt=0,error=null,auth=null;
const errString=e=>e instanceof Error?e.message:'Ошибка источника';
const b64=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
function credentials() {
  const source=process.env.TECH_GOOGLE_SERVICE_ACCOUNT_JSON;
  if(!source)throw Error('Не настроена переменная TECH_GOOGLE_SERVICE_ACCOUNT_JSON в Timeweb.');
  let json;
  try{json=JSON.parse(source);}catch{throw Error('Некорректный JSON служебной учётной записи Google.');}
  if(!json.client_email||!json.private_key)throw Error('В переменной отсутствуют client_email или private_key.');
  return json;
}
async function request(url,opts={},attempt=0){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT);
  try{
    const res=await fetch(url,{...opts,signal:controller.signal});
    if(!res.ok){
      if((res.status===429||res.status>=500)&&attempt<2){
        await new Promise(r=>setTimeout(r,1000*(attempt+1)));
        return request(url,opts,attempt+1);
      }
      throw Error('Google API HTTP '+res.status+(res.status===403?' — нет доступа к исходной таблице или API отключён':''));
    }
    return res.json();
  }finally{clearTimeout(timer);}
}
async function accessToken(){
  if(auth&&Date.now()<auth.expires)return auth.token;
  const creds=credentials(),now=Math.floor(Date.now()/1000);
  const payload={iss:creds.client_email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3300};
  const unsigned=b64({alg:'RS256',typ:'JWT'})+'.'+b64(payload);
  const signature=createSign('RSA-SHA256').update(unsigned).sign(creds.private_key).toString('base64url');
  const body=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+signature});
  const res=await request('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body
  });
  if(!res.access_token)throw Error('Google OAuth не вернул токен.');
  auth={token:res.access_token,expires:Date.now()+Math.min(3000,Math.max(60,(res.expires_in||3600)-120))*1000};
  return auth.token;
}
async function googleGet(endpoint) {
  const token=await accessToken();
  // Token is sent in an HTTP header and never logged, stored or returned to the browser.
  return request('https://sheets.googleapis.com/v4/spreadsheets/'+SOURCE_ID+endpoint,{
    headers:{Authorization:'Bearer '+token}
  });
}
async function sheetDimensions(){
  const response=await googleGet('?fields=sheets(properties(title,gridProperties(rowCount)))');
  return new Map((response.sheets||[]).map(s=>[s.properties.title,s.properties.gridProperties.rowCount]));
}
async function readSheet(name,dimensions){
  const size=dimensions.get(name);
  if(!size||size>MAX_SHEET_ROWS)throw Error('Лист не найден или превышает лимит строк: '+name);
  const output=[];
  for(let from=1;from<=size;from+=BATCH_ROWS){
    const until=Math.min(size,from+BATCH_ROWS-1);
    const range="'"+name.replace(/'/g,"''")+"'!A"+from+":Z"+until;
    const params='?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS';
    const response=await googleGet('/values/'+encodeURIComponent(range)+params);
    const part=response.values||[];
    output.push(...part);
    if(part.length<until-from+1)break;
  }
  return output;
}
function disk(){
  try{const x=JSON.parse(fs.readFileSync(CACHE,'utf8'));if(x?.sourceId===SOURCE_ID&&Array.isArray(x.rows)&&Array.isArray(x.matrix))return x;}catch{}
  return null;
}
function persist(data){
  try{fs.mkdirSync(path.dirname(CACHE),{recursive:true});const temp=CACHE+'.tmp';fs.writeFileSync(temp,JSON.stringify(data));fs.renameSync(temp,CACHE);}
  catch(e){console.warn('[techlist] Не удалось сохранить агрегированный кэш:',errString(e));}
}
export async function refreshTechData(){
  if(refresh)return refresh;
  lastAttempt=Date.now();
  refresh=(async()=>{
    const dimensions=await sheetDimensions();
    const keys=Object.keys(SHEETS).filter(k=>k!=='registry');
    const results=await Promise.allSettled(keys.map(k=>readSheet(SHEETS[k],dimensions)));
    const tables={},warnings=[];
    for(let i=0;i<keys.length;i++){
      const name=keys[i],r=results[i];
      if(r.status==='fulfilled')tables[name]=r.value;
      else if(must.includes(name))throw Error('Обязательный лист '+SHEETS[name]+': '+errString(r.reason));
      else warnings.push('Не удалось загрузить '+SHEETS[name]+'.');
    }
    try{tables.registry=await readSheet(SHEETS.registry,dimensions);}
    catch(e){warnings.push('Реестр комиссий недоступен: средний доход скрыт.');}
    const bankPivots={};for(const bank of ['ДомРФ','Т-Банк','Сбер','ВТБ','Совкомбанк','Альфа НС','ДомКлик'])if(tables[bank])bankPivots[bank]=tables[bank];
    const data=buildTechSnapshot({cash:tables.cash,median:tables.median,er:tables.er,
      bankPivots,matrix:tables.matrix,shares:tables.shares,registry:tables.registry});
    if(!data.diagnostics.cashEntries||!data.diagnostics.erEntries||!data.diagnostics.matrixRules)
      throw Error('Техлист не содержит валидных данных по наличным сделкам, ЭР или матрицам.');
    data.warnings=warnings;
    data.sourceSheetNames=SHEETS;
    cache=data;error=null;persist(data);return data;
  })();
  try{return await refresh;}
  catch(e){error=errString(e);console.warn('[techlist] Не удалось обновить источник:',error);throw e;}
  finally{refresh=null;}
}
export async function getTechData(){
  if(!cache)cache=disk();
  if(cache&&Date.now()-new Date(cache.generatedAt).getTime()<TTL)return {...cache,refreshError:error};
  if(cache){
    if(Date.now()-lastAttempt>10*60*1000)refreshTechData().catch(()=>{});
    return {...cache,refreshError:error,stale:true};
  }
  try{return await refreshTechData();}
  catch(e){throw Error('Данные техлиста недоступны: '+errString(e));}
}
