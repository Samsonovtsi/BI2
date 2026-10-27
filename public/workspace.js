import {mountRealtors} from './realtors.js';
import {mountCalcCatalog} from './calculator-catalog.js';

/* Новая навигация поверх исходных вкладок BI2. Старые вкладки и обработчики сохранены. */
const sections={
  map:{
    label:'Карта онлайн',description:'Проникновение ЭР и АКК, города, банки, планы и контроль данных',
    tabs:[
      ['overview','Обзор'],['analytics','Сравнение и тепловая карта'],['traffic','Светофор городов'],
      ['city','Карточка города'],['banks','Банки и доход'],['nominal','Номинальные счета'],
      ['plans','Планы'],['reports','Отчёты'],['cosmos','Космос и сверка'],
      ['quality','Отклонения'],['sources','Источники']
    ]
  },
  realtor:{
    label:'Светофор риелторов',description:'Персональная аналитика ЭР, АКК и НС',
    tabs:[['realtors','Рейтинг сотрудников']]
  },
  calc:{
    label:'Калькулятор АКК',description:'Правильный выбор банка, расчёты КВ и удержания ЦО',
    tabs:[['calc','Правильный выбор'],['calc-catalog','Каталоги ставок']]
  }
};
const icons={map:'▥',realtor:'◉',calc:'∑'};
const legacy=new Map();
let activeGroup='map',activeTab='overview';
function parseHash(){
  const m=location.hash.match(/^#\/(map|realtor|calc)(?:\/([a-z-]+))?$/);
  if(!m)return ['map','overview'];
  const section=sections[m[1]],tab=m[2]||section.tabs[0][0];
  return [m[1],section.tabs.some(t=>t[0]===tab)?tab:section.tabs[0][0]];
}
function navigate(group,tab,updateHash=true){
  const target=sections[group];if(!target)return;
  if(!target.tabs.some(t=>t[0]===tab))tab=target.tabs[0][0];
  activeGroup=group;activeTab=tab;
  const original=legacy.get(tab);
  if(original)original.click();
  else{
    document.querySelectorAll('.tabpage').forEach(p=>p.classList.remove('active'));
    document.getElementById('tab-'+tab)?.classList.add('active');
  }
  document.querySelectorAll('.workspace-link').forEach(el=>{
    const selected=el.dataset.workspace===group;
    el.classList.toggle('active',selected);
    el.setAttribute('aria-current',selected?'page':'false');
  });
  const sub=document.getElementById('workspaceSubnav');
  sub.innerHTML=target.tabs.map(t=>'<button type="button" class="workspace-sub-link'+(tab===t[0]?' active':'')+'" data-worktab="'+t[0]+'">'+t[1]+'</button>').join('');
  sub.hidden=target.tabs.length<=1;
  document.querySelector('.main>.filters').hidden=group!=='map';
  document.getElementById('btnUpload').hidden=group!=='map';
  document.getElementById('btnRefresh').hidden=group==='realtor';
  document.getElementById('banner').hidden=group==='realtor';
  document.getElementById('pageTitle').textContent=target.label;
  document.getElementById('pageDesc').textContent=target.description+' · '+target.tabs.find(t=>t[0]===tab)[1];
  const toolbar=document.getElementById('workspaceProductFilters');
  if(toolbar)toolbar.hidden=!(group==='map'&&['analytics','traffic'].includes(tab));
  if(updateHash){const next='#/'+group+'/'+tab;if(location.hash!==next)location.hash=next;}
}
function mount() {
  const old=document.getElementById('nav');
  for(const a of [...old.querySelectorAll('.navlink')])legacy.set(a.dataset.tab,a);
  const storage=document.createElement('div');storage.id='legacyWorkspaceNav';storage.hidden=true;
  for(const a of legacy.values())storage.appendChild(a);
  old.appendChild(storage);
  const buttons=document.createElement('div');buttons.className='workspace-mainlinks';
  buttons.innerHTML=Object.entries(sections).map(([key,value],i)=>
    '<button type="button" class="workspace-link" data-workspace="'+key+'" aria-label="'+value.label+'"><span class="workspace-icon">'+icons[key]+'</span><span class="workspace-item"><b>'+value.label+'</b><small>'+(i===0?'Города и показатели':i===1?'Рейтинг и рекорды':'Банки и комиссии')+'</small></span></button>'
  ).join('');
  old.insertBefore(buttons,storage);
  const content=document.querySelector('.content');
  for(const id of ['realtors','calc-catalog']){
    const section=document.createElement('section');section.className='tabpage';section.id='tab-'+id;content.appendChild(section);
  }
  mountRealtors(document.getElementById('tab-realtors'));
  mountCalcCatalog(document.getElementById('tab-calc-catalog'));
  const sub=document.createElement('div');sub.id='workspaceSubnav';sub.className='workspace-subnav';
  document.querySelector('.main>.filters').before(sub);
  const productFilters=document.createElement('div');
  productFilters.id='workspaceProductFilters';productFilters.className='workspace-product-filters';
  productFilters.hidden=true;sub.after(productFilters);
  setupProductFilters(productFilters);
  setupHeatLegend();
  const mapNote=document.createElement('div');mapNote.className='workspace-footnote';
  mapNote.textContent='Раскрытие до РОП / МОП / СПН и конкретного клиента требует первичных ID сделок, сотрудников и ролевой авторизации. Пока карта считает городские своды, не подменяя их недоступной детализацией.';
  document.getElementById('tab-city').prepend(mapNote);
  const bankNote=document.createElement('div');bankNote.className='workspace-footnote';
  bankNote.textContent='Средний доход в текущем банковском отчёте — на операцию, а не на уникальную сделку. Для среднего на сделку требуется связь дохода с deal_id и правила удержаний.';
  document.getElementById('tab-banks').prepend(bankNote);
  buttons.addEventListener('click',event=>{
    const a=event.target.closest('[data-workspace]');if(a)navigate(a.dataset.workspace,sections[a.dataset.workspace].tabs[0][0]);
  });
  sub.addEventListener('click',event=>{
    const b=event.target.closest('[data-worktab]');if(b)navigate(activeGroup,b.dataset.worktab);
  });
  window.addEventListener('hashchange',()=>{const [g,t]=parseHash();if(g!==activeGroup||t!==activeTab)navigate(g,t,false);});
  const [initialGroup,initialTab]=parseHash();navigate(initialGroup,initialTab,false);
  if(!location.hash)history.replaceState(null,'','#/map/overview');
}
function setupProductFilters(root){
  root.innerHTML='<div class="workspace-filter-heading"><strong>Показатель</strong><span>Настройки периода, ФиФ и города сохраняются отдельно для каждого продукта в этой вкладке</span></div>'+
    '<label>Продукт<select id="hubProduct"><option value="er">ЭР</option><option value="akk">АКК</option><option value="domklik">ДомКлик</option></select></label>'+
    '<label>Период<select id="hubPeriod"></select></label><label>ФиФ<select id="hubCat"></select></label><label>Город<select id="hubCity"></select></label>';
  const keys=['fPeriod','fCat','fCity'],hubs=['hubPeriod','hubCat','hubCity'],saved=new Map();
  let current='er',syncing=false;
  const clone=()=>{keys.forEach((k,i)=>{const source=document.getElementById(k),target=document.getElementById(hubs[i]);target.innerHTML=source.innerHTML;target.value=source.value;});};
  const take=()=>Object.fromEntries(keys.map(k=>[k,document.getElementById(k).value]));
  const use=data=>{
    syncing=true;
    keys.forEach(k=>{
      const e=document.getElementById(k);const val=data?.[k]??'';
      if([...e.options].some(o=>o.value===val)){e.value=val;e.dispatchEvent(new Event('change',{bubbles:true}));}
    });
    syncing=false;clone();
  };
  root.querySelector('#hubProduct').addEventListener('change',e=>{
    saved.set(current,take());current=e.target.value;
    use(saved.get(current)||{fPeriod:document.getElementById('fPeriod').value,fCat:'',fCity:''});
    document.getElementById('analysisMetric').value=current;
    document.getElementById('analysisMetric').dispatchEvent(new Event('change',{bubbles:true}));
    document.getElementById('trafficMetric').value=current;
    document.getElementById('trafficMetric').dispatchEvent(new Event('change',{bubbles:true}));
  });
  hubs.forEach((h,i)=>root.querySelector('#'+h).addEventListener('change',e=>{
    const source=document.getElementById(keys[i]);source.value=e.target.value;
    source.dispatchEvent(new Event('change',{bubbles:true}));
    saved.set(current,take());
  }));
  keys.forEach(k=>document.getElementById(k).addEventListener('change',()=>{
    if(syncing)return;
    saved.set(current,take());clone();
  }));
  document.getElementById('analysisMetric').addEventListener('change',e=>{
    const value=e.target.value;if(value!==current){
      saved.set(current,take());current=value;root.querySelector('#hubProduct').value=value;
      use(saved.get(value)||{fPeriod:document.getElementById('fPeriod').value,fCat:'',fCity:''});
    }
  });
  document.getElementById('trafficMetric').addEventListener('change',e=>{
    const value=e.target.value;if(value!==current){
      saved.set(current,take());current=value;root.querySelector('#hubProduct').value=value;
      use(saved.get(value)||{fPeriod:document.getElementById('fPeriod').value,fCat:'',fCity:''});
    }
  });
  clone();
  // async загрузка из API меняет набор периодов и городов
  new MutationObserver(()=>{if(activeGroup==='map')clone();}).observe(document.getElementById('fPeriod'),{childList:true});
  new MutationObserver(()=>{if(activeGroup==='map')clone();}).observe(document.getElementById('fCity'),{childList:true});
}
function setupHeatLegend(){
  const heat=document.getElementById('heatTable');if(!heat)return;
  const box=document.createElement('div');box.className='workspace-heat-legend';
  box.innerHTML='<b>Цветовые зоны проникновения</b><span class="heat-pill heat-red">менее 30% — красный</span><span class="heat-pill heat-yellow">30–59,9% — жёлтый</span><span class="heat-pill heat-green">60% и выше — зелёный</span><small>Пороги демонстрационные, не утверждённые планы грейдов. ДомКлик оценивается в обратном направлении.</small>';
  heat.closest('.panel').insertBefore(box,heat.closest('.table-wrap'));
  const body=document.getElementById('heatBody');
  const paint=()=>{
    const inverse=document.getElementById('analysisMetric').value==='domklik';
    for(const cell of body.querySelectorAll('.pct-cell')){
      const label=cell.querySelector('.pct-val')?.textContent||'';
      const v=Number(label.replace('%','').replace(',','.'));
      if(!Number.isFinite(v)||label==='—'){cell.removeAttribute('data-grade-zone');continue;}
      cell.dataset.gradeZone=v<30?(inverse?'green':'red'):v<60?'yellow':(inverse?'red':'green');
    }
  };
  new MutationObserver(paint).observe(body,{childList:true});
  document.getElementById('analysisMetric').addEventListener('change',paint);
  paint();
}
mount();
