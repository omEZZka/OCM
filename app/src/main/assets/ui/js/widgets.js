(function(){
const O=window.OCM,h=O.h,S=O.S,bus=O.bus;

// Universal Action Dispatcher
O.dispatchAction=async function(act,target,data){
  if(!act)return;
  const a=String(act).toLowerCase().trim();
  const t=target||(data&&data.target)||'';
  switch(a){
    case'new_chat':
      try{
        const r=await O.api('POST','/session',{});
        if(O.loadSessions)await O.loadSessions();
        if(O.openSession)O.openSession(r.id);
        O.setTab('chat');
        O.toast(O.tr('New chat created','Создан новый чат'),1500);
      }catch(e){O.toast(e.message)}
      break;
    case'open_app':
      if(t){
        const ok=O.native.openApp(t);
        if(!ok)O.toast(O.tr('Opening '+t+'...','Открытие '+t+'...'),1500);
      }else{
        O.openAppChooser();
      }
      break;
    case'open_files':
    case'files':
      O.setTab('files');
      break;
    case'open_term':
    case'term':
      O.setTab('term');
      break;
    case'preview':
    case'web_preview':
      O.openPreview(t);
      break;
    case'restart_server':
      if(window.OC&&OC.restartServer){
        OC.restartServer();
        O.toast(O.tr('Restarting server...','Перезапуск сервера...'),2000);
      }
      break;
    case'clear_cache':
      try{
        if(O.kv&&O.kv.clear)await O.kv.clear();
        O.toast(O.tr('Cache cleared successfully','Кэш успешно очищен'),1500);
      }catch(e){O.toast(e.message)}
      break;
    case'sound_done':
      if(window.OC&&OC.testSound)OC.testSound('done');
      break;
    case'sound_action':
      if(window.OC&&OC.testSound)OC.testSound('action');
      break;
    case'sound_quota':
      if(window.OC&&OC.testSound)OC.testSound('quota');
      break;
    case'focus_composer':
      O.setTab('chat');
      setTimeout(()=>{
        const ta=document.querySelector('#composer textarea');
        if(ta){ta.focus();if(t){ta.value=t;ta.dispatchEvent(new Event('input'))}}
      },100);
      break;
    case'open_settings':
      O.openSettings();
      break;
    case'prompt':
      if(t&&O.insertPrompt)O.insertPrompt(t);
      else if(t){
        const ta=document.querySelector('#composer textarea');
        if(ta){ta.value=t;ta.focus();ta.dispatchEvent(new Event('input'))}
        O.setTab('chat');
      }
      break;
    case'toast':
      O.toast(t||O.tr('Action executed','Действие выполнено'),2000);
      break;
    default:
      console.log('Unknown action:',a,t);
  }
};

// Modal for choosing an app to open
O.openAppChooser=async function(){
  const apps=[
    {name:'Telegram',id:'telegram',icon:'tg'},
    {name:'ВКонтакте',id:'vk',icon:'chat'},
    {name:'YouTube',id:'youtube',icon:'play'},
    {name:'Chrome Browser',id:'chrome',icon:'globe'},
    {name:'GitHub',id:'github',icon:'code'},
    {name:'Настройки',id:'settings',icon:'sliders'},
    {name:'Камера',id:'camera',icon:'image'},
    {name:'Проводник / Файлы',id:'files',icon:'folder'},
    {name:'Калькулятор',id:'calculator',icon:'cpu'}
  ];
  const list=h('div',{class:'app-chooser-list'});
  apps.forEach(a=>{
    list.append(h('button',{
      class:'dock-opt-row',
      style:{width:'100%',margin:'4px 0'},
      onclick:()=>{s.close();O.native.openApp(a.id)}
    },
    h('div',{class:'settings-row-icon blue'},O.icon(a.icon)),
    h('div',{class:'dock-opt-content'},
      h('span',{class:'dock-opt-label'},a.name),
      h('span',{class:'dock-opt-desc'},'openapp '+a.id))));
  });
  const customInp=h('input',{class:'dock-custom-inp',placeholder:O.tr('Or type app name / package...','Или введите название / пакет...'),style:{marginTop:'10px'}});
  const openCustomBtn=h('button',{class:'btn wide pri',style:{marginTop:'8px'},onclick:()=>{
    const val=customInp.value.trim();
    if(val){s.close();O.native.openApp(val)}
  }},O.tr('Open Application','Открыть приложение'));
  const box=h('div',null,list,customInp,openCustomBtn);
  const s=O.sheet(O.tr('Open Android App','Запуск приложения Android'),box);
};

// In-App Web Project Preview (HTML + CSS + JS + Images)
// The preview runs in its own sandboxed WebView (PreviewActivity): a separate origin AND no native
// bridge. An iframe inside the app is not enough because addJavascriptInterface injects into every
// frame, so a cloned project could have read files and stored keys.
O.openPreview=function(relPath){
  const target=relPath&&relPath!=='.'?(relPath.startsWith('/')?relPath:(S.dir+'/'+relPath)):(S.dir||'/root');
  let previewUrl='';
  try{
    if(O.native&&O.native.preparePreview)previewUrl=O.native.preparePreview(target)||'';
  }catch(e){console.error('preparePreview error:',e)}
  if(!previewUrl){
    O.toast(O.tr('Could not prepare the preview','Не удалось подготовить предпросмотр'),3000);
    return;
  }
  const ok=O.native&&O.native.openPreviewWindow&&O.native.openPreviewWindow(previewUrl,O.basename(target)||'Preview');
  if(!ok)O.toast(O.tr('Preview is not available','Предпросмотр недоступен'),3000);
};

// 3 Built-in Developer Widgets (Adaptive & Native HUD Style)
O.getBuiltinWidgets=function(){
  // Widget 1: Runtime & Model Monitor
  const usage=O.contextUsage?O.contextUsage(S.sid):null;
  const curModel=S.model?((S.model.providerID||'')+'/'+(S.model.modelID||'')):O.tr('Not selected','Не выбрана');
  const isBusy=S.status&&S.status[S.sid]&&S.status[S.sid].type!=='idle';

  const monitorBody=h('div',{class:'ocm-widget-body ocm-adaptive-widget'},
    h('div',{class:'hud-metric-row'},
      h('div',{class:'hud-metric',style:{gridColumn:'span 2'}},
        h('div',{class:'hud-metric-lbl'},O.tr('Active Model','Текущая модель')),
        h('b',{class:'hud-metric-val',style:{fontSize:'12px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',display:'block'}},curModel)),
      h('div',{class:'hud-metric'},
        h('div',{class:'hud-metric-lbl'},O.tr('Tokens','Контекст')),
        h('b',{class:'hud-metric-val',style:{color:'#a78bfa'}},usage&&usage.tot?O.fmtK(usage.tot):'0 tok'))),
    h('div',{class:'widget-actions-grid'},
      h('button',{class:'btn-widget-action',onclick:()=>O.dispatchAction('new_chat')},O.icon('plus'),O.tr('New Session','Новый чат')),
      h('button',{class:'btn-widget-action',onclick:()=>O.openModels()},O.icon('cpu'),O.tr('Model','Сменить')),
      h('button',{class:'btn-widget-action',onclick:()=>O.dispatchAction('restart_server')},O.icon('refresh'),O.tr('Restart','Рестарт'))));

  // Widget 2: Workspace & Git Hub
  const projName=S.dir?O.basename(S.dir):'Workspace';
  const branch=S.branch||'main';
  const diffCount=(S.diffs&&S.diffs[S.sid]||[]).length;

  const workspaceBody=h('div',{class:'ocm-widget-body ocm-adaptive-widget'},
    h('div',{class:'hud-metric-row'},
      h('div',{class:'hud-metric',style:{gridColumn:'span 2'}},
        h('div',{class:'hud-metric-lbl'},O.tr('Project / Directory','Проект')),
        h('b',{class:'hud-metric-val',style:{fontSize:'13px',color:'#f4f4f5'}},projName)),
      h('div',{class:'hud-metric'},
        h('div',{class:'hud-metric-lbl'},'Git'),
        h('b',{class:'hud-metric-val',style:{color:'#22c55e',fontSize:'12px'}},' '+branch))),
    h('div',{class:'widget-actions-grid'},
      h('button',{class:'btn-widget-action',onclick:()=>O.dispatchAction('open_files')},O.icon('folder'),O.tr('Files','Файлы')),
      h('button',{class:'btn-widget-action',onclick:()=>O.dispatchAction('open_term')},O.icon('terminal'),O.tr('Terminal','Терминал')),
      h('button',{class:'btn-widget-action',onclick:()=>O.dispatchAction('preview')},O.icon('globe'),O.tr('Preview','Превью'))));

  // Widget 3: Quick Developer Snippets
  const snips=[
    [O.icon('bug'),'Баги','Найди потенциальные баги, ошибки типов и утечки памяти в текущем проекте.'],
    [O.icon('zap'),'Рефактор','Проведи рефакторинг кода: оптимизируй архитектуру и удали дублирование.'],
    [O.icon('flask'),'Тесты','Напиши подробные автоматические тесты с проверкой граничных условий.'],
    [O.icon('doc'),'Доки','Создай или обнови техническую документацию в README.md.']
  ];
  const snipBody=h('div',{class:'ocm-widget-body ocm-adaptive-widget'},
    h('div',{style:{display:'grid',gridTemplateColumns:'repeat(2, 1fr)',gap:'8px'}},
      snips.map(([icon,label,text])=>h('button',{
        class:'btn-widget-action',
        style:{padding:'10px 8px',textAlign:'left',justifyContent:'flex-start'},
        onclick:()=>O.dispatchAction('prompt',text)
      },icon,h('span',{style:{fontSize:'13px',fontWeight:'600'}},label)))));

  // Widget 4: Active Session
  const ses=S.sid&&S.sessions.find(x=>x.id===S.sid);
  const sessionBody=h('div',{class:'ocm-widget-body ocm-adaptive-widget'},
    h('div',{class:'hud-metric-row'},
      h('div',{class:'hud-metric',style:{gridColumn:'span 2'}},
        h('div',{class:'hud-metric-lbl'},O.tr('Session','Сессия')),
        h('b',{class:'hud-metric-val',style:{fontSize:'13px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',display:'block'}},ses?O.sessionTitle(ses):O.tr('No session','Нет сессии'))),
      h('div',{class:'hud-metric'},
        h('div',{class:'hud-metric-lbl'},O.tr('Model','Модель')),
        h('b',{class:'hud-metric-val',style:{color:'#38bdf8',fontSize:'12px'}},S.model?S.model.providerID+'/'+S.model.modelID:O.tr('None','—'))),
      h('div',{class:'hud-metric'},
        h('div',{class:'hud-metric-lbl'},O.tr('Agent','Агент')),
        h('b',{class:'hud-metric-val',style:{color:'#fbbf24',fontSize:'12px'}},S.agent||'build')),
      h('div',{class:'hud-metric'},
        h('div',{class:'hud-metric-lbl'},O.tr('Status','Статус')),
        h('b',{class:'hud-metric-val',style:{color:isBusy?'#f87171':'#22c55e',fontSize:'12px'}},isBusy?O.tr('Busy','Работает'):O.tr('Idle','Свободен')))),
    h('div',{class:'widget-actions-grid'},
      h('button',{class:'btn-widget-action',onclick:()=>O.openSessions()},O.icon('list'),O.tr('Sessions','Сессии')),
      h('button',{class:'btn-widget-action',onclick:()=>O.openModels()},O.icon('cpu'),O.tr('Model','Модель')),
      h('button',{class:'btn-widget-action',onclick:()=>O.openAgents()},O.icon('bot'),O.tr('Agent','Агент'))));

  // Widget 5: Token Monitor
  const tok=O.calcSessionTokens?O.calcSessionTokens(S.sid):{total:0,input:0,output:0,cost:0};
  const pct=tok.pct!=null?tok.pct+'%':'—';
  const tokenBody=h('div',{class:'ocm-widget-body ocm-adaptive-widget'},
    h('div',{class:'hud-metric-row'},
      h('div',{class:'hud-metric'},
        h('div',{class:'hud-metric-lbl'},O.tr('Total','Всего')),
        h('b',{class:'hud-metric-val',style:{color:'#a78bfa'}},O.fmtK(tok.total))),
      h('div',{class:'hud-metric'},
        h('div',{class:'hud-metric-lbl'},O.tr('Input','Вход')),
        h('b',{class:'hud-metric-val',style:{color:'#38bdf8'}},O.fmtK(tok.input))),
      h('div',{class:'hud-metric'},
        h('div',{class:'hud-metric-lbl'},O.tr('Output','Выход')),
        h('b',{class:'hud-metric-val',style:{color:'#22c55e'}},O.fmtK(tok.output))),
      h('div',{class:'hud-metric'},
        h('div',{class:'hud-metric-lbl'},O.tr('Cost','Стоимость')),
        h('b',{class:'hud-metric-val',style:{color:'#fbbf24'}},tok.cost>0?'$'+tok.cost.toFixed(4):'—'))),
    h('div',{class:'widget-actions-grid'},
      h('button',{class:'btn-widget-action',onclick:()=>O.openTokensModal()},O.icon('cpu'),O.tr('Details','Подробнее')),
      h('button',{class:'btn-widget-action',onclick:()=>O.openModels()},O.icon('cpu'),O.tr('Model','Модель')),
      h('button',{class:'btn-widget-action',onclick:()=>O.openSettings()},O.icon('sliders'),O.tr('Settings','Настройки'))));

  return [
    {id:'core_monitor',title:O.tr('Core & Model Monitor','Монитор рантайма и модели'),icon:'cpu',body:monitorBody},
    {id:'workspace_git',title:O.tr('Workspace & Git','Рабочее пространство & Git'),icon:'branch',body:workspaceBody},
    {id:'prompt_scratchpad',title:O.tr('Developer Snippets','Быстрые сниппеты разработки'),icon:'terminal',body:snipBody},
    {id:'active_session',title:O.tr('Active Session','Активная сессия'),icon:'chat',body:sessionBody},
    {id:'token_monitor',title:O.tr('Token Monitor','Монитор токенов'),icon:'cpu',body:tokenBody}
  ];
};

// Modal exhibiting all widgets with visual preview
O.openWidgetsModal=function(){
  const wrap=h('div',{class:'widgets-modal-wrap'});
  const widgets=O.getBuiltinWidgets();

  widgets.forEach(w=>{
    const previewContainer=h('div',{class:'widget-preview-box',style:{margin:'6px 0',borderRadius:'10px',border:'1px dashed rgba(255,255,255,0.15)',padding:'8px',background:'rgba(0,0,0,0.2)'}},
      h('div',{style:{fontSize:'11px',color:'#71717a',marginBottom:'6px',display:'flex',alignItems:'center',gap:'4px'}},
        O.icon('eye'),h('span',null,O.tr('Preview','Превью виджета'))),
      w.body.cloneNode(true));

    O.initCustomWidgets(previewContainer);

    const card=h('div',{class:'hud-dock-card widget-card'},
      h('div',{class:'hud-dock-header'},
        h('div',{class:'hud-dock-header-left'},
          h('div',{class:'badge-icon'},O.icon(w.icon)),
          h('b',null,w.title))),
      previewContainer);
    wrap.append(card);
  });

  const customSection=h('div',{style:{marginTop:'16px',textAlign:'center'}},
    h('button',{class:'btn wide',onclick:()=>{s.close();O.openCustomWidgetCreator()}},O.icon('plus'),O.tr('Create Custom Widget from HTML','Создать свой виджет из HTML')));
  wrap.append(customSection);
  const s=O.sheet(O.tr('HUD Interactive Widgets','Интерактивные виджеты HUD'),wrap,{full:false});
};

// Custom widget creator dialog
O.openCustomWidgetCreator=function(){
  const ta=h('textarea',{class:'editor',style:{height:'160px'},placeholder:'<div class="ocm-widget" data-title="Мой кастомный виджет">\n  <p>Привет из OpenCode!</p>\n  <button data-action="new_chat">Новый чат</button>\n  <button data-action="open_app" data-target="telegram">Открыть Telegram</button>\n</div>'});
  ta.value=`<div class="ocm-widget" data-title="Мой Инструмент">\n  <p style="color:#a1a1aa;margin-bottom:10px;">Быстрые действия на телефоне:</p>\n  <div style="display:flex;gap:8px;flex-wrap:wrap;">\n    <button class="btn sm pri" data-action="new_chat">Новый чат</button>\n    <button class="btn sm" data-action="open_app" data-target="telegram">Telegram</button>\n    <button class="btn sm" data-action="preview">Предпросмотр</button>\n  </div>\n</div>`;
  const previewBox=h('div',{class:'custom-widget-preview-area',style:{marginTop:'12px'}});
  const renderPrev=()=>{
    previewBox.innerHTML=ta.value;
    O.initCustomWidgets(previewBox);
  };
  ta.addEventListener('input',renderPrev);
  const saveBtn=h('button',{class:'btn pri wide',style:{marginTop:'12px'},onclick:async()=>{
    const code=ta.value.trim();
    if(!code)return;
    const path='/root/.config/opencode/widgets/widget_'+Date.now()+'.html';
    const r=O.native.writeText(path,code);
    if(r.ok){
      O.toast(O.tr('Widget saved to '+path,'Виджет сохранён в '+path),2000);
      s.close();
    }else{O.toast(r.err||'Ошибка сохранения')}
  }},O.tr('Save Widget','Сохранить виджет'));

  const box=h('div',null,h('p',{class:'mut s',style:{marginBottom:'8px'}},'Вставьте HTML с кнопками `data-action="..."` (например `new_chat`, `open_app`, `preview`, `run_cmd`):'),ta,h('b',{style:{display:'block',marginTop:'10px'}},'Предпросмотр:'),previewBox,saveBtn);
  renderPrev();
  const s=O.sheet(O.tr('Custom Widget Creator','Конструктор виджетов'),box,{full:true});
};

// Scan and bind events in custom widgets (in chat messages or dialogs)
O.initCustomWidgets=function(root){
  if(!root)return;
  const elements=root.querySelectorAll('[data-action]');
  elements.forEach(btn=>{
    if(btn._bound||btn.dataset.bound)return;
    btn._bound=true;
    btn.dataset.bound='1';
    btn.addEventListener('click',e=>{
      e.preventDefault();
      e.stopPropagation();
      const act=btn.getAttribute('data-action');
      const target=btn.getAttribute('data-target')||btn.getAttribute('data-path')||btn.getAttribute('data-cmd')||'';
      O.dispatchAction(act,target,{target});
    });
  });
};

// Listen to native preview events (e.g. from openpreview CLI script or bridge)
// ---- (59) resource monitor ----
O.openResources=()=>{
  const body=h('div');
  const s=O.sheet(O.tr('Resources','Ресурсы'),body,{full:true});
  const fmtB=n=>{n=Number(n)||0;if(n>1e9)return(n/1e9).toFixed(1)+' GB';if(n>1e6)return(n/1e6).toFixed(0)+' MB';return Math.round(n/1e3)+' KB'};
  const bar=(pct,color)=>h('div',{style:{height:'6px',borderRadius:'3px',background:'var(--bg3)',overflow:'hidden',marginTop:'6px'}},
    h('div',{style:{height:'100%',width:Math.max(2,Math.min(100,pct))+'%',background:color||'var(--acc)'}}));
  let timer=null;
  const draw=()=>{
    if(!s.root.isConnected){clearInterval(timer);return}
    const st=O.native.resourceStats?O.native.resourceStats():{};
    body.textContent='';
    if(st.err){body.append(h('div',{class:'errbox'},st.err));return}
    const ramPct=st.ramTotal?Math.round((st.ramTotal-st.ramAvail)*100/st.ramTotal):0;
    const jvmPct=st.jvmMax?Math.round(st.jvmUsed*100/st.jvmMax):0;
    const diskPct=st.diskTotal?Math.round((st.diskTotal-st.diskFree)*100/st.diskTotal):0;
    const row=(icon,title,val,pct,color)=>h('div',{class:'settings-row',style:{display:'block'}},
      h('div',{style:{display:'flex',alignItems:'center',gap:'8px'}},O.icon(icon),h('b',{class:'grow'},title),h('span',{class:'mut s'},val)),
      pct!=null?bar(pct,color):null);
    body.append(row('cpu',O.tr('CPU','Процессор'),(st.cpuPct!=null?st.cpuPct+'%':'…'),st.cpuPct,st.cpuPct>80?'#ef4444':null));
    body.append(row('memory',O.tr('Device RAM','ОЗУ устройства'),fmtB(st.ramTotal-st.ramAvail)+' / '+fmtB(st.ramTotal),ramPct,ramPct>85?'#ef4444':null));
    body.append(row('zap',O.tr('App memory (JVM)','Память приложения (JVM)'),fmtB(st.jvmUsed)+' / '+fmtB(st.jvmMax),jvmPct));
    body.append(row('zap',O.tr('App total (PSS)','Приложение всего (PSS)'),fmtB((st.appPssKb||0)*1024),null));
    body.append(row('down',O.tr('Storage','Хранилище'),fmtB(st.diskTotal-st.diskFree)+' / '+fmtB(st.diskTotal),diskPct,diskPct>90?'#ef4444':null));
    body.append(row('folder','Linux rootfs',fmtB(st.rootfsBytes),null));
    body.append(row('user',O.tr('Profiles & chats','Профили и чаты'),fmtB(st.profileBytes),null));
    body.append(h('div',{class:'note',style:{marginTop:'10px'}},
      (st.serverReady?O.tr('Server: running','Сервер: работает'):O.tr('Server: stopped','Сервер: остановлен'))+' · '+O.tr('updates every 3 s','обновление каждые 3 с')));
    if(st.ramLow)body.append(h('div',{class:'errbox',style:{marginTop:'8px'}},O.tr('Android reports low memory — close other apps','Android сообщает о нехватке памяти — закройте другие приложения')));
  };
  draw();timer=setInterval(draw,3000);
};

// ---- (62) global search: chats, messages, files, commands, models, actions ----
O.openGlobalSearch=()=>{
  const q=h('input',{placeholder:O.tr('Search everything…','Искать везде…'),style:{marginBottom:'10px'}});
  const out=h('div');
  const s=O.sheet(O.tr('Global search','Глобальный поиск'),h('div',null,q,out),{full:true});
  let t=null;
  const row=(icon,title,sub,fn)=>h('button',{class:'settings-row',onclick:()=>{s.close();fn()}},
    O.icon(icon),h('div',{class:'settings-row-text'},h('b',null,title),sub?h('span',null,sub):null));
  const run=async()=>{
    const needle=String(q.value||'').trim().toLowerCase();
    out.textContent='';
    if(needle.length<2)return;
    const grp=label=>out.append(h('div',{class:'grp'},label));
    // actions / commands
    const cmds=(O.builtins||[]).filter(c=>('/'+c.n+' '+(c.d||'')).toLowerCase().includes(needle));
    if(cmds.length){grp(O.tr('Commands','Команды'));cmds.slice(0,5).forEach(c=>out.append(row(c.i||'slash','/'+c.n,c.d,()=>c.run())))}
    // sessions
    const ses=(O.S.sessions||[]).filter(x=>O.sessionTitle(x).toLowerCase().includes(needle));
    if(ses.length){grp(O.tr('Sessions','Сессии'));ses.slice(0,6).forEach(x=>out.append(row('chat',O.sessionTitle(x),O.ago(x.time&&x.time.updated),()=>O.openSession(x.id))))}
    // models
    const models=O.allModels().filter(x=>(x.name+' '+x.mid+' '+x.pid).toLowerCase().includes(needle));
    if(models.length){grp(O.tr('Models','Модели'));models.slice(0,5).forEach(x=>out.append(row('cpu',x.name||x.mid,x.pid,()=>{O.setModel(x.pid,x.mid);O.toast(x.name||x.mid,1200)})))}
    // files (server-side find)
    try{
      const files=await O.api('GET','/find/file?query='+encodeURIComponent(needle)+'&limit=8');
      if(Array.isArray(files)&&files.length){grp(O.tr('Files','Файлы'));files.slice(0,8).forEach(f=>{
        const dir=f.endsWith('/');
        out.append(row(O.fileIcon?'file':'folder',O.basename(f),f,()=>{if(!dir)O.openFile(f);else O.setTab('files')}));
      })}
    }catch(_){}
    // message contents (async IndexedDB scan)
    if(O.searchMessages){
      const hits=await O.searchMessages(needle);
      if(!s.root.isConnected)return;
      if(hits.length){grp(O.tr('In messages','В сообщениях'));hits.slice(0,8).forEach(r=>{
        const ses2=(O.S.sessions||[]).find(x=>x.id===r.sid);
        out.append(row('search',ses2?O.sessionTitle(ses2):r.sid.slice(0,8),'…'+r.text.replace(/\s+/g,' ').slice(0,120)+'…',async()=>{
          await O.openSession(r.sid);
          setTimeout(()=>{const el=[...document.querySelectorAll('#msgs .msg')].find(e=>e.dataset.id===r.mid);if(el)el.scrollIntoView({block:'center'})},400);
        }));
      })}
    }
    if(!out.children.length)out.append(h('div',{class:'note'},O.tr('Nothing found','Ничего не найдено')));
  };
  q.addEventListener('input',()=>{clearTimeout(t);t=setTimeout(run,250)});
  setTimeout(()=>q.focus(),150);
};

// ---- (61) interactive onboarding tour ----
O.openTour=()=>{
  const steps=[
    ['chat',O.tr('Chat with the agent','Чат с агентом'),O.tr('Type a task — the agent edits files, runs commands and shows diffs. @ mentions a file, ! runs a shell command, / opens commands.','Напишите задачу — агент правит файлы, выполняет команды и показывает diff. @ упоминает файл, ! запускает команду, / открывает меню команд.')],
    ['folder',O.tr('Projects & files','Проекты и файлы'),O.tr('Each workspace keeps its folder, model and agent. Swipe left from chat to open files; long-press a file for actions.','У каждого проекта своя папка, модель и агент. Свайп влево из чата открывает файлы; долгое нажатие — действия.')],
    ['image',O.tr('Media chats','Медиа-чаты'),O.tr('Photo, Video, Voice and Music are separate conversations. Add a provider, pick a model, type a prompt — results appear as messages.','Фото, Видео, Голос и Музыка — отдельные переписки. Добавьте провайдера, выберите модель, введите запрос — результаты появятся сообщениями.')],
    ['wave',O.tr('Voice','Голос'),O.tr('Tap the mic for dictation or a live call. In a call, say "open files", "new chat", "read changes" — or set a wake phrase in call settings.','Микрофон — диктовка или живой звонок. В звонке говорите «открой файлы», «новый чат», «прочитай изменения» — или задайте кодовую фразу.')],
    ['list',O.tr('Plans & queue','Планы и очередь'),O.tr('Enable step-by-step plans in Settings. While the agent works, new messages go to a queue and send automatically when it finishes.','Включите пошаговые планы в настройках. Пока агент работает, новые сообщения встают в очередь и отправятся сами.')],
    ['search',O.tr('Find anything','Найти что угодно'),O.tr('Global search covers sessions, message text, files, models and commands. Open it from the drawer or /search.','Глобальный поиск ищет по сессиям, текстам сообщений, файлам, моделям и командам. Открывается из меню или /search.')],
    ['shield',O.tr('You are in control','Вы управляете'),O.tr('Checkpoints snapshot the project before every prompt. Settings → System has encrypted backups, updates and diagnostics.','Чекпоинты сохраняют проект перед каждым запросом. Настройки → Система: шифрованные бэкапы, обновления, диагностика.')]
  ];
  let i=0;
  const body=h('div',{style:{textAlign:'center',padding:'8px 4px'}});
  const s=O.sheet(O.tr('Welcome to OpenCode Mobile','Добро пожаловать в OpenCode Mobile'),body,{hud:true,onClose:()=>O.store.set('tourSeen',true)});
  const draw=()=>{
    body.textContent='';
    const [icon,title,text]=steps[i];
    body.append(h('div',{style:{display:'flex',justifyContent:'center',margin:'6px 0 10px'}},O.icon(icon)),
      h('b',{style:{fontSize:'17px',display:'block',marginBottom:'8px'}},title),
      h('p',{class:'mut',style:{fontSize:'13.5px',lineHeight:'1.55',margin:'0 0 14px'}},text),
      h('div',{style:{display:'flex',justifyContent:'center',gap:'6px',marginBottom:'14px'}},
        steps.map((_,k)=>h('i',{style:{width:'7px',height:'7px',borderRadius:'50%',background:k===i?'var(--acc)':'var(--bg3)',display:'inline-block'}}))),
      h('div',{style:{display:'flex',gap:'8px'}},
        h('button',{class:'btn grow',onclick:()=>{O.store.set('tourSeen',true);s.close()}},O.tr('Skip','Пропустить')),
        h('button',{class:'btn pri grow',onclick:()=>{if(i<steps.length-1){i++;draw()}else{O.store.set('tourSeen',true);s.close()}}},
          i<steps.length-1?O.tr('Next','Далее'):O.tr('Start','Начать'))));
  };
  draw();
};

// ---- (63) customizable home tiles ----
const TILE_DEFS=[
  ['chat','chat',()=>O.tr('Chat','Чат'),()=>{O.setTab('chat')}],
  ['files','folder',()=>O.tr('Files','Файлы'),()=>O.setTab('files')],
  ['term','terminal',()=>O.tr('Terminal','Терминал'),()=>O.setTab('term')],
  ['changes','branch',()=>O.tr('Changes','Изменения'),()=>O.setTab('changes')],
  ['photo','image',()=>O.tr('Photo','Фото'),()=>O.openMedia('image')],
  ['video','film',()=>O.tr('Video','Видео'),()=>O.openMedia('video')],
  ['voice','wave',()=>O.tr('Voice','Голос'),()=>O.openMedia('tts')],
  ['music','note',()=>O.tr('Music','Музыка'),()=>O.openMedia('music')],
  ['projects','folder',()=>O.tr('Projects','Проекты'),()=>O.openProjects()],
  ['search','search',()=>O.tr('Search','Поиск'),()=>O.openGlobalSearch()],
  ['plan','list',()=>O.tr('Plan','План'),()=>O.openPlan()],
  ['call','mic',()=>O.tr('Call','Звонок'),()=>O.onMicChoice()],
  ['resources','cpu',()=>O.tr('Resources','Ресурсы'),()=>O.openResources()],
  ['settings','sliders',()=>O.tr('Settings','Настройки'),()=>O.openSettings()]
];
O.homeTiles=()=>O.store.get('homeTiles',['chat','files','photo','search','projects','term']);
O.openHomeTiles=()=>{
  const body=h('div');
  const s=O.sheet(O.tr('Home tiles','Плитки главного экрана'),body,{hud:true});
  const draw=()=>{
    body.textContent='';
    body.append(h('div',{class:'note'},O.tr('Pick up to 8 tiles for the home screen shown on an empty chat. Order = tap order below.','Выберите до 8 плиток для главного экрана (показывается в пустом чате). Порядок — по нажатию.')));
    const cur=O.homeTiles();
    TILE_DEFS.forEach(([id,icon,label])=>{
      const on=cur.includes(id);
      body.append(O.toggleRow(icon,label(),'',on,v=>{
        let l=O.homeTiles();
        if(v){if(l.length>=8){O.toast(O.tr('Maximum 8 tiles','Максимум 8 плиток'),2000);draw();return}l.push(id)}
        else l=l.filter(x=>x!==id);
        O.store.set('homeTiles',l);bus.emit('homeTiles');draw();
      }));
    });
  };
  draw();
};
O.buildHomeTiles=container=>{
  const wrap=h('div',{class:'home-tiles'});
  const draw=()=>{
    wrap.textContent='';
    O.homeTiles().forEach(id=>{
      const def=TILE_DEFS.find(x=>x[0]===id);
      if(!def)return;
      wrap.append(h('button',{class:'home-tile',onclick:def[3]},O.icon(def[1]),h('span',null,def[2]())));
    });
  };
  draw();
  const off=bus.on('homeTiles',()=>{if(wrap.isConnected)draw();else off()});
  container.append(wrap);
};

O.on('preview', d => {
  if (d && d.path) O.openPreview(d.path);
  else O.openPreview();
});

// Listen to native widget actions (e.g. from Android Home Screen widgets)
O.on('widget_action', d => {
  if (d && d.action) {
    if (d.action === 'open_chat') {
      O.setTab('chat');
      if (d.session) { try { O.openSession(d.session) } catch (_) {} }
      setTimeout(()=>{try{O.chat.focus()}catch(_){}},150);
      return;
    }
    if (d.action === 'status') { O.setTab('chat'); return; }
    if (d.action === 'media') { if (O.openMedia) O.openMedia(); return; }
    if (d.action === 'abort_all') {
      (async()=>{
        const ids=Object.keys(S.status).filter(k=>S.status[k]&&S.status[k].type!=='idle');
        if(S.sid&&(!S.status[S.sid]||S.status[S.sid].type==='idle'))ids.push(S.sid);
        for(const id of [...new Set(ids)]){try{await O.api('POST','/session/'+id+'/abort',{})}catch(_){}}
        if(O.mm.run)O.mmStop();
        O.toast(O.tr('Stopped','Остановлено'),1500);
      })();
      return;
    }
    O.dispatchAction(d.action, d.target, d);
  }
});

})();
