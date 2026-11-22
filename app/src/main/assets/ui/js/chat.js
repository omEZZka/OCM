(function(){
const O=window.OCM,h=O.h,S=O.S,api=O.api,bus=O.bus;
let msgsEl,dockEl,popEl,ta,sendBtn,agentChip,modelChip,varChip,attsEl,jumpEl,statusEl,todoEl,revEl,fileIn,nokeyEl,comp,projChip,vcsChip,projTxt,vcsTxt,footerPrompt,chatRoot,mmProgressEl,mmFloatBtn,stickyEl,agentAvatar;
const msgEls=new Map(),partEls=new Map(),open=new Set(),timers=new Map();
// Parts the user expanded/collapsed by hand: survives re-renders, never auto-collapsed.
const manualParts=new Set();
let atts=[],mentions=[],stick=true,revKey='',trail=[];
// True while WE move scrollTop programmatically: the scroll handler must not interpret our own
// intermediate positions as "user scrolled away" (that killed pinning mid-inflation and left the
// session opened in the middle).
let suppressScroll=false;
let histIdx=-1;
let pendingHead=[],loadingOlder=false;
const RENDER_TAIL=28, RENDER_CHUNK=24;
O.rel=p=>{p=String(p||'');return S.dir&&p.startsWith(S.dir+'/')?p.slice(S.dir.length+1):p};
const cur=()=>S.sessions.find(x=>x.id===S.sid)||O.child(S.sid);
const modelStr=()=>S.model?S.model.providerID+'/'+S.model.modelID:undefined;
const busy=()=>{const s=S.status[S.sid];return !!s&&s.type!=='idle'};

O.chatInit=root=>{
  chatRoot=root;
  msgsEl=h('div',{id:'msgs',class:'sel',onscroll:()=>{
    if(suppressScroll)return; // our own programmatic scroll, not the user's finger
    const nb=nearBottom();
    if(!nb&&stick){stick=false;if(pinT){clearInterval(pinT);pinT=null}}
    else if(nb&&!stick)stick=true;
    jumpEl.classList.toggle('hide',stick);
    maybeLoadOlder();
    scheduleSticky();saveReadPos();
  }});
  // Any real touch inside the list cancels bottom-pinning immediately: the finger wins.
  msgsEl.addEventListener('touchstart',()=>{if(pinT){clearInterval(pinT);pinT=null}},{passive:true});
  msgsEl.addEventListener('wheel',()=>{if(pinT){clearInterval(pinT);pinT=null}},{passive:true});
  jumpEl=h('button',{id:'jump',class:'hide',onclick:()=>scrollEnd(true)},O.icon('chevD'));
  stickyEl=h('div',{id:'chat-sticky',class:'hide'});
  revEl=h('div',{class:'hide',style:{padding:'0 10px 6px'}});
  todoEl=h('div',{class:'hide',style:{padding:'0 10px 6px'}});
  dockEl=h('div',{id:'dock'});statusEl=h('div',{class:'status-line hide'});
  mmProgressEl=h('div',{id:'mm-progress',class:'hide'});
  mmFloatBtn=h('button',{id:'mm-float-btn',class:'hide',title:O.tr('Multimodal agent','Мультимодальный агент')});
  popEl=h('div',{id:'pop',class:'hide'});attsEl=h('div',{class:'atts hide'});
  nokeyEl=h('div',{class:'nokey hide'},h('span',{class:'grow'},O.tr('No models connected.','Модели не подключены.')),h('button',{class:'btn sm',onclick:()=>O.openConnect()},O.icon('key'),O.tr('Connect','Подключить')));
  ta=h('textarea',{rows:1,placeholder:O.tr('Chat with OpenCode...','Чат с OpenCode...'),oninput:onInput,onclick:onInput,
    // Arrow-up on an empty composer walks the prompt history, like a shell.
    onkeydown:e=>{
      if(e.key!=='ArrowUp')return;
      const empty=!ta.value.trim();
      const atStart=ta.selectionStart===0||empty;
      if(!atStart)return;
      const hist=O.promptHistory?O.promptHistory():[];
      if(!hist.length)return;
      e.preventDefault();
      histIdx=Math.min(hist.length-1,histIdx+1);
      ta.value=hist[histIdx]||'';
      onInput();
      ta.setSelectionRange(ta.value.length,ta.value.length);
    },
    onkeyup:e=>{if(e.key.length>1)onInput()}});
  ta.addEventListener('keydown',e=>{if(e.key!=='ArrowDown')return;if(!ta.value.trim()){e.preventDefault();histIdx=Math.max(-1,histIdx-1);ta.value=histIdx<0?'':(O.promptHistory()[histIdx]||'');onInput()}});
  fileIn=h('input',{type:'file',multiple:true,class:'hide',accept:'image/*,application/pdf,text/*',onchange:onFiles});
  const plusBtn=h('button',{class:'attach-btn',onclick:()=>fileIn.click()},O.icon('plus'));
  const outlineBtn=h('button',{class:'hud-icon-btn outline-btn',title:O.tr('Conversation outline','Оглавление диалога'),onclick:()=>O.openOutline&&O.openOutline()},O.icon('list'));
  const ctxBtn=h('button',{class:'hud-icon-btn ctx-btn',title:O.tr('Context snapshot','Снимок контекста'),onclick:()=>O.openContextPreview&&O.openContextPreview()},O.icon('eye'));
  const planBtn=h('button',{class:'hud-icon-btn plan-btn',title:O.tr('Step-by-step plan','Пошаговый план'),onclick:()=>O.openPlan()},O.icon('list'));
  const syncPlanBtn=()=>{planBtn.classList.toggle('hide',!O.planMode())};
  bus.on('planMode',syncPlanBtn);syncPlanBtn();
  agentChip=h('button',{class:'hud-pill agent-pill',onclick:()=>O.openAgents()},h('span',null,'Build'),O.icon('chevD'));
  if(agentChip._mmWatch===undefined){agentChip._mmWatch=1;bus.on('mm',updateChips)}
  // Agent avatar with pulse (06) + who-is-answering card (43); long-press switches mode fast.
  agentAvatar=h('button',{class:'agent-avatar',title:O.tr('Who is answering','Кто отвечает'),onclick:agentCard},O.icon('bot'));
  O.longPress(agentAvatar,()=>O.openAgents(),500);
  modelChip=h('button',{class:'hud-pill model-pill',onclick:()=>O.openModels()},h('span',null,O.tr('Select model','Выбрать модель')),O.icon('chevD'));
  // Tap: while a call runs it ends it, otherwise a sheet asks what the user wants.
  // Long-press: straight to dictation, the fastest path for a single phrase.
  const micBtn=h('button',{class:'hud-icon-btn mic-btn',onclick:()=>{
    if(O.callActive&&O.callActive()){O.endCall();return}
    if(O.onMicChoice)O.onMicChoice();else onMic();
  }},O.icon('mic'));
  O.longPress(micBtn,()=>{if(O.voiceDictate)O.voiceDictate();else onMic();},450);
  bus.on('call',()=>micBtn.classList.toggle('on-call',!!(O.callActive&&O.callActive())));
  sendBtn=h('button',{id:'send',onclick:()=>onSend()},O.icon('send'));
  // Send-to-another-model (20): long-press on send picks a model for THIS message.
  O.longPress(sendBtn,()=>{
    const text=ta.value.trim();
    if(!text&&!atts.length){O.openModels();return}
    const curKey=S.model?S.model.providerID+'/'+S.model.modelID:'';
    const others=O.allModels().filter(x=>!O.isModelHidden(x.pid+'/'+x.mid)).slice(0,14);
    O.actions(O.tr('Send with model…','Отправить моделью…'),others.map(x=>{
      const key=x.pid+'/'+x.mid;
      return{label:x.name||x.mid,sub:key===curKey?O.tr('current','текущая'):x.pid,icon:key===curKey?'check':'cpu',fn:()=>{
        // FIX (audit #8): pass the model as a parameter — mutating S.model on a 600ms timer raced
        // the async send (session creation can take longer) and could clobber a manual switch.
        onSend({providerID:x.pid,modelID:x.mid});
      }};
    }));
  },500);
  // Composer chips: ONLY + / mode / model / voice / send. Outline, context, plan and the avatar
  // moved into the mode chip's long-press menu — the row overflowed on narrow phones.
  const cbarLeft=h('div',{class:'cbar-left'},plusBtn,agentChip,modelChip);
  const cbarRight=h('div',{class:'cbar-right'},micBtn,sendBtn);
  O.longPress(agentChip,()=>{
    O.actions(O.tr('Chat tools','Инструменты чата'),[
      {label:O.tr('Who is answering','Кто отвечает'),sub:O.tr('Model, mode, state, context','Модель, режим, состояние, контекст'),icon:'bot',fn:agentCard},
      {label:O.tr('Conversation outline','Оглавление диалога'),icon:'list',fn:()=>O.openOutline&&O.openOutline()},
      {label:O.tr('AI outline','ИИ-оглавление'),icon:'bulb',fn:()=>O.openAiToc&&O.openAiToc()},
      {label:O.tr('Context snapshot','Снимок контекста'),icon:'eye',fn:()=>O.openContextPreview&&O.openContextPreview()},
      {label:O.tr('Step-by-step plan','Пошаговый план'),icon:'list',fn:()=>O.openPlan()},
      {label:O.tr('Session summary','Саммари сессии'),icon:'doc',fn:()=>O.openSessionSummary&&O.openSessionSummary()},
      {label:O.tr('Session media','Медиа сессии'),icon:'film',fn:()=>O.openSessionRibbon&&O.openSessionRibbon()},
      {label:O.tr('Project template','Шаблон проекта'),icon:'doc',fn:()=>O.openProjectTpls&&O.openProjectTpls(true)},
      {label:O.tr('Personal memory','Персональная память'),icon:'memory',fn:()=>O.openUserFacts&&O.openUserFacts()},
      {label:O.tr('Night lamp','Ночная лампа'),icon:'bulb',fn:()=>O.setNightLamp&&O.setNightLamp(!O.nightLamp())}
    ]);
  },500);
  const cbarRow=h('div',{class:'cbar-row'},cbarLeft,cbarRight);
  comp=h('div',{id:'composer'},popEl,h('div',{class:'cbox'},nokeyEl,attsEl,ta,cbarRow),fileIn);
  const wrap=h('div',{class:'chat-msgs-wrap',style:{position:'relative',flex:1,minHeight:0,display:'flex',flexDirection:'column'}},msgsEl,stickyEl,jumpEl);
  root.append(wrap,revEl,todoEl,statusEl,dockEl,mmProgressEl,mmFloatBtn,comp);
  // FIX (mascot fell into the composer): it used to be a child of the scrollable #msgs wrapper,
  // so typing (which reflows/scrolls the list) shifted and clipped it under the input. It now
  // lives in the chat pane itself, above everything, and only moves when dragged.
  if(O.mascotDispose){try{O.mascotDispose()}catch(_){}}
  if(O.mascotInit){try{O.mascotInit(root)}catch(e){console.error('mascot',e)}}
  bus.on('open',()=>{renderAll()});
  // Live-resync snapshot: merge into the DOM incrementally. NEVER force-scroll here — the user
  // may be reading far above; only follow when already glued to the bottom.
  bus.on('resync',sid=>{
    if(sid!==S.sid)return;
    const list=O.visibleMsgs(sid);
    const was=stick;
    // FIX (turn merge): resync must respect merged turn cards — ensureMsg aliases them itself.
    for(const m of list.slice(-RENDER_TAIL))ensureMsg(m);
    if(was)scrollEnd();
  });
  let msgRaf=0;
  bus.on('msg',(sid,m)=>{if(sid!==S.sid)return;const was=stick;ensureMsg(m);
    if(was&&!msgRaf)msgRaf=requestAnimationFrame(()=>{msgRaf=0;scrollEnd()});
    O.runHook('onReceive',{message:m,sessionID:sid})});
  // delta events can arrive many times per frame; batch the scroll into one rAF
  let partRaf=0;
  bus.on('part',(sid,m)=>{if(sid!==S.sid)return;const was=stick;ensureMsg(m);
    if(was&&!partRaf)partRaf=requestAnimationFrame(()=>{partRaf=0;scrollEnd()})});
  bus.on('msg-removed',(sid,id)=>{
    // FIX (audit #4): guard foreign sessions; purge partEls/timers of the removed card's parts
    if(sid!==S.sid)return;
    const e=msgEls.get(id);if(!e)return;
    let shared=false;for(const[k,v]of msgEls){if(v===e&&k!==id){shared=true;break}}
    if(!shared){
      e.querySelectorAll('[data-pid]').forEach(pe=>{const pid=pe.dataset.pid;partEls.delete(pid);dropTimer(pid);if(pe._tt){clearTimeout(pe._tt);pe._tt=null}});
      e.remove();
    }
    msgEls.delete(id)});
  bus.on('part-removed',(sid,m,pid)=>{dropTimer(pid);const e=partEls.get(pid);if(e){e.remove();partEls.delete(pid)}});
  bus.on('status',sid=>{const st=S.status[sid];if(O._fallback&&O._fallback.sid===sid&&(!st||st.type==='idle'))O._fallback=null;if(sid===S.sid){renderStatus();updateSend();syncAgentPulse();
    // status flips can change placeholders / auto-fold state without any part change
    const last=O.lastAssistant&&O.lastAssistant(sid);
    if(last){const el=msgEls.get(last.msg.info.id);if(el){el._sig='';ensureMsg(last.msg)}}
  }if(O.mm.run)renderMmProgress()});
  bus.on('perm',renderDock);bus.on('todo',sid=>{if(sid===S.sid)renderTodos()});
  bus.on('queue',sid=>{if(sid===S.sid)renderQueueBar()});
  bus.on('session',()=>{const k=revisionKey();if(k!==revKey)renderAll();else renderRevert()});
  bus.on('sessions',()=>{renderRevert()});
  bus.on('mm:progress',renderMmProgress);
  bus.on('idle',sid=>{
    if(sid!==S.sid)return;
    if(bus._idleAt&&bus._idleAt[sid]&&Date.now()-bus._idleAt[sid]<800)return;
    (bus._idleAt=bus._idleAt||{})[sid]=Date.now();
    if(O.clearInflight)O.clearInflight();
    if(O._turnStart&&O.recordTurnTime){O.recordTurnTime(S.sid,Date.now()-O._turnStart);O._turnStart=0}
    if(O.peekPrompt){
      // FIX (audit #9): peek + commit AFTER a successful send; if the agent became busy again
      // during the delay, the item stays queued instead of vanishing.
      const next=O.peekPrompt(S.sid);
      if(next&&(next.text||(next.atts&&next.atts.length)))setTimeout(async()=>{
        // Wait for the status to really be idle (a retry/continuation may still be running).
        for(let i=0;i<10&&busy();i++)await new Promise(r=>setTimeout(r,300));
        if(busy())return;                       // keep it queued, try again on the next idle
        const ok=await O.chatSendText(next.text,{atts:next.atts,mentions:next.mentions,fromQueue:true});
        if(ok!==false)O.commitPrompt(S.sid);
      },400);
    }
    if(O.autoCompact&&O.autoCompact()){
      const u=O.contextUsage(S.sid);
      const done=O.store.get('autoCompactAt.'+S.sid,0);
      if(u&&u.pct!=null&&u.pct>=(O.compactThreshold?O.compactThreshold():85)&&Date.now()-done>120000&&S.model){
        O.store.set('autoCompactAt.'+S.sid,Date.now());
        O.toast(O.tr('Context '+u.pct+'% — compacting automatically','Контекст '+u.pct+'% — сжимаю автоматически'),3000);
        doCompact();
      }
    }
    renderContinue();flushPartTimers();
    // final exact pass: streaming used throttled renders, the settled message must be exact.
    // FIX (turn merge): merged cards must re-sync as a whole turn, not per source message —
    // otherwise a settled pack kept stale streaming text of its merged parts.
    const seenEls=new Set();
    for(const m of (S.sid?O.msgs(S.sid).list:[])){
      const el=msgEls.get(m.info.id);if(!el||seenEls.has(el))continue;
      seenEls.add(el);
      if(m.info.role==='assistant'&&toolView()!=='cards'){
        el._sig='';ensureMsg(m);continue;
      }
      for(const p of m.parts){const pe=partEls.get(p.id);if(pe&&(p.type==='text'||p.type==='reasoning')){pe._t=null;fillPart(pe,p,m,false)}}
    }
  });
  bus.on('msg',()=>renderContinue());
  bus.on('meta',updateChips);bus.on('conn',updateChips);
  bus.on('serror',p=>{if(p&&(!p.sessionID||p.sessionID===S.sid)){const e=p.error;const t=e&&(e.data&&e.data.message||e.name);if(t&&e.name!=='MessageAbortedError'){
    const kind=O.errorKind(e,t);
    // ContextOverflow mid-run is a signal for the core's auto-compaction, not a user-facing error.
    if(kind==='context'&&(S.status[p.sessionID]||{}).type!=='idle')return;
    // The core retries transient failures itself (status=retry). Interrupting with a quota modal
    // here produced "limit reached" popups while the model kept working and then answered fine.
    if((S.status[p.sessionID]||{}).type==='retry'){
      if(kind==='quota'&&O._fallback&&p.sessionID===O._fallback.sid&&O._fallback.tries.length){/* fall through to fallback */}
      else return;
    }
    if(O._fallback&&p.sessionID===O._fallback.sid&&O._fallback.tries.length){
      const fb=O._fallback;O._fallback=null;const next=fb.tries.shift();
      (async()=>{
        try{await api('POST','/session/'+fb.sid+'/revert',{messageID:fb.mid})}catch(_){}
        try{
          const mid=O.mid();
          await api('POST','/session/'+fb.sid+'/prompt_async',{messageID:mid,agent:S.agent,model:next,variant:S.variant||undefined,parts:fb.parts},{timeout:30000});
          O.toast(O.tr('Fallback model: ','Резервная модель: ')+next.modelID,3000);
          if(fb.tries.length)O._fallback={sid:fb.sid,mid,parts:fb.parts,tries:fb.tries};
        }catch(er){O.toast(er.message,4000)}
      })();
      return;
    }
    if(kind==='quota'){
      O.notifyLimit(O.tr('Limit Reached','Лимит исчерпан'),O.tr('Free quota limit reached.','Бесплатные лимиты закончились.'));
      O.showQuotaAccountModal(t);
    }
    else if(kind==='output-length'){
      O.toast(O.tr('Answer hit the output token limit — press Continue to resume','Ответ упёрся в лимит длины — нажмите «Продолжить», чтобы досказать'),4000);
    }
    else O.toast(t,4000)}}});
  O.on('voice',d=>{if(d&&d.text){ta.value=(ta.value?ta.value+' ':'')+d.text;onInput();ta.focus()}});
  // Keyboard-aware overlay offset: visualViewport shrinks while the soft keyboard is open. Keep the
  // mascot glued above the input instead of letting it fall behind the keyboard.
  const syncKeyboard=()=>{
    try{
      const vv=window.visualViewport;
      const gap=vv?Math.max(0,Math.round(window.innerHeight-vv.height-vv.offsetTop)):0;
      document.documentElement.style.setProperty('--kb',(gap>80?gap:0)+'px');
    }catch(_){}
  };
  if(window.visualViewport){
    visualViewport.addEventListener('resize',syncKeyboard,{passive:true});
    visualViewport.addEventListener('scroll',syncKeyboard,{passive:true});
  }
  window.addEventListener('resize',syncKeyboard,{passive:true});
  ta.addEventListener('focus',()=>setTimeout(syncKeyboard,250));
  ta.addEventListener('blur',()=>setTimeout(syncKeyboard,250));
  // the mascot body lives on the composer ledge: keep it glued when the box grows
  const reMascot=()=>{try{O.mascotReanchor&&O.mascotReanchor()}catch(_){}};
  ta.addEventListener('input',()=>setTimeout(reMascot,30));
  window.addEventListener('resize',()=>setTimeout(reMascot,80),{passive:true});
  setTimeout(reMascot,400);
  syncKeyboard();
  fsTip=h('div',{id:'fs-tip'});document.body.append(fsTip);
  initPinch();initSelectionThreads();initVoiceWave(micBtn);
  bus.on('perm',syncAgentPulse);
  updateChips();renderAll();
};
O.notifyLimit=(title,text)=>{
  try{if(window.OC&&OC.testSound)OC.testSound('quota')}catch(_){}
  try{if(O.native&&O.native.notify)O.native.notify('quota',title||O.tr('Limit Reached','Лимит исчерпан'),text||O.tr('Free quota limit reached.','Бесплатные лимиты закончились.'))}catch(_){}
};
O.checkTokenWarning=sid=>{
  if(!sid)return;
  const u=O.contextUsage(sid);if(!u||u.pct==null)return;
  const lvl=u.pct>=95?95:(u.pct>=80?80:0);
  const key='tokWarn.'+sid,prev=O.store.get(key,0)||0;
  if(lvl>prev){
    O.store.set(key,lvl);
    const txt=lvl>=95
      ?O.tr('Context is almost full ('+u.pct+'%). Compact the session or start a new one.','Контекст почти заполнен ('+u.pct+'%). Сожмите сессию или начните новую.')
      :O.tr('Context is '+u.pct+'% full. Consider /compact soon.','Контекст заполнен на '+u.pct+'%. Скоро стоит выполнить /compact.');
    O.toast(txt,5000);
    if(lvl>=95)O.notifyLimit(O.tr('Context almost full','Контекст почти заполнен'),txt);
  }else if(lvl===0&&prev){
    O.store.set(key,0);
  }
};
const nearBottom=()=>msgsEl.scrollHeight-msgsEl.scrollTop-msgsEl.clientHeight<140;
// Preserves the reading position across a re-render that happens above the viewport.
const keepAnchor=(fn)=>{
  const sh=msgsEl.scrollHeight,st=msgsEl.scrollTop;
  const near=sh-st-msgsEl.clientHeight<140;
  fn();
  if(near)return;
  const after=msgsEl.scrollHeight;
  if(after!==sh){
    suppressScroll=true;
    msgsEl.scrollTop=st+(after-sh);
    requestAnimationFrame(()=>{suppressScroll=false});
  }
};
const scrollEnd=f=>{requestAnimationFrame(()=>{
  // Without the force flag, follow only while still glued to the bottom: a queued rAF must not
  // yank the reader down after they already scrolled away.
  if(!f&&!stick)return;
  suppressScroll=true;
  const target=msgsEl.scrollHeight-msgsEl.clientHeight;
  const cur=msgsEl.scrollTop;
  // Cinematic follow: short smooth glide when close, instant jump for big gaps (session open).
  if(f||target-cur>msgsEl.clientHeight*1.5||!O.chatAnim||!O.chatAnim()){msgsEl.scrollTop=target;requestAnimationFrame(()=>{suppressScroll=false})}
  else{
    // FIX (audit #10): the glide animates for hundreds of ms and fires scroll events; releasing
    // suppressScroll after ONE frame let those events kill stick mid-stream. Hold it ~450ms.
    try{msgsEl.scrollTo({top:target,behavior:'smooth'})}catch(_){msgsEl.scrollTop=target}
    setTimeout(()=>{suppressScroll=false},450);
  }
  if(f){stick=true;jumpEl.classList.add('hide')}
})};
O.chatAnim=()=>O.store.get('chatAnim',true);
// Keep the chat pinned to the bottom for a short while after an open/render:
// images, code blocks and markdown inflate the height asynchronously, which
// otherwise leaves the view stranded in the middle of the conversation.
let pinT=null;
const pinBottom=ms=>{
  if(pinT)clearInterval(pinT);
  // Images/code/highlight inflate asynchronously for several seconds on big sessions; a 1.5 s
  // window ended too early and the session stayed opened in the middle.
  const until=Date.now()+(ms||4000);
  pinT=setInterval(()=>{
    if(!msgsEl.isConnected){clearInterval(pinT);pinT=null;return}
    if(Date.now()>until){clearInterval(pinT);pinT=null;return}
    if(!stick){clearInterval(pinT);pinT=null;return}
    suppressScroll=true;
    msgsEl.scrollTop=msgsEl.scrollHeight;
    requestAnimationFrame(()=>{suppressScroll=false});
  },100);
};
const revisionKey=()=>{const s=cur();return s&&s.revert?s.revert.messageID:''};

// ---- sticky date headers (39) ----
let stickyRaf=0;
function scheduleSticky(){if(stickyRaf)return;stickyRaf=requestAnimationFrame(()=>{stickyRaf=0;paintSticky()})}
function dayLabel(ts){
  const d=new Date(ts),now=new Date();
  const day=x=>x.getFullYear()+'-'+x.getMonth()+'-'+x.getDate();
  if(day(d)===day(now))return O.tr('Today','Сегодня');
  const y=new Date(now);y.setDate(now.getDate()-1);
  if(day(d)===day(y))return O.tr('Yesterday','Вчера');
  return d.toLocaleDateString(O.store.get('lang','ru')==='en'?'en':'ru',{day:'numeric',month:'long'})+(d.getFullYear()!==now.getFullYear()?' '+d.getFullYear():'');
}
function paintSticky(){
  if(!stickyEl||!msgsEl)return;
  if(!S.sid||!msgEls.size){stickyEl.classList.add('hide');return}
  const top=msgsEl.scrollTop+8;
  let label='',found=null;
  for(const c of msgsEl.children){
    if(!c.dataset||!c.dataset.id)continue;
    if(c.offsetTop<=top)found=c;else break;
  }
  if(found){
    const m=O.msgs(S.sid).idx.get(found.dataset.id);
    const ts=m&&m.info.time&&m.info.time.created;
    if(ts)label=dayLabel(ts);
  }
  if(!label){stickyEl.classList.add('hide');return}
  if(stickyEl._t!==label){stickyEl._t=label;stickyEl.textContent=label}
  stickyEl.classList.remove('hide');
}
// ---- reading position memory (26) ----
let readPosT=null;
function saveReadPos(){
  if(!S.sid||readPosT)return;
  readPosT=setTimeout(()=>{readPosT=null;
    if(!S.sid)return;
    if(stick){O.store.set('readPos.'+S.sid,0);return}
    // anchor: id of the first visible message + offset inside it
    const top=msgsEl.scrollTop;
    for(const c of msgsEl.children){
      if(!c.dataset||!c.dataset.id)continue;
      if(c.offsetTop+c.offsetHeight>top){O.store.set('readPos.'+S.sid,{id:c.dataset.id,off:top-c.offsetTop});return}
    }
  },400);
}
function restoreReadPos(){
  const rp=S.sid&&O.store.get('readPos.'+S.sid,null);
  if(!rp||!rp.id)return false;
  const el=msgEls.get(rp.id);
  if(!el)return false;
  stick=false;jumpEl.classList.remove('hide');
  suppressScroll=true;
  msgsEl.scrollTop=el.offsetTop+(rp.off||0);
  requestAnimationFrame(()=>{suppressScroll=false});
  el.classList.add('msg-flash');setTimeout(()=>el.classList.remove('msg-flash'),1200);
  return true;
}
// ---- agent pulse + avatar card (06, 43): pulse lives on the MODE chip (avatar left the row) ----
function syncAgentPulse(){
  const st=S.status[S.sid];
  const busyNow=!!st&&st.type!=='idle';
  const waiting=S.perms.some(p=>p.sessionID===S.sid)||S.questions.some(q=>q.sessionID===S.sid);
  if(agentChip){agentChip.classList.toggle('pulsing',busyNow);agentChip.classList.toggle('waiting',waiting)}
  if(agentAvatar){agentAvatar.classList.toggle('pulsing',busyNow);agentAvatar.classList.toggle('waiting',waiting)}
}
function agentCard(){
  const ag=S.agents.find(a=>a.name===S.agent);
  const mmA=O.mmActive&&O.mmActive();
  const mi=S.model&&O.modelInfo(S.model.providerID,S.model.modelID);
  const caps=S.model&&O.modelCapsOf?O.modelCapsOf(S.model.providerID,S.model.modelID):null;
  const st=S.status[S.sid];
  const rows=[];
  const row=(icon,label,val)=>h('div',{class:'settings-row'},h('div',{class:'settings-row-icon'},O.icon(icon)),h('div',{class:'settings-row-text'},h('b',null,label),h('span',{style:{whiteSpace:'normal'}},val)));
  rows.push(row('bot',O.tr('Mode','Режим'),mmA?(O.tr('Team: ','Команда: ')+mmA.name):(ag?ag.name:S.agent)));
  rows.push(row('cpu',O.tr('Model','Модель'),mi?(mi.name||mi.modelID):(S.model?S.model.modelID:O.tr('not selected','не выбрана'))));
  if(caps)rows.push(row('image',O.tr('Capabilities','Возможности'),[caps.images?O.tr('images','картинки'):null,caps.tools?O.tr('tools','инструменты'):null,caps.reasoning?O.tr('reasoning','рассуждения'):null].filter(Boolean).join(' · ')||'—'));
  rows.push(row('zap',O.tr('State','Состояние'),st&&st.type!=='idle'?O.tr('working','работает'):O.tr('idle','простой')));
  const u=S.sid&&O.contextUsage(S.sid);
  if(u&&u.pct!=null)rows.push(row('memory',O.tr('Context','Контекст'),u.pct+'% '+O.tr('used','занято')));
  const body=h('div',null,h('div',{class:'settings-card'},rows),
    h('div',{style:{display:'flex',gap:'8px',marginTop:'10px'}},
      h('button',{class:'btn sm grow',onclick:()=>{O.back();O.openAgents()}},O.icon('bot'),O.tr('Change mode','Сменить режим')),
      h('button',{class:'btn sm grow',onclick:()=>{O.back();O.openModels()}},O.icon('cpu'),O.tr('Model','Модель'))));
  O.sheet(O.tr('Who is answering','Кто отвечает'),body,{hud:true});
}
// ---- pinch-to-zoom font size (44) ----
function initPinch(){
  let d0=0,fs0=0,pinching=false;
  msgsEl.addEventListener('touchstart',e=>{
    if(e.touches.length===2){
      pinching=true;
      const dx=e.touches[0].clientX-e.touches[1].clientX,dy=e.touches[0].clientY-e.touches[1].clientY;
      d0=Math.hypot(dx,dy);fs0=S.opts.fs||14;
    }
  },{passive:true});
  msgsEl.addEventListener('touchmove',e=>{
    if(!pinching||e.touches.length!==2)return;
    const dx=e.touches[0].clientX-e.touches[1].clientX,dy=e.touches[0].clientY-e.touches[1].clientY;
    const d=Math.hypot(dx,dy);
    if(!d0)return;
    const fs=Math.max(11,Math.min(24,Math.round(fs0*d/d0)));
    if(fs!==S.opts.fs){S.opts.fs=fs;document.documentElement.style.setProperty('--fs',fs+'px');
      if(fsTip)fsTip.textContent=fs+'px';}
    if(e.cancelable)e.preventDefault();
  },{passive:false});
  const end=()=>{if(!pinching)return;pinching=false;O.saveOpts();
    if(fsTip){fsTip.classList.add('show');clearTimeout(fsTip._t);fsTip._t=setTimeout(()=>fsTip.classList.remove('show'),900)}};
  msgsEl.addEventListener('touchend',end);
  msgsEl.addEventListener('touchcancel',end);
}
let fsTip=null;
// ---- night lamp (45) ----
O.nightLamp=()=>O.store.get('nightLamp',false);
O.setNightLamp=on=>{
  O.store.set('nightLamp',!!on);
  document.documentElement.classList.toggle('night-lamp',!!on);
  O.toast(on?O.tr('Night lamp on','Ночная лампа включена'):O.tr('Night lamp off','Ночная лампа выключена'),1400);
};
if(O.nightLamp())document.documentElement.classList.add('night-lamp');
// ---- selection threads (34): select a fragment of an answer → ask about exactly it ----
function initSelectionThreads(){
  let selBtn=null;
  const hide=()=>{if(selBtn){selBtn.remove();selBtn=null}};
  document.addEventListener('selectionchange',O.debounce(()=>{
    const sel=document.getSelection();
    if(!sel||sel.isCollapsed||!sel.rangeCount){hide();return}
    const txt=String(sel.toString()).trim();
    if(txt.length<8||txt.length>4000){hide();return}
    const node=sel.anchorNode&&(sel.anchorNode.nodeType===1?sel.anchorNode:sel.anchorNode.parentElement);
    if(!node||!node.closest||!node.closest('#msgs .p-text')){hide();return}
    const r=sel.getRangeAt(0).getBoundingClientRect();
    if(!r.width&&!r.height){hide();return}
    hide();
    selBtn=h('button',{class:'sel-ask',style:{left:Math.max(8,Math.min(innerWidth-170,r.left+r.width/2-80))+'px',top:Math.max(8,r.top-44)+'px'},
      onclick:()=>{
        const quote=txt;hide();sel.removeAllRanges();
        O.insertPrompt('> '+quote.split('\n').join('\n> ')+'\n\n');
        O.toast(O.tr('Fragment quoted — add your question','Фрагмент процитирован — добавьте вопрос'),2000);
      }},O.icon('at'),O.tr('Ask about this','Спросить об этом'));
    document.body.append(selBtn);
  },250));
  msgsEl.addEventListener('scroll',hide,{passive:true});
  msgsEl.addEventListener('touchstart',e=>{if(selBtn&&!selBtn.contains(e.target))hide()},{passive:true});
}
// ---- live voice wave in the mic button (17, 41) ----
function initVoiceWave(micBtn){
  const wave=h('span',{class:'mic-wave'},[0,1,2,3,4].map(()=>h('i')));
  micBtn.append(wave);
  let level=0,active=false,raf=0;
  const paint=()=>{
    raf=0;
    if(!active)return;
    const bars=wave.children;
    for(let i=0;i<bars.length;i++){
      const v=Math.max(0.12,Math.min(1,(level/12)*(0.5+0.5*Math.sin(Date.now()/90+i*1.7))));
      bars[i].style.transform='scaleY('+v.toFixed(2)+')';
    }
    raf=requestAnimationFrame(paint);
  };
  const on=()=>{if(active)return;active=true;micBtn.classList.add('listening');if(!raf)raf=requestAnimationFrame(paint)};
  const off=()=>{active=false;micBtn.classList.remove('listening');if(raf){cancelAnimationFrame(raf);raf=0}};
  O.on('stt',d=>{
    if(!d)return;
    if(d.t==='level'){level=d.v||0;on();return}
    if(d.t==='begin'||d.t==='partial'){on();return}
    if(d.t==='final'||d.t==='empty'||d.t==='error')off();
  });
  O.on('voiceWave',d=>{if(d&&d.on){level=d.level||4;on()}else off()});
}

function renderAll(){
  // drop pending per-part render jobs: their DOM nodes are about to be replaced anyway
  for(const t of timers.values())clearTimeout(t);
  timers.clear();
  if(O.chatSkeletonOff)O.chatSkeletonOff();
  msgsEl.innerHTML='';msgEls.clear();partEls.clear();revKey=revisionKey();
  // FIX (audit #3): these Sets grew forever (one key per message/part of every session ever
  // opened). Prune to the CURRENT session's keys instead of wiping: a same-session rebuild must
  // preserve the user's manual open/close choices (keys are prefixed with the message id).
  const curIds=new Set((S.sid?O.msgs(S.sid).list:[]).map(m=>m.info.id));
  const keepKey=k=>{const mid=k.split('#')[0];return curIds.has(mid)};
  for(const k of [...open])if(!keepKey(k))open.delete(k);
  for(const k of [...manualParts])if(!keepKey(k))manualParts.delete(k);
  for(const k of [...openGroups])if(!keepKey(k))openGroups.delete(k);
  for(const k of [...manualGroups])if(!keepKey(k))manualGroups.delete(k);
  const list=S.sid?O.visibleMsgs(S.sid):[];
  if(draftSid!==S.sid){
    draftSid=S.sid;clearTimeout(draftTimer);
    ta.value=S.sid?(O.getDraft(S.sid)||''):'';
    atts=[];mentions=[];
    const sid0=S.sid;
    if(sid0&&O.getDraftEx){
      draftRestoring=true;
      O.getDraftEx(sid0).then(ex=>{
        draftRestoring=false;
        if(!ex||draftSid!==sid0||S.sid!==sid0)return;
        const hasAtts=Array.isArray(ex.atts)&&ex.atts.length;
        const hasMentions=Array.isArray(ex.mentions)&&ex.mentions.length;
        if((hasAtts||hasMentions)&&!atts.length){
          atts=hasAtts?ex.atts:[];mentions=hasMentions?ex.mentions:[];renderAtts();
        }
      }).catch(()=>{draftRestoring=false});
    }
    renderAtts();autosize();updateSend();
  }
  else if(S.sid&&!ta.value){const draft=O.getDraft(S.sid);if(draft){ta.value=draft;autosize();updateSend()}}
  if(!list.length){pendingHead=[];showEmpty()}
  else{
    if(chatRoot)chatRoot.classList.remove('is-empty');
    const start=Math.max(0,list.length-RENDER_TAIL);
    pendingHead=list.slice(0,start);
    const fr=document.createDocumentFragment();
    const built=new Set();
    for(let i=start;i<list.length;i++){
      const m=list[i];
      // hidden transport messages (Continue's synthetic prompt) must never create a card
      if(!m.parts.some(p=>showPart(m,p))&&!m.info.error)continue;
      // turn merge: only the host assistant message of a turn builds a card
      if(m.info.role==='assistant'&&toolView()!=='cards'){
        const host=turnHost(m);
        if(built.has(host.info.id)){msgEls.set(m.info.id,msgEls.get(host.info.id));continue}
        const vm=mergedTurnMsg(host);
        const el=buildMsg(vm);built.add(host.info.id);
        (vm._ids||[host.info.id]).forEach(id=>msgEls.set(id,el));
        fr.append(el);
      }else{
        if(m.info.role==='user'&&!m.parts.some(p=>showPart(m,p)))continue;
        const el=buildMsg(m);built.add(m.info.id);fr.append(el);
      }
    }
    msgsEl.append(fr);
  }
  // FIX (active-session open lands mid-chat): a BUSY session always opens at the live tail —
  // reading-position memory applies only to settled sessions. The pin window is longer while
  // the agent works: streamed markdown/code keeps inflating the height for many seconds.
  const st=S.status[S.sid];
  const active=!!st&&st.type!=='idle';
  const restored=!active&&restoreReadPos();
  if(!restored){stick=true;scrollEnd(true);pinBottom(active?15000:(list.length>60?6000:4000))}
  scheduleSticky();syncAgentPulse();
  renderDock();renderStatus();renderContinue();renderRecovery();renderRevert();renderTodos();updateSend();updateChips()}

function maybeLoadOlder(){
  if(loadingOlder||!pendingHead.length)return;
  if(msgsEl.scrollTop>220)return;
  loadingOlder=true;
  const prevH=msgsEl.scrollHeight,prevTop=msgsEl.scrollTop;
  const start=Math.max(0,pendingHead.length-RENDER_CHUNK);
  const chunk=pendingHead.slice(start);
  pendingHead=pendingHead.slice(0,start);
  const fr=document.createDocumentFragment();
  const built=new Set();
  chunk.forEach(m=>{
    if(!m.parts.some(p=>showPart(m,p))&&!m.info.error)return;
    if(m.info.role==='assistant'&&toolView()!=='cards'){
      const host=turnHost(m);
      // FIX (audit #2): the turn's card may already exist in a LATER chunk (built is per-chunk).
      // Reuse the live card instead of building a duplicate that orphans the old one.
      const exist=msgEls.get(host.info.id);
      if(built.has(host.info.id)||exist){const he=exist||msgEls.get(host.info.id);if(he){msgEls.set(m.info.id,he);(he._tids||[]).forEach(id=>msgEls.set(id,he))}return}
      const vm=mergedTurnMsg(host);
      const el=buildMsg(vm);built.add(host.info.id);
      el._tids=vm._ids||[host.info.id];
      el._tids.forEach(id=>msgEls.set(id,el));
      fr.append(el);
    }else{const el=buildMsg(m);built.add(m.info.id);fr.append(el)}
  });
  const first=msgsEl.firstChild;
  if(first)msgsEl.insertBefore(fr,first);else msgsEl.append(fr);
  requestAnimationFrame(()=>{suppressScroll=true;msgsEl.scrollTop=prevTop+(msgsEl.scrollHeight-prevH);requestAnimationFrame(()=>{suppressScroll=false});loadingOlder=false});
  if(pendingHead.length===0)loadingOlder=false;
}
function showEmpty(){
  if(chatRoot)chatRoot.classList.add('is-empty');
  const wm=h('div',{class:'watermark-box'},O.wordmark('100%','auto'));
  const empty=h('div',{class:'empty'},wm);
  // (63) customizable home tiles on the empty chat screen
  if(O.buildHomeTiles)O.buildHomeTiles(empty);
  msgsEl.append(empty)}
// Skeleton placeholder while a session's messages are being fetched.
O.chatSkeleton=()=>{
  if(!msgsEl)return;
  const old=msgsEl.querySelector('.chat-skeleton');if(old)old.remove();
  const sk=h('div',{class:'chat-skeleton',style:{padding:'8px 4px'}},
    h('div',{class:'skeleton',style:{height:'54px',width:'70%',marginLeft:'auto',marginBottom:'14px'}}),
    h('div',{class:'skeleton',style:{height:'18px',width:'88%',marginBottom:'8px'}}),
    h('div',{class:'skeleton',style:{height:'18px',width:'64%',marginBottom:'8px'}}),
    h('div',{class:'skeleton',style:{height:'90px',width:'100%',marginBottom:'14px'}}),
    h('div',{class:'skeleton',style:{height:'18px',width:'76%'}}));
  msgsEl.append(sk);
};
O.chatSkeletonOff=()=>{const sk=msgsEl&&msgsEl.querySelector('.chat-skeleton');if(sk)sk.remove()};
function flushPartTimers(){
  for(const el of partEls.values()){if(el._tt){clearTimeout(el._tt);el._tt=null;if(el._p)fillTool(el,el._p)}}
}
function ensureMsg(m){
  const rv=revisionKey();if(rv&&m.info.id>=rv)return;
  // Invisible transport messages (Continue / Regenerate prompts) get no card at all.
  if(!m.parts.some(p=>showPart(m,p))&&!m.info.error)return;
  // TURN MERGE: consecutive assistant messages of one turn render as ONE card with ONE pack.
  // The server emits a new assistant message per tool round; the user must not see 5 cards.
  if(m.info.role==='assistant'&&toolView()!=='cards'){
    const host=turnHost(m);
    if(host&&host.info.id!==m.info.id){
      let hel=msgEls.get(host.info.id);
      if(!hel){ensureMsg(host);hel=msgEls.get(host.info.id)}
      if(hel){
        const vm=mergedTurnMsg(host);
        const sig=msgSig(vm);
        if(hel._sig!==sig){
          hel._sig=sig;
          const run=()=>{syncGrouped(hel,vm);metaUpdate(hel,vm);msgPlaceholder(hel,vm)};
          if(stick)run();else keepAnchor(run);
        }
        msgEls.set(m.info.id,hel); // alias: events about this message update the shared card
        return;
      }
    }
  }
  let el=msgEls.get(m.info.id);
  if(!el){const e=msgsEl.querySelector('.empty');if(e)e.remove();if(chatRoot)chatRoot.classList.remove('is-empty');
    const bm=(m.info.role==='assistant'&&toolView()!=='cards')?mergedTurnMsg(turnHost(m)):m;
    el=buildMsg(bm);
    if(bm._ids)bm._ids.forEach(id=>msgEls.set(id,el));
    let before=null;for(const c of msgsEl.children){if(c.dataset.id&&c.dataset.id>m.info.id){before=c;break}}
    if(stick)msgsEl.insertBefore(el,before);
    else keepAnchor(()=>msgsEl.insertBefore(el,before));
    return}
  // PERF: an event about a message whose content did not change must not touch the DOM at all.
  // msgSig covers every visible field; unchanged → zero work (this was the >1s tap lag: every SSE
  // status tick re-rendered every visible message, rebuilt metas and re-ran markdown).
  // FIX (audit #1): the HOST of a merged turn must sync as the WHOLE turn — syncing the raw host
  // message wiped every later round from the shared card (idle handler hit this path).
  const vm=(m.info.role==='assistant'&&toolView()!=='cards')?mergedTurnMsg(turnHost(m)):m;
  const sig=msgSig(vm);
  if(el._sig===sig)return;
  el._sig=sig;
  // Updating a message above the viewport must not move what the user is reading.
  if(stick){syncParts(el,vm);metaUpdate(el,vm);msgPlaceholder(el,vm)}
  else keepAnchor(()=>{syncParts(el,vm);metaUpdate(el,vm);msgPlaceholder(el,vm)})}
// First assistant message of the turn this message belongs to (scans back to the user prompt).
function turnHost(m){
  const list=O.msgs(m.info.sessionID).list;
  const idx=list.findIndex(x=>x.info.id===m.info.id);
  if(idx<0)return m;
  let host=m;
  for(let i=idx-1;i>=0;i--){
    const x=list[i];
    if(x.info.role==='user')break;
    if(x.info.role==='assistant')host=x;
  }
  return host;
}
// Virtual message: host info + parts of ALL assistant messages of the turn, in order.
function mergedTurnMsg(host){
  const list=O.msgs(host.info.sessionID).list;
  const idx=list.findIndex(x=>x.info.id===host.info.id);
  if(idx<0)return host;
  const parts=[];let last=host;
  for(let i=idx;i<list.length;i++){
    const x=list[i];
    if(x.info.role!=='assistant')break;
    parts.push(...x.parts);last=x;
  }
  if(parts.length===host.parts.length)return host;
  // meta reflects the whole turn: last message's completion/tokens summed across the turn
  let tokIn=0,tokOut=0,cost=0;
  for(let i=idx;i<list.length;i++){
    const x=list[i];if(x.info.role!=='assistant')break;
    if(x.info.tokens){tokIn+=x.info.tokens.input||0;tokOut+=x.info.tokens.output||0}
    if(typeof x.info.cost==='number')cost+=x.info.cost;
  }
  const info=Object.assign({},host.info,{
    time:{created:host.info.time&&host.info.time.created,completed:last.info.time&&last.info.time.completed},
    tokens:{input:tokIn,output:tokOut},cost,error:last.info.error||host.info.error,
    modelID:last.info.modelID||host.info.modelID
  });
  return{info,parts,_merged:true,_ids:list.slice(idx).filter(x=>x.info.role==='assistant').map(x=>x.info.id)};
}
function msgSig(m){
  const i=m.info;
  let s=i.role+'|'+(i.time&&i.time.completed||0)+'|'+(i.time&&i.time.end||0)+'|'+(i.error?i.error.name||'err':'')+'|'+(i.modelID||'')+'|'+(i.tokens&&(i.tokens.input||0)+(i.tokens.output||0)||0)+'|'+(i.cost||0);
  // FIX (audit #6): same-length text edits and tool input/error changes were invisible to the
  // signature — a cheap tail hash catches them without hashing the whole answer.
  const tail=t=>{t=String(t||'');let x=t.length;for(let k=Math.max(0,t.length-48);k<t.length;k++)x=(x*31+t.charCodeAt(k))|0;return x};
  for(const p of m.parts){
    if(p.type==='text'||p.type==='reasoning'){const t=String(p.text||p.reasoning||'');s+='|'+p.id+':'+t.length+':'+tail(t)+':'+(p.time&&p.time.end?1:0)}
    else if(p.type==='tool'){const st=p.state||{};s+='|'+p.id+':'+(st.status||'')+':'+String(st.output!=null?st.output:'').length+':'+((st.metadata&&st.metadata.diff)||'').length+':'+(st.input?JSON.stringify(st.input).length:0)+':'+(st.error?String(st.error).length:0)}
    else s+='|'+p.id+':'+p.type;
  }
  return s;
}
function buildMsg(m){
  const el=h('div',{class:'msg '+m.info.role,'data-id':m.info.id},h('div',{class:'m-body'}),h('div',{class:'m-meta'}));
  el._sig=msgSig(m);
  O.longPress(el,()=>{if(O.native.haptic)O.native.haptic('tick');msgMenu(m)},520);
  msgEls.set(m.info.id,el);syncParts(el,m);metaUpdate(el,m);msgPlaceholder(el,m);return el}
// An assistant message whose parts are all hidden (synthetic prompt, no answer yet) rendered as a
// blank card. Show an explicit state instead: working spinner, or "no visible content".
function msgPlaceholder(el,m){
  const old=el.firstChild.querySelector('.msg-placeholder');
  if(m.info.role!=='assistant'){if(old)old.remove();return}
  if(m.parts.some(p=>showPart(m,p))||m.info.error){if(old)old.remove();return}
  const st=S.status[m.info.sessionID];
  const working=(st&&st.type!=='idle')||m.parts.some(p=>p.type==='tool'&&p.state&&(p.state.status==='running'||p.state.status==='pending'));
  if(old&&old._w===working)return;
  if(old)old.remove();
  const ph=h('div',{class:'msg-placeholder mut s'},
    working?h('span',{class:'spin'}):O.icon('info'),
    working?O.tr('Working — no visible output yet','Работает — видимого ответа пока нет'):O.tr('No visible content in this message','В этом сообщении нет видимого содержимого'));
  ph._w=working;
  el.firstChild.append(ph);
}
function showPart(m,p){
  if(m.info.role==='user')return(p.type==='text'&&!p.synthetic&&!p.ignored)||p.type==='file'||p.type==='agent';
  switch(p.type){case'text':return typeof p.text==='string'&&(p.text.trim()!==''||!(p.time&&p.time.end));case'reasoning':{if(!S.opts.thinking)return false;const t=p.text||p.reasoning||p.thinking||'';return String(t).trim()!==''||!(p.time&&p.time.end)}case'tool':case'patch':case'retry':case'compaction':return true}return false}
// A text part that only carries the mandatory "+N -M" footer is not prose: it must not split a
// run of commands into two arrows.
const isStatsText=p=>p.type==='text'&&typeof p.text==='string'&&/^\s*[+]\d+\s+[-]\d+\s*$/.test(p.text);
// ---- turn grouping: one user prompt + ALL assistant messages until the next prompt = one turn.
// opencode splits a single answer into several assistant messages (one per tool round); the user
// sees them as separate cards. In pack modes the whole turn's tool activity lives under ONE arrow.
function turnOf(list){
  const turns=[];let t=null;
  for(const m of list){
    if(m.info.role==='user'){t={user:m,asst:[]};turns.push(t);continue}
    if(m.info.role==='assistant'){if(!t){t={user:null,asst:[]};turns.push(t)}t.asst.push(m)}
  }
  return turns;
}
const hasTools=m=>m.parts.some(p=>GROUPABLE(p));
const hasProse=m=>m.parts.some(p=>showPart(m,p)&&isProse(p));
function syncParts(el,m){
  if(m.info.role==='assistant'&&toolView()!=='cards'){syncGrouped(el,m);return}
  const body=el.firstChild;const keep=new Set();let prev=null;
  const olds=[...body.querySelectorAll('.cmd-group')];
  olds.forEach(g=>{(g._kids||[]).forEach(pe=>{if(pe.parentNode===g)body.insertBefore(pe,g)});g.remove()});
  for(const p of m.parts){if(!showPart(m,p))continue;keep.add(p.id);
    let pe=partEls.get(p.id);const fresh=!pe;
    if(fresh){pe=h('div',{class:'part','data-pid':p.id});partEls.set(p.id,pe)}
    const want=prev?prev.nextSibling:body.firstChild;
    if(pe.parentNode!==body||want!==pe)body.insertBefore(pe,want);
    fillPart(pe,p,m,fresh);prev=pe}
  for(const c of [...body.children]){if(!keep.has(c.dataset.pid)){partEls.delete(c.dataset.pid);c.remove()}}
  collapseErrors(body)}
// ---- inline command groups: Claude-style one-button packs woven into the answer text ----
// text → [↓ pack of tools] → text → [↓ next pack] → conclusion. Every pack gets an auto outline
// (what it was for), live progress while running, and per-tool cards inside.
const openGroups=new Set(),manualGroups=new Set();
function toolView(){
  const v=S.opts.toolView||(S.opts.details===false?'cards':'fold');
  return v==='cards'?'cards':v==='auto'?'auto':'fold';
}
O.toolView=toolView;
const GROUPABLE=p=>p.type==='tool'||p.type==='patch'||p.type==='retry';
// ONLY plain visible prose splits command packs. Reasoning, hidden parts, empty streaming text,
// stats footers and system markers all live INSIDE the pack: consecutive commands = one arrow.
const isProse=p=>p.type==='text'&&typeof p.text==='string'&&p.text.trim()!==''&&!isStatsText(p);
function grpKey(m,parts){return m.info.id+'#'+parts[0].id}
function groupOutline(parts){
  const counts={},files=new Set();let edits=0,run=0,err=0,desc='',cmd='';
  for(const p of parts){
    if(p.type==='patch'){edits++;(p.files||[]).forEach(f=>files.add(O.basename(f.file||f.path||f.filename||'')));continue}
    if(p.type==='retry')continue;
    const st=p.state||{},i=st.input||{};
    counts[p.tool]=(counts[p.tool]||0)+1;
    if(st.status==='running'||st.status==='pending')run++;
    if(st.status==='error')err++;
    if(p.tool==='edit'||p.tool==='write'||p.tool==='patch'||p.tool==='apply_patch'){edits++;if(i.filePath)files.add(O.basename(i.filePath))}
    if(p.tool==='bash'){if(!desc&&i.description)desc=String(i.description);if(!cmd)cmd=String(i.command||'').split('\n')[0]}
    if(p.tool==='task'&&!desc&&i.description)desc=String(i.description);
  }
  let title=desc;
  if(!title){
    const seg=[];
    const push=(n,one,many)=>{if(n)seg.push(n+' '+(n===1?one:many))};
    push(counts.bash,'команда','команд');
    push((counts.read||0)+(counts.list||0)+(counts.glob||0)+(counts.grep||0),'чтение','чтений');
    push(edits,'правка','правок');
    push((counts.webfetch||0)+(counts.websearch||0)+(counts.codesearch||0),'запрос в сеть','запросов в сеть');
    push(counts.task,'субагент','субагентов');
    const known=['bash','read','list','glob','grep','edit','write','patch','apply_patch','webfetch','websearch','codesearch','task'];
    const other=Object.keys(counts).filter(k=>!known.includes(k)).reduce((a,k)=>a+counts[k],0);
    push(other,'инструмент','инструментов');
    title=seg.slice(0,3).join(' · ')||'Действия';
  }
  const sub=[...files].slice(0,2).join(', ')+([...files].length>2?' +'+([...files].length-2):'')||cmd.slice(0,80);
  return{title:title.slice(0,90),sub,run,err,edits};
}
function groupDiff(parts){
  let added=0,deleted=0;
  const eat=d=>String(d).split('\n').forEach(l=>{
    if(l.startsWith('+')&&!l.startsWith('+++'))added++;
    else if(l.startsWith('-')&&!l.startsWith('---'))deleted++});
  for(const p of parts){
    if(p.type==='patch'){
      (p.files||[]).forEach(f=>{if(typeof f.additions==='number')added+=f.additions;if(typeof f.deletions==='number')deleted+=f.deletions});
      if(p.diff)eat(p.diff);
    }
    if(p.type==='tool'&&p.state&&p.state.metadata&&p.state.metadata.diff)eat(p.state.metadata.diff);
  }
  return{added,deleted};
}
function groupDuration(parts){
  let s=Infinity,e=0;
  for(const p of parts){const t=p.state&&p.state.time;if(!t)continue;
    if(t.start)s=Math.min(s,t.start);if(t.end)e=Math.max(e,t.end)}
  if(!isFinite(s)||!e||e<=s)return'';
  const sec=(e-s)/1000;return sec<1?'':(sec<60?sec.toFixed(sec<10?1:0)+'s':Math.floor(sec/60)+'m '+Math.round(sec%60)+'s');
}
function syncGrouped(el,m){
  const body=el.firstChild;
  const olds=[...body.querySelectorAll('.cmd-group')];
  const oldMap=new Map(olds.map(g=>[g.dataset.gkey,g]));
  const used=new Set();
  const seq=[];let run=[];
  const flush=()=>{if(run.length){seq.push({t:'g',parts:run});run=[]}};
  for(const p of m.parts){
    if(GROUPABLE(p)){run.push(p);continue}
    if(isStatsText(p))continue; // "+N -M" footer lives in the badge, never breaks a pack
    if(p.type==='reasoning'){
      // reasoning is NOT prose: it never splits consecutive commands. Visible thinking renders
      // inside the pack (or above it when no pack is open yet).
      if(!showPart(m,p))continue;
      if(run.length)run.push(p);else seq.push({t:'p',p});continue}
    if(!showPart(m,p))continue;
    if(!isProse(p)){
      // system markers / files / chips: glue inside a pack, standalone otherwise
      if(run.length)run.push(p);else seq.push({t:'p',p});continue}
    flush();
    seq.push({t:'p',p});
  }
  flush();
  let anchor=body.firstChild;
  const put=node=>{
    while(anchor&&(anchor.classList&&(anchor.classList.contains('errbox')||anchor.classList.contains('msg-diff-line')||anchor.classList.contains('msg-diff-badge')||anchor.classList.contains('msg-placeholder'))))anchor=anchor.nextSibling;
    if(anchor===node){anchor=node.nextSibling;return}
    body.insertBefore(node,anchor);
  };
  for(const it of seq){
    if(it.t==='p'){
      const p=it.p;let pe=partEls.get(p.id);const fresh=!pe;
      if(fresh){pe=h('div',{class:'part','data-pid':p.id});partEls.set(p.id,pe)}
      put(pe);fillPart(pe,p,m,fresh);
    }else{
      const parts=it.parts,key=grpKey(m,parts);
      let g=oldMap.get(key);
      if(!g||used.has(key)){
        g=h('div',{class:'part cmd-group','data-gkey':key});
        g._head=h('button',{class:'cg-head',onclick:()=>toggleGroup(g)});
        g._list=h('div',{class:'cg-list'});
        g.append(g._head,g._list);
      }
      used.add(key);g._parts=parts;g._mid=m.info.id;g._info=m.info;g._kids=[];
      const st0=S.status[m.info.sessionID];
      const busy0=!!st0&&st0.type!=='idle';
      const sig=parts.map(p=>{const st=p.state||{};
        return p.id+':'+(st.status||'')+':'+String(st.output!=null?st.output:'').length+':'+((st.metadata&&st.metadata.diff)||'').length}).join('|');
      if(sig!==g._sig){g._sig=sig;fillGroupHead(g,m)}
      const isOpen=openGroups.has(key);
      if(isOpen!==g._open){
        g._open=isOpen;
        g.classList.toggle('open',isOpen);
        if(isOpen)fillGroupList(g,m);
        else if(g._list.childNodes.length)g._list.textContent='';
      }else if(isOpen&&(sig!==g._listSig)){fillGroupList(g,m)}
      if(isOpen)g._listSig=sig;
      // auto mode: the pack being worked on right now stays open; when it settles, it folds away
      if(toolView()==='auto'&&!manualGroups.has(key)){
        const gs=[...body.querySelectorAll('.cmd-group')];
        const isLast=gs[gs.length-1]===g||!gs.includes(g);
        const running=parts.some(p=>p.state&&(p.state.status==='running'||p.state.status==='pending'));
        const want=running||(busy0&&isLast&&!(m.info.time&&m.info.time.completed));
        if(want!==isOpen){
          want?openGroups.add(key):openGroups.delete(key);
          g._open=want;g.classList.toggle('open',want);
          if(want){fillGroupList(g,m);g._listSig=sig}
          else g._list.textContent='';
        }
      }
      put(g);
    }
  }
  // FIX (audit #5): dropping a pack must purge partEls/timers of its dead children. A pack is
  // "dead" only when its key is not reused AND its host message no longer has a live card
  // (renderAll detaches everything but keeps msgEls aliases — those packs come right back).
  const liveIds=new Set(msgEls.keys());
  for(const g of olds){
    if(used.has(g.dataset.gkey))continue;
    if(g._mid&&liveIds.has(g._mid))continue; // rebuild in progress: state must survive
    g.querySelectorAll('[data-pid]').forEach(pe=>{const pid=pe.dataset.pid;
      if(pe.isConnected&&!g.contains(pe))return;
      partEls.delete(pid);dropTimer(pid);if(pe._tt){clearTimeout(pe._tt);pe._tt=null}});
    openGroups.delete(g.dataset.gkey);manualGroups.delete(g.dataset.gkey);
    g.remove()}
  const keepIds=new Set(seq.filter(x=>x.t==='p').map(x=>x.p.id));
  for(const c of [...body.children]){
    if(c.classList&&c.classList.contains('cmd-group'))continue;
    if(c.dataset.pid){if(!keepIds.has(c.dataset.pid)){partEls.delete(c.dataset.pid);c.remove()}continue}
    if(c.classList&&(c.classList.contains('errbox')||c.classList.contains('msg-diff-line')||c.classList.contains('msg-diff-badge')||c.classList.contains('msg-placeholder')))continue;
    c.remove();
  }
}
function toggleGroup(g){
  const key=g.dataset.gkey;
  manualGroups.add(key);
  const on=!openGroups.has(key);
  on?openGroups.add(key):openGroups.delete(key);
  g._open=on;g.classList.toggle('open',on);
  if(O.native.haptic)O.native.haptic('tick');
  const m=(g._info&&O.msgs(g._info.sessionID).idx.get(g._mid))||{parts:g._parts,info:g._info||{sessionID:S.sid}};
  if(on)fillGroupList(g,m);
  else g._list.textContent='';
}
function fillGroupHead(g,m){
  const parts=g._parts,o=groupOutline(parts),d=groupDiff(parts),dur=groupDuration(parts);
  const running=o.run>0;
  g.classList.toggle('running',running);
  g.classList.toggle('has-err',o.err>0&&!running);
  g._head.textContent='';
  const ic=running?h('span',{class:'spin'}):o.err?O.icon('alert','err'):O.icon('terminal','cg-ic');
  const meta=[];
  if(parts.length>1)meta.push(parts.length+' шт.');
  if(dur)meta.push(dur);
  // AI stage title (15): a human phrase instead of "3 commands · 2 reads" when available
  const ai=!running&&O.stageTitleFor?O.stageTitleFor(g.dataset.gkey,parts):null;
  g._head.append(ic,
    h('span',{class:'cg-titles'},h('b',{class:'cg-title'},ai||o.title),ai?h('span',{class:'cg-sub'},o.title+(o.sub?' · '+o.sub:'')):(o.sub?h('span',{class:'cg-sub'},o.sub):null)),
    o.err?h('span',{class:'cg-err'},o.err+' ош.'):null,
    (d.added||d.deleted)?h('span',{class:'cg-diff'},h('i',{class:'add'},'+'+d.added),h('i',{class:'del'},'-'+d.deleted)):null,
    meta.length?h('span',{class:'cg-meta'},meta.join(' · ')):null,
    O.icon('chevD','cg-chev'));
}
function fillGroupList(g,m){
  const list=g._list;
  const want=new Set(g._parts.map(p=>p.id));
  for(const c of [...list.children]){if(c.dataset.pid&&!want.has(c.dataset.pid))c.remove()}
  let outline=list.querySelector('.cg-outline');
  if(!outline){outline=h('div',{class:'cg-outline'});list.prepend(outline)}
  outline.textContent='';
  const files=new Map();
  let bashCnt=0,readCnt=0,taskCnt=0;
  for(const p of g._parts){
    const i=(p.state&&p.state.input)||{};
    if(p.type==='patch'){(p.files||[]).forEach(f=>{const fp=f.file||f.path||f.filename;if(fp)files.set(fp,'patch')});continue}
    if(p.tool==='bash')bashCnt++;
    if(p.tool==='read'||p.tool==='list'||p.tool==='glob'||p.tool==='grep')readCnt++;
    if(p.tool==='task')taskCnt++;
    if((p.tool==='edit'||p.tool==='write')&&i.filePath)files.set(i.filePath,p.tool);
  }
  const chips=[];
  if(bashCnt)chips.push(h('span',{class:'cg-chip'},O.icon('terminal'),bashCnt+' '+O.tr('commands','команд')));
  if(readCnt)chips.push(h('span',{class:'cg-chip'},O.icon('search'),readCnt+' '+O.tr('reads','чтений')));
  if(taskCnt)chips.push(h('span',{class:'cg-chip'},O.icon('bot'),taskCnt+' '+O.tr('subagents','субагентов')));
  [...files.entries()].slice(0,6).forEach(([fp,kind])=>chips.push(h('span',{class:'cg-chip file',title:fp},O.fileIcon(O.basename(fp)),O.basename(fp))));
  if(files.size>6)chips.push(h('span',{class:'cg-chip'},'+'+(files.size-6)));
  outline.append(h('span',{class:'cg-outline-t'},O.icon('list'),O.tr('Pack contents','Состав пачки')),chips.length?h('span',{class:'cg-chips'},chips):h('span',{class:'mut s'},O.tr('actions','действия')));
  let prev=outline;
  for(const p of g._parts){
    let pe=partEls.get(p.id);
    if(!pe){pe=h('div',{class:'part','data-pid':p.id});partEls.set(p.id,pe)}
    const wantPos=prev?prev.nextSibling:list.firstChild;
    if(pe.parentNode!==list||wantPos!==pe)list.insertBefore(pe,wantPos);
    fillPart(pe,p,m,false);
    if(pe.parentNode===list)g._kids.push(pe);
    prev=pe;
  }
  collapseErrors(list);
}
// Consecutive failed tool calls are noise; show them as one row with the count.
function collapseErrors(body){
  const olds=body.querySelectorAll('.tool-errors');
  olds.forEach(e=>e.remove());
  let run=[];
  const flush=()=>{
    if(run.length<3){run=[];return}
    const first=run[0];
    const row=h('button',{class:'part tool error tool-errors',onclick:()=>{
      const s2=O.sheet(O.tr('Failed tool calls','Неудачные вызовы'),h('div',null,run.map(p=>h('div',{style:{marginBottom:'10px'}},
        h('b',null,p.tool||''),h('pre',{class:'term-pre',style:{maxHeight:'180px'}},(p.state&&p.state.output)||(p.state&&p.state.error)||'')))),{full:true});
    }},O.icon('alert'),h('span',{class:'t'},run.length+' '+O.tr('failed calls','неудачных вызовов')),h('span',{class:'sub grow'},(first._p&&first._p.tool)||''));
    first.parentNode.insertBefore(row,first);
    run.forEach(el=>{el.style.display='none'});
    run=[];
  };
  for(const c of [...body.children]){
    const failed=c.classList&&c.classList.contains('tool')&&c.classList.contains('error');
    if(failed)run.push(c);else flush();
  }
  flush();
}
function fillPart(el,p,m,fresh){
  el._p=p;
  switch(p.type){
  case'text':
    if(m.info.role==='user'){el.className='part p-user';if(el._t!==p.text){el._t=p.text;el.textContent=p.text}}
    else{el.className='part p-text';if(fresh)render(el);else sched(p.id,()=>render(el))}break;
  case'reasoning':{el.className='part think';
    if(!el._d){
      el._d=h('details',null,h('summary',null,'Размышления'),h('div',{class:'p-text'}));
      // remember the user's manual open/close so re-renders never fight it
      el._d.addEventListener('toggle',()=>{if(el._d.open)manualParts.add(p.id);else manualParts.delete(p.id)});
      if(manualParts.has(p.id))el._d.open=true;
      el.append(el._d);
    }
    const b=el._d.lastChild;if(fresh)renderR(el,b);else sched(p.id,()=>renderR(el,b));break}
  case'tool':{const st=p.state||{};
    // A tool the USER opened stays open no matter what: status transitions and re-renders must
    // never collapse it (the old auto-collapse closed manually opened command output).
    if(manualParts.has(p.id)){/* user chose the open-state; never touch it */}
    else if(st.status==='running'&&p.tool==='bash'&&!el._auto){el._auto=1;open.add(p.id)}
    else if(st.status!=='running'&&el._auto===1){el._auto=2;open.delete(p.id)}
    // A finished tool collapses itself: long chats used to stay full of expanded command output.
    // Errors and diffs stay open because they are what the user actually wants to read.
    else if((st.status==='completed')&&el._auto!==3){
      el._auto=3;
      if(open.has(p.id)&&!getMsgDiff(m).found)open.delete(p.id);
    }
    // output streams too: throttle it so a chatty bash command cannot monopolise the main thread
    const running=st.status==='running'||st.status==='pending';
    if(fresh)fillTool(el,p);
    else if(running){if(!el._tt)el._tt=setTimeout(()=>{
      el._tt=null;
      if(stick){fillTool(el,el._p);scrollEnd()}
      else keepAnchor(()=>fillTool(el,el._p));
    },O.fastMode&&O.fastMode()?70:140)}
    else fillTool(el,p);
    break}
  case'file':{
    const mime=String(p.mime||''),url=p.url||'';
    const isImg=mime.startsWith('image/'),isVid=mime.startsWith('video/'),isAud=mime.startsWith('audio/');
    el.className='part fchips'+(isVid?' vid':isAud?' aud':'');
    el.textContent='';
    if(isImg&&url){
      // data: URLs of attachments can be megabytes each; they live in state and IndexedDB.
      // Old messages keep only a light marker after the first render to bound memory use.
      if(url.startsWith('data:')&&!fresh&&el._img)return;
      el._img=true;
      el.append(h('img',{class:'thumb',src:url,loading:'lazy'}));
    }else if(isVid&&url){
      if(!fresh&&el._media)return;
      el._media=true;
      el.append(h('video',{class:'thumb-video',src:url,controls:true,preload:'metadata'}));
    }else if(isAud&&url){
      if(!fresh&&el._media)return;
      el._media=true;
      el.append(h('audio',{class:'thumb-audio',src:url,controls:true,preload:'metadata'}));
    }else if(url&&/^https:\/\//.test(url)&&/\.(png|jpe?g|webp|gif|mp4|webm|mp3|wav|m4a|ogg)$/i.test(url)){
      // Attachments whose mime is missing but the URL looks like media (older sessions).
      if(!fresh&&el._media)return;
      el._media=true;
      el.append(/mp4|webm/i.test(url)
        ?h('video',{class:'thumb-video',src:url,controls:true,preload:'metadata'})
        :h('img',{class:'thumb',src:url,loading:'lazy'}));
    }else{
      el.append(h('span',{class:'chip'},O.fileIcon(p.filename||'file'),h('span',null,p.filename||'file')));
    }
    break}
  case'agent':el.className='part fchips';el.textContent='';el.append(h('span',{class:'chip'},O.icon('bot'),h('span',null,'@'+p.name)));break;
  case'patch':el.className='part';el.textContent='';el.append(h('span',{class:'chip'},O.icon('edit'),h('span',null,'Изменено файлов: '+((p.files||[]).length))));break;
  case'retry':el.className='part warn s';el.textContent='Повтор: '+((p.error&&p.error.data&&p.error.data.message)||'запрос не удался');break;
  case'compaction':el.className='part sep';el.textContent='Контекст сжат';break}}
function getMsgDiff(m){
  let added=0,deleted=0,found=false;
  for(const p of m.parts){
    if(p.type==='patch'){
      found=true;
      if(Array.isArray(p.files)){
        p.files.forEach(f=>{
          if(typeof f.additions==='number')added+=f.additions;
          if(typeof f.deletions==='number')deleted+=f.deletions;
        });
      }
      if(p.diff){
        String(p.diff).split('\n').forEach(l=>{
          if(l.startsWith('+')&&!l.startsWith('+++'))added++;
          else if(l.startsWith('-')&&!l.startsWith('---'))deleted++;
        });
      }
    }
    const tmd=p.type==='tool'&&p.state&&p.state.metadata;
    if(tmd&&tmd.diff){
      found=true;
      String(tmd.diff).split('\n').forEach(l=>{
        if(l.startsWith('+')&&!l.startsWith('+++'))added++;
        else if(l.startsWith('-')&&!l.startsWith('---'))deleted++;
      });
    }
    if(p.type==='text'&&p.text){
      const mMatch=p.text.match(/(?:^|\n)\s*([+]\d+)\s+([-]\d+)\s*(?:$|\n)/);
      if(mMatch){
        if(added===0&&deleted===0){
          added=parseInt(mMatch[1].replace('+',''),10)||0;
          deleted=parseInt(mMatch[2].replace('-',''),10)||0;
          if(added>0||deleted>0)found=true;
        }
      }
    }
  }
  return{added,deleted,found};
}

function render(el){
  const p=el._p;if(el._t===p.text)return;el._t=p.text;
  let cleanText=p.text||'';
  // Strip trailing "+N -M" line from text so it is not duplicated above the badge!
  cleanText=cleanText.replace(/(?:\r?\n)+\s*[+]\d+\s+[-]\d+\s*$/g,'');
  // Streaming parts render on a short cadence; the completed message is rendered once, exactly.
  const done=!!(p.time&&p.time.end);
  O.mdInto(el,cleanText,{final:done});
  // Live typing cursor (01): a glowing caret at the end of the streaming answer.
  if(!done&&O.chatAnim&&O.chatAnim()){
    const last=el.lastElementChild;
    if(last&&!last.querySelector('.type-caret'))last.append(h('span',{class:'type-caret'}));
  }
  if(O.initCustomWidgets&&!el.classList.contains('streaming'))O.initCustomWidgets(el);
}
function renderR(el,b){const p=el._p;const t=p.text||p.reasoning||p.thinking||'';if(b._t===t)return;b._t=t;
  const run=!(p.time&&p.time.end);
  // Live reasoning (38): while thinking, the block opens itself and streams; folds when done.
  O.mdInto(b,t,{final:!run});
  el._d.firstChild.textContent=run?'Думает…':'Размышления';
  el.classList.toggle('thinking-live',run);
  if(run&&!manualParts.has(p.id)){el._d.open=true;el._autoOpen=true}
  else if(!run&&el._autoOpen&&!manualParts.has(p.id)){el._d.open=false;el._autoOpen=false}}
function sched(id,fn){if(timers.has(id))return;timers.set(id,setTimeout(()=>{
  timers.delete(id);
  if(stick){fn();scrollEnd()}
  else keepAnchor(fn);   // reading above: re-render without moving the viewport
},O.fastMode&&O.fastMode()?45:100))}
function dropTimer(id){const t=timers.get(id);if(t){clearTimeout(t);timers.delete(id)}}

function msgActions(m){
  const bar=h('span',{class:'msg-actions'});
  const txt=()=>msgText(m);
  const ib=(icon,title,fn)=>h('button',{class:'ibtn s',title,onclick:e=>{e.stopPropagation();fn()}},O.icon(icon));
  if(m.info.role==='assistant'){
    bar.append(ib('copy',O.tr('Copy answer','Копировать ответ'),()=>O.native.copy(txt())));
    bar.append(ib('refresh',O.tr('Regenerate','Перегенерировать'),()=>O.regenerateFrom&&O.regenerateFrom(m)));
    bar.append(ib('branch',O.tr('Second opinion (another model)','Второе мнение (другая модель)'),()=>O.secondOpinion&&O.secondOpinion(m)));
    bar.append(ib('zap',O.tr('Duel: compare two models side by side','Дуэль: сравнить две модели бок о бок'),()=>{
      const list=O.visibleMsgs(m.info.sessionID||S.sid);
      const idx=list.findIndex(x=>x.info.id===m.info.id);
      let user=null;for(let i=idx-1;i>=0;i--)if(list[i].info.role==='user'){user=list[i];break}
      O.openDuel&&O.openDuel(user?msgText(user):'');
    }));
    bar.append(ib('share',O.tr('Share','Поделиться'),()=>O.native.share(txt())));
  }else{
    bar.append(ib('copy',O.tr('Copy','Копировать'),()=>O.native.copy(txt())));
    bar.append(ib('edit',O.tr('Edit & resend','Изменить и отправить'),()=>{O.insertText(txt())}));
    bar.append(ib('at',O.tr('Quote in prompt','Цитировать в запросе'),()=>{O.insertText('> '+txt().split('\n').join('\n> ')+'\n\n')}));
  }
  return bar;
}
// Regenerate: revert to this assistant message and resend the preceding user prompt.
O.regenerateFrom=async m=>{
  const sid=m.info.sessionID||S.sid;
  const list=O.visibleMsgs(sid);
  const idx=list.findIndex(x=>x.info.id===m.info.id);
  let user=null;
  for(let i=idx-1;i>=0;i--)if(list[i].info.role==='user'){user=list[i];break}
  if(!user)return O.toast(O.tr('No prompt to repeat','Нет запроса для повтора'),2500);
  const text=msgText(user);
  try{await api('POST','/session/'+sid+'/revert',{messageID:m.info.id})}catch(_){}
  // Regenerate: no visible repeat of the user's own prompt — resend it as a synthetic part.
  if(O.resendSynthetic)return O.resendSynthetic(sid,text);
  O.chatSendText(text);
};
// Re-sends a prompt as a HIDDEN transport message (no user bubble in the transcript).
O.resendSynthetic=async(sid,text)=>{
  sid=sid||S.sid;
  if(!sid||!S.model)return O.toast(O.tr('Select a model first','Сначала выберите модель'),2500);
  const mid=O.mid();
  const m=O.upsertMsg({id:mid,sessionID:sid,role:'user',time:{created:Date.now()},agent:S.agent,model:S.model});
  m.local=true;m.synthetic=true;
  m.parts=[{id:'prt_local_res'+mid,sessionID:sid,messageID:mid,type:'text',text:String(text||''),synthetic:true}];
  try{
    await api('POST','/session/'+sid+'/prompt_async',{messageID:mid,agent:S.agent,model:S.model,variant:S.variant||undefined,parts:m.parts},{timeout:60000});
    bus.emit('msg',sid,m);
    O.toast(O.tr('Regenerating…','Перегенерирую…'),1600);
  }catch(e){O.toast(e.message||String(e),4000)}
};
// Second opinion: same question to a different model in a throwaway session, shown side-by-side.
O.secondOpinion=async m=>{
  const sid=m.info.sessionID||S.sid;
  const list=O.visibleMsgs(sid);
  const idx=list.findIndex(x=>x.info.id===m.info.id);
  let user=null;
  for(let i=idx-1;i>=0;i--)if(list[i].info.role==='user'){user=list[i];break}
  if(!user)return O.toast(O.tr('No question found','Вопрос не найден'),2500);
  const cur=S.model?S.model.providerID+'/'+S.model.modelID:'';
  const others=O.allModels().filter(x=>!O.isModelHidden(x.pid+'/'+x.mid)&&(x.pid+'/'+x.mid)!==cur);
  if(!others.length)return O.toast(O.tr('No other models','Других моделей нет'),2500);
  O.actions(O.tr('Second opinion — pick a model','Второе мнение — выберите модель'),others.slice(0,12).map(x=>({
    label:x.name||x.mid,sub:x.pid,icon:'cpu',fn:async()=>{
      const body=h('div');
      const s2=O.sheet(O.tr('Second opinion: ','Второе мнение: ')+(x.name||x.mid),body,{full:true});
      body.append(h('div',{class:'note'},O.tr('Original answer','Исходный ответ')),h('div',{class:'card',style:{padding:'10px',whiteSpace:'pre-wrap',fontSize:'13px',maxHeight:'30vh',overflow:'auto'}},msgText(m)));
      const out=h('div',{class:'card',style:{padding:'10px',whiteSpace:'pre-wrap',fontSize:'13px',marginTop:'8px'}},O.tr('Asking…','Спрашиваю…'));
      body.append(h('div',{class:'note',style:{marginTop:'8px'}},O.tr('New answer','Новый ответ')),out);
      try{
        const ses=await api('POST','/session',{title:'Opinion · '+x.mid});
        try{if(window.OC&&OC.silentSession)OC.silentSession(ses.id)}catch(_){}
        await api('POST','/session/'+ses.id+'/prompt_async',{messageID:O.mid(),agent:S.agent,model:{providerID:x.pid,modelID:x.mid},parts:[{type:'text',text:msgText(user)}]},{timeout:30000});
        const deadline=Date.now()+180000;
        while(Date.now()<deadline){
          await new Promise(r=>setTimeout(r,1500));
          const st=await api('GET','/session/status',null,{timeout:5000}).catch(()=>null);
          const t0=st&&st[ses.id],t=typeof t0==='string'?t0:(t0&&t0.type);
          if(!t||t==='idle'||t==='error')break;
        }
        const arr=await api('GET','/session/'+ses.id+'/message',null,{timeout:20000});
        let txt='';for(const mm of arr||[])if(mm.info&&mm.info.role==='assistant'){const t2=(mm.parts||[]).filter(p=>p.type==='text').map(p=>p.text).join('\n');if(t2.trim())txt=t2}
        out.textContent=txt||O.tr('(no answer)','(нет ответа)');
        try{await api('DELETE','/session/'+ses.id)}catch(_){}
      }catch(e){out.textContent=e.message||String(e)}
    }
  })));
};
function metaUpdate(el,m){
  const meta=el.lastChild;const i=m.info;
  // PERF: rebuilding meta (tokens, actions, diff badge) on every delta burned main-thread time.
  const msig=i.role+'|'+(i.time&&i.time.completed||0)+'|'+(i.tokens&&(i.tokens.input||0)+(i.tokens.output||0)||0)+'|'+(i.cost||0)+'|'+(i.error?i.error.name||'e':'')+'|'+(i.modelID||'');
  const partsSig=m.parts.map(p=>p.type==='patch'?'P'+((p.files||[]).length):p.type==='tool'&&p.state&&p.state.metadata&&p.state.metadata.diff?'D'+p.state.metadata.diff.length:'').join('');
  if(el._msig===msig+'|'+partsSig)return;
  el._msig=msig+'|'+partsSig;
  meta.textContent='';
  if(i.role==='user'){meta.append(h('span',null,i.time&&i.time.created?(O.mmFmtClock?O.mmFmtClock(i.time.created):new Date(i.time.created).toTimeString().slice(0,8)):''));meta.append(msgActions(m));return}
  if(i.role==='assistant'){
    const t=[];if(i.modelID)t.push(i.modelID);
    if(i.time&&i.time.completed&&i.time.created)t.push(((i.time.completed-i.time.created)/1000).toFixed(1)+'s');
    if(i.tokens&&(i.tokens.output||i.tokens.input))t.push(O.fmtK((i.tokens.input||0)+(i.tokens.output||0))+' tok');
    if(i.tokens&&(i.tokens.output||i.tokens.input)&&O.checkTokenWarning)O.checkTokenWarning(i.sessionID);
    if(i.cost)t.push('$'+i.cost.toFixed(4));
    // wall clock (hh:mm:ss, device time) right after tokens
    const done=i.time&&i.time.completed?i.time.completed:(i.time&&i.time.end?i.time.end:0);
    if(done)t.push(O.mmFmtClock?O.mmFmtClock(done):new Date(done).toTimeString().slice(0,8));
    meta.append(h('span',null,t.join('  ')));
    meta.append(msgActions(m));

    // Render diff stats line ONLY under messages that actually modified files (+N -M)
    const diffStat=getMsgDiff(m);
    const oldDiffLine=el.firstChild.querySelector('.msg-diff-line')||el.firstChild.querySelector('.msg-diff-badge');
    const hasDiff = (diffStat.added > 0 || diffStat.deleted > 0);
    if(hasDiff){
      const badge=h('div',{
        class:'msg-diff-line',
        title:O.tr('View code changes in project','Посмотреть изменения кода в проекте'),
        onclick:()=>{
          // show only the files touched by this message, with their diffs
          const files=[];
          for(const p of m.parts){
            if(p.type==='patch'&&Array.isArray(p.files))p.files.forEach(f=>files.push(f));
            if(p.type==='tool'&&p.state&&p.state.metadata&&p.state.metadata.diff)files.push({file:(p.state.input&&(p.state.input.filePath||p.state.input.path))||'',diff:p.state.metadata.diff});
          }
          if(!files.length){O.setTab('changes');return}
          const body=h('div');
          const s2=O.sheet(O.tr('Changes in this message','Изменения в этом сообщении'),body,{full:true});
          files.forEach(f=>{
            const path=f.file||f.path||f.filename||'';
            body.append(h('div',{class:'grp'},O.basename(path)||path));
            if(f.diff||f.patch)body.append(O.unifiedEl(f.diff||f.patch));
            else if(typeof f.before==='string'||typeof f.after==='string')body.append(O.diffEl(O.diffOps(f.before||'',f.after||''),3));
            else body.append(h('div',{class:'mut s',style:{padding:'6px 2px'}},'+'+(f.additions||0)+' / -'+(f.deletions||0)));
          });
        }
      },
      h('span',{class:'diff-stat-val add'},'+'+diffStat.added),
      h('span',{style:{color:'#52525b'}},' '),
      h('span',{class:'diff-stat-val del'},'-'+diffStat.deleted));
      if(oldDiffLine)oldDiffLine.replaceWith(badge);
      else el.firstChild.append(badge);
    }else if(oldDiffLine){
      oldDiffLine.remove();
    }

    if(i.error&&i.error.name!=='MessageAbortedError'){const old=el.firstChild.querySelector('.errbox');if(old)old.remove();
      let em=(i.error.data&&i.error.data.message)||i.error.name||'Ошибка';
      const kind=O.errorKind(i.error,em);
      if(kind==='quota'){
        em+='\n\n'+quotaHint();
        O.notifyLimit(O.tr('Limit Reached','Лимит исчерпан'),O.tr('Free quota limit reached.','Бесплатные лимиты закончились.'));
        O.showQuotaAccountModal(em);
      }
      // Classified error: the message says what to do, not just what failed.
      const fix={
        quota:{label:O.tr('Switch model or key','Сменить модель или ключ'),fn:()=>O.openModels()},
        auth:{label:O.tr('Fix API key','Исправить API-ключ'),fn:()=>O.openConnect()},
        model:{label:O.tr('Choose another model','Выбрать другую модель'),fn:()=>O.openModels()},
        network:{label:O.tr('Check connection','Проверить подключение'),fn:()=>O.runDiagnostics&&O.runDiagnostics()},
        context:{label:O.tr('Compact the session','Сжать сессию'),fn:()=>doCompact()},
        'output-length':{label:O.tr('Continue generation','Продолжить генерацию'),fn:()=>O.continueGeneration()},
      }[kind];
      if(O.logError)O.logError(kind,em);
      el.firstChild.append(h('div',{class:'errbox'},em,
        h('div',{style:{display:'flex',gap:'6px',marginTop:'8px',flexWrap:'wrap'}},
          fix?h('button',{class:'btn sm pri',onclick:fix.fn},O.icon('zap'),fix.label):null,
          h('button',{class:'btn sm',onclick:()=>O.diagnoseError&&O.diagnoseError(em)},O.icon('bug'),O.tr('Why did it break?','Почему сломалось?'))))) }
    else if(i.error)meta.append(h('span',{class:'warn'},'прервано'))}
  meta.append(h('span',{class:'grow'}),h('button',{class:'ibtn s',title:O.tr('More actions','Все действия'),onclick:()=>msgMenu(m)},O.icon('dots')))}
function msgText(m){return m.parts.filter(p=>p.type==='text'&&!p.synthetic).map(p=>p.text).join('\n')}
O.msgPlainText=msgText;
function msgMenu(m){O.actions(m.info.role==='user'?'Сообщение':'Ответ',[
  {label:'Копировать текст',icon:'copy',fn:()=>O.native.copy(msgText(m))},
  {label:'Экспорт сессии в Markdown',icon:'doc',fn:()=>exportSessionMd()},
  {label:O.tr('Export session (JSON)','Экспорт сессии (JSON)'),icon:'down',fn:()=>{if(!S.sid)return;const json=O.exportSessionJson(S.sid);O.actions(O.tr('Export session (JSON)','Экспорт сессии (JSON)'),[
    {label:O.tr('Copy JSON','Скопировать JSON'),icon:'copy',fn:()=>O.native.copy(json)},
    {label:O.tr('Share','Поделиться'),icon:'share',fn:()=>{if(O.native&&O.native.share)O.native.share(json);else O.native.copy(json)}}])}},
  m.info.role==='user'?{label:'Отменить отсюда',sub:'Откатить это сообщение и всё после него',icon:'undo',fn:()=>revertTo(m)}:null,
  m.info.role==='assistant'?{label:O.tr('Continue generation','Продолжить генерацию'),sub:O.tr('Resume from where it was cut','Продолжить с места обрыва'),icon:'play',fn:()=>O.continueGeneration()} : null,
  m.info.role==='assistant'?{label:O.tr('Edit prompt and retry','Изменить запрос и повторить'),sub:O.tr('Fixes a wrong instruction instead of regenerating blind','Правит неверную инструкцию вместо слепой перегенерации'),icon:'edit',fn:()=>editAndRetry(m)}:null,
  m.info.role==='assistant'?{label:O.tr('Regenerate (more focused)','Перегенерировать (суше)'),sub:O.tr('Same prompt, lower temperature','Тот же запрос, ниже температура'),icon:'refresh',fn:()=>regenerate(m,'focused')}:null,
  m.info.role==='assistant'?{label:O.tr('Regenerate (more creative)','Перегенерировать (смелее)'),sub:O.tr('Same prompt, higher temperature','Тот же запрос, выше температура'),icon:'bulb',fn:()=>regenerate(m,'creative')}:null,
  {label:'Форк сессии отсюда',sub:'Новая сессия со всей историей до этого места',icon:'branch',fn:()=>forkAt(m)},
  {label:O.tr('Branch from here','Ветка отсюда'),sub:O.tr('New branch keeps this history; the original stays untouched','Новая ветка сохраняет историю; исходная сессия не меняется'),icon:'branch',fn:()=>forkAt(m)},
  {label:O.tr('Restore files to this point','Откатить файлы к этому месту'),sub:O.tr('Project snapshots (checkpoints)','Точки восстановления проекта'),icon:'undo',fn:()=>O.openCheckpoints&&O.openCheckpoints()},
  {label:O.tr('New chat from this message','Новый чат с этого сообщения'),sub:O.tr('Fresh session, only this message as context','Новая сессия, только это сообщение как контекст'),icon:'plus',fn:()=>newChatFrom(m)}])}
async function newChatFrom(m){
  try{
    const text=msgText(m);
    const ses=await O.newSession();
    if(!ses)return;
    if(text){
      // seed the new session with the same model and a quoted copy of the message so the user can
      // keep typing below it without carrying the whole history over
      ta.value=text.slice(0,8000);
      onInput();
      O.toast(O.tr('Message copied into a new chat','Сообщение перенесено в новый чат'),2000);
    }
    O.setTab('chat');
  }catch(e){O.toast(e.message)}
}
function exportSessionMd(){
  if(!S.sid)return;
  const list=O.visibleMsgs(S.sid);
  if(!list.length)return O.toast('Сессия пуста');
  let out='# OpenCode Mobile — '+(S.sessions.find(x=>x.id===S.sid)?.title||'Сессия')+'\n\n';
  list.forEach(m=>{
    out+=(m.info.role==='user'?'### Пользователь':'### Ассистент')+'\n\n';
    m.parts.forEach(p=>{
      if(p.type==='text'&&p.text)out+=p.text+'\n\n';
      else if(p.type==='reasoning'&&(p.text||p.reasoning))out+='> *Размышления:*\n> '+String(p.text||p.reasoning).split('\n').join('\n> ')+'\n\n';
      else if(p.type==='tool'&&p.state&&p.state.input)out+='```bash\n# Tool: '+(p.tool||'')+'\n'+JSON.stringify(p.state.input,null,2)+'\n```\n\n';
    });
  });
  O.actions('Экспорт сессии в Markdown',[
    {label:'Скопировать Markdown',icon:'copy',fn:()=>O.native.copy(out)},
    {label:'Поделиться файлом/текстом',icon:'share',fn:()=>{if(O.native&&O.native.share)O.native.share(out);else O.native.copy(out)}}]);
}
async function revertTo(m){try{await api('POST','/session/'+S.sid+'/revert',{messageID:m.info.id});if(m.info.role==='user'){ta.value=msgText(m);onInput()}}catch(e){O.toast(e.message)}}
// Re-runs the prompt that produced `m` with a nudged sampling temperature.
// The server has no per-request temperature override, so we steer it with an explicit instruction
// and always revert the turn first (the old answer is replaced, not duplicated).
async function regenerate(m,mode){
  try{
    // find the user message that triggered this answer
    const list=O.msgs(S.sid).list;
    const idx=list.findIndex(x=>x.info.id===m.info.id);
    let userMsg=null;
    for(let i=idx;i>=0;i--){if(list[i]&&list[i].info.role==='user'){userMsg=list[i];break}}
    const prompt=userMsg?msgText(userMsg):'';
    if(!prompt)return O.toast(O.tr('Prompt not found','Запрос не найден'),2500);
    await api('POST','/session/'+S.sid+'/revert',{messageID:m.info.id}).catch(()=>{});
    const steer=mode==='focused'
      ?'[Стиль: предельно кратко и по делу, без вступлений, только факты и код.]'
      :'[Стиль: смелее в решениях, предложи неочевидные варианты, но без воды.]';
    const mid=O.mid();
    // Regenerate must NOT post a visible user bubble: the whole payload is synthetic, so the
    // turn renders only as the new assistant answer (revert removed the old one).
    const parts=[
      {type:'text',text:steer,synthetic:true},
      {type:'text',text:prompt,synthetic:true}
    ];
    const lm=O.upsertMsg({id:mid,sessionID:S.sid,role:'user',time:{created:Date.now()},agent:S.agent,model:S.model});
    lm.local=true;lm.synthetic=true;
    lm.parts=parts.map((p,i)=>Object.assign({id:'prt_local_regen'+i,sessionID:S.sid,messageID:mid,synthetic:true},p));
    try{
      await api('POST','/session/'+S.sid+'/prompt_async',{messageID:mid,agent:S.agent,model:S.model,variant:S.variant||undefined,parts},{timeout:60000});
      bus.emit('msg',S.sid,lm);
    }catch(e2){O.toast(e2.message||String(e2),4000);return}
    O.toast(O.tr('Regenerating…','Перегенерирую…'),1800);
  }catch(e){O.toast(e.message||String(e),4000)}
}
// Opens the original user prompt for editing, reverts the turn, and sends the corrected version.
async function editAndRetry(m){
  const list=O.msgs(S.sid).list;
  const idx=list.findIndex(x=>x.info.id===m.info.id);
  let userMsg=null;
  for(let i=idx;i>=0;i--){if(list[i]&&list[i].info.role==='user'){userMsg=list[i];break}}
  const orig=userMsg?msgText(userMsg):'';
  if(!orig)return O.toast(O.tr('Prompt not found','Запрос не найден'),2500);
  const edited=await O.ask(O.tr('Edit prompt','Изменить запрос'),O.tr('Correct the instruction and send it again','Исправьте инструкцию и отправьте снова'),orig,true);
  if(edited==null||!edited.trim())return;
  try{await api('POST','/session/'+S.sid+'/revert',{messageID:userMsg.info.id})}catch(_){}
  setTimeout(()=>{if(O.chat&&O.chat.sendText)O.chat.sendText(edited.trim())},250);
}

async function forkAt(m){try{const s=await api('POST','/session/'+S.sid+'/fork',{messageID:m.info.id});if(O.noteFork)O.noteFork(s.id,S.sid);await O.loadSessions();await O.openSession(s.id)}catch(e){O.toast(e.message)}}

// ---- tools ----
function toolMeta(p){const st=p.state||{},i=st.input||{},r=O.rel;
  switch(p.tool){
  case'bash':return{ic:'terminal',t:i.description||'Команда',s:String(i.command||'').split('\n')[0]};
  case'read':{
    const out=st.output!=null?st.output:(st.metadata&&st.metadata.output);
    const lineCnt=out?String(out).split('\n').length:null;
    return{ic:'file',t:'Чтение',s:r(i.filePath)+(lineCnt?(' ('+lineCnt+' строк)'):'')};
  }
  case'edit':return{ic:'edit',t:'Правка',s:r(i.filePath)};
  case'write':return{ic:'edit',t:'Запись',s:r(i.filePath)};
  case'patch':case'apply_patch':return{ic:'edit',t:'Патч',s:''};
  case'glob':return{ic:'search',t:'Glob',s:i.pattern};
  case'grep':return{ic:'search',t:'Grep',s:i.pattern};
  case'list':return{ic:'folder',t:'Список',s:r(i.path||'.')};
  case'webfetch':return{ic:'globe',t:'Загрузка',s:i.url};
  case'websearch':case'codesearch':return{ic:'globe',t:'Поиск',s:i.query};
  case'task':return{ic:'bot',t:i.description||'Субагент',s:i.subagent_type};
  case'todowrite':case'todoread':return{ic:'list',t:'Задачи',s:(i.todos||[]).length?(i.todos.length+' шт.'):''};
  case'skill':return{ic:'bulb',t:'Навык',s:i.name};
  default:return{ic:'code',t:st.title||p.tool,s:''}}}
function toolBody(p){const st=p.state||{},i=st.input||{},md=st.metadata||{};
  const out=O.stripAnsi(st.output!=null?st.output:(md.output||''));const b=h('div');
  const pre=(t,c)=>h('pre',{class:c||'term-pre'},t);
  switch(p.tool){
  case'bash':b.append(pre('$ '+(i.command||'')+(out?'\n'+out:'')));if(md.exit!=null&&md.exit!==0)b.append(h('div',{class:'mut s'},'код '+md.exit));break;
  case'edit':if(typeof md.diff==='string'&&md.diff)b.append(O.unifiedEl(md.diff));else if(i.oldString!=null)b.append(O.diffEl(O.diffOps(String(i.oldString),String(i.newString||'')),2));break;
  case'write':b.append(pre(String(i.content||'').split('\n').slice(0,80).join('\n'),'code-pre'));break;
  case'read':b.append(pre(out.split('\n').slice(0,60).join('\n'),'code-pre'));break;
  case'todowrite':(i.todos||[]).forEach(t=>b.append(h('div',{class:'todo-i'+(t.status==='completed'?' done':'')},O.icon(t.status==='completed'?'check':'chevR'),t.content)));break;
  case'task':{const sid=md.sessionId||md.sessionID;const sub=i.subagent_type||i.subagent||'';
    if(sub)b.append(h('span',{class:'mm-role-tag',style:O.mmRoleColor?O.mmRoleColor(sub):''},O.icon('bot'),sub));
    if(i.prompt)b.append(h('div',{class:'mut s'},String(i.prompt).slice(0,500)));
    if(sid)b.append(h('button',{class:'btn sm',style:{marginTop:'8px'},onclick:()=>openChild(sid)},'Открыть сессию субагента'));if(out)b.append(pre(out.slice(0,3000),'code-pre'));break}
  default:if(Object.keys(i).length)b.append(pre(JSON.stringify(i,null,2).slice(0,3000),'code-pre'));if(out)b.append(pre(out.slice(0,6000),'code-pre'))}
  if(st.status==='error'&&st.error)b.append(h('div',{class:'errbox'},String(st.error)));return b}
function fillTool(el,p){const st=p.state||{},m=toolMeta(p),isOpen=open.has(p.id);
  el.className='part tool '+(st.status||'pending')+(isOpen?' open':'');el.textContent='';el._p=p;
  const stat=st.status==='running'||st.status==='pending'?h('span',{class:'spin'}):st.status==='error'?O.icon('alert','err'):O.icon('check','ok');
  // Tool headers always toggle: gating on the "details" setting made taps dead when it was off,
  // which looked like an empty, unresponsive card.
  el.append(h('button',{class:'tool-h',onclick:()=>{manualParts.add(p.id);el._auto=0;open.has(p.id)?open.delete(p.id):open.add(p.id);fillTool(el,el._p)}},
    O.icon(m.ic),h('span',{class:'t'},m.t||p.tool||O.tr('Tool','Инструмент')),h('span',{class:'sub grow'},m.s||''),stat,O.icon('chevR','chev')));
  if(isOpen)el.append(h('div',{class:'tool-b'},toolBody(p)))}
async function openChild(sid){try{if(!O.child(sid)){const s=await api('GET','/session/'+sid);(S.childSessions=S.childSessions||{})[sid]=s}}catch{}trail.push(S.sid);await O.openSession(sid);bus.emit('session')}
O.openChild=openChild;

// ---- banners / dock ----
function renderRevert(){const s=cur();revEl.textContent='';
  if(trail.length&&S.sid&&O.child(S.sid)){revEl.classList.remove('hide');revEl.append(h('div',{class:'card revert-banner',style:{display:'flex',alignItems:'center',gap:'10px'}},h('span',{class:'grow'},'Сессия субагента'),h('button',{class:'btn sm',onclick:()=>{const p=trail.pop();O.openSession(p)}},'Назад')));return}
  if(s&&s.revert){revEl.classList.remove('hide');revEl.append(h('div',{class:'card revert-banner',style:{display:'flex',alignItems:'center',gap:'10px'}},h('span',{class:'revert-icon'},O.icon('undo')),h('span',{class:'grow',style:{color:'#ffffff'}},'Изменения отменены'),h('button',{class:'btn sm',onclick:doRedo},O.icon('redo'),'Вернуть')))}
  else revEl.classList.add('hide')}
function renderTodos(){const t=(S.todos[S.sid]||[]);todoEl.textContent='';
  if(!t.length||t.every(x=>x.status==='completed')){todoEl.classList.add('hide');return}
  todoEl.classList.remove('hide');const done=t.filter(x=>x.status==='completed').length;
  const list=h('div',{class:'hide',style:{marginTop:'6px'}},t.map(x=>h('div',{class:'todo-i'+(x.status==='completed'?' done':'')},O.icon(x.status==='completed'?'check':'chevR'),x.content)));
  todoEl.append(h('div',{class:'card',style:{padding:'8px 12px'}},h('button',{style:{display:'flex',alignItems:'center',gap:'8px',width:'100%'},onclick:()=>list.classList.toggle('hide')},O.icon('list'),h('b',{class:'grow',style:{textAlign:'left'}},'Задачи '+done+'/'+t.length),O.icon('chevD')),list))}
let mmTimer=null;
let mmCollapsed=false;
function renderMmProgress(){const r=O.mm.run;mmProgressEl.textContent='';
  if(mmTimer){clearInterval(mmTimer);mmTimer=null}
  if(!r){mmProgressEl.classList.add('hide');mmCollapsed=false;if(mmFloatBtn)mmFloatBtn.classList.add('hide');return}
  const active=r.currentRole||r.phase;
  if(!active){mmProgressEl.classList.add('hide');return}
  const phase=r.phase||'role';
  const phaseLabel={plan:'Планирование',role:'Работает роль',synth:'Синтез',idle:'Ожидание'}[phase]||phase;
  const started=r.phaseStart||r.started||Date.now();
  const elapsed=((Date.now()-started)/1000).toFixed(0);
  // compact pill: always visible, tap toggles the detailed panel
  const pill=h('button',{class:'mm-pill'+(mmCollapsed?'':' expanded'),id:'mm-pill',
    title:mmCollapsed?O.tr('Show details','Показать подробности'):O.tr('Hide details','Свернуть'),
    onclick:()=>{mmCollapsed=!mmCollapsed;renderMmProgress()}},
    h('span',{class:'mm-pill-dot'+(r.paused?' paused':'')}),
    h('span',{class:'mm-pill-role'},active),
    h('span',{class:'mm-pill-time'},elapsed+'s'),
    O.icon(mmCollapsed?'chevD':'chevR'));
  mmFloatBtn.textContent='';
  mmFloatBtn.append(pill);
  mmFloatBtn.classList.remove('hide');
  mmProgressEl.classList.toggle('hide',!!mmCollapsed);
  mmProgressEl.classList.toggle('collapsed',!!mmCollapsed);
  if(mmCollapsed){if(mmTimer){clearInterval(mmTimer);mmTimer=null}return}
  mmProgressEl.append(h('div',{class:'mm-progress-bar'},
    h('div',{class:'mm-progress-head'},
      h('span',{class:'mm-progress-role'},active),
      h('span',{class:'mm-progress-phase'},phaseLabel),
      h('span',{class:'mm-progress-time'},elapsed+'s'),
      h('button',{class:'ibtn s mm-graph-btn',title:O.tr('Agent graph','Граф агента'),onclick:e=>{e.stopPropagation();O.openMmGraph&&O.openMmGraph()}},O.icon('branch')),
      h('button',{class:'ibtn s mm-graph-btn',title:O.tr('Export report','Экспорт отчёта'),onclick:e=>{e.stopPropagation();O.mmExportReport&&O.mmExportReport()}},O.icon('doc'))),
    h('div',{class:'mm-progress-track'},
      h('div',{class:'mm-progress-fill',style:{width:phase==='role'||phase==='synth'?'100%':'0%'}}))));
  const ctrl=h('div',{style:{display:'flex',gap:'6px',flexWrap:'wrap',marginTop:'6px'}},
    h('button',{class:'chip',onclick:()=>O.mmPause&&O.mmPause()},O.icon(r.paused?'play':'pause'),r.paused?O.tr('Resume','Продолжить'):O.tr('Pause','Пауза')),
    h('button',{class:'chip',onclick:()=>O.mmStop&&O.mmStop()},O.icon('stop'),O.tr('Stop all','Стоп')));
  (r.jobs||[]).forEach(j=>{
    if(!j.role)return;
    const st=j.state||'';
    const done=st==='done'||(j.sid&&(!S.status[j.sid]||S.status[j.sid].type==='idle'));
    const cur=r.currentRole&&(j.role.name===r.currentRole||j.role.name+' (retry)'===r.currentRole);
    const col=j.role.color;
    const ic=st==='stopped'?'stop':(j.role.icon||(done?'check':cur?'refresh':'dot'));
    ctrl.append(h('button',{class:'chip',title:O.tr('Role actions','Действия с ролью'),
      style:(cur?'border-color:var(--acc);color:var(--acc)':'')+(col?(';--role-color:'+col):''),
      onclick:()=>O.mmRoleActions&&O.mmRoleActions(j)},
      O.icon(ic),(j.role.name||'')));
  });
  mmProgressEl.append(ctrl);
  if(!r.paused){
    const timeEl=mmProgressEl.querySelector('.mm-progress-time');
    const pillTime=mmFloatBtn.querySelector('.mm-pill-time');
    mmTimer=setInterval(()=>{
      if(!O.mm.run){clearInterval(mmTimer);mmTimer=null;return}
      const sec=((Date.now()-started)/1000).toFixed(0)+'s';
      if(timeEl&&timeEl.isConnected)timeEl.textContent=sec;
      if(pillTime&&pillTime.isConnected)pillTime.textContent=sec;
      else{clearInterval(mmTimer);mmTimer=null}
    },1000);
  }
}
let contEl=null;
function renderContinue(){
  const host=statusEl.parentNode;
  if(!contEl){
    contEl=h('div',{class:'continue-bar hide',style:{padding:'0 10px 6px'}});
    host.insertBefore(contEl,statusEl);
  }
  const mmRes=!O.mm.run&&O.mmHasResumable&&O.mmHasResumable();
  const show=!!S.sid&&(O.canContinue(S.sid)||mmRes);
  if(!show){contEl.classList.add('hide');contEl.textContent='';contEl._sig='';return}
  // Rebuild only when the underlying state changed: renderStatus runs on every status tick.
  const last=O.lastAssistant(S.sid);
  const sig=S.sid+'|'+(last?last.msg.info.id:'')+'|'+(last&&last.text.length)+'|'+(last&&last.msg.info.error?1:0)+'|'+(mmRes?1:0);
  if(contEl._sig===sig)return;
  contEl._sig=sig;
  contEl.textContent='';
  contEl.classList.remove('hide');
  if(mmRes)contEl.append(h('button',{class:'btn sm pri',style:{marginRight:'6px'},onclick:()=>O.mmResume()},O.icon('play'),O.tr('Resume MM run','Возобновить MM-прогон')));
  if(!O.canContinue(S.sid))return;
  contEl.append(h('div',{class:'card',style:{display:'flex',alignItems:'center',gap:'8px',padding:'8px 12px'}},
    O.icon('play'),
    h('span',{class:'grow',style:{fontSize:'13px'}},O.tr('Generation was interrupted','Генерация прервана')),
    h('button',{class:'btn sm pri',onclick:()=>{O.continueGeneration();renderContinue()}},O.tr('Continue','Продолжить')),
    h('button',{class:'ibtn s',title:O.tr('Continue with a custom note','Продолжить с пояснением'),onclick:async()=>{
      const v=await O.ask(O.tr('Continue with instruction','Продолжить с уточнением'),O.tr('What should it do next?','Что сделать дальше?'),'',true);
      if(v!==null)O.continueGeneration(S.sid,{custom:v||undefined});
    }},O.icon('edit'))));
}
// ---- conversation outline: jump to any of your prompts in a long chat ----
O.openOutline=()=>{
  if(!S.sid)return O.toast(O.tr('Open a session first','Сначала откройте сессию'),2000);
  const list=O.visibleMsgs(S.sid).filter(m=>m.info.role==='user');
  const body=h('div');
  if(!list.length)body.append(h('div',{class:'note'},O.tr('No prompts yet','Запросов пока нет')));
  list.forEach((m,i)=>{
    const txt=msgText(m).replace(/\s+/g,' ').trim();
    const t=m.info.time&&m.info.time.created?new Date(m.info.time.created).toLocaleTimeString().slice(0,5):'';
    body.append(h('button',{class:'settings-row',onclick:()=>{s.close();O.jumpToMsg(m.info.id)}},
      h('div',{class:'settings-row-icon'},h('b',{style:{fontSize:'12px'}},String(i+1))),
      h('div',{class:'settings-row-text'},h('b',{style:{whiteSpace:'normal'}},txt.slice(0,90)||O.tr('(attachment)','(вложение)')),h('span',null,t))));
  });
  const s=O.sheet(O.tr('Conversation outline','Оглавление диалога'),body,{full:true});
};
// Scrolls to a message, inflating older chunks first when it is above the rendered window.
O.jumpToMsg=mid=>{
  let el=msgEls.get(mid),guard=0;
  while(!el&&pendingHead.length&&guard++<200){
    const start=Math.max(0,pendingHead.length-RENDER_CHUNK);
    const chunk=pendingHead.slice(start);
    pendingHead=pendingHead.slice(0,start);
    const fr=document.createDocumentFragment();
    const built=new Set();
    chunk.forEach(m=>{
      if(!m.parts.some(p=>showPart(m,p))&&!m.info.error)return;
      if(m.info.role==='assistant'&&toolView()!=='cards'){
        const host=turnHost(m);
        // FIX (audit #2): reuse an existing turn card from another chunk — no duplicates
        const exist=msgEls.get(host.info.id);
        if(built.has(host.info.id)||exist){const he=exist||msgEls.get(host.info.id);if(he){msgEls.set(m.info.id,he);(he._tids||[]).forEach(id=>msgEls.set(id,he))}return}
        const vm=mergedTurnMsg(host);
        const el=buildMsg(vm);built.add(host.info.id);
        el._tids=vm._ids||[host.info.id];
        el._tids.forEach(id=>msgEls.set(id,el));
        fr.append(el);
      }else{const el=buildMsg(m);built.add(m.info.id);fr.append(el)}
    });
    const first=msgsEl.firstChild;
    if(first)msgsEl.insertBefore(fr,first);else msgsEl.append(fr);
    el=msgEls.get(mid);
  }
  if(!el){O.toast(O.tr('Message not found','Сообщение не найдено'),2000);return}
  stick=false;jumpEl.classList.remove('hide');
  suppressScroll=true;
  el.scrollIntoView({block:'center'});
  requestAnimationFrame(()=>{suppressScroll=false});
  el.classList.add('msg-flash');setTimeout(()=>el.classList.remove('msg-flash'),1600);
};
// ---- context snapshot: what the model will actually receive on the next send ----
O.openContextPreview=()=>{
  const body=h('div');
  const row=(icon,label,val)=>h('div',{class:'settings-row'},
    h('div',{class:'settings-row-icon'},O.icon(icon)),
    h('div',{class:'settings-row-text'},h('b',null,label),h('span',{style:{whiteSpace:'normal',wordBreak:'break-all'}},val)));
  const ag=S.agents.find(a=>a.name===S.agent);
  const mmA=O.mmActive&&O.mmActive();
  body.append(h('div',{class:'settings-card'},
    row('bot',O.tr('Mode / agent','Режим / агент'),mmA?(O.tr('Team: ','Команда: ')+mmA.name):(ag?ag.name:S.agent)),
    row('cpu',O.tr('Model','Модель'),S.model?S.model.providerID+'/'+S.model.modelID:O.tr('not selected','не выбрана')),
    row('folder',O.tr('Project folder','Папка проекта'),O.sessionDir?O.sessionDir(S.sid):(S.dir||'/root'))));
  const caps=S.model&&O.modelCapsOf?O.modelCapsOf(S.model.providerID,S.model.modelID):null;
  if(caps)body.append(h('div',{class:'settings-card'},
    row('image',O.tr('Images','Изображения'),caps.images===true?O.tr('supported','поддерживаются'):caps.images===false?O.tr('not supported','не поддерживаются'):O.tr('unknown','неизвестно')),
    row('terminal',O.tr('Tool calls','Вызовы инструментов'),caps.tools===true?O.tr('supported','поддерживаются'):caps.tools===false?O.tr('not supported','не поддерживаются'):O.tr('unknown','неизвестно'))));
  const styleTxt=O.answerStyleText?O.answerStyleText():'';
  const extras=[];
  if(styleTxt)extras.push(O.tr('Answer style','Стиль ответа'));
  if(O.dryRun&&O.dryRun())extras.push('Dry-run');
  if(mmA&&mmA.memory!==false&&O.mmMemory(mmA))extras.push(O.tr('Team memory','Память команды'));
  if(extras.length)body.append(h('div',{class:'settings-card'},row('edit',O.tr('Extra instructions','Доп. инструкции'),extras.join(' · '))));
  const used=mentions.filter(m=>ta.value.includes(m.tok));
  if(used.length||atts.length){
    const card=h('div',{class:'settings-card'});
    used.forEach(m=>card.append(row('at',m.tok,(m.part&&m.part.source&&m.part.source.path)||O.tr('mention','упоминание'))));
    atts.forEach(a=>card.append(row('paperclip',a.filename||'file',a.mime+' · ~'+Math.max(1,Math.round((a.url||'').length*0.75/1024))+' KB')));
    body.append(h('div',{class:'grp'},O.tr('Attachments & mentions','Вложения и упоминания')),card);
  }
  const tok=S.sid&&O.calcSessionTokens?O.calcSessionTokens(S.sid):null;
  if(tok&&tok.total)body.append(h('div',{class:'settings-card'},row('zap',O.tr('Session context','Контекст сессии'),O.fmtK(tok.total)+' tok'+(tok.pct!=null?' · '+tok.pct+'%':''))));
  const rulesPath=(O.sessionDir?O.sessionDir(S.sid):S.dir||'/root')+'/AGENTS.md';
  body.append(h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:()=>{
    const r=O.native.readText(rulesPath);
    const ta2=h('textarea',{class:'mono',rows:16});ta2.value=r.ok?r.text:O.tr('(no rules file)','(файла правил нет)');ta2.readOnly=true;
    O.sheet(O.tr('Rules the agent reads','Правила, которые читает агент'),ta2,{full:true});
  }},O.icon('doc'),O.tr('Show AGENTS.md','Показать AGENTS.md')));
  O.sheet(O.tr('Context snapshot','Снимок контекста'),body,{full:true});
};
// ---- crash recovery: an app kill mid-generation left the turn silent ----
let recEl=null;
function renderRecovery(){
  const host=statusEl.parentNode;
  if(!recEl){recEl=h('div',{class:'hide',style:{padding:'0 10px 6px'}});host.insertBefore(recEl,statusEl)}
  const fl=O.inflight&&O.inflight();
  const st=fl&&S.status[fl.sid];
  const busyNow=st&&st.type!=='idle';
  const show=fl&&fl.sid===S.sid&&!busyNow&&Date.now()-fl.at<86400000&&!(O.canContinue&&O.canContinue(S.sid));
  if(!show){recEl.classList.add('hide');recEl.textContent='';return}
  recEl.classList.remove('hide');recEl.textContent='';
  recEl.append(h('div',{class:'card',style:{display:'flex',alignItems:'center',gap:'8px',padding:'8px 12px'}},
    O.icon('refresh'),
    h('span',{class:'grow',style:{fontSize:'13px'}},O.tr('Request was interrupted by an app restart','Запрос прерван перезапуском приложения')),
    h('button',{class:'btn sm pri',onclick:()=>{O.clearInflight();renderRecovery();O.continueGeneration(S.sid)}},O.tr('Continue','Продолжить')),
    fl.text?h('button',{class:'btn sm',onclick:()=>{const t=fl.text;O.clearInflight();renderRecovery();O.insertPrompt(t)}},O.tr('Edit','Править')):null,
    h('button',{class:'ibtn s',title:O.tr('Dismiss','Скрыть'),onclick:()=>{O.clearInflight();renderRecovery()}},O.icon('x'))));
}
// One status line that answers "what is happening right now": phase, current tool and elapsed time.
let statusT=null,statusPhase='';
function statusPhrase(){
  const sid=S.sid;
  const msgs=O.msgs(sid).list;
  // last unfinished tool call wins: it is the most specific description of the current step
  for(let i=msgs.length-1;i>=0&&i>msgs.length-12;i--){
    const m=msgs[i];
    for(let j=(m.parts||[]).length-1;j>=0;j--){
      const p=m.parts[j];
      if(p.type!=='tool'||!p.state||p.state.status!=='running')continue;
      const inp=p.state.input||{};
      const detail=p.tool==='bash'?String(inp.command||'').split('\n')[0]:String(inp.filePath||inp.path||inp.query||'');
      return{tool:p.tool||'',detail:detail.slice(0,60)};
    }
  }
  return null;
}
function renderStatus(){
  const s=S.status[S.sid];
  renderContinue();renderRecovery();
  statusEl.textContent='';
  if(!s||s.type==='idle'){statusEl.classList.add('hide');clearInterval(statusT);statusT=null;S._statusSince=0;return}
  statusEl.classList.remove('hide');
  const ph=statusPhrase();
  const started=(s.type==='retry'&&s.time&&s.time.start)||S._statusSince||(S._statusSince=Date.now());
  if(s.type!=='retry'&&!S._statusSince)S._statusSince=Date.now();
  const label=s.type==='retry'
    ?O.tr('Retry #','Повтор №')+(s.attempt||1)+(s.message?': '+String(s.message).slice(0,60):'')
    :(ph?(ph.tool+(ph.detail?': '+ph.detail:'')):O.tr('Thinking','Думает'));
  const timeEl=h('span',{class:'status-time'},'0s');
  const est=O.estimateTurn?O.estimateTurn():null;
  statusEl.append(h('span',{class:'spin'}),h('span',{class:'status-label'},label),
    est?h('span',{class:'mut s'},'~'+est+'s'):null,timeEl);
  clearInterval(statusT);
  statusT=setInterval(()=>{
    if(!statusEl.isConnected||!statusEl.classList.contains('hide')){
      if(!statusEl.isConnected){clearInterval(statusT);statusT=null;return}
    }
    const el=statusEl.querySelector('.status-time');
    if(!el){clearInterval(statusT);statusT=null;return}
    el.textContent=Math.floor((Date.now()-S._statusSince)/1000)+'s';
    // the tool can change while we tick; refresh the label without rebuilding the row
    const ph2=statusPhrase();
    const lab=statusEl.querySelector('.status-label');
    if(lab&&ph2)lab.textContent=ph2.tool+(ph2.detail?': '+ph2.detail:'');
  },1000);
}
function renderDock(){dockEl.textContent='';
  const curPerms=S.perms.filter(p=>p.sessionID===S.sid);
  const curQuestions=S.questions.filter(q=>q.sessionID===S.sid);
  curPerms.forEach(p=>dockEl.append(permCard(p)));
  curQuestions.forEach(q=>dockEl.append(questionCard(q)));
  const other=S.perms.filter(p=>p.sessionID!==S.sid)[0]||S.questions.filter(q=>q.sessionID!==S.sid)[0];
  if(other)dockEl.append(h('button',{class:'hud-dock-card',style:{padding:'12px 16px',display:'flex',alignItems:'center',gap:'10px',textAlign:'left',cursor:'pointer'},onclick:()=>O.openSession(other.sessionID)},O.icon('alert','warn'),h('b',null,'Другая сессия ждёт вас')));
  if(chatRoot){chatRoot.classList.toggle('dock-active',curPerms.length>0||curQuestions.length>0)}
  O.updateBadges&&O.updateBadges()}
