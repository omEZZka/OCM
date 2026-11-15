(function(){
const O=window.OCM,h=O.h,S=O.S,bus=O.bus;

/**
 * Media factory: image / video / speech / music generation through user-supplied providers.
 *
 * Design notes
 *  • A provider is a plain record the user adds by hand (id, name, base URL, key, models). Nothing
 *    is hard-coded: any OpenAI-compatible image/audio endpoint works, plus a "custom" mode where
 *    the request path and JSON shape are user-defined.
 *  • Generation runs in a small in-app queue so long video jobs survive tab switches, report
 *    progress through notifications, and can be cancelled.
 *  • Results are files on disk; the chat only ever sees a path + mime, never a base64 blob.
 */
const M=O.media={
  queue:[],           // {id, kind, prompt, model, provider, params, state, started, path, error}
  running:0,
  maxParallel:2,
  history:[],
  folder:'/sdcard/Download/OCM/media'
};

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// Media files are served through a WebView route: file:// is blocked by allowFileAccess=false.
O.mediaUrl=path=>{
  try{
    const b64=btoa(unescape(encodeURIComponent(String(path||'')))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    return 'https://appassets.androidplatform.net/_media/'+b64;
  }catch(_){return ''}
};
const slug=s=>String(s||'').toLowerCase().replace(/[^a-zа-я0-9]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,40)||'media';
const stamp=()=>new Date().toISOString().replace(/[-:T]/g,'').slice(0,14);

// ---- provider storage ----
// Keys never go to localStorage: each provider key lives in the Keystore-backed secure store, the
// localStorage record only keeps the non-secret fields plus an `hasKey` marker.
O.mediaProviders=()=>{
  const stored=O.store.get('mediaProviders',[]);
  const list=Array.isArray(stored)?stored:[];
  let migrated=false;
  const out=list.map(p=>{
    if(!p||typeof p!=='object')return p;
    const rec=Object.assign({},p);
    if(rec.apiKey){
      // legacy plaintext record: move the key into the secure store once, but keep it in memory
      // for this call (a queued job may use it right away)
      if(O.native.securePut('media.provider.'+rec.id,rec.apiKey)){migrated=true;rec.hasKey=true}
    }else if(rec.id&&rec.hasKey){
      rec.apiKey=O.native.secureGet('media.provider.'+rec.id)
    }
    return rec;
  });
  if(migrated)O.store.set('mediaProviders',out.map(p=>{const c=Object.assign({},p);delete c.apiKey;return c}));
  return out;
};
O.saveMediaProviders=list=>{
  const stored=[];
  const keep=new Set();
  for(const p of (list||[]).slice(0,40)){
    if(!p||!p.id)continue;
    keep.add(p.id);
    const copy=Object.assign({},p);
    if(copy.apiKey)copy.hasKey=true;else delete copy.hasKey;
    if(copy.apiKey&&!O.native.securePut('media.provider.'+copy.id,copy.apiKey))throw new Error(O.tr('Could not store the API key securely','Не удалось безопасно сохранить API-ключ'));
    delete copy.apiKey;
    stored.push(copy);
  }
  // A deleted provider must not leave its key behind in the Keystore store.
  try{for(const p of O.store.get('mediaProviders',[]))if(p&&p.id&&!keep.has(p.id))O.native.secureRemove('media.provider.'+p.id)}catch(_){}
  O.store.set('mediaProviders',stored);bus.emit('media')
};
O.mediaProvider=id=>O.mediaProviders().find(p=>p.id===id)||null;
O.mediaProvidersOf=kind=>O.mediaProviders().filter(p=>p.kind===kind);

O.mediaFolder=()=>O.store.get('mediaFolder',M.folder);
O.setMediaFolder=f=>{O.store.set('mediaFolder',f||M.folder);bus.emit('media')};

O.mediaHistory=()=>O.store.get('mediaHistory',[]);
const pushHistory=entry=>{
  const l=O.mediaHistory();
  l.unshift(entry);
  O.store.set('mediaHistory',l.slice(0,200));
  bus.emit('media');
};

// ---- prompt language ----
// The old "auto-translate" toggle never translated anything (the helper below just posted a
// prompt into the user's chat and returned the original text), so the switch only promised a
// feature that did not exist. Prompts are now sent exactly as typed, and the setting is gone.

// ---- request building ----
const KIND_CFG={
  image:{path:'/images/generations',body:p=>({model:p.model,prompt:p.prompt,n:Number(p.n)||1,size:p.size||'1024x1024',response_format:'b64_json'})},
  video:{path:'/videos/generations',body:p=>({model:p.model,prompt:p.prompt,duration:clamp(p.duration||5,1,60),size:p.size||'1280x720'})},
  tts:{path:'/audio/speech',body:p=>({model:p.model,input:p.prompt,voice:p.voice||'alloy',response_format:p.format||'mp3'})},
  voice:{path:'/audio/voices',body:p=>({name:p.name||('voice-'+stamp()),samples:p.samples||[]})},
  music:{path:'/music/generations',body:p=>({model:p.model,prompt:p.prompt,duration:clamp(p.duration||30,5,60)})}
};
const EXT={image:'png',video:'mp4',tts:'mp3',voice:'json',music:'mp3'};

const guessUrl=p=>String(p.baseURL||'').replace(/\/+$/,'');
const hostOf=url=>{try{return new URL(url).host.toLowerCase()}catch(_){return''}};

// ---- queue ----
let seq=0;
O.mediaGenerate=opts=>{
  const job={
    id:'m'+(++seq)+'_'+Date.now().toString(36),
    kind:opts.kind, prompt:opts.prompt||'', model:opts.model||'',
    provider:opts.provider, params:opts.params||{},
    state:'queued', started:0, finished:0, path:'', error:'', progress:0
  };
  M.queue.push(job);
  bus.emit('media');
  pump();
  return job.id;
};
const pump=()=>{
  while(M.running<M.maxParallel){
    const job=M.queue.find(j=>j.state==='queued');
    if(!job)return;
    job.state='running';job.started=Date.now();M.running++;
    bus.emit('media');
    runJob(job).finally(()=>{M.running--;bus.emit('media');pump()});
  }
};
O.mediaCancel=id=>{
  const j=M.queue.find(x=>x.id===id);
  if(j&&j.state==='queued'){j.state='cancelled';j.finished=Date.now();bus.emit('media')}
};

async function runJob(job){
  const prov=O.mediaProvider(job.provider);
  if(!prov){job.state='error';job.error=O.tr('Provider not found','Провайдер не найден');job.finished=Date.now();return}
  if(!prov.apiKey&&prov.requireKey!==false){job.state='error';job.error=O.tr('No API key','Нет API-ключа');job.finished=Date.now();return}
  const cfg=KIND_CFG[job.kind]||KIND_CFG.image;
  const path=(prov.paths&&prov.paths[job.kind])||cfg.path;
  const url=guessUrl(prov)+path;
  const body=Object.assign(cfg.body(Object.assign({},job.params,{prompt:job.prompt,model:job.model})),prov.extraBody||{});
  const dest=(prov.folder||O.mediaFolder())+'/'+job.kind+'/'+stamp()+'_'+slug(job.prompt)+'.'+EXT[job.kind];
  const headers=Object.assign({'Content-Type':'application/json'},prov.headers||{});
  if(prov.apiKey){
    if(prov.authStyle==='x-api-key')headers['x-api-key']=prov.apiKey;
    else if(prov.authStyle==='query'){/* handled by caller in baseURL */}
    else headers['Authorization']='Bearer '+prov.apiKey;
  }
  try{
    // Async: a blocking bridge call froze the whole WebView (queue, tabs) until the provider answered.
    const r=await (O.native.netPostToFileAsync||O.native.netPostToFile)(url,headers,JSON.stringify(body),dest,job.kind==='video'?600000:240000);
    if(!r||!r.ok)throw new Error((r&&r.err)||('HTTP '+(r&&r.status)));
    if(r.json){
      // JSON handshake: find a URL or inline base64
      let data=null;
      try{data=JSON.parse(r.body||'{}')}catch(_){}
      const urlFound=findMediaUrl(data);
      const b64=findBase64(data);
      if(urlFound){
        // Never forward provider credentials to a third-party CDN host: the signed URL is enough,
        // and sending the key there leaked it to anyone able to answer the API call.
        const sameHost=hostOf(urlFound)===hostOf(url);
        const dlHeaders=sameHost?headers:Object.assign({},{'Content-Type':'application/json'});
        const d2=await (O.native.netDownloadToFileAsync||O.native.netDownloadToFile)(urlFound,dlHeaders,dest,240000);
        if(!d2||!d2.ok)throw new Error(d2&&d2.err||O.tr('Download failed','Не удалось скачать файл'));
        job.path=d2.path||dest;
      }else if(b64){
        const d3=O.native.writeDataUrlToFile(b64,dest);
        if(!d3||!d3.ok)throw new Error(d3&&d3.err||O.tr('Cannot save file','Не удалось сохранить файл'));
        job.path=d3.path||dest;
      }else{
        throw new Error(O.tr('Response has no media','В ответе нет медиа'));
      }
    }else{
      job.path=r.path||dest;
    }
    job.state='done';job.finished=Date.now();job.progress=100;
    pushHistory({id:job.id,kind:job.kind,prompt:job.prompt,model:job.model,provider:prov.id,path:job.path,at:job.finished});
    O.native.notifyMedia(O.tr('Media ready','Медиа готово'),job.kind+' · '+(job.prompt||'').slice(0,60));
    bus.emit('media');
  }catch(e){
    job.state='error';job.error=e.message||String(e);job.finished=Date.now();
    O.native.notifyMedia(O.tr('Media failed','Медиа не создано'),job.error.slice(0,80));
    bus.emit('media');
  }
}

// Recursively look for a media URL or a base64 payload in a provider response.
function findMediaUrl(o){
  if(!o||typeof o!=='object')return '';
  for(const k in o){
    const v=o[k];
    if(typeof v==='string'&&/^https?:\/\//i.test(v)&&/\.(png|jpe?g|webp|gif|mp4|webm|mp3|wav|m4a|ogg)(\?|$)/i.test(v))return v;
    if(typeof v==='string'&&/^https?:\/\//i.test(v)&&/(image|video|audio|media|file|output)/i.test(k))return v;
    if(Array.isArray(v)){for(const it of v){const r=findMediaUrl(it);if(r)return r}}
    else if(typeof v==='object'){const r=findMediaUrl(v);if(r)return r}
  }
  return '';
}
function findBase64(o){
  if(!o||typeof o!=='object')return '';
  for(const k in o){
    const v=o[k];
    if(typeof v==='string'){
      if(v.startsWith('data:'))return v;
      if(/^[A-Za-z0-9+/]{200,}={0,2}$/.test(v))return 'data:application/octet-stream;base64,'+v;
    }
    if(Array.isArray(v)){for(const it of v){const r=findBase64(it);if(r)return r}}
    else if(typeof v==='object'){const r=findBase64(v);if(r)return r}
  }
  return '';
}

// ---- sending to chat ----
// Media reaches the chat as a real attachment: the file path plus a mime type, so the message
// renders with a player/preview and the agent can open it like any other file.
O.mediaSendToChat=async (item,text)=>{
  const path=item.path||item;
  const kind=item.kind||guessKind(path);
  const mime=kind==='image'?'image/png':kind==='video'?'video/mp4':kind==='music'||kind==='tts'?'audio/mpeg':'application/octet-stream';
  const name=O.basename(path);
  try{
    if(!S.sid)await O.newSession();
    const mid=O.mid();
    const parts=[{type:'file',mime,filename:name,url:O.mediaUrl(path),source:{type:'file',path,text:{value:'@'+name,start:0,end:0}}}];
    if(text)parts.unshift({type:'text',text:String(text)});
    await O.api('POST','/session/'+S.sid+'/prompt_async',{messageID:mid,agent:S.agent,model:S.model,parts},{timeout:30000});
    O.toast(O.tr('Sent to chat','Отправлено в чат'),1800);
  }catch(e){O.toast(e.message||String(e),4000)}
};
function guessKind(p){
  const e=O.ext(p);
  if(['png','jpg','jpeg','webp','gif'].includes(e))return 'image';
  if(['mp4','webm','mov'].includes(e))return 'video';
  if(['mp3','wav','m4a','ogg','flac'].includes(e))return 'tts';
  return 'image';
}

// ---- UI ----
const KIND_TABS=[['image',O.tr('Photo','Фото'),'image'],['video',O.tr('Video','Видео'),'film'],['tts',O.tr('Voice','Голос'),'wave'],['music',O.tr('Music','Музыка'),'note'],['history',O.tr('History','История'),'list']];

O.openMedia=kind=>{
  const body=h('div',{class:'media-body'});
  const tabs=h('div',{class:'seg media-tabs'});
  const pane=h('div',{class:'media-pane'});
  const s=O.sheet(O.tr('Media','Медиа'),h('div',{class:'media-wrap'},tabs,pane),{full:true});
  let cur=kind||'image';

  const drawTabs=()=>{
    tabs.textContent='';
    KIND_TABS.forEach(([k,label,icon])=>{
      tabs.append(h('button',{class:cur===k?'on':'',onclick:()=>{cur=k;drawTabs();draw()}},O.icon(icon||'image'),h('span',null,label)));
    });
  };
  const draw=()=>{
    pane.textContent='';
    if(cur==='history'){drawHistory(pane);return}
    drawGenerator(pane,cur);
  };
  drawTabs();draw();
};

function providerSelect(kind){
  const list=O.mediaProvidersOf(kind);
  if(!list.length)return null;
  const sel=O.store.get('media.lastProvider.'+kind,list[0].id);
  return {list,sel,cur:list.find(p=>p.id===sel)||list[0]};
}

function drawGenerator(pane,kind){
  const ps=providerSelect(kind);
  if(!ps){
    pane.append(h('div',{class:'media-empty'},
      O.icon('cpu'),
      h('b',null,O.tr('No provider for this type yet','Для этого типа ещё нет провайдера')),
      h('span',{class:'mut s'},O.tr('Add one with its base URL and API key.','Добавьте провайдера: адрес и API-ключ.')),
      h('button',{class:'btn pri wide',style:{marginTop:'12px'},onclick:()=>O.openMediaProvider(null,kind)},O.icon('plus'),O.tr('Add provider','Добавить провайдера'))));
    return;
  }
  const state={provider:ps.cur,model:(ps.cur.models&&ps.cur.models[0])||'',prompt:'',params:{}};
  const promptTa=h('textarea',{rows:4,class:'mono',placeholder:kind==='tts'
    ?O.tr('Text to read aloud…','Текст для озвучки…')
    :O.tr('Describe what to create…','Опишите, что создать…')});
  const actionBar=h('div',{class:'media-actions'});
  const info=h('div',{class:'mut s',style:{margin:'6px 2px'}});

  const drawHead=()=>{
    actionBar.textContent='';
    // provider + model pickers
    const provBtn=h('button',{class:'chip',onclick:()=>{
      O.actions(O.tr('Provider','Провайдер'),ps.list.map(p=>({label:p.name,icon:p.id===state.provider.id?'check':'cloud',fn:()=>{state.provider=p;state.model=(p.models&&p.models[0])||'';O.store.set('media.lastProvider.'+kind,p.id);drawHead()}}))
        .concat([{label:O.tr('Add provider…','Добавить провайдера…'),icon:'plus',fn:()=>O.openMediaProvider(null,kind)}]));
    }},O.icon('cloud'),h('span',null,state.provider.name));
    const models=state.provider.models||[];
    const modelBtn=h('button',{class:'chip',onclick:()=>{
      if(!models.length)return O.toast(O.tr('This provider has no models','У провайдера нет моделей'),2500);
      O.actions(O.tr('Model','Модель'),models.map(m=>({label:m,icon:m===state.model?'check':'cpu',fn:()=>{state.model=m;drawHead()}})));
    }},O.icon('cpu'),h('span',null,state.model||O.tr('Model','Модель')));
    actionBar.append(provBtn,modelBtn);
    info.textContent=state.provider.baseURL||'';
  };
  drawHead();

  const paramsBox=h('div',{class:'media-params'});
  const drawParams=()=>{
    paramsBox.textContent='';
    const row=(label,key,options,def)=>{
      const cur=state.params[key]||def;
      const b=h('button',{class:'chip',onclick:()=>{
        const i=options.findIndex(o=>o[0]===cur);
        state.params[key]=options[(i+1)%options.length][0];
        drawParams();
      }},label+': '+((options.find(o=>o[0]===cur)||options[0])[1]));
      return b;
    };
    if(kind==='image'||kind==='video'){
      paramsBox.append(row(O.tr('Size','Размер'),'size',
        kind==='image'?[['1024x1024','1024²'],['1536x1024','3:2'],['1024x1536','2:3'],['512x512','512²']]:[['1280x720','720p'],['1920x1080','1080p'],['720x1280','9:16']],
        kind==='image'?'1024x1024':'1280x720'));
      paramsBox.append(row(O.tr('Count','Кол-во'),'n',[['1','1'],['2','2'],['4','4']],'1'));
    }
    if(kind==='video'||kind==='music'){
      paramsBox.append(row(O.tr('Duration','Длительность'),'duration',[['5','5s'],['10','10s'],['15','15s'],['30','30s'],['60','60s']],'5'));
    }
    if(kind==='tts'){
      const voices=state.params.voice||O.store.get('media.voice','alloy');
      paramsBox.append(h('button',{class:'chip',onclick:()=>{
        const list=['alloy','echo','fable','onyx','nova','shimmer','руский-1'];
        O.actions(O.tr('Voice','Голос'),list.map(v=>({label:v,icon:v===voices?'check':'wave',fn:()=>{state.params.voice=v;O.store.set('media.voice',v);drawParams()}})));
      }},O.icon('wave'),O.tr('Voice','Голос')+': '+voices));
    }
  };
  drawParams();

  const improveBtn=h('button',{class:'chip',onclick:async()=>{
    const cur=promptTa.value.trim();
    if(!cur)return O.toast(O.tr('Type a prompt first','Сначала введите запрос'),2000);
    // The old handler just re-assigned the same text and showed a toast: it never did anything.
    // Hand the prompt to the agent in the chat and switch there, so the user can send it.
    O.insertText(O.tr('Improve this generation prompt, keep it one paragraph, reply with the prompt only:\n\n','Улучши этот промпт для генерации, оставь один абзац, ответь только промптом:\n\n')+cur);
    O.setTab('chat');
    O.toast(O.tr('Prompt copied to the chat','Промпт перенесён в чат'),2000);
  }},O.icon('bulb'),O.tr('Improve prompt','Улучшить промпт'));

  const genBtn=h('button',{class:'btn pri wide',style:{marginTop:'10px'},onclick:()=>{
    const prompt=promptTa.value.trim();
    if(!prompt)return O.toast(O.tr('Type a prompt','Введите запрос'),2000);
    if(!state.model)return O.toast(O.tr('Pick a model','Выберите модель'),2000);
    O.mediaGenerate({kind,prompt,model:state.model,provider:state.provider.id,params:Object.assign({},state.params)});
    O.toast(O.tr('Queued','В очереди'),1500);
    drawQueue(queueBox);
  }},O.icon('zap'),O.tr('Generate','Сгенерировать'));

  const queueBox=h('div',{class:'media-queue'});
  pane.append(actionBar,info,promptTa,h('div',{class:'media-row'},improveBtn),paramsBox,genBtn,queueBox);
  drawQueue(queueBox);
  // Jobs change state outside this view (queue pump, notifications): repaint while it is on screen.
  const off=bus.on('media',()=>{if(queueBox.isConnected)drawQueue(queueBox);else off()});
}

function drawQueue(box){
  box.textContent='';
  const jobs=M.queue.filter(j=>j.state!=='done'||Date.now()-(j.finished||0)<120000).slice(-8).reverse();
  if(!jobs.length)return;
  box.append(h('div',{class:'grp'},O.tr('Jobs','Задачи')));
  jobs.forEach(j=>{
    const pct=j.state==='done'?100:j.state==='running'?Math.min(95,(Date.now()-(j.started||Date.now()))/100):0;
    box.append(h('div',{class:'media-job'},
      h('div',{class:'media-job-top'},
        h('b',null,j.kind+' · '+(j.model||'')),
        h('span',{class:'mut s'},j.state)),
      h('div',{class:'media-bar'},h('i',{style:{width:pct+'%'}})),
      j.prompt?h('div',{class:'mut s media-clip'},j.prompt):null,
      j.error?h('div',{class:'err s'},j.error):null,
      h('div',{class:'media-job-actions'},
        j.state==='queued'?h('button',{class:'chip',onclick:()=>{O.mediaCancel(j.id);drawQueue(box)}},O.icon('x'),O.tr('Cancel','Отмена')):null,
        j.state==='done'?h('button',{class:'chip',onclick:()=>O.mediaSendToChat({path:j.path,kind:j.kind},j.prompt)},O.icon('chat'),O.tr('To chat','В чат')):null,
        j.state==='done'?h('button',{class:'chip',onclick:()=>O.mediaPreview(j)},O.icon('eye'),O.tr('Open','Открыть')):null)));
  });
}

O.mediaPreview=item=>{
  const path=item.path||item;
  const kind=item.kind||guessKind(path);
  const body=h('div',{class:'media-preview'});
  const s=O.sheet(O.basename(path),body,{full:true});
  if(kind==='image')body.append(h('img',{src:O.mediaUrl(path),style:{maxWidth:'100%',borderRadius:'12px'}}));
  else if(kind==='video')body.append(h('video',{src:O.mediaUrl(path),controls:true,style:{width:'100%',borderRadius:'12px'}}));
  else body.append(h('audio',{src:O.mediaUrl(path),controls:true,style:{width:'100%'}}));
  body.append(h('div',{class:'mut s',style:{marginTop:'8px',wordBreak:'break-all'}},path));
  body.append(h('div',{style:{display:'flex',gap:'8px',marginTop:'10px'}},
    h('button',{class:'btn grow',onclick:()=>O.mediaSendToChat({path,kind},item.prompt)},O.icon('chat'),O.tr('To chat','В чат')),
    h('button',{class:'btn grow',onclick:()=>{O.native.copy(path);s.close()}},O.icon('copy'),O.tr('Copy path','Копировать путь'))));
};

function drawHistory(pane){
  const list=O.mediaHistory();
  if(!list.length){
    pane.append(h('div',{class:'media-empty'},O.icon('list'),h('b',null,O.tr('Nothing generated yet','Пока ничего не создано'))));
    return;
  }
  const grid=h('div',{class:'media-grid'});
  list.forEach(it=>{
    const kind=it.kind||guessKind(it.path);
    const thumb=kind==='image'
      ?h('img',{src:O.mediaUrl(it.path),loading:'lazy'})
      :h('div',{class:'media-thumb-icon'},O.icon(kind==='video'?'film':kind==='music'?'note':'wave'));
    grid.append(h('button',{class:'media-cell',onclick:()=>O.mediaPreview(it),oncontextmenu:e=>{e.preventDefault();O.mediaItemActions(it)}},thumb,
      h('span',{class:'media-cell-tag'},it.kind)));
  });
  pane.append(h('div',{class:'media-history-head'},
    h('b',{class:'grow'},O.mediaHistory().length+' '+O.tr('items','элементов')),
    h('button',{class:'ibtn s',onclick:async()=>{
      // window.confirm() is silently false in a WebView without onJsConfirm, so the old call
      // never cleared anything.
      if(!await O.confirm(O.tr('Clear history?','Очистить историю?'),O.tr('Only the list is cleared, files stay on disk.','Очищается только список, файлы остаются на диске.'),O.tr('Clear','Очистить'),true))return;
      O.store.set('mediaHistory',[]);bus.emit('media');
    }},O.icon('trash'))),grid);
}
O.mediaItemActions=it=>{
  O.actions(O.basename(it.path),[
    {label:O.tr('Open','Открыть'),icon:'eye',fn:()=>O.mediaPreview(it)},
    {label:O.tr('Send to chat','Отправить в чат'),icon:'chat',fn:()=>O.mediaSendToChat(it,it.prompt)},
    {label:O.tr('Repeat prompt','Повторить промпт'),icon:'refresh',fn:()=>O.mediaGenerate({kind:it.kind,prompt:it.prompt,model:it.model,provider:it.provider,params:{}})},
    {label:O.tr('Copy path','Копировать путь'),icon:'copy',fn:()=>O.native.copy(it.path)},
    {label:O.tr('Delete file','Удалить файл'),icon:'trash',danger:true,fn:()=>{O.native.fs('delete',it.path);O.store.set('mediaHistory',O.mediaHistory().filter(x=>x.path!==it.path));bus.emit('media')}}
  ]);
};

// ---- provider editor ----
O.openMediaProvider=(existing,kind)=>{
  const p=existing?Object.assign({},existing):{id:'',name:'',kind:kind||'image',baseURL:'',apiKey:'',models:[],paths:{},api:'openai'};
  const body=h('div');
  const s=O.sheet(existing?O.tr('Edit provider','Изменить провайдера'):O.tr('New media provider','Новый медиа-провайдер'),body,{full:true});
  const idInp=h('input',{value:p.id,placeholder:'id (латиница)'});
  const nameInp=h('input',{value:p.name,placeholder:O.tr('Display name','Название')});
  const kindSel=h('div',{class:'seg'},[['image','Фото'],['video','Видео'],['tts','Голос'],['music','Музыка']].map(([k,l])=>
    h('button',{class:p.kind===k?'on':'',onclick:e=>{
      if(pathInp&&String(pathInp.value||'').trim()){p.paths=Object.assign({},p.paths||{});p.paths[p.kind]=String(pathInp.value).trim()}
      p.kind=k;[...kindSel.children].forEach(b=>b.classList.remove('on'));e.currentTarget.classList.add('on');
      if(pathInp)pathInp.value=(p.paths&&p.paths[k])||'';
    }},l)));
  const urlInp=h('input',{class:'mono',value:p.baseURL,placeholder:'https://api.example.com/v1'});
  const pathInp=h('input',{class:'mono',value:(p.paths&&p.paths[p.kind])||'',placeholder:'/images/generations'});
  const authStyle=(p.authStyle==='x-api-key')?'x-api-key':'bearer';
  const authSel=h('div',{class:'seg'},[['bearer','Authorization: Bearer'],['x-api-key','x-api-key']].map(([k,l])=>
    h('button',{class:authStyle===k?'on':'',onclick:e=>{p.authStyle=k;[...authSel.children].forEach(b=>b.classList.remove('on'));e.currentTarget.classList.add('on')}},l)));
  const extraInp=h('textarea',{class:'mono',rows:3,placeholder:'{"quality":"hd"}'});
  extraInp.value=p.extraBody?JSON.stringify(p.extraBody):'';
  // A stored key is never echoed back into the field: an empty field means "keep the current key",
  // so editing other settings cannot accidentally wipe it either.
  const keyInp=h('input',{type:'password',class:'mono',value:'',placeholder:existing&&p.apiKey?O.tr('Key saved — leave empty to keep','Ключ сохранён — оставьте пустым, чтобы не менять'):'API key'});
  const modelsBox=h('div',{class:'fchips'});
  const status=h('div',{class:'mut s',style:{margin:'8px 0'}});
  const drawModels=()=>{
    modelsBox.textContent='';
    (p.models||[]).forEach((m,i)=>modelsBox.append(h('span',{class:'chip keep'},m,
      h('button',{class:'chip-x',onclick:()=>{p.models.splice(i,1);drawModels()}},O.icon('x')))));
    modelsBox.append(h('button',{class:'chip',onclick:async()=>{
      const v=await O.ask(O.tr('Model id','ID модели'),O.tr('Exact id as the provider lists it','Точный ID из списка провайдера'));
      if(v){p.models=(p.models||[]).concat([v.trim()]);drawModels()}
    }},O.icon('plus'),O.tr('Add id','Добавить ID')));
  };
  drawModels();
  const probe=h('button',{class:'btn wide',style:{marginTop:'8px'},onclick:async()=>{
    status.textContent=O.tr('Probing…','Проверяю…');
    const url=String(urlInp.value||'').replace(/\/+$/,'');
    if(!url)return status.textContent=O.tr('Base URL is required','Нужен Base URL');
    const probeKey=String(keyInp.value||'').trim()||p.apiKey||'';
    const r=await (O.native.netGetAsync?O.native.netGetAsync(url+'/models',{'Authorization':'Bearer '+probeKey},20000):Promise.resolve(O.native.netGet(url+'/models',{'Authorization':'Bearer '+probeKey},20000)));
    if(r&&r.ok&&r.body){
      try{
        const o=JSON.parse(r.body);
        const arr=Array.isArray(o)?o:(o.data||o.models||[]);
        const ids=arr.map(x=>typeof x==='string'?x:(x.id||x.name)).filter(Boolean);
        if(ids.length){p.models=[...new Set((p.models||[]).concat(ids))];drawModels();status.textContent=O.tr('Found models: ','Найдено моделей: ')+ids.length}
        else status.textContent=O.tr('Connected, but the list is empty','Подключение есть, список пуст');
      }catch(e){status.textContent=O.tr('Response is not JSON','Ответ не JSON')}
    }else status.textContent=O.tr('Failed: ','Ошибка: ')+((r&&(r.err||('HTTP '+r.status)))||'');
  }},O.icon('search'),O.tr('Probe /models','Прозвонить /models'));

  const save=h('button',{class:'btn pri wide',style:{marginTop:'12px'},onclick:()=>{
    const id=String(idInp.value||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'');
    if(!id)return O.toast(O.tr('Provider id is required','Нужен ID провайдера'),2500);
    if(!String(urlInp.value||'').trim())return O.toast(O.tr('Base URL is required','Нужен Base URL'),2500);
    const paths=Object.assign({},p.paths||{});
    const extraRaw=String(extraInp.value||'').trim();
    let extraBody=null;
    if(extraRaw){
      try{extraBody=JSON.parse(extraRaw)}catch(_){return O.toast(O.tr('Extra body must be valid JSON','Доп. параметры должны быть корректным JSON'),3000)}
      if(!extraBody||typeof extraBody!=='object'||Array.isArray(extraBody))return O.toast(O.tr('Extra body must be a JSON object','Доп. параметры должны быть JSON-объектом'),3000);
    }
    const pathValue=String(pathInp.value||'').trim();
    if(pathValue)paths[p.kind]=pathValue;else delete paths[p.kind];
    const rec={id,name:String(nameInp.value||id),kind:p.kind,baseURL:String(urlInp.value||'').trim(),
      apiKey:(String(keyInp.value||'').trim()||(existing?p.apiKey:'')),models:(p.models||[]).slice(0,200),paths,
      authStyle:p.authStyle==='x-api-key'?'x-api-key':'bearer',headers:p.headers||{}};
    if(extraBody)rec.extraBody=extraBody;
    const list=O.mediaProviders().filter(x=>x.id!==id);
    list.push(rec);
    try{O.saveMediaProviders(list)}catch(e){return O.toast(e.message||String(e),3500)}
    O.toast(O.tr('Saved','Сохранено'),1500);
    s.close();
  }},O.icon('check'),O.tr('Save','Сохранить'));

  body.append(h('div',{class:'field'},h('label',null,O.tr('Provider id','ID провайдера')),idInp),
    h('div',{class:'field'},h('label',null,O.tr('Name','Название')),nameInp),
    h('div',{class:'field'},h('label',null,O.tr('Kind','Тип')),kindSel),
    h('div',{class:'field'},h('label',null,O.tr('Base URL','Базовый адрес')),urlInp),
    h('div',{class:'field'},h('label',null,O.tr('Request path','Путь запроса')),pathInp),
    h('div',{class:'field'},h('label',null,O.tr('Auth header','Заголовок авторизации')),authSel),
    h('div',{class:'field'},h('label',null,O.tr('API key','API-ключ')),keyInp),
    h('div',{class:'field'},h('label',null,O.tr('Extra JSON body','Доп. JSON в запросе')),extraInp),
    h('div',{class:'field'},h('label',null,O.tr('Models','Модели')),modelsBox),
    probe,status,save);
  if(existing)body.append(h('button',{class:'btn dng wide',style:{marginTop:'8px'},onclick:()=>{
    O.saveMediaProviders(O.mediaProviders().filter(x=>x.id!==existing.id));s.close();
  }},O.icon('trash'),O.tr('Delete provider','Удалить провайдера')));
};

// ---- settings entry ----
O.openMediaSettings=()=>{
  const body=h('div');
  O.sheet(O.tr('Media settings','Настройки медиа'),body,{hud:true});
  const draw=()=>{
    body.textContent='';
    body.append(h('div',{class:'grp'},O.tr('Providers','Провайдеры')));
    const list=O.mediaProviders();
    if(!list.length)body.append(h('div',{class:'note'},O.tr('No providers yet. Photo, video, voice and music each need one.','Провайдеров нет. Для фото, видео, голоса и музыки нужен хотя бы один.')));
    list.forEach(p=>body.append(O.listRow('cloud',p.name,p.kind+' · '+p.baseURL,O.icon('chevR'),()=>{O.openMediaProvider(p);setTimeout(draw,400)})));
    body.append(h('button',{class:'btn pri wide',style:{marginTop:'8px'},onclick:()=>{O.openMediaProvider(null,'image');setTimeout(draw,400)}},O.icon('plus'),O.tr('Add provider','Добавить провайдера')));
    body.append(h('div',{class:'grp',style:{marginTop:'14px'}},O.tr('Saving','Сохранение')));
    body.append(O.listRow('folder',O.tr('Save folder','Папка сохранения'),O.mediaFolder(),O.icon('chevR'),()=>{
      O.browseDir(O.mediaFolder(),dir=>{O.setMediaFolder(dir);draw()});
    }));
    body.append(O.listRow('globe',O.tr('Prompt language','Язык промптов'),O.tr('Sent as typed','Отправляется как введено'),O.icon('info'),()=>{
      O.toast(O.tr('Prompts are sent to the provider exactly as you type them.','Промпт уходит провайдеру ровно так, как вы его написали.'),3000);
    }));
    body.append(h('div',{class:'grp',style:{marginTop:'14px'}},O.tr('Notifications','Уведомления')));
    body.append(O.toggleRow('bell',O.tr('Notify when media is ready','Уведомлять о готовности медиа'),
      O.tr('A notification opens the Media screen','Уведомление открывает экран «Медиа»'),
      O.store.get('snd_media',true),v=>{O.store.set('snd_media',v);try{OC.setFlag('snd_media',v)}catch(_){}}));
  };
  draw();
};

// ---- agent bridge ----
// The agent runs inside proot and can only call bash, so it reaches the factory through a loopback
// endpoint (MediaServer). Every request is a real generation with an explicit confirmation, and the
// result is returned as the file path so the agent can attach it to its answer.
O.on('mediaRequest',async d=>{
  if(!d||!d.id)return;
  const kind=d.kind||'image';
  const providers=O.mediaProvidersOf(kind);
  if(!providers.length){
    O.native.mediaAnswer(d.id,{ok:false,err:O.tr('No media provider configured','Медиа-провайдер не настроен')});
    return;
  }
  const prov=providers[0];
  const model=d.model||(prov.models&&prov.models[0])||'';
  const ok=await O.confirm(
    O.tr('Agent wants to generate media','Агент хочет создать медиа'),
    kind+' · '+prov.name+(model?(' · '+model):'')+'\n\n'+String(d.prompt||'').slice(0,400),
    O.tr('Generate','Сгенерировать'));
  if(!ok){O.native.mediaAnswer(d.id,{ok:false,err:'declined'});return}
  const jobId=O.mediaGenerate({kind,prompt:d.prompt,model,provider:prov.id,params:{}});
  // wait for the job and hand the path back to the waiting shell process
  const started=Date.now();
  const wait=setInterval(()=>{
    const j=M.queue.find(x=>x.id===jobId);
    if(!j)return;
    if(j.state==='done'){
      clearInterval(wait);
      O.native.mediaAnswer(d.id,{ok:true,path:j.path,kind:j.kind});
    }else if(j.state==='error'||j.state==='cancelled'){
      clearInterval(wait);
      O.native.mediaAnswer(d.id,{ok:false,err:j.error||j.state});
    }else if(Date.now()-started>870000){
      clearInterval(wait);
      O.native.mediaAnswer(d.id,{ok:false,err:'timeout'});
    }
  },500);
});

// Started lazily: the endpoint only exists while the app is in the foreground.
if(O.native.mediaServerStart){
  setTimeout(()=>{try{O.native.mediaServerStart()}catch(_){}},3000);
}

O.mediaQueue=M.queue;
})();