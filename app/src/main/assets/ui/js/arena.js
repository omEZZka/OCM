(function(){
const O=window.OCM,h=O.h,S=O.S,bus=O.bus,api=O.api;

/**
 * Arena mode: 4 models answer the same prompt in parallel, a 5th (judge) scores them and
 * picks the winner. The winning answer can be applied to the current chat in one tap.
 */

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function askModel(pid,mid,text,deadlineMs){
  const ses=await api('POST','/session',{title:'Arena · '+mid});
  const sid=ses.id;
  try{
    await api('POST','/session/'+sid+'/prompt_async',{messageID:O.mid(),agent:S.agent,model:{providerID:pid,modelID:mid},parts:[{type:'text',text}]},{timeout:30000});
    const deadline=Date.now()+(deadlineMs||240000);
    while(Date.now()<deadline){
      await sleep(1500);
      const st=await api('GET','/session/status',null,{timeout:5000}).catch(()=>null);
      const x=st&&st[sid],t=typeof x==='string'?x:(x&&x.type);
      if(!t||t==='idle'||t==='error')break;
    }
    const arr=await api('GET','/session/'+sid+'/message',null,{timeout:20000});
    let txt='';
    for(const m of arr||[])if(m.info&&m.info.role==='assistant'){
      const t2=(m.parts||[]).filter(p=>p.type==='text'&&!p.synthetic).map(p=>p.text).join('\n');
      if(t2.trim())txt=t2;
    }
    return {pid,mid,text:txt||'',ok:!!txt};
  }finally{
    try{await api('DELETE','/session/'+sid)}catch(_){}
  }
}

O.arenaPickFour=()=>{
  const all=O.allModels().filter(x=>!O.isModelHidden(x.pid+'/'+x.mid));
  // diversity: prefer different providers, mix fast + strong
  const byProv={};
  all.forEach(x=>{(byProv[x.pid]=byProv[x.pid]||[]).push(x)});
  const provs=Object.keys(byProv);
  const picked=[];
  // round-robin over providers, best model of each first
  provs.forEach(p=>byProv[p].sort((a,b)=>{
    const sa=(/(opus|pro|ultra|large|70b|405b)/i.test(a.mid)?2:0)+(/(flash|mini|lite|haiku)/i.test(a.mid)?1:0);
    const sb=(/(opus|pro|ultra|large|70b|405b)/i.test(b.mid)?2:0)+(/(flash|mini|lite|haiku)/i.test(b.mid)?1:0);
    return sb-sa;
  }));
  let round=0;
  while(picked.length<4&&round<8){
    for(const p of provs){
      if(byProv[p][round]&&!picked.some(x=>x.pid===p&&x.mid===byProv[p][round].mid)){
        picked.push(byProv[p][round]);
        if(picked.length>=4)break;
      }
    }
    round++;
  }
  // fill from the same providers if fewer than 4 providers exist
  if(picked.length<4){
    for(const x of all){
      if(picked.length>=4)break;
      if(!picked.some(y=>y.pid===x.pid&&y.mid===x.mid))picked.push(x);
    }
  }
  return picked.slice(0,4);
};

O.arenaJudge=()=>{
  const all=O.allModels().filter(x=>!O.isModelHidden(x.pid+'/'+x.mid));
  // strongest reasoning model as judge
  const score=x=>{
    const id=(x.mid+' '+x.name).toLowerCase();let n=0;
    if(/(opus|ultra|pro|max|large|405b|70b|o3|o4|gpt-5|claude-4|sonnet-4)/.test(id))n+=10;
    if(x.m&&(x.m.reasoning||x.m.variants))n+=4;
    const ctx=x.m&&x.m.limit&&x.m.limit.context||0;
    if(ctx>=200000)n+=2;
    return n;
  };
  return all.slice().sort((a,b)=>score(b)-score(a))[0]||null;
};

O.openArena=()=>{
  const body=h('div');
  const s=O.sheet(O.tr('Arena: 4 models + judge','Арена: 4 модели + судья'),body,{full:true});
  const promptInp=h('textarea',{rows:3,placeholder:O.tr('Task for all four models…','Задача для всех четырёх моделей…')});
  const four=O.arenaPickFour();
  const judge=O.arenaJudge();
  const chips=h('div',{style:{display:'flex',gap:'6px',flexWrap:'wrap',margin:'8px 0'}});
  four.forEach((x,i)=>chips.append(h('span',{class:'chip'},(i+1)+'. '+(x.name||x.mid))));
  if(judge)chips.append(h('span',{class:'chip',style:{borderColor:'var(--warn)'}},'⚖ '+(judge.name||judge.mid)));
  const status=h('div',{class:'mut s',style:{margin:'6px 0'}});
  const results=h('div');
  const runBtn=h('button',{class:'btn pri wide',onclick:async()=>{
    const text=promptInp.value.trim();
    if(!text)return O.toast(O.tr('Enter a task','Введите задачу'),2000);
    if(four.length<2)return O.toast(O.tr('Not enough models','Недостаточно моделей'),2500);
    runBtn.disabled=true;results.textContent='';
    status.textContent=O.tr('Asking 4 models in parallel…','Спрашиваю 4 модели параллельно…');
    const t0=Date.now();
    const answers=await Promise.all(four.map(x=>askModel(x.pid,x.mid,text).catch(e=>({pid:x.pid,mid:x.mid,text:'',ok:false,err:e.message}))));
    const good=answers.filter(a=>a.ok);
    status.textContent=O.tr('Answers: ','Ответов: ')+good.length+'/'+answers.length+' · '+((Date.now()-t0)/1000).toFixed(0)+'s';
    // render each answer
    answers.forEach((a,i)=>{
      const card=h('div',{class:'settings-card',style:{padding:'10px 12px',marginBottom:'8px'}},
        h('b',{style:{fontSize:'12.5px'}},(i+1)+'. '+(four[i].name||four[i].mid)),
        h('div',{style:{whiteSpace:'pre-wrap',fontSize:'13px',marginTop:'6px',maxHeight:'30vh',overflow:'auto'}},a.ok?a.text:(a.err||O.tr('(no answer)','(нет ответа)'))));
      results.append(card);
    });
    if(good.length<2||!judge){runBtn.disabled=false;return}
    // judge
    status.textContent=O.tr('Judge is scoring…','Судья оценивает…');
    const judgePrompt='Ты — строгий судья. Ниже задача и '+good.length+' ответа разных моделей. Оцени каждый по шкале 0-10 (точность, полнота, практичность) и выбери ЛУЧШИЙ. Ответь СТРОГО в формате JSON: {"scores":[{"n":1,"score":9,"why":"..."}],"winner":2,"reason":"..."}.\n\nЗАДАЧА:\n'+text+'\n\n'+good.map((a,i)=>'ОТВЕТ '+(answers.indexOf(a)+1)+' ('+a.mid+'):\n'+a.text.slice(0,6000)).join('\n\n---\n\n');
    let verdict=null;
    try{
      const jr=await askModel(judge.pid,judge.mid,judgePrompt,180000);
      const m=jr.text.match(/\{[\s\S]*\}/);
      if(m)verdict=JSON.parse(m[0]);
    }catch(e){status.textContent=O.tr('Judge failed: ','Судья не смог: ')+(e.message||e)}
    if(verdict){
      const winIdx=(verdict.winner||1)-1;
      const winner=answers[winIdx]&&answers[winIdx].ok?answers[winIdx]:good[0];
      const vcard=h('div',{class:'settings-card',style:{padding:'12px',borderColor:'var(--warn)',marginBottom:'8px'}},
        h('b',null,'⚖ '+O.tr('Judge verdict','Вердикт судьи')+' — '+(judge.name||judge.mid)),
        h('div',{style:{marginTop:'6px',fontSize:'13px'}},verdict.reason||''),
        h('div',{style:{display:'flex',gap:'6px',flexWrap:'wrap',marginTop:'8px'}},
          (verdict.scores||[]).map(sc=>h('span',{class:'chip'},'#'+sc.n+': '+sc.score+'/10'))),
        h('div',{style:{display:'flex',gap:'8px',marginTop:'10px'}},
          h('button',{class:'btn pri grow',onclick:()=>{
            // apply the winning answer into the current chat as an assistant-style message
            if(!S.sid){O.toast(O.tr('Open a chat first','Сначала откройте чат'),2000);return}
            const mid=O.mid();
            const mm=O.upsertMsg({id:mid,sessionID:S.sid,role:'assistant',time:{created:Date.now(),completed:Date.now()},modelID:winner.mid,providerID:winner.pid});
            mm.parts=[{id:'prt_arena',sessionID:S.sid,messageID:mid,type:'text',text:'🏆 '+O.tr('Arena winner','Победитель арены')+' ('+winner.mid+'):\n\n'+winner.text}];
            bus.emit('msg',S.sid,mm);
            O.toast(O.tr('Winner applied to the chat','Победитель добавлен в чат'),2500);
            s.close();O.setTab('chat');
          }},O.icon('check'),O.tr('Apply winner','Применить победителя')),
          h('button',{class:'btn grow',onclick:()=>{O.native.copy(winner.text)}},O.icon('copy'),O.tr('Copy','Копировать'))));
      results.prepend(vcard);
      status.textContent=O.tr('Done · winner: ','Готово · победитель: ')+winner.mid;
    }
    runBtn.disabled=false;
  }},O.icon('zap'),O.tr('Run arena','Запустить арену'));
  body.append(h('div',{class:'note'},O.tr('Four models answer in parallel; a fifth (the strongest) scores them and picks the winner. The winner can be applied to your chat.','Четыре модели отвечают параллельно; пятая (самая сильная) оценивает и выбирает победителя. Победителя можно применить в чат.')),
    promptInp,chips,runBtn,status,results);
};

})();
