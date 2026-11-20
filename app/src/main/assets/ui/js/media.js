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
// Keys are addressed by id AND kind: providers may share an id across kinds (one aggregator
// configured for photo and video), and an id-only slot made deleting one kind wipe the other's key.
const secKey=(id,kind)=>'media.provider.'+id+'.'+kind;

O.mediaProviders=()=>{
  const stored=O.store.get('mediaProviders',[]);
  const list=Array.isArray(stored)?stored:[];
  let dirty=false;
  const out=[];
  const cleanList=list.map(p=>{
    if(!p||typeof p!=='object'){dirty=true;return p}
    const rec=normalizeProvider(p);
    if(rec.apiKey){
      if(O.native.securePut(secKey(rec.id,rec.kind),rec.apiKey))rec.hasKey=true;
    }else if(rec.id&&rec.hasKey&&!O.native.secureGet(secKey(rec.id,rec.kind))){
      // migrate the legacy id-only slot once
      const legacy=O.native.secureGet('media.provider.'+rec.id);
      if(legacy&&O.native.securePut(secKey(rec.id,rec.kind),legacy))O.native.secureRemove('media.provider.'+rec.id);
    }
    const clean=Object.assign({},rec);delete clean.apiKey;
    if(JSON.stringify(clean)!==JSON.stringify(p))dirty=true;
    return clean;
  });
  if(dirty)O.store.set('mediaProviders',cleanList);
  for(const p of cleanList){
    const rec=normalizeProvider(p);
    if(rec.id&&rec.hasKey)rec.apiKey=O.native.secureGet(secKey(rec.id,rec.kind));
    out.push(rec);
  }
  return out;
};
O.saveMediaProviders=(list,removed)=>{
  const stored=[];
  const keep=new Set();
  for(const raw of (list||[]).slice(0,40)){
    if(!raw||!raw.id)continue;
    const p=normalizeProvider(raw);
    keep.add(p.id+'#'+p.kind);
    if(p.apiKey)p.hasKey=true;else delete p.hasKey;
    if(p.apiKey&&!O.native.securePut(secKey(p.id,p.kind),p.apiKey))throw new Error(O.tr('Could not store the API key securely','Не удалось безопасно сохранить API-ключ'));
    delete p.apiKey;
    stored.push(p);
  }
  // Removed records are passed explicitly: filtering them out of `list` before the call used to
  // hide renames/deletions from the cleanup and orphan their secure keys.
  const prev=O.store.get('mediaProviders',[]);
  const gone=(Array.isArray(removed)?removed:[]).concat(prev.filter(p=>p&&p.id&&!keep.has(p.id+'#'+p.kind)));
  try{for(const p of gone){if(!p||!p.id)continue;
    if(!keep.has(p.id+'#'+p.kind))O.native.secureRemove(secKey(p.id,p.kind));
    if(!stored.some(x=>x.id===p.id))O.native.secureRemove('media.provider.'+p.id);
  }}catch(_){}
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
  // FIX (audit J13): finished jobs accumulated forever (memory + O(n) scans on every event).
  // Keep the 60 most recent finished ones; active jobs are never pruned.
  if(M.queue.length>90){
    const finished=M.queue.filter(j=>j.state==='done'||j.state==='error'||j.state==='cancelled');
    const drop=new Set(finished.slice(0,Math.max(0,finished.length-60)).map(j=>j.id));
    for(let i=M.queue.length-1;i>=0;i--)if(drop.has(M.queue[i].id))M.queue.splice(i,1);
  }
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
  if(!j)return;
  if(j.state==='queued'){j.state='cancelled';j.finished=Date.now();bus.emit('media');return}
  if(j.state==='running'){
    // Real cancellation: abort the in-flight HTTP call and mark the job so late answers are ignored.
    j.cancelled=true;
    if(j.netId&&O.native.mediaNetCancel)O.native.mediaNetCancel(j.netId);
    j.state='cancelled';j.finished=Date.now();bus.emit('media');
  }
};

