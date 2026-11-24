(function(){
// ==========================================================================
// LOCAL MODELS — one-tap install of open GGUF models into the built-in runtime
//   • curated catalogue of open weights (Hugging Face direct resolve links)
//   • hardware filter: models too heavy for this device's RAM are hidden
//   • search + short "what is it good at" + weight + RAM requirement per model
//   • installed models register as an OpenAI-compatible provider (llama.cpp)
// ==========================================================================
const O=window.OCM,h=O.h,S=O.S;

// size = download weight in bytes (approx), ram = minimum device RAM in GB to run it comfortably
const GB=1024*1024*1024;
const CATALOG=[
  {id:'qwen3-0.6b-q4',name:'Qwen3 0.6B',repo:'Qwen/Qwen3-0.6B-GGUF',file:'Qwen3-0.6B-Q4_K_M.gguf',
   size:0.40*GB,ram:3,ctx:32768,good:'Самая лёгкая: мгновенные ответы, чат и простые правки текста. Работает даже на слабых телефонах.',
   tags:['чат','быстрая','слабые устройства']},
  {id:'qwen3-0.6b-q8',name:'Qwen3 0.6B (Q8)',repo:'Qwen/Qwen3-0.6B-GGUF',file:'Qwen3-0.6B-Q8_0.gguf',
   size:0.64*GB,ram:3,ctx:32768,good:'Та же лёгкая модель, но квантование Q8 — заметно точнее ответы при том же размере.',
   tags:['чат','точность']},
  {id:'qwen2.5-1.5b-q4',name:'Qwen2.5 1.5B Instruct',repo:'Qwen/Qwen2.5-1.5B-Instruct-GGUF',file:'qwen2.5-1.5b-instruct-q4_k_m.gguf',
   size:0.99*GB,ram:4,ctx:32768,good:'Хороший баланс: связные ответы, русский язык, простые инструкции и суммаризация.',
   tags:['русский','инструкции']},
  {id:'llama3.2-1b-q4',name:'Llama 3.2 1B Instruct',repo:'hugging-quants/Llama-3.2-1B-Instruct-Q4_K_M-GGUF',file:'llama-3.2-1b-instruct-q4_k_m.gguf',
   size:0.75*GB,ram:4,ctx:32768,good:'Компактная модель Meta: диалог, перефразирование, лёгкие задачи без интернета.',
   tags:['чат','offline']},
  {id:'gemma2-2b-q4',name:'Gemma 2 2B IT',repo:'bartowski/gemma-2-2b-it-GGUF',file:'gemma-2-2b-it-Q4_K_M.gguf',
   size:1.6*GB,ram:6,ctx:8192,good:'Сильна в рассуждениях и аккуратных письменных ответах для своего размера. Хороший русский.',
   tags:['рассуждения','текст','русский']},
  {id:'qwen2.5-3b-q4',name:'Qwen2.5 3B Instruct',repo:'Qwen/Qwen2.5-3B-Instruct-GGUF',file:'qwen2.5-3b-instruct-q4_k_m.gguf',
   size:1.9*GB,ram:6,ctx:32768,good:'Заметно умнее 1–2B: структурированные ответы, код-подсказки, работа с длинным контекстом.',
   tags:['код','длинный контекст']},
  {id:'llama3.2-3b-q4',name:'Llama 3.2 3B Instruct',repo:'hugging-quants/Llama-3.2-3B-Instruct-Q4_K_M-GGUF',file:'llama-3.2-3b-instruct-q4_k_m.gguf',
   size:1.9*GB,ram:6,ctx:32768,good:'Универсальная: диалог, суммаризация, следование инструкциям. Лучшее качество на 6 ГБ RAM.',
   tags:['инструкции','суммаризация']},
  {id:'qwen2.5-coder-3b-q4',name:'Qwen2.5 Coder 3B',repo:'Qwen/Qwen2.5-Coder-3B-Instruct-GGUF',file:'qwen2.5-coder-3b-instruct-q4_k_m.gguf',
   size:1.9*GB,ram:6,ctx:32768,good:'Заточена под код: генерация, объяснение и правки фрагментов. Лучший локальный «программист» до 2 ГБ.',
   tags:['код','лучшая для кода']},
  {id:'phi3.5-mini-q4',name:'Phi 3.5 Mini',repo:'bartowski/Phi-3.5-mini-instruct-GGUF',file:'Phi-3.5-mini-instruct-Q4_K_M.gguf',
   size:2.2*GB,ram:6,ctx:32768,good:'Microsoft: сильные рассуждения и математика в компактном весе, длинный контекст.',
   tags:['рассуждения','математика']},
  {id:'qwen2.5-7b-q4',name:'Qwen2.5 7B Instruct',repo:'bartowski/Qwen2.5-7B-Instruct-GGUF',file:'Qwen2.5-7B-Instruct-Q4_K_M.gguf',
   size:4.4*GB,ram:8,ctx:32768,good:'Полноценный ассистент: сложный русский, код, анализ. Требует 8+ ГБ RAM, отвечает медленнее.',
   tags:['качество','код','русский']},
  {id:'qwen2.5-coder-7b-q4',name:'Qwen2.5 Coder 7B',repo:'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF',file:'Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf',
   size:4.4*GB,ram:8,ctx:32768,good:'Сильнейший локальный кодер этого списка: целые функции, рефакторинг, объяснение ошибок.',
   tags:['код','лучшая для кода']},
  {id:'llama3.1-8b-q4',name:'Llama 3.1 8B Instruct',repo:'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF',file:'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
   size:4.6*GB,ram:8,ctx:32768,good:'Классика Meta: универсальное качество диалога и инструментов на флагманских телефонах.',
   tags:['качество','универсальная']},
  {id:'mistral-7b-q4',name:'Mistral 7B v0.3',repo:'bartowski/Mistral-7B-Instruct-v0.3-GGUF',file:'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
   size:4.1*GB,ram:8,ctx:32768,good:'Быстрая для 7B, хороша в инструкциях и деловом тексте. Английский сильнее русского.',
   tags:['скорость','инструкции']}
];

const installed=()=>{const v=O.store.get('localModels',[]);return Array.isArray(v)?v:[]};
const saveInstalled=l=>O.store.set('localModels',l);
const deviceRamGB=()=>{
  try{const st=O.native.resourceStats();if(st&&st.ramTotal)return st.ramTotal/GB}catch(_){}
  return 0; // unknown → do not filter
};
const fmtSize=b=>b>=GB?(b/GB).toFixed(1)+' ГБ':Math.round(b/(1024*1024))+' МБ';
const urlFor=m=>'https://huggingface.co/'+m.repo+'/resolve/main/'+m.file;
const destFor=m=>'/root/models/'+m.file;

// ---- install: async download with progress, then register the provider ----
const jobs=new Map(); // id -> {pct, cancel}
async function install(m,row,draw){
  if(jobs.has(m.id))return;
  const dest=destFor(m);
  try{O.native.fs('mkdir','/root/models','')}catch(_){}
  const job={pct:0};jobs.set(m.id,job);draw();
  try{
    const r=await O.native.netDownloadToFileAsync(urlFor(m),{},dest,60*60*1000);
    if(!r||!r.ok)throw new Error((r&&r.err)||O.tr('download failed','скачивание не удалось'));
    const l=installed().filter(x=>x.id!==m.id);
    l.push({id:m.id,name:m.name,file:m.file,path:dest,size:m.size,ctx:m.ctx,at:Date.now()});
    saveInstalled(l);
    await registerProvider(m,dest);
    O.toast(O.tr('Installed: ','Установлена: ')+m.name+' · '+O.tr('start llama-server to use it','запустите llama-server, чтобы использовать'),3500);
  }catch(e){
    try{O.native.fs('delete',dest,'')}catch(_){}
    O.toast(O.tr('Install failed: ','Установка не удалась: ')+(e.message||e),4000);
  }finally{jobs.delete(m.id);draw()}
}

// Register (or refresh) the local llama.cpp provider in opencode.json.
async function registerProvider(m,dest){
  const mid='local-'+m.id;
  let obj={};try{const t=O.native.cfgRead();if(t&&t.trim())obj=O.parseJsonc(t)}catch(_){}
  obj.provider=obj.provider||{};
  const p=obj.provider.llamacpp||{name:'llama.cpp (local)',npm:'@ai-sdk/openai',options:{baseURL:'http://127.0.0.1:8080/v1',apiKey:'local'},models:{}};
  p.models=p.models||{};
  p.models[mid]={name:m.name+' (local)',limit:{context:m.ctx||8192,output:4096}};
  obj.provider.llamacpp=p;
  O.native.cfgWrite(JSON.stringify(obj,null,2));
  try{await O.loadMeta()}catch(_){}
  return mid;
}

function modelCommand(m){
  return 'llama-server -m '+destFor(m)+' --port 8080 --host 127.0.0.1 -c '+Math.min(m.ctx||8192,8192);
}

O.openLocalModels=()=>{
  let q='',hwOnly=true;
  const ram=deviceRamGB();
  const listEl=h('div');
  const qInp=h('input',{placeholder:O.tr('Search local models...','Поиск локальной модели...'),style:{marginBottom:'8px'},oninput:e=>{q=e.target.value.toLowerCase();draw()}});
  const hwRow=O.toggleRow('cpu',
    O.tr('Fit my hardware','Подходит моему железу'),
    ram?O.tr('Device RAM: ','RAM устройства: ')+ram.toFixed(1)+O.tr(' GB — heavy models are hidden',' ГБ — слишком тяжёлые модели скрыты'):O.tr('Hide models too heavy for this device','Скрывать модели, слишком тяжёлые для устройства'),
    hwOnly,v=>{hwOnly=v;draw()});
  const body=h('div',null,qInp,hwRow,listEl);
  const s=O.sheet(O.tr('Local models','Локальные модели'),body,{full:true});
  function draw(){
    listEl.textContent='';
    const inst=installed();
    let items=CATALOG.filter(m=>{
      if(q&&!(m.name+' '+m.good+' '+m.tags.join(' ')).toLowerCase().includes(q))return false;
      if(hwOnly&&ram&&m.ram>ram+0.5)return false;
      return true;
    });
    if(!items.length){listEl.append(h('div',{class:'mut',style:{padding:'16px'}},O.tr('Nothing found. Disable the hardware filter to see all models.','Ничего не найдено. Отключите фильтр по железу, чтобы увидеть все модели.')));return}
    items.forEach(m=>{
      const isInst=inst.some(x=>x.id===m.id);
      const job=jobs.get(m.id);
      const heavy=ram&&m.ram>ram+0.5;
      const card=h('div',{class:'settings-card',style:{marginBottom:'10px',padding:'10px 12px'}});
      card.append(h('div',{style:{display:'flex',alignItems:'center',gap:'8px'}},
        h('div',{class:'grow'},
          h('b',null,m.name),
          h('div',{class:'mut s'},fmtSize(m.size)+' · RAM '+m.ram+'+ ГБ · ctx '+O.fmtK(m.ctx)+(heavy?' · '+O.tr('too heavy for this device','тяжела для устройства'):''))),
        job?h('span',{class:'spin'}):
        isInst?h('span',{class:'badge-model badge-free'},O.tr('Installed','Установлена')):
        h('button',{class:'btn sm pri',onclick:()=>install(m,card,draw)},O.icon('down'),O.tr('Install','Установить'))));
      card.append(h('div',{style:{fontSize:'12.5px',margin:'6px 0',lineHeight:'1.45'}},m.good));
      card.append(h('div',{style:{display:'flex',gap:'5px',flexWrap:'wrap'}},
        m.tags.map(t=>h('span',{class:'chip',style:{fontSize:'10.5px',padding:'2px 8px',pointerEvents:'none'}},t))));
      if(isInst){
        card.append(h('div',{class:'mono s',style:{wordBreak:'break-all',margin:'8px 0',padding:'6px 8px',background:'var(--bg2)',borderRadius:'8px'}},modelCommand(m)));
        card.append(h('div',{style:{display:'flex',gap:'6px',flexWrap:'wrap'}},
          h('button',{class:'btn sm',onclick:()=>{O.native.copy(modelCommand(m));O.toast(O.tr('Command copied — run it in the terminal','Команда скопирована — выполните её в терминале'),2600)}},O.icon('copy'),O.tr('Copy command','Команда')),
          h('button',{class:'btn sm',onclick:()=>{O.native.copy('http://127.0.0.1:8080/v1');O.toast(O.tr('Provider URL copied','URL провайдера скопирован'),2000)}},O.icon('globe'),O.tr('Provider URL','URL')),
          h('button',{class:'btn sm',onclick:async()=>{
            if(!await O.confirm(O.tr('Delete model?','Удалить модель?'),m.name+' · '+fmtSize(m.size),O.tr('Delete','Удалить'),true))return;
            try{O.native.fs('delete',destFor(m),'')}catch(_){}
            saveInstalled(installed().filter(x=>x.id!==m.id));
            draw();O.toast(O.tr('Deleted','Удалено'),1500);
          }},O.icon('trash'),O.tr('Delete','Удалить'))));
      }
      listEl.append(card);
    });
    listEl.append(h('div',{class:'note',style:{marginTop:'10px'}},
      O.tr('Open weights from Hugging Face. After install, run the llama-server command in the built-in terminal; the model appears under the "llama.cpp (local)" provider.','Открытые веса с Hugging Face. После установки выполните команду llama-server во встроенном терминале — модель появится у провайдера «llama.cpp (local)».')));
  }
  draw();
};
})();