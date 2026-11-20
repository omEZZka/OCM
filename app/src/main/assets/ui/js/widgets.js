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
// ---- snippets: reusable prompt templates with {variables} ----
const SNIP_DEFAULTS=[
  {id:'fix',name:'Исправить ошибку',text:'Исправь эту ошибку и объясни причину в одном абзаце:\n\n{error}'},
  {id:'tests',name:'Покрыть тестами',text:'Напиши тесты для {file}. Покрой краевые случаи, используй принятый в проекте фреймворк.'},
  {id:'review',name:'Код-ревью',text:'Сделай строгое ревью {file}: баги, безопасность, производительность. Формат: список проблем с серьёзностью.'},
  {id:'refactor',name:'Рефакторинг',text:'Отрефактори {file}: уменьши связанность, выдели функции, сохрани поведение. Покажи diff.'},
  {id:'explain',name:'Объяснить код',text:'Объясни, что делает {file}, по блокам. Уровень: junior-разработчик.'},
  {id:'commit',name:'Сообщение коммита',text:'Напиши commit message по текущим изменениям (conventional commits, одна строка + тело при необходимости).'},
  {id:'readme',name:'README',text:'Напиши README для проекта: описание, установка, использование, примеры. Кратко, без воды.'},
  {id:'optimize',name:'Оптимизировать',text:'Найди узкие места в {file} и предложи оптимизации с оценкой эффекта.'}
];
O.snippets=()=>{
  const custom=O.store.get('snippets',null);
  return Array.isArray(custom)?custom:SNIP_DEFAULTS;
};
O.openSnippets=()=>{
  const body=h('div');
  const s=O.sheet(O.tr('Prompt snippets','Сниппеты промптов'),body,{full:true});
  const q=h('input',{placeholder:O.tr('Search snippets…','Поиск сниппетов…'),oninput:()=>draw()});
  const list=h('div');
  const draw=()=>{
    list.textContent='';
    const f=String(q.value||'').toLowerCase();
    O.snippets().filter(x=>(x.name+' '+x.text).toLowerCase().includes(f)).forEach(sn=>{
      list.append(h('div',{class:'settings-row'},
        h('button',{class:'settings-row-text',onclick:async()=>{
          // fill {variables} one by one
          let text=sn.text;
          const vars=[...new Set((text.match(/\{(\w+)\}/g)||[]).map(x=>x.slice(1,-1)))];
          for(const v of vars){
            const val=await O.ask(O.tr('Variable: ','Переменная: ')+v,'');
            if(val==null)return;
            text=text.split('{'+v+'}').join(val);
          }
          s.close();O.insertText(text);O.setTab('chat');
        }},h('b',null,sn.name),h('span',{class:'media-clip'},sn.text.slice(0,90))),
        h('button',{class:'ibtn s',onclick:()=>O.actions(sn.name,[
          {label:O.tr('Edit','Изменить'),icon:'edit',fn:async()=>{
            const name=await O.ask(O.tr('Name','Название'),null,sn.name);if(!name)return;
            const text=await O.ask(O.tr('Template ({var} = variable)','Шаблон ({var} = переменная)'),null,sn.text,true);if(text==null)return;
            O.store.set('snippets',O.snippets().map(x=>x.id===sn.id?{id:sn.id,name,text}:x));draw();
          }},
          {label:O.tr('Delete','Удалить'),icon:'trash',danger:true,fn:()=>{O.store.set('snippets',O.snippets().filter(x=>x.id!==sn.id));draw()}}
        ])},O.icon('dots'))));
    });
  };
  body.append(q,list,h('button',{class:'btn pri wide',style:{marginTop:'10px'},onclick:async()=>{
    const name=await O.ask(O.tr('Snippet name','Название сниппета'),'');if(!name)return;
    const text=await O.ask(O.tr('Template ({var} = variable)','Шаблон ({var} = переменная'),'{file}',true);if(!text)return;
    O.store.set('snippets',O.snippets().concat([{id:'sn_'+Date.now().toString(36),name,text}]));draw();
  }},O.icon('plus'),O.tr('New snippet','Новый сниппет')));
  draw();
};

