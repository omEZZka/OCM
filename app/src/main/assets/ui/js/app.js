(function(){
const O=window.OCM,h=O.h,S=O.S,api=O.api,bus=O.bus;
let built=false,tab='chat',sideTab='term',T={},P={},B={},SP={},SB={};
const wide=()=>innerWidth>=820;

function build(){
  if(built)return;built=true;
  const app=O.$('#app');

  // Compact header: hamburger + tokens on the left, session title + ⋮ menu on the right.
  T.menu=h('button',{class:'top-menu-btn',onclick:()=>O.openSessions()},O.icon('menu'));
  const BOLT_SVG='<svg viewBox="0 0 24 24" width="13" height="13" fill="#71717a" style="display:inline-block;vertical-align:middle;margin-right:3px;"><path d="M13 2L3 14h7v8l11-13h-8l1-7z"/></svg>';
  T.tokensVal=h('span',{class:'top-tokens-val'},'0 tok');
  T.tokens=h('button',{class:'top-tokens-btn',style:{display:'none'},title:O.tr('Session Tokens / Context','Токены сессии / Контекст'),onclick:()=>O.openTokensModal()},h('span',{class:'tok-bolt',html:BOLT_SVG}),T.tokensVal);
  const topLeft=h('div',{class:'top-left-box'},T.menu,T.tokens);
  T.title=h('button',{class:'top-title',title:O.tr('Sessions','Сессии'),onclick:()=>O.openSessions()},h('span',{class:'top-title-txt'},O.tr('OpenCode','OpenCode')),h('span',{class:'top-title-dot hide'}));
  O.longPress(T.title,()=>{
    const s=S.sid&&S.sessions.find(x=>x.id===S.sid);if(!s)return;
    O.actions(O.sessionTitle(s),[
      {label:O.tr('Rename','Переименовать'),icon:'edit',fn:()=>{O.ask(O.tr('Rename session','Переименование сессии'),null,O.sessionTitle(s)).then(v=>{if(v)api('PATCH','/session/'+s.id,{title:v}).catch(e=>O.toast(e.message))})}},
      {label:O.tr('Duplicate','Дублировать'),icon:'copy',fn:async()=>{try{const r=await api('POST','/session/'+s.id+'/fork',{});if(O.noteFork)O.noteFork(r.id,s.id);await O.loadSessions();O.openSession(r.id);O.toast(O.tr('Session duplicated','Сессия дублирована'),1500)}catch(e){O.toast(e.message)}}},
      {label:O.tr('Branches','Ветки диалога'),icon:'branch',fn:()=>O.openBranchTree&&O.openBranchTree()},
      {label:O.tr('Jailbreaks for this chat','Джейлбрейки этого чата'),sub:(O.sessionJbIds&&O.sessionJbIds(s.id))?O.tr('session-only set active','свой набор активен'):O.tr('follows global set','следует глобальному'),icon:'shield',fn:()=>O.openSessionJailbreaks&&O.openSessionJailbreaks(s.id)},
      {label:O.tr('Fork from here','Форк отсюда'),icon:'branch',fn:async()=>{try{const m=O.visibleMsgs(s.id).filter(x=>x.info.role==='user');if(!m.length)return O.toast(O.tr('No user messages to fork from','Нет сообщений для форка'));const last=m[m.length-1];const r=await api('POST','/session/'+s.id+'/fork',{messageID:last.info.id});if(O.noteFork)O.noteFork(r.id,s.id);await O.loadSessions();O.openSession(r.id);O.toast(O.tr('Forked from message','Форк от сообщения'),1500)}catch(e){O.toast(e.message)}}},
      {label:s.share?O.tr('Stop sharing','Отключить шаринг'):O.tr('Share','Поделиться'),icon:'share',fn:async()=>{try{if(s.share){await api('DELETE','/session/'+s.id+'/share');O.toast(O.tr('Sharing stopped','Шаринг остановлен'))}else{const r=await api('POST','/session/'+s.id+'/share',{});if(r.share){O.native.copy(r.share.url);O.native.share(r.share.url);O.toast(O.tr('Link copied','Ссылка скопирована'),1500)}}}catch(e){O.toast(e.message)}}},
      {label:O.tr('Delete','Удалить'),icon:'trash',danger:true,fn:async()=>{if(await O.confirm(O.tr('Delete session?','Удалить сессию?'),O.sessionTitle(s),O.tr('Delete','Удалить'),true))try{await api('DELETE','/session/'+s.id);S.sessions=S.sessions.filter(y=>y.id!==s.id);if(S.sid===s.id)O.openSession(S.sessions[0]&&S.sessions[0].id||null);bus.emit('sessions')}catch(e){O.toast(e.message)}}}
    ]);
  });
  T.more=h('button',{class:'top-status-btn',title:O.tr('Menu','Меню'),onclick:()=>topMenu()},O.icon('dots'));
  const topRight=h('div',{class:'top-right-box'},T.title,T.more);
  const top=h('div',{id:'top'},topLeft,topRight);
  // Agent pulse in the header (06): the title dot breathes while the agent works.
  bus.on('status',()=>{const d=T.title&&T.title.querySelector('.top-title-dot');if(d){const st=S.status[S.sid];d.classList.toggle('busy-pulse',!!st&&st.type!=='idle')}});

  T.banner=h('div',{id:'banner',class:'hide'});

  // Panes
  P.files=h('div',{id:'pane-files',class:'pane'});
  P.chat=h('div',{id:'pane-chat',class:'pane'});
  P.side=h('div',{id:'pane-side',class:'pane'});

  SP.term=h('div',{class:'side-pane'});
  SP.changes=h('div',{class:'side-pane'});
  SB.term=h('button',{onclick:()=>O.setTab('term')},O.tr('Terminal','Терминал'));
  SB.changes=h('button',{onclick:()=>O.setTab('changes')},O.tr('Changes','Изменения'));
  P.side.append(h('div',{id:'side-tabs'},SB.term,SB.changes),SP.term,SP.changes);

  const main=h('div',{id:'main'},P.files,P.chat,P.side);

  // Bottom bar: user-configurable tabs (Settings → Bottom bar), ⋮ menu always last.
  const bottomBar=h('div',{id:'bottom-bar'});
  const NAV_DEFS=[
    ['chat','chat',()=>O.tr('Chat','Чат'),()=>O.setTab('chat')],
    ['files','folder',()=>O.tr('Files','Файлы'),()=>O.setTab('files')],
    ['term','terminal',()=>O.tr('Terminal','Терминал'),()=>O.setTab('term')],
    ['changes','branch',()=>O.tr('Changes','Изменения'),()=>O.setTab('changes')],
    ['search','search',()=>O.tr('Search','Поиск'),()=>O.openGlobalSearch()],
    ['projects','folder',()=>O.tr('Projects','Проекты'),()=>O.openProjects()],
    ['sessions','list',()=>O.tr('Sessions','Сессии'),()=>O.openSessions()],
    ['voice','mic',()=>O.tr('Voice','Голос'),()=>O.onMicChoice&&O.onMicChoice()]
  ];
  O.navTabs=()=>{const v=O.store.get('navTabs',['chat','files']);return Array.isArray(v)&&v.length?v.filter(x=>NAV_DEFS.some(d=>d[0]===x)):['chat','files']};
  const buildBottom=()=>{
    bottomBar.textContent='';B={};
    O.navTabs().forEach(id=>{
      const d=NAV_DEFS.find(x=>x[0]===id);if(!d)return;
      B[id]=h('button',{class:'bottom-pill',onclick:d[3]},O.icon(d[1]),h('span',null,d[2]()));
      bottomBar.append(B[id]);
    });
    B.more=h('button',{class:'bottom-pill',onclick:()=>bottomMenu()},O.icon('dots'),h('span',null,O.tr('Menu','Меню')));
    bottomBar.append(B.more);
    layout();
  };
  O.rebuildBottomBar=buildBottom;
  buildBottom();
  O.openNavSettings=()=>{
    const body=h('div');
    const s=O.sheet(O.tr('Bottom bar','Нижний бар'),body,{hud:true});
    const draw=()=>{
      body.textContent='';
      body.append(h('div',{class:'note'},O.tr('Pick up to 4 tabs. The ⋮ menu is always there. Order = tap order below.','Выберите до 4 вкладок. Меню ⋮ всегда на месте. Порядок — по нажатию ниже.')));
      const cur=O.navTabs();
      cur.forEach((id,i)=>{
        const d=NAV_DEFS.find(x=>x[0]===id);if(!d)return;
        body.append(h('div',{class:'settings-row'},
          h('div',{class:'settings-row-icon'},O.icon(d[1])),
          h('div',{class:'settings-row-text'},h('b',null,d[2]())),
          h('button',{class:'ibtn s',disabled:i===0,onclick:()=>{const l=O.navTabs();[l[i-1],l[i]]=[l[i],l[i-1]];O.store.set('navTabs',l);buildBottom();draw()}},O.icon('up')),
          h('button',{class:'ibtn s',disabled:i===cur.length-1,onclick:()=>{const l=O.navTabs();[l[i+1],l[i]]=[l[i],l[i+1]];O.store.set('navTabs',l);buildBottom();draw()}},O.icon('down')),
          h('button',{class:'ibtn s',disabled:cur.length<=1,onclick:()=>{O.store.set('navTabs',cur.filter(x=>x!==id));buildBottom();draw()}},O.icon('x'))));
      });
      NAV_DEFS.filter(d=>!cur.includes(d[0])).forEach(d=>{
        body.append(O.listRow(d[1],d[2](),O.tr('Add','Добавить'),O.icon('plus'),()=>{
          const l=O.navTabs();
          if(l.length>=4)return O.toast(O.tr('Maximum 4 tabs','Максимум 4 вкладки'),2000);
          l.push(d[0]);O.store.set('navTabs',l);buildBottom();draw();
        }));
      });
    };
    draw();
  };

  app.append(top,T.banner,main,bottomBar);
  // focus mode exit affordance (visible only in focus mode)
  const fx=h('button',{class:'focus-exit',title:O.tr('Exit focus mode','Выйти из фокуса'),onclick:()=>O.setFocusMode(false)},O.icon('x'));
  document.body.append(fx);

  O.filesInit(P.files);
  O.chatInit(P.chat);
  O.termInit(SP.term);
  O.changesInit(SP.changes);

  // Horizontal swipe on the chat: left -> Files, right -> Sessions drawer
  if(O.swipe&&P.chat){
    O.swipe(P.chat,d=>{
      if(wide())return;
      if(d==='left')O.setTab('files');
      else if(d==='right')O.openSessions();
    },{fromLeft:0.24,fromRight:0.12,top:0.75});
    O.swipe(P.files,d=>{
      if(wide())return;
      if(d==='right')O.setTab('chat');
    },{fromLeft:0.24,top:0.75});
  }

  addEventListener('resize',O.debounce(layout,100));
  ['open','session','sessions','msg','vcs','dir','meta','diff','status','idle'].forEach(e=>bus.on(e,O.debounce(updateTop,120)));
  bus.on('mm',O.debounce(updateTop,60));
  bus.on('conn',updateBanner);
  bus.on('status',O.debounce(updateBanner,400));
  bus.on('statuspanel',refreshStatus);
  layout();
  updateTop();
}

function layout(){
  const app=O.$('#app');
  const w=wide();
  app.dataset.mode=w?'wide':'narrow';
  P.files.classList.toggle('show',!w&&tab==='files');
  P.chat.classList.toggle('show',!w&&tab==='chat');
  P.side.classList.toggle('show',!w&&(tab==='term'||tab==='changes'));
  SP.term.classList.toggle('show',sideTab==='term');
  SP.changes.classList.toggle('show',sideTab==='changes');
  SB.term.classList.toggle('on',sideTab==='term');
  SB.changes.classList.toggle('on',sideTab==='changes');
  for(const k in B){if(k!=='more')B[k].classList.toggle('active',tab===k)}
  if(O.termShown)O.termShown();
}

function bottomMenu(){
  const memOn=O.store.get('memory',true);
  // Session-only jailbreaks: the effective set lives in store.js (sessionJailbreaks), so this
  // menu entry is just the entry point — nothing is ever written to the shared AGENTS.md.
  const jbOwn=O.sessionJbIds&&O.sessionJbIds(S.sid);
  const jbCount=jbOwn?jbOwn.size:(O.getActiveJailbreakIds?O.getActiveJailbreakIds().size:0);
  const mascotOn=S.opts.mascotOn!==false;
  O.actions(O.tr('Menu','Меню'),[
    {label:O.tr('Jailbreaks for this chat','Джейлбрейки этого чата'),
      sub:!S.sid?O.tr('open a chat first','сначала откройте чат')
        :(jbOwn?(O.tr('session-only set: ','свой набор: ')+jbCount):(O.tr('follows global: ','следует глобальному: ')+jbCount))+' · '+O.tr('this session only','только эта сессия'),
      icon:'shield',fn:()=>{
        if(!S.sid)return O.toast(O.tr('Open a chat first','Сначала откройте чат'),1800);
        O.openSessionJailbreaks&&O.openSessionJailbreaks(S.sid);
      }},
    {label:O.tr('Mascot tuning…','Настройки маскота…'),
      sub:mascotOn?O.tr('Gaze, hints, tools, glow, speed — per feature','Взгляд, подсказки, инструменты, свечение, скорость — по отдельности')
        :O.tr('Mascot is hidden','Маскот скрыт'),
      icon:'bot',fn:()=>{O.openMascotTuning?O.openMascotTuning():O.openMascotSettings&&O.openMascotSettings()}},
    {label:O.tr('Mascot workshop','Мастерская маскота'),sub:O.tr('100 ideas, pick what comes next','100 идей, выберите, что дальше'),icon:'bulb',fn:()=>O.openMascotIdeas&&O.openMascotIdeas()},
    {label:O.tr('Terminal','Терминал'),icon:'terminal',fn:()=>O.setTab('term')},
    {label:O.tr('Changes','Изменения'),icon:'branch',fn:()=>O.setTab('changes')},
    {label:O.tr('Bottom bar…','Нижний бар…'),sub:O.tr('Choose your tabs','Выбрать свои вкладки'),icon:'sliders',fn:()=>O.openNavSettings()},
    {label:memOn?O.tr('Memory: on','Память: вкл'):O.tr('Memory: off','Память: выкл'),sub:O.tr('Project map and rules generation','Создание карты проекта и правил'),icon:'memory',fn:()=>{
      const v=!O.store.get('memory',true);
      O.store.set('memory',v);
      O.toast(v?(O.tr('Memory on: project map and rules are generated','Память включена: карта проекта и правила создаются')):(O.tr('Memory off: project map generation stopped','Память выключена: карта проекта больше не создаётся')),2000);
    }},
    {label:O.tr('Sessions','Сессии'),icon:'list',fn:()=>O.openSessions()},
    {label:O.tr('Settings','Настройки'),icon:'sliders',fn:()=>O.openSettings()}
  ]);
}

function topMenu(){
  const mmA=O.mmActive&&O.mmActive();
  O.actions(O.tr('Session menu','Меню сессии'),[
    {label:O.tr('Token statistics','Статистика токенов'),sub:O.fmtK(O.calcSessionTokens(S.sid).total)+' tok',icon:'zap',fn:()=>O.openTokensModal()},
    {label:O.tr('Server & MCP status','Статус сервера и MCP'),icon:'server',fn:()=>O.openStatus()},
    {label:mmA?(O.tr('Multimodal: ','Мультимодальный: ')+mmA.name):O.tr('Multimodal agents','Мультимодальные агенты'),icon:'bot',fn:()=>O.openMultimodalPicker()},
    {label:O.tr('Models','Модели'),icon:'cpu',fn:()=>O.openModels()},
    {label:O.tr('New session','Новая сессия'),icon:'plus',fn:()=>O.newSession()},
    {label:O.tr('Settings','Настройки'),icon:'sliders',fn:()=>O.openSettings()}
  ]);
}

O.setFocusMode=on=>{
  document.documentElement.classList.toggle('focus-mode',!!on);
  O.store.set('focusMode',!!on);
  if(on)O.toast(O.tr('Focus mode — tap ✕ to exit','Фокус-режим — нажмите ✕ для выхода'),2500);
};
O.focusMode=()=>O.store.get('focusMode',false);
if(O.store.get('focusMode',false))document.documentElement.classList.add('focus-mode');

O.setTab=t=>{
  tab=t;
  if(t==='term'||t==='changes')sideTab=t;
  layout();
  if(t==='files')O.refreshFiles(false);
  if(t==='changes')O.refreshChanges();
};

// PERF: token totals were recomputed by walking EVERY message on every status/msg tick
// (O(n) over 1000+ messages several times per second). Incremental cache keyed by message count
// plus the last message's token fingerprint; full walks only when history actually changed.
const tokCache=new Map();
O.calcSessionTokens=sid=>{
  sid=sid||S.sid;
  const msgs=O.visibleMsgs(sid);
  // fingerprint covers every message's tokens/cost, not just the last one: a resync can update
  // an older message's accounting without changing the count. Cheap loop, no object churn.
  let fp=msgs.length+'|';
  for(const m of msgs){const i=m.info;fp+=(i.tokens?(i.tokens.input||0)+(i.tokens.output||0)+(i.tokens.reasoning||0):0)+','+(i.cost||0)+';'}
  let c=tokCache.get(sid);
  if(!c||c.fp!==fp){
    let input=0,output=0,reasoning=0,cost=0;
    for(const m of msgs){
      const info=m.info;
      if(info&&info.tokens){input+=(info.tokens.input||0);output+=(info.tokens.output||0);reasoning+=(info.tokens.reasoning||0)}
      if(info&&typeof info.cost==='number')cost+=info.cost;
    }
    c={fp,input,output,reasoning,cost,total:input+output+reasoning};
    if(tokCache.size>40)tokCache.clear();
    tokCache.set(sid,c);
  }
  const usage=O.contextUsage(sid);
  return{input:c.input,output:c.output,reasoning:c.reasoning,total:c.total,cost:c.cost,pct:usage?usage.pct:null,lim:usage?usage.lim:null};
};

O.openTokensModal=()=>{
  const tok=O.calcSessionTokens(S.sid);
  const card=h('div',{class:'settings-card'},
    h('div',{class:'settings-row'},
      h('div',{class:'settings-row-icon amber'},O.icon('cpu')),
      h('div',{class:'settings-row-text'},
        h('b',null,O.tr('Total Tokens in Session','Всего токенов в сессии')),
        h('span',null,tok.total.toLocaleString()+' ('+O.fmtK(tok.total)+')'))),
    h('div',{class:'settings-row'},
      h('div',{class:'settings-row-icon blue'},O.icon('down')),
      h('div',{class:'settings-row-text'},
        h('b',null,O.tr('Prompt Tokens (Input)','Входящие токены (Промпт)')),
        h('span',null,tok.input.toLocaleString()))),
    h('div',{class:'settings-row'},
      h('div',{class:'settings-row-icon green'},O.icon('up')),
      h('div',{class:'settings-row-text'},
        h('b',null,O.tr('Completion Tokens (Output)','Исходящие токены (Генерация)')),
        h('span',null,tok.output.toLocaleString()))),
    tok.reasoning?h('div',{class:'settings-row'},
      h('div',{class:'settings-row-icon purple'},O.icon('bulb')),
      h('div',{class:'settings-row-text'},
        h('b',null,O.tr('Reasoning Tokens','Токены размышлений')),
        h('span',null,tok.reasoning.toLocaleString()))):null,
    tok.pct!=null?h('div',{class:'settings-row'},
      h('div',{class:'settings-row-icon purple'},O.icon('memory')),
      h('div',{class:'settings-row-text'},
        h('b',null,O.tr('Context Window Utilization','Заполненность контекста')),
        h('span',null,tok.pct+'%'+(tok.lim?' / '+O.fmtK(tok.lim)+' tok':'')))):null,
    tok.cost>0?h('div',{class:'settings-row'},
      h('div',{class:'settings-row-icon green'},O.icon('star')),
      h('div',{class:'settings-row-text'},
        h('b',null,O.tr('Session Cost','Стоимость сессии')),
        h('span',null,'$'+tok.cost.toFixed(4)))):null
  );
  O.sheet(O.tr('Token Statistics','Статистика токенов'),card);
};

function updateTop(){
  if(!built)return;
  if(T.tokensVal){
    const tok=O.calcSessionTokens(S.sid);
    if(T.tokens)T.tokens.style.display='inline-flex';
    const txt=tok.total>0?(O.fmtK(tok.total)+' tok'):'0 tok';
    const pct=tok.pct!=null?(' · '+tok.pct+'%'):'';
    T.tokensVal.textContent=txt+pct;
  }
  // Status indicator in the ⋮ menu button if MCP needs attention
  const v=Object.values(S.mcp||{});
  const hasErr=v.some(x=>x.status==='failed'||x.status==='needs_auth');
  if(T.more)T.more.classList.toggle('active',hasErr);
  updateTopTitle();
}

function updateTopTitle(){
  if(!T.title)return;
  const sp=T.title.querySelector('.top-title-txt');
  if(!sp)return;
  const s=S.sid&&S.sessions.find(x=>x.id===S.sid);
  const t=s?O.sessionTitle(s):O.tr('OpenCode','OpenCode');
  sp.textContent=t;
  T.title.classList.toggle('empty',!s);
  const dot=T.title.querySelector('.top-title-dot');
  if(dot){
    const st=S.status[S.sid];
    const busy=!!st&&st.type!=='idle';
    dot.classList.toggle('hide',!busy);
  }
}

function updateBanner(){
  if(!built)return;
  const err=(O.native.state&&O.native.state().serverError)||'';
  let t='';
  if(err)t=O.tr('Local server failed: ','Локальный сервер не запустился: ')+String(err).split('\n')[0];
  else if(S.offline)t=O.tr('Offline — showing cached chats','Офлайн — показаны кэшированные чаты');
  else if(!S.up)t=O.tr('Connecting to local runtime...','Подключение к локальному серверу...');
  T.banner.textContent=t;
  T.banner.classList.toggle('hide',!t);
  // a failed server must offer the one action that fixes it, right where the error is shown
  const old=T.banner.querySelector('button');
  if(old)old.remove();
  if(err){
    T.banner.append(h('button',{class:'btn sm',style:{marginLeft:'8px'},onclick:()=>{O.runDiagnostics?O.runDiagnostics():O.openCompat&&O.openCompat()}},O.tr('Diagnose','Диагностика')),
      h('button',{class:'btn sm',style:{marginLeft:'6px'},onclick:()=>{try{OC.restartServer()}catch(_){}}},O.tr('Restart','Перезапуск')));
  }
}

async function refreshStatus(){
  try{
    const m=await api('GET','/mcp');
    S.mcp=m;
    updateTop();
  }catch{}
}

O.enter=async opt=>{
  build();
  O.saveOpts();
  S.offline=!!(opt&&opt.offline);
  S.up=false;
  updateBanner();
  OC.sseStart();
  if(O.checkAccount)O.checkAccount();
  await O.setDir(O.store.get('dir','/root'));
  if(O.migrateData)try{await O.migrateData()}catch(_){}
  updateBanner();
  updateTop();
  refreshStatus();
  O.iconsReady.then(()=>{O.refreshFiles(false)});
  // (61) first-run tour, once
  if(!O.store.get('tourSeen',false)&&O.openTour)setTimeout(()=>{try{O.openTour()}catch(_){}},1200);
  if(O.initAppLock)try{O.initAppLock()}catch(_){}
};

O.reconnect=async()=>{
  if(!built)return;
  S.offline=false;
  S.up=true;
  updateBanner();
  try{OC.sseStart()}catch(e){}
  await O.setDir(S.dir||O.store.get('dir','/root'));
  updateBanner();
  refreshStatus();
};

O.on('server',d=>{
  if(!built)return;
  S.up=!!d.ready;
  updateBanner();
  if(d.ready){
    try{OC.sseStart()}catch(e){}
    refreshStatus();
  }
});

O.on('share',d=>{
  if(!d||(!d.text&&!(d.files&&d.files.length)))return;
  const go=()=>{
    if(!built){setTimeout(go,200);return}
    const apply=()=>{
      O.setTab('chat');
      if(d.text&&O.insertText)O.insertText(d.text);
      // shared images/PDFs become normal attachments in the composer
      if(Array.isArray(d.files)&&d.files.length&&O.chatAttach){
        O.chatAttach(d.files);
        O.toast(O.tr('Attached files: ','Вложено файлов: ')+d.files.length,2000);
      }else if(d.text){
        O.toast(O.tr('Shared text inserted','Текст из другого приложения вставлен'),1800);
      }
    };
    // Let the user pick the destination chat instead of always the active one.
    const ses=(S.sessions||[]).slice(0,8);
    if(ses.length>1){
      O.actions(O.tr('Share to…','Поделиться в…'),[
        {label:O.tr('Current chat','Текущий чат'),sub:S.sid?O.sessionTitle(S.sessions.find(x=>x.id===S.sid)||{}):'',icon:'chat',fn:apply},
        {label:O.tr('New chat','Новый чат'),icon:'plus',fn:async()=>{try{await O.newSession();apply()}catch(e){O.toast(e.message)}}},
        {section:O.tr('Recent chats','Недавние чаты')},
        ...ses.filter(x=>x.id!==S.sid).slice(0,6).map(x=>({label:O.sessionTitle(x),icon:'chat',fn:async()=>{await O.openSession(x.id);apply()}}))
      ]);
    }else apply();
  };
  go();
});

const baseBack=O.back;
O.back=()=>{
  if(baseBack())return true;
  if(built&&!wide()&&tab!=='chat'){
    O.setTab('chat');
    return true;
  }
  return false;
};

function initKeyboardShortcuts(){
  document.addEventListener('keydown',e=>{
    if(e.target&&(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.isContentEditable)){
      if(!(e.ctrlKey||e.metaKey))return;
    }
    const k=(e.key||'').toLowerCase();
    if((e.ctrlKey||e.metaKey)){
      if(k==='enter'){
        e.preventDefault();
        const sb=O.$('#send');
        if(sb&&!sb.disabled)O.chat.focus(),setTimeout(()=>sb.click(),0);
      }else if(k==='k'){
        e.preventDefault();
        ta=O.$('#composer textarea');
        if(ta){ta.value='/';ta.dispatchEvent(new Event('input'));ta.focus()}
      }else if(k==='m'){
        e.preventDefault();O.openModels();
      }else if(k==='t'&&e.shiftKey){
        e.preventDefault();O.newSession();
      }else if(k==='s'&&e.shiftKey){
        e.preventDefault();O.openSessions();
      }else if(k==='/'){
        e.preventDefault();S.opts.thinking=!S.opts.thinking;O.saveOpts();O.chat.renderAll();
      }
    }else if(k==='escape'){
      if(O.back())e.preventDefault();
    }
  });
}
document.addEventListener('DOMContentLoaded',()=>{
  O.saveOpts();
  // Native handshake (audit K4): tell Kotlin the event sink exists so buffered notification
  // intents are delivered now, not lost to a fixed timer.
  try{if(window.OC&&OC.uiHandshake)OC.uiHandshake()}catch(_){}
  O.bootRun();
  initKeyboardShortcuts();
});


O.playChime=kind=>{
  try{if(window.OC&&window.OC.testSound){window.OC.testSound(kind);return}}catch(e){}
  try{
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    if(!ctx)return;
    const now=ctx.currentTime;
    const notes=kind==='done'?[[659.25,0,0.11],[880,0.11,0.13],[1318.5,0.24,0.36]]
      :(kind==='action'?[[784,0,0.11],[1046.5,0.11,0.28]]
      :[[587.33,0,0.15],[493.88,0.15,0.32]]);
    notes.forEach(([freq,delay,dur])=>{
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();
      osc.type='sine';
      osc.frequency.setValueAtTime(freq,now+delay);
      gain.gain.setValueAtTime(0.0001,now+delay);
      gain.gain.exponentialRampToValueAtTime(0.18,now+delay+0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001,now+delay+dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now+delay);
      osc.stop(now+delay+dur+0.05);
    });
  }catch(e){}
};

addEventListener('unhandledrejection',e=>console.error(e.reason));
})();
