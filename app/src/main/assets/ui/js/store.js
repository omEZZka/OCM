(function(){
const O=window.OCM,api=O.api;
const bus=O.bus={h:{},on(n,f){(this.h[n]=this.h[n]||[]).push(f);return()=>this.off(n,f)},
  off(n,f){const a=this.h[n];if(!a)return;const i=a.indexOf(f);if(i>=0)a.splice(i,1)},
  emit(n,...a){(this.h[n]||[]).slice().forEach(f=>{try{f(...a)}catch(e){console.error(n,e)}})}};
const S=O.S={dir:'',sessions:[],sid:null,status:{},perms:[],questions:[],todos:{},diffs:{},
  providers:[],agents:[],commands:[],cfg:{},agent:'build',model:null,variant:null,mcp:{},lsp:[],branch:'',
  offline:false,up:false,gstatus:{},account:{email:null,checked:false},opts:Object.assign({thinking:true,details:true,theme:'opencode',fs:14,hideKeyboardAfterSend:false},O.store.get('opts',{}))};
O.saveOpts=()=>{O.store.set('opts',S.opts);document.documentElement.dataset.theme=S.opts.theme;document.documentElement.style.setProperty('--fs',S.opts.fs+'px')};

// ---- IndexedDB key/value cache (offline reading) ----
let dbp;
const db=()=>{
  if(dbp)return dbp;
  dbp=new Promise((res,rej)=>{
    let r;
    try{r=indexedDB.open('ocm',1)}catch(e){rej(e);return}
    r.onupgradeneeded=()=>{try{if(!r.result.objectStoreNames.contains('kv'))r.result.createObjectStore('kv')}catch(_){}};
    r.onsuccess=()=>{
      const d=r.result;
      // a second tab / a profile switch can close the connection under us: reopen on demand
      d.onclose=()=>{dbp=null};
      d.onversionchange=()=>{try{d.close()}catch(_){}dbp=null};
      res(d);
    };
    r.onerror=()=>rej(r.error);
  }).catch(e=>{dbp=null;throw e});
  return dbp;
};
const tx=(mode,fn)=>db().then(d=>new Promise(res=>{
  let t;try{t=d.transaction('kv',mode)}catch(e){dbp=null;res(undefined);return}
  try{fn(t.objectStore('kv'),res,t)}catch(e){res(undefined)}
}));
O.kv={
  async get(k){return tx('readonly',(s,res)=>{const q=s.get(k);q.onsuccess=()=>res(q.result);q.onerror=()=>res(undefined)}).catch(()=>undefined)},
  async set(k,v){return tx('readwrite',(s,res,t)=>{t.oncomplete=()=>res(true);t.onerror=()=>res(false);t.onabort=()=>res(false);try{s.put(v,k)}catch(e){res(false)}}).catch(()=>false)},
  async del(k){return tx('readwrite',(s,res,t)=>{t.oncomplete=()=>res(true);t.onerror=()=>res(false);try{s.delete(k)}catch(e){res(false)}}).catch(()=>false)},
  async clear(){return tx('readwrite',(s,res,t)=>{t.oncomplete=()=>res(true);t.onerror=()=>res(false);try{s.clear()}catch(e){res(false)}}).catch(()=>false)}
};

// Some server builds send session.status as a plain string ("busy"/"idle") and others as an object.
// Everything downstream reads `.type`, so normalise once here instead of in every consumer.
const normStatus=v=>{
  if(v==null)return{type:'idle'};
  if(typeof v==='string')return{type:v};
  if(typeof v==='object'){if(!v.type)v.type=(v.status&&typeof v.status==='string')?v.status:'busy';return v}
  return{type:'idle'};
};

// ---- message store ----
const M=new Map();
O.msgs=sid=>{let x=M.get(sid);if(!x){x={list:[],idx:new Map()};M.set(sid,x)}return x};
const cmp=(a,b)=>a.info.id<b.info.id?-1:a.info.id>b.info.id?1:0;
O.upsertMsg=info=>{const s=O.msgs(info.sessionID);let m=s.idx.get(info.id);
  if(m)m.info=info;else{m={info,parts:[]};s.idx.set(info.id,m);s.list.push(m);if(s.list.length>1&&cmp(s.list[s.list.length-2],m)>0)s.list.sort(cmp)}return m};
// A streaming part receives text from two sources: `part.delta` (incremental) and
// `part.updated` / periodic resync (full snapshot). Snapshots are produced by the server a moment
// later than the deltas, so blindly replacing the part made the answer visibly rewind — "text
// appears, disappears, another appears". Text must only ever grow while the part is unfinished.
const mergePart=(cur,next)=>{
  if(!cur)return next;
  const done=!!(next.time&&next.time.end);
  const out=Object.assign({},next);
  if(!done){
    const curT=cur.text||'',nextT=typeof next.text==='string'?next.text:'';
    if(curT.length>nextT.length&&curT.startsWith(nextT))out.text=curT;
    for(const f of ['reasoning','thinking']){
      const a=cur[f]||'',b=typeof next[f]==='string'?next[f]:'';
      if(a.length>b.length&&a.startsWith(b))out[f]=a;
    }
  }
  return out;
};
O.upsertPart=part=>{const s=O.msgs(part.sessionID);let m=s.idx.get(part.messageID);
  if(!m)m=O.upsertMsg({id:part.messageID,sessionID:part.sessionID,role:'assistant',time:{created:Date.now()}});
  if(m.local){m.parts=[];m.local=false}
  const i=m.parts.findIndex(p=>p.id===part.id);
  if(i>=0)m.parts[i]=mergePart(m.parts[i],part);else{m.parts.push(part);if(m.parts.length>1&&m.parts[m.parts.length-2].id>part.id)m.parts.sort((a,b)=>a.id<b.id?-1:1)}return m};
O.visibleMsgs=sid=>{const s=O.msgs(sid),ses=S.sessions.find(x=>x.id===sid)||O.child(sid),rv=ses&&ses.revert&&ses.revert.messageID;
  return rv?s.list.filter(m=>m.info.id<rv):s.list};
O.child=sid=>S.childSessions&&S.childSessions[sid];
// Per-session debounce: a single shared timer used to swallow the writes of every other
// session that changed within the same 2s window, so switching session quickly lost data.
const saveTimers=new Map();
const writeMsgs=sid=>{const l=O.msgs(sid).list.slice(-250).map(m=>({info:m.info,parts:m.parts}));O.kv.set('msgs:'+sid,l)};
const saveMsgs=sid=>{
  if(!sid)return;
  const prev=saveTimers.get(sid);if(prev)clearTimeout(prev);
  saveTimers.set(sid,setTimeout(()=>{
    saveTimers.delete(sid);
    writeMsgs(sid);
  },2000));
};
// Frees in-memory message stores of sessions nobody looks at any more (long sessions, many children).
O.dropMsgs=sid=>{if(!sid)return;const t=saveTimers.get(sid);if(t){clearTimeout(t);saveTimers.delete(sid)}M.delete(sid)};
// Writes every pending (debounced) session now — used before dropping stores.
const flushPending=()=>{for(const [k,t] of [...saveTimers]){clearTimeout(t);saveTimers.delete(k);try{writeMsgs(k)}catch(_){}}};
const trimStore=()=>{if(M.size<=24)return;
  const keep=new Set([S.sid].concat(S.sessions.slice(0,12).map(s=>s.id)).filter(Boolean));
  for(const k of [...M.keys()]){if(M.size<=18)break;if(keep.has(k))continue;
    // flush the pending debounce first, otherwise up to 2s of the newest messages are lost
    if(saveTimers.has(k)){const t=saveTimers.get(k);clearTimeout(t);saveTimers.delete(k);try{writeMsgs(k)}catch(_){}}
    M.delete(k)}
};

// ---- server events ----
let liveSyncTimer=null;
O.syncSessionMessages=async(sid)=>{
  if(!sid||sid!==S.sid)return;
  try{
    const arr=await api('GET','/session/'+sid+'/message',null,{timeout:15000});
    if(!Array.isArray(arr))return;
    // Periodically the UI pulls the whole message list as a safety net. That snapshot can be a
    // little behind the live deltas, so parts are merged (see mergePart) instead of replaced.
    for(const m of arr){
      if(!m||!m.info)continue;
      O.upsertMsg(m.info);
      if(Array.isArray(m.parts)){
        for(const pt of m.parts) O.upsertPart(pt);
      }
    }
    bus.emit('msg',sid);
    saveMsgs(sid);
  }catch(e){}
};
O.startLiveSync=(sid)=>{
  if(liveSyncTimer)return;
  let busy=false;
  liveSyncTimer=setInterval(async()=>{
    if(busy)return; // a slow status request used to overlap with the next tick
    busy=true;
    try{
      if(!S.sid){O.stopLiveSync();return}
      try{
        const stMap=await api('GET','/session/status',null,{timeout:4000});
        if(stMap){
          for(const k in stMap)S.status[k]=normStatus(stMap[k]);
          if(!stMap[S.sid]||normStatus(stMap[S.sid]).type==='idle'){
            S.status[S.sid]={type:'idle'};
            bus.emit('status',S.sid);
            O.stopLiveSync();
            O.syncSessionMessages(S.sid);
            return;
          }
        }
      }catch(_){}
      const st=S.status[S.sid];
      if(!st||st.type==='idle'){O.stopLiveSync();return}
      await O.syncSessionMessages(S.sid);
    }finally{busy=false}
  },3000);
};
O.stopLiveSync=()=>{
  if(liveSyncTimer){clearInterval(liveSyncTimer);liveSyncTimer=null;}
};

O.onServerEvent=raw=>{let o;try{o=JSON.parse(raw)}catch{return}
  const ev=o.payload||o,p=ev.properties||{};
  const targetSid=p.sessionID||(p.info&&p.info.sessionID)||(p.part&&p.part.sessionID);
  if(o.directory&&o.directory!=='global'&&S.dir&&o.directory!==S.dir&&targetSid!==S.sid&&!/^(permission|question)\./.test(ev.type))return;
  switch(ev.type){
  case'server.connected':S.up=true;bus.emit('conn');break;
  case'session.created':case'session.updated':{const i=p.info;if(!i)break;
    if(i.parentID){(S.childSessions=S.childSessions||{})[i.id]=i;break}
    const k=S.sessions.findIndex(x=>x.id===i.id);if(k>=0)S.sessions[k]=i;else S.sessions.unshift(i);
    S.sessions.sort((a,b)=>b.time.updated-a.time.updated);bus.emit('sessions');if(i.id===S.sid)bus.emit('session');break}
  case'session.deleted':{
    const did=p.info&&p.info.id;
    S.sessions=S.sessions.filter(x=>x.id!==did);
    if(did){O.dropMsgs(did);try{O.kv.del('msgs:'+did)}catch(_){};if(S.childSessions)delete S.childSessions[did]}
    bus.emit('sessions');if(did===S.sid){S.sid=null;O.stopLiveSync();bus.emit('open',null)}break}
  case'session.status':{
    const st=normStatus(p.status);
    S.status[p.sessionID]=st;bus.emit('status',p.sessionID);
    if(p.sessionID===S.sid&&st.type!=='idle')O.startLiveSync(p.sessionID);
    break}
  case'session.idle':
    S.status[p.sessionID]={type:'idle'};bus.emit('status',p.sessionID);bus.emit('idle',p.sessionID);
    if(p.sessionID===S.sid){O.stopLiveSync();O.syncSessionMessages(p.sessionID)}
    break;
  case'session.error':bus.emit('serror',p);break;
  case'session.diff':S.diffs[p.sessionID]=p.diff||[];bus.emit('diff',p.sessionID);break;
  case'message.updated':{const m=O.upsertMsg(p.info);bus.emit('msg',p.info.sessionID,m);saveMsgs(p.info.sessionID);break}
  case'message.removed':{const s=O.msgs(p.sessionID);s.list=s.list.filter(m=>m.info.id!==p.messageID);s.idx.delete(p.messageID);bus.emit('msg-removed',p.sessionID,p.messageID);break}
  case'message.part.updated':{const m=O.upsertPart(p.part);bus.emit('part',p.part.sessionID,m,p.part);saveMsgs(p.part.sessionID);break}
  case'message.part.delta':{
    const s=O.msgs(p.sessionID);let m=s.idx.get(p.messageID);
    if(!m)m=O.upsertMsg({id:p.messageID,sessionID:p.sessionID,role:'assistant',time:{created:Date.now()}});
    let pt=m.parts.find(x=>x.id===p.partID);
    const isThink=(p.field==='reasoning'||p.field==='thinking'||(pt&&pt.type==='reasoning'));
    if(!pt){
      pt={id:p.partID,sessionID:p.sessionID,messageID:p.messageID,type:isThink?'reasoning':'text',text:'',time:{start:Date.now()}};
      if(p.field)pt[p.field]='';
      m.parts.push(pt);
    }
    const f=p.field||'text';
    pt[f]=(pt[f]||'')+p.delta;
    if(isThink){
      pt.type='reasoning';
      if(!pt.text||pt.text!==pt[f])pt.text=pt[f];
    }
    bus.emit('part',p.sessionID,m,pt);break}
  case'message.part.removed':{const m=O.msgs(p.sessionID).idx.get(p.messageID);if(m){m.parts=m.parts.filter(x=>x.id!==p.partID);bus.emit('part-removed',p.sessionID,m,p.partID)}break}
  case'permission.updated':case'permission.asked':{const q=normPerm(p);if(!S.perms.some(x=>x.id===q.id))S.perms.push(q);bus.emit('perm');break}
  case'permission.replied':{const id=p.permissionID||p.requestID||p.id;S.perms=S.perms.filter(x=>x.id!==id);bus.emit('perm');break}
  case'question.asked':{if(!S.questions.some(x=>x.id===p.id))S.questions.push(p);bus.emit('perm');break}
  case'question.replied':case'question.rejected':{const id=p.requestID||p.id;S.questions=S.questions.filter(x=>x.id!==id);bus.emit('perm');break}
  case'todo.updated':S.todos[p.sessionID]=p.todos||[];bus.emit('todo',p.sessionID);break;
  case'file.edited':case'file.watcher.updated':bus.emit('files');break;
  case'vcs.branch.updated':S.branch=p.branch||'';bus.emit('vcs');break;
  case'mcp.tools.changed':case'lsp.updated':bus.emit('statuspanel');break;
  case'pty.exited':case'pty.deleted':bus.emit('pty',p);break}};
const normPerm=p=>({id:p.id,sessionID:p.sessionID,title:p.title||p.permission||p.type||'Разрешение',patterns:[].concat(p.patterns||p.pattern||[]),metadata:p.metadata||{},tool:p.tool,raw:p});

// Brief SSE drops (app frozen in background for a second) must not flash the reconnect banner:
// delay it, cancel when the stream comes back.
let upT=null;
O.on('sse',d=>{if(d.t==='data')O.onServerEvent(d.d);else if(d.t==='open'){if(upT){clearTimeout(upT);upT=null}S.up=true;bus.emit('conn')}
  else if(d.t==='close'){S.up=false;if(!upT)upT=setTimeout(()=>{upT=null;if(!S.up)bus.emit('conn')},5000)}});
// Returning to the foreground: force a fresh stream. Throttled, because the native loop already
// reconnects on its own and repeated restarts would cancel its backoff every time.
let lastSseKick=0;
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){
    // No point polling /session/status every 3s while the UI is not on screen: SSE keeps
    // delivering events in the background, so nothing is missed.
    O.stopLiveSync();
    return;
  }
  if(!S.up){
    const now=Date.now();
    if(now-lastSseKick>=4000){lastSseKick=now;try{OC.sseStart()}catch(e){}}
  }
  // The status map may be stale after a long pause: let the poller verify, it stops itself
  // on the first idle answer.
  if(S.sid)O.startLiveSync(S.sid);
});