// ---- project health check ----
O.projectHealth=async()=>{
  const body=h('div');
  const s=O.sheet(O.tr('Project health','Здоровье проекта'),body,{full:true});
  const add=(icon,ok,title,sub,fn)=>body.append(h('div',{class:'settings-row'},
    h('div',{class:'settings-row-icon '+(ok?'green':'amber')},O.icon(icon)),
    h('div',{class:'settings-row-text'},h('b',null,title),h('span',null,sub)),
    fn?h('button',{class:'btn sm',onclick:fn},O.tr('Fix','Исправить')):(ok?O.icon('check','ok'):O.icon('alert','warn'))));
  body.append(h('div',{class:'note'},O.tr('Checking…','Проверяю…')));
  const results=[];
  // git status
  let dirty=0;
  try{const r=O.native.gitRun(S.dir,'status --porcelain');dirty=(r.out||'').trim()?r.out.trim().split('\n').length:0}catch(_){}
  results.push(['branch',dirty===0,O.tr('Uncommitted changes','Незакоммиченные изменения'),dirty?dirty+' '+O.tr('files','файлов'):O.tr('working tree clean','дерево чистое'),dirty?()=>O.setTab('changes'):null]);
  // secrets scan in loaded tree (cheap heuristic on names)
  let envFiles=0;
  try{const r=O.native.ls(S.dir);(r.items||[]).forEach(x=>{if(/^\.env($|\.)/.test(x.name))envFiles++})}catch(_){}
  results.push(['key',envFiles===0,'.env '+O.tr('files in root','файлы в корне'),envFiles?envFiles+' '+O.tr('found — check .gitignore','найдено — проверьте .gitignore'):O.tr('none','нет'),envFiles?()=>O.openEnvManager():null]);
  // gitignore
  let hasIgnore=false;
  try{const r=O.native.readText(S.dir+'/.gitignore');hasIgnore=!!(r&&r.ok)}catch(_){}
  results.push(['doc',hasIgnore,'.gitignore',hasIgnore?O.tr('present','есть'):O.tr('missing','отсутствует'),hasIgnore?null:async()=>{
    const r=O.native.writeText(S.dir+'/.gitignore','node_modules/\n.env\n.env.*\ndist/\nbuild/\n.cache/\n*.log\n__pycache__/\n.venv/\ntarget/\n');
    O.toast(r.ok?O.tr('.gitignore created','.gitignore создан'):O.tr('Failed','Не удалось'),2500);s.close();O.projectHealth();
  }]);
  // disk space
  const st=O.native.resourceStats?O.native.resourceStats():{};
  const freeGb=(st.diskFree||0)/1e9;
  results.push(['down',freeGb>2,O.tr('Free storage','Свободное место'),freeGb.toFixed(1)+' GB',null]);
  // server
  results.push(['server',!!st.serverReady,O.tr('Local server','Локальный сервер'),st.serverReady?O.tr('running','работает'):O.tr('stopped','остановлен'),st.serverReady?null:()=>{try{OC.restartServer()}catch(_){}}]);
  // big files in tree
  let big=0;
  try{const r=O.native.ls(S.dir);(r.items||[]).forEach(x=>{if(!x.dir&&(x.size||0)>50e6)big++})}catch(_){}
  results.push(['folder',big===0,O.tr('Files >50 MB in root','Файлы >50 МБ в корне'),big?big+' '+O.tr('found','найдено'):O.tr('none','нет'),null]);
  // model configured
  results.push(['cpu',!!S.model,O.tr('Model selected','Модель выбрана'),S.model?S.model.modelID:O.tr('none','нет'),S.model?null:()=>O.openModels()]);
  body.textContent='';
  const bad=results.filter(r=>!r[1]).length;
  body.append(h('div',{class:'note'},bad?O.tr(bad+' issues found','Найдено проблем: '+bad):O.tr('All checks passed','Все проверки пройдены')));
  results.forEach(r=>add(...r));
};