function permCard(p){const btns=[];
  const reply=async r=>{btns.forEach(b=>b.disabled=true);try{await O.replyPermission(p,r)}catch(e){btns.forEach(b=>b.disabled=false);O.toast(e.message)}};
  btns.push(h('button',{class:'btn-dock-skip',style:{color:'#f87171'},onclick:()=>reply('reject')},O.tr('Reject','Отклонить')),
            h('button',{class:'btn-dock-skip',onclick:()=>reply('once')},O.tr('Once','Разрешить раз')),
            h('button',{class:'btn-dock-submit',onclick:()=>reply('always')},O.tr('Always','Всегда')));
  const diff=p.metadata&&typeof p.metadata.diff==='string'?p.metadata.diff:'';
  return h('div',{class:'hud-dock-card'},
    h('div',{class:'hud-dock-header'},
      h('div',{class:'hud-dock-header-left'},
        h('div',{class:'badge-icon',style:{background:'rgba(245,158,11,0.15)',color:'#fbbf24'}},O.icon('shield')),
        h('b',null,O.tr('Permission Request','Запрос разрешения'))),
      h('span',{class:'mut',style:{fontSize:'11.5px',background:'rgba(255,255,255,0.06)',padding:'3px 8px',borderRadius:'999px'}},p.title)),
    h('div',{class:'hud-dock-body'},
      h('div',{style:{fontSize:'14px',fontWeight:'600',color:'#ffffff',marginBottom:'4px'}},p.title),
      p.patterns.length?h('div',{class:'mono s mut',style:{background:'#141416',padding:'8px 10px',borderRadius:'10px',wordBreak:'break-all'}},p.patterns.join('\n')):null,
      diff?h('details',{style:{marginTop:'6px'}},h('summary',{class:'s'},'Показать изменения'),O.unifiedEl(diff)):null),
    h('div',{class:'hud-dock-footer'},btns));
}
function questionCard(q){const qs=q.questions||[];const sel=qs.map(()=>new Set());const custom=qs.map(()=>'');
  qs.forEach((x,i)=>{
    if(Array.isArray(x.default))x.default.forEach(d=>sel[i].add(d));
    else if(typeof x.default==='string'&&x.default)sel[i].add(x.default);
  });
  const send=async()=>{
    const answers=qs.map((_,i)=>[...sel[i],...(custom[i]?.trim()?[custom[i].trim()]:[])]);
    const hasAny=answers.some(a=>a.length>0);
    if(!hasAny&&qs.length>0){
      O.toast(O.tr('Please select an option or type an answer, or click Skip','Выберите вариант или введите ответ, либо нажмите «Пропустить»'));
      return;
    }
    try{
      await api('POST','/question/'+q.id+'/reply',{answers});
      S.questions=S.questions.filter(x=>x.id!==q.id);
      renderDock();
    }catch(e){O.toast(e.message)}
  };
  const rej=async()=>{try{await api('POST','/question/'+q.id+'/reject',{});S.questions=S.questions.filter(x=>x.id!==q.id);renderDock()}catch(e){O.toast(e.message)}};
  const body=qs.map((x,i)=>{
    const isMulti=!!x.multiple;
    const qBadge=qs.length>1?h('div',{class:'dock-q-num'},O.tr('Question','Вопрос')+' '+(i+1)+' / '+qs.length):null;
    const opts=h('div',{class:'dock-opts-list'},(x.options||[]).map(o=>{
      const isInit=sel[i].has(o.label);
      const indicator=h('div',{class:'dock-opt-indicator'+(isMulti?' check':'')});
      const b=h('button',{
        class:'dock-opt-row'+(isMulti?' multiple':'')+(isInit?' on':''),
        onclick:()=>{
          if(isMulti){
            sel[i].has(o.label)?sel[i].delete(o.label):sel[i].add(o.label);
          }else{
            sel[i].clear();
            sel[i].add(o.label);
          }
          opts.querySelectorAll('.dock-opt-row').forEach((bb,k)=>bb.classList.toggle('on',sel[i].has(x.options[k].label)));
        }
      },
      indicator,
      h('div',{class:'dock-opt-content'},
        h('span',{class:'dock-opt-label'},o.label),
        o.description?h('span',{class:'dock-opt-desc'},o.description):null));
      return b;
    }));
    const inp=x.custom===false?null:h('input',{
      class:'dock-custom-inp',
      placeholder:O.tr('Type your own answer...','Свой вариант ответа...'),
      oninput:e=>{custom[i]=e.target.value},
      onkeydown:e=>{if(e.key==='Enter'){e.preventDefault();send()}},
      onfocus:e=>{setTimeout(()=>e.target.scrollIntoView({behavior:'smooth',block:'center'}),250)}
    });
    return h('div',{class:'dock-q-section'},
      qBadge,
      x.header?h('div',{class:'dock-q-header'},x.header):null,
      h('div',{class:'dock-q-title'},x.question),
      opts,
      inp);
  });
  return h('div',{class:'hud-dock-card'},
    h('div',{class:'hud-dock-header'},
      h('div',{class:'hud-dock-header-left'},
        h('div',{class:'badge-icon'},O.icon('help')),
        h('b',null,O.tr('OpenCode asks','OpenCode спрашивает'))),
      h('span',{class:'mut',style:{fontSize:'11.5px',background:'rgba(255,255,255,0.06)',padding:'3px 8px',borderRadius:'999px'}},
        qs.length>1?(qs.length+' '+O.tr('questions','вопроса')):(O.tr('Action needed','Требуется выбор')))),
    h('div',{class:'hud-dock-body'},body),
    h('div',{class:'hud-dock-footer'},
      h('button',{class:'btn-dock-skip',onclick:rej},O.tr('Skip','Пропустить')),
      h('button',{class:'btn-dock-submit',onclick:send},O.icon('send'),O.tr('Send reply','Отправить ответ'))));
}

