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

const A=O.assistant={listening:false,wakeTimer:null,sid:null};

// ---- dedicated assistant session ----
// Assistant requests live in their own persistent session, separate from the user's main chat.
O.assistantSession=async()=>{
  if(A.sid&&S.sessions.some(x=>x.id===A.sid))return A.sid;
  const saved=O.store.get('assistant.sid',null);
  if(saved){
    try{
      await O.api('GET','/session/'+saved,null,{timeout:8000});
      A.sid=saved;return saved;
    }catch(_){/* session gone — create a new one */}
  }
  try{
    const ses=await O.api('POST','/session',{title:'🎙 Ассистент'});
    A.sid=ses.id;O.store.set('assistant.sid',ses.id);
    if(!S.sessions.some(x=>x.id===ses.id))S.sessions.unshift(ses);
    bus.emit('sessions');
    return ses.id;
  }catch(e){return null}
};
// Send a phrase to the assistant session (not the currently open chat).
O.assistantSend=async text=>{
  const sid=await O.assistantSession();
  if(!sid||!S.model)return false;
  const mid=O.mid();
  const parts=[{type:'text',text}];
  try{
    const m=O.upsertMsg({id:mid,sessionID:sid,role:'user',time:{created:Date.now()},agent:S.agent,model:S.model});
    m.local=true;m.parts=parts.map((p,k)=>Object.assign({id:'prt_as'+k,sessionID:sid,messageID:mid},p));
    if(sid===S.sid)bus.emit('msg',sid,m);
    await O.api('POST','/session/'+sid+'/prompt_async',{messageID:mid,agent:S.agent,model:S.model,parts},{timeout:30000});
    return true;
  }catch(e){O.toast(e.message||String(e),3000);return false}
};
// Open the assistant session in the chat tab.
O.openAssistantChat=async()=>{
  const sid=await O.assistantSession();
  if(!sid)return O.toast(O.tr('Server is not ready','Сервер не готов'),2500);
  O.setTab('chat');
  await O.openSession(sid);
};

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
// ---- transliteration: latin <-> cyrillic so "telegram"/"телеграм"/"tlgrm" all match ----
const LAT2CYR={a:'а',b:'б',v:'в',g:'г',d:'д',e:'е',z:'з',i:'и',k:'к',l:'л',m:'м',n:'н',o:'о',p:'п',r:'р',s:'с',t:'т',u:'у',f:'ф',h:'х',c:'к',y:'й',w:'в',x:'кс',j:'дж',q:'к'};
const CYR2LAT={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};
O.translit=s=>{
  const t=String(s||'').toLowerCase();
  const hasCyr=/[а-яё]/.test(t);
  if(hasCyr)return [...t].map(c=>CYR2LAT[c]!==undefined?CYR2LAT[c]:c).join('');
  // latin -> cyrillic (approximate, for matching only)
  let out='';
  for(let i=0;i<t.length;i++){
    const two=t.slice(i,i+2);
    if(two==='sh'){out+='ш';i++;continue}
    if(two==='ch'){out+='ч';i++;continue}
    if(two==='zh'){out+='ж';i++;continue}
    if(two==='ya'){out+='я';i++;continue}
    if(two==='yu'){out+='ю';i++;continue}
    out+=LAT2CYR[t[i]]!==undefined?LAT2CYR[t[i]]:t[i];
  }
  return out;
};
// normalize an app name for matching: lowercase, ё->е, strip spaces/dots, translit both ways
O.appKey=s=>String(s||'').toLowerCase().replace(/ё/g,'е').replace(/[\s._-]+/g,'');
// common abbreviations / slang -> canonical names (ru + en)
const ABBREV={
  'тг':'telegram','tg':'telegram','телега':'telegram','теле':'telegram','телеграм':'telegram','tlgr':'telegram','tlg':'telegram',
  'инста':'instagram','insta':'instagram','инст':'instagram','inst':'instagram','иг':'instagram',
  'майн':'minecraft','майнкрафт':'minecraft','mc':'minecraft','майнкр':'minecraft',
  'ватс':'whatsapp','ватсап':'whatsapp','вацап':'whatsapp','whats':'whatsapp','wa':'whatsapp','васап':'whatsapp',
  'ютуб':'youtube','ют':'youtube','yt':'youtube','you':'youtube',
  'вк':'vk','вконтакте':'vk','vk':'vk',
  'хром':'chrome','chrome':'chrome','браузер':'chrome',
  'гугл':'google','google':'google','гуг':'google',
  'тикток':'tiktok','тик':'tiktok','tt':'tiktok','tik':'tiktok',
  'спотифай':'spotify','спот':'spotify','spot':'spotify',
  'дискорд':'discord','дс':'discord','disc':'discord','ds':'discord',
  'твиттер':'twitter','тви':'twitter','x':'twitter',
  'фейсбук':'facebook','фб':'facebook','fb':'facebook','face':'facebook',
  'реддит':'reddit','ред':'reddit',
  'пинтерест':'pinterest','пин':'pinterest',
  'линкедин':'linkedin','линк':'linkedin',
  'снапчат':'snapchat','снап':'snapchat','snap':'snapchat',
  'тимс':'teams','teams':'teams',
  'зум':'zoom','zoom':'zoom',
  'слак':'slack','slack':'slack',
  'нотион':'notion','notion':'notion',
  'фигма':'figma','figma':'figma',
  'гитхаб':'github','гит':'github','gh':'github',
  'камера':'camera','cam':'camera',
  'галерея':'photos','фото':'photos',
  'настройки':'settings','сет':'settings',
  'калькулятор':'calculator','кальк':'calculator','calc':'calculator',
  'часы':'clock','будильник':'clock',
  'карты':'maps','maps':'maps',
  'почта':'gmail','gmail':'gmail','мейл':'gmail',
  'музыка':'music','music':'music',
  'файлы':'files','files':'files',
  'телефон':'phone','звонки':'phone','dialer':'phone',
  'сообщения':'messages','смс':'messages','sms':'messages',
  'плей':'play market','маркет':'play market','play':'play market',
  'драйв':'drive','drive':'drive',
  'киви':'qiwi','qiwi':'qiwi',
  'сбер':'sberbank','сбербанк':'sberbank',
  'тинькофф':'tinkoff','тиньк':'tinkoff','тбанк':'tbank',
  'яндекс':'yandex','ян':'yandex',
  'го':'yandex go','такси':'yandex go',
  'озон':'ozon','ozon':'ozon',
  'вб':'wildberries','wildberries':'wildberries','валдберис':'wildberries',
  'авито':'avito','avito':'avito'
};
O.appMatch=(query,labels)=>{
  let q=O.appKey(query);
  if(!q)return null;
  // abbreviation expansion first
  if(ABBREV[q])q=O.appKey(ABBREV[q]);
  const ql=O.translit(q),qc=O.translit(query.toLowerCase().replace(/ё/g,'е'));
  let best=null,bestScore=0;
  for(const l of labels){
    const k=O.appKey(l);
    const kl=O.translit(k);
    const kc=O.translit(k); // cyr form of latin label
    let score=0;
    if(k===q)score=100;
    else if(k.startsWith(q)||q.startsWith(k))score=85;
    else if(k.includes(q)||q.includes(k))score=65;
    // cross-script: cyr query vs latin label and vice versa
    else if(kl===ql||kl===qc||kc===q||k===ql)score=80;
    else if(kl.startsWith(ql)||ql.startsWith(kl)||kc.startsWith(q)||q.startsWith(kc))score=70;
    else if(kl.includes(ql)||ql.includes(kl)||kc.includes(q)||q.includes(kc))score=55;
    // partial prefix of any word in the label ("майн" -> "Minecraft" via translit prefix)
    else{
      const words=k.split(/\s+/);
      if(words.some(w=>w.startsWith(q)||O.translit(w).startsWith(ql)))score=60;
    }
    if(score>bestScore){bestScore=score;best=l}
  }
  return bestScore>=50?best:null;
};