// ---- media gallery: favorites + search over history ----
O.mediaFavs=()=>O.store.get('mediaFavs',[]);
O.toggleMediaFav=path=>{
  const l=O.mediaFavs();const i=l.indexOf(path);
  if(i>=0)l.splice(i,1);else l.push(path);
  O.store.set('mediaFavs',l);
};
O.openMediaGallery=()=>{
  const body=h('div');
  const s=O.sheet(O.tr('Media gallery','Галерея медиа'),body,{full:true});
  const q=h('input',{placeholder:O.tr('Search by prompt or model…','Поиск по промпту или модели…'),oninput:()=>draw()});
  const seg=h('div',{class:'seg',style:{margin:'8px 0'}});
  let filter='all';
  [['all',O.tr('All','Все')],['fav',O.tr('Favorites','Избранное')],['image',O.tr('Photo','Фото')],['video',O.tr('Video','Видео')],['tts',O.tr('Voice','Голос')],['music',O.tr('Music','Музыка')]]
    .forEach(([k,l])=>seg.append(h('button',{class:k===filter?'on':'',onclick:e=>{filter=k;[...seg.children].forEach(b=>b.classList.remove('on'));e.currentTarget.classList.add('on');draw()}},l)));
  const grid=h('div',{class:'media-grid',style:{marginTop:'8px'}});
  const draw=()=>{
    grid.textContent='';
    const f=String(q.value||'').toLowerCase();
    const favs=O.mediaFavs();
    let items=O.mediaHistory();
    if(filter==='fav')items=items.filter(x=>favs.includes(x.path));
    else if(filter!=='all')items=items.filter(x=>x.kind===filter);
    if(f)items=items.filter(x=>((x.prompt||'')+' '+(x.model||'')).toLowerCase().includes(f));
    if(!items.length){grid.append(h('div',{class:'note'},O.tr('Nothing here yet','Пока пусто')));return}
    items.slice(0,120).forEach(it=>{
      const fav=favs.includes(it.path);
      const thumb=it.kind==='image'
        ?h('img',{src:O.mediaUrl(it.path),loading:'lazy'})
        :h('div',{class:'media-thumb-icon'},O.icon(it.kind==='video'?'film':it.kind==='music'?'note':'wave'));
      grid.append(h('div',{class:'media-cell',style:{position:'relative'},onclick:()=>O.mediaPreview(it),oncontextmenu:e=>{e.preventDefault();O.mediaItemActions(it)}},
        thumb,
        h('button',{class:'media-fav-btn'+(fav?' on':''),onclick:e=>{e.stopPropagation();O.toggleMediaFav(it.path);draw()}},O.icon('star')),
        h('span',{class:'media-cell-tag'},it.kind)));
    });
  };
  body.append(q,seg,grid);
  draw();
};

// ---- explain file: one tap from the viewer ----
O.explainFile=path=>{
  const name=O.basename(path);
  O.insertText(O.tr('Explain what this file does, block by block, for a junior developer: ','Объясни, что делает этот файл, по блокам, для junior-разработчика: ')+'@'+O.rel(path));
  O.setTab('chat');
  O.toast(O.tr('Prompt prepared — send it','Запрос готов — отправьте'),2000);
};

