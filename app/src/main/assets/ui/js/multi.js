(function(){
const O=window.OCM,h=O.h,S=O.S,api=O.api,bus=O.bus;

// ---- storage ----
O.mmList=()=>O.store.get('mm.agents',[]);
O.mmSave=a=>{const l=O.mmList();const i=l.findIndex(x=>x.id===a.id);if(i>=0)l[i]=a;else l.push(a);O.store.set('mm.agents',l);bus.emit('mm');};
O.mmDelete=id=>{O.store.set('mm.agents',O.mmList().filter(x=>x.id!==id));if(O.mmActiveId()===id)O.mmSetActive(null);bus.emit('mm');};
O.mmActiveId=()=>O.store.get('mm.active',null);
O.mmActive=()=>O.mmList().find(x=>x.id===O.mmActiveId())||null;
O.mmSetActive=id=>{O.store.set('mm.active',id||null);bus.emit('mm');bus.emit('meta');};

const uid=()=>{let r='';for(const x of crypto.getRandomValues(new Uint8Array(6)))r+='0123456789abcdef'[x%16];return'mm_'+r};
const mStr=m=>m?(m.providerID+'/'+m.modelID):'';
const mName=m=>{if(!m)return'';const mi=O.modelInfo(m.providerID,m.modelID);return mi?(mi.name||m.modelID):m.modelID};

// ---- model picker (does not touch global S.model) ----
O.mmFreeOnly=()=>O.store.get('onlyFreeModels',true);
O.mmSetFreeOnly=v=>{O.store.set('onlyFreeModels',!!v);bus.emit('mm');bus.emit('meta')};
O.mmPickModel=(cur,cb,opts)=>{
  opts=opts||{};
  const freeOnly=opts.freeOnly!=null?opts.freeOnly:O.mmFreeOnly();
  let filterText='';
  const listEl=h('div');
  const q=h('input',{placeholder:O.tr('Search models...','Поиск моделей...'),oninput:e=>{filterText=e.target.value.toLowerCase();draw()},style:{marginBottom:'8px'}});
  const s=O.sheet(O.tr('Select model','Выбор модели'),h('div',null,q,listEl),{hud:true,full:true});
  function draw(){
    listEl.textContent='';
    let all=O.allModels();
    if(freeOnly)all=all.filter(x=>O.isModelFree(x));
    all=all.filter(x=>!O.isModelHidden(x.pid+'/'+x.mid));
    if(!all.length){listEl.append(h('div',{class:'mut',style:{padding:'24px 16px',textAlign:'center'}},freeOnly?O.tr('No free models available.','Бесплатных моделей нет.'):O.tr('No models available. Connect a provider first.','Моделей пока нет. Сначала подключите провайдера.')));return}
    let items=filterText?all.filter(x=>(x.name+' '+x.mid+' '+(x.pname||x.pid)).toLowerCase().includes(filterText)):all;
    const ck=mStr(cur);
    items=O.sortModelsByProvider(items);

    // Pinned models at top (unless filter active)
    if(!filterText){
      const pinnedKeys=O.pinnedModels();
      const pinned=pinnedKeys.map(k=>items.find(x=>x.pid+'/'+x.mid===k)).filter(Boolean);
      if(pinned.length){
        const card=h('div',{class:'group-card'});
        pinned.forEach(x=>{const isSel=(x.pid+'/'+x.mid)===ck;
          card.append(h('button',{class:'model-row'+(isSel?' on':''),onclick:()=>{s.close();cb({providerID:x.pid,modelID:x.mid})}},
            h('div',{class:'model-row-left'},
              h('span',{class:'model-row-title'},x.name||x.mid),
              h('span',{class:'model-row-sub'},(O.isModelFree(x)?O.tr('Free','Бесплатно'):O.tr('Paid','Платная')))),
            isSel?O.icon('check','model-check'):null))});
        listEl.append(h('div',{class:'model-group-head'},h('span',null,O.tr('Pinned','Закрепленные'))),card);
      }
    }

    const groups=[];const byPid=new Map();
    items.forEach(x=>{let g=byPid.get(x.pid);if(!g){g={pid:x.pid,pname:x.pname||x.pid,items:[]};byPid.set(x.pid,g);groups.push(g)}g.items.push(x)});
    groups.forEach(g=>{
      listEl.append(h('div',{class:'model-group-head'},h('span',null,g.pname)));
      const card=h('div',{class:'group-card'});
      g.items.forEach(x=>{const isSel=(x.pid+'/'+x.mid)===ck;
        card.append(h('button',{class:'model-row'+(isSel?' on':''),onclick:()=>{s.close();cb({providerID:x.pid,modelID:x.mid})}},
          h('div',{class:'model-row-left'},
            h('span',{class:'model-row-title'},x.name||x.mid),
            h('span',{class:'model-row-sub'},(O.isModelFree(x)?O.tr('Free','Бесплатно'):O.tr('Paid','Платная')))),
          isSel?O.icon('check','model-check'):null))});
      listEl.append(card);
    });
  }
  draw();
};

// ---- quick picker from the chat MM chip ----
O.openMultimodalPicker=()=>{
  const list=O.mmList();
  const body=h('div');
  const s=O.sheet(O.tr('Multimodal agents','Мультимодальные агенты'),body,{hud:true});
  const card=h('div',{class:'group-card'});
  const act=O.mmActiveId();
  if(!list.length){
    body.append(h('div',{class:'mut',style:{padding:'20px 14px',textAlign:'center'}},O.tr('No multimodal agents yet.','Мультимодальных агентов пока нет.')));
  }else{
    list.forEach(a=>{const on=act===a.id;
      card.append(h('button',{class:'model-row'+(on?' on':''),onclick:()=>{O.mmSetActive(on?null:a.id);s.close();O.toast(on?O.tr('Multimodal agent off','Мультимодальный агент выключен'):(O.tr('Multimodal agent on: ','Мультимодальный агент включён: ')+a.name),2000)}},
        h('div',{class:'model-row-left'},
          h('div',{style:{display:'flex',alignItems:'center',gap:'6px'}},
            h('span',{class:'model-row-title'},a.name),
            h('span',{class:'badge-model badge-free'},'MM')),
          h('span',{class:'model-row-sub'},O.tr('Lead: ','Главная: ')+(a.main?mName(a.main):O.tr('active session model','модель активной сессии'))+' · '+a.roles.length+' '+O.tr('role(s)','рол(ей)'))),
        on?O.icon('check','model-check'):null))});
    body.append(card);
  }
  body.append(h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:()=>{s.close();O.openMultimodal()}},O.icon('sliders'),O.tr('Manage agents','Управление агентами')));
};

