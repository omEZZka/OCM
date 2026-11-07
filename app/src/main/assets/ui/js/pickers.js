(function(){
const O=window.OCM,h=O.h,S=O.S,api=O.api,bus=O.bus;
const search=(ph,fn)=>h('input',{placeholder:ph,oninput:e=>fn(e.target.value.toLowerCase()),style:{marginBottom:'8px'}});

// ---- sessions drawer ----
O.pinnedSessions=()=>O.store.get('pinned',[]);
O.isPinned=id=>O.pinnedSessions().includes(id);
O.togglePin=id=>{const l=O.pinnedSessions();const i=l.indexOf(id);if(i>=0)l.splice(i,1);else l.push(id);O.store.set('pinned',l);bus.emit('sessions');};
O.openSessions=()=>{
  const list=h('div'),q=search(O.tr('Search sessions...','Поиск по сессиям...'),()=>draw());
  const navItem=(ic,label,fn)=>h('button',{class:'drawer-nav-item',onclick:()=>{s.close();fn();}},O.icon(ic),h('span',null,label));
  const nav=h('div',{style:{marginBottom:'12px',borderBottom:'1px solid var(--line)',paddingBottom:'8px'}},
    navItem('chat',O.tr('Chat','Чат'),()=>O.setTab('chat')),
    navItem('folder',O.tr('Files','Файлы'),()=>O.setTab('files')),
    navItem('terminal',O.tr('Terminal','Терминал'),()=>O.setTab('term')),
    navItem('branch',O.tr('Changes','Изменения'),()=>O.setTab('changes')),
    navItem('sliders',O.tr('Settings','Настройки'),()=>O.openSettings()),
    navItem('refresh',O.tr('Restart server','Перезапуск сервера'),()=>restartApp()));
  const newBtn=h('button',{class:'btn pri wide',onclick:async()=>{s.close();try{await O.newSession()}catch(e){O.toast(e.message)}}},O.icon('plus'),O.tr('New session','Новая сессия'));
  const s=O.sheet(O.tr('Navigation & Sessions','Навигация и сессии'),h('div',null,nav,newBtn,h('div',{style:{height:'12px'}}),q,list),{drawer:true});
  function draw(){list.textContent='';const f=q.value.toLowerCase();
    const items=S.sessions.filter(x=>O.sessionTitle(x).toLowerCase().includes(f));
    items.sort((a,b)=>{const pa=O.isPinned(a.id)?0:1,pb=O.isPinned(b.id)?0:1;if(pa!==pb)return pa-pb;return (b.time&&b.time.updated||0)-(a.time&&a.time.updated||0)});
    if(!items.length)list.append(h('div',{class:'mut',style:{padding:'20px',textAlign:'center'}},O.tr('No sessions yet','Сессий пока нет')));
    items.forEach(x=>{const st=S.status[x.id],b=st&&st.type!=='idle',sm=x.summary,pin=O.isPinned(x.id);
      list.append(h('div',{class:'settings-row'+(x.id===S.sid?' on':'')},
        h('button',{class:'settings-row-text',onclick:()=>{s.close();O.openSession(x.id)}},
          h('b',{style:{display:'flex',alignItems:'center',gap:'6px'}},pin?O.icon('pin','pin-ic'):null,h('span',null,O.sessionTitle(x))),
          h('span',null,O.ago(x.time.updated)+(sm&&(sm.additions||sm.deletions)?'  +'+sm.additions+' -'+sm.deletions:''))),
        b?h('span',{class:'spin',style:{flex:'none'}}):null,h('button',{class:'ibtn s',style:{flex:'none'},onclick:()=>sessActions(x)},O.icon('dots'))))})}
  draw();bus.on('sessions',()=>{if(s.root.isConnected)draw()})};
async function restartApp(){
  const ok=await O.confirm(
    O.tr('Restart server?','Перезапустить сервер?'),
    O.tr('The app will close completely (killed from memory) and reopen automatically. The local server will start fresh.','Приложение полностью закроется (убьётся из памяти телефона) и откроется заново. Сервер запустится с нуля.'),
    O.tr('Restart','Перезапустить'));
  if(!ok)return;
  O.toast(O.tr('Restarting...','Перезапускаю...'),4000);
  try{OC.hardRestart()}catch(e){try{OC.restartServer()}catch(_){}}
}
function sessActions(x){O.actions(O.sessionTitle(x),[
  {label:O.isPinned(x.id)?O.tr('Unpin','Открепить'):O.tr('Pin','Закрепить'),icon:'star',fn:()=>{O.togglePin(x.id)}},
  {label:O.tr('Rename','Переименовать'),icon:'edit',fn:async()=>{const v=await O.ask(O.tr('Rename session','Переименование сессии'),null,O.sessionTitle(x));if(v)try{await api('PATCH','/session/'+x.id,{title:v})}catch(e){O.toast(e.message)}}},
  {label:x.share?O.tr('Stop sharing','Отключить шаринг'):O.tr('Share','Поделиться'),icon:'share',fn:async()=>{try{if(x.share){await api('DELETE','/session/'+x.id+'/share')}else{const r=await api('POST','/session/'+x.id+'/share',{});if(r.share){O.native.copy(r.share.url);O.native.share(r.share.url)}}}catch(e){O.toast(e.message)}}},
  {label:O.tr('Fork','Форк'),icon:'branch',fn:async()=>{try{const r=await api('POST','/session/'+x.id+'/fork',{});await O.loadSessions();O.openSession(r.id)}catch(e){O.toast(e.message)}}},
  {label:O.tr('Delete','Удалить'),icon:'trash',danger:true,fn:async()=>{if(await O.confirm(O.tr('Delete session?','Удалить сессию?'),O.sessionTitle(x),O.tr('Delete','Удалить'),true))try{await api('DELETE','/session/'+x.id);S.sessions=S.sessions.filter(y=>y.id!==x.id);if(S.sid===x.id)O.openSession(S.sessions[0]&&S.sessions[0].id||null);bus.emit('sessions')}catch(e){O.toast(e.message)}}}])}

// ---- projects + folder browser ----
O.openProjects=()=>{
  const recent=O.store.get('recent',[]),seen=new Set(),rows=[];
  const add=(p,sub)=>{if(!p||seen.has(p))return;seen.add(p);rows.push(O.listRow(O.fileIcon(O.basename(p)||'/',true),O.basename(p)||'/',p,p===S.dir?O.icon('check','ok'):null,()=>{s.close();O.setDir(p)}))};
  add(S.dir);recent.forEach(p=>add(p));(S.projects||[]).forEach(x=>add(x.worktree));add('/root');
  const s=O.sheet(O.tr('Projects','Проекты'),h('div',null,h('button',{class:'btn pri wide',onclick:()=>{s.close();O.browseDir(S.dir,p=>O.setDir(p))}},O.icon('folder'),O.tr('Open folder','Открыть папку')),h('div',{style:{height:'10px'}}),h('div',{class:'group-card'},rows)),{hud:true})};
O.browseDir=(start,cb)=>{let path=start||'/root';
  const crumbs=h('div',{class:'mono s mut',style:{wordBreak:'break-all',margin:'6px 2px'}}),list=h('div');
  const short=(l,p)=>h('button',{class:'chip',onclick:()=>{path=p;load()}},O.icon('folder'),h('span',null,l));
  const s=O.sheet(O.tr('Select folder','Выбор папки'),h('div',null,h('div',{style:{display:'flex',gap:'6px',overflowX:'auto'}},short('Home','/root'),short('SDCard','/sdcard'),short('Downloads','/sdcard/Download'),short('/','/')),crumbs,list),{full:true,
    actions:h('button',{class:'btn pri sm',onclick:()=>{s.close();cb(path)}},O.tr('Select','Выбрать'))});
  function load(){const r=O.native.ls(path);crumbs.textContent=path;list.textContent='';
    if(path!=='/')list.append(O.listRow('chevL','..',null,null,()=>{path=O.dirname(path);load()}));
    if(r.err||r.ok===false){list.append(h('div',{class:'err',style:{padding:'12px'}},r.err||'Не удаётся прочитать папку'));return}
    (r.items||[]).filter(x=>x.dir).forEach(x=>list.append(O.listRow(O.fileIcon(x.name,true),x.name,null,null,()=>{path=(path==='/'?'':path)+'/'+x.name;load()})));
    list.append(h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:async()=>{const n=await O.ask(O.tr('New folder','Новая папка'),O.tr('Name','Название'));if(!n)return;const rr=O.native.fs('mkdir',(path==='/'?'':path)+'/'+n);rr.ok?load():O.toast(rr.err||'Не удалось')}},O.icon('plus'),O.tr('New folder','Новая папка')))}
  load()};