// ---- overlay bubble state ----
// The floating bubble lives in a separate Android service, so it reads its state from Prefs. Push a
// compact snapshot whenever the agent state, MM phase or pending confirmations change.
let overlayPushT=0;
const pushOverlay=()=>{
  if(!O.native.setOverlayState)return;
  const now=Date.now();
  if(now-overlayPushT<700)return; // coalesce bursts of deltas
  overlayPushT=now;
  const busy=Object.keys(S.status).some(k=>S.status[k]&&S.status[k].type!=='idle');
  const r=O.mm&&O.mm.run;
  const jobs=(r&&r.jobs||[]).map(j=>j.state==='done'?'done':j.state==='running'?'running':j.state==='error'||j.err?'error':j.state==='stopped'?'stopped':'queued').join(',');
  O.native.setOverlayState({
    phase:r?({plan:O.tr('Planning','Планирование'),role:(r.currentRole||''),synth:O.tr('Synthesis','Синтез')}[r.phase]||r.phase||''):'',
    jobs,
    attention:!!(S.perms.length||S.questions.length),
    error:false
  });
};
// Push once right after boot so the bubble is not stale for a second.
setTimeout(()=>{try{pushOverlay()}catch(_){}},1200);
O.pushOverlay=pushOverlay;
bus.on('status',pushOverlay);
bus.on('perm',pushOverlay);
bus.on('mm:progress',pushOverlay);
bus.on('sessions',pushOverlay);