// ---- settings: list of multimodal agents ----
O.openMultimodal=()=>{
  const body=h('div');
  const s=O.sheet(O.tr('Multimodality','Мультимодальность'),body,{full:true,
    actions:h('button',{class:'ibtn',onclick:()=>O.mmEditor(null,()=>redraw())},O.icon('plus'))});
  function redraw(){
    body.textContent='';
    const list=O.mmList();
    const act=O.mmActiveId();
    if(!list.length){
      body.append(h('div',{class:'mut',style:{padding:'28px 16px',textAlign:'center'}},
        h('p',null,O.tr('No multimodal agents yet. Create one: pick a lead model that delegates work to role models.','Мультимодальных агентов пока нет. Создайте первого: главная модель будет распределять задачи между ролями.'))));
    }else{
      const card=h('div',{class:'settings-card'});
      list.forEach(a=>{
        const on=act===a.id;
        card.append(h('div',{class:'settings-row'+(on?' on':'')},
          h('button',{class:'settings-row-text',style:{textAlign:'left'},onclick:()=>O.mmEditor(a,redraw)},
            h('b',null,a.name),
            h('span',null,O.tr('Lead: ','Главная: ')+(a.main?mName(a.main):O.tr('active session model','модель активной сессии'))+' · '+a.roles.length+' '+O.tr('role(s)','рол(ей)'))),
          h('button',{class:'ibtn s',onclick:()=>{O.mmSetActive(on?null:a.id);redraw()}},on?O.icon('check','ok'):O.icon('play'))));
      });
      body.append(card);
      body.append(h('div',{class:'note',style:{margin:'10px 2px'}},
        act?O.tr('Active in chat: ','Активен в чате: ')+(list.find(x=>x.id===act)||{}).name+'. '+O.tr('Switch via the MM chip in the chat input.','Переключение — чипом MM в поле ввода чата.')
           :O.tr('None is active. Activate one via the MM chip in the chat input.','Ни один не активен. Включите через чип MM в поле ввода чата.')));
    }
    body.append(h('button',{class:'btn pri wide',style:{marginTop:'6px'},onclick:()=>O.mmEditor(null,()=>redraw())},O.icon('plus'),O.tr('Add module','Добавить модуль')));
  }
  redraw();
};

