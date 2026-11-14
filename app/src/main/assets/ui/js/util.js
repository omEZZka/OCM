(function(){
const O=window.OCM=window.OCM||{};
O.$=(s,r)=>(r||document).querySelector(s);
O.$$=(s,r)=>[...(r||document).querySelectorAll(s)];
const h=O.h=function(tag,props,...kids){
  const e=document.createElement(tag);
  if(props)for(const k in props){const v=props[k];if(v==null||v===false)continue;
    if(k==='class')e.className=v;else if(k==='html')e.innerHTML=v;
    else if(k.slice(0,2)==='on')e.addEventListener(k.slice(2),v);
    else if(k==='style'&&typeof v==='object')Object.assign(e.style,v);
    else e.setAttribute(k,v===true?'':v)}
  for(const c of kids.flat(Infinity)){if(c==null||c===false)continue;e.append(c.nodeType?c:document.createTextNode(String(c)))}
  return e};
O.esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
O.basename=p=>String(p||'').replace(/\/+$/,'').split('/').pop();
O.dirname=p=>{p=String(p||'').replace(/\/+$/,'');const i=p.lastIndexOf('/');return i<0?'.':i===0?'/':p.slice(0,i)};
O.ext=p=>{const b=O.basename(p).toLowerCase();const i=b.lastIndexOf('.');return i>0?b.slice(i+1):(i===0?b.slice(1):'')};
O.ago=ts=>{if(!ts)return'';const s=Math.max(0,(Date.now()-ts)/1000);if(s<60)return'сейчас';if(s<3600)return Math.floor(s/60)+' мин';if(s<86400)return Math.floor(s/3600)+' ч';if(s<604800)return Math.floor(s/86400)+' д';return new Date(ts).toLocaleDateString()};
O.fmtK=n=>n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(n>=1e4?0:1)+'k':String(n||0);
O.stripAnsi=s=>String(s||'')
  .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g,'')
  .replace(/\x1b[P^_][^\x1b]*(?:\x1b\\)?/g,'')
  .replace(/\x1b\[[0-9;?<=>!"' ]*[ -\/]*[@-~]/g,'')
  .replace(/\x1b[@-Z\\-_]/g,'')
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'');
O.debounce=(f,ms)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>f(...a),ms)}};
O.longPress=(el,fn,ms)=>{ms=ms||480;let t=null;
  const start=e=>{if(e&&e.button!=null&&e.button!==0)return;el._lpFired=false;clearTimeout(t);t=setTimeout(()=>{t=null;el._lpFired=true;fn(e)},ms)};
  const cancel=()=>{if(t){clearTimeout(t);t=null}};
  el.addEventListener('touchstart',start,{passive:true});
  el.addEventListener('touchend',cancel);
  el.addEventListener('touchmove',cancel,{passive:true});
  el.addEventListener('touchcancel',cancel);
  el.addEventListener('mousedown',start);
  el.addEventListener('mouseup',cancel);
  el.addEventListener('mouseleave',cancel);
  return el};
// Horizontal swipe: onSwipe(dir) where dir is 'left' | 'right'. Ignores vertical scrolls and taps.
O.swipe=(el,onSwipe,opts)=>{opts=opts||{};const thr=opts.threshold||64;const fl=opts.fromLeft||0;const fr=opts.fromRight||0;const top=opts.top||0;
  let sx=0,sy=0,st=0,on=false;
  el.addEventListener('touchstart',e=>{const t=e.touches[0];if(!t)return;
    if(top&&t.clientY>innerHeight*top)return;      // ignore swipes starting below the given fraction (composer area)
    sx=t.clientX;sy=t.clientY;st=Date.now();on=true},{passive:true});
  el.addEventListener('touchend',e=>{if(!on)return;on=false;const t=e.changedTouches[0];if(!t)return;
    const dx=t.clientX-sx,dy=t.clientY-sy,dt=Date.now()-st;
    if(dt>700||Math.abs(dx)<thr||Math.abs(dx)<Math.abs(dy)*1.6)return;
    if(dx<0){if(fr&&sx<innerWidth*(1-fr))return;onSwipe('left')}   // leftward: must start in the right-edge band
    else{if(fl&&sx>innerWidth*fl)return;onSwipe('right')}          // rightward: must start in the left-edge band
  },{passive:true});
  return el};
