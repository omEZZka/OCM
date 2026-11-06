(function(){
const O=window.OCM;
const pend=new Map();let seq=0;const L={};
O.on=(n,f)=>{(L[n]=L[n]||[]).push(f)};
window.OCEvent=(n,d)=>{if(n==='http'){finishHttp(d);return}(L[n]||[]).forEach(f=>{try{f(d)}catch(e){console.error(n,e)}})};
O.dir='';
// api(method, path, body, {dir:false|string, timeout, raw})
O.api=(method,path,body,opt)=>new Promise((res,rej)=>{opt=opt||{};
  const id='r'+(++seq)+'_'+Date.now().toString(36);let p=path;
  if(opt.dir!==false){const d=typeof opt.dir==='string'?opt.dir:O.dir;if(d)p+=(p.includes('?')?'&':'?')+'directory='+encodeURIComponent(d)}
  pend.set(id,{res,rej,raw:opt.raw});
  try{OC.http(id,method,p,body==null?'':JSON.stringify(body))}catch(e){pend.delete(id);rej(e);return}
  setTimeout(()=>{if(pend.has(id)){pend.delete(id);rej(Object.assign(new Error('timeout'),{net:true}))}},opt.timeout||60000)});
async function finishHttp(d){const p=pend.get(d.id);if(!p)return;pend.delete(d.id);
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
  copy:t=>{try{OC.copy(t);O.toast('Скопировано',1200)}catch{}},share:t=>OC.share(t),open:u=>OC.openLink(u),
  openApp:t=>(window.OC&&OC.openApp?OC.openApp(t):false),
  preparePreview:p=>(window.OC&&OC.preparePreview?OC.preparePreview(p):''),
  notify:(kind,title,text)=>{try{if(window.OC&&OC.notify)OC.notify(kind,title,text)}catch(_){}},
  state:()=>j(OC.state())||{}
};
O.openUrl=u=>{if(/^https?:\/\//i.test(u)&&!/appassets\.androidplatform\.net/i.test(u))OC.openLink(u)};
document.addEventListener('click',e=>{const a=e.target.closest&&e.target.closest('a[href]');if(!a)return;const u=a.getAttribute('href');e.preventDefault();if(/^https?:\/\//i.test(u))O.openUrl(u)});
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-copy]');if(!b)return;const pre=b.closest('.codeblock');if(pre)O.native.copy(pre.querySelector('pre').innerText)});
})();