// ---- agent action audit: what the agent actually did ----
O.openAgentAudit=()=>{
  const body=h('div');
  const s=O.sheet(O.tr('Agent audit','Аудит действий агента'),body,{full:true});
  const q=h('input',{placeholder:O.tr('Filter by tool or file…','Фильтр по инструменту или файлу…'),oninput:()=>draw()});
  const list=h('div');
  const draw=()=>{
    list.textContent='';
    const f=String(q.value||'').toLowerCase();
    const rows=[];
    for(const m of O.visibleMsgs(S.sid)){
      if(m.info.role!=='assistant')continue;
      for(const p of m.parts){
        if(p.type!=='tool')continue;
        const st=p.state||{},i=st.input||{};
        const target=i.filePath||i.path||i.command||i.url||'';
        const line=(p.tool||'')+' '+target;
        if(f&&!line.toLowerCase().includes(f))continue;
        rows.push({at:(st.time&&st.time.start)||m.info.time.created,tool:p.tool,target,status:st.status||'?',mid:m.info.id});
      }
    }
    rows.reverse();
    if(!rows.length){list.append(h('div',{class:'note'},O.tr('No tool calls in this session','В этой сессии нет вызовов инструментов')));return}
    list.append(h('div',{class:'mut s',style:{margin:'4px 2px'}},rows.length+' '+O.tr('actions','действий')));
    rows.slice(0,300).forEach(r=>{
      const ic=r.tool==='bash'?'terminal':r.tool==='edit'||r.tool==='write'?'edit':r.tool==='read'?'doc':'zap';
      list.append(h('div',{class:'settings-row'},
        h('div',{class:'settings-row-icon'},O.icon(ic)),
        h('div',{class:'settings-row-text'},h('b',null,r.tool),h('span',{class:'media-clip'},String(r.target).slice(0,120))),
        h('span',{class:'mut s'},new Date(r.at).toTimeString().slice(0,8)),
        r.status==='error'?O.icon('alert','err'):O.icon('check','ok')));
    });
  };
  body.append(q,list);
  draw();
};

// ---- .env manager: masked values, never sent to the model ----
O.openEnvManager=()=>{
  const path=S.dir+'/.env';
  const body=h('div');
  const s=O.sheet('.env — '+O.basename(S.dir),body,{full:true});
  let entries=[];
  const load=()=>{
    entries=[];
    try{
      const r=O.native.readText(path);
      if(r&&r.ok&&r.text){
        r.text.split('\n').forEach(line=>{
          const t=line.trim();
          if(!t||t.startsWith('#'))return;
          const i=t.indexOf('=');
          if(i>0)entries.push({key:t.slice(0,i).trim(),val:t.slice(i+1).trim()});
        });
      }
    }catch(_){}
  };
  const save=()=>{
    const text=entries.map(e=>e.key+'='+e.val).join('\n')+'\n';
    const r=O.native.writeText(path,text);
    O.toast(r.ok?O.tr('.env saved','.env сохранён'):(r.err||'error'),2500);
  };
  const draw=()=>{
    body.textContent='';
    body.append(h('div',{class:'note'},O.tr('Values are masked and never inserted into prompts. The agent can read the file only if you explicitly ask.','Значения замаскированы и не вставляются в промпты. Агент прочитает файл только по вашей явной просьбе.')));
    entries.forEach((e,i)=>{
      let shown=false;
      const valEl=h('span',{class:'mono'},'••••••••');
      body.append(h('div',{class:'settings-row'},
        h('div',{class:'settings-row-text'},h('b',{class:'mono'},e.key),valEl),
        h('button',{class:'ibtn s',onclick:()=>{shown=!shown;valEl.textContent=shown?e.val:'••••••••'}},O.icon('eye')),
        h('button',{class:'ibtn s',onclick:async()=>{
          const v=await O.ask(e.key,null,e.val);
          if(v!=null){e.val=v;save();draw()}
        }},O.icon('edit')),
        h('button',{class:'ibtn s',onclick:()=>{entries.splice(i,1);save();draw()}},O.icon('trash'))));
    });
    body.append(h('button',{class:'btn pri wide',style:{marginTop:'10px'},onclick:async()=>{
      const k=await O.ask(O.tr('Variable name','Имя переменной'),'API_KEY');if(!k)return;
      const v=await O.ask(k,'');if(v==null)return;
      entries.push({key:k.trim(),val:v});save();draw();
    }},O.icon('plus'),O.tr('Add variable','Добавить переменную')));
    body.append(h('div',{class:'note',style:{marginTop:'10px'}},O.tr('Tip: add .env to .gitignore (Project health can create it).','Совет: добавьте .env в .gitignore («Здоровье проекта» может создать его).')));
  };
  load();draw();
};