async function runJob(job){
  const fail=e=>{
    if(job.cancelled)return;
    job.state='error';
    const raw=e&&e.message||String(e);
    // Upstream errors are often JSON. Show the useful message instead of the whole payload.
    let msg=raw;
    try{const o=JSON.parse(raw);msg=(o.error&&o.error.message)||o.message||raw}catch(_){}
    job.error=msg;job.finished=Date.now();
    O.native.notifyMedia(O.tr('Media failed','Медиа не создано'),msg.slice(0,180));
    bus.emit('media');
  };
  // EVERYTHING is inside the try: URL building used to throw before it (malformed Base URL),
  // leaving the job stuck in 'running' and permanently eating a concurrency slot.
  try{
    const prov=O.mediaProvider(job.provider,job.kind);
    if(!prov)throw new Error(O.tr('Provider not found','Провайдер не найден'));
    if(!prov.apiKey&&prov.requireKey!==false)throw new Error(O.tr('No API key','Нет API-ключа'));
    const path=apiPath(prov);
    const url=withAuth(joinUrl(prov.baseURL,path),prov);
    const body=Object.assign(modelBody(prov,Object.assign({},job.params,{prompt:job.prompt,model:job.model})),prov.extraBody||{});
    const dest=(prov.folder||O.mediaFolder())+'/'+job.kind+'/'+stamp()+'_'+slug(job.prompt)+'.'+EXT[job.kind];
    const headers=authHeaders(prov,true);
    const timeout=job.kind==='video'?600000:240000;
    let r;
    if(O.native.netPostToFileC){const c=O.native.netPostToFileC(url,headers,JSON.stringify(body),dest,timeout);job.netId=c.id;r=await c.promise}
    else r=await (O.native.netPostToFileAsync||O.native.netPostToFile)(url,headers,JSON.stringify(body),dest,timeout);
    if(job.cancelled)return;
    if(!r||!r.ok)throw new Error((r&&r.err)||('HTTP '+(r&&r.status)));
    if(r.json){
      // JSON handshake: find a URL or inline base64
      let data=null;
      try{data=JSON.parse(r.body||'{}')}catch(_){}
      data=await resolveAsyncResponse(data,url,authHeaders(prov,false),timeout,job);
      if(job.cancelled)return;
      // (36) Variations: an image request with n>1 may return several results — save them all.
      if(job.kind==='image'&&Number(job.params.n)>1){
        const urls=findAllMediaUrls(data),b64s=findAllBase64(data);
        const total=urls.length+b64s.length;
        if(total>1){
          job.paths=[];
          const baseDest=dest.replace(/\.[a-z0-9]+$/i,'');
          for(let vi=0;vi<urls.length;vi++){
            if(job.cancelled)return;
            const vdest=baseDest+'_'+(vi+1)+'.'+EXT.image;
            const sameHost=hostOf(urls[vi])===hostOf(url);
            let d2;
            if(O.native.netDownloadToFileC){const c=O.native.netDownloadToFileC(urls[vi],sameHost?headers:{},vdest,240000);job.netId=c.id;d2=await c.promise}
            else d2=await O.native.netDownloadToFileAsync(urls[vi],sameHost?headers:{},vdest,240000);
            if(d2&&d2.ok)job.paths.push(d2.path||vdest);
          }
          for(let vi=0;vi<b64s.length;vi++){
            if(job.cancelled)return;
            const vdest=baseDest+'_'+(urls.length+vi+1)+'.'+EXT.image;
            const d3=await (O.native.writeDataUrlToFileAsync||O.native.writeDataUrlToFile)(b64s[vi],vdest);
            if(d3&&d3.ok)job.paths.push(d3.path||vdest);
          }
          if(!job.paths.length)throw new Error(O.tr('Response has no media','В ответе нет медиа'));
          job.path=job.paths[0];
          job.state='done';job.finished=Date.now();job.progress=100;
          pushHistory({id:job.id,kind:job.kind,prompt:job.prompt,model:job.model,provider:prov.id,path:job.path,paths:job.paths,at:job.finished});
          O.native.notifyMedia(O.tr('Media ready','Медиа готово'),job.kind+' · '+job.paths.length+' '+O.tr('variants','вариантов'));
          bus.emit('media');
          return;
        }
      }
      const urlFound=findMediaUrl(data);
      const b64=findBase64(data);
      if(urlFound){
        // Never forward provider credentials to a third-party CDN host: the signed URL is enough,
        // and sending the key there leaked it to anyone able to answer the API call.
        const sameHost=hostOf(urlFound)===hostOf(url);
        const dlHeaders=sameHost?headers:{};
        let d2;
        if(O.native.netDownloadToFileC){const c=O.native.netDownloadToFileC(urlFound,dlHeaders,dest,240000);job.netId=c.id;d2=await c.promise}
        else d2=await (O.native.netDownloadToFileAsync||O.native.netDownloadToFile)(urlFound,dlHeaders,dest,240000);
        if(job.cancelled)return;
        if(!d2||!d2.ok)throw new Error(d2&&d2.err||O.tr('Download failed','Не удалось скачать файл'));
        job.path=d2.path||dest;
      }else if(b64){
        const d3=await (O.native.writeDataUrlToFileAsync||O.native.writeDataUrlToFile)(b64,dest);
        if(job.cancelled)return;
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

function findAllMediaUrls(o,acc){
  acc=acc||[];
  if(!o||typeof o!=='object')return acc;
  for(const k in o){
    const v=o[k];
    if(typeof v==='string'&&/^https?:\/\//i.test(v)&&(/\.(png|jpe?g|webp|gif|mp4|webm|mp3|wav|m4a|ogg)(\?|$)/i.test(v)||/(image|video|audio|media|file|output|url)/i.test(k)))acc.push(v);
    else if(Array.isArray(v))v.forEach(it=>findAllMediaUrls(it,acc));
    else if(typeof v==='object')findAllMediaUrls(v,acc);
  }
  return [...new Set(acc)];
}
function findAllBase64(o,acc){
  acc=acc||[];
  if(!o||typeof o!=='object')return acc;
  for(const k in o){
    const v=o[k];
    if(typeof v==='string'){
      if(v.startsWith('data:'))acc.push(v);
      else if(/^[A-Za-z0-9+/]{200,}={0,2}$/.test(v))acc.push('data:application/octet-stream;base64,'+v);
    }else if(Array.isArray(v))v.forEach(it=>findAllBase64(it,acc));
    else if(typeof v==='object')findAllBase64(v,acc);
  }
  return acc;
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
async function resolveAsyncResponse(data,base,headers,timeout,job){
  let cur=data,deadline=Date.now()+Math.min(timeout||600000,900000);
  for(let i=0;i<120&&isPending(cur);i++){
    if(job&&job.cancelled)return cur;
    if(Date.now()>deadline)throw new Error(O.tr('Generation timed out','Время генерации истекло'));
    await sleep(3000);
    if(job&&job.cancelled)return cur;
    const target=pollTarget(cur,base);
    if(!target)break;
    let r;
    if(O.native.netGetC){const c=O.native.netGetC(target,headers,30000);if(job)job.netId=c.id;r=await c.promise}
    else r=await O.native.netGetAsync(target,headers,30000);
    // A proxy error page is not JSON: an unguarded parse rejected the whole job outside the
    // queue's error handling and wedged it in 'running' forever.
    try{cur=JSON.parse(r.body||'{}')}catch(_){throw new Error(O.tr('Polling returned non-JSON','Ответ опроса не JSON'))}
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
  const name=O.basename(path);
  try{
    if(!S.sid)await O.newSession();
    const mid=O.mid();
    // The server cannot fetch appassets URLs (they exist only inside this WebView). Send REAL
    // bytes as a data URL when the file is small enough; large files go as a path mention so the
    // agent can still open them with its file tools.
    let part;
    if(O.native.readDataUrl){
      try{
        const f=await O.native.readDataUrl(path);
        part={type:'file',mime:f.mime,filename:name,url:'data:'+f.mime+';base64,'+f.data,source:{type:'file',path,text:{value:'@'+name,start:0,end:0}}};
      }catch(_){}
    }
    if(!part)part={type:'file',mime:kind==='image'?'image/png':kind==='video'?'video/mp4':'audio/mpeg',filename:name,url:O.mediaUrl(path),source:{type:'file',path,text:{value:'@'+name,start:0,end:0}}};
    const parts=[part];
    if(text)parts.unshift({type:'text',text:String(text)});
    const m=O.upsertMsg({id:mid,sessionID:S.sid,role:'user',time:{created:Date.now()},agent:S.agent,model:S.model});
    m.local=true;m.parts=parts.map((p,k)=>Object.assign({id:'prt_media'+k,sessionID:S.sid,messageID:mid},p));
    bus.emit('msg',S.sid,m);
    await O.api('POST','/session/'+S.sid+'/prompt_async',{messageID:mid,agent:S.agent,model:S.model,parts},{timeout:60000});
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

// ---- UI: each media kind is its own persistent chat ----
// Photo / Video / Voice / Music are separate conversations: prompts are user bubbles, results are
// assistant bubbles with a player, and the whole thread survives restarts. The old tabbed
// generator form is gone; the composer at the bottom works exactly like the main chat.
const KIND_META={
  image:{label:()=>O.tr('Photo','Фото'),icon:'image',ph:()=>O.tr('Describe the image…','Опишите изображение…')},
  video:{label:()=>O.tr('Video','Видео'),icon:'film',ph:()=>O.tr('Describe the video…','Опишите видео…')},
  tts:{label:()=>O.tr('Voice','Голос'),icon:'wave',ph:()=>O.tr('Text to read aloud…','Текст для озвучки…')},
  music:{label:()=>O.tr('Music','Музыка'),icon:'note',ph:()=>O.tr('Describe the track…','Опишите трек…')}
};
const chatKey=kind=>'mediaChat.'+kind;
const chatLoad=kind=>{const l=O.store.get(chatKey(kind),[]);return Array.isArray(l)?l:[]};
const chatSave=(kind,list)=>O.store.set(chatKey(kind),list.slice(-120));
const chatPush=(kind,entry)=>{const l=chatLoad(kind);l.push(entry);chatSave(kind,l);return entry};

O.openMedia=kind=>{
  if(kind==='history'||!KIND_META[kind||'image']){
    if(kind==='history'){const body=h('div',{class:'media-pane'});O.sheet(O.tr('Media history','История медиа'),body,{full:true});drawHistory(body);return}
    kind='image';
  }
  const meta=KIND_META[kind];
  const feed=h('div',{class:'media-chat-feed'});
  const chips=h('div',{class:'media-chat-chips'});
  const ta=h('textarea',{rows:1,class:'media-chat-input',placeholder:meta.ph(),oninput:()=>{ta.style.height='auto';ta.style.height=Math.min(140,ta.scrollHeight)+'px'}});
  const sendBtn=h('button',{class:'hud-icon-btn media-chat-send',title:O.tr('Generate','Сгенерировать')},O.icon('send'));
  const composer=h('div',{class:'media-chat-composer'},chips,h('div',{class:'media-chat-inputrow'},ta,sendBtn));
  const headBtns=h('span',{style:{display:'flex',gap:'2px'}},
    h('button',{class:'ibtn',title:O.tr('History','История'),onclick:()=>O.openMedia('history')},O.icon('list')),
    h('button',{class:'ibtn',title:O.tr('Media settings','Настройки медиа'),onclick:()=>O.openMediaSettings()},O.icon('sliders')));
  const s=O.sheet(meta.label(),h('div',{class:'media-chat'},feed,composer),{full:true,actions:headBtns});

  const ps=providerSelect(kind);
  const state={provider:ps?ps.cur:null,model:ps?pickInitialModel(ps.cur):'',params:{}};
  const jobEls=new Map(); // jobId -> {el, entry}

  const scrollEnd=()=>{feed.scrollTop=feed.scrollHeight};

  const resultBody=(entry)=>{
    const box=h('div',{class:'media-bubble-body'});
    const j=M.queue.find(x=>x.id===entry.jobId);
    const st=j?j.state:(entry.path?'done':(entry.state==='running'||entry.state==='queued'?'interrupted':entry.state||'error'));
    const err=j&&j.error||entry.error||'';
    const path=j&&j.path||entry.path||'';
    if(st==='queued'||st==='running'){
      box.append(h('div',{class:'media-bubble-status'},h('span',{class:'spin'}),
        h('span',null,st==='queued'?O.tr('Queued…','В очереди…'):O.tr('Generating…','Генерация…')),
        h('button',{class:'chip',onclick:()=>{O.mediaCancel(entry.jobId)}},O.icon('x'),O.tr('Cancel','Отмена'))));
    }else if(st==='done'&&path){
      const k=entry.kind||kind;
      const paths=(j&&j.paths&&j.paths.length>1)?j.paths:(entry.paths&&entry.paths.length>1?entry.paths:null);
      if(k==='image'&&paths){
        // (36) variation grid: tap a variant to open it full-size
        const grid=h('div',{class:'media-variants'});
        paths.forEach(vp=>grid.append(h('img',{src:O.mediaUrl(vp),loading:'lazy',onclick:()=>O.mediaPreview({path:vp,kind:k,prompt:entry.prompt})})));
        box.append(grid);
        box.append(h('div',{class:'mut s'},paths.length+' '+O.tr('variants — tap to open','вариантов — нажмите, чтобы открыть')));
      }
      else if(k==='image')box.append(h('img',{class:'media-bubble-img',src:O.mediaUrl(path),loading:'lazy',onclick:()=>O.mediaPreview({path,kind:k,prompt:entry.prompt})}));
      else if(k==='video')box.append(h('video',{class:'thumb-video',src:O.mediaUrl(path),controls:true,preload:'metadata'}));
      else box.append(h('audio',{class:'thumb-audio',src:O.mediaUrl(path),controls:true,preload:'metadata'}));
      box.append(h('div',{class:'media-bubble-actions'},
        h('button',{class:'chip',onclick:()=>O.mediaSendToChat({path,kind:k},entry.prompt)},O.icon('chat'),O.tr('To chat','В чат')),
        h('button',{class:'chip',onclick:()=>O.mediaPreview({path,kind:k,prompt:entry.prompt})},O.icon('eye'),O.tr('Open','Открыть')),
        h('button',{class:'chip',onclick:()=>O.native.copy(path)},O.icon('copy'),O.tr('Path','Путь'))));
    }else{
      box.append(h('div',{class:'err s'},st==='interrupted'?O.tr('Interrupted by app restart','Прервано перезапуском приложения'):(err||O.tr('Generation failed','Генерация не удалась'))));
      box.append(h('div',{class:'media-bubble-actions'},
        h('button',{class:'chip',onclick:()=>retry(entry)},O.icon('refresh'),O.tr('Retry','Повторить'))));
    }
    return box;
  };

  const bubbleFor=(entry)=>{
    if(entry.role==='user'){
      return h('div',{class:'media-bubble user'},h('div',{class:'media-bubble-body'},entry.prompt),
        h('div',{class:'mut s media-bubble-meta'},(entry.model||'')+' · '+O.ago(entry.at)));
    }
    const el=h('div',{class:'media-bubble bot'},resultBody(entry),
      h('div',{class:'mut s media-bubble-meta'},(entry.model||'')+' · '+O.ago(entry.at)));
    if(entry.jobId)jobEls.set(entry.jobId,{el,entry});
    return el;
  };

  const repaintJob=(jobId)=>{
    const rec=jobEls.get(jobId);if(!rec||!rec.el.isConnected)return;
    const j=M.queue.find(x=>x.id===jobId);
    if(j){
      rec.entry.state=j.state;rec.entry.error=j.error||'';rec.entry.path=j.path||rec.entry.path;
      if(j.paths&&j.paths.length)rec.entry.paths=j.paths;
      const l=chatLoad(kind);const it=l.find(x=>x.jobId===jobId);
      if(it){it.state=j.state;it.error=rec.entry.error;it.path=rec.entry.path;if(rec.entry.paths)it.paths=rec.entry.paths;chatSave(kind,l)}
    }
    const fresh=bubbleFor(rec.entry);
    rec.el.replaceWith(fresh);
  };

  const drawFeed=()=>{
    jobEls.clear();feed.textContent='';
    const list=chatLoad(kind);
    if(!list.length){
      feed.append(h('div',{class:'media-empty'},O.icon(meta.icon),
        h('b',null,O.tr('New '+meta.label()+' chat','Новый чат: '+meta.label())),
        h('span',{class:'mut s'},O.tr('Type a prompt below — results appear here as messages.','Введите запрос ниже — результаты появятся здесь сообщениями.'))));
      return;
    }
    list.forEach(e=>feed.append(bubbleFor(e)));
    scrollEnd();
  };

  const drawChips=()=>{
    chips.textContent='';
    if(!state.provider){
      chips.append(h('button',{class:'chip',onclick:()=>O.openMediaProvider(null,kind)},O.icon('plus'),O.tr('Add provider','Добавить провайдера')));
      return;
    }
    chips.append(h('button',{class:'chip',onclick:()=>{
      const list=O.mediaProvidersOf(kind);
      O.actions(O.tr('Provider','Провайдер'),list.map(p=>({label:p.name,icon:p.id===state.provider.id?'check':'cloud',fn:()=>{
        state.provider=p;state.model=pickInitialModel(p);O.store.set('media.lastProvider.'+kind,p.id);drawChips();
      }})).concat([{label:O.tr('Add provider…','Добавить провайдера…'),icon:'plus',fn:()=>O.openMediaProvider(null,kind)}]));
    }},O.icon('cloud'),h('span',null,state.provider.name)));
    chips.append(h('button',{class:'chip',onclick:()=>{
      O.openMediaModelPicker(state.provider,state.model,id=>{state.model=id;drawChips()});
    }},O.icon('cpu'),h('span',null,state.model||O.tr('Choose model','Выберите модель'))));
    const row=(label,key,options,def)=>{
      const cur=state.params[key]||def;
      chips.append(h('button',{class:'chip',onclick:()=>{
        const i=options.findIndex(o=>o[0]===cur);
        state.params[key]=options[(i+1)%options.length][0];drawChips();
      }},label+': '+((options.find(o=>o[0]===cur)||options[0])[1])));
    };
    if(kind==='image'||kind==='video')row(O.tr('Size','Размер'),'size',
      kind==='image'?[['1024x1024','1024²'],['1536x1024','3:2'],['1024x1536','2:3'],['512x512','512²']]:[['1280x720','720p'],['1920x1080','1080p'],['720x1280','9:16']],
      kind==='image'?'1024x1024':'1280x720');
    if(kind==='image')row(O.tr('Count','Кол-во'),'n',[['1','1'],['2','2'],['4','4']],'1');
    if(kind==='video'||kind==='music')row(O.tr('Duration','Длит.'),'duration',[['5','5s'],['10','10s'],['15','15s'],['30','30s'],['60','60s']],kind==='music'?'30':'5');
    if(kind==='tts'){
      const v=state.params.voice||O.store.get('media.voice','alloy');
      const cloned=O.mediaVoices();
      const curLabel=(cloned.find(x=>x.id===v)||{}).name||v;
      chips.append(h('button',{class:'chip',onclick:()=>{
        const list=['alloy','echo','fable','onyx','nova','shimmer'];
        const items=list.map(x=>({label:x,icon:x===v?'check':'wave',fn:()=>{state.params.voice=x;O.store.set('media.voice',x);drawChips()}}));
        cloned.forEach(cv=>items.push({label:'★ '+cv.name,sub:cv.id,icon:cv.id===v?'check':'user',fn:()=>{state.params.voice=cv.id;O.store.set('media.voice',cv.id);drawChips()}}));
        items.push({label:O.tr('Clone my voice…','Клонировать мой голос…'),icon:'mic',fn:()=>O.openVoiceClone(state.provider&&state.provider.id)});
        O.actions(O.tr('Voice','Голос'),items);
      }},O.icon('wave'),curLabel));
    }
  };

  const submit=(prompt,params,model,providerId)=>{
    if(!providerId)return O.toast(O.tr('Add a provider first','Сначала добавьте провайдера'),2500);
    if(!model)return O.toast(O.tr('Pick a model','Выберите модель'),2000);
    chatPush(kind,{role:'user',prompt,at:Date.now(),model});
    const jobId=O.mediaGenerate({kind,prompt,model,provider:providerId,params:Object.assign({},params)});
    chatPush(kind,{role:'result',jobId,kind,prompt,model,providerId,params:Object.assign({},params),at:Date.now(),state:'queued',path:'',error:''});
    drawFeed();
  };
  const retry=(entry)=>{
    const prov=O.mediaProvider(entry.providerId||state.provider&&state.provider.id,kind)||state.provider;
    if(!prov)return O.toast(O.tr('Provider not found','Провайдер не найден'),2500);
    submit(entry.prompt,entry.params||state.params,entry.model||state.model,prov.id);
  };

  sendBtn.onclick=()=>{
    const prompt=ta.value.trim();
    if(!prompt)return;
    if(!state.provider){O.toast(O.tr('Add a provider first','Сначала добавьте провайдера'),2500);O.openMediaProvider(null,kind);return}
    ta.value='';ta.style.height='auto';
    submit(prompt,state.params,state.model,state.provider.id);
  };
  ta.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&innerWidth>=820){e.preventDefault();sendBtn.onclick()}});

  drawChips();drawFeed();
  const offMedia=bus.on('media',()=>{
    if(!s.root.isConnected){offMedia();return}
    for(const id of jobEls.keys())repaintJob(id);
  });
  const offBus=bus.on('media',()=>{if(s.root.isConnected&&(state.provider&&!O.mediaProvider(state.provider.id,kind))){const p=providerSelect(kind);state.provider=p?p.cur:null;state.model=state.provider?pickInitialModel(state.provider):'';drawChips()}else if(!s.root.isConnected)offBus()});
};

function providerSelect(kind){
  const list=O.mediaProvidersOf(kind);
  if(!list.length)return null;
  const sel=O.store.get('media.lastProvider.'+kind,list[0].id);
  return {list,sel,cur:list.find(p=>p.id===sel)||list[0]};
}

// Searchable picker: only an explicit choice is remembered and used for a paid request.
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
  const list=modelKey(prov);
  if(list.includes(saved))return saved;
  // A provider with exactly one known model needs no explicit pick; with several, stay unselected.
  return list.length===1?list[0]:'';
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

// ---- (35) voice cloning ----
O.mediaVoices=()=>O.store.get('clonedVoices',[]);
O.openVoiceClone=providerId=>{
  const prov=O.mediaProvider(providerId,'tts')||O.mediaProvidersOf('tts')[0];
  if(!prov)return O.toast(O.tr('Add a voice (TTS) provider first','Сначала добавьте провайдер озвучки'),3000);
  const body=h('div');
  const status=h('div',{class:'mut s',style:{margin:'10px 0',whiteSpace:'pre-wrap'}});
  const nameInp=h('input',{placeholder:O.tr('Voice name','Название голоса')});
  let recPath='',recording=false,startedAt=0,timer=null;
  const recBtn=h('button',{class:'btn pri wide',onclick:()=>{
    if(!recording){
      const perms=(O.native.state&&O.native.state().perms)||{};
      if(perms.mic===false){try{OC.grant('mic')}catch(_){}return O.toast(O.tr('Allow microphone access','Разрешите доступ к микрофону'),3000)}
      recPath='/sdcard/Download/OCM/voices/sample_'+Date.now()+'.m4a';
      const r=O.native.voiceSampleStart(recPath);
      if(!r||!r.ok)return O.toast((r&&r.err)||O.tr('Cannot start recording','Не удалось начать запись'),3000);
      recording=true;startedAt=Date.now();
      recBtn.textContent='';recBtn.append(O.icon('stop'),O.tr('Stop recording','Остановить запись'));
      timer=setInterval(()=>{status.textContent=O.tr('Recording… ','Идёт запись… ')+Math.round((Date.now()-startedAt)/1000)+'s / 60s'},500);
    }else{
      clearInterval(timer);recording=false;
      const r=O.native.voiceSampleStop();
      recBtn.textContent='';recBtn.append(O.icon('mic'),O.tr('Record sample (10–30 s)','Записать образец (10–30 с)'));
      if(r&&r.ok){recPath=r.path||recPath;status.textContent=O.tr('Sample saved: ','Образец сохранён: ')+recPath}
      else status.textContent=(r&&r.err)||O.tr('Recording failed','Запись не удалась');
    }
  }},O.icon('mic'),O.tr('Record sample (10–30 s)','Записать образец (10–30 с)'));
  const sendBtn=h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:async()=>{
    if(!recPath)return O.toast(O.tr('Record a sample first','Сначала запишите образец'),2500);
    const name=String(nameInp.value||'').trim()||('voice-'+Date.now().toString(36));
    sendBtn.disabled=true;status.textContent=O.tr('Uploading sample…','Отправляю образец…');
    try{
      const f=await O.native.readDataUrl(recPath);
      const url=withAuth(joinUrl(prov.baseURL,(prov.paths&&prov.paths.voice)||'/audio/voices'),prov);
      const bodyJson=JSON.stringify({name,samples:['data:'+f.mime+';base64,'+f.data]});
      const r=await O.native.netPostToFileAsync(url,authHeaders(prov,true),bodyJson,recPath+'.json',60000);
      let voiceId='';
      try{const o=JSON.parse(r.body||'{}');voiceId=o.id||o.voice_id||o.voice||(o.data&&(o.data.id||o.data.voice_id))||''}catch(_){}
      if(!voiceId)throw new Error(O.tr('Provider did not return a voice id','Провайдер не вернул ID голоса'));
      const l=O.mediaVoices();l.push({id:voiceId,name,provider:prov.id,at:Date.now()});
      O.store.set('clonedVoices',l.slice(0,20));
      status.textContent=O.tr('Voice cloned: ','Голос создан: ')+name+' ('+voiceId+')';
      O.toast(O.tr('Voice ready — pick it in the Voice chip','Голос готов — выберите его в чипе «Голос»'),3000);
      setTimeout(()=>s.close(),1200);
    }catch(e){status.textContent=(e.message||String(e))}
    finally{sendBtn.disabled=false}
  }},O.icon('up'),O.tr('Create voice','Создать голос'));
  body.append(h('div',{class:'note'},O.tr('Read any text aloud for 10–30 seconds. The sample goes to your TTS provider’s voice-cloning endpoint; the returned voice id becomes available in the Voice chip.','Прочитайте вслух любой текст 10–30 секунд. Образец уйдёт на endpoint клонирования вашего TTS-провайдера; полученный ID появится в чипе «Голос».')),
    h('div',{class:'field'},h('label',null,O.tr('Voice name','Название голоса')),nameInp),recBtn,sendBtn,status);
  const saved=O.mediaVoices();
  if(saved.length){
    body.append(h('div',{class:'grp',style:{marginTop:'12px'}},O.tr('Cloned voices','Созданные голоса')));
    saved.forEach(v=>body.append(O.listRow('wave',v.name,v.id+' · '+O.ago(v.at),
      h('button',{class:'ibtn s',onclick:()=>{O.store.set('clonedVoices',O.mediaVoices().filter(x=>x.id!==v.id));s.close();O.openVoiceClone(providerId)}},O.icon('trash')),
      ()=>{O.store.set('media.voice',v.id);O.toast(O.tr('Voice selected: ','Выбран голос: ')+v.name,2000);s.close()})));
  }
  const s=O.sheet(O.tr('Voice cloning','Клонирование голоса'),body,{full:true,onClose:()=>{if(recording){clearInterval(timer);try{O.native.voiceSampleStop()}catch(_){}}}});
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
    const all=O.mediaProviders();
    const removed=all.filter(x=>(x.id===id&&x.kind===prov.kind)||(x.id===originalId&&x.kind===originalKind));
    const list=all.filter(x=>!(x.id===id&&x.kind===prov.kind)&&!(x.id===originalId&&x.kind===originalKind));
    list.push(prov);
    try{O.saveMediaProviders(list,removed)}catch(e){return O.toast(e.message||String(e),3500)}
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
    const all=O.mediaProviders();
    O.saveMediaProviders(all.filter(x=>!(x.id===originalId&&x.kind===originalKind)),all.filter(x=>x.id===originalId&&x.kind===originalKind));s.close();
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
    // FIX (audit J13): a vanished job left this 500ms interval alive forever
    if(!j){clearInterval(wait);O.native.mediaAnswer(d.id,{ok:false,err:'job gone'});return}
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