// ---- models / agents (Screenshot 2 exact match) ----
O.openModels=()=>{
  let onlyFree=O.store.get('onlyFreeModels',true);
  let filterText='';
  const listEl=h('div');
  const q=search(O.tr('Search models...','Поиск моделей...'),v=>{filterText=v;draw()});

  const swRow=O.toggleRow('shield',
    O.tr('Only free models','Только бесплатные модели'),
    O.tr('Hide paid models requiring API balance or keys','Показывать только модели с бесплатным доступом'),
    onlyFree,
    v=>{onlyFree=v;O.store.set('onlyFreeModels',v);draw()}
  );

  let curEffort=O.store.get('effort','Default');
  const effortTxt=h('span',null,curEffort+' ›');
  const effortCard=h('button',{class:'detached-card',onclick:()=>{
    const levels=['Default','Low','Medium','High'];
    const idx=(levels.indexOf(curEffort)+1)%levels.length;
    curEffort=levels[idx];
    O.store.set('effort',curEffort);
    effortTxt.textContent=curEffort+' ›';
    O.toast(O.tr('Reasoning effort: ','Усилие рассуждений: ')+curEffort,1500);
  }},
    h('div',{class:'detached-card-left'},
      h('span',null,O.tr('Effort','Усилие')),
      h('span',{class:'recommended-badge'},O.tr('Recommended','Рекомендуется'))),
    h('div',{class:'detached-card-right'},effortTxt));

  const connectCard=h('button',{class:'detached-card',onclick:()=>{s.close();O.openConnect()}},
    h('div',{class:'detached-card-left'},
      O.icon('key'),
      h('span',{style:{marginLeft:'6px'}},O.tr('Connect more providers','Подключить провайдеров (API ключи)'))),
    h('div',{class:'detached-card-right'},'›'));

  const container=h('div',null,q,listEl,h('div',{style:{height:'10px'}}),swRow,effortCard,connectCard);
  const s=O.sheet(O.tr('Select model','Выбор модели'),container,{hud:true,full:true});

  function hiddenRow(){
    const hid=O.hiddenModels();
    const old=container.querySelector('.hidden-models-btn');
    if(old)old.remove();
    if(!hid.length)return;
    const b=h('button',{class:'btn wide hidden-models-btn',style:{marginTop:'8px'},onclick:()=>{
      O.actions(O.tr('Deleted models','Удалённые модели'),hid.map(k=>({label:k,icon:'pin',fn:()=>{O.unhideModel(k);draw()}})));
    }},O.icon('trash'),O.tr('Restore deleted models','Восстановить удалённые модели ('+hid.length+')'));
    container.append(b);
  }

  function draw(){
    listEl.textContent='';
    const all=O.allModels();
    if(!all.length){
      listEl.append(h('div',{class:'mut',style:{padding:'24px 16px',textAlign:'center'}},
        h('p',null,O.tr('No models available. Check runtime or connect a provider.','Моделей пока нет. Дождитесь запуска сервера или подключите провайдера.')),
        h('button',{class:'btn pri sm',style:{marginTop:'8px'},onclick:()=>{s.close();O.openConnect()}},O.icon('key'),O.tr('Connect provider','Подключить'))
      ));
      hiddenRow();
      return;
    }

    let items=all;
    if(onlyFree){
      items=items.filter(x=>O.isModelFree(x));
    }
    items=items.filter(x=>!O.isModelHidden(x.pid+'/'+x.mid));
    if(filterText){
      const f=filterText.toLowerCase();
      items=items.filter(x=>(x.name+' '+x.mid+' '+(x.pname||x.pid)).toLowerCase().includes(f));
    }

    if(!items.length){
      listEl.append(h('div',{class:'mut',style:{padding:'20px 16px',textAlign:'center'}},
        onlyFree
          ?O.tr('No free models found matching filter. Try disabling "Only free models" below.','Бесплатных моделей по фильтру не найдено. Попробуйте отключить пункт «Только бесплатные модели» ниже.')
          :O.tr('No models match filter.','Модели не найдены.')));
      hiddenRow();
      return;
    }

    const activeKey=S.model?(S.model.providerID+'/'+S.model.modelID):'';
    items=O.sortModelsByProvider(items);

    const rowFor=x=>{
      const key=x.pid+'/'+x.mid;
      const isSel=activeKey===key;
      const isPinned=O.isModelPinned(key);
      const isFree=O.isModelFree(x);
      const badge=h('span',{class:'badge-model '+(isFree?'badge-free':'badge-paid')},
        isFree?O.tr('Free','Бесплатно'):O.tr('Paid','Платная')
      );

      const ctx=x.m&&x.m.limit&&x.m.limit.context,parts=[];
      if(ctx)parts.push(O.fmtK(ctx)+' context');
      if(x.m&&(x.m.modalities&&x.m.modalities.includes('image')||x.m.attachment!==false))parts.push('images');
      if(x.m&&(x.m.reasoning||x.m.variants))parts.push('reasoning');
      if(!isFree&&x.m&&x.m.cost&&typeof x.m.cost.input==='number'&&x.m.cost.input>0){
        parts.push('$'+x.m.cost.input+'/1M');
      }
      const sub=parts.join(' · ');

      const row=h('button',{class:'model-row'+(isSel?' on':''),onclick:()=>{
        if(row._lpFired){row._lpFired=false;return}
        O.setModel(x.pid,x.mid);
        s.close();
        O.toast(O.tr('Selected: ','Выбрана: ')+(x.name||x.mid),1500);
      }},
        h('div',{class:'model-row-left'},
          h('div',{style:{display:'flex',alignItems:'center',gap:'6px',flexWrap:'wrap'}},
            isPinned?O.icon('pin','pin-ic'):null,
            h('span',{class:'model-row-title'},x.name||x.mid),
            badge
          ),
          sub?h('span',{class:'model-row-sub'},sub):null
        ),
        isSel?O.icon('check','model-check'):null
      );
      O.longPress(row,()=>modelActions(x,()=>draw()));
      return row;
    };

    // Recently used models float to the very top (unless a filter is active).
    if(!filterText){
      const recentKeys=O.recentModels();
      const recent=recentKeys.map(k=>items.find(x=>x.pid+'/'+x.mid===k)).filter(Boolean);
      if(recent.length){
        const card=h('div',{class:'group-card'});
        recent.forEach(x=>card.append(rowFor(x)));
        listEl.append(h('div',{class:'model-group-head'},h('span',null,O.tr('Recent','Недавние'))),card);
      }
    }

    const groups=[];
    const byPid=new Map();
    items.forEach(x=>{
      let g=byPid.get(x.pid);
      if(!g){g={pid:x.pid,pname:x.pname||x.pid,items:[]};byPid.set(x.pid,g);groups.push(g)}
      g.items.push(x);
    });

    groups.forEach(g=>{
      const head=h('div',{class:'model-group-head'},h('span',null,g.pname));
      const groupCard=h('div',{class:'group-card'});
      g.items.forEach(x=>groupCard.append(rowFor(x)));
      listEl.append(head,groupCard);
    });
    hiddenRow();
  }
  draw();
};

