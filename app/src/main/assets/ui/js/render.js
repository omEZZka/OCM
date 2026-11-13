(function(){
const O=window.OCM,h=O.h;
// ---- markdown ----
O.md=t=>{try{return DOMPurify.sanitize(marked.parse(t||'',{gfm:true}),{USE_PROFILES:{html:true},FORBID_TAGS:['style','form','textarea','select'],FORBID_ATTR:['onerror','onload'],ADD_TAGS:['button','action','openapp'],ADD_ATTR:['data-action','data-target','data-path','type','target']})}catch{return'<pre>'+O.esc(t)+'</pre>'}};
O.enhance=el=>{
  el.querySelectorAll('pre').forEach(pre=>{if(pre.dataset.e||pre.closest('.codeblock'))return;pre.dataset.e='1';
    const code=pre.querySelector('code');const lang=((code&&code.className.match(/language-([\w+#-]+)/))||[])[1]||'';
    if(code&&window.hljs){try{hljs.highlightElement(code)}catch{}}
    const wrap=h('div',{class:'codeblock'},h('div',{class:'code-bar'},h('span',null,lang||'текст'),h('button',{class:'ibtn s','data-copy':'1'},O.icon('copy'))));
    pre.replaceWith(wrap);wrap.append(pre)});

  // Connect interactive buttons created in markdown
  el.querySelectorAll('button[data-action]').forEach(btn=>{
    if(btn._bound||btn.dataset.bound)return;
    btn._bound=true;
    btn.dataset.bound='1';
    btn.className='btn-widget-action inline-action-btn';

    // Format button text with SVG artifact icon and clean label (remove any raw emojis)
    const rawText=btn.textContent.trim();
    const cleanText=rawText.replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\s]+/u,'').trim();
    const act=btn.dataset.action;
    const target=btn.dataset.path||btn.dataset.target||'';

    let iconName='cube';
    let defaultTitle='Открыть сайт';
    if(act==='open_app'){
      iconName='out';
      defaultTitle='Открыть '+target;
    }else if(act==='open_term'||act==='term'){
      iconName='terminal';
      defaultTitle='Терминал';
    }else if(act==='open_files'||act==='files'){
      iconName='folder';
      defaultTitle='Файлы';
    }else if(act==='preview'||act==='web_preview'){
      if(target.toLowerCase().includes('game')||target.toLowerCase().includes('3d')||rawText.includes('игр')){
        iconName='cube';
        defaultTitle='Открыть игру';
      }else{
        iconName='cube';
        defaultTitle='Открыть сайт';
      }
    }

    btn.innerHTML='';
    btn.append(O.icon(iconName), document.createTextNode(' '+(cleanText||defaultTitle)));

    btn.addEventListener('click',e=>{
      e.preventDefault();
      e.stopPropagation();
      O.dispatchAction(act, target);
    });
  });

  // Connect custom action tags created by agent: <openapp target="..."> or <openapp>...</openapp>
  el.querySelectorAll('openapp, action[type="open_app"]').forEach(tag=>{
    if(tag.dataset.bound)return;tag.dataset.bound='1';
    const target=tag.getAttribute('target')||tag.textContent.trim();
    if(target){
      const btn=h('button',{
        class:'btn-widget-action inline-action-btn',
        onclick:e=>{e.preventDefault();e.stopPropagation();O.dispatchAction('open_app',target)}
      },O.icon('out'),' Открыть '+target);
      btn._bound=true;
      btn.dataset.bound='1';
      tag.replaceWith(btn);
    }
  });

  // Auto-detect project HTML files mentioned in text (like site/index.html or /root/site/index.html)
  el.querySelectorAll('code').forEach(c=>{
    const txt=c.textContent.trim();
    if(/\b(?:site\/index\.html|\/root\/.*\.html|[a-zA-Z0-9_.-]+\.html)\b/i.test(txt)){
      if(c.nextElementSibling&&c.nextElementSibling.classList.contains('inline-preview-chip'))return;
      const chip=h('button',{class:'inline-preview-chip',title:O.tr('Open in-app preview','Открыть в приложении'),onclick:e=>{
        e.preventDefault();e.stopPropagation();
        O.openPreview(txt);
      }},O.icon('cube'),' Открыть сайт');
      c.after(chip);
    }
  });
};
// Rendering markdown on every streamed delta is what made the UI freeze: `marked` + DOMPurify +
// highlight.js reparse the whole answer dozens of times per second while the user is tapping. Cap
// the work with a per-element throttle, and while streaming only re-render if the text actually
// grew by a meaningful amount. The final state is always rendered exactly, once streaming stops.
O.mdInto=(el,t,opts)=>{
  const o=opts||{};
  el._md=el._md||{txt:'',at:0,timer:null};
  const st=el._md;
  const apply=()=>{
    st.timer=null;
    st.at=Date.now();
    try{el.innerHTML=O.md(st.txt);O.enhance(el)}catch(e){}
  };
  st.txt=t;
  if(o.final){
    if(st.timer){clearTimeout(st.timer);st.timer=null}
    apply();
    return;
  }
  const now=Date.now();
  const gap=now-st.at;
  if(gap>=90){apply();return}
  if(st.timer)return; // a render is already scheduled; it will pick up st.txt
  st.timer=setTimeout(apply,90-gap);
};

// ---- diff ----
O.diffOps=(a,b)=>{const A=a.split('\n'),B=b.split('\n');let s=0;while(s<A.length&&s<B.length&&A[s]===B[s])s++;
  let ea=A.length,eb=B.length;while(ea>s&&eb>s&&A[ea-1]===B[eb-1]){ea--;eb--}
  const ops=[];for(let i=0;i<s;i++)ops.push([' ',A[i]]);
  const n=ea-s,m=eb-s;
  if(n*m>4e6){for(let i=s;i<ea;i++)ops.push(['-',A[i]]);for(let j=s;j<eb;j++)ops.push(['+',B[j]])}
  else{const W=m+1,L=new Uint32Array((n+1)*W);
    for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)L[i*W+j]=A[s+i]===B[s+j]?L[(i+1)*W+j+1]+1:Math.max(L[(i+1)*W+j],L[i*W+j+1]);
    let i=0,j=0;while(i<n&&j<m){if(A[s+i]===B[s+j]){ops.push([' ',A[s+i]]);i++;j++}else if(L[(i+1)*W+j]>=L[i*W+j+1]){ops.push(['-',A[s+i]]);i++}else{ops.push(['+',B[s+j]]);j++}}
    while(i<n){ops.push(['-',A[s+i]]);i++}while(j<m){ops.push(['+',B[s+j]]);j++}}
  for(let i=ea;i<A.length;i++)ops.push([' ',A[i]]);return ops};
O.diffEl=(ops,ctx)=>{ctx=ctx==null?3:ctx;const box=h('div',{class:'diff'});const keep=new Array(ops.length).fill(false);
  ops.forEach((o,i)=>{if(o[0]!==' ')for(let k=Math.max(0,i-ctx);k<=Math.min(ops.length-1,i+ctx);k++)keep[k]=true});
  let skipped=0;const flush=()=>{if(skipped){box.append(h('div',{class:'c'},'  … без изменений: '+skipped+' строк'));skipped=0}};
  ops.forEach((o,i)=>{if(!keep[i]){skipped++;return}flush();box.append(h('div',{class:o[0]==='+'?'a':o[0]==='-'?'d':''},o[0]+' '+o[1]))});flush();
  if(!box.childNodes.length)box.append(h('div',{class:'c'},'Нет изменений'));return box};
O.unifiedEl=txt=>{const box=h('div',{class:'diff'});String(txt||'').split('\n').slice(0,2500).forEach(l=>{
  const c=l.startsWith('+')&&!l.startsWith('+++')?'a':l.startsWith('-')&&!l.startsWith('---')?'d':l.startsWith('@@')?'h':(l.startsWith('---')||l.startsWith('+++')||l.startsWith('Index')||l.startsWith('==='))?'c':'';
  box.append(h('div',{class:c},l))});return box};

// ---- vibrant modern file icons ----
const FOLDER_SVG='<svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M3 7a2 2 0 012-2h4.5l2 2H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" fill="#f59e0b"/><path d="M3 9.5h18v6.5a2 2 0 01-2 2H5a2 2 0 01-2-2V9.5z" fill="#fbbf24" opacity="0.95"/></svg>';
const FOLDER_OPEN_SVG='<svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M3 6a2 2 0 012-2h4.5l2 2H19a2 2 0 012 2v2H6a2 2 0 00-1.9 1.4L2.5 17.5A2 2 0 002 18V6z" fill="#f59e0b"/><path d="M4.5 19h15.2a2 2 0 001.9-1.4l2.1-7a1.5 1.5 0 00-1.4-1.9H6.1a2 2 0 00-1.9 1.4l-2.3 7.5A1.5 1.5 0 003.3 21h1.2z" fill="#fbbf24"/></svg>';

const RICH_ICONS={
  html:'<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 3h16l-1.5 15.5L12 21l-6.5-2.5L4 3z" fill="#ea580c"/><path d="M12 5v14l4.8-1.8 1.1-12.2H12z" fill="#f97316"/><path d="M8 8h8M8 11h8M8 14h5" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>',
  css:'<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 3h16l-1.5 15.5L12 21l-6.5-2.5L4 3z" fill="#0284c7"/><path d="M12 5v14l4.8-1.8 1.1-12.2H12z" fill="#38bdf8"/><text x="7" y="15" fill="#fff" font-size="9" font-weight="bold" font-family="monospace">#</text></svg>',
  js:'<svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="4" fill="#eab308"/><text x="6" y="16.5" fill="#18181b" font-size="11" font-weight="900" font-family="sans-serif">JS</text></svg>',
  ts:'<svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="4" fill="#2563eb"/><text x="6" y="16.5" fill="#ffffff" font-size="11" font-weight="900" font-family="sans-serif">TS</text></svg>',
  py:'<svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="4" fill="#1e293b"/><path d="M12 6c-2.5 0-2.3 1.1-2.3 1.1l.02 1.2h2.3v.3H8.3S6 8.3 6 10.8s2 2.4 2 2.4h1.2v-1.2s-.1-1.3 1.3-1.3h2.3s1.2-.1 1.2-1.2V8.3s.2-2.3-2-2.3zm-1.2.7a.5.5 0 110 1 .5.5 0 010-1z" fill="#38bdf8"/><path d="M12 18c2.5 0 2.3-1.1 2.3-1.1l-.02-1.2h-2.3v-.3h3.7s2.3.3 2.3-2.2-2-2.4-2-2.4h-1.2v1.2s.1 1.3-1.3 1.3h-2.3s-1.2.1-1.2 1.2v1.2s-.2 2.3 2 2.3zm1.2-.7a.5.5 0 110-1 .5.5 0 010 1z" fill="#facc15"/></svg>',
  json:'<svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="4" fill="#15803d"/><text x="6" y="16.5" fill="#ffffff" font-size="11" font-weight="bold" font-family="monospace">{}</text></svg>',
  md:'<svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="4" fill="#7c3aed"/><text x="5" y="16.5" fill="#ffffff" font-size="10" font-weight="900" font-family="sans-serif">M↓</text></svg>',
  img:'<svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="4" fill="#059669"/><circle cx="8" cy="8" r="2" fill="#a7f3d0"/><path d="M5 18l5-5 3 3 4-4 4 4v2H5z" fill="#ecfdf5"/></svg>',
  sh:'<svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="4" fill="#0f172a"/><path d="M7 9l3 3-3 3M12 15h5" stroke="#4ade80" stroke-width="1.8" stroke-linecap="round"/></svg>',
  git:'<svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="4" fill="#ea580c"/><circle cx="9" cy="15" r="2" fill="#fff"/><circle cx="15" cy="9" r="2" fill="#fff"/><path d="M9 13V9l4-2M15 11v4" stroke="#fff" stroke-width="1.5"/></svg>',
  doc:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none"><rect x="4" y="3" width="16" height="18" rx="3" fill="#27272a"/><path d="M8 8h8M8 12h8M8 16h5" stroke="#a1a1aa" stroke-width="1.5" stroke-linecap="round"/></svg>'
};

O.fileIcon=(name,isDir,open)=>{
  const span=document.createElement('span');
  span.className='fi';
  span.style.display='inline-flex';
  span.style.alignItems='center';
  span.style.justifyContent='center';
  span.style.flex='0 0 20px';
  if(isDir){
    span.innerHTML=open?FOLDER_OPEN_SVG:FOLDER_SVG;
    return span;
  }
  const ext=O.ext(name).toLowerCase();
  const low=String(name).toLowerCase();
  let iconHtml=RICH_ICONS.doc;
  if(ext==='html'||ext==='htm')iconHtml=RICH_ICONS.html;
  else if(ext==='css'||ext==='scss'||ext==='sass'||ext==='less')iconHtml=RICH_ICONS.css;
  else if(ext==='js'||ext==='mjs'||ext==='cjs'||ext==='jsx')iconHtml=RICH_ICONS.js;
  else if(ext==='ts'||ext==='mts'||ext==='tsx')iconHtml=RICH_ICONS.ts;
  else if(ext==='py'||ext==='pyw')iconHtml=RICH_ICONS.py;
  else if(ext==='json'||ext==='jsonc'||ext==='yaml'||ext==='yml'||ext==='toml')iconHtml=RICH_ICONS.json;
  else if(ext==='md'||ext==='mdx'||ext==='txt')iconHtml=RICH_ICONS.md;
  else if(['png','jpg','jpeg','gif','svg','webp','ico','bmp'].includes(ext))iconHtml=RICH_ICONS.img;
  else if(['sh','bash','zsh','fish'].includes(ext))iconHtml=RICH_ICONS.sh;
  else if(low.includes('git')||low==='.gitignore')iconHtml=RICH_ICONS.git;
  span.innerHTML=iconHtml;
  return span;
};
O.iconsReady=Promise.resolve();
// language for highlight.js
const LANG={py:'python',js:'javascript',mjs:'javascript',cjs:'javascript',ts:'typescript',tsx:'typescript',jsx:'javascript',json:'json',jsonc:'json',md:'markdown',html:'xml',htm:'xml',xml:'xml',svg:'xml',css:'css',scss:'scss',less:'less',go:'go',rs:'rust',java:'java',kt:'kotlin',kts:'kotlin',swift:'swift',c:'c',h:'c',cpp:'cpp',cc:'cpp',hpp:'cpp',cs:'csharp',php:'php',rb:'ruby',lua:'lua',sh:'bash',bash:'bash',zsh:'bash',yml:'yaml',yaml:'yaml',toml:'ini',ini:'ini',sql:'sql',dockerfile:'dockerfile',gradle:'groovy',vue:'xml',diff:'diff',patch:'diff'};
O.langOf=p=>LANG[O.ext(p)]||(O.basename(p).toLowerCase()==='dockerfile'?'dockerfile':null);
// highlighted code split into lines (keeps spans balanced across lines)
O.codeLines=(text,lang)=>{let html;try{html=lang&&hljs.getLanguage(lang)?hljs.highlight(text,{language:lang,ignoreIllegals:true}).value:O.esc(text)}catch{html=O.esc(text)}
  const out=[];let open=[];for(const line of html.split('\n')){let s=open.join('')+line;const re=/<span[^>]*>|<\/span>/g;let m;const st=[...open];
    while((m=re.exec(line))){if(m[0]==='</span>')st.pop();else st.push(m[0])}open=st;out.push(s+'</span>'.repeat(st.length))}return out};
O.codeView=(text,path)=>{const lines=text.split('\n');const big=lines.length>4000;const use=big?lines.slice(0,4000).join('\n'):text;
  const hl=O.codeLines(use,big?null:O.langOf(path));const box=h('div',{class:'code-view'});
  const fr=document.createDocumentFragment();hl.forEach((l,i)=>{const row=h('div',{class:'ln'},h('i',null,i+1),h('span',{html:l||' '}));fr.append(row)});box.append(fr);
  if(big)box.append(h('div',{class:'mut s',style:{padding:'8px 12px'}},'Показаны первые 4000 строк'));
  // Minimap: a thin column on the right showing the file's shape (indentation + non-empty lines).
  // It doubles as a scrollbar — tapping a spot jumps to that part of the file.
  if(hl.length>60){
    const wrap=h('div',{style:{position:'relative',display:'flex',flex:1,minHeight:0,overflow:'hidden'}});
    const holder=box.parentNode;
    if(holder)holder.replaceChild(wrap,box);
    wrap.append(box);
    const map=h('div',{style:{flex:'0 0 46px',position:'relative',overflow:'hidden',background:'var(--bg2)',borderLeft:'1px solid var(--line)',cursor:'pointer'}});
    const canvas=h('canvas',{style:{width:'100%',height:'100%',display:'block'}});
    map.append(canvas);
    wrap.append(map);
    const paintMap=()=>{
      const dpr=Math.min(2,window.devicePixelRatio||1);
      canvas.width=46*dpr;canvas.height=Math.max(1,map.clientHeight)*dpr;
      const g=canvas.getContext('2d');g.scale(dpr,dpr);
      g.clearRect(0,0,46,map.clientHeight);
      const n=hl.length, step=map.clientHeight/n;
      const accent=getComputedStyle(document.documentElement).getPropertyValue('--acc').trim()||'#fab283';
      g.fillStyle=accent;
      for(let i=0;i<n;i++){
        const line=hl[i].replace(/<[^>]*>/g,'');
        if(!line.trim())continue;
        const indent=(line.match(/^\s*/)||[''])[0].length;
        const x=4+Math.min(26,indent*1.1);
        const w=Math.min(34-x,(line.trim().length/6)|0)||2;
        g.globalAlpha=0.55;
        g.fillRect(x,i*step,Math.max(1,w),Math.max(0.7,step));
      }
      // viewport indicator
      const total=box.scrollHeight||1;
      const top=(box.scrollTop/total)*map.clientHeight;
      const hgt=Math.max(8,(box.clientHeight/total)*map.clientHeight);
      g.globalAlpha=0.16;g.fillStyle='#fff';g.fillRect(0,top,46,hgt);
    };
    const ro=new ResizeObserver(()=>paintMap());ro.observe(map);
    requestAnimationFrame(paintMap);
    map.addEventListener('click',e=>{
      const rect=map.getBoundingClientRect();
      const pct=(e.clientY-rect.top)/rect.height;
      box.scrollTop=pct*(box.scrollHeight-box.clientHeight);
    });
    map.addEventListener('pointermove',e=>{
      if(e.buttons!==1)return;
      const rect=map.getBoundingClientRect();
      const pct=(e.clientY-rect.top)/rect.height;
      box.scrollTop=pct*(box.scrollHeight-box.clientHeight);
    });
    // repaint the viewport marker while scrolling (throttled: it is only decoration)
    const onScroll=()=>{if(map._t)return;map._t=requestAnimationFrame(()=>{map._t=0;paintMap()})};
    box.addEventListener('scroll',onScroll,{passive:true});
  }
  return box};
})();