// ---- composer ----
let quotaModalOpen=false;
O.showQuotaAccountModal=msg=>{
  if(quotaModalOpen)return;
  if(S.account&&S.account.email){
    O.toast(O.tr('Quota limit reached for this model. Switch to another model or connect your provider key: Settings → Providers.','Квота для этой модели исчерпана. Выберите другую модель или подключите свой ключ: Настройки → Провайдеры.'),6000);
    return;
  }
  quotaModalOpen=true;
  const content=h('div',{style:{textAlign:'center',padding:'16px 8px 8px'}},
    h('div',{style:{display:'flex',justifyContent:'center',marginBottom:'10px'}},O.icon('zap')),
    h('b',{style:{fontSize:'17px',display:'block',marginBottom:'8px'}},O.tr('Free Quota Limit Reached','Лимит бесплатной квоты исчерпан')),
    h('p',{class:'mut',style:{fontSize:'13.5px',lineHeight:'1.5',margin:'0 0 18px',textAlign:'center'}},
      O.tr(
        'You are currently using shared guest quota without an account. Sign in with Google or GitHub to receive your personal free OpenCode quota, or add your own provider API key.',
        'Вы используете общую квоту без авторизации, которая временно исчерпана.\n\nВойдите через Google или GitHub, чтобы получить персональную бесплатную квоту OpenCode, либо подключите собственный API ключ.'
      )
    ),
    h('button',{class:'btn pri wide',style:{marginBottom:'10px'},onclick:()=>{s.close();O.openAccount()}},O.icon('user'),O.tr('Sign in with Google / GitHub','Войти через Google / GitHub')),
    h('button',{class:'btn wide',style:{marginBottom:'10px'},onclick:()=>{s.close();O.openConnect()}},O.icon('key'),O.tr('Connect own API key','Подключить свой API ключ')),
    h('button',{class:'btn wide',onclick:()=>s.close()},O.tr('Later','Позже'))
  );
  const s=O.sheet(O.tr('OpenCode Quota','Квота OpenCode'),content,{hud:true,onClose:()=>{quotaModalOpen=false}});
};

