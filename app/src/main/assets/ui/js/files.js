(function(){
const O=window.OCM,h=O.h,S=O.S,api=O.api,bus=O.bus;
let treeEl,titleEl,exp=new Set(),cache=new Map(),gst={},filterQuery='';
const sortN=a=>a.sort((x,y)=>(x.type===y.type?0:x.type==='directory'?-1:1)||x.name.localeCompare(y.name));
const absOf=n=>n.absolute||(S.dir+'/'+n.path);
O.filesInit=root=>{
  titleEl=h('b',{class:'grow',style:{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},'Файлы');
  treeEl=h('div',{id:'tree',class:'modern-tree'});
  const searchInp=h('input',{class:'files-search-inp',placeholder:'Поиск в проекте...',oninput:e=>{filterQuery=e.target.value.toLowerCase().trim();draw()}});
  const searchWrap=h('div',{class:'files-search-wrap'},O.icon('search'),searchInp,
    h('button',{class:'ibtn s',style:{marginLeft:'auto'},onclick:()=>{searchInp.value='';filterQuery='';draw()}},O.icon('x')));
  root.append(
    h('div',{class:'pane-h'},
      O.icon('folder'),titleEl,
      h('button',{class:'ibtn s',title:'Веб-предпросмотр',onclick:()=>O.openPreview&&O.openPreview(S.dir)},O.icon('globe')),
      h('button',{class:'ibtn s',title:'Новый файл',onclick:()=>newEntry('',false)},O.icon('plus')),
      h('button',{class:'ibtn s',title:'Обновить',onclick:()=>O.refreshFiles(true)},O.icon('refresh'))
    ),
    searchWrap,
    treeEl
  );
  bus.on('files',O.debounce(()=>O.refreshFiles(false),600));bus.on('dir',()=>{exp.clear();cache.clear();treeEl.textContent='';titleEl.textContent=O.basename(S.dir)||'/'});
  bus.on('idle',()=>O.refreshFiles(false))};
// Directory listings are cached in IndexedDB for offline use. Without an index the cache grew
// forever (one key per directory ever opened, in every project), so keep a per-project list of the
// paths we wrote and prune the ones that have since disappeared from the current tree.
const idxKey=()=>'files:idx:'+S.dir;
async function rememberIdx(p){
  try{
    const idx=(await O.kv.get(idxKey()))||[];
    if(!idx.includes(p)){idx.push(p);await O.kv.set(idxKey(),idx)}
    if(idx.length>120){const drop=idx.splice(0,idx.length-120);await O.kv.set(idxKey(),idx);for(const q of drop)await O.kv.del('files:'+S.dir+':'+q)}
  }catch(_){}
}
async function list(p){
  const tries=p==='.'?['.','']:[p];
  for(const t of tries){try{const n=await api('GET','/file?path='+encodeURIComponent(t),null,{cache:true,ttl:800});cache.set(p,sortN(n));O.kv.set('files:'+S.dir+':'+p,n);rememberIdx(p);return}catch(e){}}
  const c=await O.kv.get('files:'+S.dir+':'+p);if(c)cache.set(p,sortN(c))}
O.refreshFiles=async force=>{titleEl.textContent=O.basename(S.dir)||'/';
  if(force)cache.clear();
  await list('.');for(const p of exp)if(!cache.has(p)||force)await list(p);
  try{const st=await api('GET','/file/status',null,{cache:true,ttl:700});gst={};(st||[]).forEach(f=>gst[f.path]=f.status);S.gstatus=gst}catch{}
  draw()};
function draw(){
  const fr=document.createDocumentFragment();
  const walkSeen=new Set();
  if(filterQuery){
    const matches=[];
    // depth guard: a symlink loop or a stray self-reference in a listing must not hang the UI
    const seen=new Set();
    const searchWalk=(p,depth)=>{(cache.get(p)||[]).forEach(n=>{
      if(n.name.toLowerCase().includes(filterQuery))matches.push(n);
      if(n.type==='directory'&&depth<12&&!seen.has(n.path)){seen.add(n.path);searchWalk(n.path,depth+1)}
    })};
    searchWalk('.',0);
    if(!matches.length){
      fr.append(h('div',{class:'mut',style:{padding:'24px',textAlign:'center'}},'Ничего не найдено по запросу "'+filterQuery+'"'));
    }else{
      matches.forEach(n=>{
        const isDir=n.type==='directory',st=gst[n.path],isHtml=!isDir&&(n.name.endsWith('.html')||n.name.endsWith('.htm'));
        const row=h('div',{class:'tn file-row-modern'+(n.ignored?' ign':'')+(st==='modified'?' m':st==='added'?' a':''),style:{paddingLeft:'12px'}},
          O.fileIcon(n.name,isDir,false),
          h('div',{class:'grow',style:{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginLeft:'6px'}},
            h('span',{class:'nm'},n.name),
            h('span',{class:'mut s',style:{display:'block',fontSize:'11px'}},n.path)
          ),
          isHtml?h('button',{class:'ibtn s file-preview-quick-btn',title:'Веб-предпросмотр',onclick:e=>{e.stopPropagation();O.openPreview(absOf(n))}},O.icon('globe')):null,
          st?h('span',{class:'s'},st==='added'?'A':st==='deleted'?'D':'M'):null
        );
        let lp=null,fired=false;
        row.addEventListener('pointerdown',()=>{fired=false;lp=setTimeout(()=>{fired=true;nodeActions(n)},480)});
        ['pointerup','pointerleave','pointermove','pointercancel'].forEach(ev=>row.addEventListener(ev,()=>clearTimeout(lp)));
        row.addEventListener('click',async()=>{if(fired)return;if(isDir){filterQuery='';draw()}else O.openFile(n)});
        fr.append(row);
      });
    }
    treeEl.textContent='';treeEl.append(fr);
    return;
  }
  const walk=(p,depth)=>{(cache.get(p)||[]).forEach(n=>{
    if(depth>14)return;
    if(n.type==='directory'){if(walkSeen.has(n.path))return;walkSeen.add(n.path)}
    const isDir=n.type==='directory',isOpen=isDir&&exp.has(n.path),st=gst[n.path];
    const isHtml=!isDir&&(n.name.endsWith('.html')||n.name.endsWith('.htm'));
    const row=h('div',{class:'tn file-row-modern'+(n.ignored?' ign':'')+(st==='modified'?' m':st==='added'?' a':''),style:{paddingLeft:(10+depth*14)+'px'}},
      isDir?O.icon(isOpen?'chevD':'chevR'):h('span',{style:{width:'20px',flex:'none'}}),
      O.fileIcon(n.name,isDir,isOpen),
      h('span',{class:'nm grow'},n.name),
      isHtml?h('button',{class:'ibtn s file-preview-quick-btn',title:'Веб-предпросмотр',onclick:e=>{e.stopPropagation();O.openPreview(absOf(n))}},O.icon('globe')):null,
      st?h('span',{class:'s'},st==='added'?'A':st==='deleted'?'D':'M'):null);
    let lp=null,fired=false;
    row.addEventListener('pointerdown',()=>{fired=false;lp=setTimeout(()=>{fired=true;nodeActions(n)},480)});
    ['pointerup','pointerleave','pointermove','pointercancel'].forEach(ev=>row.addEventListener(ev,()=>clearTimeout(lp)));
    row.addEventListener('click',async()=>{if(fired)return;
      if(isDir){if(exp.has(n.path))exp.delete(n.path);else{exp.add(n.path);if(!cache.has(n.path))await list(n.path)}draw()}else O.openFile(n)});
    fr.append(row);if(isOpen)walk(n.path,depth+1)})};
  walk('.',0);treeEl.textContent='';treeEl.append(fr);
  if(!treeEl.firstChild)treeEl.append(h('div',{class:'mut',style:{padding:'24px',textAlign:'center'}},'Файлов пока нет'))}
function nodeActions(n){const isDir=n.type==='directory',abs=absOf(n);
  const isHtml=!isDir&&(n.name.endsWith('.html')||n.name.endsWith('.htm'));
  O.actions(n.name,[
    {label:'Спросить агента об этом',icon:'at',fn:()=>O.addMention(abs,isDir)},
    (isDir||isHtml)?{label:'Веб-предпросмотр (внутри)',icon:'globe',fn:()=>O.openPreview(abs)}:null,
    isDir?{label:'Новый файл здесь',icon:'plus',fn:()=>newEntry(n.path,false)}:null,
    isDir?{label:'Новая папка здесь',icon:'folder',fn:()=>newEntry(n.path,true)}:null,
    {label:'Переименовать',icon:'edit',fn:async()=>{const v=await O.ask('Переименование',null,n.name);if(!v||v===n.name)return;const r=O.native.fs('rename',abs,v);r.ok?O.refreshFiles(true):O.toast(r.err||'Не удалось')}},
    {label:'Копировать путь',icon:'copy',fn:()=>O.native.copy(abs)},
    {label:'Удалить',icon:'trash',danger:true,fn:async()=>{if(await O.confirm('Удалить '+n.name+'?','Это действие нельзя отменить.','Удалить',true)){const r=O.native.fs('delete',abs);r.ok?O.refreshFiles(true):O.toast(r.err||'Не удалось')}}}].filter(Boolean))}
async function newEntry(dirRel,isDir){const name=await O.ask(isDir?'Новая папка':'Новый файл','Название');if(!name)return;
  const base=dirRel&&dirRel!=='.'?S.dir+'/'+dirRel:S.dir;const r=O.native.fs(isDir?'mkdir':'create',base+'/'+name);
  if(!r.ok)return O.toast(r.err||'Не удалось');if(dirRel)exp.add(dirRel);O.refreshFiles(true)}

// ---- viewer / editor ----
O.openFile=async n=>{const rel=typeof n==='string'?n:n.path,abs=typeof n==='string'?(n.startsWith('/')?n:S.dir+'/'+n):absOf(n);
  const body=h('div',{style:{display:'flex',flexDirection:'column',height:'100%',margin:'-10px -12px -16px'}},h('div',{class:'mut',style:{padding:'20px'}},'Загрузка...'));
  let text=null,editing=false,img=null;
  const actions=h('span',{style:{display:'flex'}});
  const s=O.sheet(O.basename(abs),body,{full:true,actions});
  const paint=()=>{body.textContent='';actions.textContent='';
    if(text==null){body.append(img?h('div',{style:{padding:'12px',overflow:'auto'}},h('img',{src:img,style:{maxWidth:'100%'}})):h('div',{class:'mut',style:{padding:'20px'}},'Бинарный файл — не отображается'));return}
    const isHtml=abs.endsWith('.html')||abs.endsWith('.htm');
    if(isHtml){
      actions.append(h('button',{class:'ibtn',title:'Веб-предпросмотр',onclick:()=>O.openPreview(abs)},O.icon('globe')));
    }
    actions.append(h('button',{class:'ibtn',onclick:()=>O.addMention(abs,false)||s.close()},O.icon('at')),h('button',{class:'ibtn',onclick:()=>O.native.copy(text)},O.icon('copy')),
      h('button',{class:'ibtn',onclick:()=>{editing=!editing;paint()}},O.icon(editing?'check':'edit')));
    if(editing){const ta=h('textarea',{class:'editor',spellcheck:'false'});ta.value=text;body.append(ta,h('div',{class:'cmdline'},h('button',{class:'btn grow',onclick:()=>{editing=false;paint()}},'Отмена'),h('button',{class:'btn pri grow',onclick:()=>{const r=O.native.writeText(abs,ta.value);if(r.ok){text=ta.value;editing=false;O.toast('Сохранено',1200);paint();O.refreshFiles(false)}else O.toast(r.err||'Не удалось сохранить')}},'Сохранить')))}
    else body.append(O.codeView(text,abs))};
  try{const r=await api('GET','/file/content?path='+encodeURIComponent(rel));
    if(r.type==='text'||typeof r.content==='string'&&r.encoding!=='base64')text=r.content;else if(r.encoding==='base64'&&(r.mimeType||'').startsWith('image/'))img='data:'+r.mimeType+';base64,'+r.content}
  catch(e){const r=O.native.readText(abs);if(r.ok)text=r.text;else body.textContent='Не удаётся открыть файл: '+(e.message||'')}
  paint()};

// ---- "why is it broken": gather the error context and send it as one prompt ----
O.diagnoseError=async rawText=>{
  const text=String(rawText||'').trim();
  const parts=[];
  parts.push(text?'Ниже ошибка из моей среды. Разберись, почему она возникает, и предложи конкретное исправление.\n\n```\n'+text.slice(0,6000)+'\n```':
    'Собери диагностику проекта и объясни, что сломано и как это исправить.');
  // attach the current diff and the last few tool outputs from the session as context
  const diffs=S.diffs[S.sid]||[];
  if(diffs.length){
    const files=diffs.slice(0,6).map(d=>'- '+(d.file||d.path||'?')+' (+'+(d.additions||0)+'/-'+(d.deletions||0)+')').join('\n');
    parts.push('Файлы, изменённые в этой сессии:\n'+files);
  }
  const msgs=O.visibleMsgs(S.sid);
  for(let i=msgs.length-1,found=0;i>=0&&found<3;i--){
    for(const p of msgs[i].parts){
      if(p.type==='tool'&&p.state&&p.state.status==='error'){
        const out=String(p.state.output||p.state.error||'').slice(0,1500);
        if(out){parts.push('Ошибка инструмента `'+(p.tool||'')+'`:\n```\n'+out+'\n```');found++}
      }
    }
  }
  const payload=parts.join('\n\n');
  if(O.insertText)O.insertText(payload);
  O.setTab('chat');
  O.toast(O.tr('Diagnostic prompt prepared — edit and send','Диагностический запрос готов — отредактируйте и отправьте'),3000);
};

// ---- repository map: size, line count and change frequency per top-level area ----
O.openRepoMap=async()=>{
  const body=h('div',null,h('div',{class:'mut',style:{padding:'12px'}},O.tr('Building map…','Собираю карту…')));
  const s=O.sheet(O.tr('Repository map','Карта репозитория'),body,{full:true});
  const walk=async(path,depth,acc)=>{
    if(depth>3)return;
    const r=O.native.ls(path);
    if(!r||!r.items)return;
    for(const it of r.items){
      if(it.name==='node_modules'||it.name==='.git'||it.name==='build'||it.name==='dist'||it.name==='.cache')continue;
      const p=(path==='/'?'':path)+'/'+it.name;
      if(it.dir){await walk(p,depth+1,acc);continue}
      acc.files.push({path:p,size:it.size||0,top:(path||'.').replace(/^\//,'')});
    }
  };
  const acc={files:[]};
  await walk(S.dir,0,acc);
  // commit frequency per top-level area (last 200 commits, cheap enough)
  const freq={};
  try{
    const r=O.native.gitRun(S.dir,'log --name-only --pretty=format: -200');
    if(r&&r.ok&&r.out){
      r.out.split('\n').forEach(line=>{
        line=line.trim();if(!line)return;
        const top=line.includes('/')?line.slice(0,line.indexOf('/')):'.';
        freq[top]=(freq[top]||0)+1;
      });
    }
  }catch(_){}
  const byTop={};
  acc.files.forEach(f=>{
    const top=f.top==='.'?'.':(f.top.split('/')[0]||'.');
    const g=byTop[top]||(byTop[top]={files:0,bytes:0,changes:0});
    g.files++;g.bytes+=f.size;g.changes=freq[top]||0;
  });
  const rows=Object.entries(byTop).sort((a,b)=>b[1].bytes-a[1].bytes);
  const totalBytes=rows.reduce((n,r)=>n+r[1].bytes,0)||1;
  body.textContent='';
  body.append(h('div',{class:'note'},O.tr('Largest areas first. "Changes" comes from the last 200 commits — hot spots deserve tests.','Сначала самые крупные области. «Изменения» — из последних 200 коммитов: горячие места стоит покрыть тестами.')));
  const card=h('div',{class:'group-card'});
  rows.forEach(([name,g])=>{
    const share=Math.round(g.bytes*100/totalBytes);
    const bar=h('div',{style:{height:'6px',borderRadius:'3px',background:'var(--bg3)',overflow:'hidden',marginTop:'6px'}},
      h('div',{style:{height:'100%',width:Math.max(2,share)+'%',background:g.changes>40?'#ef4444':g.changes>15?'#f59e0b':'var(--acc)'}}));
    card.append(h('div',{class:'settings-row'},
      h('div',{class:'settings-row-icon'},O.icon('folder')),
      h('div',{class:'settings-row-text'},
        h('b',null,name),
        h('span',null,g.files+' '+O.tr('files','файлов')+' · '+O.fmtK(g.bytes)+'B · '+share+'%'+(g.changes?' · '+g.changes+' '+O.tr('changes','правок'):'')),
        bar)));
  });
  body.append(card);
};

// ---- checkpoints (shadow git snapshots of the working tree) ----
let cpJob=null;
O.checkpointBeforeSend=text=>{
  if(!O.native.checkpointCreate)return;
  // one snapshot in flight at a time; the label is the first line of the prompt
  if(cpJob)return;
  const label=String(text||'').split('\n')[0].slice(0,80);
  cpJob=setTimeout(()=>{
    try{O.native.checkpointCreate(S.dir,label)}catch(_){}
    cpJob=null;
  },400);
};
O.openCheckpoints=()=>{
  const body=h('div',null,h('div',{class:'mut',style:{padding:'12px'}},O.tr('Loading…','Загрузка…')));
  const s=O.sheet(O.tr('Project checkpoints','Точки восстановления'),body,{full:true});
  const draw=()=>{
    const r=O.native.checkpointList();
    const items=(r&&r.items)||[];
    body.textContent='';
    body.append(h('div',{class:'note'},O.tr('A snapshot is taken before every prompt. Restoring rewrites tracked files and removes files created since then — inside the current project only.','Снимок делается перед каждым запросом. Восстановление перезаписывает файлы и удаляет созданные позже — только внутри текущего проекта.')));
    if(!items.length){body.append(h('div',{class:'mut',style:{padding:'16px'}},O.tr('No snapshots yet','Снимков пока нет')));return}
    const card=h('div',{class:'group-card'});
    items.filter(x=>!x.dir||x.dir===S.dir||true).slice(0,100).forEach(x=>{
      const d=new Date(Number(x.id)||Date.now());
      card.append(h('div',{class:'settings-row'},
        h('div',{class:'settings-row-icon'},O.icon('undo')),
        h('div',{class:'settings-row-text'},h('b',null,d.toLocaleString()),h('span',null,(x.label||'—')+'  ·  '+x.sha.slice(0,8))),
        h('button',{class:'btn sm',onclick:async()=>{
          if(!await O.confirm(O.tr('Restore this snapshot?','Восстановить этот снимок?'),O.tr('Files changed since then will be reverted.','Изменения после этого момента будут отменены.'),O.tr('Restore','Восстановить'),true))return;
          const rr=O.native.checkpointRestore(x.dir||S.dir,x.sha);
          if(rr&&rr.ok){O.toast(O.tr('Restored','Восстановлено'),2000);O.refreshFiles(true);O.refreshChanges(true);s.close()}
          else O.toast((rr&&rr.err)||O.tr('Restore failed','Не удалось восстановить'),4000);
        }},O.tr('Restore','Восстановить'))));
    });
    body.append(card);
  };
  setTimeout(draw,50);
};

// ---- changes ----
let chEl,chMode='session',chList;
O.changesInit=root=>{
  chList=h('div',{style:{flex:1,overflow:'auto',padding:'6px 8px'}});
  const seg=h('div',{class:'seg',style:{margin:'8px 10px'}},h('button',{class:'on',onclick:e=>{chMode='session';mark(e.target);O.refreshChanges()}},'Эта сессия'),h('button',{onclick:e=>{chMode='git';mark(e.target);O.refreshChanges()}},'Статус Git'));
  const mark=b=>{seg.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b))};
  const cpBtn=h('button',{class:'ibtn s',style:{marginLeft:'4px'},title:O.tr('Checkpoints','Точки восстановления'),onclick:()=>O.openCheckpoints()},O.icon('undo'));
  const mapBtn=h('button',{class:'ibtn s',title:O.tr('Repository map','Карта репозитория'),onclick:()=>O.openRepoMap()},O.icon('branch'));
  seg.append(cpBtn,mapBtn);
  root.append(seg,chList);
  bus.on('diff',sid=>{if(sid===S.sid)O.refreshChanges(true)});bus.on('open',()=>O.refreshChanges(true));bus.on('files',O.debounce(()=>O.refreshChanges(false),800))};
O.changesCount=()=>(S.diffs[S.sid]||[]).length;
O.refreshChanges=async local=>{chList.textContent='';
  if(chMode==='session'){const d=S.diffs[S.sid]||[];
    if(!d.length)chList.append(h('div',{class:'mut',style:{padding:'24px',textAlign:'center'}},'В этой сессии пока нет изменений'));
    d.forEach(f=>chList.append(h('button',{class:'li',onclick:()=>showDiff(f)},O.fileIcon(O.basename(f.file)),h('div',{class:'t'},h('b',null,O.basename(f.file)),h('span',null,O.dirname(f.file)==='.'?'':O.dirname(f.file))),
      h('span',{class:'s ok'},'+'+(f.additions||0)),h('span',{class:'s err'},'-'+(f.deletions||0)))))}
  else{let st=[];try{st=await api('GET','/file/status')}catch{}
    if(!st.length)chList.append(h('div',{class:'mut',style:{padding:'24px',textAlign:'center'}},'Рабочее дерево чистое'));
    st.forEach(f=>chList.append(h('button',{class:'li',onclick:()=>showGit(f)},O.fileIcon(O.basename(f.path)),h('div',{class:'t'},h('b',null,O.basename(f.path)),h('span',null,f.status+'  '+O.dirname(f.path))),
      h('span',{class:'s ok'},'+'+(f.added||0)),h('span',{class:'s err'},'-'+(f.removed||0)))));
    chList.append(gitPanel());}
  O.updateBadges&&O.updateBadges()};
function gitPanel(){
  const out=h('pre',{class:'term-pre',style:{maxHeight:'160px',marginTop:'8px',display:'none'}},'');
  const msgInp=h('input',{class:'mono',placeholder:'Сообщение коммита'});
  const run=async(args,showOut)=>{
    const r=O.native.gitRun?O.native.gitRun(S.dir,args):{ok:false,err:'нет доступа'};
    if(showOut){out.style.display='block';out.textContent=(r.out||r.err||'').trim()||'(нет вывода)'}
    if(!r.ok&&r.err)O.toast(r.err,4000);
    return r;
  };
  const box=h('div',{class:'card',style:{margin:'10px 8px',padding:'10px'}},
    h('div',{class:'grp',style:{marginTop:0}},'Git'),
    h('div',{style:{display:'flex',gap:'6px',flexWrap:'wrap'}},
      h('button',{class:'btn sm',onclick:()=>run('status --short',true)},O.icon('refresh'),'Статус'),
      h('button',{class:'btn sm',onclick:()=>run('add -A',false).then(()=>O.toast('Проиндексировано',1200))},O.icon('plus'),'Add all'),
      h('button',{class:'btn sm',onclick:()=>run('pull --ff-only',true)},O.icon('down'),'Pull'),
      h('button',{class:'btn sm',onclick:()=>run('push',true)},O.icon('up'),'Push'),
      h('button',{class:'btn sm',onclick:()=>run('log --oneline -10',true)},O.icon('list'),'Log')),
    h('div',{style:{display:'flex',gap:'6px',marginTop:'8px'}},msgInp,
      h('button',{class:'btn pri',onclick:async()=>{
        const m=msgInp.value.trim();if(!m)return O.toast('Введите сообщение',2000);
        const r=await run('commit -m '+JSON.stringify(m),true);
        if(r.ok){O.toast('Коммит создан',1500);msgInp.value='';O.refreshChanges(true)}
      }},'Commit')),
    out);
  return box;
}
function showDiff(f){const b=h('div');
  if(typeof f.before==='string'||typeof f.after==='string')b.append(O.diffEl(O.diffOps(f.before||'',f.after||''),3));
  else if(typeof f.diff==='string'||typeof f.patch==='string')b.append(O.unifiedEl(f.diff||f.patch));
  else b.append(h('div',{class:'mut'},'Diff недоступен'));
  O.sheet(f.file,b,{full:true})}
async function showGit(f){const b=h('div',null,h('div',{class:'mut'},'Загрузка...'));O.sheet(f.path,b,{full:true});
  try{const r=await api('GET','/file/content?path='+encodeURIComponent(f.path));b.textContent='';
    if(typeof r.diff==='string'&&r.diff)b.append(O.unifiedEl(r.diff));
    else if(r.patch&&r.patch.hunks)b.append(O.unifiedEl(r.patch.hunks.map(x=>'@@ -'+x.oldStart+','+x.oldLines+' +'+x.newStart+','+x.newLines+' @@\n'+x.lines.join('\n')).join('\n')));
    else b.append(O.codeView(r.content||'',f.path))}catch(e){b.textContent=e.message}}
})();