// ---- editor ----
O.mmEditor=(a,done)=>{
  const isNew=!a;
  a=a?JSON.parse(JSON.stringify(a)):{id:uid(),name:'',main:null,backup:null,roles:[]};
  a.roles=Array.isArray(a.roles)?a.roles:[];
  if(!a.backup)a.backup=null;
  const pickOpts=()=>({});
  const body=h('div');
  const s=O.sheet(isNew?O.tr('New multimodal agent','Новый мультимодальный агент'):O.tr('Edit multimodal agent','Редактирование агента'),body,{full:true});
  const nameInp=h('input',{type:'text',placeholder:O.tr('Agent name, e.g. Translation team','Название, например Команда перевода'),value:a.name||''});
  const mainRow=h('button',{class:'settings-row',onclick:()=>O.mmPickModel(a.main,m=>{a.main=m;draw()},pickOpts())},
    h('div',{class:'settings-row-icon purple'},O.icon('cpu')),
    h('div',{class:'settings-row-text'},h('b',null,O.tr('Lead model','Главная модель')),
      h('span',{id:'mm-main-sub'},a.main?mName(a.main):O.tr('Empty — uses the active session model','Пусто — берётся модель активной сессии'))),
    O.icon('chevR'));
  const backupRow=h('button',{class:'settings-row',onclick:()=>O.mmPickModel(a.backup,m=>{a.backup=m;draw()},pickOpts())},
    h('div',{class:'settings-row-icon'},O.icon('swap')),
    h('div',{class:'settings-row-text'},h('b',null,O.tr('Backup lead model','Запасная главная модель')),
      h('span',{id:'mm-backup-sub'},a.backup?mName(a.backup):O.tr('Used when the lead model fails','Включается, если главная модель дала сбой'))),
    O.icon('chevR'));
  const freeRow=O.toggleRow('star',O.tr('Only free models','Только бесплатные модели'),O.tr('Hide paid models in every picker (agents, roles, subagents)','Скрывать платные модели во всех выборах (агенты, роли, субагенты)'),O.mmFreeOnly(),v=>{O.mmSetFreeOnly(v);draw()});
  const rolesEl=h('div');
  const draw=()=>{
    const sub=mainRow.querySelector('#mm-main-sub');if(sub)sub.textContent=a.main?mName(a.main):O.tr('Empty — uses the active session model','Пусто — берётся модель активной сессии');
    const bsub=backupRow.querySelector('#mm-backup-sub');if(bsub)bsub.textContent=a.backup?mName(a.backup):O.tr('Not set','Не задана');
    rolesEl.textContent='';
    const card=h('div',{class:'settings-card'});
    if(!a.roles.length)card.append(h('div',{class:'mut',style:{padding:'14px 16px'}},O.tr('No roles yet. Add as many as you need — each role can use its own model and backups.','Ролей пока нет. Добавляйте сколько нужно — у каждой роли своя модель и запасные.')));
    a.roles.forEach((r,i)=>{
      card.append(h('div',{class:'settings-row'},
        h('div',{class:'settings-row-icon blue'},O.icon('user')),
         h('button',{class:'settings-row-text',style:{textAlign:'left'},onclick:()=>O.mmRoleEditor(r,(ok,next)=>{if(ok&&next){a.roles[i]=next;draw()}},pickOpts())},
          h('b',null,r.name||O.tr('Unnamed role','Роль без названия')),
          h('span',null,r.model?mName(r.model):O.tr('Lead model will be used','Будет использована главная модель'))),
        h('button',{class:'ibtn s',onclick:()=>{a.roles.splice(i,1);draw()}},O.icon('trash'))));
    });
    rolesEl.append(card);
    rolesEl.append(h('button',{class:'btn wide',style:{marginTop:'8px'},onclick:()=>{
      O.mmRoleEditor({},(ok,next)=>{if(ok&&next){a.roles.push(next);draw()}},pickOpts());
    }},O.icon('plus'),O.tr('Add role','Добавить роль')));
  };
  body.append(h('div',{class:'field'},h('label',null,O.tr('Name','Название')),nameInp),
    h('div',{class:'settings-section-title',style:{margin:'14px 0 6px'}},O.tr('Lead model','Главная модель')),
    h('div',{class:'settings-card'},mainRow,backupRow,freeRow),
    h('div',{class:'settings-section-title',style:{margin:'14px 0 6px'}},O.tr('Roles','Роли')),
    rolesEl,
    h('button',{class:'btn pri wide',style:{marginTop:'14px'},onclick:()=>{
      a.name=nameInp.value.trim();
      if(!a.name){O.toast(O.tr('Enter a name','Введите название'));return}
      O.mmSave(a);O.toast(O.tr('Saved','Сохранено'),1200);s.close();if(done)done();
    }},O.tr('Save','Сохранить')));
  if(!isNew)body.append(h('button',{class:'btn dng wide',style:{marginTop:'8px'},onclick:async()=>{
    if(await O.confirm(O.tr('Delete agent?','Удалить агента?'),a.name,O.tr('Delete','Удалить'),true)){O.mmDelete(a.id);s.close();if(done)done()}
  }},O.tr('Delete','Удалить')));
  draw();
};