// ---- dry-run mode: agent proposes commands without executing ----
O.dryRun=()=>O.store.get('dryRun',false);
O.setDryRun=v=>{O.store.set('dryRun',!!v);bus.emit('meta')};

// ---- crash report (local, opt-in share) ----
window.addEventListener('error',e=>{
  try{
    const l=O.store.get('crashLog',[]);
    l.unshift({at:Date.now(),msg:String(e.message||'').slice(0,300),src:String(e.filename||'').slice(-60)+':'+e.lineno});
    O.store.set('crashLog',l.slice(0,20));
  }catch(_){}
});
window.addEventListener('unhandledrejection',e=>{
  try{
    const l=O.store.get('crashLog',[]);
    l.unshift({at:Date.now(),msg:String(e.reason&&e.reason.message||e.reason||'').slice(0,300),src:'promise'});
    O.store.set('crashLog',l.slice(0,20));
  }catch(_){}
});
O.openCrashLog=()=>{
  const l=O.store.get('crashLog',[]);
  const body=h('div');
  if(!l.length)body.append(h('div',{class:'note'},O.tr('No errors recorded','Ошибок не записано')));
  l.forEach(c=>body.append(h('div',{class:'settings-row'},
    h('div',{class:'settings-row-icon amber'},O.icon('bug')),
    h('div',{class:'settings-row-text'},h('b',null,c.msg),h('span',null,c.src+' · '+O.ago(c.at))))));
  if(l.length)body.append(h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:()=>{
    O.native.share('OpenCode Mobile crash report\n'+l.map(c=>new Date(c.at).toISOString()+' '+c.src+' '+c.msg).join('\n'));
  }},O.icon('share'),O.tr('Share report','Поделиться отчётом')));
  O.sheet(O.tr('Error log (local)','Журнал ошибок (локально)'),body,{full:true});
};

// ---- app lock: biometric gate on launch and after background timeout ----
O.appLock=()=>O.store.get('appLock',false);
O.lockMinutes=()=>O.store.get('lockMinutes',5);
let lockOverlay=null,hiddenAt=0;
function showLock(){
  if(lockOverlay)return;
  lockOverlay=h('div',{class:'app-lock'},
    h('div',{class:'app-lock-box'},
      O.logo?O.logo(40):O.icon('shield'),
      h('b',null,'OpenCode Mobile'),
      h('p',{class:'mut'},O.tr('Locked','Заблокировано')),
      h('button',{class:'btn pri wide',onclick:unlock},O.icon('shield'),O.tr('Unlock','Разблокировать'))));
  document.body.append(lockOverlay);
  unlock();
}
let unlockOff=null;
function unlock(){
  // FIX (audit J15): every tap added a NEW appUnlock listener that never unsubscribed on
  // mismatched ids — N failed attempts left N listeners and N parallel biometric prompts.
  if(unlockOff){try{unlockOff()}catch(_){}unlockOff=null}
  const id='u'+Date.now();
  const off=O.on('appUnlock',d=>{
    if(!d||d.id!==id)return;
    if(d.ok){off();unlockOff=null;if(lockOverlay){lockOverlay.remove();lockOverlay=null}}
    else if(!d.retry){off();unlockOff=null;O.toast(d.err||O.tr('Unlock failed','Не удалось разблокировать'),3000)}
  });
  unlockOff=off;
  O.native.biometricUnlock(id,'OpenCode Mobile');
}
O.initAppLock=()=>{
  if(O.appLock()&&O.native.biometricAvailable())showLock();
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){hiddenAt=Date.now();return}
    if(!O.appLock()||!hiddenAt)return;
    const mins=(Date.now()-hiddenAt)/60000;
    hiddenAt=0;
    if(mins>=O.lockMinutes())showLock();
  });
};
O.openAppLockSettings=()=>{
  const avail=O.native.biometricAvailable();
  const body=h('div',null,
    h('div',{class:'note'},avail?O.tr('Uses fingerprint/face or device PIN.','Используется отпечаток/лицо или PIN устройства.'):O.tr('Biometrics unavailable on this device','Биометрия недоступна на этом устройстве')),
    O.toggleRow('shield',O.tr('Lock the app','Блокировать приложение'),O.tr('Require unlock on launch and after background','Требовать разблокировку при запуске и после фона'),
      O.appLock(),v=>{
        if(v&&!avail)return O.toast(O.tr('Set up a screen lock in Android first','Сначала настройте блокировку экрана в Android'),3000);
        O.store.set('appLock',v);
      }),
    h('div',{class:'grp'},O.tr('Lock after background','Блокировать после фона')),
    h('div',{class:'seg'},[0,1,5,15,60].map(m=>h('button',{class:O.lockMinutes()===m?'on':'',onclick:e=>{
      O.store.set('lockMinutes',m);
      [...e.currentTarget.parentNode.children].forEach(b=>b.classList.remove('on'));
      e.currentTarget.classList.add('on');
    }},m===0?O.tr('immediately','сразу'):m+' '+O.tr('min','мин')))));
  O.sheet(O.tr('App lock','Блокировка приложения'),body,{hud:true});
};