// ---- opencode account (Zen) status: known once checked, so hints never nag after a login ----
O.checkAccount=async()=>{try{const r=await api('GET','/experimental/console/orgs',null,{timeout:10000});
  const em=r&&r.orgs&&r.orgs.length?[...new Set(r.orgs.map(o=>o.accountEmail))][0]:null;
  S.account={email:em||null,checked:true};bus.emit('meta')}catch{S.account.checked=true}};

// ---- loaders (network first, IndexedDB fallback) ----
O.loadMeta=async()=>{
  const [cp,ag,cm,cf,pr,br]=await Promise.allSettled([api('GET','/config/providers'),api('GET','/agent'),api('GET','/command'),api('GET','/config'),api('GET','/project',null,{dir:false}),api('GET','/vcs')]);
  if(cp.status==='fulfilled'){S.providers=cp.value.providers||[];S.defaults=cp.value.default||{};O.kv.set('providers',cp.value)}
  else{const c=await O.kv.get('providers');if(c){S.providers=c.providers||[];S.defaults=c.default||{}}}
  if(ag.status==='fulfilled'){S.agents=ag.value;O.kv.set('agents',ag.value)}else S.agents=(await O.kv.get('agents'))||[];
  if(cm.status==='fulfilled'){S.commands=cm.value;O.kv.set('commands',cm.value)}else S.commands=(await O.kv.get('commands'))||[];
  if(cf.status==='fulfilled'){S.cfg=cf.value;O.kv.set('cfg',cf.value)}else S.cfg=(await O.kv.get('cfg'))||{};
  S.projects=pr.status==='fulfilled'?pr.value:((await O.kv.get('projects'))||[]);
  if(pr.status==='fulfilled')O.kv.set('projects',pr.value);
  if(br.status==='fulfilled')S.branch=br.value&&br.value.branch||'';
  O.pickDefaults();bus.emit('meta')};