O.mmRoleEditor=(r,done,opts)=>{
  opts=opts||{};
  r=Object.assign({},r);
  r.backups=Array.isArray(r.backups)?r.backups.filter(Boolean):[];
  const body=h('div');
  const s=O.sheet(r.name?O.tr('Edit role','Редактирование роли'):O.tr('New role','Новая роль'),body,{full:true});
  const nameInp=h('input',{type:'text',placeholder:O.tr('Role, e.g. Translator, Critic, Coder','Роль, например Переводчик, Критик, Кодер'),value:r.name||''});
  const modelRow=h('button',{class:'settings-row',onclick:()=>O.mmPickModel(r.model,m=>{r.model=m;draw()},opts)},
    h('div',{class:'settings-row-icon purple'},O.icon('cpu')),
    h('div',{class:'settings-row-text'},h('b',null,O.tr('Role model','Модель роли')),
      h('span',{id:'mm-role-sub'},r.model?mName(r.model):O.tr('Optional — lead model by default','Необязательно — по умолчанию главная'))),
    O.icon('chevR'));
  const promptTa=h('textarea',{rows:6,class:'mono',placeholder:O.tr('System prompt for this role (optional)','Промпт роли (необязательно)')});
  promptTa.value=r.prompt||'';
  const bEl=h('div',{class:'mm-bups',style:{padding:'6px 12px 10px'}});
  const drawB=()=>{
    bEl.textContent='';
    const wrap=h('div',{class:'fchips'});
    r.backups.forEach((bm,i)=>wrap.append(h('span',{class:'chip keep',style:{fontSize:'12px'}},mName(bm),
      h('button',{class:'chip-x',style:{marginLeft:'4px',opacity:'.55'},onclick:()=>{r.backups.splice(i,1);drawB()}},O.icon('x')))));
    if(r.backups.length<10)wrap.append(h('button',{class:'chip',style:{fontSize:'12px'},onclick:()=>O.mmPickModel(r.backups[r.backups.length-1],m=>{r.backups.push(m);drawB()},opts)},
      h('span',{class:'ic'},O.icon('plus')),h('span',null,O.tr('backup','запасная'))));
    bEl.append(wrap);
  };
  const draw=()=>{const sub=modelRow.querySelector('#mm-role-sub');if(sub)sub.textContent=r.model?mName(r.model):O.tr('Optional — lead model by default','Необязательно — по умолчанию главная');drawB()};
  body.append(h('div',{class:'field'},h('label',null,O.tr('Role name','Название роли')),nameInp),
    h('div',{class:'field'},h('label',null,O.tr('Prompt (optional)','Промпт (необязательно)')),promptTa),
    h('div',{class:'settings-section-title',style:{margin:'10px 0 6px'}},O.tr('Role model','Модель роли')),
    h('div',{class:'settings-card'},modelRow,bEl),
    h('button',{class:'btn pri wide',style:{marginTop:'14px'},onclick:()=>{
      r.name=nameInp.value.trim();
      if(!r.name){O.toast(O.tr('Enter a role name','Введите название роли'));return}
      r.prompt=promptTa.value.trim();
      r.backups=r.backups.slice(0,10);
      done(true,r);s.close();
    }},O.tr('Save','Сохранить')));
  draw();
};

// ---- orchestration ----
O.mm={run:null};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const PLAN_TAG='[МУЛЬТИМОДАЛЬНЫЙ РЕЖИМ]';
const fmtClock=ms=>{const d=new Date(ms);const p=n=>String(n).padStart(2,'0');return p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds())};

async function mmWaitIdle(sids,run,timeoutMs){
  const end=Date.now()+(timeoutMs||600000);
  const pending=new Set(sids);
  while(Date.now()<end){
    if(!run||run.abort)throw new Error('aborted');
    if(run.paused){await sleep(500);continue}
    try{
      const st=await api('GET','/session/status',null,{timeout:6000});
      for(const id of [...pending]){
        if(run.roleAborts&&run.roleAborts.has(id)){try{await api('POST','/session/'+id+'/abort',{})}catch(e){};pending.delete(id);continue}
        const x=st[id];if(!x||x.type==='idle'||x.type==='error')pending.delete(id)}
      if(!pending.size)return;
    }catch(e){}
    await sleep(2500);
  }
  for(const id of pending){try{await api('POST','/session/'+id+'/abort',{})}catch(e){}}
  throw new Error(O.tr('Multimodal run timed out','Таймаут мультимодального запуска'));
}
async function mmLastAssistant(sid){
  const arr=await api('GET','/session/'+sid+'/message',null,{timeout:20000});
  let text='';
  for(const m of arr){if(m.info&&m.info.role==='assistant'){const t=(m.parts||[]).filter(p=>p.type==='text').map(p=>p.text).join('\n');if(t.trim())text=t}}
  return text.trim();
}
function mmParsePlan(text,mm){
  if(!text)return[];
  let raw=null;
  const jb=text.match(/```json\s*([\s\S]*?)```/i)||text.match(/```\s*([\s\S]*?)```/);
  const tryParse=t=>{try{return JSON.parse(t)}catch{return null}};
  if(jb)raw=tryParse(jb[1].trim());
  if(!raw){const m=text.match(/\{[\s\S]*\}/);if(m)raw=tryParse(m[0])}
  const tasks=raw&&Array.isArray(raw.tasks)?raw.tasks:null;
  if(!tasks)return[];
  const norm=s=>String(s||'').trim().toLowerCase();
  const out=[];
  for(const t of tasks){
    const role=mm.roles.find(r=>norm(r.name)===norm(t.role));
    if(role&&t.task)out.push({role,task:String(t.task)});
  }
  return out;
}