function modelActions(x,redraw){
  const key=x.pid+'/'+x.mid;
  const pinned=O.isModelPinned(key);
  O.actions(x.name||x.mid,[
    {label:pinned?O.tr('Unpin','Открепить'):O.tr('Pin','Закрепить'),icon:'pin',fn:()=>{O.toggleModelPin(key);redraw()}},
    {label:O.tr('Start chat in another session','Начать диалог в другой сессии'),icon:'plus',fn:async()=>{
      try{
        const ses=await O.newSession();
        O.setModel(x.pid,x.mid);
        O.setTab('chat');
        O.toast(O.tr('New session with ','Новая сессия с ')+(x.name||x.mid),1800);
      }catch(e){O.toast(e.message)}
    }},
    {label:O.tr('Delete model','Удалить модель'),icon:'trash',danger:true,fn:async()=>{
      if(await O.confirm(O.tr('Delete model?','Удалить модель?'),(x.name||x.mid)+' — '+O.tr('will be hidden from the model list','будет скрыта из списка моделей'),O.tr('Delete','Удалить'),true)){
        O.hideModel(key);
        if(S.model&&(S.model.providerID+'/'+S.model.modelID)===key){const rest=O.allModels().filter(m=>!O.isModelHidden(m.pid+'/'+m.mid)&&m.pid+'/'+m.mid!==key);if(rest.length)O.setModel(rest[0].pid,rest[0].mid)}
        redraw();
      }
    }}
  ]);
}