O.isModelFree=x=>{
  if(!x)return false;
  if(x.free===true)return true;
  const m=x.m||x;
  if(m.free===true)return true;
  const c=m.cost;
  if(c&&typeof c.input==='number'&&typeof c.output==='number'){
    if(c.input===0&&c.output===0)return true;
    if(c.input>0||c.output>0)return false;
  }
  const str=((x.name||'')+' '+(x.mid||'')+' '+(x.pid||'')).toLowerCase();
  if(/\bfree\b|бесплатн/i.test(str))return true;
  if(x.pid==='opencode'&&(!c||(!c.input&&!c.output)))return true;
  return false;
};
O.primaryAgents=()=>S.agents.filter(a=>a.mode!=='subagent'&&!a.hidden);
O.pinnedModels=()=>O.store.get('pinnedModels',[]);
O.isModelPinned=k=>O.pinnedModels().includes(k);
O.toggleModelPin=k=>{const l=O.pinnedModels();const i=l.indexOf(k);if(i>=0)l.splice(i,1);else l.push(k);O.store.set('pinnedModels',l);bus.emit('meta')};
O.recentModels=()=>O.store.get('recentModels',[]);
O.pushRecentModel=k=>{if(!k)return;const l=O.recentModels().filter(x=>x!==k);l.unshift(k);O.store.set('recentModels',l.slice(0,8));};
O.sessionOrder=()=>O.store.get('sessionOrder',[]);
O.setSessionOrder=arr=>{O.store.set('sessionOrder',arr);bus.emit('sessions')};
O.moveSessionInOrder=(id,toIndex)=>{const o=O.sessionOrder();const i=o.indexOf(id);if(i<0)return;o.splice(i,1);o.splice(toIndex,0,id);O.setSessionOrder(o)};
// ---- session folders / tags ----
O.sessionTags=()=>O.store.get('sessionTags',{});
O.sessionTag=id=>O.sessionTags()[id]||'';
O.setSessionTag=(id,tag)=>{const m=O.sessionTags();tag=String(tag||'').trim();if(tag)m[id]=tag;else delete m[id];O.store.set('sessionTags',m);bus.emit('sessions')};
O.sessionTagList=()=>[...new Set(Object.values(O.sessionTags()))].filter(Boolean).sort();
O.sessionTagFilter=()=>O.store.get('sessionTagFilter','');
O.setSessionTagFilter=t=>{O.store.set('sessionTagFilter',t||'');bus.emit('sessions')};

// ---- imported (offline) sessions ----
O.localSessions=()=>O.store.get('localSessions',[]);
O.saveLocalSession=s=>{const l=O.localSessions().filter(x=>x.id!==s.id);l.unshift(s);O.store.set('localSessions',l.slice(0,100))};
O.removeLocalSession=id=>{O.store.set('localSessions',O.localSessions().filter(x=>x.id!==id));S.sessions=S.sessions.filter(x=>x.id!==id);bus.emit('sessions')};

// ---- fallback model chain for normal chat ----
O.fallbackModels=()=>O.store.get('fallbackModels',[]);
O.setFallbackModels=l=>{O.store.set('fallbackModels',(l||[]).filter(Boolean).slice(0,5));bus.emit('meta')};
O.fallbackChain=()=>{const cur=S.model?S.model.providerID+'/'+S.model.modelID:'';return O.fallbackModels().filter(k=>k&&k!==cur).map(k=>{const i=k.indexOf('/');return i>0?{providerID:k.slice(0,i),modelID:k.slice(i+1)}:null}).filter(Boolean)};

// ---- local auto title ----
O.isDefaultTitle=t=>!t||/^(New session|Child session|Новая сессия)\b/i.test(String(t));
O.maybeAutoTitle=(sid,text)=>{
  const s=S.sessions.find(x=>x.id===sid);if(!s||!O.isDefaultTitle(s.title))return;
  if(O.visibleMsgs(sid).some(m=>m.info.role==='user'))return;
  const title=String(text||'').replace(/\s+/g,' ').trim().slice(0,60);if(!title)return;
  s.title=title;bus.emit('sessions');
  if(!String(sid).startsWith('local_'))api('PATCH','/session/'+sid,{title}).catch(()=>{});
};

// ---- session JSON export / import ----
O.exportSessionJson=sid=>{
  const s=S.sessions.find(x=>x.id===sid)||{};
  return JSON.stringify({format:'ocm-session',version:1,exportedAt:Date.now(),
    session:{title:O.sessionTitle(s),tag:O.sessionTag(sid),time:s.time},
    messages:O.visibleMsgs(sid).map(m=>({info:m.info,parts:m.parts}))},null,2);
};
O.importSessionJson=text=>{
  let o;try{o=JSON.parse(text)}catch(e){throw new Error('Некорректный JSON')}
  if(!o||!Array.isArray(o.messages))throw new Error('Это не файл сессии OCM');
  const id='local_'+Date.now().toString(36);
  const ses={id,title:(o.session&&o.session.title)||'Импортированная сессия',time:{created:Date.now(),updated:Date.now()},local:true,imported:true};
  O.saveLocalSession(ses);
  const list=o.messages.map((m,mi)=>{const info=Object.assign({},m.info||{},{sessionID:id});if(!info.id)info.id='msg_'+mi+'_'+Date.now().toString(36);if(!info.role)info.role='user';const parts=(m.parts||[]).map((p,pi)=>Object.assign({},p,{sessionID:id,messageID:info.id,id:p.id||('prt_'+mi+'_'+pi+'_'+Date.now().toString(36))}));return{info,parts}});
  O.kv.set('msgs:'+id,list);
  const s=O.msgs(id);s.list=list;s.idx=new Map(list.map(m=>[m.info.id,m]));
  if(o.session&&o.session.tag)O.setSessionTag(id,o.session.tag);
  S.sessions=[ses,...S.sessions.filter(x=>x.id!==id)];bus.emit('sessions');
  return ses;
};

