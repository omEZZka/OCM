(function(){
const O=window.OCM,h=O.h,S=O.S,api=O.api,bus=O.bus;
let built=false,tab='chat',sideTab='term',T={},P={},B={},SP={},SB={};
const wide=()=>innerWidth>=820;

O.tr=(en,ru)=>(O.store.get('lang','ru')==='en'?en:ru);

function build(){
  if(built)return;built=true;
  const app=O.$('#app');

  // Minimal Top Header matching Screenshot 1: Hamburger on left, Tokens badge right next to it, Ghost mascot on right
  T.menu=h('button',{class:'top-menu-btn',onclick:()=>O.openSessions()},O.icon('menu'));
  const BOLT_SVG='<svg viewBox="0 0 24 24" width="13" height="13" fill="#71717a" style="display:inline-block;vertical-align:middle;margin-right:3px;"><path d="M13 2L3 14h7v8l11-13h-8l1-7z"/></svg>';
  T.tokensVal=h('span',{class:'top-tokens-val'},'0 tok');
  T.tokens=h('button',{class:'top-tokens-btn',style:{display:'none'},title:O.tr('Session Tokens / Context','Токены сессии / Контекст'),onclick:()=>O.openTokensModal()},h('span',{class:'tok-bolt',html:BOLT_SVG}),T.tokensVal);
  const topLeft=h('div',{class:'top-left-box'},T.menu,T.tokens);
  T.mm=h('button',{class:'top-mm-btn',title:O.tr('Multimodal agents','Мультимодальные агенты'),onclick:()=>O.openMultimodalPicker()},O.icon('bot'),h('span',{class:'top-mm-txt'},'MM'));
  T.status=h('button',{class:'top-status-btn',title:O.tr('Server & MCP Status','Статус сервера и MCP'),onclick:()=>O.openStatus()},O.icon('sliders'));
  const topRight=h('div',{class:'top-right-box'},T.mm,T.status);
  const top=h('div',{id:'top'},topLeft,topRight);

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

  // Bottom Pill Bar matching Screenshot 1: Centered [Chat] and [Memory on]
  let memOn=O.store.get('memory',true);
  const memLabel=()=>memOn?(O.tr('Memory on','Память вкл')):(O.tr('Memory off','Память выкл'));
  B.chat=h('button',{class:'bottom-pill active',onclick:()=>O.setTab('chat')},O.icon('chat'),h('span',null,O.tr('Chat','Чат')));
  B.memTxt=h('span',null,memLabel());
  B.memory=h('button',{class:'bottom-pill'+(memOn?' active':''),onclick:()=>{
    memOn=!memOn;
    O.store.set('memory',memOn);
    B.memTxt.textContent=memLabel();
    B.memory.classList.toggle('active',memOn);
    O.toast(memOn?(O.tr('Memory active: persistent project rules enabled','Память активна: правила и контекст включены')):(O.tr('Memory disabled','Память отключена')),2000);
  }},O.icon('memory'),B.memTxt);

  const bottomBar=h('div',{id:'bottom-bar'},B.chat,B.memory);

  app.append(top,T.banner,main,bottomBar);

  O.filesInit(P.files);
  O.chatInit(P.chat);
  O.termInit(SP.term);
  O.changesInit(SP.changes);

  addEventListener('resize',O.debounce(layout,100));
  ['open','session','sessions','msg','vcs','dir','meta','diff'].forEach(e=>bus.on(e,O.debounce(updateTop,120)));
  bus.on('mm',O.debounce(updateTop,60));
  bus.on('conn',updateBanner);
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
  if(B.chat)B.chat.classList.toggle('active',tab==='chat');
  if(O.termShown)O.termShown();
}

O.setTab=t=>{
  tab=t;
  if(t==='term'||t==='changes')sideTab=t;
  layout();
  if(t==='files')O.refreshFiles(false);
  if(t==='changes')O.refreshChanges();
};

O.calcSessionTokens=sid=>{
  const msgs=O.visibleMsgs(sid||S.sid);
  let input=0,output=0,reasoning=0,total=0,cost=0;
  for(const m of msgs){
    const info=m.info;
    if(info&&info.tokens){
      input+=(info.tokens.input||0);
      output+=(info.tokens.output||0);
      reasoning+=(info.tokens.reasoning||0);
    }
    if(info&&typeof info.cost==='number')cost+=info.cost;
  }
  total=input+output+reasoning;
  const usage=O.contextUsage(sid||S.sid);
  return{input,output,reasoning,total,cost,pct:usage?usage.pct:null,lim:usage?usage.lim:null};
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
  // Status icon dot/indicator if MCP needs attention
  const v=Object.values(S.mcp||{});
  const hasErr=v.some(x=>x.status==='failed'||x.status==='needs_auth');
  if(T.status)T.status.classList.toggle('active',hasErr);
  updateTopMm();
}

function updateTopMm(){
  if(!T.mm)return;
  const mmA=O.mmActive&&O.mmActive();
  T.mm.classList.toggle('active',!!mmA);
  const sp=T.mm.querySelector('.top-mm-txt');
  if(sp)sp.textContent=mmA?mmA.name:'MM';
}

function updateBanner(){
  if(!built)return;
  const t=S.offline?(O.tr('Offline — showing cached chats','Офлайн — показаны кэшированные чаты')):(!S.up?(O.tr('Connecting to local runtime...','Подключение к локальному серверу...')):'');
  T.banner.textContent=t;
  T.banner.classList.toggle('hide',!t);
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
  updateBanner();
  updateTop();
  refreshStatus();
  O.iconsReady.then(()=>{O.refreshFiles(false)});
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
  if(!d||!d.text)return;
  const go=()=>{
    if(!built){setTimeout(go,200);return}
    O.setTab('chat');
    if(O.insertText)O.insertText(d.text);
    O.toast(O.tr('Shared text inserted','Текст из другого приложения вставлен'),1800);
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
document.addEventListener('DOMContentLoaded',()=>{
  O.saveOpts();
  O.bootRun();
});
})();