const quotaHint=()=>S.account&&S.account.email
  ?'Квота этой модели исчерпана. Перезапустите сервер (Настройки → Совместимость), выберите другую модель или подключите свой ключ: Настройки → Модели → Подключить провайдера'
  :'Квота исчерпана. Войдите в аккаунт opencode (Google/GitHub): Настройки → Аккаунт opencode — или подключите свой ключ: Настройки → Модели → Подключить провайдера';
function onMic(){
  // Single entry point: call.js owns engine choice, biasing and the fallback chain.
  if(O.voiceDictate){O.voiceDictate();return}
  const lang=O.store.get('lang','ru')==='en'?'en-US':'ru-RU';
  if(window.OC&&window.OC.startVoiceInput)window.OC.startVoiceInput(lang);
}
function updateChips(){
  const m=S.model,mi=m&&O.modelInfo(m.providerID,m.modelID);
  const ag=S.agents.find(a=>a.name===S.agent);
  const mmA=O.mmActive&&O.mmActive();
  const agName=mmA?mmA.name:(ag?ag.name:(S.agent||'Build'));
  const spanAg=agentChip.querySelector('span');
  if(spanAg){spanAg.textContent=agName.charAt(0).toUpperCase()+agName.slice(1);
    agentChip.classList.toggle('mm-on',!!mmA)}
  let mName=O.tr('Select model','Выбрать модель');
  if(mi)mName=mi.name||m.modelID;
  else if(m)mName=m.modelID;
  const spanMo=modelChip.querySelector('span');
  if(spanMo)spanMo.textContent=mName;
  if(modelChip){
    const prof=Object.keys(O.modelProfiles()).find(k=>{
      const p=O.modelProfile(k);return p&&m&&p.main===(m.providerID+'/'+m.modelID);
    });
    modelChip.classList.toggle('has-profile',!!prof);
    modelChip.classList.toggle('fast-on',!!(O.fastMode&&O.fastMode()));
    modelChip.title=O.fastMode&&O.fastMode()?O.tr('Fast mode','Быстрый режим'):(prof?(O.tr('Profile: ','Профиль: ')+prof):'');
  }
  // Swipe the model chip left/right to cycle models: no need to open the full list.
  if(modelChip&&!modelChip._swipe){
    modelChip._swipe=1;
    O.swipe(modelChip,d=>{
      if(d==='left')O.cycleModel(1);
      else if(d==='right')O.cycleModel(-1);
    },{threshold:36});
  }
  // long-press on the model chip: quick profile switching without opening the whole list
  // Long-press on the model chip: reasoning effort ladder first (the most used control),
  // then profiles and folder management.
  if(modelChip&&!modelChip._profLp){
    modelChip._profLp=1;
    O.longPress(modelChip,()=>{
      const levels=O.effortLevels?O.effortLevels():['low','medium','high'];
      const cur=O.currentEffort?O.currentEffort():'';
      const eff=levels.map(v=>({
        label:O.effortLabel?O.effortLabel(v):v,
        sub:v===cur?O.tr('current','выбрано'):'',
        icon:v===cur?'check':'dot',
        fn:()=>O.setEffort(v)
      }));
      eff.push({label:O.tr('Default','По умолчанию'),sub:cur?'':O.tr('current','выбрано'),icon:cur?'dots':'check',fn:()=>O.setEffort('')});
      const names=Object.keys(O.modelProfiles());
      O.actions((O.modelInfo&&S.model&&O.modelInfo(S.model.providerID,S.model.modelID)||{}).name||O.tr('Model','Модель'),[
        ...eff,
        names.length?{label:O.tr('Profiles…','Профили…'),icon:'star',fn:()=>{
          O.actions(O.tr('Model profiles','Профили моделей'),names.map(n=>({label:n,icon:'star',fn:()=>O.applyModelProfile(n)})).concat([{label:O.tr('Manage folders & profiles…','Папки и профили…'),icon:'sliders',fn:()=>O.openModelFolders()}]));
        }}:null,
        {label:O.tr('Manage folders & profiles…','Папки и профили…'),icon:'sliders',fn:()=>O.openModelFolders()},
        {label:O.tr('All models','Все модели'),icon:'cpu',fn:()=>O.openModels()}
      ].filter(Boolean));
    });
  }
  const nokey=!m&&!S.offline&&S.up;
  nokeyEl.classList.toggle('hide',!nokey);
  ta.disabled=!!S.offline&&!S.up;
  ta.placeholder=ta.disabled?(O.tr('Offline — reading cached chats','Офлайн — чтение кэшированных чатов')):(O.tr('Chat with OpenCode...','Чат с OpenCode...'));
  updateSend();
}
function updateSend(){
  const b=busy(),has=!!ta.value.trim()||!!atts.length;
  // Smart stop (47): after an abort the empty send button becomes "continue" in one tap.
  const canCont=!b&&!has&&S.sid&&O.canContinue&&O.canContinue(S.sid);
  sendBtn.className=b&&!has?'stop':(has?'ready':(canCont?'resume':''));
  sendBtn.textContent='';
  sendBtn.append(O.icon(b&&!has?'stop':(b&&has?'plus':(canCont?'play':'send'))));
  sendBtn.disabled=!b&&!has&&!canCont;
  sendBtn.title=canCont?O.tr('Continue from the cut','Продолжить с места обрыва'):'';
  renderQueueBar();
}
function renderQueueBar(){
  let bar=comp&&comp.querySelector('.queue-bar');
  const items=O.promptQueue?O.promptQueue(S.sid):[];
  if(!items.length){if(bar)bar.remove();return}
  if(!bar){bar=h('div',{class:'queue-bar'});comp.querySelector('.cbox').prepend(bar)}
  bar.textContent='';
  bar.append(h('span',{class:'mut s'},O.tr('Queued: ','В очереди: ')+items.length));
  items.slice(0,3).forEach((it,i)=>bar.append(h('span',{class:'chip'},h('span',{class:'media-clip',style:{maxWidth:'140px'}},it.text),
    h('button',{class:'chip-x',onclick:()=>O.removeQueued(S.sid,i)},O.icon('x')))));
}
function autosize(){
  // JUMP FIX: height='auto' collapsed the composer for a frame on EVERY keystroke — the chat
  // above bounced while typing. Modern WebView supports field-sizing:content (pure CSS growth,
  // zero JS layout thrash). Fallback: measure via a hidden clone, write height once if changed.
  if(CSS.supports('field-sizing','content')){ta.style.height='';return}
  let probe=ta._probe;
  if(!probe){
    probe=ta._probe=document.createElement('textarea');
    probe.tabIndex=-1;probe.setAttribute('aria-hidden','true');
    probe.style.cssText='position:absolute;visibility:hidden;pointer-events:none;left:-9999px;top:0;overflow:hidden;';
    document.body.append(probe);
  }
  const cs=getComputedStyle(ta);
  ['font','fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','padding','border','boxSizing','width','whiteSpace','wordWrap','wordBreak'].forEach(k=>{probe.style[k]=cs[k]});
  probe.value=ta.value+'\u200b';
  const want=Math.min(Math.max(probe.scrollHeight,34),180);
  if(ta.offsetHeight!==want){ta.style.height=want+'px';if(stick)scrollEnd()}
}
const BUILTINS=[
 {n:'new',d:'Начать новую сессию',i:'plus',run:()=>O.newSession()},
 {n:'sessions',d:'Переключить сессию',i:'list',run:()=>O.openSessions()},
 {n:'models',d:'Выбрать модель',i:'cpu',run:()=>O.openModels()},
  {n:'plan',d:'Пошаговый план задачи',i:'list',run:()=>O.openPlan()},
  {n:'projects',d:'Рабочие пространства',i:'folder',run:()=>O.openProjects()},
 {n:'agents',d:'Выбрать агента',i:'bot',run:()=>O.openAgents()},
 {n:'widgets',d:'Интерактивные виджеты HUD',i:'sliders',run:()=>O.openWidgetsModal()},
 {n:'preview',d:'Веб-предпросмотр проекта',i:'globe',run:arg=>O.openPreview(arg)},
 {n:'open',d:'Открыть приложение Android (например /open telegram)',i:'out',run:arg=>O.dispatchAction('open_app',arg)},
 {n:'connect',d:'Подключить провайдера (OpenCode Zen, OpenAI, ...)',i:'key',run:()=>O.openConnect()},
 {n:'init',d:'Создать или обновить AGENTS.md',i:'doc',run:()=>doInit()},
 {n:'undo',d:'Отменить последнее сообщение и его изменения файлов',i:'undo',run:()=>doUndo()},
 {n:'redo',d:'Вернуть отменённые изменения',i:'redo',run:()=>doRedo()},
 {n:'compact',d:'Сжать сессию, чтобы освободить контекст',i:'refresh',run:()=>doCompact()},
 {n:'style',d:'Стиль ответа (10 пресетов)',i:'edit',run:()=>O.openAnswerStyles()},
  {n:'search',d:'Глобальный поиск',i:'search',run:()=>O.openGlobalSearch()},
 {n:'duel',d:'Дуэль: две модели отвечают, судья выбирает',i:'zap',run:arg=>O.openDuel&&O.openDuel(arg)},
 {n:'memory',d:'Персональная память: факты о вас',i:'memory',run:()=>O.openUserFacts&&O.openUserFacts()},
 {n:'template',d:'Шаблон проекта для этого чата',i:'doc',run:()=>O.openProjectTpls&&O.openProjectTpls(true)},
  {n:'outline',d:'Оглавление диалога',i:'list',run:()=>O.openOutline()},
  {n:'context',d:'Снимок контекста перед отправкой',i:'eye',run:()=>O.openContextPreview()},
 {n:'resources',d:'Монитор ресурсов',i:'cpu',run:()=>O.openResources()},
 {n:'calls',d:'История звонков',i:'wave',run:()=>O.openCallHistory()},
 {n:'tour',d:'Обучающий тур',i:'info',run:()=>O.openTour()},
 {n:'focus',d:'Фокус-режим: только чат',i:'eye',run:()=>O.setFocusMode(!O.focusMode())},
 {n:'fast',d:'Быстрый режим: mini-модель + минимум рассуждений',i:'zap',run:()=>O.setFastMode(!O.fastMode())},
 {n:'snippets',d:'Сниппеты промптов',i:'doc',run:()=>O.openSnippets()},
 {n:'health',d:'Проверка здоровья проекта',i:'shield',run:()=>O.projectHealth()},
 {n:'audit',d:'Аудит действий агента',i:'list',run:()=>O.openAgentAudit()},
 {n:'env',d:'.env менеджер',i:'key',run:()=>O.openEnvManager()},
 {n:'gallery',d:'Галерея медиа',i:'image',run:()=>O.openMediaGallery()},
 {n:'ribbon',d:'Лента медиа этой сессии',i:'film',run:()=>O.openSessionRibbon&&O.openSessionRibbon()},
 {n:'lamp',d:'Ночная лампа: тёплый фильтр для чтения',i:'bulb',run:()=>O.setNightLamp(!O.nightLamp())},
 {n:'toc',d:'ИИ-оглавление сессии с якорями',i:'list',run:()=>O.openAiToc&&O.openAiToc()},
 {n:'summary',d:'Саммари длинной сессии',i:'doc',run:()=>O.openSessionSummary&&O.openSessionSummary()},
 {n:'branches',d:'Ветки диалога',i:'branch',run:()=>O.openBranchTree()},
 {n:'share',d:'Поделиться сессией',i:'share',run:()=>doShare()},
 {n:'unshare',d:'Отключить шаринг',i:'share',run:()=>doUnshare()},
 {n:'export',d:'Экспорт диалога в Markdown',i:'down',run:()=>doExport()},
 {n:'themes',d:'Сменить тему',i:'palette',run:()=>O.openThemes()},
 {n:'thinking',d:'Показать или скрыть размышления',i:'bulb',run:()=>{S.opts.thinking=!S.opts.thinking;O.saveOpts();renderAll()}},
 {n:'details',d:'Вид команд: свёрнутые пачки → авто → карточки',i:'code',run:()=>{const order=['fold','auto','cards'];const nxt=order[(order.indexOf(toolView())+1)%order.length];S.opts.toolView=nxt;O.saveOpts();O.toast(nxt==='fold'?O.tr('Commands: folded packs','Команды: свёрнутые пачки'):nxt==='auto'?O.tr('Commands: live pack opens itself','Команды: активная пачка раскрывается сама'):O.tr('Commands: classic cards','Команды: классические карточки'),1800);renderAll()}},
 {n:'status',d:'Серверы MCP, LSP и плагины',i:'server',run:()=>O.openStatus()},
 {n:'files',d:'Файлы проекта',i:'folder',run:()=>O.setTab('files')},
 {n:'terminal',d:'Терминал',i:'terminal',run:()=>O.setTab('term')},
 {n:'settings',d:'Настройки приложения',i:'sliders',run:()=>O.openSettings()},
 {n:'help',d:'Что я умею',i:'info',run:()=>O.openHelp()},
 {n:'exit',d:'Свернуть приложение (сервер продолжает работать)',i:'out',run:()=>OC.minimize()}];
