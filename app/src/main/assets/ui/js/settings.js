(function(){
const O=window.OCM,h=O.h,S=O.S,api=O.api,bus=O.bus;
const CFG='/root/.config/opencode';
const cfg={read(){const t=O.native.cfgRead();if(!t.trim())return{obj:{},raw:''};try{return{obj:O.parseJsonc(t),raw:t}}catch(e){return{obj:null,raw:t,err:e.message}}},
  write(o){return O.native.cfgWrite(typeof o==='string'?o:JSON.stringify(o,null,2))}};
const restartBar=()=>h('button',{class:'btn wide',style:{marginTop:'12px'},onclick:()=>{OC.restartServer();O.toast('Перезапуск сервера...');O.back()}},O.icon('refresh'),'Перезапустить сервер для применения');
const sub=(t,b,o)=>O.sheet(t,b,Object.assign({full:true},o));

// "picked" (native file picker) is a global event, but every screen that reacts to it used to add
// one more permanent listener: reopening Settings → Plugins N times meant N redraws of dead sheets.
const pickWatchers=[];
O.on('picked',d=>{
  for(let i=pickWatchers.length-1;i>=0;i--){
    const w=pickWatchers[i];
    if(!w.sheet||!w.sheet.root.isConnected){pickWatchers.splice(i,1);continue}
    try{w.fn(d)}catch(_){}
  }
});
const watchPicked=(sheet,fn)=>pickWatchers.push({sheet,fn});

// ---- main ----
// ---- main ----
O.openSettings=()=>{
  const st=O.native.state(),fl=st.flags||{};
  const body=h('div');
  const s=O.sheet(O.tr('Settings','Настройки'),body,{hud:true});
  
  // 1. Profile & Account
  body.append(h('div',{class:'settings-section-title'},O.tr('Profile & Account','Профиль и аккаунт')));
  const profCard=h('div',{class:'settings-card'});
  const profRow=h('div',{class:'settings-row'},
    h('div',{class:'settings-row-icon purple'},O.icon('user')),
    h('div',{class:'settings-row-text'},
      h('b',null,st.name||'Гость'),
      h('span',null,st.guest?('Гостевой профиль · ник создан случайно'):(st.user?('Профиль: '+st.user):'Профиль не выбран')),
      st.guest&&st.pw?h('div',{class:'mut s',style:{display:'flex',alignItems:'center',gap:'6px',marginTop:'4px'}},
        h('span',{class:'mono'},'Пароль: '+st.pw),
        h('button',{class:'ibtn s',onclick:()=>O.native.copy(st.pw)},O.icon('copy'))):null),
    h('button',{class:'btn sm',onclick:async()=>{if(await O.confirm(O.tr('Change profile?','Сменить профиль?'),O.tr('Chats and local files will be preserved.','Чаты и файлы останутся на телефоне и будут доступны при повторном входе.'),O.tr('Change','Сменить')))OC.signOut()}},O.icon('out'),O.tr('Change','Сменить')));
  
  const accRow=O.listRow('cloud',O.tr('OpenCode Zen Account','Аккаунт opencode'),'проверяем...',O.icon('chevR'),()=>O.openAccount());
  const accSub=()=>{const sp=accRow.querySelector('.settings-row-text span');if(!sp)return;
    sp.textContent=S.account&&S.account.email?(O.tr('Logged in: ','Вход выполнен: ')+S.account.email):(S.account&&S.account.checked?O.tr('Not logged in (shared quota)','Не выполнен — квота общая'):'проверяем...')};
  accSub();O.checkAccount().then(accSub);
  profCard.append(profRow,accRow);
  body.append(profCard);

  // 2. Models & Providers
  body.append(h('div',{class:'settings-section-title'},O.tr('Models & Providers','Модели и провайдеры')));
  const modelsCard=h('div',{class:'settings-card'});
  modelsCard.append(
    O.listRow('cpu',O.tr('Active Model','Текущая модель'),S.model?S.model.providerID+'/'+S.model.modelID:O.tr('Not selected','Не выбрана'),O.icon('chevR'),()=>O.openModels()),
    O.listRow('key',O.tr('Connect Providers','Подключить провайдеров'),'OpenCode Zen, OpenAI, Anthropic, Gemini, DeepSeek...',O.icon('chevR'),()=>O.openConnect()),
    O.listRow('search',O.tr('Custom API Provider','Свой API провайдер'),'OpenAI-compatible, Groq, OpenRouter...',O.icon('chevR'),()=>O.openCustomProvider(s)),
    O.listRow('refresh',O.tr('Fallback models','Резервные модели'),O.fallbackModels().length?O.fallbackModels().join(', '):O.tr('Used automatically when the main model fails','Автопереключение при ошибке основной модели'),O.icon('chevR'),()=>openFallback()),
    O.listRow('bot',O.tr('Multimodality','Мультимодальность'),O.tr('Team agents: lead model + role models','Командные агенты: главная модель + модели ролей'),O.icon('chevR'),()=>O.openMultimodal()),
    O.listRow('cloud',O.tr('Remote Builds','Удалённая сборка'),O.tr('GitHub, GitLab, Bitbucket, CircleCI, Azure, Codemagic, Bitrise, GCB','Удалённая сборка APK по токену'),O.icon('chevR'),()=>O.openRemoteBuilds())
  );
  body.append(modelsCard);

  // 3. Appearance & Interface
  body.append(h('div',{class:'settings-section-title'},O.tr('Appearance & Interface','Оформление и интерфейс')));
  const appCard=h('div',{class:'settings-card'});
  const curLang=O.store.get('lang','ru');
  const langRow=O.listRow('globe',O.tr('Language / Язык','Язык / Language'),curLang==='en'?'English':'Русский',O.icon('chevR'),()=>{
    const nxt=curLang==='en'?'ru':'en';
    O.store.set('lang',nxt);
    O.toast(nxt==='en'?'Language changed to English':'Язык переключён на Русский',1500);
    s.close();
    setTimeout(()=>location.reload(),400);
  });
  const themeName={opencode:'OpenCode (Dark)',light:'Light',tokyonight:'Tokyo Night',gruvbox:'Gruvbox'}[S.opts.theme]||S.opts.theme;
  const themeRow=O.listRow('palette',O.tr('Theme & Font Size','Тема и размер текста'),themeName+', '+S.opts.fs+'px',O.icon('chevR'),()=>O.openThemes());
  const thinkRow=O.toggleRow('bulb',O.tr('Show Reasoning / Thinking','Показывать размышления'),O.tr('Display model thought process in responses','Блоки размышлений в ответах'),S.opts.thinking,v=>{S.opts.thinking=v;O.saveOpts();O.chat.renderAll()});
  const ov=O.native.overlayState?O.native.overlayState():{};
  const overlayRow=O.toggleRow('ghost',O.tr('Floating status bubble','Плавающий индикатор'),
    O.tr('Bubble over other apps: agent status and one-tap stop','Пузырь поверх других приложений: статус и стоп в один тап'),
    !!ov.running,v=>{
      if(v){O.native.startOverlay&&O.native.startOverlay()}
      else{O.native.stopOverlay&&O.native.stopOverlay()}
    });
  const legendDot=(color,label)=>h('span',{style:{display:'inline-flex',alignItems:'center',gap:'5px',marginRight:'10px',fontSize:'11.5px',color:'var(--mut)'}},
    h('i',{style:{width:'8px',height:'8px',borderRadius:'50%',background:color,display:'inline-block'}}),label);
  const overlayLegend=h('div',{class:'note',style:{margin:'2px 2px 8px',lineHeight:'1.9'}},
    h('div',{style:{marginBottom:'2px'}},O.tr('Bubble colours:','Цвета пузыря:')),
    h('div',null,
      legendDot('#71717a',O.tr('idle','простой')),
      legendDot('#fab283',O.tr('working','работает')),
      legendDot('#f59e0b',O.tr('waiting for you','ждёт ответа')),
      legendDot('#ef4444',O.tr('error','ошибка'))),
    h('div',{style:{marginTop:'4px',fontSize:'11px'}},O.tr('Small dots under the icon are the multimodal roles: green done, accent running, grey queued.','Точки под иконкой — роли мультимодального агента: зелёная готова, акцентная работает, серая в очереди.')));
  const onlyBusyRow=O.toggleRow('zap',O.tr('Only while working','Только во время работы'),
    O.tr('Hide the bubble a few seconds after the agent goes idle','Скрывать пузырь через пару секунд после завершения'),
    O.store.get('overlayOnlyBusy',false),v=>{
      O.store.set('overlayOnlyBusy',v);
      // the service reads this flag from Prefs through the bridge
      try{if(window.OC&&OC.setFlag)OC.setFlag('overlay_only_busy',v)}catch(_){}
    });
  const detailRow=O.toggleRow('code',O.tr('Expand Tool Details','Детали инструментов'),O.tr('Show commands, output and file diffs','Команды, вывод терминала и правки'),S.opts.details,v=>{S.opts.details=v;O.saveOpts();O.chat.renderAll()});
  appCard.append(langRow,themeRow,thinkRow,detailRow,overlayRow,overlayLegend,onlyBusyRow);
  body.append(appCard);

  // 4. Notifications & Sounds
  body.append(h('div',{class:'settings-section-title'},O.tr('Notifications & Sounds','Звуки и уведомления')));
  const sndCard=h('div',{class:'settings-card'});
  [['snd_done',O.tr('Task Completed','Задача завершена'),O.tr('Sound when agent finishes task','Агент закончил работу'),'done'],
   ['snd_action',O.tr('Action Required','Требуется действие'),O.tr('Sound on questions and permissions','Ожидается разрешение или вопрос'),'action'],
   ['snd_quota',O.tr('Quota Limit Reached','Квота исчерпана'),O.tr('Sound when model rate limit hit','Превышен лимит запросов'),'quota']].forEach(([k,t,d,kind])=>{
    sndCard.append(h('div',{style:{display:'flex',alignItems:'center'}},
      h('div',{class:'grow'},O.toggleRow('bell',t,d,fl[k]!==false,v=>OC.setFlag(k,v))),
      h('button',{class:'ibtn',style:{marginRight:'12px'},onclick:()=>OC.testSound(kind)},O.icon('play'))));
  });
  body.append(sndCard);

  // 5. Agents, MCP & Plugins
  body.append(h('div',{class:'settings-section-title'},O.tr('Agents, MCP & Rules','Агенты, MCP и правила')));
  const agentCard=h('div',{class:'settings-card'});
  agentCard.append(
    O.listRow('doc',O.tr('Agents & Rules','Агенты и правила'),O.tr('Upload or edit AGENTS.md, agents & commands','Загрузите AGENTS.md, агентов и команды'),O.icon('chevR'),()=>openAgents()),
    O.listRow('server',O.tr('MCP Servers','Серверы MCP'),O.tr('Configure tools and integrations','Добавить, изменить, подключить'),O.icon('chevR'),()=>O.openMcp()),
    O.listRow('plug',O.tr('Plugins','Плагины'),O.tr('npm packages and local scripts','npm-пакеты и локальные файлы'),O.icon('chevR'),()=>O.openPlugins()),
    O.listRow('code',O.tr('Configuration File','Файл конфигурации'),'opencode.json',O.icon('chevR'),()=>openConfig())
  );
  body.append(agentCard);

  // 6. Jailbreaks & Custom Plugins
  body.append(h('div',{class:'settings-section-title'},O.tr('Jailbreaks & Plugins','Джейлбрейки и плагины')));
  const jbCard=h('div',{class:'settings-card'});
  jbCard.append(
    O.listRow('shield',O.tr('Custom Jailbreaks','Пользовательские джейлбрейки'),O.tr('Presets for Zen models, upload & toggle','Пресеты для моделей Zen, загрузка и отключение'),O.icon('chevR'),()=>openJailbreaks()),
    O.listRow('plug',O.tr('Custom Plugins','Пользовательские плагины'),O.tr('Marketplace, upload custom plugins','Каталог и загрузка пользовательских плагинов'),O.icon('chevR'),()=>openCustomPlugins()),
    O.toggleRow('zap','OpenCode Warp (обход лимитов)','https://github.com/warpdotdev/opencode-warp — тестовая функция, по умолчанию выключена',O.store.get('warp_enabled',false),v=>{O.store.set('warp_enabled',v);O.toast(v?'Warp включён (тестовый режим)':'Warp выключен',1500)})
  );
  body.append(jbCard);

  // 7. Application & System
  body.append(h('div',{class:'settings-section-title'},O.tr('System & Application','Система и приложение')));
  const sysCard=h('div',{class:'settings-card'});
  sysCard.append(
    O.listRow('shield',O.tr('Encrypted backup','Шифрованный бэкап'),O.tr('Profile, config and sessions to /sdcard/Download','Профиль, конфиг и сессии в /sdcard/Download'),O.icon('chevR'),()=>openBackup()),
    O.listRow('down',O.tr('Updates','Обновления'),O.tr('OpenCode Mobile & Core Runtime','Приложение и ядро OpenCode (1.x)'),O.icon('chevR'),()=>openUpdates()),
    O.listRow('code',O.tr('Export / Import settings','Экспорт / импорт настроек'),O.tr('Models, agents, themes, fallbacks as JSON','Модели, агенты, темы, резервные модели в JSON'),O.icon('chevR'),()=>openSettingsTransfer()),
    O.listRow('shield',O.tr('Permissions','Разрешения'),O.tr('Storage, notifications, background execution','Файлы, уведомления, фон'),O.icon('chevR'),()=>openPerms()),
    O.listRow('bat',O.tr('Logs & Diagnostics','Совместимость и логи'),O.tr('Safe mode, core runtime restart','Безопасный режим, перезапуск сервера'),O.icon('chevR'),()=>openCompat()),
    O.listRow('info',O.tr('About OpenCode Mobile','О приложении'),'',O.icon('chevR'),()=>openAbout()),
    O.listRow('tg',O.tr('Community & Telegram','Сообщество Telegram'),'t.me/OpenCodeMob',O.icon('chevR'),()=>O.openUrl('https://t.me/OpenCodeMob'))
  );
  body.append(sysCard);
};

// ---- fallback model chain ----
function openFallback(){
  const body=h('div');
  const draw=()=>{
    body.textContent='';
    const list=O.fallbackModels();
    const last=O.lastFallback&&O.lastFallback();
    body.append(h('div',{class:'mut',style:{padding:'4px 2px 10px'}},O.tr('If the main model hits a limit or errors, the app retries these models in order (up to 5).','Если основная модель упрётся в лимит или ошибку, приложение по очереди попробует эти модели (до 5).')));
    if(last&&last.model)body.append(h('div',{class:'note',style:{marginBottom:'10px'}},O.tr('Last answered by fallback: ','Последний раз ответила резервная модель: ')+last.model+' · '+O.ago(last.at)));
    if(!list.length)body.append(h('div',{class:'mut',style:{padding:'12px'}},O.tr('No fallback models yet.','Резервных моделей пока нет.')));
    list.forEach((k,i)=>{
      const p=k.split('/');const info=O.modelInfo(p[0],p.slice(1).join('/'));
      const move=(d)=>{const l=O.fallbackModels();const j=i+d;if(j<0||j>=l.length)return;const t=l[i];l[i]=l[j];l[j]=t;O.setFallbackModels(l);draw()};
      const test=async()=>{
        const mdl={providerID:p[0],modelID:p.slice(1).join('/')};
        O.toast(O.tr('Testing model...','Проверяю модель...'),1500);
        try{
          const sid=await O.chat.sess();
          await api('POST','/session/'+sid+'/prompt_async',{messageID:O.mid(),agent:S.agent,model:mdl,parts:[{type:'text',text:'ping'}]},{timeout:30000});
          O.toast(O.tr('Model responded: ','Модель ответила: ')+k,2500);
        }catch(e){O.toast(O.tr('Model failed: ','Модель не ответила: ')+e.message,4000)}
      };
      body.append(h('div',{class:'settings-row'},
        h('div',{class:'settings-row-icon purple'},O.icon('cpu')),
        h('div',{class:'settings-row-text'},h('b',null,(info&&info.name)||k),h('span',null,'#'+(i+1)+' · '+k)),
        h('button',{class:'ibtn s',disabled:i===0,onclick:()=>move(-1)},O.icon('chevD')),
        h('button',{class:'ibtn s',disabled:i===list.length-1,onclick:()=>move(1)},O.icon('chevR')),
        h('button',{class:'ibtn s',title:O.tr('Test','Проверить'),onclick:test},O.icon('play')),
        h('button',{class:'ibtn s',onclick:()=>{const l=O.fallbackModels();l.splice(i,1);O.setFallbackModels(l);draw()}},O.icon('trash'))));
    });
    body.append(h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:()=>{
      if(O.fallbackModels().length>=5)return O.toast(O.tr('Limit: 5 models','Лимит: 5 моделей'),2000);
      O.mmPickModel(null,m=>{O.setFallbackModels(O.fallbackModels().concat([m.providerID+'/'+m.modelID]));draw()},{freeOnly:false});
    }},O.icon('plus'),O.tr('Add model','Добавить модель')));
    if(last)body.append(h('button',{class:'btn wide',style:{marginTop:'8px'},onclick:()=>{O.setLastFallback(null);draw()}},O.icon('x'),O.tr('Clear last-fallback note','Сбросить отметку о резервной модели')));
  };
  draw();
  sub(O.tr('Fallback models','Резервные модели'),body,{full:true});
}