O.mmPause=()=>{const r=O.mm.run;if(!r)return;r.paused=!r.paused;bus.emit('mm:progress');O.toast(r.paused?O.tr('Paused','Пауза'):O.tr('Resumed','Продолжаю'),1500)};O.mmStop=()=>{const r=O.mm.run;if(!r)return;r.abort=true;r.paused=false;
  if(r.sid)api('POST','/session/'+r.sid+'/abort',{}).catch(()=>{});
  (r.jobs||[]).forEach(j=>{if(j.sid)api('POST','/session/'+j.sid+'/abort',{}).catch(()=>{})});
  bus.emit('mm:progress')};
O.mmStopRole=name=>{const r=O.mm.run;if(!r)return;r.roleAborts=r.roleAborts||new Set();
  const j=(r.jobs||[]).find(x=>x.role&&x.role.name===name);
  if(j&&j.sid){r.roleAborts.add(j.sid);api('POST','/session/'+j.sid+'/abort',{}).catch(()=>{});O.toast(O.tr('Role stopped: ','Роль остановлена: ')+name,1800);bus.emit('mm:progress')}};

// Actions for one role: open its session or stop that model
O.mmRoleActions=job=>{
  if(!job)return;
  const name=job.role&&job.role.name||O.tr('role','роль');
  const done=!S.status[job.sid]||S.status[job.sid].type==='idle';
  const body=h('div',null,
    h('div',{class:'note'},O.tr('Role: ','Роль: ')+name+(job.sid?'':' · '+O.tr('failed','ошибка'))),
    h('button',{class:'btn pri wide',style:{marginTop:'10px'},disabled:!job.sid,onclick:()=>{s.close();if(O.openChild)O.openChild(job.sid)}},O.icon('chat'),O.tr('Open session','Открыть сессию')),
    h('button',{class:'btn wide',style:{marginTop:'8px'},disabled:!job.sid||done,onclick:()=>{s.close();O.mmStopRole&&O.mmStopRole(name)}},O.icon('stop'),O.tr('Stop this model','Остановить модель')));
  const s=O.sheet(O.tr('Role: ','Роль: ')+name,body,{hud:true});
};