async function sess(){if(S.sid)return S.sid;const s=await O.newSession();return s.id}
async function doInit(){if(!S.model)return O.openConnect();try{const sid=await sess();api('POST','/session/'+sid+'/init',{messageID:O.mid(),providerID:S.model.providerID,modelID:S.model.modelID},{timeout:3600000}).catch(e=>O.toast(e.message))}catch(e){O.toast(e.message)}}
async function doUndo(){const l=O.visibleMsgs(S.sid||'').filter(m=>m.info.role==='user');if(!l.length)return O.toast('Нечего отменять');revertTo(l[l.length-1])}
async function doRedo(){try{await api('POST','/session/'+S.sid+'/unrevert',{})}catch(e){O.toast(e.message)}}
async function doCompact(){if(!S.sid||!S.model)return;try{await api('POST','/session/'+S.sid+'/summarize',{providerID:S.model.providerID,modelID:S.model.modelID},{timeout:600000});O.toast('Сессия сжата')}catch(e){O.toast(e.message)}}
async function doShare(){try{const s=await api('POST','/session/'+S.sid+'/share',{});const u=s.share&&s.share.url;if(u){O.native.copy(u);O.native.share(u)}}catch(e){O.toast(e.message)}}
async function doUnshare(){try{await api('DELETE','/session/'+S.sid+'/share');O.toast('Шаринг остановлен')}catch(e){O.toast(e.message)}}
function doExport(){if(!S.sid)return;const md=O.visibleMsgs(S.sid).map(m=>'## '+(m.info.role==='user'?'Пользователь':'Ассистент')+'\n\n'+m.parts.filter(p=>p.type==='text'&&!p.synthetic).map(p=>p.text).join('\n\n')).join('\n\n');O.native.share(md)}
O.builtins=BUILTINS;
function hidePop(){popEl.classList.add('hide');popEl.textContent=''}
function showPop(items){popEl.textContent='';if(!items.length){hidePop();return}popEl.classList.remove('hide');
  items.slice(0,40).forEach(it=>popEl.append(h('button',{class:'it',style:{width:'100%',textAlign:'left'},onclick:it.pick},it.icon?it.icon:null,h('b',null,it.t),h('span',{class:'d grow'},it.d||''))))}