// ---- encrypted profile backup ----
function openBackup(){
  const info=h('div',{class:'mut s',style:{marginTop:'10px',wordBreak:'break-all'}},'');
  const pw1=h('input',{type:'password',class:'mono',placeholder:O.tr('Password for encryption','Пароль для шифрования')});
  const pw2=h('input',{type:'password',class:'mono',placeholder:O.tr('Repeat password','Повторите пароль')});
  const existing=h('div');
  const drawExisting=()=>{
    existing.textContent='';
    let items=[];try{const r=O.native.ls('/sdcard/Download');items=(r.items||[]).filter(x=>!x.dir&&/\.ocmbak$/i.test(x.name))}catch(_){}
    if(!items.length)return;
    existing.append(h('div',{class:'grp'},O.tr('Existing backups','Существующие бэкапы')));
    items.sort((a,b)=>(b.size||0)-(a.size||0)).slice(0,8).forEach(x=>{
      const full='/sdcard/Download/'+x.name;
      existing.append(h('div',{class:'settings-row'},
        h('div',{class:'settings-row-icon purple'},O.icon('shield')),
        h('div',{class:'settings-row-text'},h('b',null,x.name),h('span',null,Math.round((x.size||0)/1024)+' KB')),
        h('button',{class:'ibtn s',title:O.tr('Restore','Восстановить'),onclick:async()=>{
          const pw=await O.ask(O.tr('Backup password','Пароль бэкапа'),O.tr('Enter the password used when the backup was created','Введите пароль, заданный при создании бэкапа'));
          if(!pw)return;
          try{
            const r=JSON.parse(OC.restoreProfile(pw,full));
            if(r.ok){O.toast(O.tr('Profile restored. Restarting server...','Профиль восстановлен. Перезапускаю сервер...'),3000);OC.restartServer()}
            else O.toast(r.err||'failed',4000);
          }catch(e){O.toast(e.message,4000)}
        }},O.icon('down'))));
    });
  };
  drawExisting();
  const body=h('div',null,
    h('div',{class:'field'},h('label',null,O.tr('New backup','Новый бэкап')),pw1,pw2),
    h('button',{class:'btn pri wide',onclick:()=>{
      if(!pw1.value||pw1.value.length<6)return O.toast(O.tr('Password must be at least 6 characters','Пароль минимум 6 символов'),3000);
      if(pw1.value!==pw2.value)return O.toast(O.tr('Passwords do not match','Пароли не совпадают'),3000);
      try{
        const r=JSON.parse(OC.backupProfile(pw1.value));
        if(r.ok){info.textContent=O.tr('Saved: ','Сохранено: ')+r.path+' ('+Math.round((r.size||0)/1024)+' KB)';O.native.copy(r.path);O.toast(O.tr('Backup created','Бэкап создан'),2500);drawExisting()}
        else O.toast(r.err||'failed',4000);
      }catch(e){O.toast(e.message,4000)}
    }},O.icon('shield'),O.tr('Create encrypted backup','Создать шифрованный бэкап')),
    existing,
    h('div',{style:{height:'18px'}}),
    h('div',{class:'note'},O.tr('The archive contains config, agents, commands, skills, plugins and session data. It does not include the Linux rootfs.','Архив содержит конфиг, агентов, команды, навыки, плагины и данные сессий. Linux rootfs не включается.')),
    h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:()=>OC.pickFile('backup','')},O.icon('up'),O.tr('Restore from file...','Восстановить из файла...')),
    h('div',{class:'grp',style:{marginTop:'18px'}},O.tr('Scheduled backup','Автобэкап по расписанию')),
    (()=>{
      const st=O.native.autoBackupState?O.native.autoBackupState():{};
      const hoursInp=h('input',{type:'number',min:'6',max:'168',class:'mono',value:String(st.intervalHours||24),style:{width:'80px'}});
      const pwInp=h('input',{type:'password',class:'mono',placeholder:st.hasPassword?O.tr('Password saved (leave empty to keep)','Пароль сохранён (оставьте пустым)'):O.tr('Backup password','Пароль бэкапа')});
      const status=h('div',{class:'mut s',style:{marginTop:'6px'}},'');
      const toggle=O.toggleRow('refresh',O.tr('Automatic backup','Автоматический бэкап'),O.tr('Encrypted copies in /sdcard/Download, newest 5 kept','Шифрованные копии в /sdcard/Download, хранятся 5 последних'),!!st.enabled,v=>{
        const r=O.native.autoBackupConfigure(v,parseInt(hoursInp.value,10)||24,pwInp.value);
        if(r&&r.ok===false)O.toast(r.err||'failed',4000);else O.toast(v?O.tr('Scheduled backup enabled','Автобэкап включён'):O.tr('Scheduled backup disabled','Автобэкап выключен'),1500);
      });
      return h('div',null,toggle,
        h('div',{style:{display:'flex',gap:'8px',alignItems:'center',margin:'8px 0',flexWrap:'wrap'}},
          h('span',{class:'mut s'},O.tr('Interval (hours):','Интервал (часы):')),hoursInp,pwInp,
          h('button',{class:'btn sm',onclick:()=>{const r=O.native.autoBackupConfigure(true,parseInt(hoursInp.value,10)||24,pwInp.value);if(r&&r.ok===false)O.toast(r.err||'failed',4000);else O.toast(O.tr('Saved','Сохранено'),1200)}},O.tr('Save','Сохранить'))),
        h('button',{class:'btn wide',onclick:()=>{const r=O.native.autoBackupNow(pwInp.value);if(r&&r.ok){status.textContent=O.tr('Created: ','Создано: ')+r.path;drawExisting();O.toast(O.tr('Backup created','Бэкап создан'),2000)}else O.toast((r&&r.err)||O.tr('Set a password first','Сначала задайте пароль'),4000)}},O.icon('shield'),O.tr('Backup now','Сделать бэкап сейчас')),
        status);
    })(),
    info);
  sub(O.tr('Encrypted backup','Шифрованный бэкап'),body,{full:true});
}
O.on('picked',async d=>{
  if(!d||d.kind!=='backup'||!d.ok)return;
  const pw=await O.ask(O.tr('Backup password','Пароль бэкапа'),O.tr('Enter the password used when the backup was created','Введите пароль, заданный при создании бэкапа'));
  if(!pw)return;
  try{
    const r=JSON.parse(OC.restoreProfile(pw,d.path||d.file));
    if(r.ok){O.toast(O.tr('Profile restored. Restarting server...','Профиль восстановлен. Перезапускаю сервер...'),3000);OC.restartServer()}
    else O.toast(r.err||'failed',4000);
  }catch(e){O.toast(e.message,4000)}
});