// Draft persistence per session
O.getDraft=sid=>O.store.get('draft.'+sid,'');
O.setDraft=(sid,text)=>{if(!sid)return;O.store.set('draft.'+sid,text)};
O.clearDraft=sid=>{if(!sid)return;O.store.remove('draft.'+sid)};
// Alphabetical sort within each provider: pinned float to the top, then providers A→Z, then models A→Z.
O.sortModelsByProvider=items=>{
  const pn=x=>String(x.pname||x.pid||'').toLowerCase();
  return [...items].sort((a,b)=>{
    const ap=O.isModelPinned(a.pid+'/'+a.mid)?0:1,bp=O.isModelPinned(b.pid+'/'+b.mid)?0:1;
    if(ap!==bp)return ap-bp;
    const c=pn(a).localeCompare(pn(b))||String(a.pid||'').localeCompare(String(b.pid||''));
    if(c)return c;
    return String(a.name||a.mid).localeCompare(String(b.name||b.mid));
  });
};
// ---- API key ring: several keys per provider, rotated when one runs out of quota ----
// Keys live in localStorage (not in the exported settings) and are written into the server's
// auth.json one at a time; the rest wait their turn.
O.keyRing=()=>O.store.get('keyRing',{});
O.keyRingOf=pid=>(O.keyRing()[pid]||[]);
O.keyRingSet=(pid,list)=>{
  const all=O.keyRing();
  const clean=(list||[]).map(k=>String(k||'').trim()).filter(Boolean).slice(0,8);
  if(clean.length)all[pid]=clean;else delete all[pid];
  O.store.set('keyRing',all);
};
O.keyRingIndex=pid=>O.store.get('keyRingIdx.'+pid,0);
O.keyRingActive=pid=>{const l=O.keyRingOf(pid);return l.length?l[Math.min(O.keyRingIndex(pid),l.length-1)]:''};
// Writes the given key into auth.json and asks the server to reload providers.
O.applyProviderKey=async(pid,key)=>{
  try{
    const r=O.native.readText('/root/.local/share/opencode/auth.json');
    let o={};
    try{o=JSON.parse((r&&r.text)||'{}')}catch(_){o={}}
    o[pid]=Object.assign({},o[pid]||{},{type:'api',key});
    const w=O.native.writeText('/root/.local/share/opencode/auth.json',JSON.stringify(o,null,2));
    if(!w||!w.ok)throw new Error((w&&w.err)||O.tr('Cannot write auth.json','Не удалось записать auth.json'));
    try{await api('POST','/instance/dispose',null)}catch(_){}
    await O.loadMeta();
    return true;
  }catch(e){O.toast(e.message||String(e),4000);return false}
};
// Next key for the provider of the given model: used automatically on quota errors.
O.rotateProviderKey=async(pid,quiet)=>{
  const list=O.keyRingOf(pid);
  if(list.length<2)return false;
  const idx=(O.keyRingIndex(pid)+1)%list.length;
  O.store.set('keyRingIdx.'+pid,idx);
  const ok=await O.applyProviderKey(pid,list[idx]);
  if(ok&&!quiet)O.toast(O.tr('Switched to key ','Переключился на ключ ')+(idx+1)+'/'+list.length,2500);
  return ok;
};

// ---- model folders: user-defined groups of models that can be pinned as one block ----
// A folder is {id,name,order,keys:[...],color} and is only a view over `pid/mid` keys, so a folder
// survives provider renames and model churn.
O.modelFolders=()=>{
  const l=O.store.get('modelFolders',[]);
  return Array.isArray(l)?l.filter(f=>f&&f.id):[];
};
O.modelFolderOf=key=>{const f=O.modelFolders().find(x=>(x.keys||[]).includes(key));return f||null};
O.saveModelFolders=l=>{O.store.set('modelFolders',(l||[]).slice(0,60));bus.emit('meta')};
O.createModelFolder=name=>{
  const f={id:'fld_'+Date.now().toString(36),name:String(name||'').trim()||O.tr('New folder','Новая папка'),keys:[],order:O.modelFolders().length,color:''};
  const l=O.modelFolders();l.push(f);O.saveModelFolders(l);return f;
};
O.renameModelFolder=(id,name)=>{const l=O.modelFolders();const f=l.find(x=>x.id===id);if(!f)return;f.name=String(name||'').trim()||f.name;O.saveModelFolders(l)};
O.deleteModelFolder=id=>O.saveModelFolders(O.modelFolders().filter(x=>x.id!==id));
O.moveModelFolder=(id,delta)=>{
  const l=O.modelFolders();const i=l.findIndex(x=>x.id===id);if(i<0)return;
  const j=Math.max(0,Math.min(l.length-1,i+delta));if(i===j)return;
  const [f]=l.splice(i,1);l.splice(j,0,f);l.forEach((x,k)=>x.order=k);O.saveModelFolders(l);
};
// A key lives in at most one folder: adding it here removes it from any other folder.
O.addModelToFolder=(key,folderId)=>{
  const l=O.modelFolders();
  for(const f of l){if(f.id!==folderId&&(f.keys||[]).includes(key))f.keys=f.keys.filter(k=>k!==key)}
  const f=l.find(x=>x.id===folderId);if(!f)return;
  if(!(f.keys||[]).includes(key))f.keys.push(key);
  O.saveModelFolders(l);
};
O.removeModelFromFolder=(key,folderId)=>{
  const l=O.modelFolders();const f=l.find(x=>x.id===folderId);if(!f)return;
  f.keys=(f.keys||[]).filter(k=>k!==key);O.saveModelFolders(l);
};
O.pinnedModelFolders=()=>O.store.get('pinnedModelFolders',[]);
O.isModelFolderPinned=id=>O.pinnedModelFolders().includes(id);
O.toggleModelFolderPin=id=>{
  const l=O.pinnedModelFolders();const i=l.indexOf(id);
  if(i>=0)l.splice(i,1);else l.push(id);
  O.store.set('pinnedModelFolders',l);bus.emit('meta');
};
// Everything inside the pinned folders floats above the normal list (handled by the picker).

