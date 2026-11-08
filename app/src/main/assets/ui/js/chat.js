(function(){
const O=window.OCM,h=O.h,S=O.S,api=O.api,bus=O.bus;
let msgsEl,dockEl,popEl,ta,sendBtn,agentChip,modelChip,varChip,attsEl,jumpEl,statusEl,todoEl,revEl,fileIn,nokeyEl,comp,projChip,vcsChip,projTxt,vcsTxt,footerPrompt,chatRoot,mmProgressEl;
const msgEls=new Map(),partEls=new Map(),open=new Set(),timers=new Map();
let atts=[],mentions=[],stick=true,revKey='',trail=[];
let pendingHead=[],loadingOlder=false;
const RENDER_TAIL=28, RENDER_CHUNK=24;
O.rel=p=>{p=String(p||'');return S.dir&&p.startsWith(S.dir+'/')?p.slice(S.dir.length+1):p};
const cur=()=>S.sessions.find(x=>x.id===S.sid)||O.child(S.sid);
const modelStr=()=>S.model?S.model.providerID+'/'+S.model.modelID:undefined;
const busy=()=>{const s=S.status[S.sid];return !!s&&s.type!=='idle'};

O.chatInit=root=>{
  chatRoot=root;
  msgsEl=h('div',{id:'msgs',class:'sel',onscroll:()=>{stick=nearBottom();jumpEl.classList.toggle('hide',stick);maybeLoadOlder()}});
  jumpEl=h('button',{id:'jump',class:'hide',onclick:()=>scrollEnd(true)},O.icon('chevD'));
  revEl=h('div',{class:'hide',style:{padding:'0 10px 6px'}});
  todoEl=h('div',{class:'hide',style:{padding:'0 10px 6px'}});
  dockEl=h('div',{id:'dock'});statusEl=h('div',{class:'status-line hide'});
  mmProgressEl=h('div',{id:'mm-progress',class:'hide'});
  popEl=h('div',{id:'pop',class:'hide'});attsEl=h('div',{class:'atts hide'});
  nokeyEl=h('div',{class:'nokey hide'},h('span',{class:'grow'},O.tr('No models connected.','Модели не подключены.')),h('button',{class:'btn sm',onclick:()=>O.openConnect()},O.icon('key'),O.tr('Connect','Подключить')));
  ta=h('textarea',{rows:1,placeholder:O.tr('Chat with OpenCode...','Чат с OpenCode...'),oninput:onInput,onclick:onInput,onkeyup:e=>{if(e.key.length>1)onInput()}});
  fileIn=h('input',{type:'file',multiple:true,class:'hide',accept:'image/*,application/pdf,text/*',onchange:onFiles});
  const plusBtn=h('button',{class:'attach-btn',onclick:()=>fileIn.click()},O.icon('plus'));
  agentChip=h('button',{class:'hud-pill agent-pill',onclick:()=>O.openAgents()},h('span',null,'Build'),O.icon('chevD'));
  if(agentChip._mmWatch===undefined){agentChip._mmWatch=1;bus.on('mm',updateChips)}
  modelChip=h('button',{class:'hud-pill model-pill',onclick:()=>O.openModels()},h('span',null,O.tr('Select model','Выбрать модель')),O.icon('chevD'));
  const micBtn=h('button',{class:'hud-icon-btn mic-btn',onclick:onMic},O.icon('mic'));
  sendBtn=h('button',{id:'send',onclick:onSend},O.icon('send'));
  const cbarLeft=h('div',{class:'cbar-left'},plusBtn,agentChip,modelChip);
  const cbarRight=h('div',{class:'cbar-right'},micBtn,sendBtn);
  const cbarRow=h('div',{class:'cbar-row'},cbarLeft,cbarRight);
  comp=h('div',{id:'composer'},popEl,h('div',{class:'cbox'},nokeyEl,attsEl,ta,cbarRow),fileIn);
  const wrap=h('div',{class:'chat-msgs-wrap',style:{position:'relative',flex:1,minHeight:0,display:'flex',flexDirection:'column'}},msgsEl,jumpEl);
  root.append(wrap,revEl,todoEl,statusEl,dockEl,mmProgressEl,comp);
  bus.on('open',()=>{renderAll()});
  bus.on('msg',(sid,m)=>{if(sid!==S.sid)return;const was=stick;ensureMsg(m);if(was)scrollEnd();O.runHook('onReceive',{message:m,sessionID:sid})});
  bus.on('part',(sid,m)=>{if(sid!==S.sid)return;const was=stick;ensureMsg(m);if(was)scrollEnd()});
  bus.on('msg-removed',(sid,id)=>{const e=msgEls.get(id);if(e){e.remove();msgEls.delete(id)}});
  bus.on('part-removed',(sid,m,pid)=>{const e=partEls.get(pid);if(e){e.remove();partEls.delete(pid)}});
  bus.on('status',sid=>{const st=S.status[sid];if(O._fallback&&O._fallback.sid===sid&&(!st||st.type==='idle'))O._fallback=null;if(sid===S.sid){renderStatus();updateSend()}if(O.mm.run)renderMmProgress()});
  bus.on('perm',renderDock);bus.on('todo',sid=>{if(sid===S.sid)renderTodos()});
  bus.on('session',()=>{const k=revisionKey();if(k!==revKey)renderAll();else renderRevert()});
  bus.on('sessions',()=>{renderRevert()});
  bus.on('mm:progress',renderMmProgress);
  bus.on('meta',updateChips);bus.on('conn',updateChips);
  bus.on('serror',p=>{if(p&&(!p.sessionID||p.sessionID===S.sid)){const e=p.error;const t=e&&(e.data&&e.data.message||e.name);if(t&&e.name!=='MessageAbortedError'){
    const quotaRe2=/quota|usage.?limit|rate.?limit|limit\s+reached|insufficient|exceeded|credit|balance|funds|\b429\b/i;
    if(O._fallback&&p.sessionID===O._fallback.sid&&O._fallback.tries.length){
      const fb=O._fallback;O._fallback=null;const next=fb.tries.shift();
      (async()=>{
        try{await api('POST','/session/'+fb.sid+'/revert',{messageID:fb.mid})}catch(_){}
        try{
          const mid=O.mid();
          await api('POST','/session/'+fb.sid+'/prompt_async',{messageID:mid,agent:S.agent,model:next,variant:S.variant||undefined,parts:fb.parts},{timeout:30000});
          O.toast(O.tr('Fallback model: ','Резервная модель: ')+next.modelID,3000);
          if(fb.tries.length)O._fallback={sid:fb.sid,mid,parts:fb.parts,tries:fb.tries};
        }catch(er){O.toast(er.message,4000)}
      })();
      return;
    }
    if(quotaRe2.test(String(t))){
      O.notifyLimit(O.tr('Limit Reached','Лимит исчерпан'),O.tr('Free quota limit reached.','Бесплатные лимиты закончились.'));
      O.showQuotaAccountModal(t);
    }
    else O.toast(t,4000)}}});
  O.on('voice',d=>{if(d&&d.text){ta.value=(ta.value?ta.value+' ':'')+d.text;onInput();ta.focus()}});
  updateChips();renderAll();
};
O.notifyLimit=(title,text)=>{
  try{if(window.OC&&OC.testSound)OC.testSound('quota')}catch(_){}
  try{if(O.native&&O.native.notify)O.native.notify('quota',title||O.tr('Limit Reached','Лимит исчерпан'),text||O.tr('Free quota limit reached.','Бесплатные лимиты закончились.'))}catch(_){}
};
O.checkTokenWarning=sid=>{
  if(!sid)return;
  const u=O.contextUsage(sid);if(!u||u.pct==null)return;
  const lvl=u.pct>=95?95:(u.pct>=80?80:0);
  const key='tokWarn.'+sid,prev=O.store.get(key,0)||0;
  if(lvl>prev){
    O.store.set(key,lvl);
    const txt=lvl>=95
      ?O.tr('Context is almost full ('+u.pct+'%). Compact the session or start a new one.','Контекст почти заполнен ('+u.pct+'%). Сожмите сессию или начните новую.')
      :O.tr('Context is '+u.pct+'% full. Consider /compact soon.','Контекст заполнен на '+u.pct+'%. Скоро стоит выполнить /compact.');
    O.toast(txt,5000);
    if(lvl>=95)O.notifyLimit(O.tr('Context almost full','Контекст почти заполнен'),txt);
  }else if(lvl===0&&prev){
    O.store.set(key,0);
  }
};
const nearBottom=()=>msgsEl.scrollHeight-msgsEl.scrollTop-msgsEl.clientHeight<140;
const scrollEnd=f=>{requestAnimationFrame(()=>{msgsEl.scrollTop=msgsEl.scrollHeight;if(f){stick=true;jumpEl.classList.add('hide')}})};
const revisionKey=()=>{const s=cur();return s&&s.revert?s.revert.messageID:''};

function renderAll(){
  msgsEl.innerHTML='';msgEls.clear();partEls.clear();revKey=revisionKey();
  const list=S.sid?O.visibleMsgs(S.sid):[];
  if(S.sid){const draft=O.getDraft(S.sid);if(draft&&!ta.value){ta.value=draft;autosize();updateSend()}}
  if(!list.length){pendingHead=[];showEmpty()}
  else{
    if(chatRoot)chatRoot.classList.remove('is-empty');
    const start=Math.max(0,list.length-RENDER_TAIL);
    pendingHead=list.slice(0,start);
    const fr=document.createDocumentFragment();
    for(let i=start;i<list.length;i++)fr.append(buildMsg(list[i]));
    msgsEl.append(fr);
  }
  scrollEnd(true);renderDock();renderStatus();renderRevert();renderTodos();updateSend();updateChips()}

function maybeLoadOlder(){
  if(loadingOlder||!pendingHead.length)return;
  if(msgsEl.scrollTop>220)return;
  loadingOlder=true;
  const prevH=msgsEl.scrollHeight,prevTop=msgsEl.scrollTop;
  const start=Math.max(0,pendingHead.length-RENDER_CHUNK);
  const chunk=pendingHead.slice(start);
  pendingHead=pendingHead.slice(0,start);
  const fr=document.createDocumentFragment();
  chunk.forEach(m=>fr.append(buildMsg(m)));
  const first=msgsEl.firstChild;
  if(first)msgsEl.insertBefore(fr,first);else msgsEl.append(fr);
  requestAnimationFrame(()=>{msgsEl.scrollTop=prevTop+(msgsEl.scrollHeight-prevH);loadingOlder=false});
  if(pendingHead.length===0)loadingOlder=false;
}
function showEmpty(){
  if(chatRoot)chatRoot.classList.add('is-empty');
  const wm=h('div',{class:'watermark-box'},O.wordmark('100%','auto'));
  msgsEl.append(h('div',{class:'empty'},wm))}
function ensureMsg(m){
  const rv=revisionKey();if(rv&&m.info.id>=rv)return;
  let el=msgEls.get(m.info.id);
  if(!el){const e=msgsEl.querySelector('.empty');if(e)e.remove();if(chatRoot)chatRoot.classList.remove('is-empty');el=buildMsg(m);
    let before=null;for(const c of msgsEl.children){if(c.dataset.id&&c.dataset.id>m.info.id){before=c;break}}
    msgsEl.insertBefore(el,before)}
  else{syncParts(el,m);metaUpdate(el,m)}}
function buildMsg(m){
  const el=h('div',{class:'msg '+m.info.role,'data-id':m.info.id},h('div',{class:'m-body'}),h('div',{class:'m-meta'}));
  msgEls.set(m.info.id,el);syncParts(el,m);metaUpdate(el,m);return el}
function showPart(m,p){
  if(m.info.role==='user')return(p.type==='text'&&!p.synthetic&&!p.ignored)||p.type==='file'||p.type==='agent';
  switch(p.type){case'text':return true;case'reasoning':{if(!S.opts.thinking)return false;const t=p.text||p.reasoning||p.thinking||'';return String(t).trim()!==''||!(p.time&&p.time.end)}case'tool':case'patch':case'retry':case'compaction':return true}return false}
function syncParts(el,m){
  const body=el.firstChild;const keep=new Set();let prev=null;
  for(const p of m.parts){if(!showPart(m,p))continue;keep.add(p.id);
    let pe=partEls.get(p.id);const fresh=!pe;
    if(fresh){pe=h('div',{class:'part','data-pid':p.id});partEls.set(p.id,pe)}
    const want=prev?prev.nextSibling:body.firstChild;
    if(pe.parentNode!==body||want!==pe)body.insertBefore(pe,want);
    fillPart(pe,p,m,fresh);prev=pe}
  for(const c of [...body.children]){if(!keep.has(c.dataset.pid)){partEls.delete(c.dataset.pid);c.remove()}}}
function fillPart(el,p,m,fresh){
  el._p=p;
  switch(p.type){
  case'text':
    if(m.info.role==='user'){el.className='part p-user';if(el._t!==p.text){el._t=p.text;el.textContent=p.text}}
    else{el.className='part p-text';if(fresh)render(el);else sched(p.id,()=>render(el))}break;
  case'reasoning':{el.className='part think';
    if(!el._d){el._d=h('details',null,h('summary',null,'Размышления'),h('div',{class:'p-text'}));el.append(el._d)}
    const b=el._d.lastChild;if(fresh)renderR(el,b);else sched(p.id,()=>renderR(el,b));break}
  case'tool':{const st=p.state||{};if(st.status==='running'&&p.tool==='bash'&&!el._auto){el._auto=1;open.add(p.id)}else if(st.status!=='running'&&el._auto===1){el._auto=2;open.delete(p.id)}
    if(fresh)fillTool(el,p);else sched(p.id,()=>fillTool(el,el._p));break}
  case'file':el.className='part fchips';el.textContent='';
    if((p.mime||'').startsWith('image/')&&p.url)el.append(h('img',{class:'thumb',src:p.url}));
    else el.append(h('span',{class:'chip'},O.fileIcon(p.filename||'file'),h('span',null,p.filename||'file')));break;
  case'agent':el.className='part fchips';el.textContent='';el.append(h('span',{class:'chip'},O.icon('bot'),h('span',null,'@'+p.name)));break;
  case'patch':el.className='part';el.textContent='';el.append(h('span',{class:'chip'},O.icon('edit'),h('span',null,'Изменено файлов: '+((p.files||[]).length))));break;
  case'retry':el.className='part warn s';el.textContent='Повтор: '+((p.error&&p.error.data&&p.error.data.message)||'запрос не удался');break;
  case'compaction':el.className='part sep';el.textContent='Контекст сжат';break}}
function getMsgDiff(m){
  let added=0,deleted=0,found=false;
  for(const p of m.parts){
    if(p.type==='patch'){
      found=true;
      if(Array.isArray(p.files)){
        p.files.forEach(f=>{
          if(typeof f.additions==='number')added+=f.additions;
          if(typeof f.deletions==='number')deleted+=f.deletions;
        });
      }
      if(p.diff){
        String(p.diff).split('\n').forEach(l=>{
          if(l.startsWith('+')&&!l.startsWith('+++'))added++;
          else if(l.startsWith('-')&&!l.startsWith('---'))deleted++;
        });
      }
    }
    if(p.type==='tool'&&p.metadata&&p.metadata.diff){
      found=true;
      String(p.metadata.diff).split('\n').forEach(l=>{
        if(l.startsWith('+')&&!l.startsWith('+++'))added++;
        else if(l.startsWith('-')&&!l.startsWith('---'))deleted++;
      });
    }
    if(p.type==='text'&&p.text){
      const mMatch=p.text.match(/(?:^|\n)\s*([+]\d+)\s+([-]\d+)\s*(?:$|\n)/);
      if(mMatch){
        if(added===0&&deleted===0){
          added=parseInt(mMatch[1].replace('+',''),10)||0;
          deleted=parseInt(mMatch[2].replace('-',''),10)||0;
          if(added>0||deleted>0)found=true;
        }
      }
    }
  }
  return{added,deleted,found};
}

function render(el){
  const p=el._p;if(el._t===p.text)return;el._t=p.text;
  let cleanText=p.text||'';
  // Strip trailing "+N -M" line from text so it is not duplicated above the badge!
  cleanText=cleanText.replace(/(?:\r?\n)+\s*[+]\d+\s+[-]\d+\s*$/g,'');
  O.mdInto(el,cleanText);
  if(O.initCustomWidgets)O.initCustomWidgets(el);
}
function renderR(el,b){const p=el._p;const t=p.text||p.reasoning||p.thinking||'';if(b._t===t)return;b._t=t;O.mdInto(b,t);
  const run=!(p.time&&p.time.end);el._d.firstChild.textContent=run?'Думает…':'Размышления'}
function sched(id,fn){if(timers.has(id))return;timers.set(id,setTimeout(()=>{timers.delete(id);fn();if(stick)scrollEnd()},100))}

function metaUpdate(el,m){
  const meta=el.lastChild;const i=m.info;meta.textContent='';
  if(i.role==='assistant'){
    const t=[];if(i.modelID)t.push(i.modelID);
    if(i.time&&i.time.completed&&i.time.created)t.push(((i.time.completed-i.time.created)/1000).toFixed(1)+'s');
    if(i.tokens&&(i.tokens.output||i.tokens.input))t.push(O.fmtK((i.tokens.input||0)+(i.tokens.output||0))+' tok');
    if(i.tokens&&(i.tokens.output||i.tokens.input)&&O.checkTokenWarning)O.checkTokenWarning(i.sessionID);
    if(i.cost)t.push('$'+i.cost.toFixed(4));
    // wall clock (hh:mm:ss, device time) right after tokens
    const done=i.time&&i.time.completed?i.time.completed:(i.time&&i.time.end?i.time.end:0);
    if(done)t.push(O.mmFmtClock?O.mmFmtClock(done):new Date(done).toTimeString().slice(0,8));
    meta.append(h('span',null,t.join('  ')));

    // Render diff stats line ONLY under messages that actually modified files (+N -M)
    const diffStat=getMsgDiff(m);
    const oldDiffLine=el.firstChild.querySelector('.msg-diff-line')||el.firstChild.querySelector('.msg-diff-badge');
    const hasDiff = (diffStat.added > 0 || diffStat.deleted > 0);
    if(hasDiff){
      const badge=h('div',{
        class:'msg-diff-line',
        title:O.tr('View code changes in project','Посмотреть изменения кода в проекте'),
        onclick:()=>O.setTab('changes')
      },
      h('span',{class:'diff-stat-val add'},'+'+diffStat.added),
      h('span',{style:{color:'#52525b'}},' '),
      h('span',{class:'diff-stat-val del'},'-'+diffStat.deleted));
      if(oldDiffLine)oldDiffLine.replaceWith(badge);
      else el.firstChild.append(badge);
    }else if(oldDiffLine){
      oldDiffLine.remove();
    }

    if(i.error&&i.error.name!=='MessageAbortedError'){const old=el.firstChild.querySelector('.errbox');if(old)old.remove();
      let em=(i.error.data&&i.error.data.message)||i.error.name||'Ошибка';
      if(/quota|usage.?limit|rate.?limit|limit\s+reached|insufficient|exceeded|credit|\b429\b/i.test(String(em))){
        em+='\n\n'+quotaHint();
        O.notifyLimit(O.tr('Limit Reached','Лимит исчерпан'),O.tr('Free quota limit reached.','Бесплатные лимиты закончились.'));
        O.showQuotaAccountModal(em);
      }
      el.firstChild.append(h('div',{class:'errbox'},em))}
    else if(i.error)meta.append(h('span',{class:'warn'},'прервано'))}
  meta.append(h('span',{class:'grow'}),h('button',{class:'ibtn s',onclick:()=>msgActions(m)},O.icon('dots')))}
function msgText(m){return m.parts.filter(p=>p.type==='text'&&!p.synthetic).map(p=>p.text).join('\n')}
function msgActions(m){O.actions(m.info.role==='user'?'Сообщение':'Ответ',[
  {label:'Копировать текст',icon:'copy',fn:()=>O.native.copy(msgText(m))},
  {label:'Экспорт сессии в Markdown',icon:'doc',fn:()=>exportSessionMd()},
  {label:O.tr('Export session (JSON)','Экспорт сессии (JSON)'),icon:'down',fn:()=>{if(!S.sid)return;const json=O.exportSessionJson(S.sid);O.actions(O.tr('Export session (JSON)','Экспорт сессии (JSON)'),[
    {label:O.tr('Copy JSON','Скопировать JSON'),icon:'copy',fn:()=>O.native.copy(json)},
    {label:O.tr('Share','Поделиться'),icon:'share',fn:()=>{if(O.native&&O.native.share)O.native.share(json);else O.native.copy(json)}}])}},
  m.info.role==='user'?{label:'Отменить отсюда',sub:'Откатить это сообщение и всё после него',icon:'undo',fn:()=>revertTo(m)}:null,
  {label:'Форк сессии отсюда',icon:'branch',fn:()=>forkAt(m)}])}
function exportSessionMd(){
  if(!S.sid)return;
  const list=O.visibleMsgs(S.sid);
  if(!list.length)return O.toast('Сессия пуста');
  let out='# OpenCode Mobile — '+(S.sessions.find(x=>x.id===S.sid)?.title||'Сессия')+'\n\n';
  list.forEach(m=>{
    out+=(m.info.role==='user'?'### Пользователь':'### Ассистент')+'\n\n';
    m.parts.forEach(p=>{
      if(p.type==='text'&&p.text)out+=p.text+'\n\n';
      else if(p.type==='reasoning'&&(p.text||p.reasoning))out+='> *Размышления:*\n> '+String(p.text||p.reasoning).split('\n').join('\n> ')+'\n\n';
      else if(p.type==='tool'&&p.state&&p.state.input)out+='```bash\n# Tool: '+(p.tool||'')+'\n'+JSON.stringify(p.state.input,null,2)+'\n```\n\n';
    });
  });
  O.actions('Экспорт сессии в Markdown',[
    {label:'Скопировать Markdown',icon:'copy',fn:()=>O.native.copy(out)},
    {label:'Поделиться файлом/текстом',icon:'share',fn:()=>{if(O.native&&O.native.share)O.native.share(out);else O.native.copy(out)}}]);
}
async function revertTo(m){try{await api('POST','/session/'+S.sid+'/revert',{messageID:m.info.id});if(m.info.role==='user'){ta.value=msgText(m);onInput()}}catch(e){O.toast(e.message)}}
async function forkAt(m){try{const s=await api('POST','/session/'+S.sid+'/fork',{messageID:m.info.id});await O.loadSessions();await O.openSession(s.id)}catch(e){O.toast(e.message)}}

// ---- tools ----
function toolMeta(p){const st=p.state||{},i=st.input||{},r=O.rel;
  switch(p.tool){
  case'bash':return{ic:'terminal',t:i.description||'Команда',s:String(i.command||'').split('\n')[0]};
  case'read':{
    const out=st.output!=null?st.output:(st.metadata&&st.metadata.output);
    const lineCnt=out?String(out).split('\n').length:null;
    return{ic:'file',t:'Чтение',s:r(i.filePath)+(lineCnt?(' ('+lineCnt+' строк)'):'')};
  }
  case'edit':return{ic:'edit',t:'Правка',s:r(i.filePath)};
  case'write':return{ic:'edit',t:'Запись',s:r(i.filePath)};
  case'patch':case'apply_patch':return{ic:'edit',t:'Патч',s:''};
  case'glob':return{ic:'search',t:'Glob',s:i.pattern};
  case'grep':return{ic:'search',t:'Grep',s:i.pattern};
  case'list':return{ic:'folder',t:'Список',s:r(i.path||'.')};
  case'webfetch':return{ic:'globe',t:'Загрузка',s:i.url};
  case'websearch':case'codesearch':return{ic:'globe',t:'Поиск',s:i.query};
  case'task':return{ic:'bot',t:i.description||'Субагент',s:i.subagent_type};
  case'todowrite':case'todoread':return{ic:'list',t:'Задачи',s:(i.todos||[]).length?(i.todos.length+' шт.'):''};
  case'skill':return{ic:'bulb',t:'Навык',s:i.name};
  default:return{ic:'code',t:st.title||p.tool,s:''}}}
function toolBody(p){const st=p.state||{},i=st.input||{},md=st.metadata||{};
  const out=O.stripAnsi(st.output!=null?st.output:(md.output||''));const b=h('div');
  const pre=(t,c)=>h('pre',{class:c||'term-pre'},t);
  switch(p.tool){
  case'bash':b.append(pre('$ '+(i.command||'')+(out?'\n'+out:'')));if(md.exit!=null&&md.exit!==0)b.append(h('div',{class:'mut s'},'код '+md.exit));break;
  case'edit':if(typeof md.diff==='string'&&md.diff)b.append(O.unifiedEl(md.diff));else if(i.oldString!=null)b.append(O.diffEl(O.diffOps(String(i.oldString),String(i.newString||'')),2));break;
  case'write':b.append(pre(String(i.content||'').split('\n').slice(0,80).join('\n'),'code-pre'));break;
  case'read':b.append(pre(out.split('\n').slice(0,60).join('\n'),'code-pre'));break;
  case'todowrite':(i.todos||[]).forEach(t=>b.append(h('div',{class:'todo-i'+(t.status==='completed'?' done':'')},O.icon(t.status==='completed'?'check':'chevR'),t.content)));break;
  case'task':{const sid=md.sessionId||md.sessionID;if(i.prompt)b.append(h('div',{class:'mut s'},String(i.prompt).slice(0,500)));
    if(sid)b.append(h('button',{class:'btn sm',style:{marginTop:'8px'},onclick:()=>openChild(sid)},'Открыть сессию субагента'));if(out)b.append(pre(out.slice(0,3000),'code-pre'));break}
  default:if(Object.keys(i).length)b.append(pre(JSON.stringify(i,null,2).slice(0,3000),'code-pre'));if(out)b.append(pre(out.slice(0,6000),'code-pre'))}
  if(st.status==='error'&&st.error)b.append(h('div',{class:'errbox'},String(st.error)));return b}
function fillTool(el,p){const st=p.state||{},m=toolMeta(p),isOpen=S.opts.details&&open.has(p.id);
  el.className='part tool '+(st.status||'pending')+(isOpen?' open':'');el.textContent='';el._p=p;
  const stat=st.status==='running'||st.status==='pending'?h('span',{class:'spin'}):st.status==='error'?O.icon('alert','err'):O.icon('check','ok');
  el.append(h('button',{class:'tool-h',onclick:()=>{if(!S.opts.details)return;el._auto=2;open.has(p.id)?open.delete(p.id):open.add(p.id);fillTool(el,el._p)}},
    O.icon(m.ic),h('span',{class:'t'},m.t),h('span',{class:'sub grow'},m.s||''),stat,S.opts.details?O.icon('chevR','chev'):null));
  if(isOpen)el.append(h('div',{class:'tool-b'},toolBody(p)))}
async function openChild(sid){try{if(!O.child(sid)){const s=await api('GET','/session/'+sid);(S.childSessions=S.childSessions||{})[sid]=s}}catch{}trail.push(S.sid);await O.openSession(sid);bus.emit('session')}

// ---- banners / dock ----
function renderRevert(){const s=cur();revEl.textContent='';
  if(trail.length&&S.sid&&O.child(S.sid)){revEl.classList.remove('hide');revEl.append(h('div',{class:'card revert-banner',style:{display:'flex',alignItems:'center',gap:'10px'}},h('span',{class:'grow'},'Сессия субагента'),h('button',{class:'btn sm',onclick:()=>{const p=trail.pop();O.openSession(p)}},'Назад')));return}
  if(s&&s.revert){revEl.classList.remove('hide');revEl.append(h('div',{class:'card revert-banner',style:{display:'flex',alignItems:'center',gap:'10px'}},h('span',{class:'revert-icon'},O.icon('undo')),h('span',{class:'grow',style:{color:'#ffffff'}},'Изменения отменены'),h('button',{class:'btn sm',onclick:doRedo},O.icon('redo'),'Вернуть')))}
  else revEl.classList.add('hide')}
function renderTodos(){const t=(S.todos[S.sid]||[]);todoEl.textContent='';
  if(!t.length||t.every(x=>x.status==='completed')){todoEl.classList.add('hide');return}
  todoEl.classList.remove('hide');const done=t.filter(x=>x.status==='completed').length;
  const list=h('div',{class:'hide',style:{marginTop:'6px'}},t.map(x=>h('div',{class:'todo-i'+(x.status==='completed'?' done':'')},O.icon(x.status==='completed'?'check':'chevR'),x.content)));
  todoEl.append(h('div',{class:'card',style:{padding:'8px 12px'}},h('button',{style:{display:'flex',alignItems:'center',gap:'8px',width:'100%'},onclick:()=>list.classList.toggle('hide')},O.icon('list'),h('b',{class:'grow',style:{textAlign:'left'}},'Задачи '+done+'/'+t.length),O.icon('chevD')),list))}
function renderMmProgress(){const r=O.mm.run;mmProgressEl.textContent='';
  if(!r){mmProgressEl.classList.add('hide');return}
  const active=r.currentRole||r.phase;
  if(!active){mmProgressEl.classList.add('hide');return}
  mmProgressEl.classList.remove('hide');
  const started=r.phaseStart||r.started||Date.now();
  const elapsed=((Date.now()-started)/1000).toFixed(0);
  const phase=r.phase||'role';
  const phaseLabel={plan:'Планирование',role:'Работает роль',synth:'Синтез',idle:'Ожидание'}[phase]||phase;
  mmProgressEl.append(h('div',{class:'mm-progress-bar'},
    h('div',{class:'mm-progress-info'},
      h('span',{class:'mm-progress-role'},active),
      h('span',{class:'mm-progress-phase'},phaseLabel),
      h('span',{class:'mm-progress-time'},elapsed+'s')),
    h('div',{class:'mm-progress-track'},
      h('div',{class:'mm-progress-fill',style:{width:phase==='role'||phase==='synth'?'100%':'0%'}}))));
  const ctrl=h('div',{style:{display:'flex',gap:'6px',flexWrap:'wrap',marginTop:'6px'}},
    h('button',{class:'chip',onclick:()=>O.mmPause&&O.mmPause()},r.paused?'▶ '+O.tr('Resume','Продолжить'):'⏸ '+O.tr('Pause','Пауза')),
    h('button',{class:'chip',onclick:()=>O.mmStop&&O.mmStop()},'⏹ '+O.tr('Stop all','Стоп')));
  (r.jobs||[]).forEach(j=>{
    if(!j.sid)return;
    const done=!S.status[j.sid]||S.status[j.sid].type==='idle';
    const cur=r.currentRole&&(j.role.name===r.currentRole||j.role.name+' (retry)'===r.currentRole);
    ctrl.append(h('button',{class:'chip',title:O.tr('Stop this role','Остановить эту роль'),style:cur?'border-color:var(--acc);color:var(--acc)':'',onclick:()=>O.mmStopRole&&O.mmStopRole(j.role.name)},
      (done?'✓ ':cur?'◐ ':'• ')+(j.role.name||'')));
  });
  mmProgressEl.append(ctrl);
}
function renderStatus(){const s=S.status[S.sid];statusEl.textContent='';
  if(!s||s.type==='idle'){statusEl.classList.add('hide');return}
  statusEl.classList.remove('hide');statusEl.append(h('span',{class:'spin'}),h('span',null,s.type==='retry'?('Повтор (попытка '+s.attempt+')'+(s.message?': '+s.message:'')):'Выполняется'))}
function renderDock(){dockEl.textContent='';
  const curPerms=S.perms.filter(p=>p.sessionID===S.sid);
  const curQuestions=S.questions.filter(q=>q.sessionID===S.sid);
  curPerms.forEach(p=>dockEl.append(permCard(p)));
  curQuestions.forEach(q=>dockEl.append(questionCard(q)));
  const other=S.perms.filter(p=>p.sessionID!==S.sid)[0]||S.questions.filter(q=>q.sessionID!==S.sid)[0];
  if(other)dockEl.append(h('button',{class:'hud-dock-card',style:{padding:'12px 16px',display:'flex',alignItems:'center',gap:'10px',textAlign:'left',cursor:'pointer'},onclick:()=>O.openSession(other.sessionID)},O.icon('alert','warn'),h('b',null,'Другая сессия ждёт вас')));
  if(chatRoot){chatRoot.classList.toggle('dock-active',curPerms.length>0||curQuestions.length>0)}
  O.updateBadges&&O.updateBadges()}
function permCard(p){const btns=[];
  const reply=async r=>{btns.forEach(b=>b.disabled=true);try{await O.replyPermission(p,r)}catch(e){btns.forEach(b=>b.disabled=false);O.toast(e.message)}};
  btns.push(h('button',{class:'btn-dock-skip',style:{color:'#f87171'},onclick:()=>reply('reject')},O.tr('Reject','Отклонить')),
            h('button',{class:'btn-dock-skip',onclick:()=>reply('once')},O.tr('Once','Разрешить раз')),
            h('button',{class:'btn-dock-submit',onclick:()=>reply('always')},O.tr('Always','Всегда')));
  const diff=p.metadata&&typeof p.metadata.diff==='string'?p.metadata.diff:'';
  return h('div',{class:'hud-dock-card'},
    h('div',{class:'hud-dock-header'},
      h('div',{class:'hud-dock-header-left'},
        h('div',{class:'badge-icon',style:{background:'rgba(245,158,11,0.15)',color:'#fbbf24'}},O.icon('shield')),
        h('b',null,O.tr('Permission Request','Запрос разрешения'))),
      h('span',{class:'mut',style:{fontSize:'11.5px',background:'rgba(255,255,255,0.06)',padding:'3px 8px',borderRadius:'999px'}},p.title)),
    h('div',{class:'hud-dock-body'},
      h('div',{style:{fontSize:'14px',fontWeight:'600',color:'#ffffff',marginBottom:'4px'}},p.title),
      p.patterns.length?h('div',{class:'mono s mut',style:{background:'#141416',padding:'8px 10px',borderRadius:'10px',wordBreak:'break-all'}},p.patterns.join('\n')):null,
      diff?h('details',{style:{marginTop:'6px'}},h('summary',{class:'s'},'Показать изменения'),O.unifiedEl(diff)):null),
    h('div',{class:'hud-dock-footer'},btns));
}
function questionCard(q){const qs=q.questions||[];const sel=qs.map(()=>new Set());const custom=qs.map(()=>'');
  qs.forEach((x,i)=>{
    if(Array.isArray(x.default))x.default.forEach(d=>sel[i].add(d));
    else if(typeof x.default==='string'&&x.default)sel[i].add(x.default);
  });
  const send=async()=>{
    const answers=qs.map((_,i)=>[...sel[i],...(custom[i]?.trim()?[custom[i].trim()]:[])]);
    const hasAny=answers.some(a=>a.length>0);
    if(!hasAny&&qs.length>0){
      O.toast(O.tr('Please select an option or type an answer, or click Skip','Выберите вариант или введите ответ, либо нажмите «Пропустить»'));
      return;
    }
    try{
      await api('POST','/question/'+q.id+'/reply',{answers});
      S.questions=S.questions.filter(x=>x.id!==q.id);
      renderDock();
    }catch(e){O.toast(e.message)}
  };
  const rej=async()=>{try{await api('POST','/question/'+q.id+'/reject',{});S.questions=S.questions.filter(x=>x.id!==q.id);renderDock()}catch(e){O.toast(e.message)}};
  const body=qs.map((x,i)=>{
    const isMulti=!!x.multiple;
    const qBadge=qs.length>1?h('div',{class:'dock-q-num'},O.tr('Question','Вопрос')+' '+(i+1)+' / '+qs.length):null;
    const opts=h('div',{class:'dock-opts-list'},(x.options||[]).map(o=>{
      const isInit=sel[i].has(o.label);
      const indicator=h('div',{class:'dock-opt-indicator'+(isMulti?' check':'')});
      const b=h('button',{
        class:'dock-opt-row'+(isMulti?' multiple':'')+(isInit?' on':''),
        onclick:()=>{
          if(isMulti){
            sel[i].has(o.label)?sel[i].delete(o.label):sel[i].add(o.label);
          }else{
            sel[i].clear();
            sel[i].add(o.label);
          }
          opts.querySelectorAll('.dock-opt-row').forEach((bb,k)=>bb.classList.toggle('on',sel[i].has(x.options[k].label)));
        }
      },
      indicator,
      h('div',{class:'dock-opt-content'},
        h('span',{class:'dock-opt-label'},o.label),
        o.description?h('span',{class:'dock-opt-desc'},o.description):null));
      return b;
    }));
    const inp=x.custom===false?null:h('input',{
      class:'dock-custom-inp',
      placeholder:O.tr('Type your own answer...','Свой вариант ответа...'),
      oninput:e=>{custom[i]=e.target.value},
      onkeydown:e=>{if(e.key==='Enter'){e.preventDefault();send()}},
      onfocus:e=>{setTimeout(()=>e.target.scrollIntoView({behavior:'smooth',block:'center'}),250)}
    });
    return h('div',{class:'dock-q-section'},
      qBadge,
      x.header?h('div',{class:'dock-q-header'},x.header):null,
      h('div',{class:'dock-q-title'},x.question),
      opts,
      inp);
  });
  return h('div',{class:'hud-dock-card'},
    h('div',{class:'hud-dock-header'},
      h('div',{class:'hud-dock-header-left'},
        h('div',{class:'badge-icon'},O.icon('help')),
        h('b',null,O.tr('OpenCode asks','OpenCode спрашивает'))),
      h('span',{class:'mut',style:{fontSize:'11.5px',background:'rgba(255,255,255,0.06)',padding:'3px 8px',borderRadius:'999px'}},
        qs.length>1?(qs.length+' '+O.tr('questions','вопроса')):(O.tr('Action needed','Требуется выбор')))),
    h('div',{class:'hud-dock-body'},body),
    h('div',{class:'hud-dock-footer'},
      h('button',{class:'btn-dock-skip',onclick:rej},O.tr('Skip','Пропустить')),
      h('button',{class:'btn-dock-submit',onclick:send},O.icon('send'),O.tr('Send reply','Отправить ответ'))));
}

// ---- composer ----
let quotaModalOpen=false;
O.showQuotaAccountModal=msg=>{
  if(quotaModalOpen)return;
  if(S.account&&S.account.email){
    O.toast(O.tr('Quota limit reached for this model. Switch to another model or connect your provider key: Settings → Providers.','Квота для этой модели исчерпана. Выберите другую модель или подключите свой ключ: Настройки → Провайдеры.'),6000);
    return;
  }
  quotaModalOpen=true;
  const content=h('div',{style:{textAlign:'center',padding:'16px 8px 8px'}},
    h('div',{style:{fontSize:'38px',marginBottom:'10px'}},'⚡'),
    h('b',{style:{fontSize:'17px',display:'block',marginBottom:'8px'}},O.tr('Free Quota Limit Reached','Лимит бесплатной квоты исчерпан')),
    h('p',{class:'mut',style:{fontSize:'13.5px',lineHeight:'1.5',margin:'0 0 18px',textAlign:'center'}},
      O.tr(
        'You are currently using shared guest quota without an account. Sign in with Google or GitHub to receive your personal free OpenCode quota, or add your own provider API key.',
        'Вы используете общую квоту без авторизации, которая временно исчерпана.\n\nВойдите через Google или GitHub, чтобы получить персональную бесплатную квоту OpenCode, либо подключите собственный API ключ.'
      )
    ),
    h('button',{class:'btn pri wide',style:{marginBottom:'10px'},onclick:()=>{s.close();O.openAccount()}},O.icon('user'),O.tr('Sign in with Google / GitHub','Войти через Google / GitHub')),
    h('button',{class:'btn wide',style:{marginBottom:'10px'},onclick:()=>{s.close();O.openConnect()}},O.icon('key'),O.tr('Connect own API key','Подключить свой API ключ')),
    h('button',{class:'btn wide',onclick:()=>s.close()},O.tr('Later','Позже'))
  );
  const s=O.sheet(O.tr('OpenCode Quota','Квота OpenCode'),content,{hud:true,onClose:()=>{quotaModalOpen=false}});
};

const quotaHint=()=>S.account&&S.account.email
  ?'Квота этой модели исчерпана. Перезапустите сервер (Настройки → Совместимость), выберите другую модель или подключите свой ключ: Настройки → Модели → Подключить провайдера'
  :'Квота исчерпана. Войдите в аккаунт opencode (Google/GitHub): Настройки → Аккаунт opencode — или подключите свой ключ: Настройки → Модели → Подключить провайдера';
function onMic(){
  const lang=O.store.get('lang','ru')==='en'?'en':'ru';
  if(window.OC&&window.OC.startVoiceInput){
    window.OC.startVoiceInput(lang);
    return;
  }
  const SpeechRec=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(SpeechRec){
    try{
      const rec=new SpeechRec();
      rec.lang=lang==='en'?'en-US':'ru-RU';
      rec.interimResults=false;
      const b=O.$('.mic-btn');if(b)b.style.color='#ef4444';
      O.toast(O.tr('Listening... Speak now','Слушаю... Говорите'),2500);
      rec.onresult=e=>{
        const t=e.results[0][0].transcript;
        ta.value=(ta.value?ta.value+' ':'')+t;
        onInput();ta.focus();
      };
      rec.onerror=e=>{const b=O.$('.mic-btn');if(b)b.style.color='';O.toast(O.tr('Voice input error: ','Ошибка ввода: ')+(e.error||'недоступно'),2000)};
      rec.onend=()=>{const b=O.$('.mic-btn');if(b)b.style.color=''};
      rec.start();
      return;
    }catch(e){}
  }
  O.toast(O.tr('Voice input active. Speak using keyboard mic or type.','Голосовой ввод: используйте микрофон на клавиатуре или введите текст.'),3000);
}
function updateChips(){
  const m=S.model,mi=m&&O.modelInfo(m.providerID,m.modelID);
  const ag=S.agents.find(a=>a.name===S.agent);
  const mmA=O.mmActive&&O.mmActive();
  const agName=mmA?mmA.name:(ag?ag.name:(S.agent||'Build'));
  const spanAg=agentChip.querySelector('span');
  if(spanAg){spanAg.textContent=agName.charAt(0).toUpperCase()+agName.slice(1);
    agentChip.classList.toggle('mm-on',!!mmA)}
  let mName=O.tr('Select model','Выбрать модель');
  if(mi)mName=mi.name||m.modelID;
  else if(m)mName=m.modelID;
  const spanMo=modelChip.querySelector('span');
  if(spanMo)spanMo.textContent=mName;
  const nokey=!m&&!S.offline&&S.up;
  nokeyEl.classList.toggle('hide',!nokey);
  ta.disabled=!!S.offline&&!S.up;
  ta.placeholder=ta.disabled?(O.tr('Offline — reading cached chats','Офлайн — чтение кэшированных чатов')):(O.tr('Chat with OpenCode...','Чат с OpenCode...'));
  updateSend();
}
function updateSend(){
  const b=busy(),has=!!ta.value.trim()||!!atts.length;
  sendBtn.className=b&&!has?'stop':(has?'ready':'');
  sendBtn.textContent='';
  sendBtn.append(O.icon(b&&!has?'stop':'send'));
  sendBtn.disabled=!b&&!has;
}
function autosize(){
  ta.style.height='auto';
  ta.style.height=Math.min(ta.scrollHeight,180)+'px';
}
const BUILTINS=[
 {n:'new',d:'Начать новую сессию',i:'plus',run:()=>O.newSession()},
 {n:'sessions',d:'Переключить сессию',i:'list',run:()=>O.openSessions()},
 {n:'models',d:'Выбрать модель',i:'cpu',run:()=>O.openModels()},
 {n:'agents',d:'Выбрать агента',i:'bot',run:()=>O.openAgents()},
 {n:'widgets',d:'Интерактивные виджеты HUD',i:'sliders',run:()=>O.openWidgetsModal()},
 {n:'preview',d:'Веб-предпросмотр проекта',i:'globe',run:arg=>O.openPreview(arg)},
 {n:'open',d:'Открыть приложение Android (например /open telegram)',i:'out',run:arg=>O.dispatchAction('open_app',arg)},
 {n:'connect',d:'Подключить провайдера (OpenCode Zen, OpenAI, ...)',i:'key',run:()=>O.openConnect()},
 {n:'init',d:'Создать или обновить AGENTS.md',i:'doc',run:()=>doInit()},
 {n:'undo',d:'Отменить последнее сообщение и его изменения файлов',i:'undo',run:()=>doUndo()},
 {n:'redo',d:'Вернуть отменённые изменения',i:'redo',run:()=>doRedo()},
 {n:'compact',d:'Сжать сессию, чтобы освободить контекст',i:'refresh',run:()=>doCompact()},
 {n:'share',d:'Поделиться сессией',i:'share',run:()=>doShare()},
 {n:'unshare',d:'Отключить шаринг',i:'share',run:()=>doUnshare()},
 {n:'export',d:'Экспорт диалога в Markdown',i:'down',run:()=>doExport()},
 {n:'themes',d:'Сменить тему',i:'palette',run:()=>O.openThemes()},
 {n:'thinking',d:'Показать или скрыть размышления',i:'bulb',run:()=>{S.opts.thinking=!S.opts.thinking;O.saveOpts();renderAll()}},
 {n:'details',d:'Раскрыть или закрепить детали инструментов',i:'code',run:()=>{S.opts.details=!S.opts.details;O.saveOpts();renderAll()}},
 {n:'status',d:'Серверы MCP, LSP и плагины',i:'server',run:()=>O.openStatus()},
 {n:'files',d:'Файлы проекта',i:'folder',run:()=>O.setTab('files')},
 {n:'terminal',d:'Терминал',i:'terminal',run:()=>O.setTab('term')},
 {n:'settings',d:'Настройки приложения',i:'sliders',run:()=>O.openSettings()},
 {n:'help',d:'Что я умею',i:'info',run:()=>O.openHelp()},
 {n:'exit',d:'Свернуть приложение (сервер продолжает работать)',i:'out',run:()=>OC.minimize()}];
async function sess(){if(S.sid)return S.sid;const s=await O.newSession();return s.id}
async function doInit(){if(!S.model)return O.openConnect();try{const sid=await sess();api('POST','/session/'+sid+'/init',{messageID:O.mid(),providerID:S.model.providerID,modelID:S.model.modelID},{timeout:3600000}).catch(e=>O.toast(e.message))}catch(e){O.toast(e.message)}}
async function doUndo(){const l=O.visibleMsgs(S.sid||'').filter(m=>m.info.role==='user');if(!l.length)return O.toast('Нечего отменять');revertTo(l[l.length-1])}
async function doRedo(){try{await api('POST','/session/'+S.sid+'/unrevert',{})}catch(e){O.toast(e.message)}}
async function doCompact(){if(!S.sid||!S.model)return;try{await api('POST','/session/'+S.sid+'/summarize',{providerID:S.model.providerID,modelID:S.model.modelID},{timeout:600000});O.toast('Сессия сжата')}catch(e){O.toast(e.message)}}
async function doShare(){try{const s=await api('POST','/session/'+S.sid+'/share',{});const u=s.share&&s.share.url;if(u){O.native.copy(u);O.native.share(u)}}catch(e){O.toast(e.message)}}
async function doUnshare(){try{await api('DELETE','/session/'+S.sid+'/share');O.toast('Шаринг остановлен')}catch(e){O.toast(e.message)}}
function doExport(){if(!S.sid)return;const md=O.visibleMsgs(S.sid).map(m=>'## '+(m.info.role==='user'?'Пользователь':'Ассистент')+'\n\n'+m.parts.filter(p=>p.type==='text'&&!p.synthetic).map(p=>p.text).join('\n\n')).join('\n\n');O.native.share(md)}
O.builtins=BUILTINS;
function hidePop(){popEl.classList.add('hide');popEl.textContent=''}
function showPop(items){popEl.textContent='';if(!items.length){hidePop();return}popEl.classList.remove('hide');
  items.slice(0,40).forEach(it=>popEl.append(h('button',{class:'it',style:{width:'100%',textAlign:'left'},onclick:it.pick},it.icon?it.icon:null,h('b',null,it.t),h('span',{class:'d grow'},it.d||''))))}
let atTimer;
let draftTimer;
function onInput(){autosize();updateSend();const v=ta.value,pos=ta.selectionStart||0,before=v.slice(0,pos);
  if(S.sid){clearTimeout(draftTimer);draftTimer=setTimeout(()=>O.setDraft(S.sid,v),300)}
  const sm=/^\/(\S*)$/.exec(before);
  if(sm){const q=sm[1].toLowerCase();
    const srv=(S.commands||[]).filter(c=>!BUILTINS.some(b=>b.n===c.name)).map(c=>({t:'/'+c.name,d:c.description||'Пользовательская команда',icon:O.icon('slash'),f:c.name,pick:()=>{ta.value='/'+c.name+' ';ta.focus();onInput()}}));
    const bi=BUILTINS.map(b=>({t:'/'+b.n,d:b.d,icon:O.icon(b.i),f:b.n,pick:()=>{ta.value='';autosize();hidePop();updateSend();b.run()}}));
    showPop([...bi,...srv].filter(x=>x.f.startsWith(q)||(q.length>1&&x.f.includes(q))));return}
  const am=/(?:^|\s)@(\S*)$/.exec(before);
  if(am){const q=am[1];clearTimeout(atTimer);atTimer=setTimeout(async()=>{
    const ags=O.subagents().filter(a=>a.name.startsWith(q)).map(a=>({t:'@'+a.name,d:a.description||'Субагент',icon:O.icon('bot'),pick:()=>insertMention('@'+a.name,{type:'agent',name:a.name},pos-q.length-1,pos)}));
    let files=[];try{files=await api('GET','/find/file?query='+encodeURIComponent(q)+'&limit=30')}catch{}
    const fi=(files||[]).map(f=>{const dir=f.endsWith('/');return{t:O.basename(f),d:f,icon:O.fileIcon(O.basename(f),dir),pick:()=>insertMention('@'+f,{type:'file',mime:dir?'application/x-directory':'text/plain',url:'file://'+S.dir+'/'+f.replace(/\/$/,''),filename:O.basename(f),source:{type:'file',path:S.dir+'/'+f.replace(/\/$/,''),text:{value:'@'+f,start:0,end:0}}},pos-q.length-1,pos)}});
    if(ta.value.slice(0,pos)===before)showPop([...ags,...fi])},160);return}
  hidePop()}
O.subagents=()=>(S.agents||[]).filter(a=>a.mode==='subagent'||a.mode==='all');
function insertMention(tok,part,from,to){ta.value=ta.value.slice(0,from)+tok+' '+ta.value.slice(to);const p=from+tok.length+1;ta.setSelectionRange(p,p);mentions.push({tok,part});hidePop();ta.focus();onInput()}
O.addMention=(path,isDir)=>{const rel=O.rel(path);const tok='@'+rel;const abs=path.startsWith('/')?path:S.dir+'/'+path;
  ta.value=(ta.value?ta.value+' ':'')+tok+' ';mentions.push({tok,part:{type:'file',mime:isDir?'application/x-directory':'text/plain',url:'file://'+abs,filename:O.basename(path),source:{type:'file',path:abs,text:{value:tok,start:0,end:0}}}});O.setTab('chat');ta.focus();onInput()};
O.insertText=t=>{ta.value=t;onInput();ta.focus()};
function onFiles(){const files=[...fileIn.files];fileIn.value='';for(const f of files){
  const mi=S.model&&O.modelInfo(S.model.providerID,S.model.modelID);
  if(!(f.type||'').startsWith('text/')&&mi&&mi.attachment===false){O.toast('Эта модель не принимает вложения');continue}
  if(f.size>8e6){O.toast(f.name+' слишком большой (макс. 8 МБ)');continue}
  const r=new FileReader();r.onload=()=>{atts.push({type:'file',mime:f.type||'application/octet-stream',filename:f.name,url:r.result});renderAtts()};r.readAsDataURL(f)}}
function renderAtts(){attsEl.textContent='';attsEl.classList.toggle('hide',!atts.length);
  atts.forEach((a,i)=>attsEl.append(h('span',{class:'chip'},a.mime.startsWith('image/')?h('img',{src:a.url,style:{height:'22px',borderRadius:'4px'}}):O.fileIcon(a.filename),h('span',null,a.filename),h('button',{onclick:()=>{atts.splice(i,1);renderAtts();updateSend()}},O.icon('x')))));updateSend()}
async function onSend(){
  if(busy()&&!ta.value.trim()&&!atts.length){try{await api('POST','/session/'+S.sid+'/abort',{})}catch(e){O.toast(e.message)}return}
  const text=ta.value.trim();if(!text&&!atts.length)return;
  const cm=/^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  if(cm){const b=BUILTINS.find(x=>x.n===cm[1]);if(b){clear();b.run(cm[2]);return}
    const sc=(S.commands||[]).find(c=>c.name===cm[1]);
    if(sc){if(!S.model)return O.openConnect();clear();try{const sid=await sess();O.maybeAutoTitle(sid,text);api('POST','/session/'+sid+'/command',{command:sc.name,arguments:cm[2]||'',agent:S.agent,model:modelStr()},{timeout:3600000}).catch(e=>O.toast(e.message))}catch(e){O.toast(e.message)}return}}

  if(!S.model&&!O.mmActive()){O.toast('Подключите провайдера, чтобы выбрать модель');O.openConnect();return}
  if(text.startsWith('!')){const cmd=text.slice(1).trim();
    if(/^opencode(\s+tui)?\s*$/i.test(cmd)){O.toast('Приложение уже является интерфейсом OpenCode. TUI — во вкладке «Терминал» → Shell, агент — во вкладке «Чат»',6000);clear();return}
    clear();try{const sid=await sess();O.maybeAutoTitle(sid,text);api('POST','/session/'+sid+'/shell',{agent:S.agent,model:S.model,command:cmd},{timeout:3600000}).catch(e=>O.toast(e.message))}catch(e){O.toast(e.message)}return}
  const parts=[];
  if(O.updateReadmeForModel && S.model && S.model.modelID){
    O.updateReadmeForModel(S.model.modelID);
  }
  if(text)parts.push({type:'text',text});
  mentions.filter(m=>text.includes(m.tok)).forEach(m=>{const p=JSON.parse(JSON.stringify(m.part));if(p.source&&p.source.text){p.source.text.start=text.indexOf(m.tok);p.source.text.end=p.source.text.start+m.tok.length}parts.push(p)});
  atts.forEach(a=>parts.push(a));
  if(O.mmActive()&&O.mmSend){clear();try{await O.mmSend(text,parts)}catch(e){O.toast(e.message||String(e),4000)}return}
  O.runHook('onSend',{text,parts,model:S.model,agent:S.agent});
  clear();
  let lastErr=null,usedModel=null,sentMid=null,sentSid=null,sentTries=[];
  O._fallback=null;
  try{
    const sid=await sess();
    O.maybeAutoTitle(sid,text);
    const chain=[S.model].filter(Boolean).concat(O.fallbackChain());
    const quotaRe=/quota|usage.?limit|rate.?limit|limit\s+reached|insufficient|exceeded|credit|\b429\b/i;
    for(let i=0;i<chain.length;i++){
      const mdl=chain[i];
      const mid=O.mid();
      try{
        const m=O.upsertMsg({id:mid,sessionID:sid,role:'user',time:{created:Date.now()},agent:S.agent,model:mdl});m.local=true;
        m.parts=parts.map((p,k)=>Object.assign({id:'prt_local'+k,sessionID:sid,messageID:mid},p));bus.emit('msg',sid,m);scrollEnd(true);
        await api('POST','/session/'+sid+'/prompt_async',{messageID:mid,agent:S.agent,model:mdl,variant:S.variant||undefined,parts},{timeout:30000});
        usedModel=mdl;lastErr=null;sentMid=mid;sentSid=sid;sentTries=chain.slice(i+1);break;
      }catch(e){
        lastErr=e;
        const s=O.msgs(sid);s.list=s.list.filter(x=>x.info.id!==mid);s.idx.delete(mid);const el=msgEls.get(mid);if(el){el.remove();msgEls.delete(mid)}
        const retryable=quotaRe.test(String(e.message))||!e.status||e.status>=429;
        if(i<chain.length-1&&retryable){
          O.toast(O.tr('Model unavailable, trying fallback...','Модель недоступна, пробую резервную…')+' '+(chain[i+1].modelID||''),2500);
          continue;
        }
        break;
      }
    }
    if(lastErr)throw lastErr;
    if(sentTries.length)O._fallback={sid:sentSid,mid:sentMid,parts,tries:sentTries};
    if(usedModel&&S.model&&(usedModel.providerID!==S.model.providerID||usedModel.modelID!==S.model.modelID)){O.setLastFallback({model:usedModel.modelID,at:Date.now()});O.toast(O.tr('Answered by fallback model: ','Ответила резервная модель: ')+usedModel.modelID,2500)}
    else if(O.setLastFallback)O.setLastFallback(null);
  }catch(e){
    if(/quota|usage.?limit|rate.?limit|limit\s+reached|insufficient|exceeded|credit|\b429\b/i.test(String(e.message))){
      O.notifyLimit(O.tr('Limit Reached','Лимит исчерпан'),O.tr('Free quota limit reached.','Бесплатные лимиты закончились.'));
      O.showQuotaAccountModal(e.message);
    }else{
      O.toast(e.message,4000);
    }
    ta.value=text;onInput();
  }}
function clear(){clearTimeout(draftTimer);if(S.sid)O.clearDraft(S.sid);ta.value='';atts=[];mentions=[];renderAtts();autosize();hidePop();updateSend();if(S.opts.hideKeyboardAfterSend)ta.blur()}
O.chat={renderAll,sess,focus:()=>ta&&ta.focus()};
})();
