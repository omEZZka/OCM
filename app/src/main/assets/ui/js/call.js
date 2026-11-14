(function(){
const O=window.OCM,h=O.h,S=O.S,bus=O.bus;

/**
 * Voice call mode.
 *
 * A real conversation loop on top of the normal agent chat:
 *   listen → (silence detected) → send → agent works silently with all tools → speak the answer
 *   → listen again, with the microphone re-opening even while the agent is still finishing.
 *
 * Improvements over the first version:
 *  • end-of-turn is decided by ourselves (VAD on RMS + silence timer), not by the recogniser's
 *    aggressive timeout, so long dictations are not cut mid-sentence;
 *  • the agent can be interrupted by voice (barge-in): while speaking, a loud input stops TTS and
 *    starts a new turn;
 *  • recognition quality: VOICE_RECOGNITION audio source (AEC/NS), biasing strings built from the
 *    project and the current model names, offline fallback when the network dies;
 *  • the call screen shows the live transcript, level meter and per-turn timing.
 */
const C=O.call={
  active:false,
  state:'idle',        // idle | listening | thinking | speaking
  partial:'',
  sid:null,
  sttMode:'system',
  lang:'ru-RU',
  voice:'',
  rate:1.0,
  pitch:1.0,
  handsFree:true,
  bargeIn:true,
  autoSendMs:1700,
  startedAt:0,
  turns:0,
  timer:null,
  turnTimer:null,
  lastSpokenMid:null,
  level:0,
  lastVoiceAt:0,
  speakingStarted:0,
  bias:[]
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
  C.autoSendMs=typeof c.autoSendMs==='number'?c.autoSendMs:1700;
};
const cfgSave=()=>O.store.set('call.opts',{sttMode:C.sttMode,lang:C.lang,voice:C.voice,rate:C.rate,pitch:C.pitch,handsFree:C.handsFree,bargeIn:C.bargeIn,autoSendMs:C.autoSendMs});

// ---- vocabulary that matters for this project ----
// Recognisers are far more accurate when told the words it will hear: file names, folders, commands.
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

// ---- mic press: choose between dictation and a call ----
O.onMicChoice=()=>{
  O.actions(O.tr('Microphone','Микрофон'),[
    {label:O.tr('Voice message (dictation)','Голосовое сообщение (диктовка)'),sub:O.tr('Speak once, text goes to the input field','Сказать один раз, текст попадёт в поле ввода'),icon:'mic',fn:()=>O.voiceDictate()},
    {label:O.tr('Call with the agent','Звонок с агентом'),sub:O.tr('Live conversation; tools run silently','Живой разговор; инструменты выполняются молча'),icon:'wave',fn:()=>O.startCall()},
  ]);
};

// One-shot dictation through the same engine (used by the choice sheet and long-press).
O.voiceDictate=()=>{
  const perms=(O.native.state&&O.native.state().perms)||{};
  if(perms.mic===false){try{OC.grant('mic')}catch(_){}O.toast(O.tr('Allow microphone access','Разрешите доступ к микрофону'),3000);return}
  cfgLoad();
  const ta=O.$('#composer textarea');
  let done=false;
  const stop=()=>{try{O.native.sttStop()}catch(_){};try{off&&off()}catch(_){}};
  const off=O.on('stt',d=>{
    if(done)return;
    if(d.t==='partial'&&ta&&!ta.value.trim())ta.placeholder=d.text||'';
    if(d.t==='final'&&d.text){
      done=true;
      const txt=d.text.trim();
      stop();
      if(ta){ta.placeholder=O.tr('Chat with OpenCode...','Чат с OpenCode...')}
      if(O.insertText)O.insertText(txt);
      O.setTab('chat');
    }
    if(d.t==='error'){done=true;stop();O.toast(O.tr('Voice input error','Ошибка голосового ввода'),2500)}
  });
  O.toast(O.tr('Listening... speak now','Слушаю... говорите'),2000);
  O.native.sttStart(C.sttMode,C.lang,buildBias());
  setTimeout(()=>{if(!done){stop();if(ta)ta.placeholder=O.tr('Chat with OpenCode...','Чат с OpenCode...');O.toast(O.tr('No speech detected','Речь не распознана'),2500)}},30000);
};

// ---- speech events ----
O.on('stt',d=>{
  if(!C.active)return;
  if(d.t==='level'){
    C.level=d.v||0;
    // Barge-in: a loud, sustained input while the agent speaks means the user wants to interrupt.
    if(C.state==='speaking'&&C.bargeIn&&C.level>6&&Date.now()-C.speakingStarted>900){
      interruptAgent();
    }
    return;
  }
  if(d.t==='begin'){C.lastVoiceAt=Date.now();return}
  if(d.t==='partial'){
    C.partial=d.text||'';
    C.lastVoiceAt=Date.now();
    renderCall();
    // silence timer: end the turn once the text stopped growing
    clearTimeout(C.turnTimer);
    if(C.partial.trim())C.turnTimer=setTimeout(()=>commitTurn(),C.autoSendMs);
    return;
  }
  if(d.t==='final'){
    const text=String(d.text||'').trim();
    C.partial='';
    clearTimeout(C.turnTimer);
    if(!text)return;
    if(isEcho(text))return;
    commitTurn(text);
    return;
  }
  if(d.t==='ready'){
    if(C.state!=='speaking')setState('listening');
    return;
  }
  if(d.t==='offline'){O.toast(O.tr('Recognition needs network — check the connection','Для распознавания нужна сеть — проверьте подключение'),3000);return}
  if(d.t==='error'){
    if(d.error==='no_recognizer'||d.error==='no_permission'){
      O.toast(O.tr('Microphone is unavailable — check permissions','Микрофон недоступен — проверьте разрешения'),4000);
      endCall();
    }
    return;
  }
});

O.on('tts',d=>{
  if(!C.active)return;
  if(d.t==='ready'){C.ttsReady=true;return}
  if(d.t==='start'){C.speakingStarted=Date.now();setState('speaking');return}
  if(d.t==='done'||d.t==='error'){
    if(C._ttsBatch>0){C._ttsBatch--;return}
    resumeListening();
    return;
  }
});

// ---- core ----
const setCallFlag=v=>{try{O.store.set('call.active',!!v);bus.emit('call',!!v)}catch(_){}};
function setState(s){if(C.state===s)return;C.state=s;renderCall()}

function startCall(){
  if(C.active)return;
  const perms=(O.native.state&&O.native.state().perms)||{};
  if(perms.mic===false){
    try{OC.grant('mic')}catch(_){}
    O.toast(O.tr('Allow microphone access, then start the call again','Разрешите доступ к микрофону и начните звонок снова'),3500);
    return;
  }
  cfgLoad();
  C.bias=buildBias();
  C.active=true;C.state='listening';C.startedAt=Date.now();C.turns=0;C.partial='';C.ttsReady=false;C.lastSpokenMid=null;
  C.sid=S.sid;
  setCallFlag(true);
  O.native.ttsInit(C.voice,C.rate,C.pitch);
  listen();
  openCallSheet();
  O.toast(O.tr('Call started — speak naturally','Звонок начат — говорите свободно'),2000);
}
function endCall(){
  if(!C.active)return;
  C.active=false;C.state='idle';
  setCallFlag(false);
  clearTimeout(C.turnTimer);
  try{O.native.sttStop()}catch(_){}
  try{O.native.ttsStop()}catch(_){}
  C.partial='';
  const sh=C.sheet;
  closeCallSheet();
  if(sh&&sh.root&&sh.root.isConnected)try{sh.close()}catch(_){}
}
function listen(){
  if(!C.active)return;
  clearTimeout(C.turnTimer);
  setState('listening');
  O.native.sttStart(C.sttMode,C.lang,C.bias);
}
function resumeListening(){
  if(!C.active)return;
  if(C.handsFree)listen();
  else setState('idle');
}
function interruptAgent(){
  // Barge-in: stop the voice and immediately accept the new phrase.
  try{O.native.ttsStop()}catch(_){}
  C._ttsBatch=0;
  setState('listening');
  O.native.sttStart(C.sttMode,C.lang,C.bias);
  O.toast(O.tr('Interrupted — listening','Перебил — слушаю'),1200);
}

// ---- echo guard ----
let recentSpoken=[];
const norm=s=>String(s||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function isEcho(text){
  const n=norm(text);
  if(!n||n.length<5)return false;
  return recentSpoken.some(sp=>sp&&(sp===n||sp.includes(n)||n.includes(sp)));
}

// ---- one turn ----
async function commitTurn(spoken){
  const text=String(spoken||C.partial||'').trim();
  if(!text||C.state==='thinking')return;
  C.partial='';
  clearTimeout(C.turnTimer);
  try{O.native.sttStop()}catch(_){}
  C.turns++;
  setState('thinking');
  renderCall();
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
  const spoken=String(text||'')
    .replace(/```[\s\S]*?```/g,' ')
    .replace(/^\s*[-+]\d+.*$/gm,'')
    .trim();
  if(!spoken){resumeListening();return}
  const chunks=spoken.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const parts=[];let buf='';
  chunks.forEach(c=>{if((buf+' '+c).length>420){if(buf)parts.push(buf);buf=c}else buf=buf?buf+' '+c:c});
  if(buf)parts.push(buf);
  C._ttsBatch=Math.max(0,parts.length-1);
  recentSpoken=parts.map(norm).filter(Boolean);
  C.speakingStarted=Date.now();
  setState('speaking');
  parts.forEach(p=>O.native.ttsSpeak(p));
  if(C.sheet)renderCall();
}

// ---- UI ----
function openCallSheet(){
  const body=h('div',{class:'call-body'});
  const s=O.sheet(O.tr('Call','Звонок'),body,{full:true,onClose:()=>{if(C.active)endCall()}});
  C.sheet=s;
  renderCall();
}
function closeCallSheet(){C.sheet=null}
function fmtDur(ms){const s=Math.max(0,Math.floor(ms/1000));const m=Math.floor(s/60);return m+':'+String(s%60).padStart(2,'0')}

function renderCall(){
  const s=C.sheet;
  if(!s||!s.root||!s.root.isConnected)return;
  const body=s.body;
  body.textContent='';
  const labels={idle:O.tr('Paused','Пауза'),listening:O.tr('Listening','Слушаю'),thinking:O.tr('Working','Работает'),speaking:O.tr('Speaking','Говорю')};
  const colors={idle:'#71717a',listening:'#22c55e',thinking:'#fab283',speaking:'#38bdf8'};
  const col=colors[C.state]||'#71717a';
  // level ring: the border thickness follows the input level while listening
  const lvl=C.state==='listening'?Math.max(0,Math.min(10,C.level)):0;
  const ring=h('div',{class:'call-orb',style:{
    borderColor:col,
    borderWidth:(3+lvl*0.45).toFixed(1)+'px',
    boxShadow:'0 0 0 10px '+col+'22'
  }},O.icon(C.state==='thinking'?'cpu':C.state==='speaking'?'wave':'mic'));
  const timer=h('div',{class:'mut s call-timer'},fmtDur(Date.now()-C.startedAt)+' · '+C.turns+' '+O.tr('turns','реплик'));
  const st=h('div',{style:{fontSize:'15px',fontWeight:'600',marginTop:'6px'}},labels[C.state]||C.state);
  const hint=C.state==='thinking'
    ?O.tr('The agent works silently — files and commands are not read aloud','Агент работает молча — файлы и команды не озвучиваются')
    :(C.state==='speaking'&&C.bargeIn?O.tr('Speak to interrupt','Скажите что-нибудь, чтобы перебить'):'');
  const live=h('div',{class:'mut',style:{minHeight:'44px',margin:'14px 6px',fontSize:'14px',lineHeight:'1.5',textAlign:'center'}},C.partial||hint);
  const ctrls=h('div',{style:{display:'flex',gap:'10px',justifyContent:'center',marginTop:'8px',flexWrap:'wrap'}},
    h('button',{class:'btn',onclick:()=>{
      if(C.state==='listening'){try{O.native.sttStop()}catch(_){};setState('idle')}
      else{listen()}
    }},O.icon(C.state==='listening'?'pause':'mic'),C.state==='listening'?O.tr('Mute','Без звука'):O.tr('Speak','Говорить')),
    h('button',{class:'btn',onclick:()=>{try{O.native.ttsStop()}catch(_){};C._ttsBatch=0;resumeListening()}},O.icon('stop'),O.tr('Skip speech','Пропустить')),
    h('button',{class:'btn dng',onclick:endCall},O.icon('x'),O.tr('End call','Завершить')));
  const opts=h('div',{style:{display:'flex',gap:'6px',justifyContent:'center',flexWrap:'wrap',marginTop:'14px'}},
    h('button',{class:'chip',onclick:()=>{C.handsFree=!C.handsFree;cfgSave();renderCall();O.toast(C.handsFree?O.tr('Hands-free on','Свободные руки вкл'):O.tr('Hands-free off','Свободные руки выкл'),1500)}},O.icon('refresh'),C.handsFree?O.tr('Hands-free: on','Свободные руки: вкл'):O.tr('Hands-free: off','Свободные руки: выкл')),
    h('button',{class:'chip',onclick:()=>{C.bargeIn=!C.bargeIn;cfgSave();renderCall();O.toast(C.bargeIn?O.tr('Interrupt by voice: on','Перебивание голосом: вкл'):O.tr('Interrupt by voice: off','Перебивание голосом: выкл'),1600)}},O.icon('wave'),C.bargeIn?O.tr('Barge-in: on','Перебивание: вкл'):O.tr('Barge-in: off','Перебивание: выкл')),
    h('button',{class:'chip',onclick:openCallSettings},O.icon('sliders'),O.tr('Voice settings','Настройки голоса')));
  body.append(h('div',{class:'call-center'},ring,st,timer,live,ctrls,opts));
  if(!renderCall._t){
    renderCall._t=setInterval(()=>{
      if(!C.active||!C.sheet||!C.sheet.root||!C.sheet.root.isConnected){clearInterval(renderCall._t);renderCall._t=null;return}
      const el=s.body.querySelector('.call-timer');
      if(el)el.textContent=fmtDur(Date.now()-C.startedAt)+' · '+C.turns+' '+O.tr('turns','реплик');
    },1000);
  }
}

function openCallSettings(){
  const body=h('div');
  const s=O.sheet(O.tr('Call settings','Настройки звонка'),body,{hud:true});
  if(!C.ttsReady)try{O.native.ttsInit(C.voice,C.rate,C.pitch)}catch(_){}
  const redraw=()=>{
    body.textContent='';
    const modes=[['system',O.tr('System engine','Системный движок'),O.tr('Best quality, needs network for most engines','Лучшее качество, большинству движков нужна сеть')],
                 ['offline',O.tr('On-device (offline)','На устройстве (офлайн)'),O.tr('Works without network, lower accuracy','Работает без сети, точность ниже')],
                 ['cloud',O.tr('Cloud (via system)','Облако (через систему)'),O.tr('Forces online recognition when supported','Принудительно онлайн, если поддерживается')]];
    body.append(h('div',{class:'grp'},O.tr('Speech recognition','Распознавание речи')));
    modes.forEach(([id,name,sub])=>body.append(O.listRow('mic',name,sub,C.sttMode===id?O.icon('check','ok'):null,()=>{C.sttMode=id;cfgSave();redraw();O.toast(O.tr('Recognition engine: ','Движок: ')+name,1800)})));
    body.append(h('div',{class:'grp',style:{marginTop:'12px'}},O.tr('Language','Язык')));
    [['ru-RU','Русский'],['en-US','English'],['de-DE','Deutsch'],['es-ES','Español'],['fr-FR','Français']].forEach(([id,name])=>
      body.append(O.listRow('globe',name,id,C.lang===id?O.icon('check','ok'):null,()=>{C.lang=id;cfgSave();redraw()})));
    // end-of-turn sensitivity
    const silRow=h('div',{class:'settings-row'},
      h('div',{class:'settings-row-icon'},O.icon('pause')),
      h('div',{class:'settings-row-text'},h('b',null,O.tr('Pause before sending','Пауза перед отправкой')),h('span',null,(C.autoSendMs/1000).toFixed(1)+'s')),
      h('input',{type:'range',min:'800',max:'3500',step:'100',value:C.autoSendMs,style:{width:'120px'},oninput:e=>{
        C.autoSendMs=parseInt(e.target.value,10);cfgSave();silRow.querySelector('span').textContent=(C.autoSendMs/1000).toFixed(1)+'s';
      }}));
    body.append(silRow);
    body.append(h('div',{class:'note',style:{margin:'4px 2px 10px'}},O.tr('Longer pause lets you dictate long tasks without being cut mid-sentence.','Чем больше пауза, тем длиннее можно диктовать без обрыва на полуслове.')));
    body.append(h('div',{class:'grp'},O.tr('Speech output','Озвучка')));
    const vs=O.native.ttsVoices?O.native.ttsVoices():[];
    body.append(O.listRow('wave',O.tr('Voice','Голос'),C.voice||O.tr('system default','по умолчанию'),O.icon('chevR'),()=>{
      O.actions(O.tr('Voice','Голос'),[{label:O.tr('System default','Системный'),icon:'check',fn:()=>{C.voice='';cfgSave();O.native.ttsConfigure('',C.rate,C.pitch);redraw()}}]
        .concat(vs.slice(0,40).map(v=>({label:v.label||v.id,icon:'wave',fn:()=>{C.voice=v.id;cfgSave();O.native.ttsConfigure(C.voice,C.rate,C.pitch);redraw()}}))));
    }));
    [['rate',O.tr('Speed','Скорость'),0.5,1.8,0.05],['pitch',O.tr('Pitch','Тон'),0.6,1.5,0.05]].forEach(([k,label,min,max,step])=>{
      const row=h('div',{class:'settings-row'},
        h('div',{class:'settings-row-icon'},O.icon(k==='rate'?'zap':'sliders')),
        h('div',{class:'settings-row-text'},h('b',null,label),h('span',null,C[k].toFixed(2))),
        h('input',{type:'range',min:String(min),max:String(max),step:String(step),value:C[k],style:{width:'120px'},oninput:e=>{
          C[k]=parseFloat(e.target.value);O.native.ttsConfigure(C.voice,C.rate,C.pitch);cfgSave();row.querySelector('span').textContent=C[k].toFixed(2);
        }}));
      body.append(row);
    });
    body.append(h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:()=>O.native.ttsSpeak(O.tr('Привет! Так я буду отвечать во время звонка.','Hi! This is how I will sound during the call.'))},O.icon('play'),O.tr('Test voice','Проверить голос')));
    body.append(h('div',{class:'note',style:{marginTop:'10px'}},O.tr('During a call the agent runs with full tools: it can edit files, create projects and run commands. Only the final answer is spoken.','Во время звонка агент работает со всеми инструментами: правит файлы, создаёт проекты и запускает команды. Озвучивается только финальный ответ.')));
  };
  redraw();
}

O.startCall=startCall;
O.endCall=endCall;
O.openCallSettings=openCallSettings;
O.callActive=()=>C.active;
O.callState=()=>C.state;
})();