// ---- git timeline + blame ----
O.openGitTimeline=()=>{
  const body=h('div');
  const s=O.sheet(O.tr('Git timeline','История Git'),body,{full:true});
  body.append(h('div',{class:'note'},O.tr('Loading…','Загрузка…')));
  setTimeout(()=>{
    const r=O.native.gitRun(S.dir,'log --pretty=format:%h%x09%an%x09%ad%x09%s --date=short -60');
    body.textContent='';
    if(!r||!r.ok||!(r.out||'').trim()){body.append(h('div',{class:'note'},O.tr('No commits or not a git repo','Нет коммитов или это не git-репозиторий')));return}
    r.out.trim().split('\n').forEach(line=>{
      const [sha,author,date,...subj]=line.split('\t');
      body.append(h('button',{class:'settings-row',onclick:()=>{
        const d=O.native.gitRun(S.dir,'show --stat --patch '+sha);
        const db=h('div');
        db.append(O.unifiedEl?O.unifiedEl((d.out||'').slice(0,60000)):h('pre',{class:'term-pre'},(d.out||'').slice(0,60000)));
        O.sheet(sha+' · '+subj.join(' '),db,{full:true});
      }},
        h('div',{class:'settings-row-icon'},O.icon('branch')),
        h('div',{class:'settings-row-text'},h('b',null,subj.join(' ')),h('span',null,sha+' · '+author+' · '+date))));
    });
  },30);
};
O.gitBlame=path=>{
  const rel=O.rel(path);
  const r=O.native.gitRun(S.dir,'blame --line-porcelain '+JSON.stringify(rel));
  const body=h('div');
  if(!r||!r.ok){body.append(h('div',{class:'errbox'},(r&&(r.err||r.out))||'blame failed'))}
  else{
    // compact: line no, author, summary
    const lines=(r.out||'').split('\n');
    let cur={};let n=0;
    const pre=[];
    lines.forEach(l=>{
      if(/^[0-9a-f]{40} /.test(l)){n++;cur={sha:l.slice(0,8)}}
      else if(l.startsWith('author '))cur.author=l.slice(7);
      else if(l.startsWith('summary '))cur.summary=l.slice(8);
      else if(l.startsWith('\t'))pre.push(String(n).padStart(4)+'  '+(cur.author||'').slice(0,14).padEnd(14)+'  '+l.slice(1));
    });
    body.append(h('pre',{class:'term-pre',style:{whiteSpace:'pre',fontSize:'11.5px'}},pre.join('\n')));
  }
  O.sheet(O.tr('Blame: ','Blame: ')+O.basename(path),body,{full:true});
};