O.openAllModelsCatalog=()=>O.openModels();

O.openAgents=()=>{const ags=O.primaryAgents();
  const card=h('div',{class:'group-card'},ags.map(a=>h('button',{class:'model-row',onclick:()=>{O.setAgent(a.name);s.close()}},
    h('div',{class:'model-row-left'},
      h('span',{class:'model-row-title'},a.name.charAt(0).toUpperCase()+a.name.slice(1)),
      h('span',{class:'model-row-sub'},a.description||'')),
    a.name===S.agent&&!O.mmActiveId()?O.icon('check','model-check'):null)));
  const s=O.sheet(O.tr('Agents & Modes','Режимы и агенты'),h('div',null,
    h('div',{class:'settings-section-title',style:{margin:'2px 8px 6px'}},O.tr('Standard agents','Обычные агенты')),
    card,
    h('div',{class:'model-disclaimer'},O.tr('Multimodal agents are switched with the MM chip in the chat input. Custom agents and rules — in Settings → Agents & Rules.','Мультимодальные агенты переключаются чипом MM в поле ввода чата. Своих агентов и правила — в Настройки → Агенты и правила.'))),{hud:true})};

// ---- connect providers (/connect) ----
const POP=['opencode','anthropic','openai','github-copilot','google','openrouter','xai','deepseek','groq','mistral','together','fireworks','cerebras','nvidia','huggingface'];
O.openConnect=async()=>{
  const body=h('div',null,h('div',{class:'mut'},'Загрузка...'));const s=O.sheet('Подключить провайдера',body,{full:true});
  let all=[],conn=new Set(),auth={};
  try{const r=await api('GET','/provider');all=r.all||[];conn=new Set(r.connected||[]);try{auth=await api('GET','/provider/auth')}catch{}}catch(e){body.textContent=e.message;return}
  const name=p=>p.id==='opencode'?'OpenCode Zen':(p.name||p.id);
  const q=search('Поиск провайдеров',()=>draw()),list=h('div');
  const draw=()=>{list.textContent='';const f=q.value.toLowerCase();
    const sorted=[...all].sort((a,b)=>{const ca=conn.has(a.id)?0:1,cb=conn.has(b.id)?0:1;if(ca!==cb)return ca-cb;const pa=POP.indexOf(a.id),pb=POP.indexOf(b.id);return(pa<0?99:pa)-(pb<0?99:pb)||name(a).localeCompare(name(b))});
    sorted.filter(p=>!f||(name(p)+p.id).toLowerCase().includes(f)).forEach(p=>list.append(O.listRow('cloud',name(p),p.id==='opencode'?'Бесплатные модели без ключа — добавьте ключ Zen для платных':p.id,conn.has(p.id)?O.icon('check','ok'):null,()=>pick(p))))};
  body.textContent='';
  if(S.account&&S.account.email){
    body.append(O.listRow('user',S.account.email,'Аккаунт opencode подключён — квота Zen персональная',O.icon('check','ok'),()=>{s.close();O.openAccount()}));
    body.append(h('div',{class:'note',style:{margin:'10px 0'}},'Вы уже вошли. Модели OpenCode Zen работают под вашей личной квотой. Ниже можно подключить и других провайдеров своим ключом.'));
  }else{
    body.append(h('button',{class:'btn pri wide',onclick:()=>{s.close();O.openAccount()}},O.icon('user'),'Войти через Google / GitHub (аккаунт opencode)'),
      h('div',{class:'note',style:{margin:'10px 0'}},'Вход в аккаунт opencode делает квоту Zen персональной — как в opencode на компьютере. Либо подключите провайдера своим ключом ниже.'));
  }
  body.append(h('button',{class:'btn wide',style:{margin:'8px 0'},onclick:()=>O.openCustomProvider(s)},O.icon('cpu'),'Свой провайдер / Прозвон моделей'));
  body.append(q,list);draw();
  const after=async()=>{try{await api('POST','/instance/dispose',null)}catch{}await O.loadMeta();O.toast('Подключено');s.close()};
  const pick=p=>{const ms=(auth[p.id]||[]).map((m,i)=>({m,i}));if(!ms.length)ms.push({m:{type:'api',label:'API-ключ'},i:0});
    const go=x=>x.m.type==='oauth'?oauth(p,x):keyForm(p);
    if(ms.length===1&&!conn.has(p.id))return go(ms[0]);
    O.actions(name(p),[...ms.map(x=>({label:x.m.label||(x.m.type==='oauth'?'Войти':'API-ключ'),icon:x.m.type==='oauth'?'user':'key',fn:()=>go(x)})),
      conn.has(p.id)?{label:'Отключить',icon:'trash',danger:true,fn:()=>disconnect(p)}:null])};
  const keyForm=p=>{const inp=h('input',{type:'password',placeholder:'Вставьте API-ключ',autocapitalize:'off',autocorrect:'off'});
    const sh=O.sheet(name(p),h('div',null,h('div',{class:'field'},h('label',null,'API-ключ'),inp),
      p.id==='opencode'?h('div',{class:'note',style:{margin:'8px 0'}},'Получите ключ Zen на opencode.ai/zen. Бесплатные модели работают и без него.'):null,
      h('button',{class:'btn pri wide',onclick:async()=>{
        const key=inp.value.trim();if(!key)return;
        try{
          await api('PUT','/auth/'+p.id,{type:'api',key});
          if(p.id==='openrouter'||p.id==='groq'){
            try{
              const t=O.native.cfgRead();let obj={};try{if(t.trim())obj=O.parseJsonc(t)}catch{}
              obj.provider=obj.provider||{};
              if(p.id==='openrouter'){
                obj.provider.openrouter=Object.assign({
                  name:'OpenRouter',
                  npm:'@ai-sdk/openai',
                  options:{
                    baseURL:'https://openrouter.ai/api/v1',
                    apiKey:key,
                    headers:{'HTTP-Referer':'https://opencode.mobile','X-Title':'OpenCode Mobile'}
                  }
                },obj.provider.openrouter||{});
              }else if(p.id==='groq'){
                obj.provider.groq=Object.assign({
                  name:'Groq',
                  npm:'@ai-sdk/openai',
                  options:{
                    baseURL:'https://api.groq.com/openai/v1',
                    apiKey:key
                  }
                },obj.provider.groq||{});
              }
              O.native.cfgWrite(JSON.stringify(obj,null,2));
            }catch(_){}
          }
          sh.close();after();
        }catch(e){O.toast(e.message)}
      }},'Сохранить')))};
  const oauth=async(p,x)=>{const view=h('div',null,h('div',{class:'mut'},'Подготовка...'));const sh=O.sheet(name(p),view);
    try{const r=await api('POST','/provider/'+p.id+'/oauth/authorize',{method:x.i});view.textContent='';
      view.append(h('div',null,r.instructions||'Откройте ссылку и подтвердите доступ.'),h('div',{style:{display:'flex',gap:'8px',margin:'12px 0'}},
        h('button',{class:'btn pri grow',onclick:()=>O.openUrl(r.url)},O.icon('ext'),'Открыть ссылку'),h('button',{class:'btn',onclick:()=>O.native.copy(r.url)},O.icon('copy'))));
      if(r.method==='code'){const inp=h('input',{placeholder:'Вставьте код'});view.append(inp,h('button',{class:'btn pri wide',style:{marginTop:'8px'},onclick:async()=>{try{await api('POST','/provider/'+p.id+'/oauth/callback',{method:x.i,code:inp.value.trim()},{timeout:120000});sh.close();after()}catch(e){O.toast(e.message)}}},'Отправить'))}
      else{view.append(h('div',{style:{display:'flex',gap:'8px',alignItems:'center'}},h('span',{class:'spin'}),h('span',{class:'mut'},'Ожидание подтверждения...')));
        api('POST','/provider/'+p.id+'/oauth/callback',{method:x.i},{timeout:900000}).then(()=>{if(sh.root.isConnected){sh.close();after()}}).catch(e=>{if(sh.root.isConnected)O.toast(e.message)})}
    }catch(e){view.textContent=e.message}};
  const disconnect=async p=>{const r=O.native.readText('/root/.local/share/opencode/auth.json');
    try{const o=JSON.parse(r.text||'{}');delete o[p.id];const w=O.native.writeText('/root/.local/share/opencode/auth.json',JSON.stringify(o,null,2));if(!w.ok)throw new Error(w.err||'ошибка записи');
      try{await api('POST','/instance/dispose',null)}catch{}await O.loadMeta();conn.delete(p.id);draw();O.toast('Отключено')}catch(e){O.toast(e.message)}}};