O.store={get(k,d){try{const v=localStorage.getItem('ocm.'+k);return v==null?d:JSON.parse(v)}catch{return d}},set(k,v){try{localStorage.setItem('ocm.'+k,JSON.stringify(v))}catch{}},remove(k){try{localStorage.removeItem('ocm.'+k)}catch{}}};
let last=0,ctr=0;
O.mid=()=>{const n=Date.now();if(n!==last){last=n;ctr=0}ctr++;
  const hex=(BigInt(n)*0x1000n+BigInt(ctr)).toString(16).padStart(12,'0').slice(-12);
  const a='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let r='';for(const x of crypto.getRandomValues(new Uint8Array(14)))r+=a[x%62];return'msg_'+hex+r};
O.splitArgs=s=>{const out=[];const re=/"([^"]*)"|'([^']*)'|(\S+)/g;let m;while((m=re.exec(s)))out.push(m[1]??m[2]??m[3]);return out};
O.stripJsonc=t=>{let o='',i=0,s=false;while(i<t.length){const c=t[i],n=t[i+1];
  if(s){o+=c;if(c==='\\'){o+=n||'';i+=2;continue}if(c==='"')s=false;i++;continue}
  if(c==='"'){s=true;o+=c;i++;continue}
  if(c==='/'&&n==='/'){while(i<t.length&&t[i]!=='\n')i++;continue}
  if(c==='/'&&n==='*'){i+=2;while(i<t.length&&!(t[i]==='*'&&t[i+1]==='/'))i++;i+=2;continue}
  o+=c;i++}
  return o.replace(/,(\s*[}\]])/g,'$1')};
O.parseJsonc=t=>JSON.parse(O.stripJsonc(t));

// toast
// Three levels so routine confirmations stop shouting. `quiet` never shows anything, `hint` shows a
// short inline note, `error` stays long enough to read. The old default was "2.6s modal-ish toast
// for everything", which made the app feel noisy.
let tt;
O.toast=(m,ms,level)=>{
  const text=String(m==null?'':m);
  if(!text)return;
  const lvl=level||(/ошибк|error|fail|не удал|недоступ|отказ/i.test(text)?'error':'hint');
  if(lvl==='quiet')return;
  let e=O.$('#toast');
  if(!e){e=h('div',{id:'toast'});document.body.append(e)}
  e.textContent=text;
  e.className='toast-'+(lvl==='error'?'error':'hint');
  e.style.display='block';
  clearTimeout(tt);
  tt=setTimeout(()=>e.style.display='none',ms||(lvl==='error'?4200:1500));
};
// Explicit silent variant for actions the user can see happening anyway.
O.toastQuiet=m=>O.toast(m,900,'quiet');