// ---- model preference profiles: quick / balanced / quality ----
O.modelProfiles=()=>O.store.get('modelProfiles',{});
O.modelProfile=name=>{const p=O.modelProfiles()[name];return p&&p.main?p:null};
O.setModelProfile=(name,prof)=>{const all=O.modelProfiles();if(prof)all[name]=prof;else delete all[name];O.store.set('modelProfiles',all);bus.emit('meta')};
O.applyModelProfile=async name=>{
  const p=O.modelProfile(name);if(!p)return O.toast(O.tr('Profile is empty','Профиль пуст'),2500);
  const i=p.main.indexOf('/');if(i<1)return;
  O.setModel(p.main.slice(0,i),p.main.slice(i+1));
  if(Array.isArray(p.fallbacks))O.setFallbackModels(p.fallbacks);
  O.toast(O.tr('Profile applied: ','Профиль применён: ')+name,1800);
};
O.hiddenModels=()=>O.store.get('hiddenModels',[]);
O.isModelHidden=k=>O.hiddenModels().includes(k);
O.hideModel=k=>{const l=O.hiddenModels();if(!l.includes(k))l.push(k);O.store.set('hiddenModels',l);bus.emit('meta')};
O.unhideModel=k=>{O.store.set('hiddenModels',O.hiddenModels().filter(x=>x!==k));bus.emit('meta')};
O.modelInfo=(pid,mid)=>{
  const p=S.providers.find(x=>x.id===pid);
  if(p&&p.models&&p.models[mid])return p.models[mid];
  return null;
};
O.allModels=()=>{
  return S.providers.flatMap(p=>Object.values(p.models||{}).map(m=>({pid:p.id,pname:p.name,mid:m.id,name:m.name||m.id,m})));
};
O.pickDefaults=()=>{
  const prim=O.primaryAgents();if(!prim.some(a=>a.name===S.agent))S.agent=(prim[0]&&prim[0].name)||'build';
  const ok=m=>m&&O.modelInfo(m.providerID,m.modelID);
  let m=null;
  if(S.sid){
    const sesSaved=O.store.get('session.model.'+S.sid);
    if(ok(sesSaved))m=sesSaved;
  }
  if(!m){
    const saved=O.store.get('model.'+S.agent);
    if(ok(saved))m=saved;
  }
  const ag=S.agents.find(a=>a.name===S.agent);
  if(!m&&ag&&ag.model&&ok(ag.model))m=ag.model;
  if(!m&&typeof S.cfg.model==='string'&&S.cfg.model.includes('/')){const[i,...r]=S.cfg.model.split('/');const c={providerID:i,modelID:r.join('/')};if(ok(c))m=c}
  if(!m){
    const all=O.allModels();
    const onlyFree=O.store.get('onlyFreeModels',true);
    let d=null;
    if(onlyFree){
      d=all.find(x=>O.isModelFree(x)&&S.defaults[x.pid]===x.mid)||all.find(x=>O.isModelFree(x));
    }
    if(!d)d=all.find(x=>S.defaults[x.pid]===x.mid)||all[0];
    if(d)m={providerID:d.pid,modelID:d.mid};
  }
  S.model=m||null;
  let v=null;
  if(S.sid){
    const sesV=O.store.get('session.variant.'+S.sid);
    if(sesV&&m&&O.modelInfo(m.providerID,m.modelID)&&O.modelInfo(m.providerID,m.modelID).variants&&O.modelInfo(m.providerID,m.modelID).variants[sesV])v=sesV;
  }
  if(!v){
    const globalV=O.store.get('variant.'+(m?m.providerID+'/'+m.modelID:''));
    if(globalV&&m&&O.modelInfo(m.providerID,m.modelID)&&O.modelInfo(m.providerID,m.modelID).variants&&O.modelInfo(m.providerID,m.modelID).variants[globalV])v=globalV;
  }
  S.variant=v;
};
// Cycling through models with a swipe needs a stable, meaningful order: use the same order the
// picker shows, but without hidden models and without the folder grouping (flat list).
O.cycleModel=dir=>{
  const all=O.allModels().filter(x=>!O.isModelHidden(x.pid+'/'+x.mid));
  if(!all.length)return;
  let list=O.sortModelsByProvider(all);
  const onlyFree=O.store.get('onlyFreeModels',true);
  const free=list.filter(x=>O.isModelFree(x));
  if(onlyFree&&free.length)list=free;
  // pinned models first, like the picker
  const pinned=O.pinnedModels();
  if(pinned.length){
    const p=list.filter(x=>pinned.includes(x.pid+'/'+x.mid));
    const rest=list.filter(x=>!pinned.includes(x.pid+'/'+x.mid));
    if(p.length)list=p.concat(rest);
  }
  const cur=S.model?S.model.providerID+'/'+S.model.modelID:'';
  let i=list.findIndex(x=>x.pid+'/'+x.mid===cur);
  if(i<0)i=dir>0?-1:0;
  const next=list[(i+(dir>0?1:list.length-1))%list.length];
  if(!next)return;
  O.setModel(next.pid,next.mid);
  O.toast(O.tr('Model: ','Модель: ')+(next.name||next.mid),1400);
};
O.setModel=(pid,mid)=>{
  S.model={providerID:pid,modelID:mid};
  O.store.set('model.'+S.agent,S.model);
  if(S.sid)O.store.set('session.model.'+S.sid,S.model);
  O.pushRecentModel(pid+'/'+mid);
  O.pickDefaults();
  if(O.updateReadmeForModel) O.updateReadmeForModel(mid);
  bus.emit('meta');
};
O.setAgent=n=>{S.agent=n;O.pickDefaults();bus.emit('meta')};
// ---- reasoning effort ----
// Ordering is fixed from weakest to strongest so every surface (model list, chat chip) shows the
// same ladder. Model-specific variants are merged in when the provider exposes them.
const EFFORT_ORDER=['minimal','low','medium','high','max','xhigh','default'];
O.effortLevels=()=>{
  const m=S.model&&O.modelInfo(S.model.providerID,S.model.modelID);
  const vars=m&&m.variants?Object.keys(m.variants):[];
  const base=['low','medium','high'];
  const all=[...new Set(base.concat(vars))];
  return all.sort((a,b)=>{
    const ia=EFFORT_ORDER.indexOf(String(a).toLowerCase()),ib=EFFORT_ORDER.indexOf(String(b).toLowerCase());
    return (ia<0?99:ia)-(ib<0?99:ib);
  });
};
O.effortLabel=v=>({minimal:O.tr('Minimal','Минимальный'),low:O.tr('Low','Низкий'),medium:O.tr('Medium','Средний'),high:O.tr('High','Высокий'),max:O.tr('Max','Максимальный'),xhigh:O.tr('Extra high','Очень высокий'),default:O.tr('Default','По умолчанию')}[v]||v);
O.currentEffort=()=>S.variant||'';
O.setEffort=v=>{
  O.setVariant(v||null);
  O.store.set('effort',v||'');
  bus.emit('meta');
};
// Shared picker used by the model list and by the chat's model chip.
O.openEffortPicker=()=>{
  const levels=O.effortLevels();
  const cur=O.currentEffort();
  const items=levels.map(v=>({
    label:O.effortLabel(v),
    sub:v===cur?O.tr('current','выбрано'):'',
    icon:v===cur?'check':'dot',
    fn:()=>{O.setEffort(v);O.toast(O.tr('Reasoning: ','Рассуждение: ')+O.effortLabel(v),1500)}
  }));
  items.push({label:O.tr('Default','По умолчанию'),sub:cur?'':O.tr('current','выбрано'),icon:cur?'dots':'check',fn:()=>{O.setEffort('');O.toast(O.tr('Reasoning: default','Рассуждение: по умолчанию'),1500)}});
  O.actions(O.tr('Reasoning effort','Уровень рассуждения'),items);
};
O.setVariant=v=>{
  S.variant=v;
  if(S.model)O.store.set('variant.'+S.model.providerID+'/'+S.model.modelID,v);
  if(S.sid)O.store.set('session.variant.'+S.sid,v);
  bus.emit('meta');
};

O.loadSessions=async()=>{
  let remote=[];
  try{const l=await api('GET','/session');remote=l.filter(s=>!s.parentID).sort((a,b)=>b.time.updated-a.time.updated);S.offline=false;O.kv.set('sessions:'+S.dir,remote)}
  catch(e){const c=await O.kv.get('sessions:'+S.dir);if(c)remote=c;S.offline=true}
  const locals=O.localSessions();
  S.sessions=locals.concat(remote.filter(s=>!locals.some(x=>x.id===s.id)));
  try{const st=await api('GET','/session/status');for(const k in st)S.status[k]=normStatus(st[k])}catch{}
  bus.emit('sessions')};