// ---- settings export / import ----
function openSettingsTransfer(){
  const info=h('div',{class:'mut s',style:{marginTop:'10px',wordBreak:'break-all'}},'');
  const fileInp=h('input',{type:'file',accept:'application/json,.json',class:'hide'});
  fileInp.onchange=()=>{
    const f=fileInp.files&&fileInp.files[0];if(!f)return;
    const r=new FileReader();
    r.onload=async()=>{
      try{
        const n=O.importSettings(String(r.result));
        info.textContent=O.tr('Imported keys: ','Импортировано записей: ')+n;
        O.toast(O.tr('Settings imported. Reloading...','Настройки импортированы. Перезагрузка...'),2000);
        setTimeout(()=>location.reload(),900);
      }catch(e){O.toast(e.message,4000)}
    };
    r.onerror=()=>O.toast(O.tr('Could not read file','Не удалось прочитать файл'),3000);
    r.readAsText(f);
  };
  const body=h('div',null,
    h('div',{class:'note'},O.tr('Export includes models, agents, themes, fallback chain, session tags, plugins and the opencode.json config. Secrets and tokens are not exported.','Экспорт включает модели, агентов, темы, резервные модели, теги сессий, плагины и конфиг opencode.json. Токены и секреты не экспортируются.')),
    h('button',{class:'btn pri wide',style:{marginTop:'10px'},onclick:()=>{
      try{
        const json=O.exportSettings();
        O.actions(O.tr('Export settings','Экспорт настроек'),[
          {label:O.tr('Copy JSON','Скопировать JSON'),icon:'copy',fn:()=>O.native.copy(json)},
          {label:O.tr('Share file/text','Поделиться'),icon:'share',fn:()=>{if(O.native&&O.native.share)O.native.share(json);else O.native.copy(json)}}]);
      }catch(e){O.toast(e.message,4000)}
    }},O.icon('down'),O.tr('Export settings (JSON)','Экспортировать настройки (JSON)')),
    h('div',{style:{height:'16px'}}),
    h('button',{class:'btn wide',onclick:()=>fileInp.click()},O.icon('up'),O.tr('Import settings from file...','Импортировать настройки из файла...')),
    fileInp,info);
  sub(O.tr('Export / Import settings','Экспорт / импорт настроек'),body,{full:true});
}

// ---- agents / rules upload ----
function openAgents(){
  if(O.updateReadmeForModel) O.updateReadmeForModel();
  const list=h('div');
  const up=(t,sbt,kind,dir)=>O.listRow('up',t,sbt,null,()=>OC.pickFile(kind,dir||''));
  const s=sub('Агенты и правила',h('div',null,
    O.listRow('doc','Инструкции и README (AGENTS.md)','Текущие инструкции и джейлбрейк для активной модели',null,()=>editFile(CFG+'/AGENTS.md','Инструкции и README (AGENTS.md)')),
    O.listRow('edit','Глобальный README.md','Текущие инструкции и джейлбрейк в README.md',null,()=>editFile(CFG+'/README.md','Глобальный README.md')),
    up('Глобальные правила (AGENTS.md)','Выберите файл — действует для всех проектов','rules'),
    up('Правила проекта (AGENTS.md)','Сохраняются в текущую папку','project',S.dir),
    up('Файл навыка (.md)','Добавляет навык для агента','skill'),
    up('Файл агента (.md)','Добавляется в список ваших агентов','agent'),up('Файл команды (.md)','Добавляет /команду','command'),list));
  const draw=()=>{list.textContent='';[['skills','Навыки'],['agents','Агенты'],['commands','Команды']].forEach(([d,t])=>{const r=O.native.ls(CFG+'/'+d);if(r.items&&r.items.length){list.append(h('div',{class:'grp'},t));
    r.items.filter(x=>!x.dir).forEach(x=>list.append(O.listRow('doc',x.name,'',h('button',{class:'ibtn s',onclick:async e=>{e.stopPropagation();if(await O.confirm('Удалить '+x.name+'?','','Удалить',true)){O.native.fs('delete',CFG+'/'+d+'/'+x.name);draw();O.loadMeta()}}},O.icon('trash')),()=>editFile(CFG+'/'+d+'/'+x.name,x.name))))}})};
  draw();watchPicked(s,()=>draw())}
function editFile(path,title){const r=O.native.readText(path);const ta=h('textarea',{class:'mono',rows:18});ta.value=r.ok?r.text:'';
  const s=O.sheet(title,h('div',null,ta,h('button',{class:'btn pri wide',style:{marginTop:'8px'},onclick:()=>{const w=O.native.fs('mkdir',O.dirname(path));const x=O.native.writeText(path,ta.value);if(x.ok){O.toast('Сохранено',1200);s.close();O.loadMeta()}else O.toast(x.err||'Не удалось')}},'Сохранить')),{full:true})}

// ---- MCP ----
O.openMcp=async()=>{const body=h('div');const s=sub('Серверы MCP',body,{actions:h('div',{style:{display:'flex',gap:'4px'}},h('button',{class:'ibtn',onclick:()=>draw()},O.icon('refresh')),h('button',{class:'ibtn',onclick:()=>edit(null)},O.icon('plus')))});
  const draw=async()=>{body.textContent='';const c=cfg.read();if(!c.obj){body.append(h('div',{class:'errbox'},'Ошибки в opencode.json: '+c.err));return}
    let live={};try{live=await api('GET','/mcp')}catch{}const m=c.obj.mcp||{};const ks=Object.keys(m);
    if(!ks.length)body.append(h('div',{class:'mut',style:{padding:'12px'}},'Серверов MCP пока нет. Нажмите + чтобы добавить.'));
    ks.forEach(k=>{const e=m[k],l=live[k],stt=l?l.status:(e.enabled===false?'disabled':'unknown');
      const tools=l&&(l.tools||l.toolCount||(Array.isArray(l.tools)?l.tools.length:0));
      const subTxt=(e.type==='remote'?e.url:(e.command||[]).join(' '))+'  ('+stt+(tools?', '+tools+' tools':'')+')';
      body.append(O.listRow('server',k,subTxt,h('span',{class:'dot '+(stt==='connected'?'ok':stt==='failed'?'err':stt==='disabled'?'':'warn')}),
        ()=>O.actions(k,[{label:'Изменить',icon:'edit',fn:()=>edit(k)},
          {label:'Переподключить',icon:'refresh',fn:async()=>{try{await api('POST','/mcp/'+encodeURIComponent(k)+'/disconnect',{}).catch(()=>{});await api('POST','/mcp/'+encodeURIComponent(k)+'/connect',{});O.toast('Переподключено',1200)}catch(er){O.toast(er.message,4000)}draw()}},
          {label:e.enabled===false?'Включить':'Отключить',icon:'play',fn:()=>{const cc=cfg.read();cc.obj.mcp[k].enabled=e.enabled===false;cfg.write(cc.obj);api('POST','/mcp/'+encodeURIComponent(k)+(e.enabled===false?'/connect':'/disconnect'),{}).catch(()=>{});draw()}},
          {label:'Удалить',icon:'trash',danger:true,fn:()=>{const cc=cfg.read();delete cc.obj.mcp[k];cfg.write(cc.obj);api('POST','/mcp/'+encodeURIComponent(k)+'/disconnect',{}).catch(()=>{});draw()}}])))});
    body.append(restartBar())};
  const edit=name=>{const c=cfg.read();if(!c.obj)return O.toast('Сначала исправьте opencode.json');const e=(name&&c.obj.mcp&&c.obj.mcp[name])||{type:'local',enabled:true};
    const nm=h('input',{placeholder:'имя, напр. context7'});nm.value=name||'';nm.disabled=!!name;
    let type=e.type||'local';const cmd=h('input',{class:'mono',placeholder:'npx -y @upstash/context7-mcp'});cmd.value=(e.command||[]).join(' ');
    const env=h('textarea',{class:'mono',rows:3,placeholder:'КЛЮЧ=значение (по одному на строку)'});env.value=Object.entries(e.environment||{}).map(([k,v])=>k+'='+v).join('\n');
    const url=h('input',{class:'mono',placeholder:'https://mcp.example.com/mcp'});url.value=e.url||'';
    const hd=h('textarea',{class:'mono',rows:3,placeholder:'Заголовок: значение (по одному на строку)'});hd.value=Object.entries(e.headers||{}).map(([k,v])=>k+': '+v).join('\n');
    const lo=h('div',null,h('div',{class:'field'},h('label',null,'Команда'),cmd),h('div',{class:'field'},h('label',null,'Переменные окружения'),env));
    const re=h('div',null,h('div',{class:'field'},h('label',null,'URL'),url),h('div',{class:'field'},h('label',null,'Заголовки'),hd));
    const seg=h('div',{class:'seg'},[['local','Локальный'],['remote','Удалённый']].map(([t,l])=>h('button',{class:t===type?'on':'',onclick:ev=>{type=t;seg.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b===ev.currentTarget));show()}},l)));
    const show=()=>{lo.classList.toggle('hide',type!=='local');re.classList.toggle('hide',type!=='remote')};show();
    const sh=O.sheet(name?'Изменение '+name:'Добавить сервер MCP',h('div',null,h('div',{class:'field'},h('label',null,'Имя'),nm),seg,lo,re,
      h('button',{class:'btn pri wide',style:{marginTop:'10px'},onclick:async()=>{const n=nm.value.trim();if(!n)return O.toast('Введите имя');
        const o={type,enabled:e.enabled!==false};
        if(type==='local'){o.command=O.splitArgs(cmd.value);if(!o.command.length)return O.toast('Введите команду');const ev={};env.value.split('\n').forEach(l=>{const i=l.indexOf('=');if(i>0)ev[l.slice(0,i).trim()]=l.slice(i+1).trim()});if(Object.keys(ev).length)o.environment=ev}
        else{if(!url.value.trim())return O.toast('Введите URL');o.url=url.value.trim();const hv={};hd.value.split('\n').forEach(l=>{const i=l.indexOf(':');if(i>0)hv[l.slice(0,i).trim()]=l.slice(i+1).trim()});if(Object.keys(hv).length)o.headers=hv}
        const cc=cfg.read();cc.obj.mcp=cc.obj.mcp||{};cc.obj.mcp[n]=o;const w=cfg.write(cc.obj);if(!w.ok)return O.toast(w.err||'Не удаётся записать конфиг');
        api('POST','/mcp',{name:n,config:o}).catch(()=>{});sh.close();draw()}},'Сохранить')),{full:true})};
  draw()};

// ---- plugins ----
O.openPlugins=()=>{const body=h('div');const s=sub('Плагины',body);
  const draw=()=>{body.textContent='';const c=cfg.read();if(!c.obj){body.append(h('div',{class:'errbox'},'Ошибки в opencode.json: '+c.err));return}
    const pl=c.obj.plugin||[];
    const inp=h('input',{class:'mono',placeholder:'npm-пакет, напр. opencode-gemini-auth',autocapitalize:'off',autocorrect:'off'});
    body.append(h('div',{class:'grp'},'Установленные (npm)'));
    if(!pl.length)body.append(h('div',{class:'mut',style:{padding:'8px'}},'Нет'));
    pl.forEach((p,i)=>body.append(O.listRow('plug',Array.isArray(p)?p[0]:p,'',h('button',{class:'ibtn s',onclick:e=>{e.stopPropagation();const cc=cfg.read();cc.obj.plugin.splice(i,1);cfg.write(cc.obj);draw()}},O.icon('trash')))));
    body.append(h('div',{style:{display:'flex',gap:'6px',marginTop:'8px'}},inp,h('button',{class:'btn pri',onclick:()=>{const v=inp.value.trim();if(!v)return;const cc=cfg.read();cc.obj.plugin=(cc.obj.plugin||[]).concat([v]);cfg.write(cc.obj);draw()}},'Добавить')));
    body.append(h('div',{class:'grp'},'Локальные файлы'));const r=O.native.ls(CFG+'/plugins');
    (r.items||[]).filter(x=>!x.dir).forEach(x=>body.append(O.listRow('code',x.name,'',h('button',{class:'ibtn s',onclick:e=>{e.stopPropagation();O.native.fs('delete',CFG+'/plugins/'+x.name);draw()}},O.icon('trash')))));
    body.append(h('button',{class:'btn wide',style:{marginTop:'8px'},onclick:()=>OC.pickFile('plugin','')},O.icon('up'),'Загрузить файл плагина (.js / .ts)'),
      h('div',{class:'note',style:{marginTop:'10px'}},'npm-плагины установятся автоматически при следующем запуске сервера.'),restartBar())};
  draw();watchPicked(s,()=>draw())};

