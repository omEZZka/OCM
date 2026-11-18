(function(){
const O=window.OCM,h=O.h,S=O.S,bus=O.bus;
const CFG='/root/.config/opencode';
const BUILTIN=['build','plan','general'];

// ---- shared helpers ----
const slug=s=>String(s||'').trim().toLowerCase().replace(/[^a-z0-9а-яё_-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,40);
const readMeta=path=>{
  const r=O.native.readText(path);
  if(!r.ok)return {exists:false,desc:'',mode:'',body:'',raw:''};
  const raw=r.text||'';
  const m=raw.match(/^---\n([\s\S]*?)\n---\n?/);
  let desc='',mode='',body=raw;
  if(m){
    body=raw.slice(m[0].length);
    const dm=m[1].match(/^description:\s*(.*)$/m);if(dm)desc=dm[1].trim().replace(/^["']|["']$/g,'');
    const mm=m[1].match(/^mode:\s*(.*)$/m);if(mm)mode=mm[1].trim();
  }
  return {exists:true,desc,mode,body,raw};
};
const writeAgentMd=(name,desc,mode,prompt)=>{
  const fm='---\ndescription: '+JSON.stringify(desc||'')+'\nmode: '+mode+'\n---\n\n';
  const dir=CFG+'/agents';
  O.native.fs('mkdir',dir);
  const w=O.native.writeText(dir+'/'+name+'.md',fm+(prompt||'').trim()+'\n');
  if(w.ok)O.loadMeta();
  return w;
};
const agentPath=name=>CFG+'/agents/'+name+'.md';
const isCustom=name=>!BUILTIN.includes(name)&&readMeta(agentPath(name)).exists;

// ---- create/edit one agent or mode; kind: 'primary' (режим) | 'subagent' (агент) ----
O.openAgentEditor=(kind,existing,done)=>{
  kind=kind==='subagent'?'subagent':'primary';
  const cur=existing?readMeta(agentPath(existing)):null;
  const nameInp=h('input',{placeholder:O.tr('Name (latin), e.g. reviewer','Имя (латиницей), например reviewer'),value:existing||''});
  if(existing)nameInp.disabled=true;
  const descInp=h('input',{placeholder:O.tr('Short description — when to use it','Короткое описание — когда его использовать'),value:cur?cur.desc:''});
  const promptTa=h('textarea',{class:'mono',rows:9,placeholder:O.tr('System prompt: role, rules, output format…','Системный промпт: роль, правила, формат ответа…')});
  promptTa.value=cur?cur.body.trim():'';
  let mode=kind;
  const seg=h('div',{class:'seg',style:{margin:'0 0 10px'}},
    [['primary',O.tr('Mode (chat)','Режим (чат)')],['subagent',O.tr('Agent (subagent)','Агент (субагент)')]].map(([k,l])=>
      h('button',{class:k===mode?'on':'',onclick:e=>{mode=k;seg.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b===e.currentTarget))}},l)));
  // AI generation: describe the desired result in plain words, the active model writes the prompt
  const wishTa=h('textarea',{rows:3,placeholder:O.tr('Describe the desired result in your own words: "checks my code for bugs, answers briefly, never edits files"','Опишите своими словами, что должно получиться: «проверяет мой код на баги, отвечает кратко, файлы не правит»')});
  const genBtn=h('button',{class:'btn wide',onclick:async()=>{
    const wish=wishTa.value.trim();
    if(!wish)return O.toast(O.tr('Describe what the agent should do','Опишите, что должен делать агент'),2500);
    if(!S.model)return O.toast(O.tr('Select a model first','Сначала выберите модель'),2500);
    genBtn.disabled=true;const old=genBtn.innerHTML;genBtn.textContent=O.tr('Generating…','Генерирую…');
    try{
      const sys='You design opencode agent definitions. Reply ONLY with JSON: {"name":"latin-kebab-name","description":"one short sentence when to use it","prompt":"full markdown system prompt"}. The prompt must be written in the same language as the user request, define the role, concrete rules, workflow and output format. Agent kind: '+(mode==='subagent'?'subagent (delegated narrow tasks, called via @mention)':'primary chat mode (the user talks to it directly)')+'.';
      const r=await O.api('POST','/session',{title:'agent-gen'},{timeout:15000});
      const mid=O.mid();
      await O.api('POST','/session/'+r.id+'/prompt_async',{messageID:mid,agent:'build',model:S.model,parts:[{type:'text',text:sys,synthetic:true},{type:'text',text:wish}]},{timeout:30000});
      let txt='';
      for(let i=0;i<90;i++){
        await new Promise(res=>setTimeout(res,1500));
        const st=await O.api('GET','/session/status',null,{timeout:5000,cache:false}).catch(()=>null);
        const x=st&&st[r.id],t=typeof x==='string'?x:(x&&x.type);
        if(!t||t==='idle'||t==='error'){
          const arr=await O.api('GET','/session/'+r.id+'/message',null,{timeout:20000,cache:false});
          for(const m of arr||[])if(m.info&&m.info.role==='assistant'){const t2=(m.parts||[]).filter(p=>p.type==='text').map(p=>p.text).join('\n');if(t2.trim())txt=t2}
          break;
        }
      }
      try{await O.api('DELETE','/session/'+r.id)}catch(_){}
      const jm=txt.match(/\{[\s\S]*\}/);
      if(!jm)throw new Error(O.tr('Model returned no JSON','Модель не вернула JSON'));
      const j=JSON.parse(jm[0]);
      if(!existing&&j.name&&!nameInp.value.trim())nameInp.value=slug(j.name);
      if(j.description&&!descInp.value.trim())descInp.value=String(j.description).slice(0,200);
      if(j.prompt)promptTa.value=String(j.prompt).trim();
      O.toast(O.tr('Draft ready — review and save','Черновик готов — проверьте и сохраните'),2500);
    }catch(e){O.toast(e.message||String(e),4000)}
    genBtn.disabled=false;genBtn.innerHTML=old;
  }},O.icon('bulb'),O.tr('Describe the result — AI writes the agent','Опишите результат — ИИ напишет агента'));
  const save=()=>{
    const name=existing||slug(nameInp.value);
    if(!name)return O.toast(O.tr('Enter a name','Введите имя'),2000);
    if(BUILTIN.includes(name))return O.toast(O.tr('This name is reserved','Это имя занято встроенным агентом'),2500);
    if(!promptTa.value.trim())return O.toast(O.tr('Write the prompt (or generate it with AI)','Напишите промпт (или сгенерируйте ИИ)'),2500);
    const w=writeAgentMd(name,descInp.value.trim(),mode,promptTa.value);
    if(!w.ok)return O.toast(w.err||O.tr('Cannot write file','Не удалось записать файл'),3000);
    O.toast(O.tr('Saved: ','Сохранено: ')+name,1800);
    s.close();if(done)done(name,mode);
  };
  const body=h('div',null,
    h('div',{class:'note',style:{margin:'0 0 10px'}},kind==='subagent'
      ?O.tr('A subagent is a helper the main agent calls via @name for a narrow task.','Субагент — помощник, которого основной агент вызывает через @имя для узкой задачи.')
      :O.tr('A mode is a chat persona you switch to with the agent chip.','Режим — персона чата, которую вы выбираете чипом агента.')),
    h('div',{class:'field'},h('label',null,O.tr('What to create','Что создаём')),seg),
    h('div',{class:'field'},h('label',null,O.tr('Name','Имя')),nameInp),
    h('div',{class:'field'},h('label',null,O.tr('Description','Описание')),descInp),
    h('div',{class:'settings-section-title',style:{margin:'12px 0 6px'}},O.tr('Create with AI','Создать с помощью ИИ')),
    wishTa,genBtn,
    h('div',{class:'settings-section-title',style:{margin:'14px 0 6px'}},O.tr('System prompt','Системный промпт')),
    promptTa,
    h('button',{class:'btn pri wide',style:{marginTop:'12px'},onclick:save},O.icon('check'),O.tr('Save','Сохранить')));
  if(existing)body.append(h('button',{class:'btn dng wide',style:{marginTop:'8px'},onclick:async()=>{
    if(!await O.confirm(O.tr('Delete agent?','Удалить агента?'),existing,O.tr('Delete','Удалить'),true))return;
    O.native.fs('delete',agentPath(existing));O.loadMeta();s.close();if(done)done(null);
  }},O.icon('trash'),O.tr('Delete','Удалить')));
  const s=O.sheet(existing?O.tr('Edit: ','Правка: ')+existing:O.tr('New agent / mode','Новый агент / режим'),body,{full:true});
};

// ---- redesigned "Agents & rules" settings screen ----
O.openAgentsRules=()=>{
  if(O.updateReadmeForModel)O.updateReadmeForModel();
  const body=h('div');
  const s=O.sheet(O.tr('Agents & rules','Агенты и правила'),body,{full:true,
    actions:h('button',{class:'ibtn',title:O.tr('Create','Создать'),onclick:()=>O.openAgentEditor('primary',null,()=>draw())},O.icon('plus'))});
  const editFile=(path,title)=>{
    const r=O.native.readText(path);
    const ta=h('textarea',{class:'mono',rows:18});ta.value=r.ok?r.text:'';
    const sh=O.sheet(title,h('div',null,ta,
      h('button',{class:'btn pri wide',style:{marginTop:'8px'},onclick:()=>{
        O.native.fs('mkdir',O.dirname(path));
        const x=O.native.writeText(path,ta.value);
        if(x.ok){O.toastQuiet(O.tr('Saved','Сохранено'));sh.close();O.loadMeta();draw()}else O.toast(x.err||O.tr('Failed','Не удалось'));
      }},O.tr('Save','Сохранить'))),{full:true});
  };
  const up=(t,sbt,kind,dir)=>O.listRow('up',t,sbt,null,()=>OC.pickFile(kind,dir||''));
  const sect=t=>h('div',{class:'settings-section-title',style:{margin:'14px 2px 6px'}},t);
  const draw=()=>{
    body.textContent='';
    // 1. Modes — what the user talks to
    body.append(sect(O.tr('Chat modes','Режимы чата')));
    const modesCard=h('div',{class:'settings-card'});
    const prim=(S.agents||[]).filter(a=>a.mode!=='subagent'&&!a.hidden);
    prim.forEach(a=>{
      const custom=isCustom(a.name);
      modesCard.append(O.listRow(a.name==='plan'?'list':'bot',a.name.charAt(0).toUpperCase()+a.name.slice(1),
        a.description||(custom?O.tr('Custom mode','Свой режим'):O.tr('Built-in','Встроенный')),
        h('span',{style:{display:'flex',alignItems:'center',gap:'6px'}},
          a.name===S.agent?h('span',{class:'chip keep',style:{fontSize:'11px',minHeight:'26px',padding:'2px 10px'}},O.tr('active','активен')):null,
          custom?O.icon('edit'):null),
        ()=>{
          const acts=[{label:O.tr('Use this mode','Использовать режим'),icon:'check',fn:()=>{O.setAgent(a.name);draw()}}];
          if(custom)acts.push({label:O.tr('Edit','Редактировать'),icon:'edit',fn:()=>O.openAgentEditor('primary',a.name,()=>draw())});
          acts.push({label:O.tr('Open prompt file','Открыть файл промпта'),icon:'doc',fn:()=>editFile(agentPath(a.name),a.name+'.md')});
          O.actions(a.name,acts);
        }));
    });
    modesCard.append(O.listRow('plus',O.tr('New mode…','Новый режим…'),O.tr('Manually or from an AI-generated description','Вручную или по описанию от ИИ'),null,()=>O.openAgentEditor('primary',null,()=>draw())));
    body.append(modesCard);
    // 2. Subagents — helpers called via @
    body.append(sect(O.tr('Subagents (@helpers)','Субагенты (@помощники)')));
    const subCard=h('div',{class:'settings-card'});
    const subs=(S.agents||[]).filter(a=>(a.mode==='subagent'||a.mode==='all')&&!a.hidden);
    subs.forEach(a=>{
      const custom=isCustom(a.name);
      subCard.append(O.listRow('user','@'+a.name,a.description||(custom?O.tr('Custom subagent','Свой субагент'):O.tr('Built-in','Встроенный')),
        custom?O.icon('edit'):null,
        ()=>{
          const acts=[];
          if(custom)acts.push({label:O.tr('Edit','Редактировать'),icon:'edit',fn:()=>O.openAgentEditor('subagent',a.name,()=>draw())});
          acts.push({label:O.tr('Open prompt file','Открыть файл промпта'),icon:'doc',fn:()=>editFile(agentPath(a.name),a.name+'.md')});
          O.actions('@'+a.name,acts);
        }));
    });
    subCard.append(O.listRow('plus',O.tr('New subagent…','Новый субагент…'),O.tr('A narrow helper: reviewer, tester, translator…','Узкий помощник: ревьюер, тестировщик, переводчик…'),null,()=>O.openAgentEditor('subagent',null,()=>draw())));
    body.append(subCard);
    // 3. Rules — instructions every agent reads
    body.append(sect(O.tr('Rules (AGENTS.md)','Правила (AGENTS.md)')));
    const projPath=(S.dir||'/root')+'/AGENTS.md';
    const proj=readMeta(projPath);
    body.append(h('div',{class:'settings-card'},
      O.listRow('globe',O.tr('Global rules','Глобальные правила'),O.tr('Apply to every project','Действуют во всех проектах'),O.icon('chevR'),()=>editFile(CFG+'/AGENTS.md',O.tr('Global rules','Глобальные правила'))),
      O.listRow('folder',O.tr('Project rules','Правила проекта'),(S.dir||'/root').replace(/^\/root/,'~')+(proj.exists?' · '+O.tr('file exists','файл есть'):' · '+O.tr('not created yet','ещё не создан')),O.icon('chevR'),()=>editFile(projPath,O.tr('Project rules','Правила проекта'))),
      up(O.tr('Import rules from file…','Импорт правил из файла…'),O.tr('Replaces the global rules','Заменит глобальные правила'),'rules')));
    // 4. Skills & commands
    body.append(sect(O.tr('Skills & commands','Навыки и команды')));
    const scCard=h('div',{class:'settings-card'});
    [['skills',O.tr('Skills','Навыки'),'skill'],['commands',O.tr('Slash commands','/команды'),'command']].forEach(([d,t,kind])=>{
      const r=O.native.ls(CFG+'/'+d);
      const items=(r.items||[]).filter(x=>!x.dir);
      scCard.append(O.listRow(d==='skills'?'bulb':'terminal',t,items.length?items.map(x=>x.name.replace(/\.md$/,'')).join(', '):O.tr('None yet','Пока нет'),O.icon('chevR'),()=>{
        const lb=h('div');
        const sh=O.sheet(t,lb,{full:true,actions:h('button',{class:'ibtn',onclick:()=>OC.pickFile(kind,'')},O.icon('up'))});
        const drawL=()=>{
          lb.textContent='';
          const rr=O.native.ls(CFG+'/'+d);
          const its=(rr.items||[]).filter(x=>!x.dir);
          if(!its.length)lb.append(h('div',{class:'mut',style:{padding:'16px'}},O.tr('Empty. Add a .md file with the upload button.','Пусто. Добавьте .md файл кнопкой загрузки.')));
          its.forEach(x=>lb.append(O.listRow('doc',x.name,'',
            h('button',{class:'ibtn s',onclick:async e=>{e.stopPropagation();if(await O.confirm(O.tr('Delete ','Удалить ')+x.name+'?','','Удалить',true)){O.native.fs('delete',CFG+'/'+d+'/'+x.name);drawL();draw();O.loadMeta()}}},O.icon('trash')),
            ()=>editFile(CFG+'/'+d+'/'+x.name,x.name))));
        };
        drawL();
        const off=O.on('picked',()=>{if(sh.root.isConnected){drawL();draw()}else off()});
      }));
    });
    scCard.append(up(O.tr('Import skill (.md)…','Импорт навыка (.md)…'),O.tr('Adds a skill for the agent','Добавит навык агенту'),'skill'),
      up(O.tr('Import agent (.md)…','Импорт агента (.md)…'),O.tr('Adds an agent from a file','Добавит агента из файла'),'agent'),
      up(O.tr('Import command (.md)…','Импорт команды (.md)…'),O.tr('Adds a /command','Добавит /команду'),'command'));
    body.append(scCard);
    body.append(h('div',{class:'note',style:{marginTop:'12px'}},O.tr('Modes and subagents are .md files in ~/.config/opencode/agents. Changes apply to new messages immediately.','Режимы и субагенты — .md файлы в ~/.config/opencode/agents. Изменения применяются к новым сообщениям сразу.')));
  };
  draw();
  const off=O.on('picked',()=>{if(s.root.isConnected)draw();else off()});
};

// ---- picker opened by the agent chip: switch, create ----
O.openAgentsPicker=()=>{
  const body=h('div');
  const s=O.sheet(O.tr('Modes & agents','Режимы и агенты'),body,{hud:true});
  const draw=()=>{
    body.textContent='';
    const card=h('div',{class:'group-card'});
    O.primaryAgents().forEach(a=>{
      const custom=isCustom(a.name);
      card.append(h('button',{class:'model-row',onclick:()=>{O.setAgent(a.name);s.close()}},
        h('div',{class:'model-row-left'},
          h('span',{class:'model-row-title'},a.name.charAt(0).toUpperCase()+a.name.slice(1)),
          h('span',{class:'model-row-sub'},a.description||(custom?O.tr('Custom mode','Свой режим'):''))),
        h('span',{style:{display:'flex',alignItems:'center',gap:'4px'}},
          custom?h('button',{class:'ibtn s',title:O.tr('Edit','Правка'),onclick:e=>{e.stopPropagation();s.close();O.openAgentEditor('primary',a.name)}},O.icon('edit')):null,
          a.name===S.agent&&!O.mmActiveId()?O.icon('check','model-check'):null)));
    });
    body.append(card);
    body.append(h('button',{class:'btn pri wide',style:{marginTop:'10px'},onclick:()=>{s.close();O.openAgentEditor('primary',null,name=>{if(name)setTimeout(()=>{O.setAgent(name)},600)})}},O.icon('plus'),O.tr('New mode / agent…','Новый режим / агент…')));
    body.append(h('div',{class:'model-disclaimer'},O.tr('Modes are chat personas; subagents are @helpers. Both are created here or in Settings → Agents & rules.','Режимы — персоны чата; субагенты — @помощники. Создаются здесь или в Настройки → Агенты и правила.')));
  };
  draw();
};
})();