// ---- terminal favorites ----
O.termFavs=()=>O.store.get('termFavs',['git status','ls -la','npm test','python3 --version']);
O.openTermFavs=()=>{
  const body=h('div');
  const s=O.sheet(O.tr('Favorite commands','Избранные команды'),body,{hud:true});
  const draw=()=>{
    body.textContent='';
    O.termFavs().forEach((c,i)=>body.append(h('div',{class:'settings-row'},
      h('button',{class:'settings-row-text',onclick:()=>{s.close();O.setTab('term');setTimeout(()=>O.termRun&&O.termRun(c),250)}},
        h('b',{class:'mono'},c)),
      h('button',{class:'ibtn s',onclick:()=>{O.store.set('termFavs',O.termFavs().filter((_,j)=>j!==i));draw()}},O.icon('trash')))));
    body.append(h('button',{class:'btn pri wide',style:{marginTop:'10px'},onclick:async()=>{
      const c=await O.ask(O.tr('Command','Команда'),'');
      if(c&&c.trim()){O.store.set('termFavs',O.termFavs().concat([c.trim()]));draw()}
    }},O.icon('plus'),O.tr('Add command','Добавить команду')));
  };
  draw();
};

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
  const smartBtn=h('button',{class:'btn sm wide',style:{marginBottom:'10px'}},O.icon('bulb'),O.tr('Smart search (AI, by meaning)','Умный поиск (ИИ, по смыслу)'));
  const out=h('div');
  const s=O.sheet(O.tr('Global search','Глобальный поиск'),h('div',null,q,smartBtn,out),{full:true});
  let t=null;
  const row=(icon,title,sub,fn)=>h('button',{class:'settings-row',onclick:()=>{s.close();fn()}},
    O.icon(icon),h('div',{class:'settings-row-text'},h('b',null,title),sub?h('span',null,sub):null));
  // 002: natural-language search across sessions — the model reads a digest and picks by meaning
  smartBtn.onclick=async()=>{
    const query=String(q.value||'').trim();
    if(query.length<3)return O.toast(O.tr('Type what you are looking for','Напишите, что ищете'),1800);
    if(!O.smartSearch)return O.toast('smart search unavailable',2000);
    smartBtn.disabled=true;out.textContent='';
    out.append(h('div',{class:'note'},h('span',{class:'spin'}),' ',O.tr('AI is reading your chats…','ИИ читает ваши чаты…')));
    try{
      const hits=await O.smartSearch(query);
      if(!s.root.isConnected)return;
      out.textContent='';
      if(!hits.length){out.append(h('div',{class:'note'},O.tr('Nothing matches by meaning','По смыслу ничего не нашлось')));return}
      out.append(h('div',{class:'grp'},O.tr('Found by meaning','Найдено по смыслу')));
      hits.forEach(r=>{
        const ses2=(O.S.sessions||[]).find(x=>x.id===r.sid);
        out.append(row('bulb',ses2?O.sessionTitle(ses2):r.sid.slice(0,10),r.why||'',async()=>{
          await O.openSession(r.sid);
          setTimeout(()=>O.jumpToMsg&&O.jumpToMsg(r.mid),400);
        }));
      });
    }catch(e){out.textContent='';out.append(h('div',{class:'note'},e.message||String(e)))}
    finally{smartBtn.disabled=false}
  };
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
      if (d.session) {
        // Cold start from a notification: the server may still be booting. Wait for it (up to
        // ~15s) instead of opening into a stale/offline view.
        (async()=>{
          for(let i=0;i<15&&!S.up;i++)await new Promise(r=>setTimeout(r,1000));
          try{await O.openSession(d.session)}catch(_){}
          try{O.chat.focus()}catch(_){}
        })();
      } else setTimeout(()=>{try{O.chat.focus()}catch(_){}},150);
      return;
    }
    if (d.action === 'status') { O.setTab('chat'); return; }
    if (d.action === 'media') { if (O.openMedia) O.openMedia(); return; }
    if (d.action === 'mm_reply') {
      // Inline notification answer to an MM role question.
      try{
        const qid=OC.mmReplyQid&&OC.mmReplyQid();
        const text=OC.mmReplyText&&OC.mmReplyText();
        if(qid&&O.mmPendingAsks&&O.mmPendingAsks[qid]){O.mmPendingAsks[qid](text||'');delete O.mmPendingAsks[qid]}
      }catch(_){}
      return;
    }
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
