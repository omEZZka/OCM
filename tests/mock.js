(function(){
const srv={sessions:[],msgs:{},calls:[]};window.__srv=srv;
const DEF={version:'1.0.8',code:1,user:'dev@example.com',name:'Dev',guest:false,googleConfigured:true,installed:true,core:'v1.18.5',perms:{notifications:true,files:true,install:true,battery:false},flags:{snd_done:true,snd_action:true,snd_quota:false,noseccomp:false},ready:true};
const route=(method,path,body)=>{const u=new URL('http://x'+path),p=u.pathname;srv.calls.push({method,p,q:u.search,body:body?JSON.parse(body):null});
 if(p==='/config/providers')return{providers:[{id:'opencode',name:'OpenCode Zen',models:{
   'big-pickle':{id:'big-pickle',name:'Big Pickle',limit:{context:200000},cost:{input:0,output:0},variants:{low:{},high:{}}},
   'gpt-x':{id:'gpt-x',name:'GPT X',limit:{context:100000},cost:{input:1,output:2}},
   'claude-super-long-preview-ultra-experimental-context-window-1m':{id:'claude-super-long-preview-ultra-experimental-context-window-1m',name:'Claude Super Long Preview Ultra Experimental Context Window 1M',limit:{context:1000000},cost:{input:0,output:0},variants:{low:{},high:{}}}}}],default:{opencode:'big-pickle'}};
 if(p==='/experimental/console/orgs')return window.__orgs!==undefined?window.__orgs:{orgs:[{accountEmail:'dev@example.com',orgName:'Org',active:true}]};
 if(p==='/provider')return{all:[{id:'opencode',name:'OpenCode'},{id:'anthropic',name:'Anthropic'}],connected:['opencode'],default:{}};
 if(p==='/provider/auth')return{anthropic:[{type:'oauth',label:'Claude Pro/Max'},{type:'api',label:'API key'}]};
 if(p==='/agent')return[{name:'build',mode:'primary',description:'Default agent'},{name:'plan',mode:'primary',description:'Read-only'},{name:'general',mode:'subagent',description:'Search'}];
 if(p==='/command')return[{name:'review',description:'Review changes'}];
 if(p==='/config')return{plugin:['oh-my-openagent@latest','opencode-gemini-auth']};
 if(p==='/project')return[{id:'p1',worktree:'/root/app'}];
 if(p==='/vcs')return{branch:'main'};
 if(p==='/session'&&method==='GET')return srv.sessions;
 if(p==='/session'&&method==='POST'){const s={id:'ses_'+(srv.sessions.length+1),title:'New session - 2026',time:{created:Date.now(),updated:Date.now()},directory:'/root'};srv.sessions.unshift(s);srv.msgs[s.id]=[];return s}
 if(p==='/session/status')return{};
 if(/\/session\/[^/]+\/message$/.test(p))return srv.msgs[p.split('/')[2]]||[];
 if(/\/(todo|diff)$/.test(p))return[];
 if(p==='/permission'||p==='/question')return[];
 if(p==='/file')return[{name:'src',path:'src',absolute:'/root/src',type:'directory',ignored:false},{name:'main.py',path:'main.py',absolute:'/root/main.py',type:'file',ignored:false},{name:'README.md',path:'README.md',absolute:'/root/README.md',type:'file',ignored:false}];
 if(p==='/file/status')return[{path:'main.py',added:2,removed:1,status:'modified'}];
 if(p==='/file/content')return{type:'text',content:'import os\nprint("hi")\n'};
 if(p==='/mcp')return{ctx7:{status:'connected'},broken:{status:'failed',error:'spawn error'}};
 if(p==='/lsp')return[];
 if(p==='/find/file')return['main.py','src/'];
 if(/prompt_async$/.test(p)){setTimeout(()=>window.__onPrompt(JSON.parse(body)),30);return{}}
 if(/permission/.test(p))return true;
 return{}};
let sse=false;
window.__push=ev=>OCEvent('sse',{t:'data',d:JSON.stringify({directory:'/root',payload:ev})});
window.__st=Object.assign({},DEF);
window.__mkSt=o=>Object.assign({},DEF,o);
window.OC={
 state:()=>JSON.stringify(window.__st),
 signIn(){window.__signIn=1},signInEmail(v){window.__st=window.__mkSt({user:v,name:String(v).split('@')[0],guest:false});setTimeout(()=>OCEvent('signin',{ok:true}),5)},
 signInGuest(fresh){window.__guestCalls=(window.__guestCalls||0)+1;window.__st=window.__mkSt(Object.assign({},window.__st,{user:'guest-7f3a9c21@device.local',name:'Гость-7F3A',guest:true,pw:'Xy12Ab34Cd56Ef78'}));setTimeout(()=>OCEvent('signin',{ok:true,guest:true}),5)},
 signOut(){window.__st=window.__mkSt({user:'',name:'',guest:false});setTimeout(()=>OCEvent('signedout',{}),5)},
 authLogin(){window.__authLogin=1},authCancel(){},authLogout(e){window.__authLogout=e;setTimeout(()=>OCEvent('authlogout',{ok:true}),5)},
 install(){if(window.__failInstall){window.__failInstall=0;OCEvent('install',{error:'Не удалось распаковать элемент «usr/bin» — ENOSPC'});return}OCEvent('install',{pct:10});setTimeout(()=>OCEvent('install',{done:true}),20)},
 resetInstall(){window.__resetInstall=1;OCEvent('install',{pct:30});setTimeout(()=>OCEvent('install',{done:true}),20)},
  start(){setTimeout(()=>OCEvent('ready',{}),10)},restartServer(){window.__restarted=1},resetConfig(){window.__resetConfig=1},hardRestart(){window.__hardRestart=1},minimize(){},grant(k){window.__granted=k},setFlag(k,v){(window.__flags=window.__flags||{})[k]=v},testSound(){},
 http(id,m,p,b){setTimeout(()=>{try{OCEvent('http',{id,status:200,ct:'application/json',body:JSON.stringify(route(m,p,b))})}catch(e){OCEvent('http',{id,status:500,ct:'text/plain',body:String(e)})}},4)},
 drop(){},sseStart(){sse=true;setTimeout(()=>OCEvent('sse',{t:'open'}),5)},sseStop(){},wsOpen(id){setTimeout(()=>{OCEvent('ws',{id,t:'open'});OCEvent('ws',{id,t:'msg',d:'root@phone:~# '})},5)},wsSend(id,t){(window.__wsSent=window.__wsSent||[]).push(t)},wsClose(){},
 ls:p=>JSON.stringify({ok:true,path:p,items:[{name:'app',dir:true},{name:'notes.txt',dir:false}]}),fs:()=>JSON.stringify({ok:true}),readText:()=>JSON.stringify({ok:true,text:'abc'}),writeText:()=>JSON.stringify({ok:true}),
 cfgRead:()=>window.__cfg||'{\n // comment\n "plugin":["a"],\n "mcp":{"ctx7":{"type":"remote","url":"https://m.example/mcp","enabled":true}}\n}',cfgWrite(t){window.__cfg=t;return JSON.stringify({ok:true})},readLog:()=>'log line',
 pickFile(k,d){window.__picked=[k,d]},shimUrl:()=>'',backupProfile:()=>JSON.stringify({ok:false,err:'mock'}),backupProfileFull:(p,s)=>JSON.stringify({ok:true,path:'/sdcard/Download/mock.ocmbak',size:1000,skipped:0,full:true}),restoreProfile:()=>JSON.stringify({ok:false,err:'mock'}),copy(t){window.__copied=t},pasteText:()=>'pasted',share(t){window.__shared=t},openLink(u){window.__opened=u},
  openApp(t){return true},preparePreview(p){return ''},openPreviewWindow(u,t){window.__previewWindow=[u,t];return true},startVoiceInput(l){},notify(k,t,x){window.__notified=[k,t,x]},
 netGet(u,h,t){return JSON.stringify(window.__netGetResult||{ok:true,status:200,body:'{"data":[]}'})},
 netGetAsync(id,u,h,t){(window.__mediaCalls=window.__mediaCalls||[]).push({op:'get',url:u,headers:JSON.parse(h)});setTimeout(()=>OCEvent('mediaNet',{id,result:JSON.stringify(window.__netGetResult||{ok:true,status:200,body:'{"data":[]}'})}),5)},
 netPostToFile(){return JSON.stringify({ok:true,path:'/root/media/x.png'})},
 netPostToFileAsync(id,u,h,b,d,t){(window.__mediaCalls=window.__mediaCalls||[]).push({op:'post',url:u,headers:JSON.parse(h),body:JSON.parse(b),dest:d});setTimeout(()=>OCEvent('mediaNet',{id,result:JSON.stringify(window.__netPostResult||{ok:true,path:'/root/media/x.png'})}),5)},
 netDownloadToFile(){return JSON.stringify({ok:true,path:'/root/media/x.png'})},
 netDownloadToFileAsync(id,u,h,d,t){(window.__mediaCalls=window.__mediaCalls||[]).push({op:'download',url:u,headers:JSON.parse(h),dest:d});setTimeout(()=>OCEvent('mediaNet',{id,result:JSON.stringify(window.__netDownloadResult||{ok:true,path:'/root/media/x.png'})}),5)},
 writeDataUrlToFile(){return JSON.stringify({ok:true,path:'/root/media/x.png'})},
 writeDataUrlToFileAsync(id,d,p){setTimeout(()=>OCEvent('mediaNet',{id,result:JSON.stringify({ok:true,path:p})}),5)},
 readDataUrl(id,p){setTimeout(()=>OCEvent('mediaNet',{id,result:JSON.stringify(window.__readDataResult||{ok:true,mime:'image/png',data:'aGVsbG8='})}),5)},
 mediaNetCancel(id){(window.__mediaCancelled=window.__mediaCancelled||[]).push(id)},
 voiceSampleStart(p){window.__voiceRec=p;return JSON.stringify({ok:true})},
 voiceSampleStop(){const p=window.__voiceRec;window.__voiceRec=null;setTimeout(()=>OCEvent('voiceSample',{ok:true,path:p}),5);return JSON.stringify({ok:true,path:p})},notifyMedia(){},mediaServerStart(){},mediaServerStop(){},mediaAnswer(){},
 securePut(){return true},secureGet(){return ''},secureRemove(){return true},secureImportLegacy(){return true},
 autoBackupState(){return JSON.stringify({enabled:false,intervalHours:'24',hasPassword:false})},autoBackupConfigure(){return JSON.stringify({ok:true})},autoBackupNow(){return JSON.stringify({ok:true,path:'/sdcard/Download/x.ocmbak',size:1})},
 diagnostic:0,diagnose(){return JSON.stringify({ready:true,port:4096,tcp:true,healthCode:200})},
 biometricAvailable(){return true},biometricUnlock(id,t){setTimeout(()=>OCEvent('appUnlock',{id,ok:true}),5)},
 resourceStats(){return JSON.stringify({ramTotal:8e9,ramAvail:3e9,jvmUsed:1e8,jvmMax:5e8,appPssKb:120000,cpuPct:17,rootfsBytes:2.1e9,profileBytes:5e7,diskFree:20e9,diskTotal:64e9,serverReady:true})},gitRun(){return JSON.stringify({ok:true,out:''})},
 checkpointCreate(){return JSON.stringify({ok:true,queued:true})},checkpointList(){return JSON.stringify({ok:true,items:[]})},checkpointRestore(){return JSON.stringify({ok:true})},
 startOverlay(){},stopOverlay(){},overlayState(){return JSON.stringify({allowed:false,running:false})},setOverlayState(){},
 sttStart(){},sttStop(){},sttAvailable(){return true},callAudio(){},ttsInit(){},ttsSpeak(){},ttsStop(){},ttsConfigure(){},ttsVoices(){return '[]'},
 checkUpdates(){setTimeout(()=>OCEvent('update',{core:'v1.18.6'}),5)},applyAppUpdate(){},applyCoreUpdate(){}
};
window.__onPrompt=b=>{const sid='ses_1';const P=(part)=>__push({type:'message.part.updated',properties:{part:Object.assign({sessionID:sid},part)}});
 __push({type:'session.updated',properties:{info:srv.sessions[0]}});
 __push({type:'message.updated',properties:{info:{id:b.messageID,sessionID:sid,role:'user',time:{created:Date.now()}}}});
 P({id:'prt_u1',messageID:b.messageID,type:'text',text:b.parts[0].text});
 const aid=OCM.mid();
 __push({type:'message.updated',properties:{info:{id:aid,sessionID:sid,role:'assistant',providerID:'opencode',modelID:'big-pickle',time:{created:Date.now()},tokens:{input:1200,output:300,reasoning:0,cache:{read:0,write:0}}}}});
 __push({type:'session.status',properties:{sessionID:sid,status:{type:'busy'}}});
 P({id:'prt_a1',messageID:aid,type:'reasoning',text:'thinking about it',time:{start:1}});
 P({id:'prt_a2',messageID:aid,type:'text',text:'Hel'});
 __push({type:'message.part.delta',properties:{sessionID:sid,messageID:aid,partID:'prt_a2',field:'text',delta:'lo **world**\n```py\nprint(1)\n```'}});
 P({id:'prt_a3',messageID:aid,type:'tool',tool:'bash',callID:'c1',state:{status:'running',input:{command:'ls -la',description:'List files'},metadata:{output:'total 0'},time:{start:1}}});
 setTimeout(()=>{P({id:'prt_a3',messageID:aid,type:'tool',tool:'bash',callID:'c1',state:{status:'completed',input:{command:'ls -la',description:'List files'},output:'total 0\nmain.py',metadata:{exit:0},title:'ls',time:{start:1,end:2}}});
  P({id:'prt_a4',messageID:aid,type:'tool',tool:'edit',callID:'c2',state:{status:'completed',input:{filePath:'/root/main.py'},output:'ok',metadata:{diff:'--- a\n+++ b\n@@ -1 +1 @@\n-x\n+y'},time:{start:1,end:2}}});
  __push({type:'permission.asked',properties:{id:'per_1',sessionID:sid,permission:'bash',patterns:['rm -rf build'],metadata:{}}});
  __push({type:'session.diff',properties:{sessionID:sid,diff:[{file:'main.py',before:'x\n',after:'y\n',additions:1,deletions:1}]}});
  __push({type:'session.idle',properties:{sessionID:sid}})},60)};
})();

// ---- remote CI (ci.js) ----
const ciStore = {};
OC.ciState = () => {
  const out = {};
  for (const k of Object.keys(ciStore)) out[k.replace(/^ci_/, '')] = { connected: true, token: ciStore[k] };
  return JSON.stringify(out);
};
OC.ciSaveToken = (id, provider, token) => { ciStore['ci_' + provider] = token; setTimeout(() => OCEvent && OCEvent('ci-save', { id, ok: true }), 30); };
OC.ciClearToken = provider => { delete ciStore['ci_' + provider]; };
OC.ciRequest = (id, provider, method, path, body) => {
  setTimeout(() => OCEvent && OCEvent('ci-resp', { id, status: 200, body: { login: 'mock-user', message: 'ok' } }), 50);
};
