(function(){
const O=window.OCM,h=O.h,S=O.S,api=O.api,bus=O.bus;
const search=(ph,fn)=>h('input',{placeholder:ph,oninput:e=>fn(e.target.value.toLowerCase()),style:{marginBottom:'8px'}});

// ---- sessions drawer ----
O.sessionPending=sid=>{
  const q=(S.questions||[]).filter(x=>x.sessionID===sid).length;
  const p=(S.perms||[]).filter(x=>x.sessionID===sid).length;
  return {q,p};
};
O.pinnedSessions=()=>O.store.get('pinned',[]);
O.isPinned=id=>O.pinnedSessions().includes(id);
O.togglePin=id=>{const l=O.pinnedSessions();const i=l.indexOf(id);if(i>=0)l.splice(i,1);else l.push(id);O.store.set('pinned',l);bus.emit('sessions');};
O.openSessions=()=>{
  const list=h('div'),tagBar=h('div',{style:{display:'flex',gap:'6px',overflowX:'auto',marginBottom:'8px'}});
  const q=search(O.tr('Search sessions...','Поиск по сессиям...'),()=>draw());
  let activeTag=O.sessionTagFilter();
  const navItem=(ic,label,fn)=>h('button',{class:'drawer-nav-item',onclick:()=>{s.close();fn();}},O.icon(ic),h('span',null,label));
  const nav=h('div',{style:{marginBottom:'12px',borderBottom:'1px solid var(--line)',paddingBottom:'8px'}},
    navItem('chat',O.tr('Chat','Чат'),()=>O.setTab('chat')),
    navItem('folder',O.tr('Files','Файлы'),()=>O.setTab('files')),
    navItem('terminal',O.tr('Terminal','Терминал'),()=>O.setTab('term')),
    navItem('branch',O.tr('Changes','Изменения'),()=>O.setTab('changes')),
    navItem('down',O.tr('Import session','Импорт сессии'),()=>importSessionFile()),
    navItem('sliders',O.tr('Settings','Настройки'),()=>O.openSettings()),
    navItem('refresh',O.tr('Restart server','Перезапуск сервера'),()=>restartApp()));
  const newBtn=h('button',{class:'btn pri wide',onclick:async()=>{s.close();try{await O.newSession()}catch(e){O.toast(e.message)}}},O.icon('plus'),O.tr('New session','Новая сессия'));
  const offs=[];
  const s=O.sheet(O.tr('Navigation & Sessions','Навигация и сессии'),h('div',null,nav,newBtn,h('div',{style:{height:'12px'}}),q,tagBar,list),{drawer:true,
    onClose:()=>{offs.splice(0).forEach(f=>{try{f()}catch(_){}})}});
  function drawTags(){
    tagBar.textContent='';
    const tags=O.sessionTagList();
    const chip=(label,val)=>h('button',{class:'chip',style:activeTag===val?'border-color:var(--acc);color:var(--acc)':'',onclick:()=>{activeTag=val;O.setSessionTagFilter(val);draw()}},label);
    tagBar.append(chip(O.tr('All','Все'),''),...tags.map(t=>chip('#'+t,t)));
    tagBar.classList.toggle('hide',!tags.length);
  }
  function draw(){list.textContent='';drawTags();const f=q.value.toLowerCase();
    const items=S.sessions.filter(x=>O.sessionTitle(x).toLowerCase().includes(f)&&(!activeTag||O.sessionTag(x.id)===activeTag));
    items.sort((a,b)=>{const pa=O.isPinned(a.id)?0:1,pb=O.isPinned(b.id)?0:1;if(pa!==pb)return pa-pb;return (b.time&&b.time.updated||0)-(a.time&&a.time.updated||0)});
    if(!items.length)list.append(h('div',{class:'mut',style:{padding:'20px',textAlign:'center'}},O.tr('No sessions yet','Сессий пока нет')));
    items.forEach(x=>{const st=S.status[x.id],b=st&&st.type!=='idle',sm=x.summary,pin=O.isPinned(x.id),tag=O.sessionTag(x.id);
      const pend=O.sessionPending(x.id);
      list.append(h('div',{class:'settings-row'+(x.id===S.sid?' on':'')},
        h('button',{class:'settings-row-text',onclick:()=>{s.close();O.openSession(x.id)}},
          h('b',{style:{display:'flex',alignItems:'center',gap:'6px'}},pin?O.icon('pin','pin-ic'):null,h('span',null,O.sessionTitle(x)),x.local?h('span',{class:'mut s'},'· offline'):null),
          h('span',null,(tag?'#'+tag+'  ':'')+O.ago(x.time.updated)+(sm&&(sm.additions||sm.deletions)?'  +'+sm.additions+' -'+sm.deletions:''))),
        pend.q?h('span',{class:'sess-badge q',title:O.tr('Question pending','Ждёт ответа на вопрос')},O.icon('at'),pend.q>1?h('i',null,pend.q):null):null,
        pend.p?h('span',{class:'sess-badge p',title:O.tr('Permission pending','Ждёт разрешения')},O.icon('excl'),pend.p>1?h('i',null,pend.p):null):null,
        b?h('span',{class:'spin',style:{flex:'none'}}):null,
        x.parentID?h('span',{class:'sess-badge sub',title:O.tr('Subagent session','Сессия субагента')},O.icon('bot')):null,
        h('button',{class:'ibtn s',style:{flex:'none'},onclick:()=>sessActions(x)},O.icon('dots'))))})}
  draw();offs.push(bus.on('sessions',()=>{if(s.root.isConnected)draw()}),bus.on('perm',()=>{if(s.root.isConnected)draw()}))};
function importSessionFile(){
  const inp=h('input',{type:'file',accept:'application/json,.json,.ocmjson',style:{display:'none'}});
  inp.onchange=()=>{const f=inp.files&&inp.files[0];if(!f)return;const r=new FileReader();
    r.onload=()=>{try{const s=O.importSessionJson(String(r.result));O.toast('Импортировано: '+s.title,2200);O.openSession(s.id)}catch(e){O.toast(e.message,4000)}inp.remove()};
    r.onerror=()=>{O.toast('Не удалось прочитать файл',3000);inp.remove()};r.readAsText(f)};
  document.body.append(inp);inp.click();
}
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
  {label:O.sessionTag(x.id)?('#'+O.sessionTag(x.id)+' · '+O.tr('change folder/tag','сменить папку/тег')):O.tr('Folder / tag','Папка / тег'),icon:'folder',fn:async()=>{
    const cur=O.sessionTag(x.id);
    const tags=O.sessionTagList();
    const opts=tags.filter(t=>t!==cur).map(t=>({label:'#'+t,icon:'folder',fn:()=>O.setSessionTag(x.id,t)}));
    opts.push({label:O.tr('Set custom tag...','Задать свой тег...'),icon:'edit',fn:async()=>{const v=await O.ask(O.tr('Folder / tag','Папка / тег'),O.tr('For example: Work','Например: Работа'),cur);if(v!=null)O.setSessionTag(x.id,v)}});
    if(cur)opts.push({label:O.tr('Remove tag','Убрать тег'),icon:'x',fn:()=>O.setSessionTag(x.id,'')});
    O.actions(O.tr('Folder / tag','Папка / тег'),opts);
  }},
  {label:O.tr('Rename','Переименовать'),icon:'edit',fn:async()=>{const v=await O.ask(O.tr('Rename session','Переименование сессии'),null,O.sessionTitle(x));if(!v)return;if(x.local){x.title=v;O.saveLocalSession(x);bus.emit('sessions');return}try{await api('PATCH','/session/'+x.id,{title:v})}catch(e){O.toast(e.message)}}},
  {label:O.tr('Export session (JSON)','Экспорт сессии (JSON)'),icon:'down',fn:()=>{
    const json=O.exportSessionJson(x.id);
    O.actions(O.tr('Export session (JSON)','Экспорт сессии (JSON)'),[
      {label:O.tr('Copy JSON','Скопировать JSON'),icon:'copy',fn:()=>O.native.copy(json)},
      {label:O.tr('Share','Поделиться'),icon:'share',fn:()=>{if(O.native&&O.native.share)O.native.share(json);else O.native.copy(json)}}]);
  }},
  {label:x.share?O.tr('Stop sharing','Отключить шаринг'):O.tr('Share','Поделиться'),icon:'share',fn:async()=>{try{if(x.share){await api('DELETE','/session/'+x.id+'/share')}else{const r=await api('POST','/session/'+x.id+'/share',{});if(r.share){O.native.copy(r.share.url);O.native.share(r.share.url)}}}catch(e){O.toast(e.message)}}},
  {label:O.tr('Fork','Форк'),icon:'branch',fn:async()=>{try{const r=await api('POST','/session/'+x.id+'/fork',{});await O.loadSessions();O.openSession(r.id)}catch(e){O.toast(e.message)}}},
  {label:O.tr('Compact context','Сжать контекст'),icon:'refresh',fn:async()=>{
    if(!S.model)return O.toast(O.tr('No model selected','Модель не выбрана'));
    const doCompact=await O.confirm(O.tr('Compact session?','Сжать сессию?'),O.tr('This will summarize the conversation to free up context.','Это сожмёт диалог для освобождения контекста.'),O.tr('Compact','Сжать'));
    if(doCompact){
      try{await api('POST','/session/'+x.id+'/summarize',{providerID:S.model.providerID,modelID:S.model.modelID},{timeout:600000});O.toast(O.tr('Session compacted','Сессия сжата'),1500)}catch(e){O.toast(e.message)}
    }
  }},
  {label:O.tr('Delete','Удалить'),icon:'trash',danger:true,fn:async()=>{if(!await O.confirm(O.tr('Delete session?','Удалить сессию?'),O.sessionTitle(x),O.tr('Delete','Удалить'),true))return;
    if(x.local){O.removeLocalSession(x.id);if(S.sid===x.id)O.openSession(S.sessions[0]&&S.sessions[0].id||null);return}
    try{await api('DELETE','/session/'+x.id);S.sessions=S.sessions.filter(y=>y.id!==x.id);if(S.sid===x.id)O.openSession(S.sessions[0]&&S.sessions[0].id||null);bus.emit('sessions')}catch(e){O.toast(e.message)}}}])}

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

  let providerFilter='';
  const provBar=h('div',{style:{display:'flex',gap:'6px',overflowX:'auto',marginBottom:'8px'}});
  const bulkRow=h('div',{style:{display:'flex',gap:'6px',marginTop:'8px',flexWrap:'wrap'}});
  const profNames=Object.keys(O.modelProfiles());
  const profBar=h('div',{style:{display:'flex',gap:'6px',overflowX:'auto',marginBottom:'8px'}});
  if(profNames.length){
    profBar.append(h('span',{class:'mut s',style:{alignSelf:'center'}},O.tr('Profiles','Профили')+':'));
    profNames.forEach(n=>profBar.append(h('button',{class:'chip',onclick:()=>{O.applyModelProfile(n);draw()}},O.icon('star'),h('span',null,n))));
  }
  const folderBtn=h('button',{class:'btn wide',style:{margin:'0 0 8px'},onclick:()=>O.openModelFolders(()=>draw())},O.icon('folder'),O.tr('Folders & profiles','Папки и профили'));
  const compareBtn=h('button',{class:'btn wide',style:{margin:'0 0 8px'},onclick:()=>O.openModelCompare()},O.icon('branch'),O.tr('Compare models on one prompt','Сравнить модели на одном запросе'));
  const container=h('div',null,q,profBar,folderBtn,compareBtn,provBar,listEl,h('div',{style:{height:'10px'}}),bulkRow,swRow,effortCard,connectCard);
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

  function drawBulk(items){
    bulkRow.textContent='';
    const add=(label,fn)=>bulkRow.append(h('button',{class:'chip',onclick:fn},label));
    add(O.tr('Bulk actions','Массово'),()=>{
      const visible=items||[];
      const paid=O.allModels().filter(x=>!O.isModelFree(x));
      const hidden=O.hiddenModels();
      O.actions(O.tr('Bulk actions','Массово'),[
        {label:O.tr('Hide all paid models','Скрыть все платные')+' ('+paid.length+')',icon:'eye',fn:()=>{paid.forEach(x=>O.hideModel(x.pid+'/'+x.mid));draw()}},
        {label:O.tr('Pin all visible','Закрепить все видимые')+' ('+visible.length+')',icon:'pin',fn:()=>{visible.forEach(x=>{const k=x.pid+'/'+x.mid;if(!O.isModelPinned(k))O.toggleModelPin(k)});draw()}},
        {label:O.tr('Unpin everything','Открепить все'),icon:'x',fn:()=>{O.store.set('pinnedModels',[]);bus.emit('meta');draw()}},
        {label:O.tr('Restore hidden models','Восстановить скрытые')+' ('+hidden.length+')',icon:'trash',fn:()=>{O.store.set('hiddenModels',[]);bus.emit('meta');draw()}}
      ]);
    });
    if(providerFilter)add('× '+providerFilter,()=>{providerFilter='';draw()});
  }
  function drawProviders(all){
    provBar.textContent='';
    const pids=[...new Set(all.map(x=>x.pid))];
    if(pids.length<2){provBar.classList.add('hide');return}
    provBar.classList.remove('hide');
    const chip=(label,val)=>h('button',{class:'chip',style:providerFilter===val?'border-color:var(--acc);color:var(--acc)':'',onclick:()=>{providerFilter=val;draw()}},label);
    provBar.append(chip(O.tr('All providers','Все провайдеры'),''),...pids.map(pid=>{const p=all.find(x=>x.pid===pid);return chip(p&&p.pname||pid,pid)}));
  }
  function draw(){
    listEl.textContent='';
    const all=O.allModels();
    drawProviders(all);
    if(!all.length){
      listEl.append(h('div',{class:'mut',style:{padding:'24px 16px',textAlign:'center'}},
        h('p',null,O.tr('No models available. Check runtime or connect a provider.','Моделей пока нет. Дождитесь запуска сервера или подключите провайдера.')),
        h('button',{class:'btn pri sm',style:{marginTop:'8px'},onclick:()=>{s.close();O.openConnect()}},O.icon('key'),O.tr('Connect provider','Подключить'))
      ));
      drawBulk([]);
      hiddenRow();
      return;
    }

    let items=all;
    if(onlyFree){
      items=items.filter(x=>O.isModelFree(x));
    }
    items=items.filter(x=>!O.isModelHidden(x.pid+'/'+x.mid));
    if(providerFilter)items=items.filter(x=>x.pid===providerFilter);
    if(filterText){
      const f=filterText.toLowerCase();
      items=items.filter(x=>(x.name+' '+x.mid+' '+(x.pname||x.pid)).toLowerCase().includes(f));
    }

    if(!items.length){
      listEl.append(h('div',{class:'mut',style:{padding:'20px 16px',textAlign:'center'}},
        onlyFree
          ?O.tr('No free models found matching filter. Try disabling "Only free models" below.','Бесплатных моделей по фильтру не найдено. Попробуйте отключить пункт «Только бесплатные модели» ниже.')
          :O.tr('No models match filter.','Модели не найдены.')));
      drawBulk([]);
      hiddenRow();
      return;
    }

    const activeKey=S.model?(S.model.providerID+'/'+S.model.modelID):'';
    items=O.sortModelsByProvider(items);
    drawBulk(items);

    const rowFor=x=>{
      const key=x.pid+'/'+x.mid;
      const isSel=activeKey===key;
      const isPinned=O.isModelPinned(key);
      const isFree=O.isModelFree(x);
      const badge=h('span',{class:'badge-model '+(isFree?'badge-free':'badge-paid')},
        isFree?O.tr('Free','Бесплатно'):O.tr('Paid','Платная')
      );

      const ctx=x.m&&x.m.limit&&x.m.limit.context,parts=[];
      // provider first: several providers expose models with identical names (e.g. "gpt-4o"),
      // so the list was impossible to navigate without it
      const provName=x.pname||(x.pid==='opencode'?'OpenCode Zen':x.pid);
      parts.push(provName);
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

    // ---- user folders (pinned folders float; their models are removed from the flat list) ----
    const folders=O.modelFolders();
    const inFolder=new Set();
    folders.forEach(f=>(f.keys||[]).forEach(k=>inFolder.add(k)));
    const sortedFolders=[...folders].sort((a,b)=>{
      const pa=O.isModelFolderPinned(a.id)?0:1,pb=O.isModelFolderPinned(b.id)?0:1;
      if(pa!==pb)return pa-pb;
      return (a.order||0)-(b.order||0)||String(a.name).localeCompare(String(b.name));
    });
    sortedFolders.forEach(f=>{
      const members=(f.keys||[]).map(k=>items.find(x=>x.pid+'/'+x.mid===k)).filter(Boolean);
      if(!members.length&&filterText)return;
      const pinnedF=O.isModelFolderPinned(f.id);
      const head=h('div',{class:'model-group-head',style:{display:'flex',alignItems:'center',gap:'6px'}},
        O.icon(pinnedF?'pin':'folder',pinnedF?'pin-ic':''),
        h('span',{class:'grow'},f.name+' ('+members.length+')'));
      const card=h('div',{class:'group-card'});
      if(members.length)members.forEach(x=>card.append(rowFor(x)));
      else card.append(h('div',{class:'mut s',style:{padding:'10px 12px'}},O.tr('Empty folder. Long-press a model → Add to folder.','Папка пуста. Долгое нажатие на модель → Добавить в папку.')));
      listEl.append(head,card);
    });

    // Pinned models — always at the very top (unless a filter is active).
    if(!filterText){
      const pinnedKeys=O.pinnedModels();
      const pinned=pinnedKeys.map(k=>items.find(x=>x.pid+'/'+x.mid===k)).filter(Boolean);
      if(pinned.length){
        const card=h('div',{class:'group-card'});
        pinned.forEach(x=>card.append(rowFor(x)));
        listEl.append(h('div',{class:'model-group-head'},h('span',null,O.tr('Pinned','Закрепленные'))),card);
      }
    }

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
      if(filterText&&inFolder.has(x.pid+'/'+x.mid))return; // filtered search shows folder hits above
      if(inFolder.has(x.pid+'/'+x.mid))return;               // already listed inside its folder
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
  const folder=O.modelFolderOf(key);
  const folders=O.modelFolders();
  const folderItems=[
    {label:folder?O.tr('Move to another folder…','Переместить в другую папку…'):O.tr('Add to folder…','Добавить в папку…'),icon:'folder',fn:()=>{
      const items=folders.filter(f=>f.id !== (folder&&folder.id)).map(f=>({label:f.name,icon:'folder',fn:()=>O.addModelToFolder(key,f.id)&&redraw()}));
      items.push({label:O.tr('New folder…','Новая папка…'),icon:'plus',fn:async()=>{
        const n=await O.ask(O.tr('New folder','Новая папка'),O.tr('Folder name','Название папки'));
        if(!n)return;const f=O.createModelFolder(n);O.addModelToFolder(key,f.id);redraw();
      }});
      if(folder)items.push({label:O.tr('Remove from folder','Убрать из папки'),icon:'x',fn:()=>{O.removeModelFromFolder(key,folder.id);redraw()}});
      O.actions(folder?folder.name:O.tr('Folder','Папка'),items);
    }},
    {label:O.tr('Manage folders…','Управление папками…'),icon:'sliders',fn:()=>O.openModelFolders(redraw)},
    {label:O.tr('Create model profile here','Сделать профилем модели'),icon:'star',fn:()=>O.openModelProfiles(redraw)}
  ];
  O.actions(x.name||x.mid,[
    {label:pinned?O.tr('Unpin','Открепить'):O.tr('Pin','Закрепить'),icon:'pin',fn:()=>{O.toggleModelPin(key);redraw()}},
    ...folderItems,
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

// ---- model folders & profiles ----
O.openModelFolders=(onDone)=>{
  const body=h('div');
  const s=O.sheet(O.tr('Model folders','Папки моделей'),body,{full:true,onClose:()=>{onDone&&onDone()}});
  const draw=()=>{
    body.textContent='';
    const folders=O.modelFolders();
    body.append(h('div',{class:'note'},O.tr('Folders group models across providers. Pinned folders float to the top of the model list; a model belongs to one folder.','Папки объединяют модели разных провайдеров. Закреплённые папки поднимаются в начало списка моделей; модель может быть только в одной папке.')));
    if(!folders.length)body.append(h('div',{class:'mut',style:{padding:'12px'}},O.tr('No folders yet','Папок пока нет')));
    folders.sort((a,b)=>(a.order||0)-(b.order||0)).forEach((f,i)=>{
      const pinnedF=O.isModelFolderPinned(f.id);
      body.append(h('div',{class:'settings-row'},
        h('button',{class:'settings-row-icon',style:{background:'transparent',border:'none',padding:0},onclick:()=>{O.toggleModelFolderPin(f.id);draw()}},O.icon(pinnedF?'pin':'folder',pinnedF?'pin-ic':'')),
        h('div',{class:'settings-row-text'},h('b',null,f.name),h('span',null,(f.keys||[]).length+' '+O.tr('models','моделей')+(pinnedF?' · '+O.tr('pinned','закреплена'):''))),
        h('button',{class:'ibtn s',title:O.tr('Up','Вверх'),onclick:()=>{O.moveModelFolder(f.id,-1);draw()}},O.icon('chevD')),
        h('button',{class:'ibtn s',title:O.tr('Rename','Переименовать'),onclick:async()=>{const v=await O.ask(O.tr('Rename folder','Переименование папки'),null,f.name);if(v){O.renameModelFolder(f.id,v);draw()}}},O.icon('edit')),
        h('button',{class:'ibtn s',title:O.tr('Delete','Удалить'),onclick:async()=>{if(await O.confirm(O.tr('Delete folder?','Удалить папку?'),f.name,O.tr('Delete','Удалить'),true)){O.deleteModelFolder(f.id);draw()}}},O.icon('trash'))));
    });
    body.append(h('button',{class:'btn pri wide',style:{marginTop:'12px'},onclick:async()=>{
      const n=await O.ask(O.tr('New folder','Новая папка'),O.tr('Folder name','Название папки'));
      if(!n)return;O.createModelFolder(n);draw();
    }},O.icon('plus'),O.tr('New folder','Новая папка')),
    h('button',{class:'btn wide',style:{marginTop:'8px'},onclick:()=>{s.close();O.openModelAssign()}},O.icon('check'),O.tr('Assign models to folders','Разложить модели по папкам')));
    body.append(h('div',{class:'grp',style:{marginTop:'16px'}},O.tr('Profiles','Профили')));
    body.append(h('div',{class:'note'},O.tr('A profile stores one main model plus its fallback chain, e.g. "fast" vs "quality".','Профиль хранит основную модель и цепочку резервных, например «быстро» и «качественно».')));
    const profs=O.modelProfiles();
    Object.keys(profs).forEach(name=>{
      const p=profs[name];
      body.append(h('div',{class:'settings-row'},
        h('div',{class:'settings-row-icon purple'},O.icon('star')),
        h('div',{class:'settings-row-text'},h('b',null,name),h('span',null,(p.main||'')+(p.fallbacks&&p.fallbacks.length?'  +'+(p.fallbacks.length)+' fallback':''))),
        h('button',{class:'btn sm',onclick:()=>{O.applyModelProfile(name);s.close()}},O.tr('Apply','Применить')),
        h('button',{class:'ibtn s',onclick:()=>{O.setModelProfile(name,null);draw()}},O.icon('trash'))));
    });
    body.append(h('button',{class:'btn wide',style:{marginTop:'8px'},onclick:async()=>{
      const name=await O.ask(O.tr('Profile name','Название профиля'),O.tr('e.g. fast, quality','например: быстро, качество'));
      if(!name)return;
      if(!S.model)return O.toast(O.tr('Select a model first','Сначала выберите модель'),2500);
      O.setModelProfile(name.trim(),{main:S.model.providerID+'/'+S.model.modelID,fallbacks:O.fallbackModels().slice(0,5)});
      O.toast(O.tr('Profile saved','Профиль сохранён'),1800);draw();
    }},O.icon('plus'),O.tr('Save current model as profile','Сохранить текущую модель как профиль')));
  };
  draw();
};
O.openModelProfiles=redraw=>O.openModelFolders(redraw);

// Auto-suggest a model for the current prompt (code / images / long context / cheap).
O.suggestModel=text=>{
  const t=String(text||'').toLowerCase();
  const all=O.allModels().filter(x=>!O.isModelHidden(x.pid+'/'+x.mid));
  if(!all.length)return null;
  const hasImg=/(скриншот|картинк|изображен|фото|screenshot|image|png|jpg|ui-?kit|макет)/.test(t);
  const wantsCheap=/(быстро|дешев|cheap|fast|черновик|draft)/.test(t);
  const wantsBig=/(рефактор|архитектур|весь проект|refactor|whole repo|перепиши|мигрир)/.test(t)||t.length>1200;
  const score=x=>{
    let s=0;
    const m=x.m||{};
    const ctx=(m.limit&&m.limit.context)||0;
    if(hasImg&&(m.modalities&&m.modalities.includes('image')))s+=60;
    if(hasImg&&!(m.modalities&&m.modalities.includes('image')))s-=40;
    if(wantsBig&&ctx)s+=Math.min(40,ctx/50000);
    if(wantsCheap&&O.isModelFree(x))s+=45;
    if(wantsCheap&&m.cost&&m.cost.input>0)s-=30;
    if(m.reasoning||m.variants)s+=8;
    if(O.isModelFree(x))s+=6;
    return s;
  };
  const best=[...all].sort((a,b)=>score(b)-score(a))[0];
  return best&&score(best)>0?best:null;
};

// Bulk assignment: tap a model to cycle its folder, with a folder picker per tap.
O.openModelAssign=()=>{
  const body=h('div');
  const s=O.sheet(O.tr('Assign models','Разложить модели'),body,{full:true});
  const draw=()=>{
    body.textContent='';
    const folders=O.modelFolders();
    const all=O.allModels().filter(x=>!O.isModelHidden(x.pid+'/'+x.mid));
    if(!folders.length){body.append(h('div',{class:'note'},O.tr('Create a folder first in Model folders.','Сначала создайте папку в разделе «Папки моделей».')));return}
    const q=h('input',{placeholder:O.tr('Filter models...','Фильтр моделей...')});
    const list=h('div');
    body.append(q,list);
    const render=()=>{
      list.textContent='';
      const f=(q.value||'').toLowerCase();
      all.filter(x=>!f||(x.name+' '+x.mid+' '+(x.pname||x.pid)).toLowerCase().includes(f)).forEach(x=>{
        const key=x.pid+'/'+x.mid, cur=O.modelFolderOf(key);
        list.append(h('button',{class:'model-row',onclick:()=>{
          O.actions(x.name||x.mid,[...folders.map(fo=>({label:fo.name,icon:'folder',fn:()=>{O.addModelToFolder(key,fo.id);draw()}})),
            cur?{label:O.tr('Remove from folder','Убрать из папки'),icon:'x',fn:()=>{O.removeModelFromFolder(key,cur.id);draw()}}:null]);
        }},
          h('div',{class:'model-row-left'},
            h('span',{class:'model-row-title'},x.name||x.mid),
            h('span',{class:'model-row-sub'},(x.pname||x.pid)+(cur?' → '+cur.name:' · '+O.tr('no folder','без папки')))),
          cur?O.icon('folder'):null));
      });
    };
    q.addEventListener('input',render);render();
  };
  draw();
};

// Run the same prompt on 2–3 models in parallel and show the answers side by side.
O.openModelCompare=()=>{
  const body=h('div');
  const s=O.sheet(O.tr('Compare models','Сравнение моделей'),body,{full:true});
  const chosen=new Set();
  const promptInp=h('textarea',{rows:4,placeholder:O.tr('Prompt to send to every model…','Запрос, который уйдёт во все модели…')});
  const status=h('div',{class:'mut s',style:{margin:'8px 0'}});
  const results=h('div');
  const list=h('div',{style:{maxHeight:'38vh',overflow:'auto',border:'1px solid var(--line)',borderRadius:'10px',padding:'4px'}});
  const all=O.allModels().filter(x=>!O.isModelHidden(x.pid+'/'+x.mid));
  all.forEach(x=>{
    const key=x.pid+'/'+x.mid;
    const row=h('button',{class:'model-row',onclick:()=>{
      if(chosen.has(key))chosen.delete(key);else if(chosen.size<3)chosen.add(key);
      row.classList.toggle('on',chosen.has(key));
    }},
      h('div',{class:'model-row-left'},
        h('span',{class:'model-row-title'},x.name||x.mid),
        h('span',{class:'model-row-sub'},(x.pname||x.pid))),
      chosen.has(key)?O.icon('check','model-check'):null);
    if(S.model&&key===S.model.providerID+'/'+S.model.modelID){chosen.add(key);row.classList.add('on')}
    list.append(row);
  });
  const runBtn=h('button',{class:'btn pri wide',style:{marginTop:'8px'},onclick:async()=>{
    const text=promptInp.value.trim();
    if(!text)return O.toast(O.tr('Enter a prompt','Введите запрос'),2000);
    if(chosen.size<1)return O.toast(O.tr('Pick at least one model','Выберите хотя бы одну модель'),2000);
    runBtn.disabled=true;results.textContent='';status.textContent=O.tr('Running…','Выполняю…');
    const keys=[...chosen];
    const cols=keys.map(k=>{
      const i=k.indexOf('/'),pid=k.slice(0,i),mid=k.slice(i+1);
      const col=h('div',{class:'card',style:{flex:'1 1 320px',minWidth:'260px',padding:'10px'}},
        h('b',{style:{fontSize:'12px'}},pid+'/'+mid),
        h('div',{class:'mut s',style:{margin:'6px 0'}},'…'),
        h('pre',{class:'term-pre',style:{whiteSpace:'pre-wrap',maxHeight:'none',margin:0}},''));
      results.append(col);
      return {k,col,pid,mid,out:col.querySelector('pre'),meta:col.querySelector('.mut')};
    });
    const t0=Date.now();
    await Promise.all(cols.map(async c=>{
      try{
        // A throwaway session per model keeps the comparison out of the user's history.
        const ses=await O.api('POST','/session',{title:'Compare · '+(c.mid)});
        await O.api('POST','/session/'+ses.id+'/prompt_async',{messageID:O.mid(),agent:S.agent,model:{providerID:c.pid,modelID:c.mid},parts:[{type:'text',text}]},{timeout:30000});
        // poll until idle, then read the final assistant text
        const deadline=Date.now()+180000;
        while(Date.now()<deadline){
          await new Promise(r=>setTimeout(r,1200));
          const st=await O.api('GET','/session/status',null,{timeout:5000,cache:false}).catch(()=>null);
          const x=st&&st[ses.id],t=typeof x==='string'?x:(x&&x.type);
          if(!t||t==='idle'||t==='error')break;
        }
        const arr=await O.api('GET','/session/'+ses.id+'/message',null,{timeout:20000,cache:false});
        let txt='';for(const m of arr||[])if(m.info&&m.info.role==='assistant'){const t2=(m.parts||[]).filter(p=>p.type==='text').map(p=>p.text).join('\n');if(t2.trim())txt=t2}
        c.out.textContent=txt||O.tr('(no answer)','(нет ответа)');
        c.meta.textContent=((Date.now()-t0)/1000).toFixed(1)+'s · '+O.fmtK((txt||'').length)+' chars';
        try{await O.api('DELETE','/session/'+ses.id)}catch(_){}
      }catch(e){c.out.textContent=String(e.message||e);c.meta.textContent=O.tr('error','ошибка')}
    }));
    status.textContent=O.tr('Done','Готово');runBtn.disabled=false;
  }},O.icon('play'),O.tr('Run on selected','Запустить на выбранных'));
  body.append(h('div',{class:'note'},O.tr('Answers run in temporary sessions and are deleted afterwards. Pick up to 3 models.','Ответы выполняются во временных сессиях и затем удаляются. Выберите до 3 моделей.')),
    promptInp,list,runBtn,status,results);
};

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
  // provider health snapshot shows a dot next to each provider that has a recent check
  const health=O.providerHealth?O.providerHealth():null;
  const healthOf=pid=>{
    const it=health&&health.items&&health.items[pid];
    if(!it)return null;
    return it.ok?'ok':'bad';
  };
  const q=search('Поиск провайдеров',()=>draw()),list=h('div');
  const draw=()=>{list.textContent='';const f=q.value.toLowerCase();
    const sorted=[...all].sort((a,b)=>{const ca=conn.has(a.id)?0:1,cb=conn.has(b.id)?0:1;if(ca!==cb)return ca-cb;const pa=POP.indexOf(a.id),pb=POP.indexOf(b.id);return(pa<0?99:pa)-(pb<0?99:pb)||name(a).localeCompare(name(b))});
    sorted.filter(p=>!f||(name(p)+p.id).toLowerCase().includes(f)).forEach(p=>{
      const hs=healthOf(p.id);
      const right=h('span',{style:{display:'flex',alignItems:'center',gap:'6px'}},
        hs?h('i',{title:hs==='ok'?O.tr('Connected models found','Модели найдены'):O.tr('No models / check failed','Нет моделей / проверка не удалась'),
          style:{width:'7px',height:'7px',borderRadius:'50%',background:hs==='ok'?'#22c55e':'#ef4444'}}):null,
        conn.has(p.id)?O.icon('check','ok'):null);
      list.append(O.listRow('cloud',name(p),p.id==='opencode'?'Бесплатные модели без ключа — добавьте ключ Zen для платных':p.id,right,()=>pick(p)));
    })};
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
  if(O.checkProviders)O.checkProviders(false);
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
    h('button',{class:'btn sm',type:'button',onclick:()=>{idInp.value='groq';nameInp.value='Groq';urlInp.value='https://api.groq.com/openai/v1'}},O.icon('zap'),'Groq'),
    h('button',{class:'btn sm',type:'button',onclick:()=>{idInp.value='openrouter';nameInp.value='OpenRouter';urlInp.value='https://openrouter.ai/api/v1'}},O.icon('globe'),'OpenRouter'),
    h('button',{class:'btn sm',type:'button',onclick:()=>{idInp.value='ollama';nameInp.value='Ollama (Local)';urlInp.value='http://127.0.0.1:11434/v1'}},O.icon('llama'),'Ollama'),
    h('button',{class:'btn sm',type:'button',onclick:()=>{idInp.value='together';nameInp.value='Together AI';urlInp.value='https://api.together.xyz/v1'}},'Together'),
    h('button',{class:'btn sm',type:'button',onclick:()=>{idInp.value='lmstudio';nameInp.value='LM Studio';urlInp.value='http://127.0.0.1:1234/v1';keyInp.value=''}},O.icon('laptop'),'LM Studio'),
    h('button',{class:'btn sm',type:'button',onclick:()=>{idInp.value='llamacpp';nameInp.value='llama.cpp';urlInp.value='http://127.0.0.1:8080/v1';keyInp.value=''}},O.icon('cpu'),'llama.cpp'));

  // One-tap local model server inside the proot runtime: downloads nothing, uses the model path the
  // user already has and explains exactly which command it runs.
  const localBar=h('div',{class:'note',style:{margin:'4px 0 12px'}},
    h('div',null,O.tr('Local model in the built-in Linux runtime:','Локальная модель во встроенном Linux-окружении:')),
    h('div',{class:'mono s',style:{wordBreak:'break-all',marginTop:'4px'}},'llama-server -m /root/models/model.gguf --port 8080 --host 127.0.0.1'),
    h('div',{style:{display:'flex',gap:'6px',marginTop:'8px',flexWrap:'wrap'}},
      h('button',{class:'btn sm',type:'button',onclick:()=>{
        // start llama.cpp in the term panel; the user pastes the command once
        O.setTab('term');
        setTimeout(()=>O.termRun&&O.termRun('llama-server -m /root/models/model.gguf --port 8080 --host 127.0.0.1'),250);
      }},O.icon('terminal'),O.tr('Run in Terminal','Запустить в терминале')),
      h('button',{class:'btn sm',type:'button',onclick:()=>{
        idInp.value='llamacpp';nameInp.value='llama.cpp (local)';urlInp.value='http://127.0.0.1:8080/v1';keyInp.value='';
      }},O.icon('check'),O.tr('Use as provider','Использовать как провайдера'))));

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
    let shim='';try{shim=OC.shimUrl?OC.shimUrl():''}catch(_){}
    if(shim&&!url.includes('127.0.0.1')&&!url.includes('localhost')){
      provOpts.baseURL=shim+'/v1';
      provOpts.upstreamBaseURL=url;
    }
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
    presets,localBar,
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
