(function(){
const O=window.OCM,h=O.h,S=O.S,bus=O.bus;

/**
 * Phone Assistant — Google-Assistant-style control of the whole phone, no ADB.
 *
 * Layers:
 *  1. Native: PhoneAccessibilityService (taps/swipes/text/screenshot), PhoneControl (torch/DND/…),
 *     AssistantOverlayService (mini window over any app), PhoneServer (agent CLI `phone`).
 *  2. This module: command parser (ru/en), action chains ("открой X и сделай Y"), user macros
 *     ("игровой режим"), wake-phrase listening, and the in-app assistant sheet.
 *  3. Anything the parser does not understand goes to the agent as a normal prompt, so the
 *     assistant can still do everything the chat can.
 */

const A=O.assistant={listening:false,wakeTimer:null};

// ---------- native wrappers ----------
const pend=new Map();let seq=0;
O.on('phoneResult',d=>{
  const p=pend.get(d.id);if(!p)return;pend.delete(d.id);clearTimeout(p.timer);
  try{p.res(JSON.parse(d.result||'{}'))}catch(e){p.rej(e)}
});
function phoneAsync(cmd,args){
  return new Promise((res,rej)=>{
    const id='pa'+(++seq)+'_'+Date.now().toString(36);
    const timer=setTimeout(()=>{if(pend.delete(id))rej(new Error('timeout'))},30000);
    pend.set(id,{res,rej,timer});
    try{OC.phoneCommandAsync(id,cmd,JSON.stringify(args||[]))}catch(e){clearTimeout(timer);pend.delete(id);rej(e)}
  });
}
function phoneSync(cmd,args){
  try{return JSON.parse(OC.phoneCommand(cmd,JSON.stringify(args||[]))||'{}')}catch(e){return{ok:false,err:String(e)}}
}
O.phone={
  status:()=>{try{return JSON.parse(OC.phoneStatus()||'{}')}catch(_){return{}}},
  cmd:phoneSync,
  async:phoneAsync,
  enableAccessibility:()=>{try{OC.phoneEnableAccessibility()}catch(_){}},
  grantOverlay:()=>{try{OC.phoneGrantOverlay()}catch(_){}},
  grantDnd:()=>{try{OC.phoneGrantDnd()}catch(_){}},
  grantWrite:()=>{try{OC.phoneGrantWriteSettings()}catch(_){}},
  showOverlay:()=>phoneSync('assistant',[]),
  hideOverlay:()=>phoneSync('assistant_hide',[]),
  result:(text,ok)=>{try{OC.assistantResult(text,!!ok)}catch(_){}},
  setStatus:t=>{try{OC.assistantStatus(t)}catch(_){}},
  partial:t=>{try{OC.assistantPartial(t)}catch(_){}},
  serverStart:()=>{try{OC.phoneServerStart()}catch(_){}},
  serverStop:()=>{try{OC.phoneServerStop()}catch(_){}},
  answer:(id,payload)=>{try{OC.phoneAnswer(id,JSON.stringify(payload||{}))}catch(_){}}
};

// ---------- macros (user-defined action templates) ----------
const MACRO_DEFAULTS=[
  {id:'game',name:'Игровой режим',steps:[
    {cmd:'dnd',args:['priority']},
    {cmd:'settings',args:['battery_saver']},
    {cmd:'volume',args:['media','12']}
  ]},
  {id:'night',name:'Ночной режим',steps:[
    {cmd:'dnd',args:['silent']},
    {cmd:'brightness',args:['30']},
    {cmd:'volume',args:['media','3']}
  ]},
  {id:'work',name:'Рабочий режим',steps:[
    {cmd:'dnd',args:['off']},
    {cmd:'volume',args:['media','8']},
    {cmd:'brightness',args:['180']}
  ]}
];
O.macros=()=>{const l=O.store.get('macros',null);return Array.isArray(l)?l:MACRO_DEFAULTS};
O.saveMacros=l=>{
  O.store.set('macros',l||[]);
  // mirror into Prefs so the native overlay executor (AssistantCore) sees the same macros
  try{if(window.OC&&OC.setPref)OC.setPref('assistant_macros',JSON.stringify(l||[]))}catch(_){}
};
O.macroByName=name=>{
  const q=String(name||'').trim().toLowerCase();
  return O.macros().find(m=>m.name.toLowerCase()===q||m.name.toLowerCase().includes(q))||null;
};

// ---------- command parser ----------
// Returns an array of steps [{cmd,args,label}] or null when the phrase is not a phone command.
const APP_ALIASES={
  'телеграм':'telegram','telegram':'telegram','тг':'telegram','tg':'telegram',
  'ютуб':'youtube','youtube':'youtube','хром':'chrome','chrome':'chrome','браузер':'chrome',
  'вк':'vk','vk':'vk','вконтакте':'vk','ватсап':'whatsapp','whatsapp':'whatsapp',
  'камера':'camera','camera':'camera','галерея':'photos','фото':'photos','настройки':'settings',
  'калькулятор':'calculator','музыка':'music','телефон':'phone','звонки':'phone','сообщения':'messages'
};
function parseOne(t){
  const orig=String(t||'').trim().replace(/[.!?]+$/,'').replace(/^в\s+н[её]м\s+/i,'');
  const s=orig.toLowerCase();
  if(!s)return null;
  // capture groups from the ORIGINAL string so names keep their case ("Миша", not "миша")
  const om=r=>{const mm=orig.match(r);return mm?mm[1]:null};
  let m;
  // macro: "игровой режим" / "включи режим X" / "макрос X"
  if((m=s.match(/^(?:включи |запусти |активируй )?(?:режим |макрос )?(.+)$/))){
    const mac=O.macroByName(m[1]);
    if(mac&&/(режим|макрос)/.test(s))return [{cmd:'macro',args:[mac.id],label:mac.name}];
    if(mac&&!/^(открой|включи|выключи|сделай|поставь|напиши|найди|позвони|отправь)/.test(s))return [{cmd:'macro',args:[mac.id],label:mac.name}];
  }
  if(/^(сделай |сними )?(скриншот|скрин|screenshot)$/.test(s))return [{cmd:'shot',args:[],label:'Скриншот'}];
  if(/^(включи |выключи )?(фонарик|фонарь|flashlight|torch)( включи| выключи)?$/.test(s)){
    const off=/выключи|off/.test(s);
    return [{cmd:'torch',args:[off?'off':'on'],label:off?'Фонарик выкл':'Фонарик вкл'}];
  }
  if(/^(включи |выключи |поставь )?(не беспокоить|днд|dnd|без звука|тихий режим|режим тишины)( выключи| выкл)?$/.test(s)){
    const off=/выключи|выкл|off/.test(s);
    return [{cmd:'dnd',args:[off?'off':'silent'],label:off?'DND выкл':'DND вкл'}];
  }
  if((m=s.match(/^(?:поставь |установи )?громкость(?: медиа| музыки)?\s*(?:на\s*)?(\d+)/)))return [{cmd:'volume',args:['media',m[1]],label:'Громкость '+m[1]}];
  if(/^(выключи звук|без звука полностью|mute)$/.test(s))return [{cmd:'volume',args:['media','0'],label:'Звук выкл'}];
  if((m=s.match(/^(?:поставь |установи )?яркость\s*(?:на\s*)?(\d+)/)))return [{cmd:'brightness',args:[m[1]],label:'Яркость '+m[1]}];
  if(/^(назад|back)$/.test(s))return [{cmd:'back',args:[],label:'Назад'}];
  if(/^(домой|на главную|home)$/.test(s))return [{cmd:'home',args:[],label:'Домой'}];
  if(/^(недавние|recents|последние приложения)$/.test(s))return [{cmd:'recents',args:[],label:'Недавние'}];
  if(/^(шторка|уведомления|notifications)$/.test(s))return [{cmd:'notifications',args:[],label:'Уведомления'}];
  if(/^(быстрые настройки|quick settings)$/.test(s))return [{cmd:'quicksettings',args:[],label:'Быстрые настройки'}];
  if(/^(открой |включи )?(вайфай|wifi|вай-фай)/.test(s))return [{cmd:'settings',args:['wifi'],label:'Настройки WiFi'}];
  if(/^(открой |включи )?(блютуз|bluetooth)/.test(s))return [{cmd:'settings',args:['bluetooth'],label:'Настройки Bluetooth'}];
  if(/^(открой )?(экономию энергии|battery saver|энергосбережение)/.test(s))return [{cmd:'settings',args:['battery_saver'],label:'Экономия энергии'}];
  // chat/contact lookup BEFORE generic app-open: "открой чат Миша" taps the visible name
  if(s.match(/^(?:открой|найди|перейди в)\s+(?:чат|диалог|контакт)\s+(.+)$/)){const v=om(/^(?:открой|найди|перейди в)\s+(?:чат|диалог|контакт)\s+(.+)$/i);return [{cmd:'text',args:[v],label:'Чат «'+v+'»'}]}
  if(s.match(/^чат\s+(.+)$/)){const v=om(/^чат\s+(.+)$/i);return [{cmd:'text',args:[v],label:'Чат «'+v+'»'}]}
  // tap visible text: "нажми X" / "напиши X" (type)
  if(s.match(/^(?:нажми|тапни|кликни)\s+(?:на\s+)?(.+)$/)){const v=om(/^(?:нажми|тапни|кликни)\s+(?:на\s+)?(.+)$/i);return [{cmd:'text',args:[v],label:'Нажать «'+v+'»'}]}
  if(s.match(/^(?:напиши|введи|напечатай)\s+(.+)$/)){const v=om(/^(?:напиши|введи|напечатай)\s+(.+)$/i);return [{cmd:'type',args:[v],label:'Ввести текст'}]}
  // open app
  if((m=s.match(/^(?:открой|запусти|включи)\s+(?:приложение\s+)?(.+)$/))){
    const name=m[1].trim();
    const alias=APP_ALIASES[name]||name;
    return [{cmd:'open',args:[alias],label:'Открыть '+name}];
  }
  return null;
}
// Split "открой телеграм и в нем открой чат Миша" into steps.
O.parseAssistant=text=>{
  const raw=String(text||'').trim();
  if(!raw)return null;
  // whole phrase as macro first
  const mac=O.macroByName(raw);
  if(mac)return [{cmd:'macro',args:[mac.id],label:mac.name}];
  // "X и (в нём) Y", "X, затем Y", "X потом Y" — the connector eats its own trailing space.
  const parts=raw.split(/\s+(?:и(?:\s+в\s+н[её]м)?|затем|потом|после этого)\s+|,\s*(?:и|затем|потом)\s+/i).map(x=>x.trim()).filter(Boolean);
  const steps=[];
  for(const p of parts){
    const one=parseOne(p);
    if(!one)return null; // any unknown part → whole phrase goes to the agent
    steps.push(...one);
  }
  return steps.length?steps:null;
};

// ---------- executor ----------
async function runStep(st){
  if(st.cmd==='macro'){
    const mac=O.macros().find(m=>m.id===st.args[0]);
    if(!mac)return{ok:false,err:'macro not found'};
    const results=[];
    for(const s of mac.steps){results.push(await runStep(s));await new Promise(r=>setTimeout(r,450))}
    return{ok:results.every(r=>r.ok!==false),label:mac.name,results};
  }
  const asyncCmds=['tap','longpress','swipe','text','type','screen','shot','screenshot'];
  let r;
  if(asyncCmds.includes(st.cmd))r=await phoneAsync(st.cmd,st.args);
  else r=phoneSync(st.cmd,st.args);
  if(r&&r.err==='accessibility_off'){O.phone.enableAccessibility();return{ok:false,err:'Включите Accessibility для OpenCode Mobile в настройках Android'} }
  if(r&&r.err==='policy_access'){O.phone.grantDnd();return{ok:false,err:'Разрешите управление «Не беспокоить»'} }
  if(r&&r.err==='write_settings'){O.phone.grantWrite();return{ok:false,err:'Разрешите изменение настроек экрана'} }
  return r||{ok:false};
}
O.runAssistant=async(text,{silent=false}={})=>{
  const steps=O.parseAssistant(text);
  if(!steps){
    // Not a phone command → let the agent handle it like a normal chat prompt.
    if(O.chatSendText){O.chatSendText(text);return{ok:true,agent:true}}
    return{ok:false,err:'no agent'};
  }
  const done=[];
  for(const st of steps){
    if(!silent)O.phone.setStatus(st.label+'…');
    const r=await runStep(st);
    done.push({label:st.label,ok:r.ok!==false,err:r.err||''});
    if(r.ok===false)break;
    await new Promise(r2=>setTimeout(r2,650)); // let the UI settle between actions
  }
  const ok=done.every(d=>d.ok);
  const summary=done.map(d=>(d.ok?'✓ ':'✗ ')+d.label+(d.err?' — '+d.err:'')).join('\n');
  if(!silent){O.phone.result(summary,ok);O.toast(summary,ok?2500:5000)}
  return{ok,summary,steps:done};
};

// ---------- wake phrase ----------
const wakeCfg=()=>({
  enabled:O.store.get('assistant.wakeEnabled',false),
  phrase:String(O.store.get('assistant.wakePhrase','окей код')).trim().toLowerCase()
});
function onWakeHeard(text){
  const cfg=wakeCfg();
  const t=String(text||'').toLowerCase();
  if(!cfg.enabled||!cfg.phrase)return false;
  const i=t.indexOf(cfg.phrase);
  if(i<0)return false;
  const rest=text.slice(i+cfg.phrase.length).replace(/^[\s,.:;-]+/,'').trim();
  O.phone.showOverlay();
  if(rest){setTimeout(()=>O.runAssistant(rest),600)}
  else{setTimeout(()=>{try{OC.sttStart('system',O.store.get('lang','ru')==='en'?'en-US':'ru-RU','',true)}catch(_){}},700)}
  return true;
}
O.assistantWakeStart=()=>{
  const cfg=wakeCfg();
  if(!cfg.enabled||A.listening)return;
  A.listening=true;
  // Continuous lightweight listening: system recognizer in a loop, restarted on every result.
  const loop=()=>{
    if(!A.listening)return;
    try{OC.sttStart('system',O.store.get('lang','ru')==='en'?'en-US':'ru-RU',cfg.phrase,false)}catch(_){}
  };
  A.off=O.on('stt',d=>{
    if(!A.listening)return;
    if(d.t==='final'&&d.text){
      if(!onWakeHeard(d.text))setTimeout(loop,400);
      else setTimeout(loop,4000);
    }else if(d.t==='empty'||d.t==='error'){setTimeout(loop,1200)}
  });
  loop();
};
O.assistantWakeStop=()=>{
  A.listening=false;
  if(A.off){A.off();A.off=null}
  try{OC.sttStop()}catch(_){}
};

// overlay mic button → one-shot dictation into the overlay input
O.on('assistantMic',d=>{
  if(!d)return;
  if(d.on){
    try{OC.sttStart('system',O.store.get('lang','ru')==='en'?'en-US':'ru-RU','',true)}catch(_){}
    A.overlayOff=O.on('stt',ev=>{
      if(ev.t==='partial')O.phone.partial(ev.text||'');
      if(ev.t==='final'){
        O.phone.partial(ev.text||'');
        if(A.overlayOff){A.overlayOff();A.overlayOff=null}
        // auto-submit the spoken request
        if(ev.text)setTimeout(()=>O.runAssistant(ev.text),250);
      }
    });
  }else{
    try{OC.sttStop()}catch(_){}
    if(A.overlayOff){A.overlayOff();A.overlayOff=null}
  }
});
// overlay text submit (legacy path; the overlay now executes natively, this is a fallback)
O.on('assistantQuery',async d=>{
  if(!d||!d.text)return;
  O.phone.setStatus('Выполняю…');
  await O.runAssistant(d.text);
});
// overlay forwarded an unknown phrase → send it to the agent chat
O.on('assistantAgent',d=>{
  if(!d||!d.text)return;
  O.setTab('chat');
  if(O.chatSendText)O.chatSendText(d.text);
});

// ---------- agent → phone (PhoneServer) ----------
O.on('phoneRequest',async d=>{
  if(!d||!d.id)return;
  const cmd=String(d.cmd||'');
  const args=[];const arr=d.args||[];
  for(let i=0;i<arr.length;i++)args.push(String(arr[i]));
  // confirm dangerous chains unless the user allowed silent agent control
  const silent=O.store.get('assistant.agentSilent',false);
  const dangerous=['tap','swipe','text','type','longpress','macro'];
  if(!silent&&dangerous.includes(cmd)){
    const ok=await O.confirm(O.tr('Agent wants to control the phone','Агент хочет управлять телефоном'),
      cmd+' '+args.join(' '),O.tr('Allow','Разрешить'));
    if(!ok){O.phone.answer(d.id,{ok:false,err:'declined'});return}
  }
  try{
    let r;
    if(cmd==='macro'){
      const mac=O.macros().find(m=>m.id===args[0]||m.name.toLowerCase()===String(args[0]||'').toLowerCase());
      if(!mac){O.phone.answer(d.id,{ok:false,err:'macro not found'});return}
      r=await runStep({cmd:'macro',args:[mac.id]});
    }else if(['tap','longpress','swipe','text','type','screen','shot','screenshot'].includes(cmd)){
      r=await phoneAsync(cmd,args);
    }else{
      r=phoneSync(cmd,args);
    }
    O.phone.answer(d.id,r||{ok:false});
  }catch(e){O.phone.answer(d.id,{ok:false,err:e.message||String(e)})}
});

// ---------- in-app assistant sheet ----------
O.openAssistant=()=>{
  const st=O.phone.status();
  const body=h('div');
  const s=O.sheet(O.tr('Phone assistant','Ассистент телефона'),body,{full:true});
  const statusLine=h('div',{class:'note'});
  const inp=h('textarea',{rows:2,placeholder:O.tr('Say or type: "открой телеграм и в нём открой чат Миша"','Скажите или напишите: «открой телеграм и в нём открой чат Миша»')});
  const out=h('div',{style:{whiteSpace:'pre-wrap',fontSize:'13px',marginTop:'10px'}});
  const run=async()=>{
    const t=inp.value.trim();if(!t)return;
    inp.value='';out.textContent='…';
    const r=await O.runAssistant(t,{silent:true});
    out.textContent=r.summary||(r.agent?O.tr('Sent to the agent chat','Отправлено в чат агента'):(r.err||''));
  };
  const micBtn=h('button',{class:'btn',onclick:()=>{
    try{OC.sttStart('system',O.store.get('lang','ru')==='en'?'en-US':'ru-RU','',true)}catch(_){}
    const off=O.on('stt',ev=>{
      if(ev.t==='partial')inp.value=ev.text||'';
      if(ev.t==='final'){inp.value=ev.text||'';off();if(ev.text)run()}
      if(ev.t==='error'||ev.t==='empty')off();
    });
  }},O.icon('mic'),O.tr('Speak','Сказать'));
  body.append(statusLine,inp,
    h('div',{style:{display:'flex',gap:'8px',marginTop:'8px'}},
      micBtn,h('button',{class:'btn pri grow',onclick:run},O.icon('send'),O.tr('Run','Выполнить')),
      h('button',{class:'btn',onclick:()=>{O.phone.showOverlay();s.close()}},O.icon('out'),O.tr('Mini window','Мини-окно'))),
    out,
    h('div',{class:'grp',style:{marginTop:'14px'}},O.tr('Quick actions','Быстрые действия')));
  const quick=[
    ['Скриншот','shot'],['Фонарик','torch'],['Не беспокоить','dnd'],['Домой','home'],['Назад','back'],['Уведомления','notifications']
  ];
  const qrow=h('div',{style:{display:'flex',gap:'6px',flexWrap:'wrap'}});
  quick.forEach(([label,cmd])=>qrow.append(h('button',{class:'chip',onclick:async()=>{
    const args=cmd==='torch'?['on']:cmd==='dnd'?['silent']:[];
    const r=['shot'].includes(cmd)?await phoneAsync(cmd,args):phoneSync(cmd,args);
    O.toast(r.ok?label+' ✓':(r.err||label+' ✗'),2500);
  }},label)));
  body.append(qrow);
  body.append(h('div',{class:'grp',style:{marginTop:'14px'}},O.tr('Macros','Шаблоны')));
  O.macros().forEach(mac=>body.append(h('button',{class:'settings-row',onclick:async()=>{
    out.textContent='…';
    const r=await runStep({cmd:'macro',args:[mac.id]});
    out.textContent=(r.ok?'✓ ':'✗ ')+mac.name;
  }},O.icon('zap'),h('div',{class:'settings-row-text'},h('b',null,mac.name),h('span',null,mac.steps.length+' '+O.tr('actions','действий'))))));
  body.append(h('button',{class:'btn wide',style:{marginTop:'8px'},onclick:()=>{s.close();O.openMacroEditor()}},O.icon('edit'),O.tr('Edit macros','Редактировать шаблоны')));
  // permissions status
  const perms=[];
  if(!st.accessibility)perms.push([O.tr('Accessibility (tap/swipe/screenshot)','Accessibility (тапы/свайпы/скрин)'),()=>O.phone.enableAccessibility()]);
  if(!st.overlay)perms.push([O.tr('Overlay (mini window)','Поверх окон (мини-окно)'),()=>O.phone.grantOverlay()]);
  if(!st.dndAccess)perms.push([O.tr('Do Not Disturb access','Доступ к «Не беспокоить»'),()=>O.phone.grantDnd()]);
  if(!st.writeSettings)perms.push([O.tr('Brightness control','Управление яркостью'),()=>O.phone.grantWrite()]);
  if(perms.length){
    statusLine.textContent=O.tr('Grant permissions to unlock all actions:','Выдайте разрешения для всех действий:');
    perms.forEach(([label,fn])=>body.append(h('button',{class:'btn wide',style:{marginTop:'6px'},onclick:fn},O.icon('shield'),label)));
  }else statusLine.textContent=O.tr('All permissions granted — full phone control ready.','Все разрешения выданы — полное управление готово.');
};

// ---------- macro editor ----------
const STEP_CMDS=[
  ['open','Открыть приложение','telegram'],['torch','Фонарик','on'],['dnd','Не беспокоить','silent'],
  ['volume','Громкость медиа','10'],['brightness','Яркость','150'],['settings','Страница настроек','battery_saver'],
  ['shot','Скриншот',''],['back','Назад',''],['home','Домой',''],['notifications','Уведомления',''],
  ['text','Нажать текст','Миша'],['type','Ввести текст','привет'],['swipe','Свайп','540 1800 540 600'],['wait','Пауза (мс)','1000']
];
O.openMacroEditor=()=>{
  const body=h('div');
  const s=O.sheet(O.tr('Macros','Шаблоны действий'),body,{full:true});
  const draw=()=>{
    body.textContent='';
    body.append(h('div',{class:'note'},O.tr('A macro is a named sequence of actions, e.g. "Игровой режим". Say its name to the assistant or run it from the agent: phone macro "Игровой режим".','Шаблон — именованная последовательность действий, например «Игровой режим». Скажите название ассистенту или выполните из агента: phone macro "Игровой режим".')));
    O.macros().forEach((mac,mi)=>{
      body.append(h('div',{class:'settings-card',style:{padding:'10px 12px',marginBottom:'10px'}},
        h('div',{style:{display:'flex',alignItems:'center',gap:'8px'}},
          h('b',{class:'grow'},mac.name),
          h('button',{class:'ibtn s',onclick:async()=>{
            const n=await O.ask(O.tr('Macro name','Название шаблона'),null,mac.name);
            if(n){const l=O.macros();l[mi].name=n;O.saveMacros(l);draw()}
          }},O.icon('edit')),
          h('button',{class:'ibtn s',onclick:()=>{const l=O.macros();l.splice(mi,1);O.saveMacros(l);draw()}},O.icon('trash'))),
        h('div',null,mac.steps.map((st,si)=>h('div',{class:'mut s',style:{display:'flex',gap:'6px',alignItems:'center',padding:'3px 0'}},
          h('span',{class:'grow'},(si+1)+'. '+st.cmd+' '+st.args.join(' ')),
          h('button',{class:'ibtn s',onclick:()=>{const l=O.macros();l[mi].steps.splice(si,1);O.saveMacros(l);draw()}},O.icon('x'))))),
        h('button',{class:'btn sm',style:{marginTop:'6px'},onclick:()=>{
          O.actions(O.tr('Add action','Добавить действие'),STEP_CMDS.map(([cmd,label,def])=>({
            label,sub:cmd,icon:'plus',fn:async()=>{
              let args=[];
              if(def!==''){
                const v=await O.ask(label,O.tr('Argument','Аргумент'),def);
                if(v==null)return;
                args=cmd==='swipe'?v.split(/\s+/):[v];
              }
              const l=O.macros();l[mi].steps.push({cmd,args});O.saveMacros(l);draw();
            }
          })));
        }},O.icon('plus'),O.tr('Add action','Добавить действие'))));
    });
    body.append(h('button',{class:'btn pri wide',onclick:async()=>{
      const n=await O.ask(O.tr('New macro name','Название нового шаблона'),'Мой режим');
      if(!n)return;
      const l=O.macros();l.push({id:'mac_'+Date.now().toString(36),name:n,steps:[]});O.saveMacros(l);draw();
    }},O.icon('plus'),O.tr('New macro','Новый шаблон')));
  };
  draw();
};

// ---------- settings ----------
O.openAssistantSettings=()=>{
  const body=h('div');
  const s=O.sheet(O.tr('Assistant settings','Настройки ассистента'),body,{full:true});
  const draw=()=>{
    body.textContent='';
    const cfg=wakeCfg();
    body.append(h('div',{class:'grp'},O.tr('Wake phrase','Кодовая фраза')));
    body.append(O.toggleRow('mic',O.tr('Listen for wake phrase','Слушать кодовую фразу'),
      O.tr('Uses the microphone in the background while the app is open','Микрофон работает в фоне, пока приложение открыто'),
      cfg.enabled,v=>{O.store.set('assistant.wakeEnabled',v);if(v)O.assistantWakeStart();else O.assistantWakeStop();draw()}));
    body.append(O.listRow('edit',O.tr('Phrase','Фраза'),cfg.phrase||O.tr('not set','не задана'),O.icon('chevR'),async()=>{
      const v=await O.ask(O.tr('Wake phrase','Кодовая фраза'),O.tr('e.g. "окей код"','например: «окей код»'),cfg.phrase);
      if(v!=null){O.store.set('assistant.wakePhrase',v.trim());if(A.listening){O.assistantWakeStop();O.assistantWakeStart()}draw()}
    }));
    body.append(h('div',{class:'note'},O.tr('Say the phrase followed by a command: "окей код, открой телеграм". Without a command the mini window opens and listens.','Скажите фразу и команду: «окей код, открой телеграм». Без команды откроется мини-окно и будет слушать.')));
    body.append(h('div',{class:'grp',style:{marginTop:'12px'}},O.tr('Agent control','Управление агентом')));
    body.append(O.toggleRow('bot',O.tr('Silent agent control','Агент без подтверждений'),
      O.tr('Let the agent tap/swipe without asking each time (macros still confirm)','Агент тапает/свайпает без спроса (шаблоны всё равно подтверждают)'),
      O.store.get('assistant.agentSilent',false),v=>O.store.set('assistant.agentSilent',v)));
    body.append(h('div',{class:'note'},O.tr('The agent uses the `phone` CLI: phone open telegram · phone text "Миша" · phone shot · phone torch on · phone macro "Игровой режим". No ADB needed.','Агент использует CLI `phone`: phone open telegram · phone text "Миша" · phone shot · phone torch on · phone macro "Игровой режим". ADB не нужен.')));
    body.append(h('div',{class:'grp',style:{marginTop:'12px'}},O.tr('Permissions','Разрешения')));
    const st=O.phone.status();
    const row=(label,ok,fn)=>body.append(h('div',{class:'settings-row'},
      h('div',{class:'settings-row-icon '+(ok?'green':'amber')},O.icon('shield')),
      h('div',{class:'settings-row-text'},h('b',null,label),h('span',null,ok?O.tr('granted','выдано'):O.tr('not granted','не выдано'))),
      ok?O.icon('check','ok'):h('button',{class:'btn sm',onclick:fn},O.tr('Grant','Выдать'))));
    row('Accessibility',st.accessibility,()=>O.phone.enableAccessibility());
    row(O.tr('Overlay','Поверх окон'),st.overlay,()=>O.phone.grantOverlay());
    row('DND',st.dndAccess,()=>O.phone.grantDnd());
    row(O.tr('Brightness','Яркость'),st.writeSettings,()=>O.phone.grantWrite());
    body.append(h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:()=>{s.close();O.openMacroEditor()}},O.icon('zap'),O.tr('Macros','Шаблоны действий')));
  };
  draw();
};

// start services lazily
setTimeout(()=>{
  try{O.phone.serverStart()}catch(_){}
  if(wakeCfg().enabled)try{O.assistantWakeStart()}catch(_){}
},3500);

})();