let atTimer;
let draftTimer;
let draftSid=null;
// Guard: while the async draft restore is loading, empty renders must not overwrite the stored draft.
let draftRestoring=false;
function saveDraftNow(){
  if(!S.sid||draftRestoring)return;
  if(O.setDraftEx)O.setDraftEx(S.sid,{atts:atts.slice(0,8),mentions:mentions.slice(0,20)});
}
function draftEx(){return{atts:atts.slice(0,8),mentions:mentions.slice(0,20)}}
function onInput(){autosize();updateSend();const v=ta.value,pos=ta.selectionStart||0,before=v.slice(0,pos);
  if(S.sid){clearTimeout(draftTimer);draftTimer=setTimeout(()=>{O.setDraft(S.sid,v);saveDraftNow()},300)}
  const sm=/^\/(\S*)$/.exec(before);
  if(sm){const q=sm[1].toLowerCase();
    const srv=(S.commands||[]).filter(c=>!BUILTINS.some(b=>b.n===c.name)).map(c=>({t:'/'+c.name,d:c.description||'Пользовательская команда',icon:O.icon('slash'),f:c.name,pick:()=>{ta.value='/'+c.name+' ';ta.focus();onInput()}}));
    const bi=BUILTINS.map(b=>({t:'/'+b.n,d:b.d,icon:O.icon(b.i),f:b.n,pick:()=>{ta.value='';autosize();hidePop();updateSend();b.run()}}));
    showPop([...bi,...srv].filter(x=>x.f.startsWith(q)||(q.length>1&&x.f.includes(q))));return}
  const am=/(?:^|\s)@(\S*)$/.exec(before);
  if(am){const q=am[1];clearTimeout(atTimer);atTimer=setTimeout(async()=>{
    const ags=O.subagents().filter(a=>a.name.startsWith(q)).map(a=>({t:'@'+a.name,d:a.description||'Субагент',icon:O.icon('bot'),pick:()=>insertMention('@'+a.name,{type:'agent',name:a.name},pos-q.length-1,pos)}));
    let files=[];try{files=await api('GET','/find/file?query='+encodeURIComponent(q)+'&limit=30')}catch{}
    const fi=(files||[]).map(f=>{const dir=f.endsWith('/');return{t:O.basename(f),d:f,icon:O.fileIcon(O.basename(f),dir),pick:()=>insertMention('@'+f,{type:'file',mime:dir?'application/x-directory':'text/plain',url:(O.mediaUrl?O.mediaUrl(S.dir+'/'+f.replace(/\/$/,'')):('file://'+S.dir+'/'+f.replace(/\/$/,''))),filename:O.basename(f),source:{type:'file',path:S.dir+'/'+f.replace(/\/$/,''),text:{value:'@'+f,start:0,end:0}}},pos-q.length-1,pos)}});
    if(ta.value.slice(0,pos)===before)showPop([...ags,...fi])},160);return}
  hidePop()}