// ---- raw config ----
function openConfig(){const c=cfg.read();const ta=h('textarea',{class:'mono',rows:20,spellcheck:'false'});ta.value=c.raw||'{\n}\n';
  sub('opencode.json',h('div',null,c.err?h('div',{class:'errbox'},c.err):null,ta,h('button',{class:'btn pri wide',style:{marginTop:'8px'},onclick:()=>{try{O.parseJsonc(ta.value||'{}')}catch(e){return O.toast('Неверный JSON: '+e.message,4000)}
    const w=cfg.write(ta.value);w.ok?O.toast('Сохранено',1200):O.toast(w.err||'Не удалось')}},'Сохранить'),restartBar()))}

// ---- provider health check ----
// Pings each connected provider through the local server and remembers the result, so a silently
// broken key does not surface only when a prompt fails.
O.providerHealth=()=>O.store.get('providerHealth',{});
let healthRunning=false;
O.checkProviders=async(force)=>{
  const cached=O.providerHealth();
  const fresh=cached&&cached.at&&Date.now()-cached.at<10*60*1000;
  if(!force&&fresh)return cached;
  if(healthRunning)return cached;
  healthRunning=true;
  try{
    const r=await api('GET','/provider',null,{timeout:15000,cache:false});
    const connected=(r&&r.connected)||[];
    const models=O.allModels();
    const res={at:Date.now(),items:{}};
    for(const pid of connected){
      const pm=models.filter(x=>x.pid===pid);
      res.items[pid]={models:pm.length,ok:true};
    }
    O.store.set('providerHealth',res);
    bus.emit('meta');
    return res;
  }catch(e){
    return cached;
  }finally{healthRunning=false}
};
// ---- updates ----
let updUI=null;
function openUpdates(){const st=O.native.state();const bar=h('i');const info=h('div',{class:'mut s',style:{margin:'8px 0'}},'');
  const app=h('div'),core=h('div');
  const row=(t,sb,btn)=>h('div',{class:'li'},O.icon('down'),h('div',{class:'t'},h('b',null,t),h('span',null,sb)),btn||null);
  const draw=u=>{app.textContent='';core.textContent='';
    app.append(row('Приложение OpenCode '+st.version,u&&u.app?'Новая версия '+u.app.name:'Актуальная версия',u&&u.app?h('button',{class:'btn pri sm',onclick:()=>OC.applyAppUpdate()},'Установить'):null));
    core.append(row('Ядро OpenCode '+(st.core||''),u&&u.core?'Новый релиз '+u.core:'ветка 1.x',u&&u.core?h('button',{class:'btn pri sm',onclick:()=>OC.applyCoreUpdate()},'Обновить'):null))};
  draw(null);
  const s=sub('Обновления',h('div',null,app,core,h('button',{class:'btn wide',onclick:()=>{info.textContent='Проверка...';OC.checkUpdates()}},O.icon('refresh'),'Проверить обновления'),info,h('div',{class:'bar',style:{marginTop:'8px'}},bar),
    h('div',{class:'note',style:{marginTop:'12px'}},'Обновления ядра идут только по ветке 1.x и применяются без переустановки приложения.')),{onClose:()=>{updUI=null}});
  updUI={draw,bar,info,s}}
O.on('update',d=>{if(!updUI)return;
  if(d.error){updUI.info.textContent=d.error;updUI.bar.style.width='0'}
  else if(d.pct!=null){updUI.bar.style.width=d.pct+'%';updUI.info.textContent=(d.what==='core'?'Загрузка ядра ':'Загрузка приложения ')+d.pct+'%'}
  else if(d.coreDone){updUI.bar.style.width='0';updUI.info.textContent='Ядро обновлено до '+d.coreDone+'. Перезапуск сервера...'}
  else{updUI.draw(d);updUI.info.textContent=(d.app||d.core)?'Доступны обновления':'Всё актуально'}});

// ---- permissions ----
const PERMS=[['notifications','bell','Уведомления','Звуки и оповещения о завершении задач'],['files','folder','Доступ ко всем файлам','Работа с /storage/emulated/0 и Download'],['battery','bat','Работа в фоне','Игнорирование оптимизации батареи, чтобы сервер не отключался'],['install','down','Установка обновлений','Разрешить OTA-обновлениям устанавливать новый APK']];
let permUI=null;
O.permRows=()=>{const p=O.native.state().perms||{};return PERMS.map(([k,i,t,d])=>h('div',{class:'li'},O.icon(i),h('div',{class:'t'},h('b',null,t),h('span',null,d)),p[k]?h('span',{class:'ok s'},'Дано'):h('button',{class:'btn sm',onclick:()=>OC.grant(k)},'Разрешить')))};
function openPerms(){const box=h('div',null,...O.permRows());const s=sub('Разрешения',box,{onClose:()=>{permUI=null}});permUI=()=>{box.textContent='';box.append(...O.permRows())}}
O.on('perms',()=>{if(permUI)permUI()});

// ---- compatibility / about ----
function openCompat(){const fl=O.native.state().flags||{};
  sub('Совместимость и логи',h('div',null,O.toggleRow('shield','Безопасный режим (без seccomp)','Медленнее, но помогает, если сервер не запускается на некоторых телефонах',fl.noseccomp,v=>OC.setFlag('noseccomp',v)),
    h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:()=>{OC.restartServer();O.toast('Перезапуск сервера...')}},O.icon('refresh'),'Перезапустить сервер'),
    h('button',{class:'btn wide',style:{marginTop:'8px'},onclick:()=>{const t=OC.readLog();sub('Лог сервера',h('pre',{class:'term-pre',style:{maxHeight:'none'}},t||'(пусто)'))}},O.icon('terminal'),'Смотреть лог сервера')))}
function openAbout(){const st=O.native.state();
  sub('О приложении',h('div',null,h('div',{class:'center',style:{minHeight:0,padding:'16px 0'}},O.logo(40),h('b',{style:{fontSize:'20px'}},'OpenCode'),h('div',{class:'mut'},'Версия '+st.version),h('div',{class:'mut s'},'Ядро '+(st.core||'неизвестно')+' (1.x)')),
    h('div',{class:'note'},'OpenCode Mobile упаковывает CLI OpenCode 1.x (лицензия MIT) в Android-приложение. Оно создано не командой OpenCode и никак с ней не связано.'),
    h('div',{class:'note',style:{marginTop:'10px'}},'OpenCode как CLI-агент есть и у Warp — документация: docs.warp.dev/agents/cli-agents/opencode.'),
    h('button',{class:'btn wide',style:{marginTop:'12px'},onclick:()=>O.openUrl('https://docs.warp.dev/agents/cli-agents/opencode/')},O.icon('globe'),'OpenCode CLI-агент (Warp)'),
    h('button',{class:'btn wide',style:{marginTop:'8px'},onclick:()=>O.openUrl('https://t.me/OpenCodeMob')},O.icon('tg'),'t.me/OpenCodeMob')))}
O.on('signedout',()=>location.reload());

// ---- аккаунт opencode: вход через Google/GitHub (device flow) ----
O.consoleOrgs=async()=>{try{const r=await api('GET','/experimental/console/orgs',null,{timeout:10000});return r.orgs||[]}catch{return null}};
O.openAccount=()=>{
  const body=h('div');const s=sub('Аккаунт opencode',body,{full:true,onClose:()=>{try{OC.authCancel()}catch{}}});
  let busy=false;
  const drawIdle=async()=>{body.textContent='';
    const orgs=await O.consoleOrgs();
    // remember the state: hints in chat and «Подключить провайдера» больше не предлагают войти, если уже вошли
    const em=orgs&&orgs.length?[...new Set(orgs.map(o=>o.accountEmail))][0]:null;
    S.account={email:em||null,checked:true};
    if(orgs===null){
      body.append(h('div',{class:'errbox'},'Не удалось связаться с сервером opencode. Убедитесь, что он запущен, и попробуйте ещё раз.'),
        h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:()=>drawIdle()},O.icon('refresh'),'Повторить'));
      return}
    const emails=[...new Set(orgs.map(o=>o.accountEmail))];
    if(!emails.length){
      body.append(h('div',{class:'card',style:{display:'flex',alignItems:'center',gap:'10px'}},O.icon('user'),h('div',{class:'grow'},h('b',null,'Вход не выполнен'),h('div',{class:'mut s'},'Сейчас квота OpenCode Zen анонимная и быстро исчерпывается'))));
      body.append(h('div',{class:'note'},'Войдите через Google или GitHub — как в opencode на компьютере. Откроется страница opencode.ai: выберите Google или GitHub и подтвердите вход. После этого квота Zen привяжется к вашему аккаунту.'));
      body.append(h('button',{class:'btn pri wide',style:{marginTop:'8px'},onclick:startLogin},O.icon('user'),'Войти через Google / GitHub'));
      body.append(h('div',{class:'mut s',style:{marginTop:'10px'}},'Альтернатива — свой ключ провайдера: Настройки → Модели → Подключить провайдера.'));
      return}
    emails.forEach(e=>body.append(O.listRow('user',e,'Аккаунт opencode',O.icon('check','ok'),null)));
    const act=orgs.find(o=>o.active);
    if(act)body.append(O.listRow('key',act.orgName,'Активная организация',null,null));
    body.append(h('div',{class:'note'},'Вход выполнен: квота OpenCode Zen привязана к вашему аккаунту. Если ошибка квоты ещё появляется — перезапустите сервер и подождите минуту.'));
    emails.forEach(e=>body.append(h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:async()=>{
      if(!await O.confirm('Выйти из аккаунта opencode?','Квота Zen снова станет анонимной. Локальные чаты не удалятся.','Выйти',true))return;
      busy=true;O.toast('Выходим из аккаунта...');OC.authLogout(e)}},O.icon('out'),'Выйти из '+e)));
  };
  const startLogin=()=>{if(busy)return;busy=true;body.textContent='';
    const box=h('div',null,h('div',{style:{display:'flex',gap:'8px',alignItems:'center',padding:'6px 0'}},h('span',{class:'spin'}),h('span',{class:'mut'},'Готовим код входа... Это займёт несколько секунд')));
    body.append(box);
    let url=null,code=null,fin=false;
    const cancel=()=>{if(!fin){fin=true;busy=false;try{OC.authCancel()}catch{};drawIdle()}};
    let offAuth=null;
    offAuth=O.on('authlogin',d=>{
      // the sheet was closed or replaced: unhook instead of leaving a permanent no-op listener
      if(!box.isConnected){try{offAuth&&offAuth()}catch(_){}return}
      if(d.stage==='url'){url=d.url;code=d.code;
        box.textContent='';
        box.append(h('div',{class:'note'},'Открываем страницу opencode.ai. На ней нажмите «Continue with Google» или «Continue with GitHub» и подтвердите разрешение — код уже вписан автоматически.'),
          h('div',{class:'card',style:{textAlign:'center',padding:'14px',marginTop:'10px'}},h('div',{class:'mut s'},'Код входа (если понадобится вручную)'),h('b',{class:'mono',style:{fontSize:'22px',letterSpacing:'2px'}},code),h('button',{class:'btn sm',style:{marginTop:'8px'},onclick:()=>O.native.copy(code)},O.icon('copy'),'Скопировать код')),
          h('button',{class:'btn pri wide',style:{marginTop:'10px'},onclick:()=>O.openUrl(url)},O.icon('ext'),'Открыть страницу входа ещё раз'),
          h('div',{style:{display:'flex',gap:'8px',alignItems:'center',margin:'14px 0'}},h('span',{class:'spin'}),h('span',{class:'mut'},'Ожидаем подтверждение в браузере...')),
          h('button',{class:'btn wide',onclick:cancel},'Отменить вход'));
        O.openUrl(url);
      }else if(d.stage==='done'){fin=true;busy=false;
        box.textContent='';
        box.append(h('div',{class:'card',style:{display:'flex',alignItems:'center',gap:'10px'}},O.icon('check'),h('div',{class:'grow'},h('b',null,'Вошли как '+d.email),h('div',{class:'mut s'},'Перезапускаем сервер, чтобы применить аккаунт...'))));
        if(d.synced===false)box.append(h('div',{class:'errbox',style:{marginTop:'10px'}},'Аккаунт сохранён, но автоматически привязать его к моделям не удалось. После перезапуска откройте Настройки → Аккаунт opencode и проверьте статус входа.'));
        S.account={email:d.email,checked:true};bus.emit('meta');
        O.toast('Вошли как '+d.email,4000);
        setTimeout(()=>{s.close();OC.restartServer();O.toast('Перезапуск сервера...')},1500);
      }else if(d.stage==='error'){fin=true;busy=false;
        box.textContent='';
        box.append(h('div',{class:'errbox'},d.error||'Не удалось войти'),
          h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:startLogin},O.icon('refresh'),'Повторить вход'),
          h('button',{class:'btn wide',style:{marginTop:'8px'},onclick:drawIdle},'Назад'))}});
    try{OC.authLogin()}catch(e){fin=true;busy=false;box.textContent='';box.append(h('div',{class:'errbox'},e.message||'Не удалось запустить вход'))}
  };
  drawIdle()};
