(function(){
// ==========================================================================
// ASK-ASIDE ("Уточнить")
// A side agent answers a question WHILE the main agent keeps working.
//   • floating mini-window above the composer (drag, collapse to header)
//   • the side chat is a FORK of the current session → full context, own history
//   • read-only by default; the RESET button inside makes a fresh fork with FULL tools
//   • "full view" button opens the side session as a normal chat
//   • a status chip in the HUD dock, main stream untouched
//   • per-session memory of previous clarifications
//   • voice dictation into the mini composer
//   • swipe up on the composer opens it
//   • errors are isolated: they never touch the main session status or queue
// ==========================================================================
const O=window.OCM,h=O.h,S=O.S,api=O.api,bus=O.bus;

const MEM_KEY=sid=>'askAside.'+sid;
const state={sid:null,open:false,collapsed:false,busy:false,err:'',log:[],fork:null,pos:null,full:false};
let win=null,list=null,inp=null,modelSelect=null,pill=null,sendBtn=null,micBtn=null,headTitle=null,drag=null;

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
// FULL-ACCESS directive: sent once right after a manual session reset inside the clarify window.
const FULL_DIRECTIVE=[
  '[РЕЖИМ УТОЧНЕНИЯ — ПОЛНЫЙ ДОСТУП]',
  'Сессия уточнения сброшена пользователем: предыдущие ограничения «только чтение» больше НЕ действуют.',
  'Тебе доступны все инструменты: bash, edit, write, patch, task и остальные.',
  'У тебя полный контекст родительской сессии. Выполняй уточнённую задачу до конца.',
  'Не начинай заново то, что уже сделано в родительской сессии — продолжай и исправляй.'
].join('\n');

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
  // The floating pill overlapped the chat and duplicated the bottom-bar tab: removed for good.
  if(pill){try{pill.remove()}catch(_){};pill=null}
}
function clampPos(){
  if(!win)return;
  const r=win.getBoundingClientRect();
  const w=r.width||Math.min(innerWidth*0.94,380);
  const hh=r.height||260;
  let x=r.left, y=r.top;
  if(x+w>innerWidth-4)x=Math.max(4,innerWidth-w-4);
  if(y+hh>innerHeight-4)y=Math.max(4,innerHeight-hh-4);
  if(x<4)x=4;
  if(y<4)y=4;
  if(win.style.left||win.style.top||state.pos){
    win.style.left=x+'px';win.style.top=y+'px';win.style.right='auto';win.style.bottom='auto';
    state.pos={x,y};
  }
}
function setCollapsed(v){
  if(typeof v!=='boolean')v=!state.collapsed;
  state.collapsed=v;
  if(win){
    win.classList.toggle('collapsed',v);
    const b=win.querySelector('.aa-head .ibtn:nth-last-child(2)')||win.querySelector('.aa-head')._collapseBtn;
    if(b){b.title=v?O.tr('Expand','Развернуть'):O.tr('Collapse','Свернуть');b.style.transform=v?'rotate(180deg)':''}
  }
  renderPill();
  setTimeout(clampPos,0);
}

// ---- the side turn ------------------------------------------------------
async function ask(text){
  text=String(text||'').trim();
  if(!text||state.busy)return;
  const useModel = modelSelect && modelSelect.value ? (() => {
    const [pid, mid] = modelSelect.value.split('/');
    return {providerID: pid, modelID: mid};
  })() : S.model;
  if(!useModel)return O.toast(O.tr('Pick a model first','Сначала выберите модель'),2200);
  state.sid=S.sid;
  state.err='';
  state.log.push({who:'me',text});
  state.busy=true;renderLog();renderPill();updateChip();
  if(inp){inp.value='';autosize()}
  let sid=null;
  try{
    sid=await ensureFork();
    const mid=O.mid();
    const modelToUse = useModel || S.model;
    // After a manual reset the side agent keeps full tools; otherwise it stays read-only so the
    // main agent's running turn is never disturbed.
    const parts=[{type:'text',text:state.full?FULL_DIRECTIVE:READONLY_DIRECTIVE,synthetic:true},{type:'text',text}];
    // The fork carries the parent context; the directive sets the access level for this turn.
    await api('POST','/session/'+sid+'/prompt_async',{
      messageID:mid,agent:S.agent,model:modelToUse,variant:S.variant||undefined,parts
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
        // read-only guard (skipped after a manual reset — full tools are allowed then)
        if(!state.full&&p.type==='tool'&&READONLY_DENY.includes(String(p.tool||'').toLowerCase())){
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
// Reset the side session: a FRESH fork of the parent (full context) with full tool access.
async function resetSide(){
  if(state.busy)return O.toast(O.tr('Wait for the current answer','Дождитесь текущего ответа'),2000);
  if(!S.sid)return O.toast(O.tr('Open a chat first','Сначала откройте чат'),2000);
  const ok=await O.confirm(
    O.tr('Reset clarification session?','Сбросить сессию уточнения?'),
    O.tr('A fresh branch of the current chat is created. The side agent gets full tool access (bash, edit, write) and the complete parent context. The main chat is untouched.','Будет создана новая ветка текущего чата. Боковой агент получит доступ ко всем инструментам (bash, edit, write) и полный контекст. Основной чат не меняется.'),
    O.tr('Reset','Сбросить'),true);
  if(!ok)return;
  try{
    const r=await api('POST','/session/'+S.sid+'/fork',{});
    const sid=r&&r.id;
    if(!sid)throw new Error(O.tr('Could not fork the session','Не удалось создать ветку сессии'));
    state.fork={sid,parent:S.sid};
    state.full=true;
    state.log=[];state.err='';
    try{if(window.OC&&OC.silentSession)OC.silentSession(sid)}catch(_){}
    try{if(O.noteFork)O.noteFork(sid,S.sid)}catch(_){}
    try{await O.loadSessions()}catch(_){}
    renderLog();updateNote();
    O.toast(O.tr('Session reset · full tool access','Сессия сброшена · полный доступ к инструментам'),2600);
  }catch(e){state.err=(e&&e.message)||String(e);renderLog()}
}
// Full view: open the side session as a normal chat with all messages, tools and parts.
function openFullView(){
  const sid=state.fork&&state.fork.sid;
  if(!sid)return O.toast(O.tr('Ask something first — the branch is created on the first question','Сначала задайте вопрос — ветка создаётся при первом запросе'),2600);
  O.askAsideClose();
  try{O.setTab('chat')}catch(_){}
  O.openSession(sid);
}
function updateNote(){
  if(!win)return;
  const n=win.querySelector('.aa-note');
  if(n)n.textContent=state.full
    ?O.tr('Full access · tools enabled · session reset','Полный доступ · инструменты включены · сессия сброшена')
    :O.tr('Read-only side agent · the main task keeps running','Боковой агент только читает · основная задача продолжается');
}
function build(){
  if(win)return;
  list=h('div',{class:'aa-list'});
  const models = (O.allModels ? O.allModels().filter(x => !O.isModelHidden(x.pid+'/'+x.mid)).slice(0, 12) : []);
  const curModelKey = S.model ? S.model.providerID+'/'+S.model.modelID : '';
  const modelOpts = models.map(m => ({value: m.pid+'/'+m.mid, text: m.name||m.mid, selected: (m.pid+'/'+m.mid)===curModelKey}));
  if(!modelOpts.find(o=>o.selected) && models.length) modelOpts[0].selected = true;
  modelSelect=h('select',{class:'aa-model-select',onchange:()=>{
    const [pid,mid]=modelSelect.value.split('/');
    if(O.setModel&&pid&&mid)O.setModel(pid,mid);
  }}, modelOpts.map(o=>h('option',{value:o.value,selected:o.selected},o.text)));
  inp=h('textarea',{rows:1,class:'aa-inp',placeholder:O.tr('Ask without interrupting…','Спросить, не прерывая…'),
    oninput:autosize,onkeydown:e=>{
      if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask(inp.value)}
    }});
  micBtn=h('button',{class:'ibtn s',title:O.tr('Dictate','Надиктовать'),onclick:dictate},O.icon('mic'));
  sendBtn=h('button',{class:'btn pri sm',onclick:()=>ask(inp.value)},O.icon('send'));
  headTitle=h('b',{class:'grow'},O.tr('Clarify','Уточнить'));
  const collapseBtn=h('button',{class:'ibtn s',title:O.tr('Collapse/Expand','Свернуть/Развернуть'),onclick:()=>setCollapsed()},O.icon('chevD'));
  const head=h('div',{class:'aa-head'},
    O.icon('bulb'),headTitle,
    h('button',{class:'ibtn s',title:O.tr('Reset session · full tools','Сбросить сессию · полный доступ'),onclick:resetSide},O.icon('refresh')),
    h('button',{class:'ibtn s',title:O.tr('Full session view','Полный вид сессии'),onclick:openFullView},O.icon('ext')),
    collapseBtn,
    h('button',{class:'ibtn s',title:O.tr('Close','Закрыть'),onclick:()=>O.askAsideClose()},O.icon('x')));
  head._collapseBtn=collapseBtn;
  const foot=h('div',{class:'aa-foot'},modelSelect,inp,micBtn,sendBtn);
  win=h('div',{id:'ask-aside',class:'ask-aside'},head,list,
    h('div',{class:'aa-note'},O.tr('Read-only side agent · the main task keeps running','Боковой агент только читает · основная задача продолжается')),
    foot);
  document.body.append(win);
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
  setTimeout(()=>{clampPos();try{inp.focus()}catch(_){}},120);
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
  state.fork=null;state.log=[];state.err='';state.sid=S.sid;state.full=false;
  if(state.open){renderLog();updateNote()}
  updateChip();
});
bus.on('status',()=>{if(state.open&&headTitle)headTitle.textContent=busyMain()?O.tr('Clarify · main agent is working','Уточнить · основной агент работает'):O.tr('Clarify','Уточнить')});
})();