// ---- status: MCP / LSP / plugins ----
O.openStatus=async()=>{
  const body=h('div'),tabs=h('div',{class:'seg',style:{marginBottom:'10px'}});const s=O.sheet('Статус',h('div',null,tabs,body));
  let mcp={},lsp=[];try{mcp=await api('GET','/mcp')}catch{}try{lsp=await api('GET','/lsp')}catch{}
  const plugins=[].concat(S.cfg&&S.cfg.plugin||[]).map(x=>Array.isArray(x)?x[0]:x);
  const defs=[['MCP',()=>{body.textContent='';const ks=Object.keys(mcp);if(!ks.length)body.append(h('div',{class:'mut'},'Серверы MCP не настроены.'));
      ks.forEach(k=>{const m=mcp[k],st=m.status;const dot=h('span',{class:'dot '+(st==='connected'?'ok':st==='failed'?'err':st==='disabled'?'':'warn')});
        body.append(O.listRow(O.icon('server'),k,st+(m.error?': '+m.error:''),dot,async()=>{try{if(st==='connected')await api('POST','/mcp/'+encodeURIComponent(k)+'/disconnect',{});else if(st==='needs_auth'){const r=await api('POST','/mcp/'+encodeURIComponent(k)+'/auth',{});if(r.authorizationUrl)O.openUrl(r.authorizationUrl)}else await api('POST','/mcp/'+encodeURIComponent(k)+'/connect',{});mcp=await api('GET','/mcp');defs[0][1]()}catch(e){O.toast(e.message)}}))});
      body.append(h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:()=>{s.close();O.openMcp()}},'Настроить серверы MCP'))}],
    ['LSP',()=>{body.textContent='';if(!lsp.length)body.append(h('div',{class:'mut'},'Языковые серверы не запущены. Они стартуют при открытии файлов.'));
      lsp.forEach(l=>body.append(O.listRow('code',l.name||l.id,l.root||'',h('span',{class:'dot '+(l.status==='connected'?'ok':'err')}))))}],
    ['Плагины ('+plugins.length+')',()=>{body.textContent='';if(!plugins.length)body.append(h('div',{class:'mut'},'Плагины не установлены.'));
      plugins.forEach(p=>body.append(O.listRow('plug',p,'',h('span',{class:'dot ok'}))));
      body.append(h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:()=>{s.close();O.openPlugins()}},'Настроить плагины'))}]];
  defs.forEach((d,i)=>tabs.append(h('button',{class:i===0?'on':'',onclick:e=>{tabs.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b===e.currentTarget));d[1]()}},d[0])));defs[0][1]()};

