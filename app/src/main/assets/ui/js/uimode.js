(function(){
// ==========================================================================
// UI MODES + THEME LAYERS
//   mode        : 'chat'    classic bubbles
//                 'term'    agent/console view (Claude-Code-like)
//   theme layers: global (shell/sidebar) · chat (feed) · term (logs/tools/diffs)
//
// Nothing here re-implements sending or agent logic: the mode only flips a
// data attribute on <html> and the CSS + a few render hooks do the rest.
// ==========================================================================
const O=window.OCM,h=O.h,S=O.S,bus=O.bus;

const MODES=['chat','term'];
const LAYERS=['global','chat','term'];

O.uiMode=()=>(MODES.includes(S.opts.uiMode)?S.opts.uiMode:'chat');
O.isTermMode=()=>O.uiMode()==='term';

// ---- theme layers -------------------------------------------------------
// Each layer stores a theme id; null = follow the global theme. The global
// layer is the legacy S.opts.theme so existing installs keep their look.
const layerKey=l=>'themeLayer.'+l;
O.themeLayer=l=>{
  if(l==='global')return S.opts.theme;
  const v=O.store.get(layerKey(l),null);
  return v||S.opts.theme;
};
O.setThemeLayer=(l,id)=>{
  if(l==='global'){
    S.opts.theme=id;O.store.set('themeManual',id);O.store.set('themeAuto',false);
    O.saveOpts();
  }else{
    if(id===null||id===undefined)O.store.remove(layerKey(l));
    else O.store.set(layerKey(l),id);
  }
  O.applyThemeLayers();
  bus.emit('themeLayer',l);
};

// Build the CSS for a layer scope from a palette. The same variable set as the
// global theme, so every existing component keeps working inside the scope.
const scopeVars=(sel,vars)=>{
  const body=Object.keys(vars).map(k=>k+':'+vars[k]).join(';');
  return sel+'{'+body+'}';
};
let layerEl=null;
O.applyThemeLayers=()=>{
  const root=document.documentElement;
  // global
  if(O.applyTheme)O.applyTheme(S.opts.theme);
  const chatId=O.themeLayer('chat'),termId=O.themeLayer('term');
  const parts=[];
  const chatT=O.themeById(chatId),termT=O.themeById(termId);
  // The feed scope only overrides surfaces/text of the message list; the shell
  // keeps the global palette. `--bg` is mapped onto the feed background var.
  if(chatId!==S.opts.theme){
    const v=O.themeVars(chatT);
    parts.push(scopeVars('#msgs,.chat-msgs-wrap',{
      '--bg':v['--bg'],'--bg2':v['--bg2'],'--bg3':v['--bg3'],
      '--card':v['--card'],'--card-hover':v['--card-hover'],
      '--fg':v['--fg'],'--mut':v['--mut'],'--line':v['--line'],'--line2':v['--line2'],
      '--acc':v['--acc'],'--acc2':v['--acc2'],'--acc-fg':v['--acc-fg'],
      '--ok':v['--ok'],'--err':v['--err'],'--warn':v['--warn'],
      '--code':v['--code'],'--add':v['--add'],'--del':v['--del'],
      'background':v['--bg'],'color':v['--fg']
    }));
  }
  // Terminal layer: active only in term mode, but the preview in settings uses
  // the same scope so the user sees exactly what they will get.
  const v=O.themeVars(termT);
  parts.push(scopeVars('html[data-ui=term] #pane-chat,html[data-ui=term] #pane-side,.term-preview',{
    '--bg':v['--bg'],'--bg2':v['--bg2'],'--bg3':v['--bg3'],
    '--card':v['--card'],'--card-hover':v['--card-hover'],
    '--fg':v['--fg'],'--mut':v['--mut'],'--line':v['--line'],'--line2':v['--line2'],
    '--acc':v['--acc'],'--acc2':v['--acc2'],'--acc-fg':v['--acc-fg'],
    '--ok':v['--ok'],'--err':v['--err'],'--warn':v['--warn'],
    '--code':v['--code'],'--add':v['--add'],'--del':v['--del'],
    'color-scheme':termT.light?'light':'dark'
  }));
  parts.push('html[data-ui=term] #pane-chat{background:'+v['--bg']+';color:'+v['--fg']+'}');
  parts.push('html[data-ui=term] #pane-side{background:'+v['--bg2']+';color:'+v['--fg']+'}');
  if(!layerEl){layerEl=document.createElement('style');layerEl.id='ocm-theme-layers';document.head.append(layerEl)}
  layerEl.textContent=parts.join('\n');
};

// ---- mode switching -----------------------------------------------------
O.setUiMode=m=>{
  if(!MODES.includes(m))m='chat';
  S.opts.uiMode=m;
  O.saveOpts();
  document.documentElement.dataset.ui=m;
  O.applyThemeLayers();
  if(O.termLayout)O.termLayout();
  bus.emit('uiMode',m);
  return m;
};
O.toggleUiMode=()=>O.setUiMode(O.isTermMode()?'chat':'term');

// ---- sidebar segmented control (Chat / Terminal) ------------------------
O.uiModeSeg=()=>{
  const seg=h('div',{class:'seg ui-mode-seg',title:O.tr('Interface mode','Режим интерфейса')});
  const btn=(m,label,icon)=>h('button',{class:O.uiMode()===m?'on':'',onclick:()=>{
    O.setUiMode(m);
    seg.querySelectorAll('button').forEach((b,i)=>b.classList.toggle('on',MODES[i]===m));
  }},O.icon(icon),h('span',null,label));
  seg.append(btn('chat',O.tr('Chat','Чат'),'chat'),btn('term',O.tr('Terminal','Терминал'),'terminal'));
  return seg;
};

// ---- landscape three-column session rail --------------------------------
const railState=()=>O.store.get('termRail',{left:true,right:true,leftW:230,rightW:340});
const saveRail=r=>{O.store.set('termRail',r);if(O.termLayout)O.termLayout()};
O.termRailState=railState;
O.termRailSet=patch=>saveRail(Object.assign(railState(),patch));

const sessionGroup=s=>{
  const st=S.status[s.id];
  return st&&st.type!=='idle'?'run':'idle';
};
const railList=(host,which)=>{
  host.textContent='';
  const all=(S.sessions||[]).filter(s=>!s.parentID);
  const groups={run:[],idle:[]};
  all.forEach(s=>groups[sessionGroup(s)].push(s));
  const section=(key,label)=>{
    const items=groups[key];
    host.append(h('div',{class:'rail-grp'},label+' ('+items.length+')'));
    if(!items.length){host.append(h('div',{class:'rail-empty'},O.tr('none','нет')));return}
    items.slice(0,60).forEach(s=>{
      const row=h('button',{class:'rail-item'+(s.id===S.sid?' on':''),onclick:()=>{O.openSession(s.id);if(O.termLayout)O.termLayout()}},
        h('span',{class:'rail-dot'+(key==='run'?' run':'')}),
        h('span',{class:'rail-title'},O.sessionTitle(s)));
      host.append(row);
    });
  };
  section('run',O.tr('In progress','В работе'));
  section('idle',O.tr('Idle','Простой'));
};

let railL=null,railR=null,railLList=null,railRList=null,gripL=null,gripR=null;
let mainEl=null,chatPaneEl=null,sidePaneEl=null;
O.termRailsInit=(appEl,chatPane,sidePane)=>{
  if(railL)return;
  mainEl=chatPane.parentNode;chatPaneEl=chatPane;sidePaneEl=sidePane;
  railLList=h('div',{class:'rail-list'});
  railL=h('div',{id:'term-rail-left',class:'term-rail'},
    h('div',{class:'rail-head'},h('b',{class:'grow'},O.tr('Sessions','Сессии')),
      h('button',{class:'ibtn s',title:O.tr('New chat','Новый чат'),onclick:()=>O.newSession()},O.icon('plus')),
      h('button',{class:'ibtn s',title:O.tr('Hide panel','Скрыть панель'),onclick:()=>O.termRailSet({left:false})},O.icon('chevL'))),
    O.uiModeSeg?O.uiModeSeg():null,
    railLList);
  gripL=h('div',{class:'rail-grip',title:O.tr('Resize','Ширина')});
  railRList=h('div',{class:'rail-list'});
  railR=h('div',{id:'term-rail-right',class:'term-rail'},
    h('div',{class:'rail-head'},h('b',{class:'grow'},O.tr('Changes','Изменения')),
      h('button',{class:'ibtn s',title:O.tr('Hide panel','Скрыть панель'),onclick:()=>O.termRailSet({right:false})},O.icon('x'))),
    railRList);
  gripR=h('div',{class:'rail-grip',title:O.tr('Resize','Ширина')});
  mainEl.insertBefore(railL,mainEl.firstChild);
  mainEl.insertBefore(gripL,chatPaneEl);
  mainEl.insertBefore(gripR,sidePaneEl);
  mainEl.insertBefore(railR,sidePaneEl);
  const drag=(grip,side)=>{
    let sx=0,sw=0,on=false;
    const down=e=>{
      const t=e.touches?e.touches[0]:e;
      on=true;sx=t.clientX;sw=railState()[side==='left'?'leftW':'rightW'];
      document.body.classList.add('rail-resizing');
      if(e.cancelable)e.preventDefault();
    };
    const move=e=>{
      if(!on)return;
      const t=e.touches?e.touches[0]:e;
      const d=t.clientX-sx;
      const w=Math.max(150,Math.min(460,side==='left'?sw+d:sw-d));
      const patch=side==='left'?{leftW:w}:{rightW:w};
      O.store.set('termRail',Object.assign(railState(),patch));
      O.termLayout();
      if(e.cancelable)e.preventDefault();
    };
    const up=()=>{if(!on)return;on=false;document.body.classList.remove('rail-resizing')};
    grip.addEventListener('pointerdown',down);
    grip.addEventListener('touchstart',down,{passive:false});
    addEventListener('pointermove',move,{passive:false});
    addEventListener('touchmove',move,{passive:false});
    addEventListener('pointerup',up);addEventListener('touchend',up);
  };
  drag(gripL,'left');drag(gripR,'right');
  ['sessions','status','open','idle','diff'].forEach(e=>bus.on(e,()=>{try{O.termLayout()}catch(_){}}));
};

// Diff preview for the right rail: reuse the existing renderer, no new logic.
const railDiffs=host=>{
  host.textContent='';
  const sid=S.sid;if(!sid){host.append(h('div',{class:'rail-empty'},O.tr('no session','нет сессии')));return}
  const list=O.msgs(sid).list;
  const found=[];
  for(let i=list.length-1;i>=0&&found.length<12;i--){
    for(const p of list[i].parts||[]){
      const md=p.type==='tool'&&p.state&&p.state.metadata;
      if(md&&md.diff)found.push({file:(p.state.input&&(p.state.input.filePath||p.state.input.path))||p.tool||'diff',diff:md.diff});
      if(p.type==='patch'&&p.diff)found.push({file:(p.files&&p.files[0]&&(p.files[0].path||p.files[0]))||'patch',diff:p.diff});
    }
  }
  if(!found.length){host.append(h('div',{class:'rail-empty'},O.tr('No changes yet','Изменений пока нет')));return}
  found.forEach(f=>{
    const body=h('div',{class:'rail-diff-b hide'},O.unifiedEl(String(f.diff).slice(0,20000)));
    const head=h('button',{class:'rail-diff-h',onclick:()=>body.classList.toggle('hide')},
      O.icon('edit'),h('span',{class:'mono grow'},O.rel(f.file)),O.icon('chevD'));
    host.append(h('div',{class:'rail-diff'},head,body));
  });
};

O.termLayout=()=>{
  const app=O.$('#app');if(!app)return;
  const term=O.isTermMode(),wide=innerWidth>=820;
  app.dataset.term=term?'1':'0';
  document.documentElement.dataset.ui=O.uiMode();
  if(!railL)return;
  const r=railState();
  const show=term&&wide;
  railL.classList.toggle('show',show&&r.left);
  gripL.classList.toggle('show',show&&r.left);
  railR.classList.toggle('show',show&&r.right);
  gripR.classList.toggle('show',show&&r.right);
  railL.style.width=r.leftW+'px';
  railR.style.width=r.rightW+'px';
  // the existing wide grid puts files/chat/side in this order; the rails take part in it
  const filesPane=O.$('#pane-files');
  if(filesPane)filesPane.style.display=(show)?'none':'';
  app.dataset.termWide=show?'1':'0';
  if(show&&r.left)railList(railLList,'left');
  if(show&&r.right)railDiffs(railRList);
};

// ---- settings sheet -----------------------------------------------------
O.openUiModeSettings=()=>{
  const body=h('div');
  const draw=()=>{
    body.textContent='';
    body.append(
      h('div',{class:'note'},O.tr('Classic chat keeps bubbles. Terminal shows the agent as a console: compact tool cards, monospaced paths, three columns in landscape.','Классический чат — пузыри. Терминал показывает агента как консоль: компактные карточки инструментов, моноширинные пути, три колонки в альбомной ориентации.')),
      h('div',{class:'grp'},O.tr('Interface mode','Режим интерфейса')),
      h('div',{class:'seg'},MODES.map(m=>h('button',{class:O.uiMode()===m?'on':'',
        onclick:()=>{O.setUiMode(m);draw()}},m==='chat'?O.tr('Classic chat','Классический чат'):O.tr('Terminal','Терминал')))),
      h('div',{class:'grp'},O.tr('Theme layers','Слои тем')));
    const layerRow=(l,title,sub)=>{
      const cur=O.themeLayer(l);
      const t=O.themeById(cur);
      return O.listRow('palette',title,sub+' · '+t.name+(l!=='global'&&cur===S.opts.theme?' ('+O.tr('follows global','как глобальная')+')':''),O.icon('chevR'),()=>{
        const items=[{label:O.tr('Global theme','Глобальная тема'),sub:O.themeById(S.opts.theme).name,icon:'check',fn:()=>{O.setThemeLayer(l,l==='global'?S.opts.theme:null);draw()}}];
        if(l!=='global')items[0]={label:O.tr('Follow global','Как глобальная'),sub:O.themeById(S.opts.theme).name,icon:'undo',fn:()=>{O.setThemeLayer(l,null);draw()}};
        O.themeList().forEach(th=>items.push({label:th.name,sub:th.tag||'',icon:cur===th.id?'check':'palette',fn:()=>{O.setThemeLayer(l,th.id);draw()}}));
        O.actions(title,items);
      });
    };
    body.append(
      layerRow('global',O.tr('Global theme','Глобальная тема'),O.tr('Shell, sidebar, sheets','Оболочка, сайдбар, окна')),
      layerRow('chat',O.tr('Chat theme','Тема чата'),O.tr('Message bubbles and feed','Пузыри сообщений и лента')),
      layerRow('term',O.tr('Terminal theme','Тема терминала'),O.tr('Logs, tool cards, diffs','Логи, карточки инструментов, диффы')),
      h('div',{class:'grp'},O.tr('Landscape panels','Панели в альбомной ориентации')),
      O.toggleRow('list',O.tr('Sessions rail','Панель сессий'),O.tr('In progress / Idle groups','Группы «В работе» / «Простой»'),railState().left,v=>O.termRailSet({left:v})),
      O.toggleRow('branch',O.tr('Diff preview rail','Панель диффов'),O.tr('Right column with changes','Правая колонка с изменениями'),railState().right,v=>O.termRailSet({right:v})),
      h('div',{class:'grp'},O.tr('Preview','Предпросмотр')),
      (()=>{
        const box=h('div',{class:'term-preview'},
          h('div',{class:'tp-line'},h('span',{class:'tp-prompt'},'›'),h('span',{class:'mono'},'read app/src/main/MainActivity.kt')),
          h('div',{class:'tp-tool'},O.icon('check','ok'),h('span',{class:'mono grow'},'Read · 128 lines'),h('span',{class:'tp-ok'},'ok')),
          h('div',{class:'diff'},h('div',{class:'a'},'+ val mode = "term"'),h('div',{class:'d'},'- val mode = "chat"')));
        return box;
      })(),
      h('div',{class:'note'},O.tr('Terminal mode uses a monospaced font for paths, commands and code; regular text stays in the UI font.','В терминальном режиме пути, команды и код — моноширинным шрифтом; обычный текст остаётся гротеском.')));
  };
  draw();
  const s=O.sheet(O.tr('Interface & themes','Интерфейс и темы'),body,{full:true});
  const off=bus.on('themeLayer',()=>{if(s.root.isConnected)draw()});
  return s;
};

// apply on boot
setTimeout(()=>{try{document.documentElement.dataset.ui=O.uiMode();O.applyThemeLayers();O.termLayout&&O.termLayout()}catch(_){}},0);
addEventListener('resize',O.debounce(()=>{try{O.termLayout&&O.termLayout()}catch(_){}},120));
})();