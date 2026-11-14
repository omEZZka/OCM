(function(){
const O=window.OCM;
const pend=new Map();let seq=0;const L={};
O.on=(n,f)=>{(L[n]=L[n]||[]).push(f);return()=>O.off(n,f)};
O.off=(n,f)=>{const a=L[n];if(!a)return;const i=a.indexOf(f);if(i>=0)a.splice(i,1)};
window.OCEvent=(n,d)=>{if(n==='http'){finishHttp(d);return}(L[n]||[]).forEach(f=>{try{f(d)}catch(e){console.error(n,e)}})};
O.dir='';
// ---- read-only request cache (opt-in) ----
// Read-only endpoints get polled from several places at once (status bar, file tree, diffs).
// Callers that genuinely tolerate a short delay can pass {cache:true}: identical GETs in flight are
// coalesced and a 1s memo absorbs bursts, which keeps the proot-side server from doing duplicate work.
const getCache=new Map();      // key -> {t, data}
const getInflight=new Map();   // key -> Promise
function cachedGet(method,path,body,opt){
  if(method!=='GET'||!opt.cache)return null;
  const ttl=opt.ttl||1000;
  const hit=getCache.get(path);
  if(hit&&Date.now()-hit.t<ttl)return Promise.resolve(hit.data);
  const inflight=getInflight.get(path);
  if(inflight)return inflight;
  const pr=rawApi(method,path,body,opt).then(data=>{
    getCache.set(path,{t:Date.now(),data});
    if(getCache.size>200){const now=Date.now();for(const [k,v] of getCache)if(now-v.t>30000)getCache.delete(k)}
    return data;
  }).finally(()=>getInflight.delete(path));
  getInflight.set(path,pr);
  return pr;
}
// Any mutation invalidates matching reads so a refresh after an edit is never stale.
O.invalidateCache=prefix=>{
  if(!prefix){getCache.clear();return}
  for(const k of getCache.keys())if(k.startsWith(prefix))getCache.delete(k);
};
// api(method, path, body, {dir, timeout, raw, cache, ttl})
O.api=(method,path,body,opt)=>{
  opt=opt||{};
  if(method!=='GET')O.invalidateCache('/file');
  const c=cachedGet(method,path,body,opt);
  return c||rawApi(method,path,body,opt);
};
function rawApi(method,path,body,opt){opt=opt||{};
  return new Promise((res,rej)=>{
    const id='r'+(++seq)+'_'+Date.now().toString(36);let p=path;
    if(opt.dir!==false){const d=typeof opt.dir==='string'?opt.dir:O.dir;if(d)p+=(p.includes('?')?'&':'?')+'directory='+encodeURIComponent(d)}
    // the watchdog is cleared as soon as the response lands; otherwise every request kept a live
    // timer for its full timeout, which accumulates over a long session
    const timer=setTimeout(()=>{if(pend.has(id)){pend.delete(id);rej(Object.assign(new Error('timeout'),{net:true}))}},opt.timeout||60000);
    pend.set(id,{res,rej,raw:opt.raw,timer});
    try{OC.http(id,method,p,body==null?'':JSON.stringify(body))}catch(e){clearTimeout(timer);pend.delete(id);rej(e)}
  });
}
async function finishHttp(d){const p=pend.get(d.id);if(!p)return;pend.delete(d.id);clearTimeout(p.timer);
  if(d.err){p.rej(Object.assign(new Error(d.err),{status:0,net:true}));return}
  let text=d.body||'';
  if(d.file){try{text=await(await fetch('/_resp/'+d.id)).text()}catch(e){p.rej(e);return}finally{try{OC.drop(d.id)}catch{}}}
  let data=text;if(!p.raw&&text&&(d.ct||'').includes('json')){try{data=JSON.parse(text)}catch{}}
  if(d.status>=200&&d.status<300)p.res(data);
  else p.rej(Object.assign(new Error((data&&data.data&&data.data.message)||(data&&data.message)||(typeof data==='string'&&data.slice(0,200))||('HTTP '+d.status)),{status:d.status,data}))}
// native helpers (sync, local)
const j=s=>{try{return JSON.parse(s)}catch{return null}};
O.native={
  ls:p=>j(OC.ls(p))||{err:'ls failed'},
  fs:(op,p,arg)=>j(OC.fs(op,p,arg||''))||{ok:false,err:'fs failed'},
  readText:p=>j(OC.readText(p))||{ok:false},
  writeText:(p,t)=>j(OC.writeText(p,t))||{ok:false},
  cfgRead:()=>OC.cfgRead(),cfgWrite:t=>j(OC.cfgWrite(t))||{ok:false},
  copy:t=>{try{OC.copy(t);O.toastQuiet('Скопировано')}catch{}},share:t=>OC.share(t),open:u=>OC.openLink(u),
  openApp:t=>(window.OC&&OC.openApp?OC.openApp(t):false),
  preparePreview:p=>(window.OC&&OC.preparePreview?OC.preparePreview(p):''),
  notify:(kind,title,text)=>{try{if(window.OC&&OC.notify)OC.notify(kind,title,text)}catch(_){}},
  autoBackupState:()=>{try{return j(OC.autoBackupState())||{}}catch(_){return{}}},
  autoBackupConfigure:(enabled,hours,password)=>{try{return j(OC.autoBackupConfigure(enabled,hours,password))||{ok:false}}catch(_){return{ok:false}}},
  autoBackupNow:password=>{try{return j(OC.autoBackupNow(password||''))||{ok:false}}catch(_){return{ok:false}}},
  gitRun:(dir,args)=>{try{return j(OC.gitRun(dir,args))||{ok:false}}catch(_){return{ok:false}}},
  checkpointCreate:(dir,label)=>{try{return j(OC.checkpointCreate(dir,label||''))||{ok:false}}catch(_){return{ok:false}}},
  checkpointList:()=>{try{return j(OC.checkpointList())||{ok:false,items:[]}}catch(_){return{ok:false,items:[]}}},
  checkpointRestore:(dir,sha)=>{try{return j(OC.checkpointRestore(dir,sha))||{ok:false}}catch(_){return{ok:false}}},
  startOverlay:()=>{try{OC.startOverlay()}catch(_){}},
  stopOverlay:()=>{try{OC.stopOverlay()}catch(_){}},
  overlayState:()=>{try{return j(OC.overlayState())||{}}catch(_){return{}}},
  setOverlayState:o=>{try{if(OC.setOverlayState)OC.setOverlayState(JSON.stringify(o||{}))}catch(_){}},
  sttStart:(mode,lang,bias)=>{try{OC.sttStart(mode||'system',lang||'ru-RU',(bias||[]).join(','))}catch(_){}},
  sttStop:()=>{try{OC.sttStop()}catch(_){}},
  sttAvailable:()=>{try{return !!OC.sttAvailable()}catch(_){return false}},
  ttsInit:(voice,rate,pitch)=>{try{OC.ttsInit(voice||'',rate||1,pitch||1)}catch(_){}},
  ttsSpeak:t=>{try{OC.ttsSpeak(t||'')}catch(_){}},
  ttsStop:()=>{try{OC.ttsStop()}catch(_){}},
  ttsConfigure:(voice,rate,pitch)=>{try{OC.ttsConfigure(voice||'',rate||1,pitch||1)}catch(_){}},
  ttsVoices:()=>{try{return j(OC.ttsVoices())||[]}catch(_){return[]}},
  diagnose:()=>{try{return j(OC.diagnose())||{}}catch(e){return{error:String(e)}}},
  // Encrypted key-value store (Keystore-backed). Falls back to localStorage if unavailable.
  securePut:(k,v)=>{try{return !!OC.securePut(k,v)}catch(_){return false}},
  secureGet:k=>{try{return OC.secureGet(k)||''}catch(_){return''}},
  secureRemove:k=>{try{return !!OC.secureRemove(k)}catch(_){return false}},
  secureImportLegacy:o=>{try{return !!OC.secureImportLegacy(JSON.stringify(o||{}))}catch(_){return false}},
  state:()=>j(OC.state())||{}
};
O.openUrl=u=>{if(/^https?:\/\//i.test(u)&&!/appassets\.androidplatform\.net/i.test(u))OC.openLink(u)};
document.addEventListener('click',e=>{const a=e.target.closest&&e.target.closest('a[href]');if(!a)return;const u=a.getAttribute('href');e.preventDefault();if(/^https?:\/\//i.test(u))O.openUrl(u)});
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-copy]');if(!b)return;const pre=b.closest('.codeblock');if(pre)O.native.copy(pre.querySelector('pre').innerText)});
})();