// ---- Community Jailbreaks & Custom Plugins System ----
const getAuthorToken=()=>{
  let tok=O.store.get('author_token');
  if(!tok){tok='usr_'+Math.random().toString(36).slice(2)+Date.now().toString(36);O.store.set('author_token',tok)}
  return tok;
};

const LEGACY_MODEL_IDS=new Set(['qwen2.5-coder','claude-3-5-sonnet','deepseek-chat','gpt-4o']);
const LEGACY_JB_IDS=new Set(['jb_qwen','jb_claude','jb_deepseek','jb_gpt4o']);

const SYSTEM_JB_IDS=new Set([
  'jb_universal','jb_c4','jb_deepseek_v4','jb_nemotron_lightning',
  'jb_glm_5','jb_flint_40b','jb_mimo_v2','jb_big_pickle','jb_beam_free',
  'jb_pulse_alpha','jb_crouton_alpha','jb_nemotron_vl','jb_qwen',
  'jb_claude','jb_deepseek','jb_gpt4o'
]);

const DEFAULT_JAILBREAKS=[];

const DB_BACKENDS=[
  'https://6aec5a8bfc3b911e6fd5037d.mockapi.io',
  'https://ocm-community.clodperv1.workers.dev',
  'https://ocm-zen-community-default-rtdb.firebaseio.com'
];
O.cloudDb={
  getBackends(){
    const list=[...DB_BACKENDS];
    const custom=(O.store.get('cloud_db_url')||'').trim().replace(/\/+$/,'');
    if(custom&&!list.includes(custom))list.unshift(custom);
    return list;
  },
  async fetchAll(col){
    for(const u of this.getBackends()){
      try{
        const isFb=u.includes('firebaseio.com');
        const fetchUrl=isFb?`${u}/${col}.json`:`${u}/${col}`;
        const ctrl=new AbortController();
        const tid=setTimeout(()=>ctrl.abort(),4500);
        const resp=await fetch(fetchUrl,{
          method:'GET',
          headers:{'Accept':'application/json'},
          signal:ctrl.signal
        });
        clearTimeout(tid);
        if(!resp.ok){
          console.warn('[cloudDb] '+u+' returned '+resp.status+', trying fallback');
          continue;
        }
        const data=await resp.json();
        if(!data)continue;
        if(Array.isArray(data))return data;
        return Object.entries(data).map(([id,val])=>Object.assign({id},val));
      }catch(e){
        console.warn('[cloudDb] fetch error on '+u,e);
      }
    }
    return[];
  },
  async syncItem(col,item){
    for(const u of this.getBackends()){
      try{
        const isFb=u.includes('firebaseio.com');
        const ctrl=new AbortController();
        const tid=setTimeout(()=>ctrl.abort(),4500);
        if(isFb){
          const resp=await fetch(`${u}/${col}/${item.id}.json`,{
            method:'PUT',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(item),
            signal:ctrl.signal
          });
          clearTimeout(tid);
          if(resp.ok)return item;
          continue;
        }
        const resp=await fetch(`${u}/${col}`,{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify(item),
          signal:ctrl.signal
        });
        clearTimeout(tid);
        if(resp.ok){
          const saved=await resp.json();
          return Object.assign({},item,saved);
        }
      }catch(e){
        console.warn('[cloudDb] syncItem error on '+u,e);
      }
    }
    return item;
  },
  async removeItem(col,id){
    for(const u of this.getBackends()){
      try{
        const isFb=u.includes('firebaseio.com');
        const delUrl=isFb?`${u}/${col}/${id}.json`:`${u}/${col}/${id}`;
        const ctrl=new AbortController();
        const tid=setTimeout(()=>ctrl.abort(),4500);
        await fetch(delUrl,{method:'DELETE',signal:ctrl.signal});
        clearTimeout(tid);
      }catch(_){}
    }
  },
  async updateLikes(col,id,likes,dislikes){
    for(const u of this.getBackends()){
      try{
        const isFb=u.includes('firebaseio.com');
        const ctrl=new AbortController();
        const tid=setTimeout(()=>ctrl.abort(),4500);
        if(isFb){
          const resp=await fetch(`${u}/${col}/${id}.json`,{
            method:'PATCH',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({likes,dislikes}),
            signal:ctrl.signal
          });
          clearTimeout(tid);
          if(resp.ok)return true;
          continue;
        }
        const resp=await fetch(`${u}/${col}/${id}`,{
          method:'PUT',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({likes,dislikes}),
          signal:ctrl.signal
        });
        clearTimeout(tid);
        if(resp.ok)return true;
      }catch(e){
        console.warn('[cloudDb] updateLikes error on '+u,e);
      }
    }
    return false;
  }
};

O.getJailbreaks=()=>{
  let local=O.store.get('custom_jailbreaks',[]);
  local=local.filter(j=>j&&j.author!=='system'&&!SYSTEM_JB_IDS.has(j.id)&&!LEGACY_JB_IDS.has(j.id)&&!LEGACY_MODEL_IDS.has(j.model));
  return local;
};

O.getActiveJailbreakIds=()=>{
  const ids=O.store.get('active_jailbreak_ids');
  if(Array.isArray(ids))return new Set(ids);
  const oldSingle=O.store.get('active_jailbreak_id');
  if(oldSingle)return new Set([oldSingle]);
  return new Set();
};

O.isJailbreakActive=id=>O.getActiveJailbreakIds().has(id);

O.toggleJailbreak=id=>{
  const set=O.getActiveJailbreakIds();
  const next=!set.has(id);
  if(next)set.add(id);else set.delete(id);
  const arr=Array.from(set);
  O.store.set('active_jailbreak_ids',arr);
  O.store.set('active_jailbreak_id',arr[0]||null);
  if(O.updateReadmeForModel){
    const mid=S.model?S.model.modelID:null;
    O.updateReadmeForModel(mid);
  }
  return next;
};

O.getActiveJailbreaks=currentModelID=>{
  const activeIds=O.getActiveJailbreakIds();
  if(!activeIds.size)return [];
  const all=O.getJailbreaks();
  return all.filter(j=>activeIds.has(j.id)&&(
    !currentModelID||!j.model||j.model==='Все модели'||j.model===currentModelID
  ));
};

O.getActiveJailbreak=()=>{
  const jbs=O.getActiveJailbreaks();
  return jbs[0]||null;
};

const BASE_SYSTEM_INSTRUCTIONS = `# OpenCode Mobile Environment & Instructions (v2.0.1)

You are running inside **OpenCode Mobile** directly on native Android (ARM64 / aarch64 architecture).
You have full access to a complete Linux userspace environment, terminal tools, and native Android integrations.

## 1. Environment & Architecture
- Platform: Native Android Linux Userspace (ARM64 / aarch64).
- Package manager: Always use \`pkg\` (\`pkg install <package>\`, do NOT pass \`-y\`) or \`pip\` / \`npm\`.
- Compilations: Target ARM64/aarch64 architecture.
- Storage: \`/root\` is internal storage ($HOME). \`/sdcard\` or \`/storage/emulated/0\` is shared Android storage with \`noexec\` restriction. Always run scripts with explicit interpreter: \`python script.py\`, \`bash script.sh\`.

## 2. Core Skill: Launching Android Applications
You have the built-in skill to open and switch to any installed Android application or system setting on the device!
Whenever the user asks you to open, launch, or switch to an app:
1. Execute the bash command:
   \`openapp <app_name_or_package>\`
2. Inform the user in your response that the application is opening, and include an action button:
   \`<button data-action="open_app" data-target="<app_name>">Открыть <app_name></button>\`

## 3. Core Skill: In-App Web Project Preview
You have the built-in skill to preview web projects directly inside OpenCode Mobile:
- To launch the in-app preview from shell, execute: \`openpreview <path>\`
- Or include an interactive artifact button in your response:
  \`<button data-action="preview" data-path="index.html">Открыть сайт</button>\`

## 4. Interactive Artifact Buttons
- \`<button data-action="new_chat">Новый чат</button>\`
- \`<button data-action="open_app" data-target="telegram">Открыть Telegram</button>\`
- \`<button data-action="preview" data-path="index.html">Открыть сайт</button>\`
- \`<button data-action="files">Открыть Файлы</button>\`
- \`<button data-action="term">Терминал</button>\`

## 5. Diff Statistics Reporting (MANDATORY)
At the very end of EVERY response, you MUST output a separate line with line additions and deletions:
+N -M
(If no files were edited, output: +0 -0)`;

// Writes AGENTS.md / README.md into every profile location. Called on each send, but the content
// almost never changes — remember what was written per path and skip identical writes (6 files x
// every message was pure blocking I/O on the WebView thread).
let readmeWrote={};
O.updateReadmeForModel = (modelID) => {
  try {
    const curMid = modelID || (S.model ? S.model.modelID : null);
    const activeJbs = (O.getActiveJailbreaks ? O.getActiveJailbreaks(curMid) : []);

    let content = '';
    if (activeJbs && activeJbs.length) {
      const jbSections = activeJbs.map(jb => {
        const target = jb.model ? ` (Модель: ${jb.model})` : ' (Все модели)';
        return `## [JAILBREAK DIRECTIVE: ${jb.title}${target}]\n${(jb.prompt || '').trim()}`;
      }).join('\n\n---\n\n');

      content = `# OpenCode System Directives & Instructions (Active: ${curMid || 'Universal'})\n\n${jbSections}\n\n---\n\n${BASE_SYSTEM_INSTRUCTIONS}`;
    } else {
      content = BASE_SYSTEM_INSTRUCTIONS;
    }

    const targets = [
      CFG + '/AGENTS.md',
      CFG + '/README.md',
      '/root/AGENTS.md',
      '/root/README.md'
    ];
    if (S.dir && S.dir !== '/root') {
      targets.push(S.dir + '/AGENTS.md');
      targets.push(S.dir + '/README.md');
    }

    for (const path of targets) {
      if (readmeWrote[path] === content) continue;
      try {
        O.native.fs('mkdir', O.dirname(path));
        const r = O.native.writeText(path, content);
        if (r && r.ok) readmeWrote[path] = content;
      } catch (_) {}
    }
  } catch (_) {}
};

setTimeout(() => {
  try {
    if (O.updateReadmeForModel) O.updateReadmeForModel();
  } catch (_) {}
}, 500);

const SYSTEM_PLUG_IDS=new Set(['plug_git_autopush','plug_code_format','plug_resource_mon']);
const DEFAULT_PLUGINS=[];

try{
  const cur=O.store.get('custom_jailbreaks',[]);
  if(Array.isArray(cur)){
    const cleaned=cur.filter(j=>j&&j.author!=='system'&&!SYSTEM_JB_IDS.has(j.id)&&!LEGACY_JB_IDS.has(j.id));
    if(cleaned.length!==cur.length){
      O.store.set('custom_jailbreaks',cleaned);
    }
  }
  const curP=O.store.get('custom_plugins',[]);
  if(Array.isArray(curP)){
    const cleanedP=curP.filter(p=>p&&p.author!=='system'&&!SYSTEM_PLUG_IDS.has(p.id));
    if(cleanedP.length!==curP.length){
      O.store.set('custom_plugins',cleanedP);
    }
  }
  const curAct=O.store.get('active_jailbreak_id');
  if(curAct&&(SYSTEM_JB_IDS.has(curAct)||LEGACY_JB_IDS.has(curAct))){
    O.store.set('active_jailbreak_id',null);
  }
}catch(_){}

O.getCustomPlugins=()=>{
  let local=O.store.get('custom_plugins',[]);
  return local.filter(p=>p&&p.author!=='system'&&!SYSTEM_PLUG_IDS.has(p.id));
};

