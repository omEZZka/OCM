(function(){
const O=window.OCM,h=O.h,S=O.S,bus=O.bus;
// ==========================================================================
// Real file manager + viewer
// Native listings (no server round-trip), breadcrumbs, multi-select bulk ops,
// copy/move/rename/delete, upload, sort, hidden files, and a proper viewer.
// ==========================================================================
const ROOTS=[
  {label:'Проект',icon:'folder',path:()=>S.dir},
  {label:'Загрузки',icon:'down',path:()=>'/sdcard/Download'},
  {label:'Внутренняя',icon:'memory',path:()=>'/root'},
  {label:'Картинки',icon:'image',path:()=>'/sdcard/DCIM'},
  {label:'Документы',icon:'doc',path:()=>'/sdcard/Documents'}
];
const HOME=()=>S.dir||'/root';
const join=(dir,name)=>dir==='/'?('/'+name):(dir.replace(/\/+$/,'')+'/'+name);
const parent=p=>{p=String(p||'/').replace(/\/+$/,'');const i=p.lastIndexOf('/');return i<=0?'/':p.slice(0,i)};
const IMG=/\.(png|jpe?g|webp|gif|bmp|svg|heic)$/i;
const VID=/\.(mp4|webm|mov|mkv|avi)$/i;
const AUD=/\.(mp3|wav|m4a|ogg|flac|opus)$/i;
const TXT=/\.(txt|md|markdown|json|jsonc|js|mjs|cjs|ts|tsx|jsx|css|scss|html|htm|xml|yml|yaml|toml|ini|cfg|conf|env|py|kt|java|go|rs|c|cpp|h|hpp|cs|php|rb|lua|sh|bash|zsh|sql|gradle|properties|gitignore|dockerfile|lock)$/i;

let st={dir:HOME(),sort:'name',asc:true,hidden:false,sel:new Set(),selMode:false,clip:null,items:[],q:''};

function fmtSize(n){
  n=Number(n)||0;
  if(n<1024)return n+' B';
  if(n<1024*1024)return (n/1024).toFixed(n<10240?1:0)+' KB';
  if(n<1024*1024*1024)return (n/1048576).toFixed(1)+' MB';
  return (n/1073741824).toFixed(2)+' GB';
}
function listDir(path){
  const r=O.native.ls(path);
  if(!r||r.ok===false||!Array.isArray(r.items))return{items:[],err:(r&&r.err)||'Нет доступа'};
  return{items:r.items.map(it=>{
    const isDir=!!it.dir;
    return{name:it.name,dir:isDir,size:it.size||0,path:join(path,it.name)};
  }),err:''};
}
function visibleItems(){
  let items=st.items.filter(it=>st.hidden||!it.name.startsWith('.'));
  if(st.q){const q=st.q.toLowerCase();items=items.filter(it=>it.name.toLowerCase().includes(q))}
  const mul=st.asc?1:-1;
  items.sort((a,b)=>{
    if(a.dir!==b.dir)return a.dir?-1:1;
    if(st.sort==='size')return ((a.size||0)-(b.size||0))*mul;
    if(st.sort==='date')return 0; // ls has no mtime; keep name order
    return a.name.localeCompare(b.name,'ru')*mul;
  });
  return items;
}

// ---- UI ----
O.openFileManager=(start)=>{
  if(start)st.dir=start;
  const body=h('div',{class:'fm'});
  let s=null;
  const crumbs=h('div',{class:'fm-crumbs'});
  const toolbar=h('div',{class:'fm-toolbar'});
  const listEl=h('div',{class:'fm-list'});
  const footer=h('div',{class:'fm-footer hide'});
  const searchInp=h('input',{class:'fm-search',placeholder:O.tr('Filter this folder…','Фильтр в этой папке…'),
    oninput:e=>{st.q=e.target.value;drawList()}});

  const navigate=async(dir,keepSel)=>{
    st.dir=dir||'/';
    if(!keepSel){st.sel.clear();st.selMode=false}
    st.q='';searchInp.value='';
    O.store.set('fm.lastDir',st.dir);
    drawAll();
  };
  const refresh=()=>drawAll();
  const drawCrumbs=()=>{
    crumbs.textContent='';
    const parts=st.dir.split('/').filter(Boolean);
    crumbs.append(h('button',{class:'fm-crumb root',onclick:()=>navigate('/')},O.icon('folder'),'/'));
    let acc='';
    parts.forEach((p,i)=>{
      acc+='/'+p;
      const path=acc;
      crumbs.append(h('span',{class:'fm-sep'},'›'),
        h('button',{class:'fm-crumb'+(i===parts.length-1?' cur':''),onclick:()=>navigate(path)},p));
    });
  };
  const drawToolbar=()=>{
    toolbar.textContent='';
    const rootBtn=(r)=>h('button',{class:'fm-root'+(st.dir===r.path()?' on':''),onclick:()=>navigate(r.path())},O.icon(r.icon),h('span',null,r.label));
    // rows: roots scroller + action icons
    const roots=h('div',{class:'fm-roots'},ROOTS.map(rootBtn));
    const actions=h('div',{class:'fm-actions'},
      h('button',{class:'ibtn s',title:O.tr('Up','Вверх'),onclick:()=>navigate(parent(st.dir))},O.icon('chevU')),
      h('button',{class:'ibtn s',title:O.tr('Refresh','Обновить'),onclick:refresh},O.icon('refresh')),
      h('button',{class:'ibtn s',title:O.tr('New folder','Новая папка'),onclick:()=>mkNew(true)},O.icon('folder')),
      h('button',{class:'ibtn s',title:O.tr('New file','Новый файл'),onclick:()=>mkNew(false)},O.icon('plus')),
      h('button',{class:'ibtn s'+(st.hidden?' on':''),title:O.tr('Hidden files','Скрытые файлы'),onclick:()=>{st.hidden=!st.hidden;drawAll()}},O.icon('eye')),
      h('button',{class:'ibtn s',title:O.tr('Upload from phone','Загрузить с телефона'),onclick:()=>upload()},O.icon('up')),
      h('button',{class:'ibtn s',title:O.tr('Sort','Сортировка'),onclick:()=>sortMenu()},O.icon('list')));
    toolbar.append(roots,actions,searchInp);
  };
  const drawFooter=()=>{
    footer.textContent='';
    const n=st.sel.size;
    footer.classList.toggle('hide',!st.selMode);
    if(!st.selMode)return;
    footer.append(h('span',{class:'fm-selcount grow'},n?O.tr(n+' selected','Выбрано: '+n):O.tr('Select files','Выберите файлы')),
      h('button',{class:'ibtn s',title:O.tr('Copy','Копировать'),disabled:!n,onclick:()=>clip('copy')},O.icon('copy')),
      h('button',{class:'ibtn s',title:O.tr('Move','Переместить'),disabled:!n,onclick:()=>clip('move')},O.icon('drag')),
      h('button',{class:'ibtn s',title:O.tr('Share','Поделиться'),disabled:!n,onclick:()=>shareSel()},O.icon('share')),
      h('button',{class:'ibtn s',title:O.tr('Delete','Удалить'),disabled:!n,onclick:()=>delSel()},O.icon('trash')),
      h('button',{class:'ibtn s',title:O.tr('Done','Готово'),onclick:()=>{st.selMode=false;st.sel.clear();drawAll()}},O.icon('check')));
    // clipboard hint / paste action
    if(st.clip&&st.clip.paths.length){
      footer.append(h('button',{class:'btn sm pri',style:{marginLeft:'6px'},onclick:()=>pasteHere()},
        O.icon('down'),O.tr('Paste ','Вставить ')+st.clip.paths.length));
    }
  };
  const drawList=()=>{
    const items=visibleItems();
    listEl.textContent='';
    if(!items.length){
      listEl.append(h('div',{class:'fm-empty mut'},O.icon('folder'),
        h('span',null,st.q?O.tr('Nothing matches','Ничего не найдено'):(st.err?O.tr('No access: ','Нет доступа: ')+st.err:O.tr('This folder is empty','Папка пуста')))));
      drawFooter();return;
    }
    const fr=document.createDocumentFragment();
    items.forEach(it=>{
      const selected=st.sel.has(it.path);
      const row=h('div',{class:'fm-row'+(it.dir?' dir':'')+(selected?' sel':'')+(st.clip&&st.clip.paths.includes(it.path)?' cut':'')},
        st.selMode?h('span',{class:'fm-check'+(selected?' on':'')},selected?O.icon('check'):null):null,
        it.dir?h('span',{class:'fm-chev'},O.icon('chevR')):null,
        O.fileIcon(it.name,it.dir,false),
        h('div',{class:'fm-name-wrap'},
          h('span',{class:'fm-name'},it.name),
          h('span',{class:'fm-sub'},it.dir?O.tr('folder','папка'):fmtSize(it.size))),
        h('button',{class:'ibtn s',title:O.tr('More','Действия'),onclick:e=>{e.stopPropagation();itemActions(it)}},O.icon('dots')));
      let lp=null,fired=false;
      row.addEventListener('pointerdown',()=>{fired=false;lp=setTimeout(()=>{fired=true;st.selMode=true;st.sel.add(it.path);O.native.haptic&&O.native.haptic('tick');drawList();drawFooter()},480)});
      ['pointerup','pointerleave','pointermove','pointercancel'].forEach(ev=>row.addEventListener(ev,()=>clearTimeout(lp)));
      row.addEventListener('click',()=>{
        if(fired)return;
        if(st.selMode){selected?st.sel.delete(it.path):st.sel.add(it.path);drawList();drawFooter();return}
        if(it.dir)navigate(it.path);
        else O.openViewer(it.path);
      });
      fr.append(row);
    });
    listEl.append(fr);
    drawFooter();
  };
  const drawAll=()=>{
    const r=listDir(st.dir);
    st.items=r.items;
    st.err=r.err||'';
    drawCrumbs();drawToolbar();drawList();
  };

  // ---- operations ----
  const mkNew=async isDir=>{
    const name=await O.ask(isDir?O.tr('New folder','Новая папка'):O.tr('New file','Новый файл'),O.tr('Name','Название'));
    if(!name)return;
    const r=O.native.fs(isDir?'mkdir':'create',join(st.dir,name));
    if(!r||!r.ok)return O.toast((r&&r.err)||O.tr('Failed','Не удалось'),3000);
    O.toast(isDir?O.tr('Folder created','Папка создана'):O.tr('File created','Файл создан'),1400);
    refresh();
  };
  const upload=()=>{
    const inp=h('input',{type:'file',multiple:true,class:'hide'});
    inp.addEventListener('change',()=>{
      const files=[...inp.files];inp.remove();
      if(!files.length)return;
      let done=0;
      files.forEach(f=>{
        const fr=new FileReader();
        fr.onload=()=>{
          // data URL → native write (binary-safe through writeDataUrlToFile when available)
          const dest=join(st.dir,f.name);
          const run=()=>{
            const r=(window.OC&&OC.writeDataUrlToFile)?OC.writeDataUrlToFile(fr.result,dest):null;
            let ok=false;
            try{const j=JSON.parse(r||'{}');ok=!!j.ok}catch(_){}
            if(!ok){
              // text fallback
              try{const txt=atob(String(fr.result).split(',')[1]||'');const w=O.native.writeText(dest,txt);ok=!!(w&&w.ok)}catch(_){}
            }
            if(++done===files.length){O.toast(O.tr('Uploaded: ','Загружено: ')+files.length,1600);refresh()}
          };
          run();
        };
        fr.readAsDataURL(f);
      });
    });
    document.body.append(inp);inp.click();
    setTimeout(()=>{if(inp.isConnected)inp.remove()},60000);
  };
  const itemActions=it=>{
    const isImg=IMG.test(it.name);
    O.actions(it.name,[
      {label:O.tr('Open','Открыть'),icon:'eye',fn:()=>it.dir?navigate(it.path):O.openViewer(it.path)},
      !it.dir?{label:O.tr('Edit','Редактировать'),sub:O.tr('Text files only','Только текстовые'),icon:'edit',fn:()=>O.openFile(it.path)}:null,
      isImg?{label:O.tr('Analyze with the agent','Анализировать агентом'),icon:'bot',fn:()=>O.analyzeImageFile&&O.analyzeImageFile(it.path)}:null,
      {label:O.tr('Ask the agent about this','Спросить агента об этом'),icon:'at',fn:()=>{s&&s.close();O.addMention&&O.addMention(it.path,it.dir)}},
      {label:O.tr('Copy','Копировать'),icon:'copy',fn:()=>{st.sel.clear();st.sel.add(it.path);st.clip={op:'copy',paths:[it.path]};st.selMode=false;drawAll();O.toast(O.tr('Copied — open a folder and Paste','Скопировано — откройте папку и «Вставить»'),2200)}},
      {label:O.tr('Move','Переместить'),icon:'drag',fn:()=>{st.sel.clear();st.sel.add(it.path);st.clip={op:'move',paths:[it.path]};st.selMode=false;drawAll();O.toast(O.tr('Move: pick the destination and Paste','Перемещение: выберите папку и «Вставить»'),2200)}},
      {label:O.tr('Rename','Переименовать'),icon:'edit',fn:async()=>{
        const v=await O.ask(O.tr('Rename','Переименовать'),null,it.name);if(!v||v===it.name)return;
        const r=O.native.fs('rename',it.path,join(st.dir,v));
        if(!r||!r.ok)O.toast((r&&r.err)||O.tr('Failed','Не удалось'),3000);else refresh();
      }},
      {label:O.tr('Share','Поделиться'),icon:'share',fn:()=>{st.sel.clear();st.sel.add(it.path);shareSel()}},
      {label:O.tr('Copy path','Копировать путь'),icon:'link',fn:()=>O.native.copy(it.path)},
      {label:O.tr('Delete','Удалить'),icon:'trash',danger:true,fn:()=>{
        O.confirm(O.tr('Delete?','Удалить?'),it.name+' — '+O.tr('cannot be undone','это нельзя отменить'),O.tr('Delete','Удалить'),true).then(ok=>{
          if(!ok)return;const r=O.native.fs('delete',it.path);
          if(!r||!r.ok)O.toast((r&&r.err)||O.tr('Failed','Не удалось'),3000);else{O.toast(O.tr('Deleted','Удалено'),1200);refresh()}
        });
      }}
    ].filter(Boolean));
  };
  const clip=op=>{
    if(!st.sel.size)return;
    st.clip={op,paths:[...st.sel]};
    st.selMode=false;st.sel.clear();drawAll();
    O.toast(op==='copy'?O.tr('Copied — open the destination folder and Paste','Скопировано — откройте папку назначения и «Вставить»')
      :O.tr('Ready to move — open the destination folder and Paste','Готово к переносу — откройте папку назначения и «Вставить»'),2600);
  };
  const pasteHere=()=>{
    const c=st.clip;if(!c||!c.paths.length)return;
    let ok=0;
    c.paths.forEach(p=>{
      if(p===st.dir||st.dir.startsWith(p+'/'))return; // never paste into itself
      const dest=join(st.dir,O.basename(p));
      const r=O.native.fs(c.op==='move'?'move':'copy',p,dest);
      if(r&&r.ok)ok++;
    });
    O.toast(ok?O.tr('Done: ','Готово: ')+ok:O.tr('Nothing changed','Ничего не изменилось'),1800);
    st.clip=null;refresh();
  };
  const delSel=async()=>{
    const n=st.sel.size;if(!n)return;
    if(!(await O.confirm(O.tr('Delete selected?','Удалить выбранное?'),O.tr(n+' item(s) — cannot be undone','Элементов: '+n+' — это нельзя отменить'),O.tr('Delete','Удалить'),true)))return;
    let ok=0;
    for(const p of st.sel){const r=O.native.fs('delete',p);if(r&&r.ok)ok++}
    st.sel.clear();st.selMode=false;
    O.toast(O.tr('Deleted: ','Удалено: ')+ok,1600);refresh();
  };
  const shareSel=()=>{
    const list=[...st.sel];
    if(!list.length)return;
    if(O.chatAttachVision&&list.length<=4){
      O.actions(O.tr('Share','Поделиться'),[
        {label:O.tr('Send to the agent','Отправить агенту'),icon:'bot',fn:async()=>{
          let n=0;
          for(const p of list){
            if(!IMG.test(p)){
              // text files go as mentions
              O.addMention&&O.addMention(p,false);n++;continue;
            }
            const f=await O.native.readDataUrl(p).catch(()=>null);
            if(f&&f.mime&&f.mime.startsWith('image/')){
              O.chatAttachVision([{type:'file',mime:f.mime,filename:O.basename(p),url:'data:'+f.mime+';base64,'+f.data,
                source:{type:'file',path:p,text:{value:'@'+O.basename(p),start:0,end:0}}}]);n++;
            }
          }
          s&&s.close();O.setTab('chat');
          O.toast(O.tr('Sent: ','Отправлено: ')+n,1600);
        }},
        {label:O.tr('System share','Системный шаринг'),icon:'share',fn:()=>O.native.share(list.join('\n'))},
        {label:O.tr('Copy paths','Копировать пути'),icon:'copy',fn:()=>O.native.copy(list.join('\n'))}
      ]);
    }else O.native.share(list.join('\n'));
  };
  const sortMenu=()=>{
    O.actions(O.tr('Sort','Сортировка'),[
      {label:O.tr('By name','По имени'),icon:st.sort==='name'?'check':'dot',fn:()=>{st.sort='name';drawAll()}},
      {label:O.tr('By size','По размеру'),icon:st.sort==='size'?'check':'dot',fn:()=>{st.sort='size';drawAll()}},
      {label:st.asc?O.tr('Descending','По убыванию'):O.tr('Ascending','По возрастанию'),icon:'swap',fn:()=>{st.asc=!st.asc;drawAll()}},
      {label:O.tr('Show hidden','Показывать скрытые'),icon:st.hidden?'check':'dot',fn:()=>{st.hidden=!st.hidden;drawAll()}}
    ]);
  };

  body.append(crumbs,toolbar,listEl,footer);
  s=O.sheet(O.tr('Files','Файлы'),body,{full:true,actions:h('button',{class:'ibtn',title:O.tr('Project tree map','Карта проекта'),onclick:()=>O.openTreeView&&O.openTreeView()},O.icon('branch'))});
  drawAll();
  return {navigate,refresh};
};

// ---- proper viewer ----
O.openViewer=(abs,paintOpts)=>{
  const name=O.basename(abs);
  const body=h('div',{class:'viewer'});
  const acts=h('span',{style:{display:'flex'}});
  const s=O.sheet(name,body,{full:true,actions:acts});
  const isImg=IMG.test(name),isVid=VID.test(name),isAud=AUD.test(name),isTxt=TXT.test(name)||!isImg&&!isVid&&!isAud;
  const url=O.mediaUrl?O.mediaUrl(abs):('file://'+abs);
  const addAct=(icon,title,fn)=>acts.append(h('button',{class:'ibtn',title,onclick:fn},O.icon(icon)));

  if(isImg){
    addAct('bot',O.tr('Analyze with the agent','Анализировать агентом'),()=>{s.close();O.analyzeImageFile&&O.analyzeImageFile(abs)});
    addAct('share',O.tr('Share','Поделиться'),()=>O.native.share(url));
    addAct('copy',O.tr('Copy path','Копировать путь'),()=>O.native.copy(abs));
    const img=h('img',{src:url,class:'viewer-img'});
    let zoom=1,panX=0,panY=0;
    const apply=()=>{img.style.transform='translate('+panX+'px,'+panY+'px) scale('+zoom+')'};
    img.addEventListener('click',()=>{zoom=zoom>=3?1:zoom*1.6;if(zoom===1){panX=panY=0}apply()});
    // pinch + drag
    let d0=0,z0=1,lastX=0,lastY=0,down=false;
    img.addEventListener('touchstart',e=>{
      if(e.touches.length===2){const dx=e.touches[0].clientX-e.touches[1].clientX,dy=e.touches[0].clientY-e.touches[1].clientY;d0=Math.hypot(dx,dy);z0=zoom}
      else{down=true;lastX=e.touches[0].clientX;lastY=e.touches[0].clientY}
    },{passive:true});
    img.addEventListener('touchmove',e=>{
      if(e.touches.length===2&&d0){
        const dx=e.touches[0].clientX-e.touches[1].clientX,dy=e.touches[0].clientY-e.touches[1].clientY;
        zoom=Math.max(0.8,Math.min(6,z0*Math.hypot(dx,dy)/d0));apply();
        if(e.cancelable)e.preventDefault();
      }else if(down&&zoom>1&&e.touches.length===1){
        const t=e.touches[0];panX+=t.clientX-lastX;panY+=t.clientY-lastY;lastX=t.clientX;lastY=t.clientY;apply();
        if(e.cancelable)e.preventDefault();
      }
    },{passive:false});
    const end=()=>{down=false;d0=0};
    img.addEventListener('touchend',end);img.addEventListener('touchcancel',end);
    body.append(h('div',{class:'viewer-stage'},img),
      h('div',{class:'viewer-hint mut s'},O.tr('Tap to zoom · pinch · drag when zoomed','Тап — зум · щипок · перетаскивание при зуме')));
    return s;
  }
  if(isVid){body.append(h('video',{src:url,controls:true,autoplay:true,class:'viewer-media'}));addAct('share',O.tr('Share','Поделиться'),()=>O.native.share(url));return s}
  if(isAud){body.append(h('audio',{src:url,controls:true,autoplay:true,style:{width:'100%',marginTop:'12px'}}));addAct('share',O.tr('Share','Поделиться'),()=>O.native.share(url));return s}

  // text / code / markdown
  const r=O.native.readText(abs);
  let text=(r&&r.ok&&r.text)||'';
  const tooBig=!r||!r.ok&&/too large/i.test(String(r&&r.err||''));
  let editing=false;
  const paint=()=>{
    body.textContent='';acts.textContent='';
    if(tooBig){body.append(h('div',{class:'note'},O.tr('File is too large to preview','Файл слишком большой для просмотра')));
      addAct('share',O.tr('Share','Поделиться'),()=>O.native.share(O.mediaUrl?O.mediaUrl(abs):abs));return}
    addAct('copy',O.tr('Copy path','Копировать путь'),()=>O.native.copy(abs));
    addAct('copy',O.tr('Copy text','Копировать текст'),()=>O.native.copy(text));
    addAct('at',O.tr('Ask the agent','Спросить агента'),()=>{s.close();O.addMention&&O.addMention(abs,false)});
    if(/\.md|\.markdown/i.test(name)){
      addAct('eye',O.tr('Preview','Просмотр'),()=>{
        const body2=h('div',{class:'md-preview'},h('div',{html:O.md(text)}));
        O.sheet(name+' · '+O.tr('preview','просмотр'),body2,{full:true});
      });
    }
    if(!editing){
      addAct('edit',O.tr('Edit','Редактировать'),()=>{editing=true;paint()});
      body.append(O.codeView(text,abs));
    }else{
      addAct('check',O.tr('Save','Сохранить'),()=>{
        const w=O.native.writeText(abs,ta.value);
        if(w&&w.ok){text=ta.value;editing=false;O.toast(O.tr('Saved','Сохранено'),1300);paint();O.refreshFiles&&O.refreshFiles(false)}
        else O.toast((w&&w.err)||O.tr('Failed','Не удалось'),3000);
      });
      body.append(ta=h('textarea',{class:'editor',spellcheck:'false'}));ta.value=text;
    }
  };
  let ta=null;
  paint();
  return s;
};
})();