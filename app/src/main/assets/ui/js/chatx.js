(function(){
const O=window.OCM,h=O.h,S=O.S,api=O.api,bus=O.bus;
// ---- 12: offline diagrams in answers ----
// ```mermaid flowcharts and ```chart bar/line blocks render as inline SVG, no network, no deps.
// Unknown/complex mermaid falls back to the highlighted code block.
function parseFlow(src){
  const lines=String(src).split('\n').map(l=>l.trim()).filter(l=>l&&!l.startsWith('%%'));
  if(!lines.length)return null;
  const head=lines[0].toLowerCase();
  let dir='TB';
  if(/^(graph|flowchart)\s+(tb|td|bt|lr|rl)/.test(head)){dir=/lr/.test(head)?'LR':/rl/.test(head)?'RL':/bt/.test(head)?'BT':'TB';lines.shift()}
  else if(!/^(graph|flowchart)/.test(head))return null;
  else lines.shift();
  const nodes=new Map(),edges=[];
  const label=s=>s.replace(/^["'`]|["'`]$/g,'').trim();
  const addNode=(id,txt,shape)=>{if(!nodes.has(id))nodes.set(id,{id,label:txt||id,shape:shape||'rect'});else if(txt&&nodes.get(id).label===id)nodes.get(id).label=txt};
  for(const l of lines){
    const em=l.match(/^([A-Za-z0-9_.-]+)\s*(\[\[([^\]]*)\]\]|\[([^\]]*)\]|\(\(([^)]*)\)\)|\(([^)]*)\)|\{([^}]*)\})\s*$/);
    if(em){addNode(em[1],label(em[3]||em[4]||em[5]||em[6]||em[7]||''),em[5]?'circle':em[7]?'diamond':'rect');continue}
    const chain=l.split(/--?>|==?>/);
    if(chain.length<2){const bare=l.match(/^([A-Za-z0-9_.-]+)$/);if(bare)addNode(bare[1]);continue}
    let prev=null;
    for(let i=0;i<chain.length;i++){
      let seg=chain[i].trim();
      let edgeLabel='';
      const lm=seg.match(/\|([^|]*)\|\s*(.*)$/);
      if(lm){edgeLabel=label(lm[1]);seg=lm[2].trim()}
      const nm=seg.match(/^([A-Za-z0-9_.-]+)\s*(\[\[([^\]]*)\]\]|\[([^\]]*)\]|\(\(([^)]*)\)\)|\(([^)]*)\)|\{([^}]*)\})?/);
      if(!nm){prev=null;continue}
      addNode(nm[1],nm[2]?label(nm[3]||nm[4]||nm[5]||nm[6]||nm[7]||''):'',nm[5]?'circle':nm[7]?'diamond':'rect');
      if(prev)edges.push({from:prev,to:nm[1],label:edgeLabel});
      prev=nm[1];
    }
  }
  if(!nodes.size)return null;
  return{dir,nodes:[...nodes.values()],edges};
}
function layoutFlow(g){
  const{nodes,edges,dir}=g;
  const idx=new Map(nodes.map((n,i)=>[n.id,i]));
  const depth=new Array(nodes.length).fill(0);
  for(let pass=0;pass<nodes.length;pass++){
    let changed=false;
    for(const e of edges){const a=idx.get(e.from),b=idx.get(e.to);
      if(a==null||b==null||a===b)continue;
      if(depth[b]<depth[a]+1&&depth[a]+1<nodes.length){depth[b]=depth[a]+1;changed=true}}
    if(!changed)break;
  }
  const layers=new Map();
  nodes.forEach((n,i)=>{const d=depth[i];if(!layers.has(d))layers.set(d,[]);layers.get(d).push(n)});
  const NW=150,NH=44,GX=56,GY=34;
  const horiz=dir==='LR'||dir==='RL';
  const pos=new Map();
  let maxRow=0;
  const keys=[...layers.keys()].sort((a,b)=>dir==='BT'||dir==='RL'?b-a:a-b);
  keys.forEach((d,li)=>{
    const row=layers.get(d);maxRow=Math.max(maxRow,row.length);
    row.forEach((n,ni)=>{
      pos.set(n.id,horiz?{x:li*(NW+GX),y:ni*(NH+GY)}:{x:ni*(NW+GX),y:li*(NH+GY)});
    });
  });
  const cols=horiz?keys.length:maxRow,rows=horiz?maxRow:keys.length;
  return{pos,W:Math.max(1,cols)*(NW+GX)-GX+24,H:Math.max(1,rows)*(NH+GY)-GY+24,NW,NH};
}
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function svgFlow(g){
  const L=layoutFlow(g);
  const css=getComputedStyle(document.documentElement);
  const acc=css.getPropertyValue('--acc').trim()||'#fab283';
  const fg=css.getPropertyValue('--fg').trim()||'#eee';
  const mut=css.getPropertyValue('--mut').trim()||'#999';
  const card=css.getPropertyValue('--card').trim()||'#222';
  const line=css.getPropertyValue('--line2').trim()||'rgba(255,255,255,.2)';
  let out='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+L.W+' '+L.H+'" style="max-width:100%;height:auto">';
  out+='<defs><marker id="ocm-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="'+esc(mut)+'"/></marker></defs>';
  for(const e of g.edges){
    const a=L.pos.get(e.from),b=L.pos.get(e.to);if(!a||!b)continue;
    const x1=a.x+12+L.NW/2,y1=a.y+12+L.NH/2,x2=b.x+12+L.NW/2,y2=b.y+12+L.NH/2;
    const dx=x2-x1,dy=y2-y1;
    const sx=Math.abs(dx)>Math.abs(dy)?Math.sign(dx)*L.NW/2:0;
    const sy=Math.abs(dx)>Math.abs(dy)?0:Math.sign(dy)*L.NH/2;
    const ex=Math.abs(dx)>Math.abs(dy)?-Math.sign(dx)*(L.NW/2+4):0;
    const ey=Math.abs(dx)>Math.abs(dy)?0:-Math.sign(dy)*(L.NH/2+4);
    out+='<path d="M'+(x1+sx)+' '+(y1+sy)+' L'+(x2+ex)+' '+(y2+ey)+'" stroke="'+esc(mut)+'" stroke-width="1.6" fill="none" marker-end="url(#ocm-arr)"/>';
    if(e.label)out+='<text x="'+((x1+x2)/2)+'" y="'+((y1+y2)/2-6)+'" fill="'+esc(mut)+'" font-size="11" text-anchor="middle">'+esc(e.label)+'</text>';
  }
  for(const n of g.nodes){
    const p=L.pos.get(n.id);if(!p)continue;
    const x=p.x+12,y=p.y+12;
    if(n.shape==='diamond'){
      const cx=x+L.NW/2,cy=y+L.NH/2;
      out+='<path d="M'+cx+' '+(y-6)+' L'+(x+L.NW+8)+' '+cy+' L'+cx+' '+(y+L.NH+6)+' L'+(x-8)+' '+cy+' Z" fill="'+esc(card)+'" stroke="'+esc(acc)+'" stroke-width="1.6"/>';
    }else if(n.shape==='circle'){
      out+='<ellipse cx="'+(x+L.NW/2)+'" cy="'+(y+L.NH/2)+'" rx="'+(L.NW/2)+'" ry="'+(L.NH/2+4)+'" fill="'+esc(card)+'" stroke="'+esc(acc)+'" stroke-width="1.6"/>';
    }else{
      out+='<rect x="'+x+'" y="'+y+'" width="'+L.NW+'" height="'+L.NH+'" rx="10" fill="'+esc(card)+'" stroke="'+esc(line)+'" stroke-width="1.4"/>';
    }
    const txt=n.label.length>22?n.label.slice(0,21)+'…':n.label;
    out+='<text x="'+(x+L.NW/2)+'" y="'+(y+L.NH/2+4)+'" fill="'+esc(fg)+'" font-size="12.5" font-weight="600" text-anchor="middle" font-family="sans-serif">'+esc(txt)+'</text>';
  }
  out+='</svg>';
  return out;
}
function svgChart(src){
  const lines=String(src).split('\n').map(l=>l.trim()).filter(Boolean);
  const items=[];
  for(const l of lines){
    const m=l.match(/^(.+?)\s*[:=]\s*(-?\d+(?:\.\d+)?)$/);
    if(m)items.push({label:m[1].trim(),v:parseFloat(m[2])});
  }
  if(items.length<2)return null;
  const css=getComputedStyle(document.documentElement);
  const acc=css.getPropertyValue('--acc').trim()||'#fab283';
  const acc2=css.getPropertyValue('--acc2').trim()||'#38bdf8';
  const fg=css.getPropertyValue('--fg').trim()||'#eee';
  const mut=css.getPropertyValue('--mut').trim()||'#999';
  const W=Math.max(280,items.length*64),H=180,P=28;
  const max=Math.max(...items.map(x=>x.v),0.001);
  const bw=Math.min(40,(W-P*2)/items.length-12);
  let out='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+W+' '+H+'" style="max-width:100%;height:auto">';
  out+='<line x1="'+P+'" y1="'+(H-P)+'" x2="'+(W-P)+'" y2="'+(H-P)+'" stroke="'+esc(mut)+'" stroke-width="1"/>';
  items.forEach((it,i)=>{
    const x=P+((W-P*2)/items.length)*(i+0.5)-bw/2;
    const hgt=Math.max(2,(it.v/max)*(H-P*2-14));
    out+='<rect x="'+x+'" y="'+(H-P-hgt)+'" width="'+bw+'" height="'+hgt+'" rx="5" fill="'+esc(i%2?acc2:acc)+'" opacity="0.9"/>';
    out+='<text x="'+(x+bw/2)+'" y="'+(H-P-hgt-5)+'" fill="'+esc(fg)+'" font-size="11" text-anchor="middle" font-weight="700">'+esc(String(it.v))+'</text>';
    const lb=it.label.length>9?it.label.slice(0,8)+'…':it.label;
    out+='<text x="'+(x+bw/2)+'" y="'+(H-P+14)+'" fill="'+esc(mut)+'" font-size="10.5" text-anchor="middle">'+esc(lb)+'</text>';
  });
  out+='</svg>';
  return out;
}
O.renderDiagrams=el=>{
  el.querySelectorAll('.codeblock').forEach(wrap=>{
    if(wrap.dataset.diagram)return;
    const bar=wrap.querySelector('.code-bar span');
    const lang=(bar?bar.textContent:'').toLowerCase();
    if(lang!=='mermaid'&&lang!=='chart'&&lang!=='flowchart')return;
    const code=wrap.querySelector('code');if(!code)return;
    const src=code.textContent;
    let svg=null;
    try{
      if(lang==='chart')svg=svgChart(src);
      else{const g=parseFlow(src);if(g)svg=svgFlow(g)}
    }catch(_){}
    if(!svg)return;
    wrap.dataset.diagram='1';
    const box=h('div',{class:'diagram-box',html:svg});
    const toggle=h('button',{class:'btn sm diagram-src-btn'},O.icon('code'),O.tr('Source','Исходник'));
    let showSrc=false;
    toggle.onclick=()=>{showSrc=!showSrc;wrap.querySelector('pre').style.display=showSrc?'':'none';box.style.display=showSrc?'none':''};
    wrap.querySelector('pre').style.display='none';
    wrap.append(box);
    wrap.querySelector('.code-bar').append(toggle);
  });
};
// ---- 13: session media ribbon ----
O.sessionMedia=sid=>{
  const out=[];
  for(const m of O.msgs(sid||S.sid).list){
    for(const p of m.parts||[]){
      if(p.type==='file'&&p.url){
        const mime=String(p.mime||'');
        if(mime.startsWith('image/')||mime.startsWith('video/')||/\.(png|jpe?g|webp|gif|mp4|webm)$/i.test(p.url))
          out.push({url:p.url,mime,filename:p.filename||'media',mid:m.info.id,at:(m.info.time&&m.info.time.created)||0});
      }
      if(p.type==='text'&&p.text){
        const re=/!\[[^\]]*\]\(([^)\s]+)\)/g;let mm;
        while((mm=re.exec(p.text)))out.push({url:mm[1],mime:'image/*',filename:O.basename(mm[1]),mid:m.info.id,at:(m.info.time&&m.info.time.created)||0});
        const re2=/(?:^|\s)((?:\/root|\/sdcard)[^\s"'<>]*\.(?:png|jpe?g|webp|gif|mp4|webm))/gi;
        while((mm=re2.exec(p.text))){
          const url=O.mediaUrl?O.mediaUrl(mm[1]):mm[1];
          out.push({url,mime:/mp4|webm/i.test(mm[1])?'video/*':'image/*',filename:O.basename(mm[1]),mid:m.info.id,at:(m.info.time&&m.info.time.created)||0});
        }
      }
    }
  }
  const seen=new Set();
  return out.filter(x=>{if(seen.has(x.url))return false;seen.add(x.url);return true});
};
O.openSessionRibbon=()=>{
  if(!S.sid)return O.toast(O.tr('Open a session first','Сначала откройте сессию'),2000);
  const items=O.sessionMedia(S.sid);
  const body=h('div');
  if(!items.length){body.append(h('div',{class:'note'},O.tr('No media in this session yet. Generated images and attachments appear here.','В этой сессии пока нет медиа. Сгенерированные картинки и вложения появятся здесь.')))}
  else{
    const strip=h('div',{class:'media-ribbon'});
    items.forEach(it=>{
      const cell=/video/.test(it.mime)||/\.(mp4|webm)$/i.test(it.url)
        ?h('video',{src:it.url,preload:'metadata',muted:true})
        :h('img',{src:it.url,loading:'lazy'});
      strip.append(h('button',{class:'ribbon-cell',title:it.filename,onclick:()=>{s.close();O.jumpToMsg&&O.jumpToMsg(it.mid);setTimeout(()=>openViewer(it),350)}},cell,h('span',{class:'ribbon-name'},it.filename)));
    });
    body.append(h('div',{class:'note'},O.tr('Tap a tile to jump to its message','Тап по плитке — прыжок к сообщению')),strip);
  }
  const s=O.sheet(O.tr('Session media','Медиа сессии'),body,{full:true});
  function openViewer(it){
    const v=h('div',{class:'ribbon-viewer'},
      /video/.test(it.mime)||/\.(mp4|webm)$/i.test(it.url)?h('video',{src:it.url,controls:true,autoplay:true}):h('img',{src:it.url}));
    O.sheet(it.filename,v,{full:true});
  }
};
// ---- shared: ask the current model in a throwaway session (no chat pollution) ----
async function sideAsk(prompt,timeoutMs){
  if(!S.model)throw new Error(O.tr('No model selected','Модель не выбрана'));
  const ses=await api('POST','/session',{title:'OCM side task'});
  try{
    await api('POST','/session/'+ses.id+'/prompt_async',{messageID:O.mid(),model:S.model,parts:[{type:'text',text:prompt}]},{timeout:30000,dir:false});
    const deadline=Date.now()+(timeoutMs||90000);
    while(Date.now()<deadline){
      await new Promise(r=>setTimeout(r,1200));
      const st=await api('GET','/session/status',null,{timeout:5000,dir:false}).catch(()=>null);
      const t0=st&&st[ses.id],t=typeof t0==='string'?t0:(t0&&t0.type);
      if(!t||t==='idle'||t==='error')break;
    }
    const arr=await api('GET','/session/'+ses.id+'/message',null,{timeout:20000,dir:false});
    let txt='';
    for(const mm of arr||[])if(mm.info&&mm.info.role==='assistant'){const t2=(mm.parts||[]).filter(p=>p.type==='text').map(p=>p.text).join('\n');if(t2.trim())txt=t2}
    return txt.trim();
  }finally{try{await api('DELETE','/session/'+ses.id)}catch(_){}}
}
O.sideAsk=sideAsk;
// ---- 15: AI stage titles for command packs ----
const stageTitles=O.store.get('stageTitles',{});
let stageBusy=false;
O.stageTitleFor=(key,parts)=>{
  if(stageTitles[key])return stageTitles[key];
  if(stageBusy||!S.model||!O.store.get('aiStageTitles',true))return null;
  const sig=parts.map(p=>p.id).join(',');
  if(O._stageAsked===sig)return null;
  const done=parts.every(p=>!p.state||p.state.status==='completed'||p.state.status==='error');
  if(!done||parts.length<2)return null;
  O._stageAsked=sig;stageBusy=true;
  const desc=parts.slice(0,12).map(p=>{
    const i=(p.state&&p.state.input)||{};
    return(p.tool||p.type)+': '+String(i.description||i.command||i.filePath||i.pattern||i.query||'').slice(0,100);
  }).join('\n');
  sideAsk('Придумай ОЧЕНЬ короткий заголовок этапа работы агента (2-4 слова, по-русски, без кавычек и точки). Только заголовок, ничего больше. Команды этапа:\n'+desc,45000)
    .then(t=>{
      t=t.split('\n')[0].replace(/^["'«»]+|["'«»]+$/g,'').trim().slice(0,60);
      if(t){stageTitles[key]=t;
        const cut=Object.keys(stageTitles);if(cut.length>400)cut.slice(0,100).forEach(k=>delete stageTitles[k]);
        O.store.set('stageTitles',stageTitles);
        bus.emit('stageTitle',key);}
    }).catch(()=>{}).finally(()=>{stageBusy=false});
  return null;
};
// FIX (audit #11): a completed AI stage title used to trigger a FULL renderAll with forced
// bottom-scroll — readers above got yanked down after every pack. Update just that pack's head.
bus.on('stageTitle',key=>{
  const g=document.querySelector('.cmd-group[data-gkey="'+(window.CSS&&CSS.escape?CSS.escape(key):key)+'"]');
  if(g&&g._parts&&g._info){
    const m=O.msgs(g._info.sessionID).idx.get(g._mid);
    if(m){g._sig='';bus.emit('part',g._info.sessionID,m)}
  }
});
// ---- 32: long-session summary with expand ----
O.openSessionSummary=async()=>{
  if(!S.sid)return O.toast(O.tr('Open a session first','Сначала откройте сессию'),2000);
  const list=O.visibleMsgs(S.sid);
  if(list.length<10)return O.toast(O.tr('Session is short — no summary needed','Сессия короткая — саммари не нужно'),2200);
  const cached=O.store.get('summary.'+S.sid,null);
  const body=h('div');
  const out=h('div',{class:'card',style:{padding:'12px',whiteSpace:'pre-wrap',fontSize:'13.5px',lineHeight:'1.55'}});
  body.append(h('div',{class:'note'},O.tr('AI summary of the whole session. The original messages stay untouched.','ИИ-саммари всей сессии. Оригинальные сообщения не меняются.')),out);
  const expand=h('button',{class:'btn wide',style:{marginTop:'10px'}},O.icon('list'),O.tr('Expand original (jump to start)','Развернуть оригинал (к началу)'));
  expand.onclick=()=>{s.close();const first=list[0];O.jumpToMsg&&O.jumpToMsg(first.info.id)};
  body.append(expand);
  const s=O.sheet(O.tr('Session summary','Саммари сессии'),body,{full:true});
  const sig=list.length+':'+(list[list.length-1].info.id||'');
  if(cached&&cached.sig===sig){out.textContent=cached.text;return}
  out.textContent=O.tr('Summarizing…','Сжимаю в саммари…');
  const digest=list.slice(0,120).map(m=>{
    const t=(m.parts||[]).filter(p=>p.type==='text'&&!p.synthetic).map(p=>p.text).join(' ').replace(/\s+/g,' ').slice(0,220);
    return(m.info.role==='user'?'Ю: ':'А: ')+t;
  }).join('\n');
  try{
    const txt=await sideAsk('Сожми диалог в саммари (по-русски, 6-10 пунктов): главные задачи, что сделано, ключевые решения, что осталось. Только пункты, без вступлений.\n\n'+digest,120000);
    if(!txt){out.textContent=O.tr('(no answer)','(нет ответа)');return}
    out.textContent=txt;
    O.store.set('summary.'+S.sid,{sig,text:txt,at:Date.now()});
  }catch(e){out.textContent=e.message||String(e)}
};
// ---- 48: AI table of contents with anchors ----
O.openAiToc=async()=>{
  if(!S.sid)return O.toast(O.tr('Open a session first','Сначала откройте сессию'),2000);
  const list=O.visibleMsgs(S.sid).filter(m=>m.info.role==='user');
  if(!list.length)return O.toast(O.tr('No prompts yet','Запросов пока нет'),2000);
  const body=h('div');
  const s=O.sheet(O.tr('AI outline','ИИ-оглавление'),body,{full:true});
  const cached=O.store.get('aitoc.'+S.sid,null);
  const sig=list.length+':'+list[list.length-1].info.id;
  const render=sections=>{
    body.textContent='';
    sections.forEach(sec=>{
      body.append(h('div',{class:'grp'},sec.title));
      (sec.items||[]).forEach(it=>{
        const m=list.find(x=>x.info.id===it.id)||list[it.idx];
        if(!m)return;
        body.append(h('button',{class:'settings-row',onclick:()=>{s.close();O.jumpToMsg&&O.jumpToMsg(m.info.id)}},
          h('div',{class:'settings-row-icon'},O.icon('chat')),
          h('div',{class:'settings-row-text'},h('b',{style:{whiteSpace:'normal'}},it.label),h('span',null,new Date(m.info.time.created).toLocaleTimeString().slice(0,5)))));
      });
    });
    const regen=h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:()=>{O.store.remove('aitoc.'+S.sid);s.close();setTimeout(()=>O.openAiToc(),200)}},O.icon('refresh'),O.tr('Regenerate','Пересобрать'));
    body.append(regen);
  };
  if(cached&&cached.sig===sig){render(cached.sections);return}
  body.append(h('div',{class:'note'},O.icon('refresh'),O.tr('AI is grouping your prompts into sections…','ИИ группирует запросы в разделы…')));
  const digest=list.slice(0,80).map((m,i)=>{
    const t=(m.parts||[]).filter(p=>p.type==='text').map(p=>p.text).join(' ').replace(/\s+/g,' ').slice(0,140);
    return i+'|'+t;
  }).join('\n');
  try{
    const raw=await sideAsk('Сгруппируй запросы пользователя в 3-7 тематических разделов. Ответь ТОЛЬКО JSON массивом: [{"title":"Название раздела","items":[{"idx":0,"label":"короткое описание запроса (до 60 символов)"}]}]. idx — номер строки из списка. Каждый запрос ровно в одном разделе. Список (idx|текст):\n'+digest,120000);
    const jm=raw.match(/\[[\s\S]*\]/);
    if(!jm)throw new Error('bad json');
    const sections=JSON.parse(jm[0]).filter(x=>x&&x.title&&Array.isArray(x.items)).slice(0,10);
    if(!sections.length)throw new Error('empty');
    O.store.set('aitoc.'+S.sid,{sig,sections,at:Date.now()});
    render(sections);
  }catch(e){
    body.textContent='';
    body.append(h('div',{class:'note'},O.tr('AI outline failed — showing the plain outline','ИИ-оглавление не удалось — обычное оглавление')));
    list.forEach((m,i)=>{
      const t=(m.parts||[]).filter(p=>p.type==='text').map(p=>p.text).join(' ').replace(/\s+/g,' ').slice(0,90);
      body.append(h('button',{class:'settings-row',onclick:()=>{s.close();O.jumpToMsg&&O.jumpToMsg(m.info.id)}},
        h('div',{class:'settings-row-icon'},h('b',{style:{fontSize:'12px'}},String(i+1))),
        h('div',{class:'settings-row-text'},h('b',{style:{whiteSpace:'normal'}},t||O.tr('(attachment)','(вложение)')))));
    });
  }
};
})();