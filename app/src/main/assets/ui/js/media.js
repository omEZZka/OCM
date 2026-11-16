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
// A provider is one credential + endpoint. Each media kind has its own model list; reusing one
// `models` array across kinds was the reason image IDs leaked into video/TTS and vice versa.
const KINDS=['image','video','tts','music'];
const defaultProvider=()=>({id:'',name:'',kind:'image',baseURL:'',apiKey:'',modelsByKind:{image:[],video:[],tts:[],music:[]},paths:{},api:''});
const normalizeProvider=p=>{
  const rec=Object.assign(defaultProvider(),p||{});
  rec.kind=KINDS.includes(rec.kind)?rec.kind:'image';
  rec.baseURL=String(rec.baseURL||'').trim();
  rec.apiKey=String(rec.apiKey||'');
  rec.modelsByKind=Object.assign({},rec.modelsByKind||{});
  // Older builds stored a single list under `models`. It was filled by the unfiltered probe and
  // therefore cannot be trusted as media-capable; only the new per-kind list is authoritative.
  for(const k of KINDS){
    const src=Array.isArray(rec.modelsByKind[k])?rec.modelsByKind[k]:[];
    rec.modelsByKind[k]=[...new Set(src.filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()))];
  }
  if(Array.isArray(rec.models)&&!rec.modelsByKind[rec.kind].length&&rec.catalogueVerified===true){
    rec.modelsByKind[rec.kind]=[...new Set(rec.models.filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()))];
  }
  delete rec.models;
  rec.api=rec.api||((/openrouter\.ai/i.test(rec.baseURL))?'openrouter':'openai');
  return rec;
};
const modelKey=p=>Array.isArray(p)?p:((p&&p.modelsByKind&&p.modelsByKind[p.kind])||[]);
const lastModelKey=(kind,id)=>'media.lastModel.'+kind+'.'+id;

O.mediaProviders=()=>{
  const stored=O.store.get('mediaProviders',[]);
  const list=Array.isArray(stored)?stored:[];
  let dirty=false;
  const out=[];
  const cleanList=list.map(p=>{
    if(!p||typeof p!=='object'){dirty=true;return p}
    const rec=normalizeProvider(p);
    if(rec.apiKey&&O.native.securePut('media.provider.'+rec.id,rec.apiKey))rec.hasKey=true;
    const clean=Object.assign({},rec);delete clean.apiKey;
    if(JSON.stringify(clean)!==JSON.stringify(p))dirty=true;
    return clean;
  });
  if(dirty)O.store.set('mediaProviders',cleanList);
  for(const p of cleanList){
    const rec=normalizeProvider(p);
    if(rec.id&&rec.hasKey)rec.apiKey=O.native.secureGet('media.provider.'+rec.id);
    out.push(rec);
  }
  return out;
};
O.saveMediaProviders=list=>{
  const stored=[];
  const keep=new Set();
  for(const raw of (list||[]).slice(0,40)){
    if(!raw||!raw.id)continue;
    const p=normalizeProvider(raw);
    keep.add(p.id);
    if(p.apiKey)p.hasKey=true;else delete p.hasKey;
    if(p.apiKey&&!O.native.securePut('media.provider.'+p.id,p.apiKey))throw new Error(O.tr('Could not store the API key securely','Не удалось безопасно сохранить API-ключ'));
    delete p.apiKey;
    stored.push(p);
  }
  // A deleted provider must not leave its key behind in the Keystore store.
  try{for(const p of O.store.get('mediaProviders',[]))if(p&&p.id&&!keep.has(p.id))O.native.secureRemove('media.provider.'+p.id)}catch(_){}
  O.store.set('mediaProviders',stored);bus.emit('media')
};
O.mediaProvider=(id,kind)=>O.mediaProviders().find(p=>p.id===id&&(!kind||p.kind===kind))||null;
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

