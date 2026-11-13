(function(){
const O=window.OCM,h=O.h,S=O.S,api=O.api,bus=O.bus;

/**
 * Voice call mode.
 *
 * A normal voice conversation on top of the ordinary agent chat: the user speaks, the transcript
 * becomes the prompt of the current session (with all tools available), the agent works silently,
 * and only the final answer is spoken back. Tool calls, file edits and command output stay visual —
 * they are never read aloud, which keeps the call natural.
 *
 * Flow: STT (continuous, restarts itself) → on final phrase → O.chat.sendText(prompt) → wait for
 * the session to go idle → speak the last assistant message → listen again.
 */
const C=O.call={
  active:false,
  state:'idle',        // idle | listening | thinking | speaking
  partial:'',
  sid:null,
  sttMode:'system',    // system | offline | cloud
  lang:'ru-RU',
  voice:'',
  rate:1.0,
  pitch:1.0,
  handsFree:true,
  startedAt:0,
  turns:0,
  pendingTimer:null,
  lastSpokenMid:null
};

const cfgLoad=()=>{
  const c=O.store.get('call.opts',{});
  C.sttMode=c.sttMode||'system';
  C.lang=c.lang||((O.store.get('lang','ru')==='en')?'en-US':'ru-RU');
  C.voice=c.voice||'';
  C.rate=typeof c.rate==='number'?c.rate:1.0;
  C.pitch=typeof c.pitch==='number'?c.pitch:1.0;
  C.handsFree=c.handsFree!==false;
};
const cfgSave=()=>O.store.set('call.opts',{sttMode:C.sttMode,lang:C.lang,voice:C.voice,rate:C.rate,pitch:C.pitch,handsFree:C.handsFree});

// ---- speech events from the native side ----
O.on('stt',d=>{
  if(!C.active)return;
  if(d.t==='partial'){C.partial=d.text||'';renderCall();return}
  if(d.t==='final'){
    C.partial='';
    const text=String(d.text||'').trim();
    if(!text)return;
    if(isEcho(text))return;           // ignore the tail of our own TTS being picked up by the mic
    submitPhrase(text);
    return;
  }
  if(d.t==='ready'){setState('listening');return}
  if(d.t==='level'){C.level=d.v||0;return}
  if(d.t==='error'){
    if(d.error==='no_recognizer'||d.code===9){
      O.toast(O.tr('Speech recognition is unavailable — check the microphone permission in Settings','Распознавание речи недоступно — проверьте разрешение микрофона в настройках'),4000);
      endCall();
    }
    return;
  }
});

O.on('tts',d=>{
  if(!C.active)return;
  if(d.t==='ready'){C.ttsReady=true;return}
  if(d.t==='start'){setState('speaking');return}
  if(d.t==='done'||d.t==='error'){
    if(C._ttsBatch>0){C._ttsBatch--;return}
    if(C.active&&C.handsFree){setState('listening');O.native.sttStart(C.sttMode,C.lang)}
    else if(C.active)setState('idle');
    return;
  }
});

// ---- state helpers ----
// While a call is active the screen must stay awake and the tab must not be throttled: hold a
// lightweight flag that the native side can read (it already keeps FLAG_KEEP_SCREEN_ON) and expose
// the state so other modules (drawer/overlay) can show a call indicator.
const setCallFlag=v=>{try{O.store.set('call.active',!!v);bus.emit('call',!!v)}catch(_){}};

// ---- core ----
function setState(s){
  if(C.state===s)return;
  C.state=s;
  renderCall();
}
function startCall(){
  if(C.active)return;
  // microphone is required: ask via the native bridge and abort politely if refused
  const perms=(O.native.state&&O.native.state().perms)||{};
  if(perms.mic===false){
    try{OC.grant('mic')}catch(_){}
    O.toast(O.tr('Allow microphone access, then start the call again','Разрешите доступ к микрофону и начните звонок снова'),3500);
    return;
  }
  cfgLoad();
  C.active=true;C.state='listening';C.startedAt=Date.now();C.turns=0;C.partial='';C.ttsReady=false;
  setCallFlag(true);
  C.sid=S.sid;
  O.native.ttsInit(C.voice,C.rate,C.pitch);
  O.native.sttStart(C.sttMode,C.lang);
  openCallSheet();
  O.toast(O.tr('Call started — speak naturally','Звонок начат — говорите свободно'),2000);
}
function endCall(){
  if(!C.active)return;
  C.active=false;C.state='idle';
  setCallFlag(false);
  try{O.native.sttStop()}catch(_){}
  try{O.native.ttsStop()}catch(_){}
  C.partial='';
  const sh=C.sheet;
  closeCallSheet();
  if(sh&&sh.root&&sh.root.isConnected)try{sh.close()}catch(_){}
}
// TTS echo guard: when the microphone hears the phrase we just spoke, drop it.
let recentSpoken=[];
function isEcho(text){
  const norm=s=>String(s||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const n=norm(text);
  if(!n||n.length<4)return false;
  return recentSpoken.some(sp=>sp&&(sp.includes(n)||n.includes(sp.slice(0,Math.max(12,n.length)))));
}

// Sends one spoken phrase as a normal chat message and waits for the agent to finish.
async function submitPhrase(text){
  if(!S.sid){
    try{await O.newSession()}catch(e){O.toast(e.message);return}
  }
  C.turns++;
  setState('thinking');
  try{O.native.sttStop()}catch(_){}
  // keep the chat visually in sync: the user sees what was said
  const sent=O.chat.sendText?O.chat.sendText(text):false;
  if(!sent){setState('listening');O.native.sttStart(C.sttMode,C.lang);return}
  watchTurn(S.sid);
}

// Waits until the session is idle again, then speaks the last assistant text once.
function watchTurn(sid){
  clearInterval(C.pendingTimer);
  let sawBusy=false;
  const started=Date.now();
  C.pendingTimer=setInterval(()=>{
    if(!C.active){clearInterval(C.pendingTimer);return}
    const st=S.status[sid];
    const idle=!st||st.type==='idle';
    if(!idle)sawBusy=true;
    if(Date.now()-started>240000){clearInterval(C.pendingTimer);setState('idle');return}
    if(idle&&sawBusy===true){ /* busy finished */ }
    if(idle&&(sawBusy||Date.now()-started>2500)){
      const m=O.lastAssistant?(O.lastAssistant(sid)):null;
      if(m&&m.msg&&m.msg.info&&m.msg.info.id!==C.lastSpokenMid&&m.text){
        C.lastSpokenMid=m.msg.info.id;
        clearInterval(C.pendingTimer);
        speakAnswer(m.text);
        return;
      }
      // nothing new yet: keep waiting a little (final part events can land after idle)
      if(Date.now()-started>8000){clearInterval(C.pendingTimer);setState('idle');if(C.handsFree)O.native.sttStart(C.sttMode,C.lang)}
    }
  },700);
}

function speakAnswer(text){
  // Only the prose is spoken: tool cards, diffs and command output remain visual.
  const spoken=String(text||'')
    .replace(/```[\s\S]*?```/g,' ')
    .replace(/^\s*[-+]\d+.*$/gm,'')
    .trim();
  if(!spoken){setState('listening');O.native.sttStart(C.sttMode,C.lang);return}
  // chunk by sentences: the first sentence starts playing immediately
  const chunks=spoken.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const parts=[];
  let buf='';
  chunks.forEach(c=>{ if((buf+' '+c).length>420){if(buf)parts.push(buf);buf=c}else buf=buf?buf+' '+c:c });
  if(buf)parts.push(buf);
  C._ttsBatch=Math.max(0,parts.length-1);
  recentSpoken=parts.map(p=>String(p).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()).filter(Boolean);
  setState('speaking');
  parts.forEach(p=>O.native.ttsSpeak(p));
}

// ---- UI ----
function openCallSheet(){
  const body=h('div',{class:'call-body'});
  const s=O.sheet(O.tr('Call','Звонок'),body,{full:true,onClose:()=>{if(C.active)endCall()}});
  C.sheet=s;
  renderCall();
}
function closeCallSheet(){C.sheet=null}
function renderCall(){
  const s=C.sheet;
  if(!s||!s.root||!s.root.isConnected)return;
  const body=s.body;
  body.textContent='';
  const labels={idle:O.tr('Paused','Пауза'),listening:O.tr('Listening','Слушаю'),thinking:O.tr('Working','Работает'),speaking:O.tr('Speaking','Говорю')};
  const colors={idle:'#71717a',listening:'#22c55e',thinking:'#fab283',speaking:'#38bdf8'};
  const ring=h('div',{class:'call-orb',style:{borderColor:colors[C.state],boxShadow:'0 0 0 8px '+colors[C.state]+'22'}},
    O.icon(C.state==='thinking'?'cpu':C.state==='speaking'?'wave':'mic'));
  const timer=h('div',{class:'mut s call-timer'},fmtDur(Date.now()-C.startedAt)+' · '+C.turns+' '+O.tr('turns','реплик'));
  const st=h('div',{style:{fontSize:'15px',fontWeight:'600',marginTop:'6px'}},labels[C.state]||C.state);
  const live=h('div',{class:'mut',style:{minHeight:'42px',margin:'14px 6px',fontSize:'14px',lineHeight:'1.5',textAlign:'center'}},
    C.partial||(C.state==='thinking'?O.tr('The agent is working silently — files and commands are not read aloud','Агент работает молча — файлы и команды не озвучиваются'):''));
  const ctrls=h('div',{style:{display:'flex',gap:'10px',justifyContent:'center',marginTop:'8px',flexWrap:'wrap'}},
    h('button',{class:'btn ',onclick:()=>{if(C.state==='listening'){O.native.sttStop();setState('idle')}else{O.native.sttStart(C.sttMode,C.lang);setState('listening')}}},
      O.icon(C.state==='listening'?'pause':'mic'),C.state==='listening'?O.tr('Mute','Без звука'):O.tr('Speak','Говорить')),
    h('button',{class:'btn',onclick:()=>{O.native.ttsStop();if(C.handsFree){O.native.sttStart(C.sttMode,C.lang);setState('listening')}}},O.icon('stop'),O.tr('Skip speech','Пропустить')),
    h('button',{class:'btn dng',onclick:endCall},O.icon('x'),O.tr('End call','Завершить')));
  const opts=h('div',{style:{display:'flex',gap:'6px',justifyContent:'center',flexWrap:'wrap',marginTop:'14px'}},
    h('button',{class:'chip',onclick:()=>{C.handsFree=!C.handsFree;cfgSave();renderCall();O.toast(C.handsFree?O.tr('Hands-free on','Свободные руки вкл'):O.tr('Hands-free off','Свободные руки выкл'),1500)}},O.icon('refresh'),C.handsFree?O.tr('Hands-free: on','Свободные руки: вкл'):O.tr('Hands-free: off','Свободные руки: выкл')),
    h('button',{class:'chip',onclick:()=>openCallSettings()},O.icon('sliders'),O.tr('Voice settings','Настройки голоса')));
  body.append(h('div',{class:'call-center'},ring,st,timer,live,ctrls,opts));
  timer.textContent=fmtDur(Date.now()-C.startedAt)+' · '+C.turns+' '+O.tr('turns','реплик');
  if(!renderCall._t){
    renderCall._t=setInterval(()=>{
      if(!C.active||!C.sheet||!C.sheet.root||!C.sheet.root.isConnected){clearInterval(renderCall._t);renderCall._t=null;return}
      const el=C.sheet.body.querySelector('.call-timer');
      if(el)el.textContent=fmtDur(Date.now()-C.startedAt)+' · '+C.turns+' '+O.tr('turns','реплик');
    },1000);
  }
}
function fmtDur(ms){const s=Math.max(0,Math.floor(ms/1000));const m=Math.floor(s/60);return (m?m+':':'0:')+String(s%60).padStart(2,'0')}

function openCallSettings(){
  const body=h('div');
  const s=O.sheet(O.tr('Call settings','Настройки звонка'),body,{hud:true});
  // voices become available only after the engine has initialised
  if(!C.ttsReady)try{O.native.ttsInit(C.voice,C.rate,C.pitch)}catch(_){}
  const redraw=()=>{
    body.textContent='';
    const modes=[['system',O.tr('System engine','Системный движок'),O.tr('What the phone ships with — usually Google, best quality','То, что установлено в системе — обычно Google, лучшее качество')],
                 ['offline',O.tr('On-device (offline)','На устройстве (офлайн)'),O.tr('Android offline model: works without network, lower accuracy','Офлайн-модель Android: работает без сети, точность ниже')],
                 ['cloud',O.tr('Cloud (via system)','Облако (через систему)'),O.tr('Forces online recognition when the engine supports it','Принудительно онлайн-распознавание, если движок поддерживает')]];
    body.append(h('div',{class:'grp'},O.tr('Speech recognition','Распознавание речи')));
    modes.forEach(([id,name,sub])=>body.append(O.listRow('mic',name,sub,C.sttMode===id?O.icon('check','ok'):null,()=>{C.sttMode=id;cfgSave();redraw();O.toast(O.tr('Recognition engine: ','Движок распознавания: ')+name,1800)})));
    body.append(h('div',{class:'grp',style:{marginTop:'12px'}},O.tr('Language','Язык')));
    [['ru-RU','Русский'],['en-US','English'],['de-DE','Deutsch'],['es-ES','Español'],['fr-FR','Français']].forEach(([id,name])=>
      body.append(O.listRow('globe',name,id,C.lang===id?O.icon('check','ok'):null,()=>{C.lang=id;cfgSave();redraw()})));
    body.append(h('div',{class:'grp',style:{marginTop:'12px'}},O.tr('Speech output','Озвучка')));
    const vs=O.native.ttsVoices?O.native.ttsVoices():[];
    body.append(O.listRow('wave',O.tr('Voice','Голос'),C.voice||O.tr('system default','по умолчанию'),O.icon('chevR'),()=>{
      O.actions(O.tr('Voice','Голос'),[{label:O.tr('System default','Системный'),icon:'check',fn:()=>{C.voice='';cfgSave();O.native.ttsConfigure('',C.rate,C.pitch);redraw()}}]
        .concat(vs.slice(0,40).map(v=>({label:v.label||v.id,icon:'wave',fn:()=>{C.voice=v.id;cfgSave();O.native.ttsConfigure(C.voice,C.rate,C.pitch);redraw()}}))));
    }));
    const rateRow=h('div',{class:'settings-row'},
      h('div',{class:'settings-row-icon'},O.icon('zap')),
      h('div',{class:'settings-row-text'},h('b',null,O.tr('Speed','Скорость')),h('span',null,C.rate.toFixed(2)+'x')),
      h('input',{type:'range',min:'0.5',max:'1.8',step:'0.05',value:C.rate,style:{width:'120px'},oninput:e=>{C.rate=parseFloat(e.target.value);O.native.ttsConfigure(C.voice,C.rate,C.pitch);cfgSave();rateRow.querySelector('span').textContent=C.rate.toFixed(2)+'x'}}));
    const pitchRow=h('div',{class:'settings-row'},
      h('div',{class:'settings-row-icon'},O.icon('sliders')),
      h('div',{class:'settings-row-text'},h('b',null,O.tr('Pitch','Тон')),h('span',null,C.pitch.toFixed(2))),
      h('input',{type:'range',min:'0.6',max:'1.5',step:'0.05',value:C.pitch,style:{width:'120px'},oninput:e=>{C.pitch=parseFloat(e.target.value);O.native.ttsConfigure(C.voice,C.rate,C.pitch);cfgSave();pitchRow.querySelector('span').textContent=C.pitch.toFixed(2)}}));
    body.append(rateRow,pitchRow);
    body.append(h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:()=>O.native.ttsSpeak(O.tr('Привет! Так я буду отвечать во время звонка.','Hi! This is how I will sound during the call.'))},O.icon('play'),O.tr('Test voice','Проверить голос')));
    body.append(h('div',{class:'note',style:{marginTop:'10px'}},O.tr('During a call the agent runs with full tools: it can edit files, create projects and run commands. Only the final answer is spoken.','Во время звонка агент работает со всеми инструментами: правит файлы, создаёт проекты и запускает команды. Озвучивается только финальный ответ.')));
  };
  redraw();
}

// Mic button behaviour: tap = call mode, long-press = one-shot dictation into the composer.
O.callMicPress=()=>{
  if(C.active){endCall();return}
  startCall();
};
O.startCall=startCall;
O.openCallSettings=openCallSettings;
O.endCall=endCall;
O.callActive=()=>C.active;
})();