O.loadPending=async()=>{
  try{const p=await api('GET','/permission');S.perms=(p||[]).map(normPerm)}catch{}
  try{const q=await api('GET','/question');S.questions=q||[]}catch{}
  bus.emit('perm')};
O.openSession=async(sid,fresh)=>{
  if(S.sid!==sid)O.stopLiveSync();
  S.sid=sid;O.store.set('sid.'+S.dir,sid);
  trimStore();
  if(!sid){bus.emit('open',null);return}
  if(String(sid).startsWith('local_')){
    const s=O.msgs(sid);
    if(!s.list.length){const c=await O.kv.get('msgs:'+sid);if(c)c.forEach(m=>{s.list.push(m);s.idx.set(m.info.id,m)})}
    O.pickDefaults();bus.emit('meta');bus.emit('open',sid);return;
  }
  const ok=m=>m&&O.modelInfo(m.providerID,m.modelID);
  const sesSaved=O.store.get('session.model.'+sid);
  if(ok(sesSaved)){
    S.model=sesSaved;
    S.variant=O.store.get('session.variant.'+sid)||null;
  }else{
    const s0=O.msgs(sid);
    const lastM=[...s0.list].reverse().find(x=>x.info&&x.info.providerID&&x.info.modelID);
    if(lastM&&ok({providerID:lastM.info.providerID,modelID:lastM.info.modelID})){
      S.model={providerID:lastM.info.providerID,modelID:lastM.info.modelID};
      O.store.set('session.model.'+sid,S.model);
    }else{
      O.pickDefaults();
    }
  }
  bus.emit('meta');
  const s=O.msgs(sid);
  if(!s.list.length){const c=await O.kv.get('msgs:'+sid);if(c)c.forEach(m=>{s.list.push(m);s.idx.set(m.info.id,m)})}
  bus.emit('open',sid);
  if(fresh)return;
  const prevCount=s.list.length,prevLast=s.list.length?s.list[s.list.length-1].info.id:'';
  try{const arr=await api('GET','/session/'+sid+'/message',null,{timeout:120000});
    if(S.sid!==sid)return; // the user switched away while the request was in flight
    s.list=[];s.idx=new Map();for(const m of arr){const x={info:m.info,parts:m.parts};s.list.push(x);s.idx.set(m.info.id,x)}
    if(!sesSaved){
      const lastRemote=[...s.list].reverse().find(x=>x.info&&x.info.providerID&&x.info.modelID);
      if(lastRemote&&ok({providerID:lastRemote.info.providerID,modelID:lastRemote.info.modelID})){
        S.model={providerID:lastRemote.info.providerID,modelID:lastRemote.info.modelID};
        O.store.set('session.model.'+sid,S.model);
        bus.emit('meta');
      }
    }
    S.offline=false;
    const newLast=s.list.length?s.list[s.list.length-1].info.id:'';
    if(s.list.length!==prevCount||newLast!==prevLast)bus.emit('open',sid);
    saveMsgs(sid)}catch(e){S.offline=true;bus.emit('conn')}
  api('GET','/session/'+sid+'/todo').then(t=>{S.todos[sid]=t;bus.emit('todo',sid)}).catch(()=>{});
  api('GET','/session/'+sid+'/diff').then(d=>{S.diffs[sid]=d;bus.emit('diff',sid)}).catch(()=>{});
  O.loadPending()};
O.newSession=async()=>{const s=await api('POST','/session',{});if(!S.sessions.some(x=>x.id===s.id))S.sessions.unshift(s);bus.emit('sessions');await O.openSession(s.id,true);return s};
O.setDir=async(dir)=>{
  S.dir=dir;O.dir=dir;O.store.set('dir',dir);
  const rec=O.store.get('recent',[]).filter(x=>x!==dir);rec.unshift(dir);O.store.set('recent',rec.slice(0,12));
  S.sessions=[];S.sid=null;S.perms=[];S.questions=[];S.diffs={};S.todos={};
  O.stopLiveSync();
  flushPending();
  // Every in-memory message store belongs to the previous directory: keeping them wastes RAM and
  // could mix messages between projects when ids collide.
  for(const k of [...M.keys()])O.dropMsgs(k);
  bus.emit('dir');
  await Promise.all([O.loadMeta(),O.loadSessions()]);
  const last=O.store.get('sid.'+dir);const pick=S.sessions.find(x=>x.id===last)||S.sessions[0];
  await O.openSession(pick?pick.id:null);bus.emit('files')};
O.sessionTitle=s=>s?(s.title&&!/^(New session|Child session|Новая сессия) - /.test(s.title)?s.title:'Новая сессия'):'OpenCode';
// One-line summary for the sessions drawer: tokens spent and what is left in the context window.
O.sessionStats=sid=>{
  const u=O.contextUsage(sid);
  const msgs=O.msgs(sid).list;
  let tok=0,cost=0;
  for(const m of msgs){
    const i=m.info;
    if(i&&i.tokens)tok+=(i.tokens.input||0)+(i.tokens.output||0)+(i.tokens.reasoning||0);
    if(i&&typeof i.cost==='number')cost+=i.cost;
  }
  return{tok,cost,pct:u?u.pct:null,lim:u?u.lim:null};
};
O.contextUsage=sid=>{const l=O.visibleMsgs(sid);for(let i=l.length-1;i>=0;i--){const x=l[i].info;if(x.role==='assistant'&&x.tokens&&(x.tokens.input||x.tokens.output)){
  const t=x.tokens,tot=(t.input||0)+(t.output||0)+(t.reasoning||0)+((t.cache&&t.cache.read)||0)+((t.cache&&t.cache.write)||0);
  const mi=O.modelInfo(x.providerID,x.modelID),lim=mi&&mi.limit&&mi.limit.context;
  return{tot,pct:lim?Math.round(tot*100/lim):null,lim:lim||null}}}return null};