function getLiveModelList(){
  const all=(O.allModels?O.allModels():[]);
  const list=['Все модели'];
  all.forEach(x=>{
    const id=x.mid||x.id||(x.m&&x.m.id);
    if(id&&!list.includes(id))list.push(id);
  });
  const fallbackZen=[
    'big-pickle',
    'mimo-v2.6-flash-free',
    'deepseek-v4.1-flash-free',
    'beam-free',
    'nemotron-3.5-lightning-free',
    'pulse-alpha-free',
    'flint-40b-free',
    'crouton-alpha-free',
    'nemotron-3.5-super-vl-free',
    'glm-5.3-flash-free'
  ];
  fallbackZen.forEach(id=>{
    if(!list.includes(id))list.push(id);
  });
  return list.filter(m=>!LEGACY_MODEL_IDS.has(m));
}

function openModelPickerSheet({title,current,includeAll,onSelect}){
  const listEl=h('div');
  const searchInp=h('input',{
    class:'search-input',
    placeholder:O.tr('Search model...','Поиск модели...'),
    style:{
      width:'100%',
      marginBottom:'12px',
      padding:'12px 14px',
      borderRadius:'12px',
      background:'rgba(255,255,255,0.06)',
      border:'1px solid var(--line)',
      color:'#fff',
      fontSize:'14px',
      boxSizing:'border-box'
    }
  });

  const s=O.sheet(title||O.tr('Select Model','Выбор модели'),h('div',null,searchInp,listEl),{hud:true,full:true});

  let filterText='';
  searchInp.oninput=()=>{
    filterText=searchInp.value.trim().toLowerCase();
    renderList();
  };

  function renderList(){
    listEl.textContent='';
    const models=getLiveModelList();
    let filtered=includeAll?models:models.filter(m=>m!=='Все модели');
    if(filterText){
      filtered=filtered.filter(m=>{
        const info=(m!=='Все модели')?(O.modelInfo('opencode',m)||(O.allModels?O.allModels().find(x=>x.mid===m):null)):null;
        const name=(info&&info.name)||'';
        return m.toLowerCase().includes(filterText)||name.toLowerCase().includes(filterText);
      });
    }

    if(!filtered.length){
      listEl.append(h('div',{class:'mut',style:{padding:'24px 16px',textAlign:'center'}},O.tr('No models found','Модели не найдены')));
      return;
    }

    const groupCard=h('div',{class:'group-card'});
    filtered.forEach(m=>{
      const isSel=(current===m);
      const isAll=(m==='Все модели');
      const info=!isAll?(O.modelInfo('opencode',m)||(O.allModels?O.allModels().find(x=>x.mid===m):null)):null;
      const titleText=(info&&info.name)||m;
      const subText=isAll?O.tr('Applies to all current models','Применяется ко всем текущим моделям'):(m!==titleText?m:(info&&info.pname?info.pname:'OpenCode Zen (free)'));

      const row=h('button',{
        class:'model-row'+(isSel?' on':''),
        onclick:()=>{
          s.close();
          onSelect(m);
        }
      },
        h('div',{class:'model-row-left'},
          h('div',{style:{display:'flex',alignItems:'center',gap:'6px'}},
            h('span',{class:'model-row-title'},titleText),
            isAll?h('span',{class:'badge-model badge-free'},'Universal'):h('span',{class:'badge-model badge-free'},'Free')
          ),
          h('span',{class:'model-row-sub'},subText)
        ),
        isSel?O.icon('check','model-check'):null
      );
      groupCard.append(row);
    });
    listEl.append(groupCard);
  }

  renderList();
  setTimeout(()=>{try{searchInp.focus()}catch(_){}},100);
}

