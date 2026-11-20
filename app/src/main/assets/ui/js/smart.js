(function(){
const O=window.OCM,h=O.h,S=O.S,api=O.api,bus=O.bus;
// ---- 020: personal memory — facts about the user that ride along every prompt ----
O.userFacts=()=>O.store.get('userFacts',[]);
O.addUserFact=t=>{
  t=String(t||'').trim();if(!t)return false;
  const l=O.userFacts();
  if(l.some(x=>x.text.toLowerCase()===t.toLowerCase()))return false;
  l.push({id:'f_'+Date.now().toString(36),text:t.slice(0,300),at:Date.now()});
  O.store.set('userFacts',l.slice(-60));bus.emit('userFacts');return true;
};
O.delUserFact=id=>{O.store.set('userFacts',O.userFacts().filter(x=>x.id!==id));bus.emit('userFacts')};
O.userFactsText=()=>{
  if(!O.store.get('userFactsOn',true))return'';
  const l=O.userFacts();if(!l.length)return'';
  return'[Факты о пользователе (учитывай всегда): '+l.map(x=>x.text).join('; ')+']';
};
O.openUserFacts=()=>{
  const body=h('div');
  const inp=h('input',{type:'text',placeholder:O.tr('e.g. I prefer Kotlin over Java','напр. Я предпочитаю Kotlin, а не Java')});
  const list=h('div');
  const draw=()=>{
    list.textContent='';
    const l=O.userFacts();
    if(!l.length)list.append(h('div',{class:'note'},O.tr('No facts yet. The agent will remember what you add here across ALL sessions.','Фактов пока нет. Агент будет помнить добавленное здесь во ВСЕХ сессиях.')));
    l.slice().reverse().forEach(f=>list.append(h('div',{class:'settings-row'},
      h('div',{class:'settings-row-icon'},O.icon('memory')),
      h('div',{class:'settings-row-text'},h('b',{style:{whiteSpace:'normal'}},f.text),h('span',null,O.ago(f.at))),
      h('button',{class:'ibtn s',onclick:()=>{O.delUserFact(f.id);draw()}},O.icon('trash')))));
  };
  const add=()=>{if(O.addUserFact(inp.value)){inp.value='';draw();O.toast(O.tr('Remembered','Запомнил'),1200)}};
  inp.addEventListener('keydown',e=>{if(e.key==='Enter')add()});
  const autoBtn=h('button',{class:'btn wide',style:{marginTop:'10px'}},O.icon('bulb'),O.tr('Extract facts from this chat (AI)','Извлечь факты из этого чата (ИИ)'));
  autoBtn.onclick=async()=>{
    if(!S.sid||!O.sideAsk)return O.toast(O.tr('Open a session first','Сначала откройте сессию'),2000);
    autoBtn.disabled=true;autoBtn.textContent=O.tr('Reading the chat…','Читаю чат…');
    try{
      const digest=O.visibleMsgs(S.sid).filter(m=>m.info.role==='user').slice(-30)
        .map(m=>(m.parts||[]).filter(p=>p.type==='text').map(p=>p.text).join(' ')).join('\n').slice(0,6000);
      const raw=await O.sideAsk('Извлеки из сообщений пользователя устойчивые факты о НЁМ (предпочтения, стек, стиль работы, проекты). Только факты, которые полезно помнить в будущих сессиях. Ответь JSON массивом строк (до 5, по-русски, каждая до 120 символов). Если фактов нет — []. Сообщения:\n'+digest,90000);
      const jm=raw.match(/\[[\s\S]*\]/);
      const arr=jm?JSON.parse(jm[0]):[];
      let n=0;arr.slice(0,5).forEach(t=>{if(typeof t==='string'&&O.addUserFact(t))n++});
      draw();O.toast(n?O.tr('Remembered: ','Запомнил: ')+n:O.tr('No new facts','Новых фактов нет'),2000);
    }catch(e){O.toast(e.message||String(e),3000)}
    autoBtn.disabled=false;autoBtn.textContent='';autoBtn.append(O.icon('bulb'),O.tr('Extract facts from this chat (AI)','Извлечь факты из этого чата (ИИ)'));
  };
  body.append(
    O.toggleRow('memory',O.tr('Use memory in prompts','Использовать память в запросах'),O.tr('Facts ride along every message as a hidden instruction','Факты добавляются к каждому сообщению скрытой инструкцией'),O.store.get('userFactsOn',true),v=>O.store.set('userFactsOn',v)),
    h('div',{class:'field',style:{marginTop:'8px'}},h('label',null,O.tr('New fact','Новый факт')),h('div',{style:{display:'flex',gap:'6px'}},inp,h('button',{class:'btn pri',onclick:add},O.icon('plus')))),
    list,autoBtn);
  draw();
  O.sheet(O.tr('Personal memory','Персональная память'),body,{full:true});
};
// ---- 009: project templates — a new chat starts with rules and context ----
const TPL_KEY='projectTemplates';
const DEFAULT_TPLS=[
  {id:'tpl_android',name:'Android / Kotlin',icon:'phone',prompt:'Это Android-проект на Kotlin. Следуй существующему стилю кода, используй корутины, не добавляй зависимости без спроса. Собирай через gradle, если он есть.'},
  {id:'tpl_python',name:'Python',icon:'code',prompt:'Это Python-проект. Используй type hints,.follow PEP8, запускай тесты через pytest если они есть. Виртуальное окружение уже настроено — не создавай новое.'},
  {id:'tpl_web',name:'Web / JS',icon:'globe',prompt:'Это веб-проект. Проверь package.json перед выбором инструментов. Не добавляй тяжёлые зависимости. Проверяй результат в браузере через превью.'},
  {id:'tpl_review',name:'Ревью кода',icon:'shield',prompt:'Режим ревью: не меняй файлы. Читай код, ищи баги, уязвимости и запахи кода. Выдай список проблем по важности с файлами и строками, предложи исправления текстом.'},
  {id:'tpl_docs',name:'Документация',icon:'doc',prompt:'Пиши документацию: кратко, по делу, с примерами. Обновляй README только если попросят явно. Структура: что это, как запустить, как использовать.'}
];
O.projectTpls=()=>DEFAULT_TPLS.concat(O.store.get(TPL_KEY,[]));
O.saveProjectTpl=t=>{
  const l=O.store.get(TPL_KEY,[]);
  const i=l.findIndex(x=>x.id===t.id);
  if(i>=0)l[i]=t;else l.push(t);
  O.store.set(TPL_KEY,l);bus.emit('projectTpls');
};
O.delProjectTpl=id=>{O.store.set(TPL_KEY,O.store.get(TPL_KEY,[]).filter(x=>x.id!==id));bus.emit('projectTpls')};
O.applyProjectTpl=tpl=>{
  O.store.set('tplFor.'+(S.sid||''),tpl.id);
  O.toast(O.tr('Template: ','Шаблон: ')+tpl.name,1600);
};
O.tplTextFor=sid=>{
  const id=O.store.get('tplFor.'+(sid||''),'');
  if(!id)return'';
  const t=O.projectTpls().find(x=>x.id===id);
  return t?'[Контекст проекта: '+t.prompt+']':'';
};
O.openProjectTpls=(pick)=>{
  const body=h('div');
  const draw=()=>{
    body.textContent='';
    body.append(h('div',{class:'note'},pick?O.tr('Pick a template — its rules ride along every prompt in this chat.','Выберите шаблон — его правила будут добавляться к каждому запросу этого чата.'):O.tr('Templates inject project rules into every prompt of the chat they are applied to.','Шаблоны добавляют правила проекта в каждый запрос чата, к которому применены.')));
    O.projectTpls().forEach(t=>{
      const custom=!DEFAULT_TPLS.some(d=>d.id===t.id);
      const active=O.store.get('tplFor.'+(S.sid||''),'')===t.id;
      body.append(h('div',{class:'settings-row'},
        h('div',{class:'settings-row-icon'},O.icon(t.icon||'doc')),
        h('div',{class:'settings-row-text',onclick:()=>{if(pick){O.applyProjectTpl(t);s.close()}else O.editProjectTpl(t)}},
          h('b',null,t.name+(active?' ✓':'')),h('span',{style:{whiteSpace:'normal'}},t.prompt.slice(0,110))),
        pick?h('button',{class:'btn sm'+(active?' pri':''),onclick:()=>{O.applyProjectTpl(t);s.close()}},active?O.tr('Active','Активен'):O.tr('Apply','Применить'))
          :(custom?h('button',{class:'ibtn s',onclick:()=>{O.delProjectTpl(t.id);draw()}},O.icon('trash')):null)));
    });
    if(!pick){
      body.append(h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:()=>O.editProjectTpl(null)},O.icon('plus'),O.tr('New template','Новый шаблон')));
    }else{
      body.append(h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:()=>{O.store.remove('tplFor.'+(S.sid||''));s.close();O.toast(O.tr('Template removed','Шаблон снят'),1400)}},O.icon('x'),O.tr('No template','Без шаблона')));
    }
  };
  const s=O.sheet(O.tr('Project templates','Шаблоны проектов'),body,{full:true});
  draw();
};
O.editProjectTpl=t=>{
  const isNew=!t;
  const name=h('input',{type:'text',value:t?t.name:'',placeholder:O.tr('Template name','Название шаблона')});
  const prompt=h('textarea',{rows:6});prompt.value=t?t.prompt:'';
  const save=()=>{
    if(!name.value.trim()||!prompt.value.trim())return O.toast(O.tr('Fill name and rules','Заполните название и правила'),2000);
    O.saveProjectTpl({id:t&&t.id||'tpl_'+Date.now().toString(36),name:name.value.trim(),icon:'doc',prompt:prompt.value.trim()});
    s.close();O.toast(O.tr('Template saved','Шаблон сохранён'),1400);
  };
  const s=O.sheet(isNew?O.tr('New template','Новый шаблон'):O.tr('Edit template','Правка шаблона'),h('div',null,
    h('div',{class:'field'},h('label',null,O.tr('Name','Название')),name),
    h('div',{class:'field'},h('label',null,O.tr('Rules injected into every prompt','Правила, добавляемые в каждый запрос')),prompt),
    h('button',{class:'btn pri wide',onclick:save},O.icon('check'),O.tr('Save','Сохранить'))),{full:true});
};
// ---- 013: attachment preview before sending (zoom, PDF pages) ----
O.previewAttachment=a=>{
  const mime=String(a.mime||'');
  const body=h('div',{class:'att-viewer'});
  if(mime.startsWith('image/')){
    const img=h('img',{src:a.url,style:{maxWidth:'100%',borderRadius:'12px',transition:'transform .2s',transformOrigin:'center center'}});
    let z=1;
    img.addEventListener('click',()=>{z=z>=2.5?1:z+0.75;img.style.transform='scale('+z+')'});
    body.append(h('div',{class:'note'},O.tr('Tap the image to zoom','Тап по картинке — зум')),h('div',{style:{overflow:'auto',maxHeight:'62vh',textAlign:'center'}},img));
  }else if(mime==='application/pdf'){
    body.append(h('iframe',{src:a.url,style:{width:'100%',height:'62vh',border:'1px solid var(--line)',borderRadius:'12px',background:'#fff'}}));
  }else if(mime.startsWith('text/')||/\.(txt|md|json|js|py|kt|html|css|sh)$/i.test(a.filename||'')){
    let text='';
    try{
      const b64=(a.url.split(',')[1]||'');
      text=decodeURIComponent(escape(atob(b64)));
    }catch(_){try{text=atob(a.url.split(',')[1]||'')}catch(__){text=''}}
    body.append(h('pre',{class:'code-pre',style:{maxHeight:'62vh'}},text.slice(0,20000)));
  }else{
    body.append(h('div',{class:'note'},O.tr('No preview for this file type','Для этого типа файла нет предпросмотра')));
  }
  body.append(h('div',{class:'mut s',style:{marginTop:'8px'}},(a.filename||'file')+' · '+mime+' · ~'+Math.max(1,Math.round((a.url||'').length*0.75/1024))+' KB'));
  O.sheet(a.filename||O.tr('Attachment','Вложение'),body,{full:true});
};
// ---- 014: OCR of screenshot attachments (native ML Kit, async) ----
let ocrSeq=0;const ocrPend=new Map();
O.on('ocr',d=>{
  const p=ocrPend.get(d.id);if(!p)return;ocrPend.delete(d.id);
  try{const r=JSON.parse(d.result||'{}');r.ok&&r.text?p.res(r.text):p.rej(new Error(r.err||'ocr failed'))}
  catch(e){p.rej(e)}
});
O.ocrAttachment=a=>new Promise((res,rej)=>{
  if(!window.OC||!OC.ocrImage)return rej(new Error('no bridge'));
  const id='ocr'+(++ocrSeq)+'_'+Date.now().toString(36);
  const t=setTimeout(()=>{if(ocrPend.delete(id))rej(new Error('timeout'))},70000);
  ocrPend.set(id,{res:v=>{clearTimeout(t);res(v)},rej:e=>{clearTimeout(t);rej(e)}});
  try{OC.ocrImage(id,a.url)}catch(e){clearTimeout(t);ocrPend.delete(id);rej(e)}
});
// ---- 017+018: duel — two models answer side by side, judge picks the best ----
O.openDuel=async(prefill)=>{
  if(!S.model)return O.toast(O.tr('Select a model first','Сначала выберите модель'),2000);
  const models=O.allModels().filter(x=>!O.isModelHidden(x.pid+'/'+x.mid));
  if(models.length<2)return O.toast(O.tr('Need at least two models','Нужно минимум две модели'),2200);
  const curKey=S.model.providerID+'/'+S.model.modelID;
  const other=models.find(x=>x.pid+'/'+x.mid!==curKey)||models[0];
  let mA={pid:S.model.providerID,mid:S.model.modelID},mB={pid:other.pid,mid:other.mid};
  const q=h('textarea',{rows:3,placeholder:O.tr('Question for both models…','Вопрос обеим моделям…')});
  if(prefill)q.value=prefill;
  const selRow=(label,get,set)=>{
    const sel=h('select',{style:{flex:1}});
    models.slice(0,30).forEach(x=>{
      const o=h('option',{value:x.pid+'/'+x.mid},(x.name||x.mid));
      if(x.pid+'/'+x.mid===get().pid+'/'+get().mid)o.selected=true;
      sel.append(o);
    });
    sel.addEventListener('change',()=>{const[pid,mid]=sel.value.split('/');set({pid,mid})});
    return h('div',{class:'field'},h('label',null,label),sel);
  };
  const cols=h('div',{class:'duel-cols hide'});
  const colA=h('div',{class:'duel-col'}),colB=h('div',{class:'duel-col'});
  const verdict=h('div',{class:'duel-verdict hide'});
  const runBtn=h('button',{class:'btn pri wide'},O.icon('zap'),O.tr('Duel','Дуэль'));
  const body=h('div',null,
    h('div',{class:'note'},O.tr('Both models answer the same question in parallel. Then a judge compares and picks the best.','Обе модели отвечают на один вопрос параллельно. Затем судья сравнивает и выбирает лучший.')),
    h('div',{class:'field'},h('label',null,O.tr('Question','Вопрос')),q),
    h('div',{style:{display:'flex',gap:'8px'}},selRow(O.tr('Model A','Модель A'),()=>mA,v=>mA=v),selRow(O.tr('Model B','Модель B'),()=>mB,v=>mB=v)),
    runBtn,cols,verdict);
  cols.append(colA,colB);
  const s=O.sheet(O.tr('Model duel','Дуэль моделей'),body,{full:true});
  const askOne=async(m,col)=>{
    col.textContent='';
    col.append(h('div',{class:'duel-head'},O.icon('cpu'),h('b',null,m.mid)),h('div',{class:'duel-body mut'},O.tr('Thinking…','Думает…')));
    const out=col.querySelector('.duel-body');
    const ses=await api('POST','/session',{title:'Duel · '+m.mid},{dir:false});
    try{
      await api('POST','/session/'+ses.id+'/prompt_async',{messageID:O.mid(),model:{providerID:m.pid,modelID:m.mid},parts:[{type:'text',text:q.value.trim()}]},{timeout:30000,dir:false});
      const deadline=Date.now()+180000;
      let lastLen=0;
      while(Date.now()<deadline){
        await new Promise(r=>setTimeout(r,1500));
        try{
          const arr=await api('GET','/session/'+ses.id+'/message',null,{timeout:8000,dir:false});
          let txt='';
          for(const mm of arr||[])if(mm.info&&mm.info.role==='assistant'){const t2=(mm.parts||[]).filter(p=>p.type==='text').map(p=>p.text).join('\n');if(t2.trim())txt=t2}
          if(txt&&txt.length!==lastLen){lastLen=txt.length;out.classList.remove('mut');out.innerHTML=O.md(txt)}
        }catch(_){}
        const st=await api('GET','/session/status',null,{timeout:5000,dir:false}).catch(()=>null);
        const t0=st&&st[ses.id],t=typeof t0==='string'?t0:(t0&&t0.type);
        if(!t||t==='idle'||t==='error')break;
      }
      const arr=await api('GET','/session/'+ses.id+'/message',null,{timeout:15000,dir:false});
      let txt='';
      for(const mm of arr||[])if(mm.info&&mm.info.role==='assistant'){const t2=(mm.parts||[]).filter(p=>p.type==='text').map(p=>p.text).join('\n');if(t2.trim())txt=t2}
      out.classList.remove('mut');out.innerHTML=O.md(txt||O.tr('(no answer)','(нет ответа)'));
      return txt;
    }finally{try{await api('DELETE','/session/'+ses.id,null,{dir:false})}catch(_){}}
  };
  runBtn.onclick=async()=>{
    if(!q.value.trim())return O.toast(O.tr('Type a question','Введите вопрос'),1800);
    if(mA.pid+'/'+mA.mid===mB.pid+'/'+mB.mid)return O.toast(O.tr('Pick two different models','Выберите две разные модели'),2000);
    runBtn.disabled=true;cols.classList.remove('hide');verdict.classList.add('hide');
    try{
      const[ta,tb]=await Promise.all([askOne(mA,colA).catch(e=>'Error: '+e.message),askOne(mB,colB).catch(e=>'Error: '+e.message)]);
      if(ta&&tb&&O.sideAsk){
        verdict.classList.remove('hide');
        verdict.textContent='';verdict.append(h('span',{class:'spin'}),O.tr('Judge is comparing…','Судья сравнивает…'));
        try{
          const v=await O.sideAsk('Ты судья. Сравни два ответа на вопрос и выбери лучший. Ответь JSON: {"winner":"A" или "B" или "tie","why":"одно короткое предложение почему"}. Вопрос: '+q.value.trim().slice(0,500)+'\n\nОТВЕТ A:\n'+ta.slice(0,3000)+'\n\nОТВЕТ B:\n'+tb.slice(0,3000),90000);
          const jm=v.match(/\{[\s\S]*\}/);
          const j=jm?JSON.parse(jm[0]):null;
          verdict.textContent='';
          if(j&&j.winner){
            const winLabel=j.winner==='tie'?O.tr('Tie','Ничья'):j.winner==='A'?mA.mid:mB.mid;
            verdict.append(h('b',null,O.icon('star'),' ',O.tr('Winner: ','Победитель: ')+winLabel),h('div',{class:'mut s'},j.why||''));
            colA.classList.toggle('duel-win',j.winner==='A');
            colB.classList.toggle('duel-win',j.winner==='B');
            const useBtn=h('button',{class:'btn sm pri',style:{marginTop:'8px'},onclick:()=>{
              const best=j.winner==='B'?tb:ta;
              s.close();
              O.insertPrompt(q.value.trim());
              O.toast(O.tr('Best answer copied to clipboard','Лучший ответ скопирован'),1800);
              O.native.copy(best);
            }},O.icon('copy'),O.tr('Copy the winner','Копировать победителя'));
            verdict.append(useBtn);
          }else verdict.textContent=O.tr('Judge gave no verdict','Судья не вынес вердикт');
        }catch(e){verdict.textContent=e.message||String(e)}
      }
    }finally{runBtn.disabled=false}
  };
  setTimeout(()=>q.focus(),200);
};
// ---- 002: semantic search — natural language over sessions and messages ----
O.smartSearch=async(query,onHit)=>{
  if(!O.sideAsk||!S.model)throw new Error(O.tr('No model for smart search','Нет модели для умного поиска'));
  // gather a compact digest of recent sessions: titles + user prompts.
  // FIX (audit #14): read the hot cache directly via kv — loadCachedMsgs stuffed 40 full sessions
  // into the in-memory store M (memory spike + background archive loads + stray resync events).
  const lines=[];
  const ses=(S.sessions||[]).slice(0,40);
  for(const s of ses){
    let list=[];
    try{
      const inMem=O.msgs(s.id).list;
      list=inMem.length?inMem:(await O.kv.get('msgs:'+s.id))||[];
    }catch(_){}
    const users=list.filter(m=>m.info&&m.info.role==='user').slice(-6);
    users.forEach(m=>{
      const t=(m.parts||[]).filter(p=>p.type==='text'&&!p.synthetic).map(p=>p.text).join(' ').replace(/\s+/g,' ').slice(0,160);
      if(t)lines.push(s.id+'|'+m.info.id+'|'+O.sessionTitle(s).slice(0,40)+'|'+t);
    });
  }
  if(!lines.length)return[];
  const raw=await O.sideAsk('Пользователь ищет в своих чатах: "'+query.slice(0,200)+'". Ниже строки формата sid|mid|название|запрос. Найди ДО 6 строк, которые по СМЫСЛУ соответствуют поиску (не только по словам). Ответь JSON массивом объектов {"sid":"...","mid":"...","why":"до 60 символов почему подходит"}. Если ничего — [].\n\n'+lines.slice(0,150).join('\n'),120000);
  const jm=raw.match(/\[[\s\S]*\]/);
  if(!jm)return[];
  try{
    const arr=JSON.parse(jm[0]);
    return arr.filter(x=>x&&x.sid&&x.mid).slice(0,6);
  }catch(_){return[]}
};
})();