// sheets
const stack=[];O.sheets=stack;
// Opening a sheet used to be possible many times from one tap: while the WebView main thread is
// busy with a streaming markdown re-render, queued pointer events all fire at once afterwards and
// every one of them opened another copy of the same menu. Two guards:
//   1) a short global lock, so a burst of taps in the same frame opens one sheet;
//   2) an id+title key, so an identical sheet already on screen is not stacked again.
O.sheet=(title,body,opts)=>{opts=opts||{};
  const now=Date.now();
  const key=String(title||'')+'#'+((opts&&opts.drawer)?'d':'s');
  // Only de-duplicate the *same* sheet opened twice by a burst of queued taps (e.g. user taps the
  // model chip while a long answer re-renders, and three click events fire at once). Any other
  // sheet must still open immediately — a global time lock silently swallowed legitimate menus.
  const top=stack[stack.length-1];
  if(top&&top._key===key&&now-top._openedAt<700)return top;
  const api={};api._key=key;api._openedAt=now;
  let closed=false;
  api.close=()=>{if(closed)return;closed=true;api.root.classList.remove('on');
    setTimeout(()=>{if(api.root.isConnected)api.root.remove()},260);
    const i=stack.indexOf(api);if(i>=0)stack.splice(i,1);
    // onClose used to run again on a second close() (back gesture + button tap), which
    // unsubscribed/redrew things twice
    try{opts.onClose&&opts.onClose()}catch(e){console.error('sheet onClose',e)}};
  
  const handle=(!opts.drawer&&!opts.full)?h('div',{class:'sh-drag-handle'}):null;
  const header=opts.hud
    ?h('div',{class:'sh-header-row'},
        h('button',{class:'sh-close-btn',onclick:()=>api.close()},O.icon('x')),
        h('span',{class:'sh-title'},title),
        opts.actions||h('span',{style:{width:'32px'}}))
    :h('div',{class:'sh-h'},
        h('button',{class:'ibtn',onclick:()=>api.close()},O.icon(opts.drawer?'x':'chevL')),
        h('b',{class:'grow'},title),
        opts.actions||null);

  const box=h('div',{class:'sheet'+(opts.full?' full':'')+(opts.drawer?' drawer':'')},
    handle,header,h('div',{class:'sh-b'},body));
  const back=h('div',{class:'sh-back',onclick:()=>api.close()});
  api.root=h('div',{class:'sh-root'},back,box);
  api.box=box;api.body=box.querySelector('.sh-b');
  document.body.append(api.root);stack.push(api);

  // ---- finger-tracking drag to dismiss (bottom sheets and the left drawer) ----
  if(!opts.full){
    const isDrawer=!!opts.drawer;
    let startX=0,startY=0,dragging=false,cur=0,axis=null,startT=0,moved=false;
    const size=()=>isDrawer?(box.offsetWidth||340):(box.offsetHeight||400);
    const setProgress=p=>{back.style.opacity=String(Math.max(0,Math.min(1,p)))};
    const apply=v=>{
      cur=v;
      box.style.transform=isDrawer?('translateX('+v+'px)'):('translateY('+v+'px)');
      setProgress(1-Math.abs(v)/size());
    };
    const start=(x,y)=>{
      dragging=true;axis=null;cur=0;moved=false;startX=x;startY=y;startT=Date.now();
      box.style.transition='none';
    };
    const move=(x,y,e)=>{
      if(!dragging)return;
      const dy=y-startY,dx=x-startX;
      if(axis===null){
        if(Math.abs(dy)<3&&Math.abs(dx)<3)return;
        axis=Math.abs(dy)>Math.abs(dx)?'y':'x';
      }
      // only start blocking native gestures once the finger clearly moved,
      // otherwise plain taps inside the sheet would lose their click event
      const dist=isDrawer?Math.abs(dx):Math.abs(dy);
      if(dist<10)return;
      moved=true;
      if(isDrawer){
        if(axis!=='x')return;
        apply(Math.min(0,dx));
      }else{
        if(axis!=='y')return;
        if(dy<0){apply(0);return} // upward: let the list scroll natively
        apply(dy);
      }
      if(e&&e.cancelable)e.preventDefault();
    };
    const end=(x,y)=>{
      if(!dragging)return;dragging=false;
      box.style.transition='';
      const dist=isDrawer?-cur:cur;
      const dt=Math.max(1,Date.now()-startT);
      const vel=dist/dt;
      if(dist>size()*0.32||vel>0.55){
        box.style.transform=isDrawer?'translateX(-100%)':'translateY(100%)';
        setProgress(0);
        api.close();
      }else{
        box.style.transform='';
        setProgress(1);
      }
    };
    const shouldStart=t=>{
      if(t.closest('button')||t.closest('input')||t.closest('textarea')||t.closest('a')||t.closest('.seg'))return false;
      if(!isDrawer&&t.closest('.sh-b')){
        // only drag the sheet from its content when the list is scrolled to the very top
        return (api.body.scrollTop||0)<=0;
      }
      return true;
    };
    const onMouseMove=e=>move(e.clientX,e.clientY,e);
    const onMouseUp=e=>end(e.clientX,e.clientY);
    box.addEventListener('touchstart',e=>{const t=e.touches[0];if(t&&shouldStart(e.target))start(t.clientX,t.clientY)},{passive:true});
    box.addEventListener('touchmove',e=>{const t=e.touches[0];if(t)move(t.clientX,t.clientY,e)},{passive:false});
    box.addEventListener('touchend',e=>{const t=e.changedTouches[0];if(t)end(t.clientX,t.clientY)});
    box.addEventListener('touchcancel',e=>{const t=e.changedTouches[0];if(t)end(t.clientX,t.clientY)});
    box.addEventListener('mousedown',e=>{if(shouldStart(e.target))start(e.clientX,e.clientY)});
    window.addEventListener('mousemove',onMouseMove);
    window.addEventListener('mouseup',onMouseUp);
    const cleanupDrag=()=>{window.removeEventListener('mousemove',onMouseMove);window.removeEventListener('mouseup',onMouseUp)};
    const baseClose=api.close;
    api.close=()=>{cleanupDrag();try{box.style.transform='';back.style.opacity=''}catch(_){}baseClose()};
  }

  requestAnimationFrame(()=>api.root.classList.add('on'));return api};

