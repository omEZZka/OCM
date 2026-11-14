(function(){
const O=window.OCM,h=O.h,S=O.S,bus=O.bus;

/**
 * Voice call mode.
 *
 * Conversation loop: listen → (silence) → send → agent works silently with all tools → speak the
 * answer → listen again. The call is a first-class background object: it can be minimised, the user
 * can work in other sessions meanwhile, and only one call may exist at a time.
 *
 * Screen: transcript of everything the agent sends (same messages as the chat, plus what was said
 * aloud), live mic level, per-turn timing, and the controls.
 */
const C=O.call={
  active:false,
  minimised:false,
  state:'idle',            // idle | listening | thinking | speaking
  partial:'',
  sid:null,
  sttMode:'system',
  lang:'ru-RU',
  voice:'',
  rate:1.0,
  pitch:1.0,
  handsFree:true,
  bargeIn:true,
  interrupted:false,
  autoSendMs:1700,
  readReplies:true,        // speak the final answer
  readThinking:false,      // speak reasoning fragments too (off by default: noisy)
  startedAt:0,
  turns:0,
  timer:null,
  turnTimer:null,
  lastSpokenMid:null,
  lastReadId:null,
  level:0,
  speakingStarted:0,
  bias:[],
  log:[]                   // [{who:'user'|'agent'|'note', text, at}]
};

const cfgLoad=()=>{
  const c=O.store.get('call.opts',{});
  C.sttMode=c.sttMode||'system';
  C.lang=c.lang||((O.store.get('lang','ru')==='en')?'en-US':'ru-RU');
  C.voice=c.voice||'';
  C.rate=typeof c.rate==='number'?c.rate:1.0;
  C.pitch=typeof c.pitch==='number'?c.pitch:1.0;
  C.handsFree=c.handsFree!==false;
  C.bargeIn=c.bargeIn!==false;
  C.readReplies=c.readReplies!==false;
  C.readThinking=c.readThinking===true;
  C.autoSendMs=typeof c.autoSendMs==='number'?c.autoSendMs:1700;
};
const cfgSave=()=>O.store.set('call.opts',{sttMode:C.sttMode,lang:C.lang,voice:C.voice,rate:C.rate,pitch:C.pitch,handsFree:C.handsFree,bargeIn:C.bargeIn,readReplies:C.readReplies,readThinking:C.readThinking,autoSendMs:C.autoSendMs});

const buildBias=()=>{
  const out=new Set();
  try{
    O.allModels().slice(0,8).forEach(m=>{if(m.mid)out.add(m.mid)});
    (S.sessions||[]).slice(0,6).forEach(s=>{const t=O.sessionTitle(s);if(t&&t.length<40)out.add(t)});
    (S.agents||[]).slice(0,8).forEach(a=>{if(a.name)out.add(a.name)});
    ['git','npm','docker','bash','python','node','тест','тесты','коммит','рефакторинг','файл','файлы','папка','терминал','проект','сборка']
      .forEach(w=>out.add(w));
  }catch(_){}
  return [...out].slice(0,180);
};

const pushLog=(who,text)=>{
  const t=String(text||'').trim();
  if(!t)return;
  if(C.log.length&&C.log[C.log.length-1].text===t&&C.log[C.log.length-1].who===who)return; // dedupe repeats
  C.log.push({who,text:t,at:Date.now()});
  if(C.log.length>150)C.log.splice(0,C.log.length-150);
  renderTranscript();
};

// ---- microphone button: choose dictation or a call ----
O.onMicChoice=()=>{
  if(C.active){
    O.actions(O.tr('Call is running','Звонок идёт'),[
      {label:O.tr('Open call screen','Открыть экран звонка'),icon:'wave',fn:()=>restoreCall()},
      {label:O.tr('End call','Завершить звонок'),icon:'x',danger:true,fn:()=>endCall()},
    ]);
    return;
  }
  O.actions(O.tr('Microphone','Микрофон'),[
    {label:O.tr('Voice message (dictation)','Голосовое сообщение (диктовка)'),sub:O.tr('Speak once, text goes to the input field','Сказать один раз, текст попадёт в поле ввода'),icon:'mic',fn:()=>O.voiceDictate()},
    {label:O.tr('Call with the agent','Звонок с агентом'),sub:O.tr('Live conversation; tools run silently','Живой разговор; инструменты выполняются молча'),icon:'wave',fn:()=>startCall()},
  ]);
};

O.voiceDictate=()=>{
  const perms=(O.native.state&&O.native.state().perms)||{};
  if(perms.mic===false){try{OC.grant('mic')}catch(_){}O.toast(O.tr('Allow microphone access','Разрешите доступ к микрофону'),3000);return}
  cfgLoad();
  const ta=O.$('#composer textarea');
  const base=ta?ta.value:'';
  let done=false;
  const restore=()=>{if(ta)ta.placeholder=O.tr('Chat with OpenCode...','Чат с OpenCode...')};
  const stop=()=>{try{O.native.sttStop()}catch(_){};try{off&&off()}catch(_){}};
  const commit=txt=>{
    if(done)return;
    done=true;stop();restore();
    const t=String(txt||'').trim();
    if(!t){O.toast(O.tr('No speech detected','Речь не распознана'),2200,'error');return}
    if(O.insertText)O.insertText(base?(base+' '+t):t);
    O.setTab('chat');
  };
  const off=O.on('stt',d=>{
    if(done)return;
    if(d.t==='partial'&&ta&&!ta.value.trim())ta.placeholder=d.text||'';
    // 'final' may arrive after the recogniser already stopped on its own
    if(d.t==='final'){commit(d.text);return}
    if(d.t==='empty'){done=true;stop();restore();O.toast(O.tr('No speech detected','Речь не распознана'),2200,'error');return}
    if(d.t==='error'){done=true;stop();restore();O.toast(O.tr('Voice input error','Ошибка голосового ввода'),2500,'error')}
  });
  O.toast(O.tr('Listening... speak now','Слушаю... говорите'),2000);
  // one-shot: the native side delivers exactly one phrase and stops by itself
  O.native.sttStart(C.sttMode,C.lang,buildBias(),true);
  setTimeout(()=>{if(!done){stop();restore();O.toast(O.tr('No speech detected','Речь не распознана'),2500,'error')}},30000);
};

// ---- speech events ----
O.on('stt',d=>{
  if(!C.active)return;
  if(d.t==='level'){
    C.level=d.v||0;
    // Two independent barge-in triggers. RMS alone was unreliable: the echo canceller keeps the
    // level low even when the user clearly speaks, so the agent finished its whole answer first.
    if(C.state==='speaking'&&C.bargeIn&&C.level>6&&Date.now()-C.speakingStarted>900)interruptAgent();
    return;
  }
  if(d.t==='begin'){
    // The recogniser heard a human voice. While the agent speaks this is the most reliable
    // interruption signal we get from the platform.
    if(C.state==='speaking'&&C.bargeIn&&Date.now()-C.speakingStarted>700)interruptAgent();
    return;
  }
  if(d.t==='partial'){
    C.partial=d.text||'';
    renderLive();
    clearTimeout(C.turnTimer);
    if(!C.partial.trim())return;
    // While the agent is talking, a partial that is clearly our own voice is ignored; anything else
    // starts the countdown for a new turn, which is what "barge-in" means in practice.
    if(C.state==='speaking'&&isEcho(C.partial))return;
    C.turnTimer=setTimeout(()=>commitTurn(),C.autoSendMs);
    return;
  }
  if(d.t==='final'){
    const text=String(d.text||'').trim();
    C.partial='';
    clearTimeout(C.turnTimer);
    if(!text||isEcho(text))return;
    // If the user interrupts while the answer is still playing, that phrase starts a new turn.
    if(C.state==='speaking'){try{O.native.ttsStop()}catch(_){}C._ttsBatch=0}
    commitTurn(text);
    return;
  }
  if(d.t==='ready'){if(C.state!=='speaking')setState('listening');return}
  if(d.t==='offline'){O.toast(O.tr('Recognition needs network','Для распознавания нужна сеть'),3000);return}
  if(d.t==='error'){
    if(d.error==='no_recognizer'||d.error==='no_permission'){
      pushLog('note',O.tr('Microphone unavailable','Микрофон недоступен'));
      O.toast(O.tr('Microphone is unavailable — check permissions','Микрофон недоступен — проверьте разрешения'),4000);
      endCall();
    }
    return;
  }
});

O.on('tts',d=>{
  if(!C.active)return;
  if(d.t==='ready'){C.ttsReady=true;return}
  if(d.t==='start'){C.speakingStarted=Date.now();setState('speaking');armDuringPlayback();return}
  if(d.t==='done'||d.t==='error'){
    if(C.interrupted){C._ttsBatch=0;return}   // user took the floor: stay silent
    if(C._ttsBatch>0){C._ttsBatch--;return}
    resumeListening();
  }
});

// Every message the agent produces is mirrored into the call transcript, so the screen shows the
// same stream as the chat (text answers, tool results, errors).
bus.on('msg',(sid,m)=>{
  if(!C.active||!m||!m.info||m.info.role!=='assistant')return;
  if(C.sid&&sid!==C.sid)return;
  const id=m.info.id;
  if(id===C.lastReadId)return;
  C.lastReadId=id;
});
bus.on('part',(sid,m,p)=>{
  if(!C.active||sid!==C.sid||!p)return;
  if(p.type==='text'&&p.time&&p.time.end){
    const t=(p.text||'').trim();
    if(t)pushLog('agent',t);
  }else if(p.type==='tool'&&p.state&&p.state.status==='completed'){
    const name=p.tool||'';const inp=p.state.input||{};
    const brief=name==='bash'?(inp.command||''):(inp.filePath||inp.path||inp.query||'');
    if(brief)pushLog('note',name+': '+String(brief).slice(0,120));
  }
});

const norm=s=>String(s||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
let recentSpoken=[];
// Partial transcripts during playback are unreliable: the recogniser often hears the tail of our
// own voice. Compare against word prefixes instead of whole strings, and ignore very short hits.
function isEcho(text){
  const n=norm(text);
  if(!n||n.length<6)return false;
  const words=new Set(n.split(' ').filter(w=>w.length>3));
  return recentSpoken.some(sp=>{
    if(!sp)return false;
    if(sp===n||sp.includes(n)||n.includes(sp))return true;
    // e.g. spoken "создам файл тест" vs heard "создам файл": most long words overlap
    const spw=new Set(sp.split(' ').filter(w=>w.length>3));
    if(!words.size||!spw.size)return false;
    let hit=0;
    for(const w of words)if(spw.has(w))hit++;
    return hit/words.size>0.7;
  });
}

// ---- core ----
const setCallFlag=v=>{try{O.store.set('call.active',!!v);bus.emit('call',!!v)}catch(_){}};
function setState(s){if(C.state===s)return;C.state=s;renderLive();renderOrb()}

function startCall(){
  if(C.active){restoreCall();return}   // only one call at a time
  const perms=(O.native.state&&O.native.state().perms)||{};
  if(perms.mic===false){
    try{OC.grant('mic')}catch(_){}
    O.toast(O.tr('Allow microphone access, then start the call again','Разрешите доступ к микрофону и начните звонок снова'),3500);
    return;
  }
  cfgLoad();
  C.bias=buildBias();
  C.active=true;C.minimised=false;C.state='listening';C.startedAt=Date.now();C.turns=0;
  C.partial='';C.ttsReady=false;C.lastSpokenMid=null;C.lastReadId=null;C.log=[];
  C.sid=S.sid;
  setCallFlag(true);
  O.native.ttsInit(C.voice,C.rate,C.pitch);
  try{O.native.callAudio(true)}catch(_){}
  listen();
  openCallSheet();
  pushLog('note',O.tr('Call started','Звонок начат'));
  O.toast(O.tr('Call started — speak naturally','Звонок начат — говорите свободно'),2000);
}
function endCall(){
  if(!C.active)return;
  C.active=false;C.minimised=false;C.state='idle';
  setCallFlag(false);
  clearTimeout(C.turnTimer);clearInterval(C.timer);
  try{O.native.sttStop()}catch(_){}
  try{O.native.ttsStop()}catch(_){}
  try{O.native.callAudio(false)}catch(_){}
  C.partial='';
  const sh=C.sheet;
  C.sheet=null;
  if(sh&&sh.root&&sh.root.isConnected)try{sh.close()}catch(_){}
  const pill=C.pill;
  C.pill=null;
  if(pill&&pill.isConnected)try{pill.remove()}catch(_){}
}
function listen(){
  if(!C.active)return;
  clearTimeout(C.turnTimer);
  setState('listening');
  O.native.sttStart(C.sttMode,C.lang,C.bias);
}
// During playback the microphone stays open (that is the whole point of barge-in), but its text
// must not be treated as a new turn unless it survives the echo guard.
function armDuringPlayback(){
  if(!C.active||!C.bargeIn)return;
  try{O.native.sttStart(C.sttMode,C.lang,C.bias)}catch(_){}
}
function resumeListening(){
  if(!C.active)return;
  if(C.handsFree)listen();else setState('idle');
}
function interruptAgent(){
  try{O.native.ttsStop()}catch(_){}
  C._ttsBatch=0;
  C.interrupted=true;
  setState('listening');
  // Do not restart the recogniser here: it is already listening during playback, and restarting
  // throws away the partial that caused the interruption.
  O.toast(O.tr('Interrupted — listening','Перебил — слушаю'),1200);
}

// ---- one turn ----
async function commitTurn(spoken){
  const text=String(spoken||C.partial||'').trim();
  if(!text||C.state==='thinking')return;
  C.partial='';clearTimeout(C.turnTimer);
  try{O.native.sttStop()}catch(_){}
  try{O.native.ttsStop()}catch(_){}
  C._ttsBatch=0;C.interrupted=false;
  C.turns++;
  pushLog('user',text);
  setState('thinking');
  if(!S.sid){try{await O.newSession()}catch(e){O.toast(e.message);setState('idle');return}}
  const sent=O.chat.sendText?O.chat.sendText(text):false;
  if(!sent){setState('listening');listen();return}
  watchTurn(S.sid);
}
function watchTurn(sid){
  clearInterval(C.timer);
  let sawBusy=false;
  const started=Date.now();
  C.timer=setInterval(()=>{
    if(!C.active){clearInterval(C.timer);return}
    const st=S.status[sid];
    const idle=!st||st.type==='idle';
    if(!idle)sawBusy=true;
    if(Date.now()-started>240000){clearInterval(C.timer);setState('idle');return}
    if(idle&&(sawBusy||Date.now()-started>2500)){
      const m=O.lastAssistant?(O.lastAssistant(sid)):null;
      if(m&&m.msg&&m.msg.info&&m.msg.info.id!==C.lastSpokenMid&&m.text){
        C.lastSpokenMid=m.msg.info.id;
        clearInterval(C.timer);
        speakAnswer(m.text);
        return;
      }
      if(Date.now()-started>8000){clearInterval(C.timer);resumeListening()}
    }
  },700);
}
function speakAnswer(text){
  const spoken=String(text||'').replace(/```[\s\S]*?```/g,' ').replace(/^\s*[-+]\d+.*$/gm,'').trim();
  if(!spoken||!C.readReplies){resumeListening();return}
  const chunks=spoken.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const parts=[];let buf='';
  chunks.forEach(c=>{if((buf+' '+c).length>420){if(buf)parts.push(buf);buf=c}else buf=buf?buf+' '+c:c});
  if(buf)parts.push(buf);
  C._ttsBatch=Math.max(0,parts.length-1);
  recentSpoken=parts.map(norm).filter(Boolean);
  C.speakingStarted=Date.now();
  setState('speaking');
  parts.forEach(p=>O.native.ttsSpeak(p));
}

// ---- UI: call screen ----
function openCallSheet(){
  const body=h('div',{class:'call-body'});
  const s=O.sheet(O.tr('Call','Звонок'),body,{full:true,onClose:()=>{minimiseCall()}});
  // a burst of taps can return the "blocked" stub; retry shortly instead of building into a ghost
  if(!s||s.blocked||!s.body||!s.root||!s.root.isConnected){setTimeout(()=>{if(C.active&&!C.sheet)openCallSheet()},320);return}
  C.sheet=s;C.minimised=false;
  s.body.append(buildCallUI());
}
function restoreCall(){
  if(!C.active)return;
  if(C.sheet&&C.sheet.root&&C.sheet.root.isConnected){clearPill();return}
  openCallSheet();
  clearPill();
}
function minimiseCall(){
  if(!C.active)return;
  if(C.sheet)C.sheet=null;
  showPill();
}
function clearPill(){const p=C.pill;C.pill=null;if(p&&p.isConnected)try{p.remove()}catch(_){}}
function showPill(){
  if(!C.active)return;
  clearPill();
  const labels={idle:O.tr('Paused','Пауза'),listening:O.tr('Listening','Слушаю'),thinking:O.tr('Working','Работает'),speaking:O.tr('Speaking','Говорю')};
  const colors={idle:'#71717a',listening:'#22c55e',thinking:'#fab283',speaking:'#38bdf8'};
  const pill=h('button',{id:'call-pill',class:'call-pill',onclick:restoreCall},
    h('i',{class:'call-pill-dot',style:{background:colors[C.state]||'#71717a'}}),
    O.icon('wave'),
    h('span',{class:'call-pill-txt'},labels[C.state]||C.state),
    h('span',{class:'call-pill-time'},fmtDur(Date.now()-C.startedAt)),
    h('button',{class:'ibtn s',onclick:e=>{e.stopPropagation();endCall()}},O.icon('x')));
  document.body.append(pill);
  C.pill=pill;
  clearInterval(C.pillT);
  C.pillT=setInterval(()=>{
    if(!C.active||!pill.isConnected){clearInterval(C.pillT);return}
    const d=pill.querySelector('.call-pill-time');if(d)d.textContent=fmtDur(Date.now()-C.startedAt);
    const dot=pill.querySelector('.call-pill-dot');if(dot)dot.style.background=colors[C.state]||'#71717a';
    const t=pill.querySelector('.call-pill-txt');if(t)t.textContent=labels[C.state]||C.state;
  },1000);
}

function buildCallUI(){
  const wrap=h('div',{class:'call-body'});
  const orb=h('div',{class:'call-orb-wrap'});
  const live=h('div',{class:'mut call-live',style:{minHeight:'38px',margin:'2px 6px 10px',fontSize:'13.5px',lineHeight:'1.45',textAlign:'center'}});
  const tr=h('div',{class:'call-transcript'});
  const ctrls=h('div',{class:'call-ctrls'});
  const opts=h('div',{class:'call-opts'});
  wrap.append(orb,live,tr,ctrls,opts);
  C._ui={wrap,orb,live,tr,ctrls,opts};
  renderOrb();renderLive();renderTranscript();renderControls();
  return wrap;
}

function renderOrb(){
  const ui=C._ui;
  const host=ui?ui.orb:(C.sheet&&C.sheet.body.querySelector('.call-orb-wrap'));
  if(!host)return;
  const colors={idle:'#71717a',listening:'#22c55e',thinking:'#fab283',speaking:'#38bdf8'};
  const labels={idle:O.tr('Paused','Пауза'),listening:O.tr('Listening','Слушаю'),thinking:O.tr('Working','Работает'),speaking:O.tr('Speaking','Говорю')};
  const col=colors[C.state]||'#71717a';
  const lvl=C.state==='listening'?Math.max(0,Math.min(10,C.level)):0;
  host.textContent='';
  host.append(
    h('div',{class:'call-orb',style:{borderColor:col,borderWidth:(3+lvl*0.45).toFixed(1)+'px',boxShadow:'0 0 0 10px '+col+'22'}},
      O.icon(C.state==='thinking'?'cpu':C.state==='speaking'?'wave':'mic')),
    h('div',{class:'call-state',style:{color:col}},labels[C.state]||C.state),
    h('div',{class:'mut s call-timer'},fmtDur(Date.now()-C.startedAt)+' · '+C.turns+' '+O.tr('turns','реплик')));
}
function renderLive(){
  const ui=C._ui;
  const el=ui?ui.live:(C.sheet&&C.sheet.body.querySelector('.call-live'));
  if(!el)return;
  el.textContent=C.partial||(C.state==='thinking'
    ?O.tr('The agent works silently — files and commands are not read aloud','Агент работает молча — файлы и команды не озвучиваются')
    :(C.state==='speaking'&&C.bargeIn?O.tr('Speak to interrupt','Скажите что-нибудь, чтобы перебить'):''));
}
function renderTranscript(){
  const ui=C._ui;
  const el=ui?ui.tr:(C.sheet&&C.sheet.body.querySelector('.call-transcript'));
  if(!el)return;
  el.textContent='';
  C.log.slice(-60).forEach(e=>{
    el.append(h('div',{class:'call-line '+e.who},
      h('div',{class:'call-bubble'},e.text),
      h('span',{class:'call-time'},new Date(e.at).toTimeString().slice(0,5))));
  });
  el.scrollTop=el.scrollHeight;
}
function renderControls(){
  const ui=C._ui;
  const host=ui?ui.ctrls:(C.sheet&&C.sheet.body.querySelector('.call-ctrls'));
  const optsHost=ui?ui.opts:(C.sheet&&C.sheet.body.querySelector('.call-opts'));
  if(!host||!optsHost)return;
  host.textContent='';
  host.append(
    h('button',{class:'btn',onclick:()=>{if(C.state==='listening'){try{O.native.sttStop()}catch(_){};setState('idle')}else listen()}},
      O.icon(C.state==='listening'?'pause':'mic'),C.state==='listening'?O.tr('Mute','Без звука'):O.tr('Speak','Говорить')),
    h('button',{class:'btn',onclick:()=>{try{O.native.ttsStop()}catch(_){};C._ttsBatch=0;resumeListening()}},O.icon('stop'),O.tr('Skip speech','Пропустить')),
    h('button',{class:'btn',onclick:()=>minimiseCall()},O.icon('chevD'),O.tr('Minimise','Свернуть')),
    h('button',{class:'btn dng',onclick:endCall},O.icon('x'),O.tr('End','Завершить')));
  optsHost.textContent='';
  optsHost.append(
    h('button',{class:'chip',onclick:()=>{C.handsFree=!C.handsFree;cfgSave();renderControls();O.toast(C.handsFree?O.tr('Hands-free on','Свободные руки вкл'):O.tr('Hands-free off','Свободные руки выкл'),1500)}},O.icon('refresh'),C.handsFree?O.tr('Hands-free: on','Свободные руки: вкл'):O.tr('Hands-free: off','Свободные руки: выкл')),
    h('button',{class:'chip',onclick:()=>{C.bargeIn=!C.bargeIn;cfgSave();renderControls()}},O.icon('wave'),C.bargeIn?O.tr('Barge-in: on','Перебивание: вкл'):O.tr('Barge-in: off','Перебивание: выкл')),
    h('button',{class:'chip',onclick:()=>{C.readReplies=!C.readReplies;cfgSave();renderControls()}},O.icon('bulb'),C.readReplies?O.tr('Read answers: on','Читать ответы: вкл'):O.tr('Read answers: off','Читать ответы: выкл')),
    h('button',{class:'chip',onclick:openCallSettings},O.icon('sliders'),O.tr('Settings','Настройки')));
}
function renderCall(){renderOrb();renderLive();renderTranscript();renderControls()}

function fmtDur(ms){const s=Math.max(0,Math.floor(ms/1000));const m=Math.floor(s/60);return m+':'+String(s%60).padStart(2,'0')}

// ---- settings: everything tunable, no "start call" entry ----
function openCallSettings(){
  const body=h('div');
  O.sheet(O.tr('Call & voice settings','Настройки звонка и голоса'),body,{hud:true});
  if(!C.ttsReady)try{O.native.ttsInit(C.voice,C.rate,C.pitch)}catch(_){}
  const redraw=()=>{
    body.textContent='';
    body.append(h('div',{class:'grp'},O.tr('Speech recognition','Распознавание речи')));
    [['system',O.tr('System engine','Системный движок'),O.tr('Best quality, usually needs network','Лучшее качество, обычно нужна сеть')],
     ['offline',O.tr('On-device (offline)','На устройстве (офлайн)'),O.tr('No network, lower accuracy','Без сети, точность ниже')],
     ['cloud',O.tr('Cloud (via system)','Облако (через систему)'),O.tr('Force online recognition when supported','Принудительно онлайн, если поддерживается')]]
      .forEach(([id,name,sub])=>body.append(O.listRow('mic',name,sub,C.sttMode===id?O.icon('check','ok'):null,()=>{C.sttMode=id;cfgSave();redraw()})));
    body.append(h('div',{class:'grp',style:{marginTop:'12px'}},O.tr('Language','Язык')));
    [['ru-RU','Русский'],['en-US','English'],['de-DE','Deutsch'],['es-ES','Español'],['fr-FR','Français']].forEach(([id,name])=>
      body.append(O.listRow('globe',name,id,C.lang===id?O.icon('check','ok'):null,()=>{C.lang=id;cfgSave();redraw()})));

    body.append(h('div',{class:'grp',style:{marginTop:'12px'}},O.tr('Turn taking','Очередность реплик')));
    const slider=(icon,label,key,min,max,step,fmt)=>{
      const row=h('div',{class:'settings-row'},
        h('div',{class:'settings-row-icon'},O.icon(icon)),
        h('div',{class:'settings-row-text'},h('b',null,label),h('span',null,fmt())),
        h('input',{type:'range',min:String(min),max:String(max),step:String(step),value:C[key],style:{width:'130px'},oninput:e=>{
          C[key]=parseFloat(e.target.value);cfgSave();row.querySelector('span').textContent=fmt();
        }}));
      return row;
    };
    body.append(slider('pause',O.tr('Pause before sending','Пауза перед отправкой'),'autoSendMs',800,3500,100,()=>(C.autoSendMs/1000).toFixed(1)+'s'));
    body.append(O.toggleRow('wave',O.tr('Interrupt by voice','Перебивание голосом'),O.tr('Speaking stops the agent mid-answer','Речь останавливает агента посреди ответа'),C.bargeIn,v=>{C.bargeIn=v;cfgSave();redraw()}));
    body.append(O.toggleRow('refresh',O.tr('Hands-free','Свободные руки'),O.tr('Re-open the microphone automatically after each answer','Микрофон открывается сам после каждого ответа'),C.handsFree,v=>{C.handsFree=v;cfgSave();redraw()}));
    body.append(O.toggleRow('bulb',O.tr('Read answers aloud','Озвучивать ответы'),O.tr('Speak the final answer; tool output stays silent','Проговаривать финальный ответ; вывод инструментов — молча'),C.readReplies,v=>{C.readReplies=v;cfgSave();redraw()}));

    body.append(h('div',{class:'grp',style:{marginTop:'12px'}},O.tr('Speech output','Озвучка')));
    const vs=O.native.ttsVoices?O.native.ttsVoices():[];
    body.append(O.listRow('wave',O.tr('Voice','Голос'),C.voice||O.tr('system default','по умолчанию'),O.icon('chevR'),()=>{
      O.actions(O.tr('Voice','Голос'),[{label:O.tr('System default','Системный'),icon:'check',fn:()=>{C.voice='';cfgSave();O.native.ttsConfigure('',C.rate,C.pitch);redraw()}}]
        .concat(vs.slice(0,40).map(v=>({label:v.label||v.id,icon:'wave',fn:()=>{C.voice=v.id;cfgSave();O.native.ttsConfigure(C.voice,C.rate,C.pitch);redraw()}}))));
    }));
    body.append(slider('zap',O.tr('Speed','Скорость'),'rate',0.5,1.8,0.05,()=>C.rate.toFixed(2)+'x'));
    body.append(slider('sliders',O.tr('Pitch','Тон'),'pitch',0.6,1.5,0.05,()=>C.pitch.toFixed(2)));
    body.append(h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:()=>O.native.ttsSpeak(O.tr('Привет! Так я буду отвечать во время звонка.','Hi! This is how I will sound during the call.'))},O.icon('play'),O.tr('Test voice','Проверить голос')));
    body.append(h('div',{class:'note',style:{marginTop:'10px'}},O.tr('During a call the agent keeps full tools: it edits files, creates projects and runs commands. Only the final answer is spoken.','Во время звонка у агента все инструменты: правит файлы, создаёт проекты, запускает команды. Озвучивается только финальный ответ.')));
  };
  redraw();
}

O.startCall=startCall;
O.endCall=endCall;
O.openCallSettings=openCallSettings;
O.callActive=()=>C.active;
O.callState=()=>C.state;
O.callMinimise=minimiseCall;
})();