const APP_ALIASES={
  'телеграм':'telegram','telegram':'telegram','тг':'telegram','tg':'telegram',
  'ютуб':'youtube','youtube':'youtube','хром':'chrome','chrome':'chrome','браузер':'chrome',
  'вк':'vk','vk':'vk','вконтакте':'vk','ватсап':'whatsapp','whatsapp':'whatsapp',
  'камера':'camera','camera':'camera','галерея':'photos','фото':'photos','настройки':'settings',
  'калькулятор':'calculator','музыка':'music','телефон':'phone','звонки':'phone','сообщения':'messages'
};
function parseOne(t){
  let orig=String(t||'').trim().replace(/[.!?]+$/,'').replace(/^в\s+н[её]м\s+/i,'');
  orig=orig.replace(/^(пожалуйста|плиз|please|ну|давай|ка|будь добр[аы]?|сделай мне|мне)\s+/i,'').replace(/\s+(пожалуйста|плиз|please)$/i,'').trim();
  const s=orig.toLowerCase().replace(/ё/g,'е');
  if(!s)return null;
  const om=r=>{const mm=orig.match(r);return mm?mm[1]:null};
  const has=(...w)=>w.some(x=>s.includes(x));
  // bilingual intent hints: english words map to the same intents
  const en={
    shot:/screenshot|screen shot|capture screen/,torch:/flashlight|torch|flash/,
    dnd:/do not disturb|silent mode|mute all|quiet mode/,home:/go home|home screen/,
    back:/go back|navigate back/,recents:/recent apps|app switcher/,
    notif:/notifications|notification shade|pull down/,wifi:/wi-?fi|wireless/,
    bt:/bluetooth/,bright:/brightness/,vol:/volume|sound level/,
    open:/^(open|launch|start|run)\s/,lock:/lock (the )?(screen|phone)/
  };
  const step=(cmd,args,label)=>[{cmd,args:args||[],label:label||cmd}];
  // macros
  if(has('режим','макрос','macro','mode')){
    const name=s.replace(/^(включи|запусти|активируй|вруби|поставь|activate|enable|turn on)?\s*(режим|макрос|macro|mode)?\s*/,'').trim();
    const mac=O.macroByName(name)||O.macroByName(s);
    if(mac)return step('macro',[mac.id],mac.name);
  }
  if(has('скриншот','скрин','screenshot','снимок экрана','screen shot','сфоткай экран','захвати экран')||en.shot.test(s))return step('shot',[],'Скриншот');
  if(has('фонарик','фонарь','flashlight','torch','вспышк')||en.torch.test(s)){const off=has('выключи','выкл','off','потуши','убери','отключи','disable','turn off');return step('torch',[off?'off':'on'],off?'Фонарик выкл':'Фонарик вкл')}
  if(has('не беспокоить','днд','dnd','без звука','тихий режим','режим тишины','тишину','do not disturb','беззвучн','не тревожить')||en.dnd.test(s)){const off=has('выключи','выкл','off','отключи','сними','disable','turn off','верни звук');return step('dnd',[off?'off':'silent'],off?'DND выкл':'DND вкл')}
  let m=s.match(/(?:громкость|звук|volume)(?:\s+медиа|\s+музыки|\s+media)?\s*(?:на|до|=)?\s*(\d+)/);
  if(m)return step('volume',['media',m[1]],'Громкость '+m[1]);
  if(has('выключи звук','убери звук','mute','заглуши','звук на ноль','громкость 0'))return step('volume',['media','0'],'Звук выкл');
  if(has('прибавь звук','погромче','громче','volume up','увеличь громкость'))return step('volume',['media','12'],'Громче');
  if(has('убавь звук','потише','тише','volume down','уменьши громкость'))return step('volume',['media','4'],'Тише');
  m=s.match(/(?:яркость|brightness)(?:\s+экрана)?\s*(?:на|до|=)?\s*(\d+)/);
  if(m)return step('brightness',[m[1]],'Яркость '+m[1]);
  if(has('ярче','яркость выше','прибавь яркость','brighter'))return step('brightness',['220'],'Ярче');
  if(has('темнее','яркость ниже','убавь яркость','dimmer','потусклее'))return step('brightness',['40'],'Темнее');
  if(has('назад','back')||en.back.test(s))return step('back',[],'Назад');
  if(has('домой','на главную','home','главный экран','рабочий стол')||en.home.test(s))return step('home',[],'Домой');
  if(has('недавние','recents','последние приложения','открытые приложения')||en.recents.test(s))return step('recents',[],'Недавние');
  if(has('шторка','уведомления','notifications','шторку','панель уведомлений')||en.notif.test(s))return step('notifications',[],'Уведомления');
  if(has('быстрые настройки','quick settings'))return step('quicksettings',[],'Быстрые настройки');
  if(has('заблокируй','lock','блокировка экрана')||en.lock.test(s))return step('lock',[],'Блокировка');
  if(has('вайфай','wifi','вай-фай','wi-fi','вифи')||en.wifi.test(s))return step('settings',['wifi'],'WiFi');
  if(has('блютуз','bluetooth','блютус')||en.bt.test(s))return step('settings',['bluetooth'],'Bluetooth');
  if(has('экономию энергии','battery saver','энергосбережение','энергосберегающий'))return step('settings',['battery_saver'],'Экономия энергии');
  if(has('геолокация','location','местоположение','gps'))return step('settings',['location'],'Геолокация');
  if(has('авиарежим','airplane','режим полета'))return step('settings',['airplane'],'Авиарежим');
  if(s==='настройки'||s==='открой настройки'||s==='settings')return step('settings',[''],'Настройки');
  // chat/contact before open
  if((m=orig.match(/^(?:открой|найди|перейди в|зайди в|напиши в|открыть|open)?\s*(?:чат|диалог|контакт|переписку с|чат с)\s+(.+)$/i))&&m[1].trim())return step('text',[m[1].trim()],'Чат «'+m[1].trim()+'»');
  if((m=orig.match(/^чат\s+(.+)$/i)))return step('text',[m[1]],'Чат «'+m[1]+'»');
  if((m=orig.match(/^(?:нажми|тапни|кликни|нажать|tap|click|press)\s+(?:на\s+)?(.+)$/i)))return step('text',[m[1]],'Нажать «'+m[1]+'»');
  if((m=orig.match(/^(?:напиши|введи|напечатай|ввести|type|набрать)\s+(.+)$/i)))return step('type',[m[1]],'Ввести текст');
  if((m=orig.match(/^(?:открой|запусти|включи|вруби|открыть|запустить|open|launch|start|запусти мне|открой мне)\s+(?:приложение\s+|app\s+)?(.+)$/i))){
    const name=m[1].trim().replace(/\s+приложение$/,'').replace(/^приложение\s+/,'').trim();
    if(name)return step('open',[APP_ALIASES[name.toLowerCase()]||name],'Открыть '+name);
  }
  const bare=s.replace(/\s+приложение$/,'').trim();
  if(APP_ALIASES[bare])return step('open',[APP_ALIASES[bare]],'Открыть '+orig);
  // fuzzy: match against installed app labels with transliteration (telegram/телеграм/tlgrm)
  try{
    const r=O.phone.cmd('apps',[]);
    const labels=(r.apps||[]).map(a=>a.label);
    const hit=O.appMatch(bare,labels);
    if(hit){
      const pkg=(r.apps||[]).find(a=>a.label===hit);
      return step('open',[pkg?pkg.package:hit],'Открыть '+hit);
    }
  }catch(_){}
  if(has('прокрути вниз','листай вниз','свайп вниз','scroll down','скролл вниз'))return step('scroll',['down'],'Прокрутка вниз');
  if(has('прокрути вверх','листай вверх','свайп вверх','scroll up','скролл вверх'))return step('scroll',['up'],'Прокрутка вверх');
  if((m=s.match(/^(?:подожди|жди|wait)\s*(\d+)?/)))return step('wait',[String((parseInt(m[1]||'2',10))*1000)],'Пауза');
  if((m=orig.match(/^(?:найди|ищи|find)\s+(.+)$/i)))return step('find',[m[1]],'Найти «'+m[1]+'»');
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
  const asyncCmds=['tap','longpress','swipe','text','type','screen','shot','screenshot','find','scroll','waittext'];
  let r;
  if(st.cmd==='wait'){await new Promise(r2=>setTimeout(r2,parseInt(st.args[0]||'1000',10)));r={ok:true}}
  else if(asyncCmds.includes(st.cmd))r=await phoneAsync(st.cmd,st.args);
  else r=phoneSync(st.cmd,st.args);
  if(r&&r.err==='accessibility_off'){O.phone.enableAccessibility();return{ok:false,err:'Включите Accessibility для OpenCode Mobile в настройках Android'} }
  if(r&&r.err==='policy_access'){O.phone.grantDnd();return{ok:false,err:'Разрешите управление «Не беспокоить»'} }
  if(r&&r.err==='write_settings'){O.phone.grantWrite();return{ok:false,err:'Разрешите изменение настроек экрана'} }
  return r||{ok:false};
}
O.runAssistant=async(text,{silent=false}={})=>{
  const steps=O.parseAssistant(text);
  if(!steps){
    // Not a phone command → the agent handles it in the DEDICATED assistant session.
    const sent=await O.assistantSend(text);
    return{ok:sent,agent:true};
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
// overlay forwarded an unknown phrase → assistant session (opened in the chat tab)
O.on('assistantAgent',async d=>{
  if(!d||!d.text)return;
  const sent=await O.assistantSend(d.text);
  if(sent){O.setTab('chat');const sid=await O.assistantSession();if(sid)await O.openSession(sid)}
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
    }else if(['tap','longpress','swipe','text','type','screen','shot','screenshot','find','scroll','waittext'].includes(cmd)){
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
      h('button',{class:'btn',onclick:()=>{O.phone.showOverlay();s.close()}},O.icon('out'),O.tr('Mini window','Мини-окно')),
      h('button',{class:'btn',onclick:()=>{s.close();O.openAssistantChat()}},O.icon('chat'),O.tr('Assistant chat','Чат ассистента'))),
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

// ---------- assistant control center (redesigned) ----------
O.openAssistantSettings=()=>{
  const body=h('div');
  const s=O.sheet(O.tr('Assistant','Ассистент'),body,{full:true});
  const draw=()=>{
    body.textContent='';
    const st=O.phone.status();
    const cfg=wakeCfg();
    // ---- hero: big toggle + status ----
    const allOk=st.accessibility&&st.overlay;
    body.append(h('div',{class:'settings-card',style:{padding:'14px 16px',marginBottom:'12px'}},
      h('div',{style:{display:'flex',alignItems:'center',gap:'12px'}},
        h('div',{style:{width:'44px',height:'44px',borderRadius:'14px',display:'grid',placeItems:'center',background:allOk?'color-mix(in srgb, var(--ok) 18%, transparent)':'color-mix(in srgb, var(--warn) 18%, transparent)'}},O.icon('mic')),
        h('div',{class:'grow'},
          h('b',{style:{fontSize:'15px'}},O.tr('Phone assistant','Ассистент телефона')),
          h('div',{class:'mut s'},allOk?O.tr('Ready · full control','Готов · полное управление'):O.tr('Setup needed','Нужна настройка'))),
        h('button',{class:'btn sm pri',onclick:()=>{O.phone.showOverlay();s.close()}},O.tr('Open','Открыть'))),
      h('div',{style:{display:'flex',gap:'6px',marginTop:'10px',flexWrap:'wrap'}},
        h('span',{class:'chip'},st.accessibility?'✓ Accessibility':'✗ Accessibility'),
        h('span',{class:'chip'},st.overlay?'✓ '+O.tr('Overlay','Поверх окон'):'✗ '+O.tr('Overlay','Поверх окон')),
        h('span',{class:'chip'},st.dndAccess?'✓ DND':'✗ DND'),
        h('span',{class:'chip'},st.writeSettings?'✓ '+O.tr('Brightness','Яркость'):'✗ '+O.tr('Brightness','Яркость')))));
    // ---- voice ----
    body.append(h('div',{class:'settings-section-title'},O.tr('Voice','Голос')));
    body.append(h('div',{class:'settings-card'},
      O.toggleRow('mic',O.tr('Wake phrase','Кодовая фраза'),
        cfg.enabled?O.tr('Listening for «'+cfg.phrase+'»','Слушаю «'+cfg.phrase+'»'):O.tr('Off','Выключено'),
        cfg.enabled,v=>{O.store.set('assistant.wakeEnabled',v);if(v)O.assistantWakeStart();else O.assistantWakeStop();draw()}),
      O.listRow('edit',O.tr('Phrase text','Текст фразы'),cfg.phrase||O.tr('not set','не задана'),O.icon('chevR'),async()=>{
        const v=await O.ask(O.tr('Wake phrase','Кодовая фраза'),O.tr('e.g. «окей код»','например: «окей код»'),cfg.phrase);
        if(v!=null){O.store.set('assistant.wakePhrase',v.trim());if(A.listening){O.assistantWakeStop();O.assistantWakeStart()}draw()}
      }),
      O.listRow('wave',O.tr('Call & dictation settings','Настройки звонка и диктовки'),O.tr('Engine, language, voice','Движок, язык, голос'),O.icon('chevR'),()=>{s.close();setTimeout(()=>O.openCallSettings&&O.openCallSettings(),200)})));
    // ---- intelligence ----
    body.append(h('div',{class:'settings-section-title'},O.tr('Intelligence','Интеллект')));
    body.append(h('div',{class:'settings-card'},
      O.toggleRow('bot',O.tr('Silent agent control','Агент без подтверждений'),
        O.tr('Agent taps/swipes without asking (macros still confirm)','Агент тапает/свайпает без спроса (шаблоны подтверждают)'),
        O.store.get('assistant.agentSilent',false),v=>O.store.set('assistant.agentSilent',v)),
      O.listRow('chat',O.tr('Assistant chat','Чат ассистента'),O.tr('Dedicated session history','Отдельная сессия с историей'),O.icon('chevR'),()=>{s.close();O.openAssistantChat()}),
      O.listRow('zap',O.tr('Macros','Шаблоны действий'),O.macros().length+' '+O.tr('templates','шаблонов'),O.icon('chevR'),()=>{s.close();O.openMacroEditor()}),
      O.listRow('list',O.tr('Installed apps','Установленные приложения'),O.tr('What the assistant can open','Что ассистент может открыть'),O.icon('chevR'),()=>{s.close();O.openInstalledApps()})));
    // ---- permissions ----
    body.append(h('div',{class:'settings-section-title'},O.tr('Permissions','Разрешения')));
    const perm=(label,ok,fn,desc)=>h('div',{class:'settings-row'},
      h('div',{class:'settings-row-icon '+(ok?'green':'amber')},O.icon('shield')),
      h('div',{class:'settings-row-text'},h('b',null,label),h('span',null,desc)),
      ok?O.icon('check','ok'):h('button',{class:'btn sm',onclick:fn},O.tr('Grant','Выдать')));
    body.append(h('div',{class:'settings-card'},
      perm('Accessibility',st.accessibility,()=>O.phone.enableAccessibility(),O.tr('Taps, swipes, screenshots','Тапы, свайпы, скриншоты')),
      perm(O.tr('Overlay','Поверх окон'),st.overlay,()=>O.phone.grantOverlay(),O.tr('Mini window over apps','Мини-окно поверх приложений')),
      perm(O.tr('Do Not Disturb','Не беспокоить'),st.dndAccess,()=>O.phone.grantDnd(),O.tr('Silent / game modes','Тихий / игровой режимы')),
      perm(O.tr('Brightness','Яркость'),st.writeSettings,()=>O.phone.grantWrite(),O.tr('Screen brightness control','Управление яркостью экрана'))));
    // ---- agent CLI hint ----
    body.append(h('div',{class:'note',style:{marginTop:'12px'}},
      O.tr('Agent CLI: phone open telegram · phone text "Миша" · phone shot · phone torch on · phone macro "Игровой режим". Names work in Russian, English and transliteration.','CLI агента: phone open telegram · phone text "Миша" · phone shot · phone torch on · phone macro "Игровой режим". Имена работают на русском, английском и транслитом.')));
  };
  draw();
};

// start services lazily
setTimeout(()=>{
  try{O.phone.serverStart()}catch(_){}
  if(wakeCfg().enabled)try{O.assistantWakeStart()}catch(_){}
},3500);

})();