// Context left in the window, for one session or for the active one (used by model list & drawer).
O.contextLeft=sid=>{
  const u=O.contextUsage(sid||S.sid);
  if(!u||!u.lim)return null;
  const left=Math.max(0,u.lim-u.tot);
  return{left,lim:u.lim,pct:Math.round(left*100/u.lim),usedPct:u.pct};
};
// ---- "continue generation" ----
// OpenCode has no dedicated continue endpoint, so we resume by sending a single synthetic prompt
// with `noReply:false` and an explicit instruction. The last assistant text is passed as context so
// the model resumes exactly where the stream was cut (stop button, quota, network, app kill).
O.lastAssistant=(sid)=>{
  const l=O.visibleMsgs(sid||S.sid);
  for(let i=l.length-1;i>=0;i--){
    const m=l[i];
    if(m.info.role!=='assistant')continue;
    const t=m.parts.filter(p=>p.type==='text'&&!p.synthetic).map(p=>p.text).join('\n').trim();
    return {msg:m,text:t};
  }
  return null;
};
O.canContinue=(sid)=>{
  const st=S.status[sid||S.sid];
  if(st&&st.type!=='idle')return false; // already generating
  const last=O.lastAssistant(sid);
  if(!last)return false;
  // Only offer it when the previous answer was actually interrupted (no completion time) or
  // ended with an abort/error.
  if(last.msg.info.error)return true;
  return !(last.msg.info.time&&last.msg.info.time.completed);
};
O.continueGeneration=async(sid,opts)=>{
  sid=sid||S.sid;
  if(!sid||!S.model)return O.toast(O.tr('Select a model first','Сначала выберите модель'),2500);
  const last=O.lastAssistant(sid);
  if(!last)return O.toast(O.tr('Nothing to continue','Нечего продолжать'),2000);
  const tail=last.text.slice(-4000);
  const instr=opts&&opts.custom?opts.custom:
    'Продолжи ровно с того места, где предыдущий ответ был оборван. Не повторяй уже написанное, '+
    'не начинай заново, не добавляй вступлений или извинений. Продолжай сразу с текста.';
  const parts=[];
  if(tail)parts.push({type:'text',text:'[Предыдущий ответ, оборван на этом месте]:\n…'+tail+'\n…'});
  parts.push({type:'text',text:instr});
  const mid=O.mid();
  const m=O.upsertMsg({id:mid,sessionID:sid,role:'user',time:{created:Date.now()},agent:S.agent,model:S.model});
  m.local=true;m.parts=parts.map((p,i)=>Object.assign({id:'prt_local_cont'+i,sessionID:sid,messageID:mid},p));
  m.synthetic=true;
  try{
    await api('POST','/session/'+sid+'/prompt_async',{messageID:mid,agent:S.agent,model:S.model,variant:S.variant||undefined,parts},{timeout:60000});
    bus.emit('msg',sid,m);
    O.toast(O.tr('Continuing…','Продолжаю…'),1500);
  }catch(e){O.toast(e.message||String(e),4000)}
};

O.replyPermission=async(p,r)=>{
  const tries=[()=>api('POST','/permission/'+p.id+'/reply',{reply:r}),()=>api('POST','/session/'+p.sessionID+'/permissions/'+p.id,{response:r}),()=>api('POST','/api/session/'+p.sessionID+'/permission/'+p.id+'/reply',{reply:r})];
  for(const t of tries){try{await t();S.perms=S.perms.filter(x=>x.id!==p.id);bus.emit('perm');return}catch(e){if(e.status!==404&&e.status!==405&&e.status!==400)throw e}}
  throw new Error('Ответ на разрешение не поддерживается этой версией сервера')};

// ---- Plugin system ----
O.plugins=O.store.get('customPlugins',[]);
O.enabledPlugins=()=>O.plugins.filter(p=>p.enabled);
O.loadPlugins=async()=>{
  for(const p of O.enabledPlugins()){
    if(p.code){
      try{
        const fn=new Function('O','S','api','bus','h','return '+p.code);
        const plugin=fn(O,O.S,O.api,O.bus,O.h);
        if(plugin&&typeof plugin==='object'){
          p._instance=plugin;
          if(plugin.onLoad)plugin.onLoad(O);
        }
      }catch(e){console.error('Plugin load error:',p.name,e)}
    }
  }
};
O.addPlugin=(name,code,enabled=true)=>{
  const id='plug_'+Date.now().toString(36);
  const p={id,name,code,enabled,createdAt:Date.now()};
  O.plugins.push(p);
  O.store.set('customPlugins',O.plugins);
  if(enabled){
    try{
      const fn=new Function('O','S','api','bus','h','return '+code);
      const plugin=fn(O,O.S,O.api,O.bus,O.h);
      if(plugin&&typeof plugin==='object'){
        p._instance=plugin;
        if(plugin.onLoad)plugin.onLoad(O);
      }
    }catch(e){console.error('Plugin add error:',e)}
  }
  bus.emit('plugins');
};
O.removePlugin=id=>{
  const p=O.plugins.find(x=>x.id===id);
  if(p&&p._instance&&p._instance.onUnload)p._instance.onUnload(O);
  O.plugins=O.plugins.filter(x=>x.id!==id);
  O.store.set('customPlugins',O.plugins);
  bus.emit('plugins');
};
O.togglePlugin=id=>{
  const p=O.plugins.find(x=>x.id===id);
  if(p){p.enabled=!p.enabled;O.store.set('customPlugins',O.plugins);
    if(p.enabled&&p.code){
      try{
        const fn=new Function('O','S','api','bus','h','return '+p.code);
        p._instance=fn(O,O.S,O.api,O.bus,O.h);
        if(p._instance.onLoad)p._instance.onLoad(O);
      }catch(e){console.error('Plugin enable error:',e)}
    }else if(p._instance&&p._instance.onUnload){
      p._instance.onUnload(O);
      p._instance=null;
    }
    bus.emit('plugins');
  }
};
O.runHook=(name,...args)=>{
  for(const p of O.enabledPlugins()){
    if(p._instance&&typeof p._instance[name]==='function'){
      try{p._instance[name](...args)}catch(e){console.error('Hook error:',p.name,name,e)}
    }
  }
};

// ---- settings export / import (localStorage + opencode.json) ----
const SETTINGS_SKIP=new Set(['author_token']);
O.exportSettings=()=>{
  const ls={};
  try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(!k||!k.startsWith('ocm.'))continue;const short=k.slice(4);if(SETTINGS_SKIP.has(short))continue;ls[short]=localStorage.getItem(k)}}catch(_){}
  let config='';
  try{const c=O.native.cfgRead();if(c)config=c}catch(_){}
  return JSON.stringify({format:'ocm-settings',version:1,exportedAt:Date.now(),app:S.opts&&S.opts.theme||'',localStorage:ls,config},null,2);
};
O.importSettings=text=>{
  let o;try{o=JSON.parse(text)}catch(e){throw new Error(O.tr('Invalid JSON','Некорректный JSON'))}
  if(!o||o.format!=='ocm-settings'||typeof o.localStorage!=='object')throw new Error(O.tr('Not an OCM settings file','Это не файл настроек OCM'));
  let n=0;
  for(const k in o.localStorage){try{localStorage.setItem('ocm.'+k,o.localStorage[k]);n++}catch(_){}}
  if(typeof o.config==='string'&&o.config.trim()){try{O.native.cfgWrite(o.config)}catch(_){}}
  return n;
};
O.lastFallback=()=>O.store.get('lastFallback',null);
O.setLastFallback=v=>{O.store.set('lastFallback',v||null)};

})();