function openJailbreaks(){
  const body=h('div');
  const s=sub(O.tr('Custom Jailbreaks','Пользовательские джейлбрейки'),body,{full:true});
  const myToken=getAuthorToken();

  const syncCloud=async(silent)=>{
    try{
      const remote=await O.cloudDb.fetchAll('jailbreaks');
      if(remote&&Array.isArray(remote)){
        let local=O.store.get('custom_jailbreaks',[]);
        const map=new Map();
        local.forEach(x=>{if(x&&x.id)map.set(String(x.id),x)});
        remote.forEach(r=>{
          if(r&&r.title&&r.prompt){
            const rId=String(r.id);
            r.likes=Number(r.likes)||0;
            r.dislikes=Number(r.dislikes)||0;
            if(map.has(rId)){
              map.set(rId,Object.assign({},map.get(rId),r));
            }else{
              let foundTemp=null;
              for(const [lid,item] of map.entries()){
                if(!/^\d+$/.test(lid)&&item.title===r.title&&item.author===r.author){
                  foundTemp=lid;
                  break;
                }
              }
              if(foundTemp){
                map.delete(foundTemp);
                map.set(rId,Object.assign({},r));
              }else{
                map.set(rId,r);
              }
            }
          }
        });
        const remoteIds=new Set(remote.map(r=>String(r.id)));
        for(const [lid,item] of map.entries()){
          if(!remoteIds.has(lid)&&item.author!=='local'){
            map.delete(lid);
          }
        }
        O.store.set('custom_jailbreaks',Array.from(map.values()));
        draw();
      }
    }catch(_){}
  };
  syncCloud(true);

  const searchInp=h('input',{
    placeholder:O.tr('Search jailbreak by title or description...','Поиск джейлбрейков сообщества...'),
    style:{
      width:'100%',
      marginBottom:'14px',
      padding:'12px 14px',
      borderRadius:'12px',
      background:'rgba(255,255,255,0.06)',
      border:'1px solid var(--line)',
      color:'#fff',
      fontSize:'14px',
      boxSizing:'border-box'
    }
  });
  searchInp.oninput=()=>draw();

  const list=h('div',{class:'jailbreak-list'});

  const draw=()=>{
    list.textContent='';
    const all=O.getJailbreaks();
    const q=(searchInp.value||'').trim().toLowerCase();
    const filtered=all.filter(j=>!q||(j.title||'').toLowerCase().includes(q)||(j.desc||'').toLowerCase().includes(q));

    if(!filtered.length){
      list.append(h('div',{class:'mut',style:{padding:'24px 16px',textAlign:'center'}},
        q
          ? O.tr('No jailbreaks found for this query.','Джейлбрейки по запросу не найдены.')
          : O.tr('No community jailbreaks yet. Tap «Publish Custom Jailbreak» below.','В каталоге сообщества пока нет джейлбрейков. Нажмите «Опубликовать свой джейлбрейк» ниже, чтобы добавить его для всех.')
      ));
    }else{
      filtered.forEach(jb=>{
        const isActive=O.isJailbreakActive(jb.id);
        const toggleBtn=h('button',{
          class:'btn sm '+(isActive?'pri':''),
          style:{minWidth:'84px'},
          onclick:()=>{
            const nxt=O.toggleJailbreak(jb.id);
            O.toast(nxt?O.tr('Jailbreak enabled: ','Джейлбрейк включён: ')+jb.title:O.tr('Jailbreak disabled','Джейлбрейк выключен'),1500);
            draw();
          }
        },isActive?O.tr('Enabled','Включён'):O.tr('Enable','Включить'));

        const viewBtn=h('button',{class:'ibtn s',title:O.tr('View prompt text','Посмотреть текст'),onclick:()=>{
          const content=h('div',null,
            h('div',{class:'mut s',style:{marginBottom:'8px',color:'#38bdf8'}},'Модель: '+(jb.model||'Все модели')+' • Сообщество: доступно всем'),
            h('p',{style:{color:'#a1a1aa',marginBottom:'10px'}},jb.desc||''),
            h('pre',{class:'code-pre',style:{maxHeight:'320px',overflowY:'auto'}},jb.prompt));
          O.sheet(jb.title,content);
        }},O.icon('eye'));

        const isMine=(jb.author===myToken||jb.author==='local');
        const delBtn=isMine?h('button',{class:'ibtn s',title:O.tr('Delete from community','Удалить из сообщества'),onclick:async()=>{
          if(!await O.confirm('Удалить джейлбрейк '+jb.title+' из сообщества?','Это удалит его для всех пользователей.','Удалить',true))return;
          let local=O.store.get('custom_jailbreaks',[]);
          local=local.filter(x=>x.id!==jb.id);
          O.store.set('custom_jailbreaks',local);
          const actIds=O.getActiveJailbreakIds();
          if(actIds.has(jb.id)){
            actIds.delete(jb.id);
            O.store.set('active_jailbreak_ids',Array.from(actIds));
          }
          O.cloudDb.removeItem('jailbreaks',jb.id);
          O.toast('Удалено из сообщества',1200);
          draw();
        }},O.icon('trash')):null;

        // Secret admin 6-click deletion on model name / title
        let secretClicks=0;
        let secretTimer=null;
        const onSecretClick=async(e)=>{
          if(e){
            if(e.stopPropagation)e.stopPropagation();
            if(e.preventDefault)e.preventDefault();
          }
          secretClicks++;
          if(secretTimer)clearTimeout(secretTimer);
          secretTimer=setTimeout(()=>{secretClicks=0},2500);

          if(secretClicks>=6){
            secretClicks=0;
            if(secretTimer)clearTimeout(secretTimer);
            const confirmed=await O.confirm(
              'Удалить '+jb.title+' навсегда?',
              'Секретный режим администратора: пресет "'+jb.title+'" ('+(jb.model||'Все модели')+') будет безвозвратно удалён из общего каталога для всех пользователей.',
              'Удалить для всех',
              true
            );
            if(!confirmed)return;

            let local=O.store.get('custom_jailbreaks',[]);
            local=local.filter(x=>x.id!==jb.id);
            O.store.set('custom_jailbreaks',local);

            const actIds=O.getActiveJailbreakIds();
            if(actIds.has(jb.id)){
              actIds.delete(jb.id);
              O.store.set('active_jailbreak_ids',Array.from(actIds));
            }

            await O.cloudDb.removeItem('jailbreaks',jb.id);
            O.toast('Удалено из каталога для всех пользователей',1800);
            draw();
          }
        };

        const modelTag=h('span',{
          class:'widget-custom-tag',
          style:{userSelect:'none',WebkitUserSelect:'none',cursor:'pointer'},
          onclick:onSecretClick
        },jb.model||'Все модели');

        // Likes / Dislikes voting
        const userVotes=O.store.get('jb_user_votes',{})||{};
        const key=String(jb.id);
        const myVote=userVotes[key]||null;
        const likesCount=Number(jb.likes)||0;
        const dislikesCount=Number(jb.dislikes)||0;

        const handleVote=async(type)=>{
          let votes=O.store.get('jb_user_votes',{})||{};
          const currentVote=votes[key]||null;
          let newLikes=Number(jb.likes)||0;
          let newDislikes=Number(jb.dislikes)||0;

          if(currentVote===type){
            delete votes[key];
            if(type==='like')newLikes=Math.max(0,newLikes-1);
            else newDislikes=Math.max(0,newDislikes-1);
          }else{
            if(currentVote==='like')newLikes=Math.max(0,newLikes-1);
            if(currentVote==='dislike')newDislikes=Math.max(0,newDislikes-1);

            votes[key]=type;
            if(type==='like')newLikes++;
            else newDislikes++;
          }

          jb.likes=newLikes;
          jb.dislikes=newDislikes;
          O.store.set('jb_user_votes',votes);

          let local=O.store.get('custom_jailbreaks',[]);
          const idx=local.findIndex(x=>String(x.id)===key);
          if(idx!==-1){
            local[idx].likes=newLikes;
            local[idx].dislikes=newDislikes;
            O.store.set('custom_jailbreaks',local);
          }

          draw();

          try{
            await O.cloudDb.updateLikes('jailbreaks',jb.id,newLikes,newDislikes);
          }catch(_){}
        };

        const likeBtn=h('button',{
          class:'jb-vote-btn'+(myVote==='like'?' active-like':''),
          type:'button',
          title:'Нравится',
          onclick:()=>handleVote('like')
        },
          O.icon('thumbUp'),
          h('span',{class:'count'},String(likesCount))
        );

        const sep=h('div',{class:'jb-vote-sep'});

        const dislikeBtn=h('button',{
          class:'jb-vote-btn'+(myVote==='dislike'?' active-dislike':''),
          type:'button',
          title:'Не нравится',
          onclick:()=>handleVote('dislike')
        },
          O.icon('thumbDown'),
          h('span',{class:'count'},String(dislikesCount))
        );

        const voteCapsule=h('div',{class:'jb-vote-capsule'},
          likeBtn,
          sep,
          dislikeBtn
        );

        const footerRow=h('div',{style:{display:'flex',alignItems:'center',justifyContent:'flex-start',marginTop:'2px'}},
          voteCapsule
        );

        const row=h('div',{
          class:'hud-dock-card',
          style:{
            padding:'12px 14px',
            margin:'8px 0',
            display:'flex',
            flexDirection:'column',
            gap:'8px',
            border:isActive?'1px solid var(--accent)':'1px solid rgba(255,255,255,0.08)',
            boxSizing:'border-box',
            overflow:'hidden'
          }
        },
          h('div',{style:{display:'flex',alignItems:'center',justifyContent:'space-between'}},
            h('div',{class:'grow',style:{minWidth:0}},
              h('b',{
                style:{color:'#fff',fontSize:'14px',display:'block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:'pointer',userSelect:'none',WebkitUserSelect:'none'},
                onclick:onSecretClick
              },jb.title),
              h('div',{style:{display:'flex',gap:'6px',alignItems:'center',flexWrap:'wrap',marginTop:'4px'}},
                modelTag,
                h('span',{class:'widget-custom-tag',style:{background:'rgba(56,189,248,0.15)',color:'#38bdf8'}},
                  isMine?'Мой пресет':'Сообщество (для всех)'))),
            h('div',{style:{display:'flex',gap:'6px',alignItems:'center',marginLeft:'8px'}},viewBtn,delBtn,toggleBtn)),
          h('div',{class:'mut s',style:{lineHeight:'1.4',wordBreak:'break-word'}},jb.desc||''),
          footerRow);
        list.append(row);
      });
    }
  };

  const uploadBtn=h('button',{class:'btn pri wide',style:{marginTop:'16px'},onclick:()=>{openUploadJailbreakModal(()=>{draw()})}},
    O.icon('plus'),O.tr('Upload Custom Jailbreak','Опубликовать свой джейлбрейк'));

  const syncRow=h('div',{style:{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'12px',padding:'6px 2px'}},
    h('div',{class:'mut s'},'Облачный каталог сообщества: для всех пользователей'),
    h('div',{style:{display:'flex',gap:'8px'}},
      h('button',{class:'btn sm',type:'button',onclick:async()=>{O.toast('Синхронизация...');await syncCloud();O.toast('Синхронизировано',1200)}},O.icon('refresh'),'Обновить')
    )
  );

  body.append(
    h('div',{class:'note',style:{marginBottom:'12px'}},O.tr('Community jailbreaks are available to all users across all devices. Enable presets to apply them to your chat models.','Общий каталог пресетов сообщества: все загруженные джейлбрейки видны всем пользователям на любых телефонах.')),
    syncRow,
    searchInp,
    list,
    uploadBtn);
  draw();
}

function openUploadJailbreakModal(onDone){
  const titleInp=h('input',{placeholder:O.tr('Jailbreak Title','Название джейлбрейка, напр. Ultra Code Unleashed')});
  const descInp=h('input',{placeholder:O.tr('Description','Краткое описание назначения')});

  let selectedModel='Все модели';
  const modelValLabel=h('span',{style:{fontWeight:'600',color:'#fff',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},'Все модели');
  const modelPickerBtn=h('button',{
    class:'btn wide',
    type:'button',
    style:{
      display:'flex',
      alignItems:'center',
      justifyContent:'space-between',
      padding:'12px 14px',
      borderRadius:'12px',
      background:'rgba(255,255,255,0.06)',
      border:'1px solid var(--line)',
      textAlign:'left',
      width:'100%'
    },
    onclick:()=>{
      openModelPickerSheet({
        title:O.tr('Target Model','Для какой модели'),
        current:selectedModel,
        includeAll:true,
        onSelect:m=>{
          selectedModel=m;
          const info=(m!=='Все модели')?(O.modelInfo('opencode',m)||(O.allModels?O.allModels().find(x=>x.mid===m):null)):null;
          modelValLabel.textContent=(info&&info.name&&info.name!==m)?`${info.name} (${m})`:m;
        }
      });
    }
  },h('div',{style:{display:'flex',alignItems:'center',gap:'8px',minWidth:0,overflow:'hidden'}},O.icon('cpu'),modelValLabel),O.icon('chevR'));

  const promptTa=h('textarea',{class:'editor',rows:8,placeholder:O.tr('Paste prompt instructions or load from file...','Вставьте системный промпт или загрузите файл...')});

  const fileInp=h('input',{type:'file',accept:'*/*',class:'hide',onchange:e=>{
    const f=e.target.files&&e.target.files[0];
    if(!f)return;
    if(!titleInp.value)titleInp.value=f.name.replace(/\.[^.]+$/,'');
    const reader=new FileReader();
    reader.onload=ev=>{
      promptTa.value=ev.target.result;
      O.toast('Файл прочитан: '+f.name,1200);
    };
    reader.onerror=()=>{O.toast('Ошибка чтения файла')};
    reader.readAsText(f);
  }});

  const pickFileBtn=h('button',{class:'btn wide',type:'button',style:{marginBottom:'12px'},onclick:()=>fileInp.click()},
    O.icon('up'),O.tr('Load from file (.md / .txt)','Загрузить из файла (.md / .txt)'));

  let modal=null;
  const saveBtn=h('button',{class:'btn pri wide',style:{marginTop:'12px'},onclick:async()=>{
    const title=titleInp.value.trim();
    const prompt=promptTa.value.trim();
    if(!title)return O.toast('Введите название джейлбрейка');
    if(!prompt)return O.toast('Введите текст инструкций');

    saveBtn.disabled=true;
    saveBtn.textContent='Публикация в сообществе...';

    const newItem={
      title,
      desc:descInp.value.trim(),
      model:selectedModel,
      prompt,
      author:getAuthorToken(),
      time:Date.now(),
      likes:0,
      dislikes:0
    };

    const saved=await O.cloudDb.syncItem('jailbreaks',newItem);
    const finalItem=Object.assign({},newItem,saved);
    if(!finalItem.id)finalItem.id='jb_'+Date.now().toString(36);

    let local=O.store.get('custom_jailbreaks',[]);
    local=local.filter(x=>x.id!==finalItem.id);
    local.unshift(finalItem);
    O.store.set('custom_jailbreaks',local);
    O.toggleJailbreak(finalItem.id);

    O.toast('Опубликовано в сообществе для всех людей!',2000);
    if(modal)modal.close();
    if(onDone)onDone();
  }},O.icon('check'),O.tr('Publish to Community','Опубликовать для всех'));

  modal=O.sheet(O.tr('New Custom Jailbreak','Опубликовать свой джейлбрейк'),h('div',null,
    pickFileBtn,fileInp,
    h('div',{class:'field'},h('label',null,O.tr('Title','Название')),titleInp),
    h('div',{class:'field'},h('label',null,O.tr('Description','Описание')),descInp),
    h('div',{class:'field'},h('label',null,O.tr('Target Model','Для какой модели')),modelPickerBtn),
    h('div',{class:'field'},h('label',null,O.tr('Prompt Instructions','Инструкции промпта')),promptTa),
    saveBtn),{hud:true,full:true});
}

function openCustomPlugins(){
  const body=h('div');
  const s=sub(O.tr('Custom Plugins','Пользовательские плагины'),body,{full:true});
  const myToken=getAuthorToken();
  const list=h('div',{class:'plugins-list'});
  let pluginQuery='';
  const searchInp=h('input',{class:'mono',placeholder:O.tr('Search plugins...','Поиск плагинов...'),autocapitalize:'off',autocorrect:'off',style:{marginBottom:'8px'},oninput:e=>{pluginQuery=e.target.value;draw()}});

  const syncEnabledPluginsToDisk=()=>{
    try{
      const enabledIds=new Set(O.store.get('enabled_plugins',[]));
      const all=O.getCustomPlugins();
      O.native.fs('mkdir',CFG+'/plugins');
      all.forEach(p=>{
        const fileSafe=(p.id||p.name).replace(/[^a-zA-Z0-9_-]/g,'_')+'.js';
        if(enabledIds.has(p.id)){
          O.native.writeText(CFG+'/plugins/'+fileSafe,p.code||'// plugin: '+p.name);
        }
      });
    }catch(_){}
  };

  const syncCloudPlugins=async(silent)=>{
    try{
      const remote=await O.cloudDb.fetchAll('plugins');
      if(remote&&Array.isArray(remote)){
        let local=O.store.get('custom_plugins',[]);
        const map=new Map();
        local.forEach(x=>{if(x&&x.id)map.set(String(x.id),x)});
        remote.forEach(r=>{
          if(r&&r.name&&r.code){
            const rId=String(r.id);
            if(map.has(rId)){
              map.set(rId,Object.assign({},map.get(rId),r));
            }else{
              let foundTemp=null;
              for(const [lid,item] of map.entries()){
                if(!/^\d+$/.test(lid)&&item.name===r.name&&item.author===r.author){
                  foundTemp=lid;
                  break;
                }
              }
              if(foundTemp){
                map.delete(foundTemp);
                map.set(rId,Object.assign({},r));
              }else{
                map.set(rId,r);
              }
            }
          }
        });
        const remoteIds=new Set(remote.map(r=>String(r.id)));
        for(const [lid,item] of map.entries()){
          if(/^\d+$/.test(lid)&&!remoteIds.has(lid)){
            map.delete(lid);
          }
        }
        O.store.set('custom_plugins',Array.from(map.values()));
        syncEnabledPluginsToDisk();
        draw();
      }
    }catch(_){}
  };
  syncCloudPlugins(true);

  const draw=()=>{
    list.textContent='';
    const q=(pluginQuery||'').toLowerCase().trim();
    const all=O.getCustomPlugins().filter(p=>!q||((p.name||'')+' '+(p.desc||'')+' '+(p.author||'')).toLowerCase().includes(q));
    const enabledIds=new Set(O.store.get('enabled_plugins',[]));

    if(!all.length){
      list.append(h('div',{class:'mut',style:{padding:'24px 16px',textAlign:'center'}},q?'Ничего не найдено по запросу «'+pluginQuery+'»':'В каталоге сообщества пока нет плагинов. Нажмите «Опубликовать плагин» ниже, чтобы добавить его для всех.'));
    }else{
      all.forEach(p=>{
        const isEnabled=enabledIds.has(p.id);
        const toggleBtn=h('button',{
          class:'btn sm '+(isEnabled?'pri':''),
          onclick:()=>{
            if(isEnabled)enabledIds.delete(p.id);else enabledIds.add(p.id);
            O.store.set('enabled_plugins',Array.from(enabledIds));
            const fileSafe=(p.id||p.name).replace(/[^a-zA-Z0-9_-]/g,'_')+'.js';
            try{
              if(!isEnabled){
                O.native.fs('mkdir',CFG+'/plugins');
                O.native.writeText(CFG+'/plugins/'+fileSafe,p.code||'// plugin: '+p.name);
              }else{
                O.native.fs('delete',CFG+'/plugins/'+fileSafe);
              }
            }catch(_){}
            O.toast(isEnabled?'Плагин выключен':'Плагин включён: '+p.name,1200);
            draw();
          }
        },isEnabled?O.tr('Enabled','Включён'):O.tr('Enable','Включить'));

        const isMine=(p.author===myToken||p.author==='local');
        const delBtn=isMine?h('button',{class:'ibtn s',title:'Удалить из сообщества',onclick:async()=>{
          if(!await O.confirm('Удалить плагин '+p.name+' из сообщества?','Это удалит его для всех пользователей.','Удалить',true))return;
          let local=O.store.get('custom_plugins',[]);
          local=local.filter(x=>x.id!==p.id);
          O.store.set('custom_plugins',local);
          const fileSafe=(p.id||p.name).replace(/[^a-zA-Z0-9_-]/g,'_')+'.js';
          try{O.native.fs('delete',CFG+'/plugins/'+fileSafe)}catch(_){}
          O.cloudDb.removeItem('plugins',p.id);
          draw();
        }},O.icon('trash')):null;

        const card=h('div',{class:'hud-dock-card',style:{padding:'12px',margin:'8px 0',display:'flex',flexDirection:'column',gap:'8px',border:isEnabled?'1px solid var(--accent)':'1px solid rgba(255,255,255,0.08)'}},
          h('div',{style:{display:'flex',alignItems:'center',justifyContent:'space-between'}},
            h('div',null,
              h('b',{style:{color:'#fff',fontSize:'14px'}},p.name),
              h('span',{class:'mut s',style:{marginLeft:'6px'}},'v'+(p.version||'1.0')),
              h('span',{class:'widget-custom-tag',style:{marginLeft:'6px',background:'rgba(56,189,248,0.15)',color:'#38bdf8'}},
                isMine?'Мой плагин':'Сообщество (для всех)')),
            h('div',{style:{display:'flex',gap:'6px',alignItems:'center'}},delBtn,toggleBtn)),
          h('div',{class:'mut s'},p.desc||''));
        list.append(card);
      });
    }
  };

  const addBtn=h('button',{class:'btn pri wide',style:{marginTop:'16px'},onclick:()=>{openUploadPluginModal(()=>{draw()})}},
    O.icon('plus'),O.tr('Upload Custom Plugin','Опубликовать свой плагин'));

  const localBtn=h('button',{class:'btn wide',style:{marginTop:'8px'},onclick:()=>{openLocalPluginEditor(()=>{draw()})}},
    O.icon('cpu'),O.tr('Local Plugin Editor (hooks: onSend/onReceive)','Локальный редактор плагинов (хуки: onSend/onReceive)'));

  const syncRow=h('div',{style:{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'12px',padding:'6px 2px'}},
    h('div',{class:'mut s'},'Облачный каталог сообщества: для всех пользователей'),
    h('div',{style:{display:'flex',gap:'8px'}},
      h('button',{class:'btn sm',type:'button',onclick:async()=>{O.toast('Синхронизация...');await syncCloudPlugins();O.toast('Синхронизировано',1200)}},O.icon('refresh'),'Обновить')
    )
  );

  body.append(
    h('div',{class:'note',style:{marginBottom:'12px'}},O.tr('Community plugins are shared with all users. All uploaded plugins are available across all devices.','Общий каталог плагинов сообщества: все загруженные плагины видны всем людям на любых устройствах.')),
    syncRow,
    searchInp,
    list,
    addBtn,
    localBtn);
  draw();
}

function openUploadPluginModal(onDone){
  const nameInp=h('input',{placeholder:'Название плагина, напр. Git Quick Sync'});
  const descInp=h('input',{placeholder:'Краткое описание работы'});
  const codeTa=h('textarea',{class:'editor',rows:8,placeholder:'// JavaScript / TypeScript код плагина\nexport default {\n  name: "custom-plugin",\n  onFinish: () => {}\n};'});

  const fileInp=h('input',{type:'file',accept:'*/*',class:'hide',onchange:e=>{
    const f=e.target.files&&e.target.files[0];
    if(!f)return;
    if(!nameInp.value)nameInp.value=f.name.replace(/\.[^.]+$/,'');
    const reader=new FileReader();
    reader.onload=ev=>{
      codeTa.value=ev.target.result;
      O.toast('Файл прочитан: '+f.name,1200);
    };
    reader.onerror=()=>{O.toast('Ошибка чтения файла')};
    reader.readAsText(f);
  }});

  const pickFileBtn=h('button',{class:'btn wide',type:'button',style:{marginBottom:'12px'},onclick:()=>fileInp.click()},
    O.icon('up'),'Загрузить файл скрипта (.js / .ts)');

  let modal=null;
  const saveBtn=h('button',{class:'btn pri wide',style:{marginTop:'12px'},onclick:async()=>{
    const name=nameInp.value.trim();
    if(!name)return O.toast('Введите название плагина');

    saveBtn.disabled=true;
    saveBtn.textContent='Публикация в сообществе...';

    const newPlug={
      name,
      desc:descInp.value.trim(),
      code:codeTa.value.trim(),
      author:getAuthorToken(),
      time:Date.now()
    };

    const saved=await O.cloudDb.syncItem('plugins',newPlug);
    const finalPlug=Object.assign({},newPlug,saved);
    if(!finalPlug.id)finalPlug.id='plug_'+Date.now().toString(36);

    let local=O.store.get('custom_plugins',[]);
    local=local.filter(x=>x.id!==finalPlug.id);
    local.unshift(finalPlug);
    O.store.set('custom_plugins',local);

    const enabledIds=new Set(O.store.get('enabled_plugins',[]));
    enabledIds.add(finalPlug.id);
    O.store.set('enabled_plugins',Array.from(enabledIds));
    const fileSafe=(finalPlug.id||finalPlug.name).replace(/[^a-zA-Z0-9_-]/g,'_')+'.js';
    try{
      O.native.fs('mkdir',CFG+'/plugins');
      O.native.writeText(CFG+'/plugins/'+fileSafe,finalPlug.code||'// plugin: '+finalPlug.name);
    }catch(_){}

    O.toast('Плагин опубликован в сообществе для всех людей!',1500);
    if(modal)modal.close();
    if(onDone)onDone();
  }},O.icon('check'),'Опубликовать для всех');

  modal=O.sheet('Опубликовать плагин в сообществе',h('div',null,
    pickFileBtn,fileInp,
    h('div',{class:'field'},h('label',null,'Название'),nameInp),
    h('div',{class:'field'},h('label',null,'Описание'),descInp),
    h('div',{class:'field'},h('label',null,'Каталог сообщества'),
      h('div',{style:{color:'#38bdf8',fontSize:'13px',fontWeight:'600',padding:'4px 0'}},'Для всех пользователей (в облачной базе)')
    ),
    h('div',{class:'field'},h('label',null,'Исходный код плагина'),codeTa),
    saveBtn),{hud:true,full:true});
}


function openLocalPluginEditor(onDone){
  const plugins=O.plugins||[];
  const list=h('div');
  function doDelete(idx){
    plugins.splice(idx,1);
    O.store.set('customPlugins',plugins);
    refresh();
  }
  const refresh=()=>{
    list.textContent='';
    if(!plugins.length){
      list.append(h('div',{class:'mut',style:{padding:'24px 16px',textAlign:'center'}},'Локальных плагинов нет. Нажмите «Создать плагин» ниже.'));
    }else{
      plugins.forEach((p,i)=>{
        const isEnabled=p.enabled;
        const card=h('div',{class:'hud-dock-card',style:{padding:'12px',margin:'8px 0',display:'flex',flexDirection:'column',gap:'8px'}},
          h('div',{style:{display:'flex',alignItems:'center',justifyContent:'space-between'}},
            h('div',null,
              h('b',{style:{color:'#fff',fontSize:'14px'}},p.name),
              h('span',{class:'mut s',style:{marginLeft:'6px'}},'v'+(p.version||'1.0')),
              h('span',{style:{marginLeft:'6px',background:'rgba(56,189,248,0.15)',color:'#38bdf8',padding:'2px 6px',borderRadius:'4px',fontSize:'11px'}},isEnabled?'Включён':'Выключен')),
            h('div',{style:{display:'flex',gap:'6px'}},
              h('button',{class:'btn sm '+(isEnabled?'':'pri'),onclick:()=>{p.enabled=!p.enabled;O.store.set('customPlugins',plugins);refresh();O.toast(p.enabled?'Плагин включён':'Плагин выключён',1000)}},p.enabled?O.tr('Disable','Выключить'):O.tr('Enable','Включить')),
              h('button',{class:'btn sm',onclick:()=>{editPlugin(i);refresh()}},O.icon('edit'),O.tr('Edit','Редактировать')),
              h('button',{class:'btn sm dng',onclick:()=>{O.confirm('Удалить плагин '+p.name+'?',null,'Удалить',true).then(function(ok){if(ok)doDelete(i)})}},O.icon('trash')))),
          h('div',{class:'mut s'},p.desc||'(без описания)'),
          h('div',{class:'editor',style:{maxHeight:'200px',overflow:'auto',fontSize:'11px',background:'#0d0d0f',padding:'8px',borderRadius:'6px',fontFamily:'monospace'}},p.code||'// plugin code here'));
        list.append(card);
      });
    }
    list.append(
      h('button',{class:'btn pri wide',style:{marginTop:'16px'},onclick:()=>{editPlugin(-1)}},O.icon('plus'),O.tr('Create Plugin','Создать плагин'))
    );
  };
  const editPlugin=idx=>{
    const isNew=idx<0;
    const p=isNew?{id:'plug_'+Date.now().toString(36),name:'',code:'',desc:'',enabled:true}:plugins[idx];
    const nameInp=h('input',{placeholder:'Название плагина',value:p.name||''});
    const descInp=h('input',{placeholder:'Описание',value:p.desc||''});
    const codeTa=h('textarea',{class:'editor',rows:12,placeholder:'// Hooks available: onSend({text,parts,model,agent}), onReceive({message,sessionID}), onLoad(O), onUnload(O)'});
    codeTa.value=p.code||'export default {\n  name: "'+p.name+'",\n  onSend: ({text,parts,model,agent}) => {\n    console.log("Sending:", text);\n  },\n  onReceive: ({message,sessionID}) => {\n    console.log("Received:", message);\n  }\n};';
    const saveBtn=h('button',{class:'btn pri wide',style:{marginTop:'12px'},onclick:()=>{
      const name=nameInp.value.trim();
      if(!name)return O.toast('Введите название');
      p.name=name;p.desc=descInp.value.trim();p.code=codeTa.value.trim();p.enabled=p.enabled!==false;
      if(isNew)plugins.push(p);else plugins[idx]=p;
      O.store.set('customPlugins',plugins);
      refresh();
      O.toast(isNew?O.tr('Plugin created','Плагин создан'):O.tr('Plugin saved','Плагин сохранён'),1200);
      editModal.close();
    }},O.icon('check'),O.tr('Save','Сохранить'));
    const editModal=O.sheet(isNew?O.tr('Create Plugin','Создать плагин'):O.tr('Edit Plugin','Редактировать плагин'),h('div',null,
      h('div',{class:'field'},h('label',null,'Название'),nameInp),
      h('div',{class:'field'},h('label',null,'Описание'),descInp),
      h('div',{class:'field'},h('label',null,'Код плагина (ES Modules)'),codeTa),
      saveBtn),{full:true});
  };
  const s=O.sheet(O.tr('Local Plugin Editor','Локальный редактор плагинов'),list,{full:true});
  refresh();
  if(onDone)onDone();
}

// Background auto-sync for all community items on app start
O.syncAllCommunity=async()=>{
  try{
    const [jbs, plugs]=await Promise.all([
      O.cloudDb.fetchAll('jailbreaks'),
      O.cloudDb.fetchAll('plugins')
    ]);
    if(Array.isArray(jbs)){
      let localJ=O.store.get('custom_jailbreaks',[]);
      const mapJ=new Map();
      localJ.forEach(x=>{if(x&&x.id)mapJ.set(String(x.id),x)});
      jbs.forEach(r=>{
        if(r&&r.title&&r.prompt){
          const k=String(r.id);
          r.likes=Number(r.likes)||0;
          r.dislikes=Number(r.dislikes)||0;
          if(mapJ.has(k))mapJ.set(k,Object.assign({},mapJ.get(k),r));
          else mapJ.set(k,r);
        }
      });
      const rIds=new Set(jbs.map(r=>String(r.id)));
      for(const [lid,item] of mapJ.entries()){
        if(!rIds.has(lid)&&item.author!=='local')mapJ.delete(lid);
      }
      O.store.set('custom_jailbreaks',Array.from(mapJ.values()));
    }
    if(Array.isArray(plugs)){
      let localP=O.store.get('custom_plugins',[]);
      const mapP=new Map();
      localP.forEach(x=>{if(x&&x.id)mapP.set(String(x.id),x)});
      plugs.forEach(r=>{
        if(r&&r.name&&r.code){
          const k=String(r.id);
          if(mapP.has(k))mapP.set(k,Object.assign({},mapP.get(k),r));
          else mapP.set(k,r);
        }
      });
      const rIdsP=new Set(plugs.map(r=>String(r.id)));
      for(const [lid,item] of mapP.entries()){
        if(!rIdsP.has(lid)&&item.author!=='local')mapP.delete(lid);
      }
      O.store.set('custom_plugins',Array.from(mapP.values()));
    }
  }catch(_){}
};
setTimeout(()=>{try{O.syncAllCommunity()}catch(_){}},1000);

})();
