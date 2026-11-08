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
O.openPreview=function(relPath){
  const target=relPath&&relPath!=='.'?(relPath.startsWith('/')?relPath:(S.dir+'/'+relPath)):(S.dir||'/root');
  let previewUrl='https://appassets.androidplatform.net/_preview/index.html';
  try{
    if(O.native&&O.native.preparePreview){
      const res=O.native.preparePreview(target);
      if(res)previewUrl=res;
    }
  }catch(e){console.error('preparePreview error:',e)}

  let isMobile=true;
  // Frame without restrictive sandbox attribute so local assets and scripts execute seamlessly
  const frame=h('iframe',{
    class:'web-preview-frame',
    src:previewUrl
  });

  // Direct srcdoc fallback for local HTML files
  if(target.endsWith('.html')||target.endsWith('.htm')){
    try{
      const r=O.native.readText(target);
      if(r&&r.ok&&r.text){
        // Frame will load via URL or srcdoc
        frame.addEventListener('error',()=>{frame.srcdoc=r.text});
      }
    }catch(_){}
  }

  const titleTxt=h('span',{class:'preview-title-text'},target?O.basename(target):'Web Preview');
  const pathInput=h('input',{
    class:'preview-addr-input',
    value:target||'index.html',
    title:O.tr('Path or URL (Press Enter)','Путь или URL (Нажмите Enter)'),
    onkeydown:e=>{
      if(e.key==='Enter'){
        const v=e.target.value.trim();
        if(v.startsWith('http://')||v.startsWith('https://')){
          frame.src=v;
        }else if(O.native&&O.native.preparePreview){
          const p=O.native.preparePreview(v);
          if(p)frame.src=p;
        }
      }
    }
  });

  const viewToggleBtn=h('button',{class:'ibtn s',title:O.tr('Switch Viewport (Mobile/Desktop)','Переключить масштаб (Мобильный/ПК)'),onclick:()=>{
    isMobile=!isMobile;
    frameWrap.classList.toggle('desktop-mode',!isMobile);
    viewToggleBtn.textContent='';
    viewToggleBtn.append(O.icon(isMobile?'phone':'laptop'));
    O.toast(isMobile?O.tr('Mobile View (390px)','Мобильный вид (390px)'):O.tr('Desktop View (100%)','Широкий вид (100%)'),1000);
  }},O.icon('phone'));
  const refreshBtn=h('button',{class:'ibtn s',title:O.tr('Reload','Обновить'),onclick:()=>{
    try{
      if(O.native&&O.native.preparePreview)O.native.preparePreview(target);
      frame.src=previewUrl+(previewUrl.includes('?')?'&':'?')+'_t='+Date.now();
      O.toast(O.tr('Reloaded','Обновлено'),800);
    }catch(e){}
  }},O.icon('refresh'));
  const externalBtn=h('button',{class:'ibtn s',title:O.tr('Open in External Browser','Открыть во внешнем браузере'),onclick:()=>{
    O.native.open(previewUrl);
  }},O.icon('ext'));

  const bar=h('div',{class:'web-preview-bar'},
    h('div',{class:'preview-bar-left'},O.icon('globe'),titleTxt,pathInput),
    h('div',{class:'preview-bar-right'},viewToggleBtn,refreshBtn,externalBtn));

  const frameWrap=h('div',{class:'web-preview-frame-wrap mobile-mode'},frame);
  const container=h('div',{class:'web-preview-container'},bar,frameWrap);
  if(O._activePreviewSheet&&O._activePreviewSheet.root&&O._activePreviewSheet.root.isConnected){
    try{O._activePreviewSheet.close()}catch(_){}
  }
  const s=O.sheet(O.tr('Project Web Preview','Предпросмотр проекта'),container,{full:true});
  O._activePreviewSheet=s;
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
    O.dispatchAction(d.action, d.target, d);
  }
});

})();