// ---- graph visualisation of the MM run (who talks to whom) ----
const MM_NODE_W=132,MM_NODE_H=52,MM_GAP_X=26,MM_GAP_Y=72;
O.mmGraphData=()=>{
  const r=O.mm.run;if(!r)return null;
  const jobs=r.jobs||[];
  const roles=jobs.map(j=>({name:j.role&&j.role.name||'role',model:(j.role&&j.role.model&&j.role.model.modelID)||'',sid:j.sid||'',err:j.err||''}));
  const phase=r.phase||'plan';
  const statusOf=j=>{
    if(!j.sid)return 'err';
    const st=S.status[j.sid];
    if(!st||st.type==='idle')return 'done';
    return 'busy';
  };
  const mmActive=O.mmActive();
  return {
    name:(mmActive&&mmActive.name)||'',
    phase,
    leadModel:(r.leadModel||'')||'',
    nodes:[
      {id:'__lead__',name:O.tr('Coordinator','Координатор'),model:r.leadModel||'',kind:'lead',status:phase==='plan'?'busy':(phase==='synth'?'busy':'done')},
      ...roles.map((x,i)=>({id:'r'+i,name:x.name,model:x.model,kind:'role',status:statusOf(jobs[i]),err:x.err}))
    ],
    links:roles.map((_,i)=>({from:'__lead__',to:'r'+i})),
    synth:phase==='synth'
  };
};
O.openMmGraph=async()=>{
  const body=h('div',{class:'mm-graph-wrap'});
  const svgNS='http://www.w3.org/2000/svg';
  let sheet=null;
  const draw=()=>{
    body.textContent='';
    const g=O.mmGraphData();
    if(!g){body.append(h('div',{class:'mut',style:{padding:'20px',textAlign:'center'}},O.tr('The multimodal agent is not running','Мультимодальный агент не запущен')));return}
    const rows=g.nodes.length;
    const svg=document.createElementNS(svgNS,'svg');
    const W=MM_NODE_W*2+MM_GAP_X+24,H=MM_NODE_H*rows+MM_GAP_Y+24;
    svg.setAttribute('viewBox','0 0 '+W+' '+H);
    svg.setAttribute('class','mm-graph');
    const mk=(tag,attrs)=>{const e=document.createElementNS(svgNS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);return e};
    g.links.forEach(l=>{
      const to=g.nodes.find(n=>n.id===l.to);if(!to)return;
      const i=g.nodes.indexOf(to);
      const x1=MM_NODE_W/2+12,y1=MM_NODE_H/2+12;
      const x2=MM_NODE_W+MM_GAP_X+MM_NODE_W/2+12,y2=MM_NODE_H*i+MM_GAP_Y+MM_NODE_H/2+12;
      const path=mk('path',{d:'M '+x1+' '+y1+' C '+(x1+40)+' '+y1+', '+(x2-40)+' '+y2+', '+x2+' '+y2,
        class:'mm-graph-link '+(to.status==='busy'?'active':to.status==='done'?'done':'')});
      svg.append(path);
      svg.append(mk('circle',{cx:x1,cy:y1,r:3.5,class:'mm-graph-dot'}));
    });
    g.nodes.forEach((n,i)=>{
      const isLead=n.kind==='lead';
      const x=isLead?12:MM_NODE_W+MM_GAP_X+12,y=isLead?12:MM_NODE_H*i+MM_GAP_Y+12;
      const gEl=mk('g',{class:'mm-graph-node '+n.kind+' '+n.status+(n.sid?' clickable':''),transform:'translate('+x+','+y+')'});
      gEl.append(mk('rect',{x:0,y:0,width:MM_NODE_W,height:MM_NODE_H,rx:12,class:'mm-graph-box'}));
      const t1=mk('text',{x:MM_NODE_W/2,y:20,class:'mm-graph-title','text-anchor':'middle'});
      t1.textContent=n.name.length>16?n.name.slice(0,15)+'…':n.name;
      gEl.append(t1);
      const t2=mk('text',{x:MM_NODE_W/2,y:37,class:'mm-graph-sub','text-anchor':'middle'});
      t2.textContent=n.model||(isLead?O.tr('main model','главная модель'):'—');
      gEl.append(t2);
      const t3=mk('text',{x:MM_NODE_W/2,y:48,class:'mm-graph-state','text-anchor':'middle'});
      t3.textContent=n.status==='busy'?O.tr('working','работает'):n.status==='done'?O.tr('done','готово'):O.tr('failed','ошибка');
      gEl.append(t3);
      if(n.sid){
        const hint=mk('text',{x:MM_NODE_W-10,y:14,class:'mm-graph-open','text-anchor':'end'});
        hint.textContent='>';
        gEl.append(hint);
        let opened=false;
        const openIt=e=>{
          if(opened)return;opened=true;
          if(e&&e.stopPropagation)e.stopPropagation();
          try{if(sheet)sheet.close()}catch(_){}
          if(O.openChild)O.openChild(n.sid);
        };
        gEl.addEventListener('click',openIt);
        gEl.addEventListener('pointerup',e=>{if(e&&e.pointerType!=='mouse')openIt(e)});
      }
      svg.append(gEl);
    });
    body.append(svg);
    // ---- controls ----
    const run=O.mm.run;
    const ctrl=h('div',{class:'mm-graph-ctrl'},
      h('button',{class:'btn sm',onclick:()=>{O.mmPause&&O.mmPause();draw()}},O.icon(run&&run.paused?'play':'pause'),run&&run.paused?O.tr('Resume','Продолжить'):O.tr('Pause','Пауза')),
      h('button',{class:'btn sm',onclick:()=>{O.mmStop&&O.mmStop();draw()}},O.icon('stop'),O.tr('Stop all','Стоп')));
    (run&&run.jobs||[]).forEach(j=>{
      if(!j.sid)return;
      const done=!S.status[j.sid]||S.status[j.sid].type==='idle';
      ctrl.append(h('button',{class:'btn sm',title:O.tr('Role actions','Действия с ролью'),onclick:()=>{O.mmRoleActions&&O.mmRoleActions(j);draw()}},
        O.icon(done?'check':'stop'),(j.role.name||'')));
    });
    body.append(ctrl);
    body.append(h('div',{class:'mm-graph-legend'},
      h('span',null,h('i',{class:'lg busy'}),O.tr('working','работает')),
      h('span',null,h('i',{class:'lg done'}),O.tr('done','готово')),
      h('span',null,h('i',{class:'lg err'}),O.tr('failed','ошибка')),
      h('span',null,O.tr('tap a role to open its session','нажмите на роль, чтобы открыть её сессию'))));
  };
  draw();
  sheet=O.sheet(O.tr('Multimodal agent graph','Граф мультимодального агента'),body,{full:true});
  const t=setInterval(()=>{if(!sheet||!sheet.root.isConnected){clearInterval(t);return}draw()},1500);
};