O.subagents=()=>(S.agents||[]).filter(a=>a.mode==='subagent'||a.mode==='all');
function insertMention(tok,part,from,to){ta.value=ta.value.slice(0,from)+tok+' '+ta.value.slice(to);const p=from+tok.length+1;ta.setSelectionRange(p,p);mentions.push({tok,part});hidePop();ta.focus();onInput()}
O.addMention=(path,isDir)=>{const rel=O.rel(path);const tok='@'+rel;const abs=path.startsWith('/')?path:S.dir+'/'+path;
  ta.value=(ta.value?ta.value+' ':'')+tok+' ';mentions.push({tok,part:{type:'file',mime:isDir?'application/x-directory':'text/plain',url:(O.mediaUrl?O.mediaUrl(abs):('file://'+abs)),filename:O.basename(path),source:{type:'file',path:abs,text:{value:tok,start:0,end:0}}}});O.setTab('chat');ta.focus();onInput()};
O.insertText=t=>{ta.value=t;onInput();ta.focus()};
function onFiles(){const files=[...fileIn.files];fileIn.value='';for(const f of files){
  const mi=S.model&&O.modelInfo(S.model.providerID,S.model.modelID);
  if(!(f.type||'').startsWith('text/')&&mi&&mi.attachment===false){O.toast('Эта модель не принимает вложения');continue}
  if(f.size>8e6){O.toast(f.name+' слишком большой (макс. 8 МБ)');continue}
  const r=new FileReader();r.onload=()=>{atts.push({type:'file',mime:f.type||'application/octet-stream',filename:f.name,url:r.result});renderAtts()};r.readAsDataURL(f)}}
