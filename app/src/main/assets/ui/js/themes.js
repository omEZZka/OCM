(function(){
const O=window.OCM,h=O.h,S=O.S;
let styleEl=null;
// ---- theme catalogue: 24 built-ins + user customs ----
// Each theme is a compact palette; everything else (lines, hovers, add/del tints) is derived,
// so a custom theme only needs a handful of colours and still looks complete.
const T=(id,name,tag,light,bg,fg,acc,accFg,acc2,mut,code,extra)=>Object.assign({id,name,tag,light,bg,fg,acc,accFg,acc2,mut,code},extra||{});
const THEMES=[
  T('opencode','OpenCode','classic',false,'#101014','#f5f5f7','#fab283','#1c120a','#38bdf8','#9a9aa3','#0b0b0f'),
  T('amoled','AMOLED','oled',false,'#000000','#f4f4f5','#ffffff','#000000','#38bdf8','#8e8e93','#000000'),
  T('light','Paper Light','light',true,'#faf9f7','#09090b','#c2641c','#ffffff','#0284c7','#6c6c72','#f3f1ed'),
  T('tokyonight','Tokyo Night','editor',false,'#1a1b26','#c0caf5','#7aa2f7','#15161e','#bb9af7','#7a88b8','#16161e'),
  T('nord','Nord','arctic',false,'#2e3440','#eceff4','#88c0d0','#2e3440','#81a1c1','#9aa5b8','#272c36'),
  T('gruvbox','Gruvbox','retro',false,'#282828','#ebdbb2','#fabd2f','#1d2021','#83a598','#a89984','#1d2021'),
  T('dracula','Dracula','gothic',false,'#282a36','#f8f8f2','#bd93f9','#21222c','#ff79c6','#6272a4','#21222c',{ok:'#50fa7b',err:'#ff5555',warn:'#f1fa8c'}),
  T('catppuccin','Catppuccin Mocha','pastel',false,'#1e1e2e','#cdd6f4','#cba6f7','#11111b','#89b4fa','#9399b2','#181825',{ok:'#a6e3a1',err:'#f38ba8',warn:'#f9e2af'}),
  T('latte','Catppuccin Latte','light',true,'#eff1f5','#4c4f69','#8839ef','#ffffff','#1e66f5','#7c7f93','#e6e9ef',{ok:'#40a02b',err:'#d20f39',warn:'#df8e1d'}),
  T('rosepine','Rosé Pine','dawn',false,'#191724','#e0def4','#ebbcba','#191724','#9ccfd8','#908caa','#1f1d2e',{ok:'#31748f',err:'#eb6f92',warn:'#f6c177'}),
  T('rosedawn','Rosé Pine Dawn','light',true,'#faf4ed','#575279','#b4637a','#ffffff','#56949f','#9893a5','#f2e9e1',{ok:'#286983',err:'#b4637a',warn:'#ea9d34'}),
  T('onedark','One Dark','editor',false,'#282c34','#abb2bf','#61afef','#282c34','#c678dd','#7f848e','#21252b',{ok:'#98c379',err:'#e06c75',warn:'#e5c07b'}),
  T('monokai','Monokai','classic',false,'#272822','#f8f8f2','#a6e22e','#272822','#66d9ef','#90917f','#1e1f1c',{ok:'#a6e22e',err:'#f92672',warn:'#e6db74'}),
  T('solardark','Solarized Dark','classic',false,'#002b36','#93a1a1','#2aa198','#002b36','#268bd2','#657b83','#00212b',{ok:'#859900',err:'#dc322f',warn:'#b58900'}),
  T('solarlight','Solarized Light','light',true,'#fdf6e3','#586e75','#b58900','#fdf6e3','#268bd2','#93a1a1','#eee8d5',{ok:'#859900',err:'#dc322f',warn:'#cb4b16'}),
  T('everforest','Everforest','nature',false,'#2d353b','#d3c6aa','#a7c080','#2d353b','#7fbbb3','#859289','#272e33',{ok:'#a7c080',err:'#e67e80',warn:'#dbbc7f'}),
  T('kanagawa','Kanagawa','ink',false,'#1f1f28','#dcd7ba','#7e9cd8','#1f1f28','#957fb8','#727169','#16161d',{ok:'#98bb6c',err:'#e46876',warn:'#ffa066'}),
  T('synthwave','Synthwave','neon',false,'#262335','#f0eff1','#ff7edb','#262335','#36f9f6','#848bbd','#1e1a2e',{ok:'#72f1b8',err:'#fe4450',warn:'#fede5d'}),
  T('cyberpunk','Cyberpunk','neon',false,'#0d0d17','#e8e8ff','#fcee0a','#0d0d17','#00f0ff','#7a7a99','#08080f',{ok:'#00ff9f',err:'#ff003c',warn:'#fcee0a'}),
  T('matrix','Matrix','terminal',false,'#030b03','#c8ffc8','#00e676','#03140a','#69f0ae','#4e7a4e','#020702',{ok:'#00e676',err:'#ff5252',warn:'#ffd740'}),
  T('ocean','Deep Ocean','calm',false,'#0f1c2e','#d7e3f4','#4fc3f7','#0f1c2e','#7986cb','#7d93ad','#0a1422',{ok:'#81c784',err:'#e57373',warn:'#ffb74d'}),
  T('forest','Night Forest','nature',false,'#141a14','#e4ead9','#8bc34a','#141a14','#4db6ac','#8a967d','#0e130e',{ok:'#aed581',err:'#ef9a9a',warn:'#ffd54f'}),
  T('sunset','Sunset Ember','warm',false,'#1c1210','#f5e6dc','#ff8a50','#1c1210','#ffb74d','#a08b80','#140d0b',{ok:'#aed581',err:'#ff5252',warn:'#ffc107'}),
  T('graphite','Graphite Mono','mono',false,'#161616','#e8e8e8','#b8b8b8','#161616','#8a8a8a','#8f8f8f','#0f0f0f',{ok:'#9ccc9c',err:'#e08585',warn:'#d8c07a'}),
  // ---- 2.29 terminal-first palettes ----
  T('anthropic','Anthropic Dark','terminal',false,'#262624','#f0eee6','#d97757','#262624','#c15f3c','#a8a29a','#1f1e1d',
    {bg2:'#2b2a28',bg3:'#333230',card:'#2f2e2b',line:'#3d3b38',line2:'#4a4844',ok:'#7fa87f',err:'#d97757',warn:'#d9a441',add:'#2a3a2a',del:'#3d2a26'}),
  T('anthropicpaper','Anthropic Paper','light',true,'#f9f8f6','#262624','#c15f3c','#ffffff','#a8563a','#6b6862','#f2f0ec',
    {bg2:'#f4f2ee',bg3:'#eeebe5',card:'#ffffff',line:'#e3e0d8',line2:'#d5d1c7',ok:'#4f7a4f',err:'#b5432c',warn:'#a8762a',add:'#e6f0e6',del:'#f7e6e2'}),
  T('hacker','Hacker Green','terminal',false,'#0a0f0a','#7dff7d','#00ff41','#04120a','#39ff14','#3f7a3f','#050a05',
    {bg2:'#0d140d',bg3:'#111a11',card:'#0f170f',line:'#1c331c',line2:'#264526',ok:'#00ff41',err:'#ff4444',warn:'#ccff00',add:'#0d2a0d',del:'#2a0d0d'}),
  T('draculapro','Dracula Pro','terminal',false,'#22212c','#f8f8f2','#ff80bf','#22212c','#8aff80','#7b7a8c','#1b1a24',
    {bg2:'#282735',bg3:'#302f40',card:'#2a2937',line:'#3a3950',line2:'#4a4964',ok:'#8aff80',err:'#ff9580',warn:'#ffff80',add:'#243a2a',del:'#3d2430'}),
  T('nordterm','Nord Frost','terminal',false,'#242933','#d8dee9','#8fbcbb','#242933','#81a1c1','#8f9bb0','#1e222a',
    {bg2:'#2b303b',bg3:'#333a47',card:'#2e3440',line:'#3b4252',line2:'#4c566a',ok:'#a3be8c',err:'#bf616a',warn:'#ebcb8b',add:'#2c3a2c',del:'#3b2a2e'})
];
const customKey='customThemes';
O.themeList=()=>THEMES.concat(O.store.get(customKey,[]).map(t=>Object.assign({custom:true},t)));
O.themeById=id=>O.themeList().find(t=>t.id===id)||THEMES[0];
const hex=(c,a)=>{
  const m=/^#?([0-9a-f]{6})$/i.exec(String(c||'').trim());
  if(!m)return c;
  const n=parseInt(m[1],16);
  return'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+a+')';
};
const mixHex=(a,b,t)=>{
  const pa=/^#?([0-9a-f]{6})$/i.exec(String(a).trim()),pb=/^#?([0-9a-f]{6})$/i.exec(String(b).trim());
  if(!pa||!pb)return a;
  const x=parseInt(pa[1],16),y=parseInt(pb[1],16);
  const ch=s=>Math.round(((x>>s)&255)*(1-t)+((y>>s)&255)*t);
  return'#'+((1<<24)|(ch(16)<<16)|(ch(8)<<8)|ch(0)).toString(16).slice(1);
};
O.themeVars=t=>{
  const light=!!t.light;
  const lift=light?-1:1;
  const towards=light?'#000000':'#ffffff';
  const bg=t.bg;
  const v={
    '--bg':bg,
    '--bg2':t.bg2||mixHex(bg,towards,0.035),
    '--bg3':t.bg3||mixHex(bg,towards,0.075),
    '--card':t.card||mixHex(bg,towards,0.05),
    '--card-hover':mixHex(t.card||mixHex(bg,towards,0.05),towards,0.04),
    '--line':t.line||hex(light?'#000000':(t.fg||'#ffffff'),0.09),
    '--line2':t.line2||hex(light?'#000000':(t.fg||'#ffffff'),0.18),
    '--fg':t.fg,
    '--mut':t.mut||mixHex(t.fg,bg,0.42),
    '--acc':t.acc,
    '--acc-fg':t.accFg||(light?'#ffffff':'#141414'),
    '--acc2':t.acc2||t.acc,
    '--blue':t.blue||t.acc2||t.acc,
    '--ok':t.ok||(light?'#16a34a':'#4ade80'),
    '--err':t.err||(light?'#dc2626':'#f87171'),
    '--warn':t.warn||(light?'#d97706':'#fbbf24'),
    '--add':t.add||(light?'#dcfce7':'#143522'),
    '--del':t.del||(light?'#fee2e2':'#3d171b'),
    '--code':t.code||mixHex(bg,light?'#000000':'#000000',0.28),
    '--shadow-1':light?'0 2px 10px rgba(0,0,0,.08)':'0 2px 10px rgba(0,0,0,.22)',
    '--shadow-2':light?'0 10px 32px rgba(0,0,0,.14)':'0 10px 32px rgba(0,0,0,.38)'
  };
  return v;
};
O.applyTheme=id=>{
  const t=O.themeById(id);
  const root=document.documentElement;
  root.dataset.theme=t.id;
  if(t.id==='opencode'){if(styleEl){styleEl.remove();styleEl=null}return}
  // legacy themes keep their hand-tuned CSS blocks; everything else is driven by variables
  const legacy=['light','tokyonight','amoled','nord','gruvbox'];
  if(!styleEl){styleEl=document.createElement('style');styleEl.id='ocm-theme-vars';document.head.append(styleEl)}
  const vars=O.themeVars(t);
  const body=Object.keys(vars).map(k=>k+':'+vars[k]+' !important').join(';');
  styleEl.textContent=legacy.includes(t.id)
    ?':root{color-scheme:'+(t.light?'light':'dark')+'}'
    :'html[data-theme="'+t.id+'"]{'+body+';color-scheme:'+(t.light?'light':'dark')+'}';
};
// ---- picker: preview grid, auto toggle, custom editor ----
let themeSheet=null;
O.openThemes=()=>{
  if(themeSheet&&!themeSheet._closed)return themeSheet;
  const auto=O.store.get('themeAuto',false);
  const body=h('div');
  body.append(O.toggleRow('bulb',O.tr('Auto by system','Авто по системе'),O.tr('Follow Android dark/light setting','Следовать тёмной/светлой теме Android'),auto,v=>{
    O.store.set('themeAuto',v);
    if(v&&O.applyAutoTheme)O.applyAutoTheme();else O.saveOpts();
  }));
  const grid=h('div',{class:'theme-grid'});
  const mkCard=t=>{
    const vars=O.themeVars(t);
    const sw=h('span',{class:'theme-sw',style:{background:vars['--bg'],borderColor:vars['--line2']}},
      h('i',{style:{background:vars['--acc']}}),
      h('i',{style:{background:vars['--acc2']}}),
      h('i',{style:{background:vars['--fg'],opacity:.75}}));
    const card=h('button',{class:'theme-card'+(S.opts.theme===t.id?' on':''),onclick:()=>{
      S.opts.theme=t.id;O.store.set('themeManual',t.id);O.store.set('themeAuto',false);
      O.saveOpts();
      grid.querySelectorAll('.theme-card').forEach(c=>c.classList.remove('on'));
      card.classList.add('on');
    }},sw,h('b',null,t.name),h('span',{class:'theme-tag'},t.custom?O.tr('custom','своя'):t.tag),
      t.custom?h('span',{class:'theme-edit',title:O.tr('Edit','Править'),onclick:e=>{e.stopPropagation();s.close();setTimeout(()=>O.openThemeEditor(t),200)}},O.icon('edit')):null);
    O.longPress(card,()=>{
      const items=[{label:O.tr('Apply','Применить'),icon:'check',fn:()=>{S.opts.theme=t.id;O.store.set('themeManual',t.id);O.store.set('themeAuto',false);O.saveOpts();s.close()}}];
      if(t.custom){
        items.push({label:O.tr('Edit theme','Править тему'),icon:'edit',fn:()=>{s.close();setTimeout(()=>O.openThemeEditor(t),200)}});
        items.push({label:O.tr('Duplicate','Дублировать'),icon:'copy',fn:()=>{s.close();setTimeout(()=>O.openThemeEditor(Object.assign({},t,{id:'',name:t.name+' 2'})),200)}});
        items.push({label:O.tr('Delete theme','Удалить тему'),icon:'trash',danger:true,fn:async()=>{
          if(!(await O.confirm(O.tr('Delete theme?','Удалить тему?'),t.name,O.tr('Delete','Удалить'),true)))return;
          O.store.set(customKey,O.store.get(customKey,[]).filter(x=>x.id!==t.id));
          if(S.opts.theme===t.id){S.opts.theme='opencode';O.saveOpts()}
          s.close();setTimeout(()=>O.openThemes(),200);
        }});
      }else{
        items.push({label:O.tr('Make a custom copy','Сделать свою копию'),icon:'palette',fn:()=>{s.close();setTimeout(()=>O.openThemeEditor(Object.assign({},t,{id:'',name:t.name+' (моя)',custom:true})),200)}});
      }
      O.actions(t.name,items);
    },500);
    return card;
  };
  // 129 palettes: filter by family and by name instead of one endless wall of cards
  let fam='all',needle='';
  const countEl=h('span',{class:'mut s'});
  const search=h('input',{type:'search',placeholder:O.tr('Find a theme…','Найти тему…'),style:{margin:'6px 0'}});
  const chip=(label,on,fn)=>h('button',{class:'chip'+(on?' on':''),onclick:fn},label);
  const famRow=h('div',{class:'fchips',style:{flexWrap:'wrap',margin:'6px 0'}});
  const drawFams=()=>{
    famRow.textContent='';
    [['all',O.tr('All','Все'),''] ,['dark',O.tr('Dark','Тёмные'),''],['light',O.tr('Light','Светлые'),''],['terminal',O.tr('Terminal','Терминал'),''],['pack',O.tr('Pack','Коллекция'),'']]
      .forEach(([k,l])=>famRow.append(chip(l,fam===k,()=>{fam=k;renderGrid()})));
  };
  const renderGrid=()=>{
    drawFams();
    grid.textContent='';
    const all=O.themeList();
    const shown=all.filter(t=>{
      if(fam==='dark'&&t.light)return false;
      if(fam==='light'&&!t.light)return false;
      if(fam==='terminal'&&t.tag!=='terminal')return false;
      if(fam==='pack'&&!(O.THEME_PACK&&O.THEME_PACK.some(p=>p.id===t.id)))return false;
      if(!needle)return true;
      const hay=(t.name+' '+t.id+' '+(t.tag||'')).toLowerCase();
      return hay.includes(needle.toLowerCase());
    });
    countEl.textContent=shown.length+' / '+all.length;
    shown.forEach(t=>grid.append(mkCard(t)));
    if(!shown.length)grid.append(h('div',{class:'mut',style:{padding:'16px',textAlign:'center'}},O.tr('Nothing matches','Ничего не найдено')));
  };
  search.oninput=()=>{needle=search.value;renderGrid()};
  renderGrid();
  body.append(h('div',{class:'grp'},O.tr('Themes — tap to apply, hold for actions','Темы — тап применить, долгое нажатие — действия')),search,countEl,famRow,grid,
    h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:()=>{s.close();setTimeout(()=>O.openThemeEditor(null),200)}},O.icon('plus'),O.tr('Create custom theme','Создать свою тему')),
    h('button',{class:'btn wide',style:{marginTop:'8px'},onclick:()=>{s.close();setTimeout(()=>O.importTheme(),200)}},O.icon('down'),O.tr('Import theme from JSON','Импорт темы из JSON')),
    h('div',{class:'grp'},O.tr('Font size','Размер текста')),
    h('div',{class:'seg'},[13,14,15,16,18,20].map(n=>h('button',{class:S.opts.fs===n?'on':'',onclick:()=>{S.opts.fs=n;O.saveOpts();body.querySelectorAll('.seg button').forEach(b=>b.classList.toggle('on',b.textContent===String(n)))}},n))));
  const s=O.sheet(O.tr('Appearance','Оформление'),body,{full:true,onClose:()=>{themeSheet=null}});
  themeSheet=s;
  return s;
};
// ---- custom theme editor with live preview ----
O.openThemeEditor=src=>{
  const isNew=!src||!src.id;
  const base=src?Object.assign({},src):Object.assign({},O.themeById(S.opts.theme),{id:'',name:'',custom:true});
  if(!base.name)base.name='';
  const before=S.opts.theme;
  const fields=[
    ['bg','Фон','Background'],
    ['fg','Текст','Text'],
    ['acc','Акцент','Accent'],
    ['accFg','Текст на акценте','On accent'],
    ['acc2','Второй акцент','Accent 2'],
    ['mut','Приглушённый текст','Muted'],
    ['code','Фон кода','Code bg'],
    ['ok','Успех','OK'],
    ['err','Ошибка','Error'],
    ['warn','Предупреждение','Warning']
  ];
  const state=Object.assign({light:false},base);
  const nameInp=h('input',{type:'text',placeholder:O.tr('Theme name','Название темы'),value:state.name||''});
  const preview=h('div',{class:'theme-preview'});
  const paintPreview=()=>{
    const v=O.themeVars(state);
    preview.style.background=v['--bg'];
    preview.style.borderColor=v['--line2'];
    preview.textContent='';
    preview.append(
      h('div',{class:'tp-row'},
        h('span',{class:'tp-bubble',style:{background:v['--card'],borderColor:v['--line'],color:v['--fg']}},O.tr('Agent answer','Ответ агента')),
        h('span',{class:'tp-user',style:{background:v['--acc'],color:v['--acc-fg']}},'OK')),
      h('div',{class:'tp-code',style:{background:v['--code'],color:v['--ok']}},'$ npm run build'),
      h('div',{class:'tp-row'},
        h('span',{style:{color:v['--mut'],fontSize:'11px'}},O.tr('muted text','приглушённый текст')),
        h('span',{style:{color:v['--acc2'],fontSize:'11px'}},O.tr('accent 2','акцент 2')),
        h('span',{style:{color:v['--err'],fontSize:'11px'}},O.tr('error','ошибка'))));
  };
  const applyLive=()=>{
    const vars=O.themeVars(state);
    if(!styleEl){styleEl=document.createElement('style');styleEl.id='ocm-theme-vars';document.head.append(styleEl)}
    styleEl.textContent=':root{'+Object.keys(vars).map(k=>k+':'+vars[k]+' !important').join(';')+';color-scheme:'+(state.light?'light':'dark')+'}';
    paintPreview();
  };
  const rows=fields.map(([key,ru,en])=>{
    const inp=h('input',{type:'color',value:/^#[0-9a-f]{6}$/i.test(state[key]||'')?state[key]:'#888888'});
    const txt=h('input',{type:'text',class:'mono theme-hex',value:state[key]||'',placeholder:'#000000'});
    const set=v=>{
      if(!/^#?[0-9a-f]{6}$/i.test(String(v).trim()))return false;
      const val='#'+String(v).trim().replace('#','');
      state[key]=val;inp.value=val;txt.value=val;applyLive();return true;
    };
    inp.addEventListener('input',()=>set(inp.value));
    txt.addEventListener('change',()=>{if(!set(txt.value))txt.value=state[key]||''});
    return h('div',{class:'theme-field'},h('label',null,O.tr(en,ru)),h('span',{class:'theme-field-inputs'},inp,txt));
  });
  const lightToggle=O.toggleRow('bulb',O.tr('Light theme','Светлая тема'),O.tr('Derives light surfaces and shadows','Светлые поверхности и тени'),!!state.light,v=>{state.light=v;applyLive()});
  const body=h('div',null,
    h('div',{class:'field'},h('label',null,O.tr('Name','Название')),nameInp),
    preview,lightToggle,
    h('div',{class:'grp'},O.tr('Palette — applied live','Палитра — применяется сразу')),
    h('div',{class:'theme-fields'},rows),
    h('div',{style:{display:'flex',gap:'8px',marginTop:'12px'}},
      h('button',{class:'btn grow',onclick:()=>{cancel()}},O.tr('Cancel','Отмена')),
      h('button',{class:'btn pri grow',onclick:()=>save()},O.icon('check'),O.tr('Save & apply','Сохранить'))),
    h('div',{style:{display:'flex',gap:'8px',marginTop:'8px'}},
      h('button',{class:'btn sm grow',onclick:()=>{
        const json=O.exportThemeJson(state,nameInp.value);
        O.native.copy(json);O.toast(O.tr('Theme JSON copied','JSON темы скопирован'),1800);
      }},O.icon('copy'),O.tr('Copy JSON','Копировать JSON')),
      h('button',{class:'btn sm grow',onclick:()=>{
        const json=O.exportThemeJson(state,nameInp.value);
        if(O.native.share)O.native.share(json);else O.native.copy(json);
      }},O.icon('share'),O.tr('Share','Поделиться'))));
  let done=false;
  const restore=()=>{O.applyTheme(before)};
  const cancel=()=>{if(done)return;done=true;restore();s.close()};
  const save=()=>{
    if(done)return;
    const name=(nameInp.value||'').trim();
    if(!name){O.toast(O.tr('Give the theme a name','Дайте теме название'),2000);nameInp.focus();return}
    done=true;
    const id=state.id&&O.store.get(customKey,[]).some(x=>x.id===state.id)?state.id:'custom_'+Date.now().toString(36);
    const t={id,name,custom:true};
    ['light','bg','fg','acc','accFg','acc2','mut','code','ok','err','warn','bg2','bg3','card'].forEach(k=>{if(state[k]!==undefined)t[k]=state[k]});
    const list=O.store.get(customKey,[]).filter(x=>x.id!==id);
    list.push(t);O.store.set(customKey,list);
    S.opts.theme=id;O.store.set('themeManual',id);O.store.set('themeAuto',false);
    O.saveOpts();
    s.close();
    O.toast(O.tr('Theme saved: ','Тема сохранена: ')+name,1800);
  };
  const s=O.sheet(isNew?O.tr('New theme','Новая тема'):O.tr('Edit theme','Править тему'),body,{full:true,onClose:()=>{if(!done){done=true;restore()}}});
  applyLive();
};
O.exportThemeJson=(t,name)=>JSON.stringify({format:'ocm-theme',version:1,theme:Object.assign({},t,{name:(name||t.name||'').trim()||'Custom',id:''})},null,2);
O.importThemeJson=text=>{
  let obj;
  try{obj=JSON.parse(O.stripJsonc(String(text||'')))}catch(e){return{ok:false,err:O.tr('Invalid JSON','Неверный JSON')}}
  const t=obj&&obj.format==='ocm-theme'?obj.theme:obj;
  if(!t||typeof t!=='object')return{ok:false,err:O.tr('No theme object','Нет объекта темы')};
  if(!t.bg||!t.fg||!t.acc)return{ok:false,err:O.tr('Need at least bg, fg, acc','Нужны хотя бы bg, fg, acc')};
  const bad=['bg','fg','acc','accFg','acc2','mut','code','ok','err','warn'].filter(k=>t[k]&&!/^#?[0-9a-f]{6}$/i.test(String(t[k])));
  if(bad.length)return{ok:false,err:O.tr('Bad colours: ','Неверные цвета: ')+bad.join(', ')};
  const id='custom_'+Date.now().toString(36);
  const clean={id,name:String(t.name||'Imported').slice(0,40),custom:true};
  ['light','bg','fg','acc','accFg','acc2','mut','code','ok','err','warn','bg2','bg3','card'].forEach(k=>{if(t[k]!==undefined)clean[k]=k==='light'?!!t[k]:'#'+String(t[k]).replace('#','')});
  const list=O.store.get(customKey,[]);list.push(clean);O.store.set(customKey,list);
  return{ok:true,theme:clean};
};
O.importTheme=async()=>{
  const v=await O.ask(O.tr('Import theme','Импорт темы'),O.tr('Paste theme JSON (ocm-theme format or a palette object)','Вставьте JSON темы (формат ocm-theme или объект палитры)'),'',true);
  if(v==null||!v.trim())return;
  const r=O.importThemeJson(v);
  if(!r.ok){O.toast(r.err,3000);return}
  S.opts.theme=r.theme.id;O.store.set('themeManual',r.theme.id);O.store.set('themeAuto',false);
  O.saveOpts();
  O.toast(O.tr('Theme imported: ','Тема импортирована: ')+r.theme.name,2000);
};
// keep S.opts.theme and the injected variables in sync with every saveOpts call
const baseSave=O.saveOpts;
O.saveOpts=()=>{baseSave();try{O.applyTheme(S.opts.theme)}catch(_){}};
setTimeout(()=>{try{O.applyTheme(S.opts.theme)}catch(_){}},0);
})();