function mmConfirmPlan(mm,plan){
  return new Promise(res=>{
    let done=false;
    const finish=v=>{if(done)return;done=true;try{s.close()}catch(_){}res(v)};
    const listBox=h('div',{class:'settings-card'});
    const collect=()=>{listBox.querySelectorAll('textarea').forEach((ta,i)=>{if(plan[i])plan[i].task=ta.value.trim()})};
    const redraw=()=>{
      listBox.textContent='';
      plan.forEach((t,i)=>{
        const ta=h('textarea',{class:'mono',rows:2,style:{width:'100%'}});ta.value=t.task||'';
        listBox.append(h('div',{class:'settings-row',style:{alignItems:'flex-start'}},
          h('div',{class:'settings-row-icon purple'},O.icon('bot')),
          h('div',{class:'settings-row-text',style:{flex:1}},
            h('b',null,t.role.name||'role'),
            h('div',{class:'field',style:{marginTop:'4px'}},ta)),
          h('button',{class:'ibtn s',title:O.tr('Remove task','Убрать задачу'),onclick:()=>{collect();plan.splice(i,1);redraw()}},O.icon('trash'))));
      });
    };
    redraw();
    const body=h('div',null,
      h('div',{class:'mut',style:{padding:'6px 2px 10px'}},O.tr('The lead model prepared this plan. Edit tasks, remove or confirm before roles start.','Главная модель подготовила план. Отредактируйте задачи, уберите лишние или подтвердите запуск.')),
      listBox,
      h('div',{style:{display:'flex',gap:'8px',marginTop:'12px'}},
        h('button',{class:'btn wide',onclick:()=>finish(false)},O.tr('Cancel','Отмена')),
        h('button',{class:'btn pri',style:{flex:'1'},onclick:()=>{
          collect();
          const cleaned=plan.filter(t=>t&&t.task);
          if(!cleaned.length)return O.toast(O.tr('Add at least one task','Оставьте хотя бы одну задачу'),2500);
          finish(cleaned);
        }},O.icon('play'),O.tr('Run roles','Запустить роли'))));
    const s=O.sheet(O.tr('Plan: ','План: ')+(mm.name||''),body,{hud:true,onClose:()=>finish(false)});
  });
}

