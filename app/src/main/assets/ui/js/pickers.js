(function(){
const O=window.OCM,h=O.h,S=O.S,api=O.api,bus=O.bus;
const search=(ph,fn)=>h('input',{placeholder:ph,oninput:e=>fn(e.target.value.toLowerCase()),style:{marginBottom:'8px'}});

// ---- sessions drawer ----
O.sessionPending=sid=>{
  const q=(S.questions||[]).filter(x=>x.sessionID===sid).length;
  const p=(S.perms||[]).filter(x=>x.sessionID===sid).length;
  return {q,p};
};
// "Working set": sessions the user marked as active work. They get a badge and float above the rest.
O.workSessions=()=>O.store.get('workSessions',[]);
O.isWorkSession=id=>O.workSessions().includes(id);
O.toggleWorkSession=id=>{
  const l=O.workSessions();const i=l.indexOf(id);
  if(i>=0)l.splice(i,1);else l.push(id);
  O.store.set('workSessions',l);bus.emit('sessions');
};
O.pinnedSessions=()=>O.store.get('pinned',[]);
O.isPinned=id=>O.pinnedSessions().includes(id);
O.togglePin=id=>{const l=O.pinnedSessions();const i=l.indexOf(id);if(i>=0)l.splice(i,1);else l.unshift(id);O.store.set('pinned',l);bus.emit('sessions');};
// Priority inside the pinned block: array order = priority (new pins go on top).
O.movePinned=(id,delta)=>{const l=O.pinnedSessions();const i=l.indexOf(id);if(i<0)return;const j=Math.max(0,Math.min(l.length-1,i+delta));if(i===j)return;const [x]=l.splice(i,1);l.splice(j,0,x);O.store.set('pinned',l);bus.emit('sessions');};
O.openSessions=()=>{
  const list=h('div'),tagBar=h('div',{style:{display:'flex',gap:'6px',overflowX:'auto',marginBottom:'8px'}});
  const q=search(O.tr('Search sessions and messages...','Поиск по сессиям и сообщениям...'),()=>draw());
  // message hits are async (IndexedDB), so they land in a separate block under the session list
  const hits=h('div',{class:'msg-hits hide'});
  let hitTimer=null;
  const runHitSearch=()=>{
    clearTimeout(hitTimer);
    const needle=(q.value||'').trim();
    if(needle.length<2){hits.classList.add('hide');hits.textContent='';return}
    hitTimer=setTimeout(async()=>{
      const res=await O.searchMessages(needle);
      if(!s.root.isConnected)return; // drawer closed while searching: drop the detached DOM work
      if((q.value||'').trim()!==needle)return;
      hits.textContent='';
      if(!res.length){hits.classList.add('hide');return}
      hits.classList.remove('hide');
      hits.append(h('div',{class:'grp'},O.tr('In messages','В сообщениях')+' ('+res.length+')'));
      const card=h('div',{class:'group-card'});
      res.slice(0,40).forEach(r=>{
        const ses=S.sessions.find(x=>x.id===r.sid);
        card.append(h('button',{class:'settings-row',onclick:()=>{s.close();O.openSession(r.sid).then(()=>{
          setTimeout(()=>{const el=[...document.querySelectorAll('#msgs .msg')].find(e=>e.dataset.id===r.mid);if(el)el.scrollIntoView({block:'center'})},400);
        })}},
          h('div',{class:'settings-row-icon'},O.icon(r.role==='user'?'user':'bot')),
          h('div',{class:'settings-row-text'},
            h('b',null,ses?O.sessionTitle(ses):r.sid.slice(0,8)),
            h('span',{style:{whiteSpace:'normal'}},'…'+r.text.replace(/\s+/g,' ').slice(0,140)+'…'))));
      });
      hits.append(card);
    },260);
  };
  let activeTag=O.sessionTagFilter();
  let activeFolder='';
  activeFolderSetter=id=>{activeFolder=id;draw();};
  // Compact grid nav: primary destinations are icon tiles (one glance, one tap), secondary
  // actions collapse into a "More" row so the session list gets the vertical space it deserves.
  const tile=(ic,label,fn)=>h('button',{class:'drawer-tile',onclick:()=>{s.close();fn();}},O.icon(ic),h('span',null,label));
  const navGrid=h('div',{class:'drawer-grid'},
    tile('chat',O.tr('Chat','Чат'),()=>O.setTab('chat')),
    tile('folder',O.tr('Files','Файлы'),()=>O.setTab('files')),
    tile('branch',O.tr('Changes','Правки'),()=>O.setTab('changes')),
    tile('folder',O.tr('Projects','Проекты'),()=>O.openProjects()),
    tile('search',O.tr('Search','Поиск'),()=>O.openGlobalSearch()),
    tile('image',O.tr('Photo','Фото'),()=>O.openMedia&&O.openMedia('image')),
    tile('sliders',O.tr('Settings','Настройки'),()=>O.openSettings()));
  const moreBox=h('div',{class:'drawer-more hide'});
  const navItem=(ic,label,fn)=>h('button',{class:'drawer-nav-item',onclick:()=>{s.close();fn();}},O.icon(ic),h('span',null,label));
  const sect=t=>h('div',{class:'drawer-sect'},t);
  // Grouped by purpose: sessions, media, models & agents, settings, resources.
  moreBox.append(
    sect(O.tr('Sessions','Сессии')),
    navItem('down',O.tr('Import session','Импорт сессии'),()=>importSessionFile()),
    navItem('branch',O.tr('Dialog branches','Ветки диалога'),()=>O.openBranchTree&&O.openBranchTree()),
    navItem('branch',O.tr('Branch tree','Дерево веток'),()=>{
      if(O.openSessionBranchesPanel)O.openSessionBranchesPanel();
      else O.openBranchTree&&O.openBranchTree();
    }),
    sect(O.tr('Media','Медиа')),
    navItem('film',O.tr('Video chat','Чат: Видео'),()=>O.openMedia&&O.openMedia('video')),
    navItem('wave',O.tr('Voice chat','Чат: Голос'),()=>O.openMedia&&O.openMedia('tts')),
    navItem('note',O.tr('Music chat','Чат: Музыка'),()=>O.openMedia&&O.openMedia('music')),
    navItem('list',O.tr('Media history','История медиа'),()=>O.openMedia&&O.openMedia('history')),
    navItem('image',O.tr('Media gallery','Галерея медиа'),()=>O.openMediaGallery&&O.openMediaGallery()),
    sect(O.tr('Models & agents','Модели и агенты')),
    navItem('cpu',O.tr('Models','Модели'),()=>O.openModels()),
    navItem('bot',O.tr('Multimodal agents','Мультимодальные агенты'),()=>O.openMultimodalPicker()),
    navItem('key',O.tr('Connect provider','Подключить провайдера'),()=>O.openConnect()),
    sect(O.tr('Settings','Настройки')),
    navItem('mic',O.tr('Voice settings','Настройки голоса'),()=>O.openCallSettings&&O.openCallSettings()),
    navItem('palette',O.tr('Appearance','Оформление'),()=>O.openThemes()),
    sect(O.tr('Resources','Ресурсы')),
    navItem('cpu',O.tr('Resource monitor','Монитор ресурсов'),()=>O.openResources()),
    navItem('server',O.tr('Server & MCP status','Статус сервера и MCP'),()=>O.openStatus()),
    navItem('refresh',O.tr('Restart server','Перезапуск сервера'),()=>restartApp()));
  let moreOpen=false;
  const moreBtn=h('button',{class:'drawer-more-btn',onclick:()=>{moreOpen=!moreOpen;moreBox.classList.toggle('hide',!moreOpen);moreBtn.classList.toggle('on',moreOpen)}},
    O.icon('dots'),h('span',null,O.tr('More','Ещё')),O.icon('chevD','drawer-more-chev'));
  const newBtn=h('button',{class:'btn pri wide drawer-new',onclick:async()=>{s.close();try{await O.newSession()}catch(e){O.toast(e.message)}}},O.icon('plus'),O.tr('New session','Новая сессия'));
  const offs=[];
  const s=O.sheet(O.tr('Sessions','Сессии'),h('div',{class:'drawer-v2'},newBtn,q,tagBar,navGrid,moreBtn,moreBox,h('div',{class:'drawer-sess-head'},O.icon('chat'),h('b',null,O.tr('Recent sessions','Недавние сессии'))),list,hits),{drawer:true,
    onClose:()=>{clearTimeout(hitTimer);offs.splice(0).forEach(f=>{try{f()}catch(_){}})}});
  function drawTags(){
    tagBar.textContent='';
    const tags=O.sessionTagList();
    const chip=(label,val)=>h('button',{class:'chip',style:activeTag===val?'border-color:var(--acc);color:var(--acc)':'',onclick:()=>{activeTag=val;O.setSessionTagFilter(val);draw()}},label);
    tagBar.append(chip(O.tr('All','Все'),''),...tags.map(t=>chip('#'+t,t)));
    tagBar.classList.toggle('hide',!tags.length);
  }
  // session line: token spend, and remaining context when the model limit is known
  const sessionStatBit=x=>{
    const st=O.sessionStats?O.sessionStats(x.id):null;
    if(!st||!st.tok)return '';
    let s='  ·  '+O.fmtK(st.tok)+' tok';
    if(st.pct!=null)s+=' ('+st.pct+'%)';
    if(st.cost>0)s+=' · $'+st.cost.toFixed(2);
    return s;
  };
  // Date buckets keep a long session list readable without any extra taps.
  const dayKey=ts=>{
    if(!ts)return '';
    const d=new Date(ts),n=new Date();
    const day=(a)=>new Date(a.getFullYear(),a.getMonth(),a.getDate()).getTime();
    const diff=Math.round((day(n)-day(d))/86400000);
    if(diff<=0)return O.tr('Today','Сегодня');
    if(diff===1)return O.tr('Yesterday','Вчера');
    if(diff<7)return O.tr('This week','На этой неделе');
    if(diff<31)return O.tr('This month','В этом месяце');
    return d.toLocaleDateString(undefined,{year:'numeric',month:'long'});
  };
  // 71: session state groups (Working / Idle / Archived). The filter chip row lives next to
  // the tag chips, so picking a state never fights the tag filter.
  let stateGroup=O.store.get('sessionStateFilter','active');
  const stateBar=h('div',{class:'fchips',style:{margin:'4px 0 8px'}});
  const stateChip=(key,label)=>h('button',{class:'chip'+(stateGroup===key?' on':''),onclick:()=>{
    stateGroup=key;O.store.set('sessionStateFilter',key);draw();
  }},label);
  const drawState=()=>{
    stateBar.textContent='';
    stateBar.append(
      stateChip('active',O.tr('Active','Активные')),
      stateChip('run',O.tr('Working','В работе')),
      stateChip('idle',O.tr('Idle','Простой')),
      stateChip('archived',O.tr('Archived','Архив')),
      stateChip('all',O.tr('Everything','Все')));
  };
  function draw(){list.textContent='';drawState();drawTags();runHitSearch();const f=q.value.toLowerCase();
    let items=S.sessions.filter(x=>O.sessionTitle(x).toLowerCase().includes(f)&&(!activeTag||O.sessionTag(x.id)===activeTag));
    if(activeFolder)items=items.filter(x=>O.sessionFolderOf(x.id)===activeFolder);
    // state filter: archived chats are hidden unless the user explicitly looks at them
    const runningOf=x=>{const st=S.status[x.id];return !!(st&&st.type!=='idle')};
    if(stateGroup==='active')items=items.filter(x=>!O.isArchived(x.id));
    else if(stateGroup==='archived')items=items.filter(x=>O.isArchived(x.id));
    else if(stateGroup==='run')items=items.filter(x=>!O.isArchived(x.id)&&runningOf(x));
    else if(stateGroup==='idle')items=items.filter(x=>!O.isArchived(x.id)&&!runningOf(x));
    list.append(stateBar);
    // Pinned: one flat block ordered by user priority (pin array order), never split by days.
    const pinOrder=O.pinnedSessions();
    const pinRank=id=>{const i=pinOrder.indexOf(id);return i<0?1e9:i};
    items.sort((a,b)=>{const pa=O.isPinned(a.id),pb=O.isPinned(b.id);
      if(pa&&pb)return pinRank(a.id)-pinRank(b.id);
      if(pa!==pb)return pa?-1:1;
      return (b.time&&b.time.updated||0)-(a.time&&a.time.updated||0)});
    if(!items.length)list.append(h('div',{class:'mut',style:{padding:'20px',textAlign:'center'}},O.tr('No sessions yet','Сессий пока нет')));
    // Folder toolbar: create a folder and browse by folder.
    const folders=O.sessionFolders();
    const folderBar=h('div',{style:{display:'flex',gap:'6px',overflowX:'auto',margin:'6px 0'}});
    folderBar.append(h('button',{class:'chip'+(activeFolder===''?' on':''),onclick:()=>{activeFolder='';draw()}},O.icon('list'),O.tr('All','Все')));
    folders.forEach(f=>{
      const n=items.filter(x=>O.sessionFolderOf(x.id)===f.id).length;
      const c=h('button',{class:'chip'+(activeFolder===f.id?' on':''),onclick:()=>{activeFolder=f.id;draw()}},
        O.icon(f.icon||'folder'),h('span',null,f.name+(n?' '+n:'')));
      O.longPress(c,()=>folderMenu(f),500);
      folderBar.append(c);
    });
    folderBar.append(h('button',{class:'chip',onclick:async()=>{
      const nm=await O.ask(O.tr('New folder','Новая папка'),O.tr('Folder name','Название папки'));
      if(!nm)return;const f=O.createSessionFolder(nm);activeFolder=f.id;draw();
    }},O.icon('plus')));
    list.append(folderBar);

    // grouping is applied only while browsing (no search) and never to pinned rows
    let lastGroup=null,pinHeadShown=false;
    items.forEach(x=>{
      const pin=O.isPinned(x.id);
      if(!f&&!pin){
        const fid=O.sessionFolderOf(x.id);
        const g=fid?(O.sessionFolders().find(ff=>ff.id===fid)||{}).name||O.tr('Folder','Папка')
                  :(O.isArchived(x.id)?O.tr('Archived','Архив')
                    :(O.isWorkSession(x.id)?O.tr('Working set','Рабочие')
                    :(runningOf(x)?O.tr('In progress','В работе'):O.tr('Idle','Простой'))));
        if(g!==lastGroup){
          lastGroup=g;
          list.append(h('div',{class:'grp',style:{marginTop:'10px'}},g));
        }
      }else if(!f&&pin&&!pinHeadShown){
        pinHeadShown=true;lastGroup=null;
        list.append(h('div',{class:'grp',style:{marginTop:'0'}},O.tr('Pinned','Закреплённые')));
      }
      const st=S.status[x.id],b=st&&st.type!=='idle',sm=x.summary,tag=O.sessionTag(x.id);
      const isWork=O.isWorkSession(x.id);
      const pend=O.sessionPending(x.id);
      list.append(h('div',{class:'settings-row sess-row'+(x.id===S.sid?' on':'')},
        h('button',{class:'settings-row-text',onclick:()=>{s.close();O.openSession(x.id)}},
          h('b',{style:{display:'flex',alignItems:'center',gap:'6px'}},
            O.isUnread&&O.isUnread(x)?h('span',{class:'sess-unread',title:O.tr('New answer','Новый ответ')}):null,
            pin?O.icon('pin','pin-ic'):null,h('span',{class:'sess-title'},O.sessionTitle(x)),isWork?h('span',{class:'sess-badge work',title:O.tr('Working set','Рабочая сессия')},O.icon('star')):null,x.local?h('span',{class:'mut s'},'· offline'):null),
          h('span',{class:'sess-sub'},(tag?'#'+tag+'  ':'')+(sm&&(sm.additions||sm.deletions)?'+'+sm.additions+' -'+sm.deletions:'')+sessionStatBit(x))),
        pend.q?h('span',{class:'sess-badge q',title:O.tr('Question pending','Ждёт ответа на вопрос')},O.icon('at'),pend.q>1?h('i',null,pend.q):null):null,
        pend.p?h('span',{class:'sess-badge p',title:O.tr('Permission pending','Ждёт разрешения')},O.icon('excl'),pend.p>1?h('i',null,pend.p):null):null,
        b?h('span',{class:'spin',style:{flex:'none'}}):null,
        x.parentID?h('span',{class:'sess-badge sub',title:O.tr('Subagent session','Сессия субагента')},O.icon('bot')):null,
        h('span',{class:'sess-time',title:O.tr('Last activity','Последняя активность')},O.ago(x.time&&x.time.updated)),
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
function folderMenu(f){
  const n=O.sessions.filter(x=>O.sessionFolderOf(x.id)===f.id).length;
  O.actions(f.name,[
    {label:O.tr('Open folder','Открыть папку'),icon:'folder',fn:()=>{activeFolderSetter(f.id)}},
    {label:O.tr('Rename folder','Переименовать папку'),icon:'edit',fn:async()=>{
      const v=await O.ask(O.tr('Folder name','Название папки'),null,f.name);
      if(v){O.renameSessionFolder(f.id,v);bus.emit('sessions')}
    }},
    {label:O.tr('Move up','Выше'),icon:'up',fn:()=>{O.moveSessionFolder(f.id,-1)}},
    {label:O.tr('Move down','Ниже'),icon:'down',fn:()=>{O.moveSessionFolder(f.id,1)}},
    {label:O.tr('Delete folder','Удалить папку'),sub:O.tr(n+' chats stay, folder only','Чаты останутся, удалится только папка'),icon:'trash',danger:true,fn:()=>{O.deleteSessionFolder(f.id);bus.emit('sessions')}}
  ]);
}
// The drawer owns the active folder; the menu needs a way to switch it.
let activeFolderSetter=()=>{};
function sessActions(x){const pin=O.isPinned(x.id);const po=O.pinnedSessions();const pi=po.indexOf(x.id);
  O.actions(O.sessionTitle(x),[
  {label:pin?O.tr('Unpin','Открепить'):O.tr('Pin','Закрепить'),icon:'star',fn:()=>{O.togglePin(x.id)}},
  pin&&pi>0?{label:O.tr('Move up (priority)','Выше (приоритет)'),icon:'up',fn:()=>O.movePinned(x.id,-1)}:null,
  pin&&pi>=0&&pi<po.length-1?{label:O.tr('Move down (priority)','Ниже (приоритет)'),icon:'down',fn:()=>O.movePinned(x.id,1)}:null,
  {label:O.isWorkSession(x.id)?O.tr('Remove from working set','Убрать из рабочих'):O.tr('Mark as working','Отметить как рабочую'),icon:'zap',fn:()=>{O.toggleWorkSession(x.id)}},
  {label:O.sessionTag(x.id)?('#'+O.sessionTag(x.id)+' · '+O.tr('change folder/tag','сменить папку/тег')):O.tr('Folder / tag','Папка / тег'),icon:'folder',fn:async()=>{
    const cur=O.sessionTag(x.id);
    const tags=O.sessionTagList();
    const opts=tags.filter(t=>t!==cur).map(t=>({label:'#'+t,icon:'folder',fn:()=>O.setSessionTag(x.id,t)}));
    opts.push({label:O.tr('Set custom tag...','Задать свой тег...'),icon:'edit',fn:async()=>{const v=await O.ask(O.tr('Folder / tag','Папка / тег'),O.tr('For example: Work','Например: Работа'),cur);if(v!=null)O.setSessionTag(x.id,v)}});
    if(cur)opts.push({label:O.tr('Remove tag','Убрать тег'),icon:'x',fn:()=>O.setSessionTag(x.id,'')});
    O.actions(O.tr('Folder / tag','Папка / тег'),opts);
  }},
  {label:O.tr('Session settings','Настройки сессии'),sub:O.tr('Jailbreak, folder, file tree — this chat only','Джейлбрейк, папка, дерево — только для этого чата'),icon:'sliders',fn:()=>O.openSessionSettings&&O.openSessionSettings(x.id)},
  {label:O.tr('Move to folder','Переместить в папку'),sub:(O.sessionFolders().find(f=>f.id===O.sessionFolderOf(x.id))||{}).name||O.tr('no folder','без папки'),icon:'folder',fn:()=>{
    const cur=O.sessionFolderOf(x.id);
    const items=[{label:O.tr('No folder','Без папки'),icon:'x',fn:()=>O.setSessionFolder(x.id,'')}];
    O.sessionFolders().filter(f=>f.id!==cur).forEach(f=>items.push({label:f.name,icon:f.icon||'folder',fn:()=>O.setSessionFolder(x.id,f.id)}));
    items.push({label:O.tr('New folder…','Новая папка…'),icon:'plus',fn:async()=>{
      const nm=await O.ask(O.tr('New folder','Новая папка'),O.tr('Folder name','Название папки'));
      if(nm){const f=O.createSessionFolder(nm);O.setSessionFolder(x.id,f.id)}
    }});
    O.actions(O.tr('Move to folder','Переместить в папку'),items);
  }},
  {label:O.tr('Project folder','Папка проекта'),sub:O.sessionDir(x.id).replace(/^\/root/, '~'),icon:'folder',fn:()=>{
    O.browseDir(O.sessionDir(x.id),dir=>{O.setSessionDir(x.id,dir);O.toast(O.tr('Folder: ','Папка: ')+dir,1800)});
  }},
  {label:O.tr('Rename','Переименовать'),icon:'edit',fn:async()=>{const v=await O.ask(O.tr('Rename session','Переименование сессии'),null,O.sessionTitle(x));if(!v)return;if(x.local){x.title=v;O.saveLocalSession(x);bus.emit('sessions');return}try{await api('PATCH','/session/'+x.id,{title:v})}catch(e){O.toast(e.message)}}},
  {label:O.tr('Export session (JSON)','Экспорт сессии (JSON)'),icon:'down',fn:()=>{
    const json=O.exportSessionJson(x.id);
    O.actions(O.tr('Export session (JSON)','Экспорт сессии (JSON)'),[
      {label:O.tr('Copy JSON','Скопировать JSON'),icon:'copy',fn:()=>O.native.copy(json)},
      {label:O.tr('Share','Поделиться'),icon:'share',fn:()=>{if(O.native&&O.native.share)O.native.share(json);else O.native.copy(json)}}]);
  }},
  {label:x.share?O.tr('Stop sharing','Отключить шаринг'):O.tr('Share','Поделиться'),icon:'share',fn:async()=>{try{if(x.share){await api('DELETE','/session/'+x.id+'/share')}else{const r=await api('POST','/session/'+x.id+'/share',{});if(r.share){O.native.copy(r.share.url);O.native.share(r.share.url)}}}catch(e){O.toast(e.message)}}},
  {label:O.tr('Duplicate','Дублировать'),icon:'copy',fn:async()=>{try{const r=await api('POST','/session/'+x.id+'/fork',{});await O.loadSessions();O.openSession(r.id)}catch(e){O.toast(e.message)}}},
  {label:O.isArchived(x.id)?O.tr('Restore from archive','Вернуть из архива'):O.tr('Archive','В архив'),icon:'down',fn:()=>{
    O.archiveSession(x.id,!O.isArchived(x.id));
    O.toast(O.isArchived(x.id)?O.tr('Archived','В архиве'):O.tr('Restored','Восстановлено'),1400);
  }},
  {label:O.tr('Mark as read','Отметить прочитанным'),icon:'check',fn:()=>{O.markSeen(x.id);bus.emit('sessions')}},
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

// ---- workspaces + folder browser ----
O.openProjects=()=>{
  const body=h('div');
  const s=O.sheet(O.tr('Workspaces','Рабочие пространства'),body,{full:true});
  const off=bus.on('workspace',()=>{if(s.root&&s.root.isConnected)draw();else off()});
  const draw=()=>{
    body.textContent='';
    body.append(h('div',{class:'note'},O.tr('Projects keep their folder, model and agent. Chats stay attached to the project folder.','У каждого проекта своя папка, модель и агент. Чаты остаются привязаны к папке проекта.')));
    body.append(h('button',{class:'btn pri wide',onclick:()=>{s.close();O.browseDir(S.dir,dir=>O.activateWorkspace(dir))}},O.icon('plus'),O.tr('Add project folder','Добавить папку проекта')));
    const list=O.workspaces();
    const seen=new Set();
    const add=w=>{
      if(!w||!w.dir||seen.has(w.dir))return;seen.add(w.dir);
      const bits=[w.dir];
      if(w.model&&w.model.modelID)bits.push(w.model.modelID);
      if(w.agent)bits.push('@'+w.agent);
      if(w.openFiles&&w.openFiles.length)bits.push(w.openFiles.length+' '+O.tr('files','файл.'));
      body.append(h('div',{class:'workspace-card'},
        h('button',{class:'workspace-main',onclick:async()=>{s.close();await O.activateWorkspace(w.dir,w.name);O.toast(O.workspaceName(w),1200)}},
          O.icon('folder'),
          h('div',{class:'settings-row-text'},h('b',null,O.workspaceName(w)),h('span',null,bits.join(' · ')))),
        h('button',{class:'ibtn s',onclick:()=>O.actions(O.workspaceName(w),[
          {label:O.tr('Rename','Переименовать'),icon:'edit',fn:async()=>{const n=await O.ask(O.tr('Workspace name','Название проекта'),null,O.workspaceName(w));if(n){O.saveWorkspace(Object.assign({},w,{name:n}));draw()}}},
          {label:O.tr('Remove from list','Убрать из списка'),icon:'trash',danger:true,fn:()=>{O.deleteWorkspace(w.dir);draw()}}
        ])},O.icon('dots'))));
    };
    list.forEach(add);
    // Discover projects reported by the server as well; selecting one saves it as a workspace.
    (S.projects||[]).forEach(x=>add({dir:x.worktree,name:O.basename(x.worktree)||x.worktree}));
    (O.store.get('recent',[])||[]).forEach(dir=>add({dir}));
    add({dir:S.dir});add({dir:'/root',name:'Home'});
    if(!seen.size)body.append(h('div',{class:'mut',style:{padding:'16px'}},O.tr('No workspaces yet','Проектов пока нет')));
  };
  draw();
};
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

  // Reasoning effort lives at the top of the picker: one tap opens the full ladder, weakest → strongest.
  const effortNow=()=>O.currentEffort?O.currentEffort():'';
  const effortTxt=h('span',null,effortNow()?O.effortLabel(effortNow()):O.tr('Default','По умолчанию'));
  const effortCard=h('button',{class:'detached-card',onclick:()=>{
    O.openEffortPicker();
    setTimeout(()=>{effortTxt.textContent=effortNow()?O.effortLabel(effortNow()):O.tr('Default','По умолчанию');draw()},250);
  }},
    h('div',{class:'detached-card-left'},
      O.icon('bulb'),
      h('span',{style:{marginLeft:'6px'}},O.tr('Reasoning effort','Уровень рассуждения'))),
    h('div',{class:'detached-card-right'},effortTxt));

  // ---- selection mode: long-press a model to enter it ----
  const sel=new Set();
  const selectBar=h('div',{class:'model-select-bar hide'});
  const enterSelect=(x)=>{
    const key=x.pid+'/'+x.mid;
    if(sel.has(key))sel.delete(key);else sel.add(key);
    if(!sel.size){selectBar.classList.add('hide');draw();return}
    renderSelectBar();
    draw();
  };
  const exitSelect=()=>{sel.clear();selectBar.classList.add('hide');draw()};
  const renderSelectBar=()=>{
    selectBar.textContent='';
    selectBar.classList.remove('hide');
    const n=sel.size;
    const actions=h('div',{class:'sel-actions'});
    selectBar.append(
      h('div',{class:'sel-head'},
        h('button',{class:'ibtn s',onclick:exitSelect},O.icon('x')),
        h('b',{class:'grow',style:{fontSize:'13px'}},n+' '+O.tr('selected','выбрано'))),
      actions);
    actions.append(
      h('button',{class:'chip',onclick:()=>{sel.forEach(k=>{if(!O.isModelPinned(k))O.toggleModelPin(k)});exitSelect()}},O.icon('pin'),O.tr('Pin','Закрепить')),
      h('button',{class:'chip',onclick:()=>{sel.forEach(k=>O.isModelPinned(k)&&O.toggleModelPin(k));exitSelect()}},O.icon('x'),O.tr('Unpin','Открепить')),
      h('button',{class:'chip',onclick:()=>{
        const folders=O.modelFolders();
        const items=folders.map(f=>({label:f.name,icon:'folder',fn:()=>{sel.forEach(k=>O.addModelToFolder(k,f.id));exitSelect()}}));
        items.push({label:O.tr('New folder…','Новая папка…'),icon:'plus',fn:async()=>{
          const name=await O.ask(O.tr('New folder','Новая папка'),O.tr('Folder name','Название папки'));
          if(!name)return;const f=O.createModelFolder(name);
          sel.forEach(k=>O.addModelToFolder(k,f.id));exitSelect();
        }});
        O.actions(O.tr('Group into folder','Сгруппировать в папку'),items);
      }},O.icon('folder'),O.tr('To folder','В папку')),
      h('button',{class:'chip',onclick:()=>{
        // Remove from whichever folder each selected model currently lives in
        const moved=O.modelFolders().filter(f=>(f.keys||[]).some(k=>sel.has(k)));
        if(!moved.length){O.toast(O.tr('Selection is not in any folder','Выбранные модели не в папках'),2000);return}
        const items=[{section:O.tr('Remove from folder','Убрать из папки')}].concat(moved.map(f=>({
          label:f.name,icon:'folder',fn:()=>{
            sel.forEach(k=>O.removeModelFromFolder(k,f.id));
            O.toastQuiet(O.tr('Removed from folder','Убрано из папки'));
            exitSelect();
          }
        })));
        O.actions(O.tr('Remove from folder','Убрать из папки'),items);
      }},O.icon('x'),O.tr('From folder','Из папки')),
      h('button',{class:'chip',onclick:()=>{sel.forEach(k=>O.hideModel(k));exitSelect()}},O.icon('trash'),O.tr('Delete','Удалить')));
  };

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
  const container=h('div',null,effortCard,selectBar,q,profBar,folderBtn,compareBtn,provBar,listEl,h('div',{style:{height:'10px'}}),bulkRow,swRow,connectCard);
  const s=O.sheet(O.tr('Select model','Выбор модели'),container,{hud:true,full:true});
  // Folder edits from the action sheet / folder manager must repaint the list live.
  const offFolders=bus.on('folders',()=>{if(s.root&&s.root.isConnected)draw()});
  const prevClose=s.close;
  s.close=()=>{try{offFolders&&offFolders()}catch(_){};prevClose()};

  // Long-press on a model: pin/unpin, delete, folder, multi-select.
  function modelQuickMenu(x){
    const key=x.pid+'/'+x.mid;
    const pinned=O.isModelPinned(key);
    O.actions(x.name||x.mid,[
      {label:pinned?O.tr('Unpin','Открепить'):O.tr('Pin','Закрепить'),icon:'pin',fn:()=>{O.toggleModelPin(key);bus.emit('meta');draw()}},
      {label:O.tr('Delete model','Удалить модель'),sub:O.tr('Can be restored from "Deleted models"','Можно вернуть из «Удалённых моделей»'),icon:'trash',danger:true,fn:()=>{
        O.hideModel(key);
        if(S.model&&S.model.providerID===x.pid&&S.model.modelID===x.mid){S.model=null;O.pickDefaults&&O.pickDefaults();bus.emit('meta')}
        O.toast(O.tr('Model deleted: ','Модель удалена: ')+(x.name||x.mid),2000);
        draw();
      }},
      {label:O.tr('Add to folder…','Добавить в папку…'),icon:'folder',fn:()=>{
        const folders=O.modelFolders();
        const items=folders.map(f=>({label:f.name,icon:'folder',fn:()=>{O.addModelToFolder(key,f.id);draw()}}));
        items.push({label:O.tr('New folder…','Новая папка…'),icon:'plus',fn:async()=>{
          const nm=await O.ask(O.tr('New folder','Новая папка'),O.tr('Folder name','Название папки'));
          if(!nm)return;const f=O.createModelFolder(nm);O.addModelToFolder(key,f.id);draw();
        }});
        O.actions(O.tr('Group into folder','В папку'),items);
      }},
      {label:O.tr('Select multiple','Выбрать несколько'),icon:'check',fn:()=>enterSelect(x)}
    ]);
  }
  // Provider actions: pin (keep at top) and delete the provider together with its models.
  function providerMenu(pid,p){
    const name=p&&(p.pname||p.name)||pid;
    const models=O.allModels().filter(x=>x.pid===pid);
    const hidden=O.hiddenModels().filter(k=>k.startsWith(pid+'/'));
    const pinned=O.store.get('pinnedProviders',[]).includes(pid);
    O.actions(name,[
      {label:pinned?O.tr('Unpin provider','Открепить провайдера'):O.tr('Pin provider','Закрепить провайдера'),icon:'pin',fn:()=>{
        const l=O.store.get('pinnedProviders',[]);
        O.store.set('pinnedProviders',pinned?l.filter(x=>x!==pid):[pid].concat(l));
        bus.emit('meta');draw();
      }},
      {label:O.tr('Refresh models from API','Обновить модели из API'),icon:'refresh',fn:()=>O.refreshProviderModels(pid)},
      {label:O.tr('Delete provider & its models','Удалить провайдера и его модели'),sub:O.tr(models.length+' models will be removed','Будет удалено моделей: '+models.length),icon:'trash',danger:true,fn:()=>{
        O.confirm(O.tr('Delete provider?','Удалить провайдера?'),
          name+' — '+O.tr('models, keys and config entry will be removed.','модели, ключи и запись в конфиге будут удалены.'),
          O.tr('Delete','Удалить'),true).then(ok=>{if(ok)deleteProvider(pid,models)});
      }}
    ]);
  }
  async function deleteProvider(pid,models){
    try{
      // 1. forget the models locally (active model too)
      models.forEach(x=>O.hideModel(x.pid+'/'+x.mid));
      if(S.model&&S.model.providerID===pid){S.model=null;O.pickDefaults&&O.pickDefaults();bus.emit('meta')}
      // 2. remove the config entry (models live inside it)
      try{
        const t=O.native.cfgRead();
        if(t&&t.trim()){
          const obj=O.parseJsonc(t);
          if(obj.provider&&obj.provider[pid]){delete obj.provider[pid];O.native.cfgWrite(JSON.stringify(obj,null,2))}
        }
      }catch(_){}
      // 3. remove the API key from auth.json and the local key ring
      try{
        const r=O.native.readText('/root/.local/share/opencode/auth.json');
        const o=JSON.parse((r&&r.text)||'{}');
        if(o[pid]){delete o[pid];O.native.writeText('/root/.local/share/opencode/auth.json',JSON.stringify(o,null,2))}
      }catch(_){}
      try{O.keyRingSet&&O.keyRingSet(pid,[]);O.store.remove('keyRingIdx.'+pid)}catch(_){}
      // 4. restart the core so the provider list reloads
      try{await api('POST','/instance/dispose',null)}catch(_){}
      await O.loadMeta();
      providerFilter='';
      O.toast(O.tr('Provider deleted: ','Провайдер удалён: ')+pid,2200);
      draw();
    }catch(e){O.toast(e.message||String(e),3500)}
  }
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
    const pinProv=O.store.get('pinnedProviders',[]);
    const pids=[...new Set(all.map(x=>x.pid))].sort((a,b)=>{
      const pa=pinProv.includes(a)?0:1,pb=pinProv.includes(b)?0:1;
      return pa-pb;
    });
    if(!pids.length){provBar.classList.add('hide');return}
    provBar.classList.remove('hide');
    const chip=(label,val,pid)=>h('button',{class:'chip',style:providerFilter===val?'border-color:var(--acc);color:var(--acc)':'',onclick:()=>{providerFilter=val;draw()}},label);
    provBar.append(chip(O.tr('All providers','Все провайдеры'),''));
    pids.forEach(pid=>{
      const p=all.find(x=>x.pid===pid);
      const c=chip(p&&p.pname||pid,pid,pid);
      // Long-press a provider chip → pin provider / delete provider with all its models.
      O.longPress(c,()=>providerMenu(pid,p),500);
      provBar.append(c);
    });
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
      if(ctx){
        parts.push(O.fmtK(ctx)+' context');
        // remaining context is only meaningful for the model currently in use
        if(isSel){
          const cl=O.contextLeft&&O.contextLeft();
          if(cl)parts.push(O.tr('left','осталось')+' '+O.fmtK(cl.left)+' ('+cl.pct+'%)');
        }
      }
      const caps=O.modelCaps?O.modelCaps(x.m):{images:null,tools:null};
      if(caps.images===true)parts.push(O.tr('images','изображения'));
      else if(caps.images===false)parts.push(O.tr('no images','без изображений'));
      if(caps.tools===true)parts.push(O.tr('tools','инструменты'));
      else if(caps.tools===false)parts.push(O.tr('no tools','без инструментов'));
      if(x.m&&(x.m.reasoning||x.m.variants))parts.push('reasoning');
      if(!isFree&&x.m&&x.m.cost&&typeof x.m.cost.input==='number'&&x.m.cost.input>0){
        parts.push('$'+x.m.cost.input+'/1M');
      }
      const sub=parts.join(' · ');

      const inSel=sel.has(key);
      const selecting=sel.size>0;
      // Square checkbox: checked for selected rows, empty for the rest (only in selection mode).
      const box=selecting?h('span',{class:'model-check-box'+(inSel?' on':'')},inSel?O.icon('check'):null):null;
      const row=h('button',{class:'model-row'+(isSel?' on':'')+(inSel?' picked':''),onclick:()=>{
        if(row._lpFired){row._lpFired=false;return}
        if(selecting){enterSelect(x);return}
        O.setModel(x.pid,x.mid);
        s.close();
      }},
        box,
        h('div',{class:'model-row-left'},
          h('div',{style:{display:'flex',alignItems:'center',gap:'6px',flexWrap:'wrap'}},
            isPinned?O.icon('pin','pin-ic'):null,
            h('span',{class:'model-row-title'},x.name||x.mid),
            badge
          ),
          sub?h('span',{class:'model-row-sub'},sub):null
        ),
        isSel&&!selecting?O.icon('check','model-check'):null
      );
      // Long press: quick actions for THIS model (pin / delete), plus enter selection mode.
      O.longPress(row,()=>modelQuickMenu(x),500);
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
  const provider=x.pname||(x.pid==='opencode'?'OpenCode Zen':x.pid);

  const pickFolder=()=>{
    const items=[{section:O.tr('Move to folder','Переместить в папку')}];
    folders.forEach(f=>{
      const isCur=folder&&folder.id===f.id;
      items.push({
        label:f.name+(isCur?' · '+O.tr('current','текущая'):''),
        icon:isCur?'check':'folder',
        fn:()=>{O.addModelToFolder(key,f.id);O.toastQuiet(O.tr('Moved','Перемещено'));redraw&&redraw()}
      });
    });
    if(folder)items.push({label:O.tr('Remove from folder','Убрать из папки'),icon:'x',fn:()=>{O.removeModelFromFolder(key,folder.id);O.toastQuiet(O.tr('Removed from folder','Убрано из папки'));redraw&&redraw()}});
    items.push({label:O.tr('New folder…','Новая папка…'),icon:'plus',fn:async()=>{
      const n=await O.ask(O.tr('New folder','Новая папка'),O.tr('Folder name','Название папки'));
      if(!n)return;const f=O.createModelFolder(n);O.addModelToFolder(key,f.id);redraw&&redraw();
    }});
    O.actions(O.tr('Folders','Папки'),items);
  };

  O.actions(x.name||x.mid,[
    {section:provider},
    {label:O.tr('Capabilities','Возможности'),sub:O.tr('Images, tool calls, reasoning, context','Изображения, инструменты, рассуждения, контекст'),icon:'info',fn:()=>O.modelCapsSheet&&O.modelCapsSheet(x.pid,x.mid)},
    {label:pinned?O.tr('Unpin','Открепить'):O.tr('Pin','Закрепить'),sub:O.tr('Keep it at the top of the list','Держать в начале списка'),icon:'pin',fn:()=>{O.toggleModelPin(key);redraw&&redraw()}},
    folder
      ?{label:O.tr('In folder','В папке')+': '+folder.name,sub:O.tr('Change or remove','Сменить или убрать'),icon:'folder',fn:pickFolder}
      :{label:O.tr('Add to folder','Добавить в папку'),sub:O.tr('Group models across providers','Объединить модели разных провайдеров'),icon:'folder',fn:pickFolder},
    {section:O.tr('Use','Использование')},
    {label:O.tr('Start a new chat with this model','Новый чат с этой моделью'),icon:'plus',fn:async()=>{
      try{
        await O.newSession();
        O.setModel(x.pid,x.mid);
        O.setTab('chat');
      }catch(e){O.toast(e.message)}
    }},
    {label:O.tr('Reasoning effort…','Уровень рассуждения…'),sub:O.currentEffort&&O.currentEffort()?O.effortLabel(O.currentEffort()):O.tr('Default','По умолчанию'),icon:'bulb',fn:()=>O.openEffortPicker&&O.openEffortPicker()},
    {label:O.tr('Save as profile','Сохранить как профиль'),sub:O.tr('Model plus its fallback chain','Модель и цепочка резервных'),icon:'star',fn:()=>O.openModelProfiles(redraw)},
    {section:O.tr('Manage','Управление')},
    {label:O.tr('Update models from provider','Обновить модели у провайдера'),sub:O.tr('Check the API for models added since connecting','Проверить API на новые модели'),icon:'refresh',fn:()=>O.refreshProviderModels(x.pid)},
    {label:O.tr('Delete model','Удалить модель'),sub:O.tr('Hidden from the list, can be restored','Скрыть из списка, можно вернуть'),icon:'trash',danger:true,fn:async()=>{
      if(!await O.confirm(O.tr('Delete model?','Удалить модель?'),(x.name||x.mid)+' — '+O.tr('will be hidden from the model list','будет скрыта из списка моделей'),O.tr('Delete','Удалить'),true))return;
      O.hideModel(key);
      if(S.model&&(S.model.providerID+'/'+S.model.modelID)===key){
        const rest=O.allModels().filter(m=>!O.isModelHidden(m.pid+'/'+m.mid)&&m.pid+'/'+m.mid!==key);
        if(rest.length)O.setModel(rest[0].pid,rest[0].mid);
      }
      redraw&&redraw();
    }}
  ]);
}

// ---- refresh provider catalogue ----
// Providers add models over time; the config in opencode.json is a snapshot taken at connect time.
// This asks the provider for its current /models list and merges the new entries in, keeping the
// user's existing model settings and never deleting anything.
//
// IMPORTANT: an unauthenticated /models call is rate-limited or rejected by almost every vendor
// (429 on OpenRouter/Groq, 402 on paid Zen plans), so a probe WITHOUT a key is useless noise.
// The key is resolved in this order: explicit argument → active key-ring key → options.apiKey in
// opencode.json → auth.json[provider].key.
const AUTH_JSON='/root/.local/share/opencode/auth.json';
const readAuthJson=()=>{
  try{const r=O.native.readText(AUTH_JSON);return JSON.parse((r&&r.text)||'{}')||{}}catch(_){return{}}
};
const providerKeys=pid=>{
  const out=[];
  try{(O.keyRingOf?O.keyRingOf(pid):[]).forEach(k=>{if(k&&!out.includes(k))out.push(k)})}catch(_){}
  try{
    const t=O.native.cfgRead();
    const o=t&&t.trim()?O.parseJsonc(t):{};
    const opt=((o.provider||{})[pid]||{}).options||{};
    if(opt.apiKey&&opt.apiKey!=='dummy'&&!out.includes(opt.apiKey))out.push(opt.apiKey);
  }catch(_){}
  try{
    const a=readAuthJson();
    const k=a[pid]&&(a[pid].key||a[pid].apiKey);
    if(k&&!out.includes(k))out.push(k);
  }catch(_){}
  return out;
};
O.providerKeys=providerKeys;
// Classify a failed probe so the UI can explain the real reason instead of "HTTP 429".
const probeError=(status,body)=>{
  const txt=String(body||'').slice(0,300);
  const e=new Error(
    status===401||status===403?O.tr('The key was rejected (401/403)','Ключ отклонён (401/403)'):
    status===402?O.tr('No balance or paid plan required (402)','Нет баланса или нужен платный план (402)'):
    status===429?O.tr('Rate limited or key required (429)','Лимит запросов или нужен ключ (429)'):
    status===404?O.tr('Endpoint not found (404) — check the Base URL','Адрес не найден (404) — проверьте Base URL'):
    status?O.tr('HTTP ','HTTP ')+status:O.tr('Network error','Ошибка сети'));
  e.status=status||0;e.body=txt;return e;
};
const probeOnce=async(target,key,patchHeaders)=>{
  const hd={'Accept':'application/json'};
  if(key)hd['Authorization']='Bearer '+key;
  Object.assign(hd,patchHeaders||{});
  let nat=null;
  try{
    nat=O.native.netGetAsync
      ?await O.native.netGetAsync(target,hd,20000)
      :(O.native.netGet?O.native.netGet(target,hd,20000):null);
  }catch(e){nat={ok:false,err:e.message}}
  const status=nat&&nat.status||0;
  if(nat&&nat.ok&&nat.body){
    let json=null;
    try{json=JSON.parse(nat.body)}catch(_){json=null}
    if(json)return json;
  }
  // A native answer that came back with a body but not OK still carries the status we need.
  if(status)throw probeError(status,nat&&nat.body);
  // Browser fallback (CORS usually blocks it on device, but the previewer has no bridge).
  try{
    const resp=await fetch(target,{method:'GET',headers:hd});
    if(!resp.ok)throw probeError(resp.status,await resp.text().catch(()=>''))
    return await resp.json();
  }catch(e){
    if(e&&e.status)throw e;
    throw probeError(0,(nat&&nat.err)||e.message);
  }
};
const probeModels=async(url,key,patchHeaders)=>{
  let target=String(url||'').trim().replace(/\/+$/,'');
  if(!target)throw probeError(0,O.tr('No Base URL','Нет Base URL'));
  if(!/^https?:\/\//i.test(target))target='https://'+target;
  if(!target.endsWith('/models'))target+='/models';
  const json=await probeOnce(target,key,patchHeaders);
  const raw=Array.isArray(json)?json:(json.data||json.models||[]);
  return raw.map(m=>typeof m==='string'?m:(m.id||m.name)).filter(Boolean);
};
O.probeModels=probeModels;

// Walk every known key and stop at the first one that answers with a model list.
// Returns {models,key,index,errors[]}.
O.probeModelsWithKeys=async(url,pid,tried)=>{
  const keys=(tried&&tried.length?tried:providerKeys(pid));
  let headers={};
  try{
    const t=O.native.cfgRead();
    const o=t&&t.trim()?O.parseJsonc(t):{};
    headers=(((o.provider||{})[pid]||{}).options||{}).headers||{};
  }catch(_){}
  const errors=[];
  for(let i=0;i<keys.length;i++){
    try{
      const models=await probeModels(url,keys[i],headers);
      return {models,key:keys[i],index:i,errors};
    }catch(e){
      errors.push({index:i,status:e.status||0,message:e.message||String(e)});
      // 401/402/403: this key is unusable — try the next one.
      // 429: this key is throttled — the next one may be fine too.
      // Anything else (404, DNS) will not be fixed by another key.
      if(e.status&&e.status!==401&&e.status!==402&&e.status!==403&&e.status!==429)throw Object.assign(e,{errors});
    }
  }
  const last=errors[errors.length-1]||{};
  const err=probeError(last.status||0,'');
  err.message=errors.length
    ? (O.tr('All ','Все ')+errors.length+' '+O.tr('keys failed: ','ключей не сработали: ')+errors.map(x=>x.message).join('; '))
    : O.tr('No API key for this provider','Нет API-ключа для этого провайдера');
  err.errors=errors;err.noKey=!errors.length;
  throw err;
};

// Small helper sheet: explain that a key is required and offer to paste one right away.
const askForProviderKey=(pid,name,after)=>{
  const inp=h('input',{type:'password',placeholder:O.tr('Paste the API key','Вставьте API-ключ'),autocapitalize:'off',autocorrect:'off'});
  const sheet=O.sheet(O.tr('API key required','Нужен API-ключ'),
    h('div',null,
      h('div',{class:'note'},O.tr('Probing models without a key just returns 401/402/429. The key is used only for this request and is stored in the local key ring.','Прозвон моделей без ключа возвращает только 401/402/429. Ключ используется для этого запроса и сохраняется в локальное кольцо ключей.')),
      h('div',{class:'mono s mut',style:{margin:'8px 0',wordBreak:'break-all'}},name||pid),
      h('div',{class:'field'},h('label',null,O.tr('API key','API-ключ')),inp),
      h('div',{style:{display:'flex',gap:'8px',marginTop:'10px'}},
        h('button',{class:'btn grow',onclick:()=>sheet.close()},O.tr('Cancel','Отмена')),
        h('button',{class:'btn pri grow',onclick:()=>{
          const k=inp.value.trim();
          if(!k)return O.toast(O.tr('Key is empty','Ключ пустой'),1500);
          const old=(O.keyRingOf?O.keyRingOf(pid):[]).filter(x=>x!==k);
          O.keyRingSet&&O.keyRingSet(pid,[k].concat(old));
          sheet.close();
          setTimeout(()=>after&&after(k),120);
        }},O.icon('check'),O.tr('Save & probe','Сохранить и прозвонить')))));
  setTimeout(()=>inp.focus(),200);
};

O.refreshProviderModels=async pid=>{
  const body=h('div',null,h('div',{class:'mut',style:{padding:'16px'}},O.tr('Checking the provider…','Проверяю провайдера…')));
  const s=O.sheet(O.tr('Update models','Обновить модели'),body,{full:true});
  let cfgObj=null;
  try{
    const t=O.native.cfgRead();
    cfgObj=t.trim()?O.parseJsonc(t):{};
  }catch(e){body.textContent='';body.append(h('div',{class:'errbox'},O.tr('Config is not valid JSON: ','Конфиг не является корректным JSON: ')+e.message));return}

  const prov=(cfgObj.provider||{})[pid];
  const url=(prov&&prov.options&&(prov.options.upstreamBaseURL||prov.options.baseURL))||'';
  if(!url){
    body.textContent='';
    body.append(h('div',{class:'errbox'},O.tr('This provider has no Base URL in the config.','У этого провайдера нет Base URL в конфиге.')),
      h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:()=>{s.close();O.openCustomProvider()}},O.icon('cpu'),O.tr('Open custom provider','Открыть свой провайдер')));
    return;
  }
  const keys=providerKeys(pid);
  // No key → do not even hit the endpoint: without Authorization most vendors answer 429/402.
  if(!keys.length){
    s.close();
    askForProviderKey(pid,(prov&&prov.name)||pid,()=>O.refreshProviderModels(pid));
    return;
  }
  const headers=(prov&&prov.options&&prov.options.headers)||{};
  let found=[],usedKey='',triedErrors=[];
  const loading=h('div',{class:'mut',style:{padding:'16px'}});
  body.textContent='';
  body.append(loading);
  try{
    const r=await O.probeModelsWithKeys(url,pid,keys);
    found=r.models;usedKey=r.key;triedErrors=r.errors||[];
  }catch(e){
    body.textContent='';
    const box=h('div',{class:'errbox'},O.tr('Could not get the model list: ','Не удалось получить список: ')+e.message);
    body.append(box);
    if(e.errors&&e.errors.length)body.append(h('div',{class:'note'},O.tr('Tried keys: ','Проверено ключей: ')+e.errors.length));
    body.append(h('div',{class:'note',style:{marginTop:'8px'}},url));
    const row=h('div',{style:{display:'flex',gap:'8px',marginTop:'10px'}});
    row.append(h('button',{class:'btn grow',onclick:()=>{s.close();O.refreshProviderModels(pid)}},O.icon('refresh'),O.tr('Retry','Повторить')));
    row.append(h('button',{class:'btn grow',onclick:()=>{s.close();askForProviderKey(pid,(prov&&prov.name)||pid,()=>O.refreshProviderModels(pid))}},O.icon('key'),O.tr('Use another key','Другой ключ')));
    body.append(row);
    return;
  }
  if(!found.length){
    body.textContent='';
    body.append(h('div',{class:'mut',style:{padding:'16px'}},O.tr('The provider returned an empty model list.','Провайдер вернул пустой список моделей.')));
    return;
  }

  const existing=Object.keys((prov&&prov.models)||{});
  const have=new Set(existing);
  const fresh=found.filter(m=>!have.has(m));
  const gone=existing.filter(m=>!found.includes(m));
  const chosen=new Set(fresh); // new models are added by default

  const redraw=()=>{
    body.textContent='';
    body.append(h('div',{class:'note'},
      O.tr('Found ','Найдено ')+found.length+' '+O.tr('models at the provider.','моделей у провайдера.')+' '+
      O.tr('New: ','Новых: ')+fresh.length+'. '+
      (gone.length?O.tr('No longer offered: ','Больше не предлагаются: ')+gone.length+' ('+O.tr('kept, nothing is deleted','оставлены, ничего не удаляется')+').':'')));
    body.append(h('div',{class:'field'},h('label',null,O.tr('Endpoint','Адрес')),h('div',{class:'mono s mut',style:{wordBreak:'break-all'}},url)));
    if(usedKey){
      const idx=keys.indexOf(usedKey);
      body.append(h('div',{class:'note'},O.tr('Key used: ','Использован ключ: ')+'#'+(idx+1)+' · '+usedKey.slice(0,4)+'…'+usedKey.slice(-4)
        +(keys.length>1?' ('+O.tr('of ','из ')+keys.length+')':'')));
    }

    if(fresh.length){
      body.append(h('div',{class:'grp'},O.tr('New models','Новые модели')));
      const card=h('div',{class:'settings-card'});
      fresh.forEach(mid=>{
        const chk=h('input',{type:'checkbox',checked:true,style:{width:'auto',margin:'0 8px 0 0'}});
        chk.onchange=()=>{if(chk.checked)chosen.add(mid);else chosen.delete(mid)};
        card.append(h('label',{class:'settings-row',style:{cursor:'pointer'}},chk,h('div',{class:'settings-row-text'},h('b',{class:'mono'},mid))));
      });
      body.append(card);
      body.append(h('div',{style:{display:'flex',gap:'8px',marginTop:'10px'}},
        h('button',{class:'btn',onclick:()=>{fresh.forEach(m=>chosen.add(m));redraw()}},O.tr('Select all','Выбрать все')),
        h('button',{class:'btn',onclick:()=>{chosen.clear();redraw()}},O.tr('Clear','Снять'))));
    }else{
      body.append(h('div',{class:'card',style:{padding:'14px',textAlign:'center'}},O.icon('check','ok'),h('div',{style:{marginTop:'6px'}},O.tr('Catalogue is up to date','Каталог актуален'))));
    }
    if(gone.length){
      body.append(h('div',{class:'grp',style:{marginTop:'14px'}},O.tr('Missing at the provider','Отсутствуют у провайдера')));
      body.append(h('div',{class:'note'},gone.join(', ')));
    }
    body.append(h('button',{class:'btn pri wide',style:{marginTop:'14px'},onclick:async()=>{
      if(!chosen.size&&!fresh.length)return s.close();
      const cur=(cfgObj.provider||{})[pid]||{};
      cur.models=cur.models||{};
      chosen.forEach(mid=>{if(!cur.models[mid])cur.models[mid]={name:mid}});
      cfgObj.provider=cfgObj.provider||{};
      cfgObj.provider[pid]=cur;
      const w=O.native.cfgWrite(JSON.stringify(cfgObj,null,2));
      if(!w||!w.ok)return O.toast((w&&w.err)||O.tr('Cannot write config','Не удалось записать конфиг'),4000);
      try{await O.api('POST','/instance/dispose',null)}catch(_){}
      await O.loadMeta();
      O.toast(O.tr('Added models: ','Добавлено моделей: ')+chosen.size,2200);
      O.invalidateCache&&O.invalidateCache();
      s.close();
    }},O.icon('check'),O.tr('Add selected','Добавить выбранные')+' ('+chosen.size+')'));
  };
  redraw();
};

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
        h('button',{class:'ibtn s',title:O.tr('Up','Вверх'),onclick:()=>{O.moveModelFolder(f.id,-1);draw()}},O.icon('chevU')),
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
    const vis=(m.modalities&&Array.isArray(m.modalities.input)&&m.modalities.input.includes('image'))||
      (Array.isArray(m.modalities)&&m.modalities.includes('image'))||m.attachment===true;
    if(hasImg&&vis)s+=60;
    if(hasImg&&!vis)s-=40;
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

O.openAgents=()=>O.openAgentsPicker();

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
        conn.has(p.id)?h('button',{class:'ibtn s',title:O.tr('Update models from API','Обновить модели из API'),
          onclick:e=>{e.stopPropagation();O.refreshProviderModels(p.id)}},O.icon('refresh')):null,
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
    const ring=O.keyRingOf(p.id);
  const ringCard=h('div',null,
    h('div',{class:'grp',style:{marginTop:'12px'}},O.tr('Key ring','Несколько ключей')),
    h('div',{class:'note'},O.tr('Add more keys of the same provider: on a quota error the app switches to the next one automatically instead of failing the prompt.','Добавьте несколько ключей одного провайдера: при исчерпании квоты приложение само переключится на следующий, вместо ошибки запроса.')),
    ring.length?h('div',{class:'fchips',style:{margin:'6px 0'}},ring.map((k,i)=>h('span',{class:'chip keep',style:{fontSize:'12px'}},
      ('#'+(i+1)+' · '+k.slice(0,4)+'…'+k.slice(-4)),
      h('button',{class:'chip-x',style:{marginLeft:'4px',opacity:'.55'},onclick:()=>{O.keyRingSet(p.id,ring.filter((_,j)=>j!==i));sh.close();keyForm(p)}},O.icon('x'))))):null);
  const statusBoxAuto=h('div',{class:'mut s',style:{margin:'8px 0'}});
  const sh=O.sheet(name(p),h('div',null,h('div',{class:'field'},h('label',null,'API-ключ'),inp),ringCard,statusBoxAuto,
      p.id==='opencode'?h('div',{class:'note',style:{margin:'8px 0'}},'Получите ключ Zen на opencode.ai/zen. Бесплатные модели работают и без него.'):null,
      h('button',{class:'btn pri wide',onclick:async()=>{
        const key=inp.value.trim();if(!key)return;
        try{
          await api('PUT','/auth/'+p.id,{type:'api',key});
          // keep it in the ring as the active key so rotation has something to switch to
          const old=O.keyRingOf(p.id).filter(k=>k!==key);
          O.keyRingSet(p.id,[key].concat(old));
          O.store.set('keyRingIdx.'+p.id,0);
          // AUTO-PROBE (new): after saving a key for a known provider, pull its model list and
          // write it into the config so the models appear immediately (no manual "refresh").
          try{
            const base={
              openrouter:'https://openrouter.ai/api/v1',
              groq:'https://api.groq.com/openai/v1',
              openai:'https://api.openai.com/v1',
              anthropic:'https://api.anthropic.com/v1',
              deepseek:'https://api.deepseek.com/v1',
              mistral:'https://api.mistral.ai/v1',
              xai:'https://api.x.ai/v1',
              together:'https://api.together.xyz/v1',
              cerebras:'https://api.cerebras.ai/v1',
              groqcloud:'https://api.groq.com/openai/v1'
            }[p.id];
            if(base){
              statusBoxAuto.textContent=O.tr('Loading models…','Загружаю модели…');
              let list=null;
              try{list=await probeModels(base,key)}catch(e){
                statusBoxAuto.textContent=O.tr('Models not loaded: ','Модели не загрузились: ')+(e.message||e);
              }
              if(list&&list.length){
                const t2=O.native.cfgRead();let o2={};try{if(t2.trim())o2=O.parseJsonc(t2)}catch{}
                o2.provider=o2.provider||{};
                o2.provider[p.id]=Object.assign({name:name(p),npm:'@ai-sdk/openai',
                  options:{baseURL:base,apiKey:key}},o2.provider[p.id]||{});
                const mm={};list.forEach(mid=>{mm[mid]={name:mid}});
                o2.provider[p.id].models=mm;
                if(p.id==='openrouter')o2.provider[p.id].options.headers={'HTTP-Referer':'https://opencode.mobile','X-Title':'OpenCode Mobile'};
                O.native.cfgWrite(JSON.stringify(o2,null,2));
                O.toast(O.tr('Models loaded: ','Моделей загружено: ')+list.length,2200);
              }
            }
          }catch(_){}
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
      O.keyRingSet(p.id,[]);O.store.remove('keyRingIdx.'+p.id);
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
        O.native.copy('llama-server -m /root/models/model.gguf --port 8080 --host 127.0.0.1');
        O.toast(O.tr('Command copied','Команда скопирована'));
      }},O.icon('copy'),O.tr('Copy command','Скопировать команду')),
      h('button',{class:'btn sm',type:'button',onclick:()=>{
        idInp.value='llamacpp';nameInp.value='llama.cpp (local)';urlInp.value='http://127.0.0.1:8080/v1';keyInp.value='';
      }},O.icon('check'),O.tr('Use as provider','Использовать как провайдера'))));

  const probeBtn=h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:async()=>{
    let url=urlInp.value.trim().replace(/\/+$/,'');if(!url)return O.toast('Введите Base URL');
    if(!url.startsWith('http://')&&!url.startsWith('https://'))url='https://'+url;
    urlInp.value=url;const key=keyInp.value.trim();
    const local=/127\.0\.0\.1|localhost/.test(url);
    // A remote provider without a key answers 401/402/429 — that is not a useful "model list".
    if(!key&&!local){
      statusBox.textContent=O.tr('Enter an API key first: unauthenticated probes return 401/402/429.','Сначала введите API-ключ: прозвон без авторизации возвращает 401/402/429.');
      O.toast(O.tr('API key required','Нужен API-ключ'),2600);
      try{keyInp.focus()}catch(_){}
      return;
    }
    probeBtn.disabled=true;statusBox.textContent='Прозваниваю API...';
    try{
      const extra=(url.includes('openrouter.ai')||idInp.value==='openrouter')
        ?{'HTTP-Referer':'https://opencode.mobile','X-Title':'OpenCode Mobile'}:{};
      foundModels=await probeModels(url,key,extra);
      if(!foundModels.length){statusBox.textContent='Ответ получен, но список моделей пуст.';modelList.classList.add('hide');return}
      statusBox.textContent='Найдено '+foundModels.length+' моделей:';
      modelList.textContent='';modelList.classList.remove('hide');sel.clear();
      foundModels.forEach(mid=>{sel.add(mid);
        const chk=h('input',{type:'checkbox',checked:true,style:{width:'auto',margin:'0 8px 0 0'}});
        chk.onchange=()=>{if(chk.checked)sel.add(mid);else sel.delete(mid)};
        modelList.append(h('label',{style:{display:'flex',alignItems:'center',padding:'5px 4px',fontSize:'13px',cursor:'pointer'}},chk,h('span',{class:'mono grow'},mid)))});
      O.toast('Найдено моделей: '+foundModels.length,2000);
    }catch(e){statusBox.textContent='Ошибка: '+(e.message||e);O.toast('Ошибка прозвона: '+(e.message||e),4000)}
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
    // AUTO-PROBE (new): the config alone is not enough — a provider added without a model list
    // showed up empty until the user pressed "refresh". Probe the endpoint now, write the real
    // model catalogue into the config, and only then restart the core once.
    let probed=0;
    try{
      if((sel.size===0||sel.has('default'))&&(key||/127\.0\.0\.1|localhost/.test(url))){
        probeBtn.disabled=true;statusBox.textContent=O.tr('Auto-loading models…','Автоподгружаю модели…');
        const list=await probeModels(url,key);
        if(list&&list.length){
          const freshModels={};
          list.forEach(mid=>{freshModels[mid]={name:mid}});
          obj.provider[pid].models=freshModels;
          O.native.cfgWrite(JSON.stringify(obj,null,2));
          probed=list.length;
        }
      }
    }catch(_){/* offline or blocked: keep what the user picked */}
    try{await api('POST','/instance/dispose',null)}catch(_){}
    await O.loadMeta();
    const total=probed||Object.keys(mo).length;
    O.toast(probed
      ? O.tr('Provider '+pname+' connected, '+probed+' models loaded','Провайдер '+pname+' подключён, моделей загружено: '+probed)
      : 'Провайдер '+pname+' подключён ('+total+' моделей)!',3000);
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
// Theme picker lives in themes.js (24 built-ins + custom themes with live editor).
O.openHelp=()=>O.sheet('Справка',h('div',null,h('div',{class:'grp'},'Команды'),O.builtins.map(b=>O.listRow(b.i,'/'+b.n,b.d,null,()=>{O.back();b.run()})),
  h('div',{class:'grp'},'Подсказки ввода'),h('div',{class:'note'},'@файл — упомянуть файл или папку.  !команда — выполнить команду оболочки в сессии.  Долгое нажатие на файл в дереве открывает действия.')));
})();