// ---- custom provider & model probing ----
O.openCustomProvider=parentSheet=>{
  const idInp=h('input',{placeholder:'id (латиница), напр. localai или groq'});
  const nameInp=h('input',{placeholder:'Отображаемое имя, напр. LocalAI'});
  const urlInp=h('input',{class:'mono',placeholder:'https://api.openai.com/v1 или http://127.0.0.1:11434/v1'});
  const keyInp=h('input',{type:'password',class:'mono',placeholder:'API-ключ (необязательно для Ollama/LM Studio)'});
  const statusBox=h('div',{class:'mut s',style:{margin:'8px 0'}});
  const modelList=h('div',{class:'hide',style:{maxHeight:'240px',overflowY:'auto',margin:'8px 0',border:'1px solid var(--line)',borderRadius:'8px',padding:'6px'}});
  let foundModels=[];const sel=new Set();

  const presets=h('div',{style:{display:'flex',gap:'6px',flexWrap:'wrap',marginBottom:'12px'}},
    h('button',{class:'btn sm',type:'button',onclick:()=>{idInp.value='groq';nameInp.value='Groq';urlInp.value='https://api.groq.com/openai/v1'}},'⚡ Groq'),
    h('button',{class:'btn sm',type:'button',onclick:()=>{idInp.value='openrouter';nameInp.value='OpenRouter';urlInp.value='https://openrouter.ai/api/v1'}},'🌐 OpenRouter'),
    h('button',{class:'btn sm',type:'button',onclick:()=>{idInp.value='ollama';nameInp.value='Ollama (Local)';urlInp.value='http://127.0.0.1:11434/v1'}},'🦙 Ollama'),
    h('button',{class:'btn sm',type:'button',onclick:()=>{idInp.value='together';nameInp.value='Together AI';urlInp.value='https://api.together.xyz/v1'}},'Together'));

  const probeBtn=h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:async()=>{
    let url=urlInp.value.trim().replace(/\/+$/,'');if(!url)return O.toast('Введите Base URL');
    if(!url.startsWith('http://')&&!url.startsWith('https://'))url='https://'+url;
    urlInp.value=url;const key=keyInp.value.trim();
    probeBtn.disabled=true;statusBox.textContent='Прозваниваю API...';
    try{
      let target=url.endsWith('/models')?url:(url+'/models');
      const hd={'Accept':'application/json'};if(key)hd['Authorization']='Bearer '+key;
      if(url.includes('openrouter.ai')||idInp.value==='openrouter'){
        hd['HTTP-Referer']='https://opencode.mobile';
        hd['X-Title']='OpenCode Mobile';
      }
      const resp=await fetch(target,{method:'GET',headers:hd});
      if(!resp.ok)throw new Error('HTTP '+resp.status);
      const json=await resp.json();
      const raw=Array.isArray(json)?json:(json.data||json.models||[]);
      foundModels=raw.map(m=>typeof m==='string'?m:(m.id||m.name)).filter(Boolean);
      if(!foundModels.length){statusBox.textContent='Ответ получен, но список моделей пуст.';modelList.classList.add('hide');return}
      statusBox.textContent='Найдено '+foundModels.length+' моделей:';
      modelList.textContent='';modelList.classList.remove('hide');sel.clear();
      foundModels.forEach(mid=>{sel.add(mid);
        const chk=h('input',{type:'checkbox',checked:true,style:{width:'auto',margin:'0 8px 0 0'}});
        chk.onchange=()=>{if(chk.checked)sel.add(mid);else sel.delete(mid)};
        modelList.append(h('label',{style:{display:'flex',alignItems:'center',padding:'5px 4px',fontSize:'13px',cursor:'pointer'}},chk,h('span',{class:'mono grow'},mid)))});
      O.toast('Найдено моделей: '+foundModels.length,2000);
    }catch(e){statusBox.textContent='Ошибка: '+e.message;O.toast('Ошибка прозвона: '+e.message,4000)}
    finally{probeBtn.disabled=false}}
  },O.icon('search'),'Прозвонить API (получить список моделей)');

  const saveBtn=h('button',{class:'btn pri wide',style:{marginTop:'10px'},onclick:async()=>{
    const pid=idInp.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g,'')||('custom-'+Date.now().toString(36));
    const pname=nameInp.value.trim()||pid;
    let url=urlInp.value.trim().replace(/\/+$/,'');if(!url)return O.toast('Введите Base URL');
    if(!url.startsWith('http://')&&!url.startsWith('https://'))url='https://'+url;
    const key=keyInp.value.trim();
    if(pid==='groq'||url.includes('groq.com')){
      if(!url.includes('/openai/v1'))url=url.replace(/\/+$/,'')+'/openai/v1';
    }
    const mo={};if(sel.size>0){sel.forEach(mid=>{mo[mid]={name:mid}})}else mo['default']={name:'Default Model'};
    const t=O.native.cfgRead();let obj={};try{if(t.trim())obj=O.parseJsonc(t)}catch{}
    obj.provider=obj.provider||{};
    const provOpts={baseURL:url,apiKey:key||'dummy'};
    if(pid==='openrouter'||url.includes('openrouter.ai')){
      provOpts.headers={'HTTP-Referer':'https://opencode.mobile','X-Title':'OpenCode Mobile'};
    }
    obj.provider[pid]={name:pname,npm:'@ai-sdk/openai',options:provOpts,models:mo};
    const w=O.native.cfgWrite(JSON.stringify(obj,null,2));
    if(!w.ok)return O.toast(w.err||'Ошибка записи');
    if(key)try{await api('PUT','/auth/'+pid,{type:'api',key})}catch(_){}
    try{await api('POST','/instance/dispose',null)}catch(_){}
    await O.loadMeta();O.toast('Провайдер '+pname+' подключён ('+Object.keys(mo).length+' моделей)!',3000);
    sh.close();if(parentSheet&&parentSheet.close)parentSheet.close()}
  },O.icon('check'),'Сохранить и подключить');

  const sh=O.sheet('Свой провайдер / Прозвон моделей',h('div',null,
    presets,
    h('div',{class:'field'},h('label',null,'ID провайдера (латиница)'),idInp),
    h('div',{class:'field'},h('label',null,'Отображаемое имя'),nameInp),
    h('div',{class:'field'},h('label',null,'Base URL (OpenAI-совместимый)'),urlInp),
    h('div',{class:'field'},h('label',null,'API-ключ (необязательно для локальных)'),keyInp),
    probeBtn,statusBox,modelList,saveBtn),{full:true});
};