O.mmSend=async(text,parts)=>{
  const mm=O.mmActive();
  if(!mm)return false;
  if(O.mm.run){O.toast(O.tr('Multimodal agent is still running — wait for it to finish','Мультимодальный агент ещё работает — дождитесь завершения'),3000);return true}
  const sessModel=S.model?{providerID:S.model.providerID,modelID:S.model.modelID}:null;
  const leadMain=mm.main||sessModel;
  const leadBackup=mm.backup||null;
  if(!leadMain){O.toast(O.tr('No model selected — pick a model or set the lead model','Модель не выбрана — выберите модель или задайте главную'),3000);return true}
  const sid=await O.chat.sess();
  const run=O.mm.run={sid,abort:false,paused:false,roleAborts:new Set(),jobs:[],started:Date.now(),phase:'plan',phaseStart:Date.now(),leadModel:leadMain&&leadMain.modelID||''};
  O.maybeAutoTitle(sid,text);
  const emit=()=>bus.emit('mm:progress');
  const fileNames=parts.filter(p=>p.type==='file').map(p=>p.filename||'').filter(Boolean);
  const userText=text+(fileNames.length?'\n(прикреплённые файлы: '+fileNames.join(', ')+')':'');
  // optimistic user bubble
  const mid=O.mid();
  const m=O.upsertMsg({id:mid,sessionID:sid,role:'user',time:{created:Date.now()},agent:S.agent,model:leadMain});m.local=true;
  m.parts=parts.map((p,i)=>Object.assign({id:'prt_local'+i,sessionID:sid,messageID:mid},p));
  bus.emit('msg',sid,m);
  const post=(body)=>api('POST','/session/'+sid+'/prompt_async',Object.assign({agent:S.agent,variant:S.variant||undefined},body),{timeout:30000});
  try{
    // step 1: lead model makes the plan; on failure fall back to the backup lead
    const roleLines=mm.roles.map(r=>' - '+r.name+(r.prompt?': '+String(r.prompt).slice(0,200):'')).join('\n');
    const planInstr=PLAN_TAG+'\nТы — координатор команды «'+mm.name+'». НЕ решай задачу самостоятельно — распредели её по ролям.\nДоступные роли:\n'+roleLines+
      '\n\nЗапрос пользователя: «'+userText+'»\n\nВерни ТОЛЬКО JSON-план в блоке ```json вида:\n{"tasks":[{"role":"<имя роли>","task":"<что сделать>"}]}\nЗадавай подзадачи только подходящим ролям, каждой — одну чёткую подзадачу.';
    const leadModels=[leadMain,leadBackup].filter(Boolean);
    let plan=null,planText='',leadUsed=null;
    for(const lead of leadModels){
      run.phase='plan';run.phaseStart=Date.now();emit();
      await post({messageID:O.mid(),model:lead,parts:[{type:'text',text:planInstr}]});
      await mmWaitIdle([sid],run);
      if(run.abort)throw new Error('aborted');
      let err=false;try{const st=await api('GET','/session/status',null,{timeout:6000});err=!!(st[sid]&&st[sid].type==='error')}catch(e){}
      planText=await mmLastAssistant(sid);
      plan=err?null:mmParsePlan(planText,mm);
      if(plan&&plan.length){leadUsed=lead;break}
      if(err&&leadModels[leadModels.indexOf(lead)+1])continue; // quota/error → try backup lead
      if(!err)break; // direct answer (no plan) — done
      leadUsed=lead
    }
    if(!plan||!plan.length){O.mm.run=null;return true} // lead answered directly — done
    const confirmed=await mmConfirmPlan(mm,plan);
    if(!confirmed){O.mm.run=null;emit();return true}
    plan=confirmed;
    // step 2: spawn subagent sessions per role
    const jobs=[];
    for(const t of plan){
      if(run.abort)break;
      try{
        const cs=await api('POST','/session',{parentID:sid,title:mm.name+' · '+t.role.name});
        const rtext='Ты — «'+t.role.name+'» в команде «'+mm.name+'».\n'+(t.role.prompt||'')+
          '\n\nЗадача от координатора: '+t.task+'\nИсходный запрос пользователя: «'+userText+'»\n\nВыполни свою часть и дай конкретный результат.';
        await api('POST','/session/'+cs.id+'/prompt_async',{messageID:O.mid(),agent:S.agent,model:t.role.model||leadMain,parts:[{type:'text',text:rtext}]},{timeout:30000});
        jobs.push({sid:cs.id,role:t.role,task:t.task});
        O.toast(O.tr('Role started: ','Роль запущена: ')+t.role.name,1800);
      }catch(e){jobs.push({sid:null,role:t.role,task:t.task,err:e.message||String(e)})}
    }
    run.jobs=jobs;emit();
    // step 3: wait for all roles
    run.phase='role';run.phaseStart=Date.now();emit();
    await mmWaitIdle(jobs.filter(j=>j.sid).map(j=>j.sid),run);
    if(run.abort)throw new Error('aborted');
    // step 3.5: fallback per failed role — up to 3 backup models each (sequentially)
    for(let x=0;x<jobs.length;x++){
      const j=jobs[x];if(!j.sid)continue;
      if(run.roleAborts&&run.roleAborts.has(j.sid)){jobs[x]={sid:null,role:j.role,err:O.tr('stopped by user','остановлена пользователем')};continue}
      run.currentRole=j.role.name;emit();
      let err=false;try{const st=await api('GET','/session/status',null,{timeout:6000});err=!!(st[j.sid]&&st[j.sid].type==='error')}catch(e){}
      if(!err)continue;
      let t='';try{t=await mmLastAssistant(j.sid)}catch(e){}
      if(t.trim())continue; // errored but produced content — keep it
      const bups=[j.role.model||leadMain].concat((j.role.backups||[]).filter(Boolean));
      let done=false;
      for(const model of bups){
        if(run.abort)break;
        run.currentRole=j.role.name+' (retry)';emit();
        try{
          const cs2=await api('POST','/session',{parentID:sid,title:mm.name+' · '+j.role.name+' · '+O.tr('retry','повтор')});
          const rtext='Ты — «'+j.role.name+'» в команде «'+mm.name+'».\n'+(j.role.prompt||'')+
            '\n\nЗадача от координатора: '+j.task+'\nИсходный запрос пользователя: «'+userText+'»\n\nВыполни свою часть и дай конкретный результат.';
          await api('POST','/session/'+cs2.id+'/prompt_async',{messageID:O.mid(),agent:S.agent,model,parts:[{type:'text',text:rtext}]},{timeout:30000});
          await mmWaitIdle([cs2.id],run,420000);
          if(run.abort)break;
          const t2=await mmLastAssistant(cs2.id).catch(()=>'');
          if(t2.trim()){jobs[x]={sid:cs2.id,role:j.role,task:j.task};done=true;break}
        }catch(e){}
      }
      if(!done){try{await api('DELETE','/session/'+j.sid,{})}catch(e){}jobs[x]={sid:null,role:j.role,err:O.tr('primary and backup models failed','основная и запасные модели не сработали')}}
    }
    // step 4: final synthesis by the lead model
    run.phase='synth';run.phaseStart=Date.now();run.currentRole='Синтез';emit();
    const results=[];
    for(const j of jobs){
      if(!j.sid){results.push('['+j.role.name+']: (ошибка запуска: '+(j.err||'нет ответа')+')');continue}
      let t='';try{t=await mmLastAssistant(j.sid)}catch(e){}
      results.push('['+j.role.name+']:\n'+(t||'(нет ответа)'));
    }
    const finInstr=PLAN_TAG+' — ФИНАЛ\nРоли команды «'+mm.name+'» завершили подзадачи. Их результаты:\n\n'+results.join('\n\n')+
      '\n\nИсходный запрос пользователя: «'+userText+'»\n\nСинтезируй единый финальный ответ для пользователя: что сделано и итог. Без служебных пометок.';
    await post({messageID:O.mid(),model:leadUsed||leadMain,parts:[{type:'text',text:finInstr}]});
    O.mm.run=null;
    emit();
  }catch(e){
    O.mm.run=null;
    emit();
    if(!/aborted/i.test(e.message||''))O.toast(O.tr('Multimodal agent: ','Мультимодальный агент: ')+(e.message||e),4000);
  }
  return true;
};
O.mmFmtClock=fmtClock;
})();