O.confirm=(title,msg,ok,danger)=>new Promise(res=>{let done=false;
  const fin=v=>{if(done)return;done=true;s.close();res(v)};
  const s=O.sheet(title,h('div',null,h('p',{class:'mut'},msg||''),h('div',{style:{display:'flex',gap:'8px',marginTop:'12px'}},
    h('button',{class:'btn grow',onclick:()=>fin(false)},O.tr('Cancel','Отмена')),h('button',{class:'btn grow '+(danger?'dng':'pri'),onclick:()=>fin(true)},ok||O.tr('OK','ОК')))),{hud:true,onClose:()=>{if(!done){done=true;res(false)}}})});

O.ask=(title,label,val,multiline)=>new Promise(res=>{let done=false;
  const inp=multiline?h('textarea',{rows:6,class:'mono'}):h('input',{type:'text'});inp.value=val||'';
  const fin=v=>{if(done)return;done=true;s.close();res(v)};
  const s=O.sheet(title,h('div',null,h('div',{class:'field'},label?h('label',null,label):null,inp),h('div',{style:{display:'flex',gap:'8px'}},
    h('button',{class:'btn grow',onclick:()=>fin(null)},O.tr('Cancel','Отмена')),h('button',{class:'btn pri grow',onclick:()=>fin(inp.value)},O.tr('OK','ОК')))),{hud:true,onClose:()=>{if(!done){done=true;res(null)}}});
  setTimeout(()=>inp.focus(),200)});

O.actions=(title,items)=>{const s=O.sheet(title,h('div',null,items.filter(Boolean).map(it=>h('button',{class:'settings-row',onclick:()=>{s.close();it.fn()}},
  O.icon(it.icon||'dots'),h('div',{class:'settings-row-text'},h('b',{class:it.danger?'err':''},it.label),it.sub?h('span',null,it.sub):null)))),{hud:true});return s};

O.back=()=>{const s=stack[stack.length-1];if(s){s.close();return true}return false};

O.toggleRow=(icon,title,sub,checked,onchange)=>{
  const i=h('input',{type:'checkbox',onchange:()=>onchange(i.checked)});i.checked=!!checked;
  const icEl=typeof icon==='string'?h('div',{class:'settings-row-icon'},O.icon(icon)):icon;
  return h('label',{class:'settings-row',style:{cursor:'pointer'}},icEl,h('div',{class:'settings-row-text'},h('b',null,title),sub?h('span',null,sub):null),h('span',{class:'sw'},i,h('s')))};

O.listRow=(icon,title,sub,right,fn)=>{
  const icEl=typeof icon==='string'?h('div',{class:'settings-row-icon'},O.icon(icon)):icon;
  return h('button',{class:'settings-row',onclick:fn},icEl,h('div',{class:'settings-row-text'},h('b',null,title),sub?h('span',null,sub):null),right||null);
};
})();
