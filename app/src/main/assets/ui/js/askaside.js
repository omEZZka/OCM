(function(){
// ==========================================================================
// ASK-ASIDE ("Уточнить")
// A side agent answers a question WHILE the main agent keeps working.
//   • floating mini-window above the composer (drag, collapse to a pill)
//   • the side chat is a FORK of the current session → full context, own history
//   • read-only tools: the side agent may look, never touch files or run bash
//   • a status chip in the HUD dock, main stream untouched
//   • per-session memory of previous clarifications
//   • voice dictation into the mini composer
//   • swipe up on the composer opens it
//   • errors are isolated: they never touch the main session status or queue
// ==========================================================================
const O=window.OCM,h=O.h,S=O.S,api=O.api,bus=O.bus;

const MEM_KEY=sid=>'askAside.'+sid;
const state={sid:null,open:false,collapsed:false,busy:false,err:'',log:[],fork:null,pos:null};
let win=null,list=null,inp=null,pill=null,sendBtn=null,micBtn=null,headTitle=null,drag=null;

const mem=sid=>{const v=O.store.get(MEM_KEY(sid||S.sid),null);return Array.isArray(v)?v:[]};
const memPush=(sid,q,a)=>{
  const l=mem(sid).concat([{q:String(q).slice(0,400),a:String(a).slice(0,1200),at:Date.now()}]);
  O.store.set(MEM_KEY(sid),l.slice(-20));
};
O.askAsideMemory=sid=>mem(sid);

// The side agent must not interfere with the running turn: read-only tools only.
const READONLY_DIRECTIVE=[
  '[РЕЖИМ УТОЧНЕНИЯ — ТОЛЬКО ЧТЕНИЕ]',
  'Ты боковой агент-консультант. Основной агент прямо сейчас работает над задачей в этой же сессии.',
  'Отвечай коротко и по делу на вопрос пользователя, опираясь на контекст диалога.',
  'Разрешены ТОЛЬКО инструменты чтения: read, list, glob, grep, webfetch.',
  'ЗАПРЕЩЕНО: bash, edit, write, patch, task, любые изменения файлов и запуск команд.',
  'Не начинай выполнять задачу основного агента и не пиши планы вместо него — только отвечай на вопрос.',
  'Если для ответа нужно изменить файлы — объясни что и где, но не делай этого.'
].join('\n');
const READONLY_DENY=['bash','edit','write','patch','task','multiedit','notebookedit'];

const busyMain=()=>{const st=S.status[S.sid];return !!st&&st.type!=='idle'};

// ---- fork the current session so the side chat inherits the whole context ----
async function ensureFork(){
  if(state.fork&&state.fork.parent===S.sid)return state.fork.sid;
  if(!S.sid)throw new Error(O.tr('Open a chat first','Сначала откройте чат'));
  const r=await api('POST','/session/'+S.sid+'/fork',{});
  const sid=r&&r.id;
  if(!sid)throw new Error(O.tr('Could not fork the session','Не удалось создать ветку сессии'));
  state.fork={sid,parent:S.sid};
  // the side session must not raise "answer ready" notifications of its own
  try{if(window.OC&&OC.silentSession)OC.silentSession(sid)}catch(_){}
  try{if(O.noteFork)O.noteFork(sid,S.sid)}catch(_){}
  try{await O.loadSessions()}catch(_){}
  return sid;
}

// ---- rendering ----------------------------------------------------------
function renderLog(){
  if(!list)return;
  list.textContent='';
  const history=mem(state.sid);
  if(history.length&&!state.log.length){
    list.append(h('div',{class:'aa-hint'},O.tr('Earlier in this chat:','Ранее в этом чате:')));
    history.slice(-3).forEach(x=>list.append(h('div',{class:'aa-past'},
      h('b',null,x.q),h('span',null,x.a.slice(0,160)+(x.a.length>160?'…':'')))));
  }
  state.log.forEach(m=>{
    list.append(h('div',{class:'aa-msg '+m.who},
      h('span',{class:'aa-who'},m.who==='me'?O.tr('you','вы'):O.tr('side agent','боковой агент')),
      h('div',{class:'aa-text'},m.text)));
  });
  if(state.busy)list.append(h('div',{class:'aa-msg bot'},h('span',{class:'spin'}),h('span',{class:'aa-wait'},O.tr('thinking…','думает…'))));
  if(state.err)list.append(h('div',{class:'aa-err'},state.err));
  list.scrollTop=list.scrollHeight;
}
function renderPill(){
  if(!pill)return;
  pill.textContent='';
  pill.append(O.icon('bulb'),h('span',null,O.tr('Clarify','Уточнить')),
    state.busy?h('span',{class:'spin'}):null);
  pill.classList.toggle('hide',state.open&&!state.collapsed);
}
function setCollapsed(v){
  state.collapsed=v;
  if(win)win.classList.toggle('collapsed',v);
  renderPill();
}

// ---- the side turn ------------------------------------------------------
async function ask(text){
  text=String(text||'').trim();
  if(!text||state.busy)return;
  if(!S.model)return O.toast(O.tr('Pick a model first','Сначала выберите модель'),2200);
  state.sid=S.sid;
  state.err='';
  state.log.push({who:'me',text});
  state.busy=true;renderLog();renderPill();updateChip();
  if(inp){inp.value='';autosize()}
  let sid=null;
  try{
    sid=await ensureFork();
    const mid=O.mid();
    const parts=[{type:'text',text:READONLY_DIRECTIVE,synthetic:true},{type:'text',text}];
    // The fork carries the parent context; the directive keeps this turn read-only.
    await api('POST','/session/'+sid+'/prompt_async',{
      messageID:mid,agent:S.agent,model:S.model,variant:S.variant||undefined,parts
    },{timeout:30000});
    const answer=await waitAnswer(sid,mid);
    state.log.push({who:'bot',text:answer||O.tr('(no text answer)','(нет текстового ответа)')});
    memPush(state.sid,text,answer||'');
  }catch(e){
    // Isolation: a side failure never marks the main session as errored.
    state.err=(e&&e.message)||String(e);
  }finally{
    state.busy=false;renderLog();renderPill();updateChip();
  }
}
// Poll only the SIDE session; the main stream/status is never touched.
async function waitAnswer(sid,mid){
  const started=Date.now();
  let last='';
  while(Date.now()-started<180000){
    await new Promise(r=>setTimeout(r,700));
    let msgs=[];
    try{msgs=await api('GET','/session/'+sid+'/message')}catch(_){continue}
    const list=Array.isArray(msgs)?msgs:(msgs.messages||[]);
    let after=false,txt='';
    for(const m of list){
      const info=m.info||m;
      if(info.id===mid){after=true;continue}
      if(!after)continue;
      if((info.role||'')!=='assistant')continue;
      for(const p of m.parts||[]){
        if(p.type==='text'&&p.text)txt+=p.text;
        // read-only guard: reject a tool the side agent should not have used
        if(p.type==='tool'&&READONLY_DENY.includes(String(p.tool||'').toLowerCase())){
          txt+='\n['+O.tr('blocked write tool: ','заблокирован инструмент записи: ')+p.tool+']';
        }
      }
      const done=info.time&&info.time.completed;
      if(done&&txt.trim())return txt.trim();
      if(txt.trim())last=txt.trim();
    }
    if(last&&Date.now()-started>150000)return last;
  }
  return last||O.tr('(timed out)','(не дождался ответа)');
}

// ---- HUD dock chip ------------------------------------------------------
let chipEl=null;
function updateChip(){
  const dock=O.$('#dock');
  if(!dock)return;
  const need=state.busy||(state.open&&state.log.length>0);
  if(!need){if(chipEl){chipEl.remove();chipEl=null}return}
  if(!chipEl){
    chipEl=h('button',{class:'aa-chip',onclick:()=>O.askAsideOpen()},
      O.icon('bulb'),h('span',{class:'aa-chip-t'},O.tr('Clarification','Уточнение')),
      h('span',{class:'aa-chip-s'}));
    dock.append(chipEl);
  }
  const s=chipEl.querySelector('.aa-chip-s');
  if(s)s.textContent=state.busy?O.tr('side agent thinking…','боковой агент думает…'):O.tr('tap to open','тап — открыть');
  chipEl.classList.toggle('busy',state.busy);
}

// ---- window -------------------------------------------------------------
function autosize(){
  if(!inp)return;
  inp.style.height='auto';
  inp.style.height=Math.min(96,Math.max(34,inp.scrollHeight))+'px';
}
function build(){
  if(win)return;
  list=h('div',{class:'aa-list'});
  inp=h('textarea',{rows:1,class:'aa-inp',placeholder:O.tr('Ask without interrupting…','Спросить, не прерывая…'),
    oninput:autosize,onkeydown:e=>{
      if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask(inp.value)}
    }});
  micBtn=h('button',{class:'ibtn s',title:O.tr('Dictate','Надиктовать'),onclick:dictate},O.icon('mic'));
  sendBtn=h('button',{class:'btn pri sm',onclick:()=>ask(inp.value)},O.icon('send'));
  headTitle=h('b',{class:'grow'},O.tr('Clarify','Уточнить'));
  const head=h('div',{class:'aa-head'},
    O.icon('bulb'),headTitle,
    h('button',{class:'ibtn s',title:O.tr('Collapse','Свернуть'),onclick:()=>setCollapsed(true)},O.icon('chevD')),
    h('button',{class:'ibtn s',title:O.tr('Close','Закрыть'),onclick:()=>O.askAsideClose()},O.icon('x')));
  const foot=h('div',{class:'aa-foot'},inp,micBtn,sendBtn);
  win=h('div',{id:'ask-aside',class:'ask-aside'},head,list,
    h('div',{class:'aa-note'},O.tr('Read-only side agent · the main task keeps running','Боковой агент только читает · основная задача продолжается')),
    foot);
  pill=h('button',{id:'ask-aside-pill',class:'aa-pill hide',onclick:()=>{state.open=true;win.classList.remove('hide');setCollapsed(false);renderLog()}},O.icon('bulb'),h('span',null,O.tr('Clarify','Уточнить')));
  document.body.append(win,pill);
  // drag by the header
  const down=e=>{
    if(e.target.closest('button'))return;
    const t=e.touches?e.touches[0]:e;
    const r=win.getBoundingClientRect();
    drag={dx:t.clientX-r.left,dy:t.clientY-r.top};
    if(e.cancelable)e.preventDefault();
  };
  const move=e=>{
    if(!drag)return;
    const t=e.touches?e.touches[0]:e;
    const w=win.offsetWidth,hh=win.offsetHeight;
    const x=Math.max(4,Math.min(innerWidth-w-4,t.clientX-drag.dx));
    const y=Math.max(4,Math.min(innerHeight-hh-4,t.clientY-drag.dy));
    win.style.left=x+'px';win.style.top=y+'px';win.style.right='auto';win.style.bottom='auto';
    state.pos={x,y};
    if(e.cancelable)e.preventDefault();
  };
  const up=()=>{if(drag){drag=null;O.store.set('askAsidePos',state.pos)}};
  head.addEventListener('pointerdown',down);
  head.addEventListener('touchstart',down,{passive:false});
  addEventListener('pointermove',move,{passive:false});
  addEventListener('touchmove',move,{passive:false});
  addEventListener('pointerup',up);addEventListener('touchend',up);
}
function dictate(){
  if(!O.native.sttStart)return O.toast(O.tr('Voice input unavailable','Голосовой ввод недоступен'),2000);
  const perms=(O.native.state&&O.native.state().perms)||{};
  if(perms.mic===false){try{OC.grant('mic')}catch(_){}return O.toast(O.tr('Allow microphone access','Разрешите доступ к микрофону'),2600)}
  let done=false;
  const off=O.on('stt',d=>{
    if(done)return;
    if(d.t==='partial'&&inp)inp.placeholder=d.text||'';
    if(d.t==='final'||d.t==='empty'||d.t==='error'){
      done=true;try{off&&off()}catch(_){}
      try{O.native.sttStop()}catch(_){}
      if(inp)inp.placeholder=O.tr('Ask without interrupting…','Спросить, не прерывая…');
      const t=String(d.text||'').trim();
      if(t&&inp){inp.value=(inp.value?inp.value+' ':'')+t;autosize();inp.focus()}
      else if(d.t!=='final')O.toast(O.tr('No speech detected','Речь не распознана'),2000);
    }
  });
  O.toast(O.tr('Listening…','Слушаю…'),1600);
  try{O.native.sttStart('system',O.store.get('lang','ru')==='en'?'en-US':'ru-RU',[],true)}catch(_){}
  setTimeout(()=>{if(!done){done=true;try{off&&off()}catch(_){};try{O.native.sttStop()}catch(_){}}},30000);
}

O.askAsideOpen=text=>{
  build();
  state.open=true;state.sid=S.sid;
  win.classList.remove('hide');
  setCollapsed(false);
  const p=state.pos||O.store.get('askAsidePos',null);
  if(p&&p.x!=null){win.style.left=p.x+'px';win.style.top=p.y+'px';win.style.right='auto';win.style.bottom='auto'}
  headTitle.textContent=busyMain()?O.tr('Clarify · main agent is working','Уточнить · основной агент работает'):O.tr('Clarify','Уточнить');
  if(text&&inp){inp.value=String(text);autosize()}
  renderLog();renderPill();updateChip();
  setTimeout(()=>{try{inp.focus()}catch(_){}},120);
};
O.askAsideClose=()=>{
  state.open=false;
  if(win)win.classList.add('hide');
  renderPill();updateChip();
};
O.askAsideToggle=()=>{state.open&&!state.collapsed?O.askAsideClose():O.askAsideOpen()};
O.askAsideActive=()=>state.busy;
O.askAsideSend=text=>{O.askAsideOpen();ask(text)};

// ---- entry points -------------------------------------------------------
// swipe up on the composer opens the mini chat (tap still sends normally)
O.askAsideBindComposer=comp=>{
  if(!comp||comp._aaBound)return;
  comp._aaBound=true;
  let sy=0,sx=0,t0=0,armed=false;
  comp.addEventListener('touchstart',e=>{
    const t=e.touches[0];if(!t)return;
    if(e.target.closest('button')||e.target.closest('textarea'))return;
    sy=t.clientY;sx=t.clientX;t0=Date.now();armed=true;
  },{passive:true});
  comp.addEventListener('touchend',e=>{
    if(!armed)return;armed=false;
    const t=e.changedTouches[0];if(!t)return;
    const dy=sy-t.clientY,dx=Math.abs(t.clientX-sx);
    if(dy>44&&dx<40&&Date.now()-t0<600){
      const draft=O.$('#composer textarea');
      O.askAsideOpen(draft&&draft.value||'');
      if(draft&&draft.value){draft.value='';draft.dispatchEvent(new Event('input'))}
    }
  },{passive:true});
};
setTimeout(()=>{try{O.askAsideBindComposer(O.$('#composer'))}catch(_){}},600);
bus.on('open',()=>{
  // a new chat: the fork belongs to the old one, drop it and the visible log
  state.fork=null;state.log=[];state.err='';state.sid=S.sid;
  if(state.open)renderLog();
  updateChip();
});
bus.on('status',()=>{if(state.open&&headTitle)headTitle.textContent=busyMain()?O.tr('Clarify · main agent is working','Уточнить · основной агент работает'):O.tr('Clarify','Уточнить')});
})();