// ---- themes / help ----
O.openThemes=()=>{const th=[['opencode','OpenCode','#0D0D0F','#fab283'],['light','Светлая','#fafaf8','#c2641c'],['tokyonight','Tokyo Night','#1a1b26','#7aa2f7'],['gruvbox','Gruvbox','#282828','#fabd2f']];
  const s=O.sheet('Оформление',h('div',null,th.map(t=>O.listRow(h('span',{style:{width:'22px',height:'22px',borderRadius:'6px',background:t[2],border:'3px solid '+t[3],flex:'none'}}),t[1],'',S.opts.theme===t[0]?O.icon('check','ok'):null,()=>{S.opts.theme=t[0];O.saveOpts();s.close()})),
    h('div',{class:'grp'},'Размер текста'),h('div',{class:'seg'},[13,14,15,16,18].map(n=>h('button',{class:S.opts.fs===n?'on':'',onclick:()=>{S.opts.fs=n;O.saveOpts();s.close()}},n)))))};
O.openHelp=()=>O.sheet('Справка',h('div',null,h('div',{class:'grp'},'Команды'),O.builtins.map(b=>O.listRow(b.i,'/'+b.n,b.d,null,()=>{O.back();b.run()})),
  h('div',{class:'grp'},'Подсказки ввода'),h('div',{class:'note'},'@файл — упомянуть файл или папку.  !команда — выполнить команду оболочки в сессии.  Долгое нажатие на файл в дереве открывает действия.')));
})();