// ---- provider adapters, model capabilities and URL handling ----
// `/models` is a catalogue of everything a key can call, mostly chat models. A vision model is
// NOT an image generator: filtering must look at the *output* modalities, not the input ones.
const isOpenRouter=p=>(p&&p.api==='openrouter')||(/(^|\.)openrouter\.ai$/i.test(hostOf(p&&p.baseURL||'')));
const KIND_CFG={
  image:{path:'/images/generations',outputs:['image'],route:/\/images(?:\/generations)?(?:\/|$)/i},
  video:{path:'/videos/generations',outputs:['video'],route:/\/videos(?:\/generations)?(?:\/|$)/i},
  tts:{path:'/audio/speech',outputs:['speech','audio'],route:/\/audio\/speech(?:\/|$)/i},
  music:{path:'/music/generations',outputs:['music','audio'],route:/\/music(?:\/generations)?(?:\/|$)/i}
};
const EXT={image:'png',video:'mp4',tts:'mp3',music:'mp3'};

const hostOf=url=>{try{return new URL(url).host.toLowerCase()}catch(_){return''}};
const apiPath=prov=>{
  const k=prov.kind;
  const custom=prov.paths&&prov.paths[k];
  if(custom)return custom;
  const base=String(prov.baseURL||'');
  // Full endpoint pasted as the base: keep it, don't append a second generation route.
  const p=(()=>{try{return new URL(base).pathname}catch(_){return base}})();
  if(KIND_CFG[k]&&KIND_CFG[k].route.test(p)&&!/\/models\/?$/i.test(p))return '';
  if(isOpenRouter(prov))return k==='image'?'/images':k==='video'?'/videos':KIND_CFG[k].path;
  return KIND_CFG[k].path;
};
const isModelsUrl=url=>/\/models\/?$/i.test((()=>{try{return new URL(url).pathname}catch(_){return url}})());
const joinUrl=(base,path)=>{
  const b=String(base||'').trim();
  const p=String(path||'').trim();
  if(/^https?:\/\//i.test(p))return p;
  if(!p)return b;
  if(!b)throw new Error(O.tr('Base URL is required','Нужен Base URL'));
  const u=new URL(/^https?:\/\//i.test(b)?b:'https://'+b);
  const clean=p.replace(/^\/+/, '').replace(/\/+$/, '');
  if(u.pathname.replace(/\/+$/, '').endsWith('/'+clean))return u.toString();
  u.pathname=u.pathname.replace(/\/+$/, '')+'/'+clean;
  return u.toString();
};
const discoveryUrl=prov=>{
  const base=String(prov.baseURL||'').trim();
  if(isOpenRouter(prov)){
    // /api/v1/models is a base, not a media endpoint: strip it before using the dedicated routes.
    let root=base.replace(/\/models\/?$/i, '');
    // Full generation URL pasted into Base URL: use its parent as the API root.
    root=root.replace(/\/(images|videos)(?:\/generations)?\/?$/i, '');
    root=root.replace(/\/audio\/speech\/?$/i, '').replace(/\/music(?:\/generations)?\/?$/i, '');
    if(prov.kind==='image')return joinUrl(root,'images/models');
    if(prov.kind==='video')return joinUrl(root,'videos/models');
    const u=new URL(joinUrl(root,'models'));
    u.searchParams.set('output_modalities',prov.kind==='tts'?'speech':'audio');
    return u.toString();
  }
  // A pasted ".../models" URL is already the discovery URL (old code requested /models/models).
  if(isModelsUrl(base))return base;
  return joinUrl(base,'models');
};
const withAuth=(url,prov)=>{
  if(prov.authStyle!=='query'||!prov.apiKey)return url;
  const u=new URL(url);
  u.searchParams.set(prov.queryKey||'key',prov.apiKey);
  return u.toString();
};
const authHeaders=(prov,json)=>{
  const headers=Object.assign({},json?{'Content-Type':'application/json'}:{},prov.headers||{});
  if(prov.apiKey){
    if(prov.authStyle==='x-api-key')headers['x-api-key']=prov.apiKey;
    else if(prov.authStyle!=='query')headers['Authorization']='Bearer '+prov.apiKey;
  }
  return headers;
};

const outModalities=m=>{
  const a=m&&m.architecture||{};
  const v=(m&&(m.output_modalities||m.outputModalities))||(a.output_modalities)||(m.modalities&&m.modalities.output);
  return Array.isArray(v)?v.map(x=>String(x).toLowerCase()):[];
};
const endpointList=m=>{
  // General /models: endpoints is an array of routes. Dedicated media catalogues: a string link to
  // per-provider details (NOT a list of supported routes), so a string must not be used for filtering.
  return Array.isArray(m&&m.endpoints)?m.endpoints.map(String):[];
};
const knownMediaId=(id,kind)=>{
  // Some plain OpenAI-compatible /models endpoints carry no capability metadata at all. Well-known
  // generation IDs are still useful there; unknown IDs stay available through the manual field.
  return kind==='image'?/(?:^|[/_.-])(dall-e|gpt-image|imagen|flux|stable-image|sdxl|image-gen)/i.test(id)
    :kind==='video'?/(?:^|[/_.-])(sora|veo|kling|runway|luma|minimax-video|video-gen)/i.test(id)
    :kind==='tts'?/(?:^|[/_.-])(tts|speech|eleven|voice)/i.test(id)
    :/(?:^|[/_.-])(music|suno|udio|stable-audio)/i.test(id);
};
/** Classify one /models entry: 'yes' (verified), 'no' (other kind), 'unknown' (no metadata). */
function modelSupport(m,kind,prov){
  const id=typeof m==='string'?m:(m&&m.id)||'';
  if(!id)return 'no';
  const cfg=KINDS.includes(kind)?KIND_CFG[kind]:KIND_CFG.image;
  const outs=outModalities(m);
  if(outs.length&&!cfg.outputs.some(x=>outs.includes(x)))return 'no';
  if(outs.length&&cfg.outputs.some(x=>outs.includes(x))){
    const eps=endpointList(m);
    if(eps.length&&!eps.some(x=>cfg.route.test(x)))return 'no';
    return 'yes';
  }
  // Explicit type/capability fields used by several compatible gateways.
  const types=[m&&m.type,m&&m.object,m&&m.modality,m&&m.output_type,m&&m.capability].filter(Boolean).join(' ').toLowerCase();
  if(types&&cfg.outputs.some(x=>types.includes(x)))return 'yes';
  if(m&&(m.image_generation===true||m.video_generation===true||m.text_to_speech===true))return 'yes';
  // Dedicated OpenRouter media catalogues only contain that kind already.
  if(isOpenRouter(prov)&&(kind==='image'||kind==='video'))return 'yes';
  return knownMediaId(id,kind)?'yes':'unknown';
}
const modelLabel=m=>typeof m==='string'?m:((m&&(m.name||m.id))||'');
O.mediaModelSupport=(raw,kind,prov)=>{
  const arr=Array.isArray(raw)?raw:Array.isArray(raw&&raw.data)?raw.data:Array.isArray(raw&&raw.models)?raw.models:
    (raw&&raw.models&&typeof raw.models==='object'?Object.entries(raw.models).map(([id,v])=>typeof v==='string'?{id,name:v}:Object.assign({id},v)):[]);
  const seen=new Set(),compatible=[],unknown=[];
  for(const m of arr){
    const id=typeof m==='string'?m:(m&&m.id)||'';
    if(!id||seen.has(id))continue;
    seen.add(id);
    const verdict=modelSupport(m,kind,prov||{});
    if(verdict==='yes')compatible.push({id,label:modelLabel(m),raw:m});
    else if(verdict==='unknown')unknown.push({id,label:modelLabel(m),raw:m});
  }
  return {compatible,unknown,total:arr.length};
};
const modelBody=(prov,params)=>{
  const k=prov.kind,p=params||{};
  if(k==='image'){
    const b={model:p.model,prompt:p.prompt};
    // response_format is rejected by gpt-image and many aggregators: base64/URL is auto-detected.
    if(p.size)b.size=p.size;
    if(Number(p.n)>1)b.n=Number(p.n);
    else if(p.n===1||p.n==='1')b.n=1;
    return b;
  }
  if(k==='video')return {model:p.model,prompt:p.prompt,duration:clamp(Number(p.duration)||5,1,60),size:p.size||'1280x720'};
  if(k==='tts')return {model:p.model,input:p.prompt,voice:p.voice||'alloy',response_format:p.format||'mp3'};
  return {model:p.model,prompt:p.prompt,duration:clamp(Number(p.duration)||30,5,60)};
};

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
  const fail=e=>{
    job.state='error';
    const raw=e&&e.message||String(e);
    // Upstream errors are often JSON. Show the useful message instead of the whole payload.
    let msg=raw;
    try{const o=JSON.parse(raw);msg=(o.error&&o.error.message)||o.message||raw}catch(_){}
    job.error=msg;job.finished=Date.now();
    O.native.notifyMedia(O.tr('Media failed','Медиа не создано'),msg.slice(0,180));
    bus.emit('media');
  };
  const prov=O.mediaProvider(job.provider,job.kind);
  if(!prov)return fail(new Error(O.tr('Provider not found','Провайдер не найден')));
  if(!prov.apiKey&&prov.requireKey!==false)return fail(new Error(O.tr('No API key','Нет API-ключа')));
  const path=apiPath(prov);
  const url=withAuth(joinUrl(prov.baseURL,path),prov);
  const body=Object.assign(modelBody(prov,Object.assign({},job.params,{prompt:job.prompt,model:job.model})),prov.extraBody||{});
  const dest=(prov.folder||O.mediaFolder())+'/'+job.kind+'/'+stamp()+'_'+slug(job.prompt)+'.'+EXT[job.kind];
  const headers=authHeaders(prov,true);
  try{
    // Async: a blocking bridge call froze the whole WebView (queue, tabs) until the provider answered.
    const r=await (O.native.netPostToFileAsync||O.native.netPostToFile)(url,headers,JSON.stringify(body),dest,job.kind==='video'?600000:240000);
    if(!r||!r.ok)throw new Error((r&&r.err)||('HTTP '+(r&&r.status)));
    if(r.json){
      // JSON handshake: find a URL or inline base64
      let data=null;
      try{data=JSON.parse(r.body||'{}')}catch(_){}
      data=await resolveAsyncResponse(data,url,authHeaders(prov,false),job.kind==='video'?600000:240000);
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
  }catch(e){fail(e)}
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
const isPending=d=>{
  if(!d||typeof d!=='object')return false;
  const st=String(d.status||d.state||'').toLowerCase();
  if(['queued','pending','processing','running','submitted','in_progress'].includes(st))return true;
  return !!(d.polling_url||d.poll_url||d.task_id||d.request_id)&&!findMediaUrl(d)&&!findBase64(d);
};
const pollTarget=(d,base)=>{
  const u=d.polling_url||d.poll_url||d.url;
  if(u&&/^https?:\/\//i.test(u))return u;
  const id=d.task_id||d.request_id||d.id;
  return id?joinUrl(base,'videos/'+id):'';
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Video/music APIs often return a job id instead of bytes. Poll it with the same credentials until
// it produces media, instead of reporting "response has no media" for a valid submission.
async function resolveAsyncResponse(data,base,headers,dest,timeout){
  let cur=data,deadline=Date.now()+Math.min(timeout||600000,900000);
  for(let i=0;i<120&&isPending(cur);i++){
    if(Date.now()>deadline)throw new Error(O.tr('Generation timed out','Время генерации истекло'));
    await sleep(3000);
    const target=pollTarget(cur,base);
    if(!target)break;
    const r=await O.native.netGetAsync(target,headers,30000);
    cur=JSON.parse(r.body||'{}');
    const st=String(cur.status||cur.state||'').toLowerCase();
    if(['failed','error','cancelled','canceled','expired'].includes(st))throw new Error(cur.error&&cur.error.message||cur.message||st);
  }
  return cur;
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

// Searchable picker: hundreds of chat IDs used to end up in a single action sheet, with the first
// one silently selected. Only an explicit choice is remembered and used for a paid request.
O.openMediaModelPicker=(provider,current,onPick)=>{
  const models=modelKey(provider);
  const list=h('div');
  const q=h('input',{placeholder:O.tr('Search models…','Поиск моделей…'),oninput:()=>draw()});
  const s=O.sheet(O.tr('Media model','Модель медиа'),h('div',null,q,list),{full:true});
  const draw=()=>{
    list.textContent='';
    const needle=String(q.value||'').trim().toLowerCase();
    const shown=models.filter(id=>id.toLowerCase().includes(needle));
    if(!models.length)list.append(h('div',{class:'note'},O.tr('No compatible models yet. Probe the provider or add an ID manually.','Совместимых моделей пока нет. Прозвоните провайдера или добавьте ID вручную.')));
    else if(!shown.length)list.append(h('div',{class:'note'},O.tr('Nothing matches the search','По запросу ничего не найдено')));
    shown.slice(0,500).forEach(id=>list.append(h('button',{class:'settings-row',onclick:()=>{
      O.store.set(lastModelKey(provider.kind,provider.id),id);onPick(id);s.close();
    }},O.icon(id===current?'check':'cpu'),h('div',{class:'settings-row-text'},h('b',{class:'mono'},id)),id===current?O.icon('check'):null)));
  };
  draw();
};
function pickInitialModel(prov){
  const saved=O.store.get(lastModelKey(prov.kind,prov.id),'');
  return modelKey(prov).includes(saved)?saved:'';
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
  const state={provider:ps.cur,model:pickInitialModel(ps.cur),prompt:'',params:{}};
  const promptTa=h('textarea',{rows:4,class:'mono',placeholder:kind==='tts'
    ?O.tr('Text to read aloud…','Текст для озвучки…')
    :O.tr('Describe what to create…','Опишите, что создать…')});
  const actionBar=h('div',{class:'media-actions'});
  const info=h('div',{class:'mut s',style:{margin:'6px 2px'}});

  const drawHead=()=>{
    actionBar.textContent='';
    // provider + model pickers
    const provBtn=h('button',{class:'chip',onclick:()=>{
      O.actions(O.tr('Provider','Провайдер'),ps.list.map(p=>({label:p.name,icon:p.id===state.provider.id?'check':'cloud',fn:()=>{
        state.provider=p;state.model=pickInitialModel(p);O.store.set('media.lastProvider.'+kind,p.id);drawHead();drawParams();
      }}))
        .concat([{label:O.tr('Add provider…','Добавить провайдера…'),icon:'plus',fn:()=>O.openMediaProvider(null,kind)}]));
    }},O.icon('cloud'),h('span',null,state.provider.name));
    const modelBtn=h('button',{class:'chip',onclick:()=>{
      O.openMediaModelPicker(state.provider,state.model,id=>{state.model=id;drawHead();drawParams()});
    }},O.icon('cpu'),h('span',null,state.model||O.tr('Choose model','Выберите модель')));
    actionBar.append(provBtn,modelBtn);
    info.textContent=state.provider.baseURL||'';
    const count=modelKey(state.provider).length;
    info.textContent=(state.provider.baseURL||'')+(count?' · '+count+' '+O.tr('compatible models','совместимых моделей'):'');
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
    }
    if(kind==='image')paramsBox.append(row(O.tr('Count','Кол-во'),'n',[['1','1'],['2','2'],['4','4']],'1'));
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
function drawModelInfo(prov,box){
  if(!box)return;
  box.textContent='';
  const items=(prov.catalogueInfo&&prov.catalogueInfo[prov.kind])||[];
  if(!items.length){
    const last=O.mediaHistory().find(x=>x.provider===prov.id&&x.kind===prov.kind);
    if(last)box.append(h('div',{class:'note'},O.tr('Last success: ','Последний успех: ')+last.model+' · '+O.ago(last.at)));
    return;
  }
  box.append(h('div',{class:'grp'},O.tr('Model capabilities','Возможности моделей')));
  items.slice(0,30).forEach(it=>{
    const m=it.raw||{},arch=m.architecture||{};
    const outs=outModalities(m),eps=endpointList(m);
    const pricing=m.pricing||m.cost||{};
    const cost=pricing.prompt||pricing.input||pricing.image||'';
    const last=O.mediaHistory().find(x=>x.provider===prov.id&&x.kind===prov.kind&&x.model===it.id);
    const lines=[];
    if(outs.length)lines.push(O.tr('Output: ','Результат: ')+outs.join(', '));
    if(eps.length)lines.push(O.tr('Endpoints: ','Методы: ')+eps.slice(0,3).join(', '));
    if(m.supported_voices)lines.push(O.tr('Voices: ','Голоса: ')+(Array.isArray(m.supported_voices)?m.supported_voices.slice(0,8).join(', '):m.supported_voices));
    if(m.supported_parameters)lines.push(O.tr('Parameters: ','Параметры: ')+(Array.isArray(m.supported_parameters)?m.supported_parameters.join(', '):Object.keys(m.supported_parameters).join(', ')));
    if(m.max_duration||m.duration)lines.push(O.tr('Duration: ','Длительность: ')+(m.max_duration||m.duration)+'s');
    if(m.size||m.resolution||m.supported_sizes)lines.push(O.tr('Size: ','Размер: ')+JSON.stringify(m.supported_sizes||m.resolution||m.size));
    if(cost!=='')lines.push(O.tr('Price: ','Цена: ')+cost);
    if(last)lines.push(O.tr('Last success: ','Последний успех: ')+O.ago(last.at));
    box.append(h('details',{class:'media-model-info'},
      h('summary',null,it.label||it.id),
      h('div',{class:'mono s mut'},it.id),
      lines.length?lines.map(x=>h('div',{class:'s'},x)):h('div',{class:'mut s'},O.tr('No extra metadata supplied','Дополнительных метаданных нет'))));
  });
}

O.openMediaProvider=(existing,kind)=>{
  const p=normalizeProvider(existing||Object.assign(defaultProvider(),{kind:kind||'image'}));
  const originalId=p.id,originalKind=p.kind;
  const body=h('div');
  const s=O.sheet(existing?O.tr('Edit provider','Изменить провайдера'):O.tr('New media provider','Новый медиа-провайдер'),body,{full:true});
  const idInp=h('input',{value:p.id,placeholder:O.tr('e.g. openrouter','например, openrouter')});
  const nameInp=h('input',{value:p.name,placeholder:O.tr('Display name','Название')});
  const pathInp=h('input',{class:'mono',value:(p.paths&&p.paths[p.kind])||'',placeholder:'/images/generations'});
  const kindSel=h('div',{class:'seg'},[['image','Фото'],['video','Видео'],['tts','Голос'],['music','Музыка']].map(([k,l])=>
    h('button',{class:p.kind===k?'on':'',onclick:e=>{
      const custom=String(pathInp.value||'').trim();
      if(custom){p.paths=Object.assign({},p.paths||{});p.paths[p.kind]=custom}
      p.kind=k;[...kindSel.children].forEach(b=>b.classList.remove('on'));e.currentTarget.classList.add('on');
      pathInp.value=(p.paths&&p.paths[k])||'';
      drawModels();drawModelInfo(p,modelInfoBox);
    }},l)));
  const urlInp=h('input',{class:'mono',value:p.baseURL,placeholder:'https://api.example.com/v1'});
  const authSel=h('div',{class:'seg'},[['bearer','Bearer'],['x-api-key','x-api-key'],['query','Query key']].map(([k,l])=>
    h('button',{class:p.authStyle===k?'on':'',onclick:e=>{p.authStyle=k;[...authSel.children].forEach(b=>b.classList.remove('on'));e.currentTarget.classList.add('on')}},l)));
  const extraInp=h('textarea',{class:'mono',rows:3,placeholder:'{"quality":"hd"}'});
  extraInp.value=p.extraBody?JSON.stringify(p.extraBody):'';
  // The key never leaves the secure store just to fill an editor field. Empty = keep existing key.
  const keyInp=h('input',{type:'password',class:'mono',value:'',placeholder:existing&&p.apiKey?O.tr('Key saved — leave empty to keep','Ключ сохранён — оставьте пустым, чтобы не менять'):'API key'});
  const keylessRow=O.toggleRow('key',O.tr('No API key required','Работает без API-ключа'),O.tr('For a local or open endpoint','Для локального или открытого API'),p.requireKey===false,v=>{p.requireKey=!v});
  const modelsBox=h('div',{class:'media-editor-models'});
  const modelInfoBox=h('div');
  const status=h('div',{class:'mut s',style:{margin:'8px 0',whiteSpace:'pre-wrap'}});
  const drawModels=()=>{
    modelsBox.textContent='';
    const models=modelKey(p);
    modelsBox.append(h('div',{class:'mut s'},models.length+' '+O.tr('models for this type','моделей для этого типа')));
    const last=O.mediaHistory().find(x=>x.provider===p.id&&x.kind===p.kind);
    if(last)modelsBox.append(h('div',{class:'note'},O.tr('Last success: ','Последний успех: ')+last.model+' · '+O.ago(last.at)));
    models.slice(0,80).forEach(m=>modelsBox.append(h('span',{class:'chip keep'},m,
      h('button',{class:'chip-x',onclick:()=>{p.modelsByKind[p.kind]=modelKey(p).filter(x=>x!==m);drawModels()}},O.icon('x')))));
    if(models.length>80)modelsBox.append(h('div',{class:'mut s'},'+'+(models.length-80)));
    modelsBox.append(h('button',{class:'chip',onclick:async()=>{
      const v=await O.ask(O.tr('Model id','ID модели'),O.tr('Exact id from the provider, not its display name','Точный ID провайдера, не отображаемое имя'));
      const id=String(v||'').trim();
      if(id){p.modelsByKind[p.kind]=[...new Set(modelKey(p).concat(id))];p.catalogueVerified=true;drawModels()}
    }},O.icon('plus'),O.tr('Add ID manually','Добавить ID вручную')));
  };
  drawModels();
  drawModelInfo(p,modelInfoBox);

  const workingProv=()=>{
    const prov=normalizeProvider(Object.assign({},p,{
      baseURL:String(urlInp.value||'').trim(),
      apiKey:String(keyInp.value||'').trim()||p.apiKey||''
    }));
    prov.paths=Object.assign({},p.paths||{});
    const custom=String(pathInp.value||'').trim();
    if(custom)prov.paths[prov.kind]=custom;else delete prov.paths[prov.kind];
    return prov;
  };
  const probe=h('button',{class:'btn wide',style:{marginTop:'8px'},onclick:async()=>{
    if(probe.disabled)return;
    probe.disabled=true;probe.classList.add('busy');
    status.textContent=O.tr('Loading the model catalogue…','Загружаю каталог моделей…');
    try{
      const prov=workingProv();
      const url=withAuth(discoveryUrl(prov),prov);
      const r=await O.native.netGetAsync(url,authHeaders(prov,false),25000);
      let raw;
      try{raw=JSON.parse(r.body||'')}catch(_){throw new Error(O.tr('The provider returned non-JSON','Провайдер вернул не JSON'))}
      const found=O.mediaModelSupport(raw,prov.kind,prov);
      // Only compatible models are imported. Unknown IDs can be added manually; merging the whole
      // catalogue here was exactly what produced "model not found" for every media request.
      p.catalogueInfo=p.catalogueInfo||{};
      p.catalogueInfo[prov.kind]=found.compatible.concat(found.unknown);
      const ids=found.compatible.map(x=>x.id);
      p.modelsByKind[p.kind]=[...new Set(modelKey(p).concat(ids))];
      p.catalogueVerified=true;
      drawModelInfo(p,modelInfoBox);
      drawModels();
      status.textContent=O.tr('Catalogue: ','Каталог: ')+found.total+'\n'+
        O.tr('Compatible: ','Подходят: ')+ids.length+(found.unknown.length?('\n'+O.tr('Without capability metadata (not imported): ','Без метаданных (не добавлены): ')+found.unknown.length):'')+
        (ids.length?'':'\n'+O.tr('No compatible models found. Add the exact generation ID manually.','Совместимых моделей нет. Добавьте точный ID генерации вручную.'));
    }catch(e){
      status.textContent=O.tr('Probe failed: ','Ошибка прозвона: ')+(e.message||String(e));
    }finally{probe.disabled=false;probe.classList.remove('busy')}
  }},O.icon('search'),O.tr('Find compatible models','Найти совместимые модели'));

  const save=h('button',{class:'btn pri wide',style:{marginTop:'12px'},onclick:()=>{
    const id=String(idInp.value||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'');
    if(!id)return O.toast(O.tr('Provider id is required','Нужен ID провайдера'),2500);
    if(!String(urlInp.value||'').trim())return O.toast(O.tr('Base URL is required','Нужен Base URL'),2500);
    const prov=workingProv();prov.id=id;prov.name=String(nameInp.value||'').trim()||id;
    const extraRaw=String(extraInp.value||'').trim();
    if(extraRaw){
      try{prov.extraBody=JSON.parse(extraRaw)}catch(_){return O.toast(O.tr('Extra body must be valid JSON','Доп. параметры должны быть корректным JSON'),3000)}
      if(!prov.extraBody||typeof prov.extraBody!=='object'||Array.isArray(prov.extraBody))return O.toast(O.tr('Extra body must be a JSON object','Доп. параметры должны быть JSON-объектом'),3000);
    }else delete prov.extraBody;
    // Same credential id may exist once per media type, never twice for the same type.
    const list=O.mediaProviders().filter(x=>!(x.id===id&&x.kind===prov.kind)&&!(x.id===originalId&&x.kind===originalKind));
    list.push(prov);
    try{O.saveMediaProviders(list)}catch(e){return O.toast(e.message||String(e),3500)}
    O.toast(O.tr('Saved','Сохранено'),1500);s.close();
  }},O.icon('check'),O.tr('Save','Сохранить'));

  body.append(h('div',{class:'field'},h('label',null,O.tr('Provider id','ID провайдера')),idInp),
    h('div',{class:'field'},h('label',null,O.tr('Name','Название')),nameInp),
    h('div',{class:'field'},h('label',null,O.tr('Kind','Тип')),kindSel),
    h('div',{class:'field'},h('label',null,O.tr('API root (include /v1 if needed)','Корень API (с /v1, если нужно)')),urlInp),
    h('div',{class:'field'},h('label',null,O.tr('Custom request path (optional)','Свой путь запроса (необязательно)')),pathInp),
    h('div',{class:'field'},h('label',null,O.tr('Authentication','Авторизация')),authSel),
    h('div',{class:'field'},h('label',null,O.tr('API key','API-ключ')),keyInp),keylessRow,
    h('div',{class:'field'},h('label',null,O.tr('Extra JSON body','Доп. JSON в запросе')),extraInp),
    h('div',{class:'field'},h('label',null,O.tr('Models for the selected type','Модели выбранного типа')),modelsBox),
    modelInfoBox,
    probe,status,save);
  if(existing)body.append(h('button',{class:'btn dng wide',style:{marginTop:'8px'},onclick:()=>{
    O.saveMediaProviders(O.mediaProviders().filter(x=>!(x.id===originalId&&x.kind===originalKind)));s.close();
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
  const requested=String(d.model||'').trim();
  let prov=providers.find(p=>requested&&modelKey(p).includes(requested))||providers.find(p=>pickInitialModel(p));
  if(!prov&&providers.length===1)prov=providers[0];
  if(!prov){O.native.mediaAnswer(d.id,{ok:false,err:O.tr('Choose a media provider and model first','Сначала выберите медиа-провайдера и модель')});return}
  const model=requested||pickInitialModel(prov);
  if(!model){O.native.mediaAnswer(d.id,{ok:false,err:O.tr('Choose a media model in the Media screen first','Сначала выберите модель на экране «Медиа»')});return}
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

// Exposed read-only helpers for the self-check in tests; they do not trigger any provider call.
O.mediaDebug={
  support:(raw,kind,prov)=>O.mediaModelSupport(raw,kind,prov),
  url:(base,path)=>joinUrl(base,path),
  discovery:prov=>discoveryUrl(normalizeProvider(prov)),
  endpoint:prov=>joinUrl(prov.baseURL,apiPath(normalizeProvider(prov))),
  body:(prov,params)=>modelBody(normalizeProvider(prov),params)
};
O.mediaQueue=M.queue;
})();