// Accepts [{mime,filename,data}] from the native share intent and turns them into attachments.
O.chatAttach=list=>{
  const mi=S.model&&O.modelInfo(S.model.providerID,S.model.modelID);
  (list||[]).slice(0,8).forEach(f=>{
    if(!f||!f.data)return;
    const mime=f.mime||'application/octet-stream';
    if(!mime.startsWith('text/')&&!mime.startsWith('image/')&&mime!=='application/pdf'&&mi&&mi.attachment===false){
      O.toast(O.tr('This model does not accept attachments','Эта модель не принимает вложения'));return;
    }
    atts.push({type:'file',mime,filename:f.filename||'shared',url:'data:'+mime+';base64,'+f.data});
  });
  renderAtts();
};
// Vision attachments (already-shaped file parts with data URLs) from the file viewer / analysis.
O.chatAttachVision=list=>{
  (list||[]).slice(0,4).forEach(a=>{if(a&&a.url)atts.push(a)});
  renderAtts();
};
function renderAtts(){attsEl.textContent='';attsEl.classList.toggle('hide',!atts.length);
  atts.forEach((a,i)=>{
    // tap the chip body → preview (013); long-press → OCR for images (014)
    const chip=h('span',{class:'chip att-chip',onclick:e=>{if(e.target.closest('button'))return;O.previewAttachment&&O.previewAttachment(a)}},
      a.mime.startsWith('image/')?h('img',{src:a.url,style:{height:'22px',borderRadius:'4px'}}):O.fileIcon(a.filename),
      h('span',null,a.filename),
      a._ocr?h('span',{class:'ocr-badge',title:O.tr('Text extracted','Текст извлечён')},O.icon('doc')):null,
      h('button',{onclick:()=>{atts.splice(i,1);renderAtts();updateSend();saveDraftNow()}},O.icon('x')));
    if(a.mime.startsWith('image/')&&window.OC&&OC.ocrImage){
      O.longPress(chip,async()=>{
        O.toast(O.tr('Reading text from image…','Читаю текст с картинки…'),1500);
        const t=await O.ocrAttachment(a);
        if(t){a._ocr=t;renderAtts();O.toast(O.tr('Text extracted — will ride along the prompt','Текст извлечён — добавится к запросу'),2200)}
        else O.toast(O.tr('No text found','Текст не найден'),2000);
      },550);
    }
    attsEl.append(chip);
  });
  updateSend();saveDraftNow()}
let sending=false;
// modelOverride (audit #8): one-shot model for THIS send, no global mutation/timer race.
async function onSend(modelOverride,fromQueue){
  const sendModel=modelOverride||S.model;
  // A double tap (or a queued click after a slow frame) must never send the prompt twice.
  if(sending)return false;
  if(busy()&&!ta.value.trim()&&!atts.length){
    // Smart stop (47): abort, then the same button becomes "continue from the cut" via the bar.
    try{await api('POST','/session/'+S.sid+'/abort',{});O.toast(O.tr('Stopped — «Continue» resumes from the cut','Остановлено — «Продолжить» доскажет с места обрыва'),2600)}catch(e){O.toast(e.message)}
    return}
  const text=ta.value.trim();
  if(!text&&!atts.length){
    if(S.sid&&O.canContinue&&O.canContinue(S.sid)){O.continueGeneration();return}
    return}
  sending=true;setTimeout(()=>{sending=false},800);
  if(O.native.haptic)O.native.haptic('light');
  flyBubble(text);
  const cm=/^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  if(cm){const b=BUILTINS.find(x=>x.n===cm[1]);if(b){clear();b.run(cm[2]);return}
    const sc=(S.commands||[]).find(c=>c.name===cm[1]);
    if(sc){if(!S.model)return O.openConnect();clear();try{const sid=await sess();O.maybeAutoTitle(sid,text);api('POST','/session/'+sid+'/command',{command:sc.name,arguments:cm[2]||'',agent:S.agent,model:modelStr()},{timeout:3600000}).catch(e=>O.toast(e.message))}catch(e){O.toast(e.message)}return}}

  if(!sendModel&&!O.mmActive()){O.toast('Подключите провайдера, чтобы выбрать модель');O.openConnect();return}
  if(text.startsWith('!')){const cmd=text.slice(1).trim();
    if(/^opencode(\s+tui)?\s*$/i.test(cmd)){O.toast('Приложение уже является интерфейсом OpenCode. TUI — во вкладке «Терминал» → Shell, агент — во вкладке «Чат»',6000);clear();return}
    clear();try{const sid=await sess();O.maybeAutoTitle(sid,text);api('POST','/session/'+sid+'/shell',{agent:S.agent,model:S.model,command:cmd},{timeout:3600000}).catch(e=>O.toast(e.message))}catch(e){O.toast(e.message)}return}
  // (7) While the agent is busy a typed message goes to the queue instead of interrupting.
  // FIX (queue never sent): a queued item arriving here while the session still looks busy
  // used to be re-queued forever. fromQueue items always go straight to the model.
  if(!fromQueue&&busy()&&(text||atts.length)&&O.enqueuePrompt&&S.sid){
    O.enqueuePrompt(S.sid,text,draftEx());
    clear();
    O.toast(O.tr('Queued — will send when the agent finishes','В очереди — отправится, когда агент закончит'),2500);
    return false;
  }
  const parts=[];
  if(O.updateReadmeForModel && S.model && S.model.modelID){
    O.updateReadmeForModel(S.model.modelID);
  }
  // (10) Answer style: a short instruction rides along as a synthetic part (not shown as user text).
  const styleTxt=O.answerStyleText?O.answerStyleText():'';
  if(styleTxt)parts.push({type:'text',text:'[Стиль ответа: '+styleTxt+']',synthetic:true});
  // Personal memory (020) + project template (009): hidden instructions ride along every prompt.
  const factsTxt=O.userFactsText?O.userFactsText():'';
  if(factsTxt)parts.push({type:'text',text:factsTxt,synthetic:true});
  const tplTxt=O.tplTextFor?O.tplTextFor(S.sid):'';
  if(tplTxt)parts.push({type:'text',text:tplTxt,synthetic:true});
  // Session-scoped jailbreak: injected here (not into the shared AGENTS.md), so it only ever
  // applies to this chat.
  const jbTxt=O.jailbreakPromptFor?O.jailbreakPromptFor(S.sid):'';
  if(jbTxt)parts.push({type:'text',text:jbTxt,synthetic:true});
  // dry-run: propose, never execute
  if(O.dryRun&&O.dryRun())parts.push({type:'text',text:'[РЕЖИМ DRY-RUN: не выполняй команды и не изменяй файлы. Покажи план действий и точные команды/diff, которые ты бы выполнил, и дождись подтверждения.]',synthetic:true});
  if(text)parts.push({type:'text',text});
  mentions.filter(m=>text.includes(m.tok)).forEach(m=>{const p=JSON.parse(JSON.stringify(m.part));if(p.source&&p.source.text){p.source.text.start=text.indexOf(m.tok);p.source.text.end=p.source.text.start+m.tok.length}parts.push(p)});
  atts.forEach(a=>{
    parts.push(a);
    // OCR text (014) rides along as a hidden part so even text-only models can read the screenshot
    if(a._ocr)parts.push({type:'text',text:'[Текст с изображения '+a.filename+']:\n'+a._ocr.slice(0,8000),synthetic:true});
  });
  // Screenshots the agent took mid-turn (phone shot) ride along THIS prompt as real attachments.
  // Lightweight file tree cached for this session's project folder (token-cheap navigation).
  const ft=O.fileTreeFor&&O.fileTreeFor(S.sid);
  if(ft&&ft.text)parts.push({type:'text',text:'[Дерево файлов проекта '+ft.dir+']\n'+ft.text,synthetic:true});
  if(O.takeVisionQueue){
    const vq=O.takeVisionQueue();
    vq.forEach(v=>{parts.push(v);atts.push(v)});
    if(vq.length)renderAtts();
  }
  // Blind model + image attachments: auto-convert to OCR + vision description (hidden text parts).
  if(O.visionFallbackParts){
    try{await O.visionFallbackParts(atts,parts)}catch(_){}
  }
  if(O.mmActive()&&O.mmSend){clear();try{await O.mmSend(text,parts)}catch(e){O.toast(e.message||String(e),4000)}return}
  if(O.pushPromptHistory)O.pushPromptHistory(text);
  O.runHook('onSend',{text,parts,model:S.model,agent:S.agent});
  // Snapshot the tree before the agent can touch it, so this turn can be rolled back.
  if(O.checkpointBeforeSend&&!O.mmActive())O.checkpointBeforeSend(text);
  clear();
  let lastErr=null,usedModel=null,sentMid=null,sentSid=null,sentTries=[];
  const turnStart=Date.now();
  O._fallback=null;
  try{
    const sid=await sess();
    // a chat can live in its own folder; the request must use that directory, not the global one
    if(O.sessionDir&&O.dir!==O.sessionDir(sid)){try{O.dir=O.sessionDir(sid);S.dir=O.dir}catch(_){}}
    O.maybeAutoTitle(sid,text);
    const chain=[sendModel].filter(Boolean).concat(modelOverride?[]:O.fallbackChain());
    const rotTries={};
    for(let i=0;i<chain.length;i++){
      const mdl=chain[i];
      const mid=O.mid();
      try{
        const m=O.upsertMsg({id:mid,sessionID:sid,role:'user',time:{created:Date.now()},agent:S.agent,model:mdl});m.local=true;
        m.parts=parts.map((p,k)=>Object.assign({id:'prt_local'+k,sessionID:sid,messageID:mid},p));bus.emit('msg',sid,m);scrollEnd(true);
        if(O.markInflight)O.markInflight(sid,mid,text);
        await api('POST','/session/'+sid+'/prompt_async',{messageID:mid,agent:S.agent,model:mdl,variant:S.variant||undefined,parts},{timeout:30000});
        usedModel=mdl;lastErr=null;sentMid=mid;sentSid=sid;sentTries=chain.slice(i+1);
        O._turnStart=turnStart;
        break;
      }catch(e){
        lastErr=e;
        const s=O.msgs(sid);s.list=s.list.filter(x=>x.info.id!==mid);s.idx.delete(mid);const el=msgEls.get(mid);if(el){el.remove();msgEls.delete(mid)}
        const isQuota=O.isQuotaError(e);
        const retryable=isQuota||!e.status||e.status>=429;
        // Quota exhausted: try the next key of the same provider before falling back to another model.
        // FIX (audit #7): rotateProviderKey returns true even when EVERY key is exhausted — the
        // old i--;continue looped forever. Cap rotations at the ring size per model.
        if(isQuota&&O.keyRingOf(mdl.providerID).length>1&&(rotTries[mdl.providerID]||0)<O.keyRingOf(mdl.providerID).length){
          rotTries[mdl.providerID]=(rotTries[mdl.providerID]||0)+1;
          const rotated=await O.rotateProviderKey(mdl.providerID,true);
          if(rotated){i--;continue} // retry the same model with the fresh key
        }
        if(i<chain.length-1&&retryable){
          O.toast(O.tr('Model unavailable, trying fallback...','Модель недоступна, пробую резервную…')+' '+(chain[i+1].modelID||''),2500);
          continue;
        }
        break;
      }
    }
    if(lastErr)throw lastErr;
    if(sentTries.length)O._fallback={sid:sentSid,mid:sentMid,parts,tries:sentTries};
    if(usedModel&&sendModel&&(usedModel.providerID!==sendModel.providerID||usedModel.modelID!==sendModel.modelID)){O.setLastFallback({model:usedModel.modelID,at:Date.now()});O.toast(O.tr('Answered by fallback model: ','Ответила резервная модель: ')+usedModel.modelID,2500)}
    else if(O.setLastFallback)O.setLastFallback(null);
    return true;
  }catch(e){
    if(O.clearInflight)O.clearInflight();
    if(O.isQuotaError(e)){
      O.notifyLimit(O.tr('Limit Reached','Лимит исчерпан'),O.tr('Free quota limit reached.','Бесплатные лимиты закончились.'));
      O.showQuotaAccountModal(e.message);
    }else{
      O.toast(e.message,4000);
    }
    ta.value=text;onInput();
    return false;
  }}
function clear(){histIdx=-1;clearTimeout(draftTimer);draftRestoring=false;if(S.sid)O.clearDraft(S.sid);draftSid=S.sid;ta.value='';atts=[];mentions=[];renderAtts();autosize();hidePop();updateSend();if(S.opts.hideKeyboardAfterSend)ta.blur()}
// Send animation (42): a ghost of the bubble lifts off the composer into the feed.
function flyBubble(text){
  if(!O.chatAnim||!O.chatAnim()||!text||!comp)return;
  try{
    const r=comp.getBoundingClientRect();
    const ghost=h('div',{class:'fly-bubble'},text.length>90?text.slice(0,90)+'…':text);
    ghost.style.left=(r.left+14)+'px';ghost.style.top=(r.top+8)+'px';ghost.style.maxWidth=(r.width-28)+'px';
    document.body.append(ghost);
    requestAnimationFrame(()=>{ghost.classList.add('go')});
    setTimeout(()=>ghost.remove(),480);
  }catch(_){}
}
// Programmatic send used by call mode, widgets and the queue: same pipeline as a tapped message.
O.chatSendText=(text,ex)=>{
  const t=String(text||'').trim();
  const hasEx=ex&&((ex.atts&&ex.atts.length)||(ex.mentions&&ex.mentions.length));
  if(!t&&!hasEx)return false;
  if(ex){atts=atts.concat((ex.atts||[]).slice(0,8));mentions=mentions.concat(ex.mentions||[]);renderAtts()}
  ta.value=t;autosize();updateSend();
  // FIX: onSend is async — returning a bare `true` made the queue delete an item that was
  // actually skipped (busy/double-tap guard). Return the promise instead; callers await it.
  try{
    const p=onSend(null,!!(ex&&ex.fromQueue));
    return p&&typeof p.then==='function'?p:true;
  }catch(e){return false}
};
// Shows the agent answer as if it were being typed (purely visual; the real text is already there).
O.chatTypeText=text=>{
  const el=ta;if(!el)return;
  el.placeholder=String(text||'').slice(0,120);
  setTimeout(()=>{if(el.placeholder.startsWith(String(text||'').slice(0,10)))el.placeholder=O.tr('Chat with OpenCode...','Чат с OpenCode...')},4000);
};
// Puts text into the composer and focuses it (used by widgets and prompt actions).
O.insertPrompt=text=>{
  if(!ta)return false;
  ta.value=String(text||'');
  onInput();
  O.setTab('chat');
  try{ta.focus()}catch(_){}
  return true;
};
// Recomputes drawer/header badges: unread counts, pending questions and permissions.
O.updateBadges=()=>{
  try{
    const q=(S.questions||[]).length,p=(S.perms||[]).length;
    const dot=O.$('.top-title-dot');
    if(dot)dot.classList.toggle('hide',!(q||p));
    document.documentElement.dataset.pending=(q+p)?'1':'0';
    bus.emit('badges',{q,p});
  }catch(_){}
};
O.chat={renderAll,sess,focus:()=>ta&&ta.focus(),sendText:O.chatSendText,typeText:O.chatTypeText};
})();
