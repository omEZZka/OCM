(function(){
const O=window.OCM,h=O.h;
const PROVIDERS={
  github:{name:'GitHub Actions',icon:'github',hint:'Полная поддержка workflow и APK-artifacts',base:'https://api.github.com'},
  gitlab:{name:'GitLab CI',icon:'git',hint:'Pipeline через Project Access Token',base:'https://gitlab.com/api/v4'},
  bitbucket:{name:'Bitbucket Pipelines',icon:'git',hint:'Pipeline через App Password/API token',base:'https://api.bitbucket.org/2.0'},
  circleci:{name:'CircleCI',icon:'refresh',hint:'Pipeline через Personal API token',base:'https://circleci.com/api/v2'},
  azure:{name:'Azure DevOps',icon:'cloud',hint:'Build pipeline через PAT',base:'https://dev.azure.com'},
  codemagic:{name:'Codemagic',icon:'cpu',hint:'Мобильная сборка через API token',base:'https://api.codemagic.io'},
  bitrise:{name:'Bitrise',icon:'cpu',hint:'Мобильная сборка через Personal Access Token',base:'https://api.bitrise.io'},
  googlecloud:{name:'Google Cloud Build',icon:'cloud',hint:'Service Account token и проект GCP',base:'https://cloudbuild.googleapis.com'}
};
O.ci=O.ci||{};
O.ciProviders=()=>Object.keys(PROVIDERS).map(id=>Object.assign({id},PROVIDERS[id]));
O.ciState=()=>{try{return JSON.parse(OC.ciState())}catch{return{}}};
O.ciRequest=(provider,method,path,body)=>new Promise((resolve,reject)=>{
  const id='ci_'+Date.now()+'_'+Math.random().toString(36).slice(2);
  const fn=e=>{if(!e||e.id!==id)return;O.offCi&&O.offCi(fn);if(e.error)reject(new Error(e.error));else if(e.status>=200&&e.status<300)resolve(e.body||{});else reject(new Error(e.body&&e.body.message||('HTTP '+e.status)))};
  O.onCi=O.onCi||[];O.onCi.push(fn);
  try{OC.ciRequest(id,provider,method,path,body?JSON.stringify(body):'')}catch(e){reject(e)}
  setTimeout(()=>{const i=(O.onCi||[]).indexOf(fn);if(i>=0)(O.onCi||[]).splice(i,1);reject(new Error('timeout'))},45000);
});
O.ciToken=async(provider)=>{try{const r=O.ciState();return r[provider]&&r[provider].connected}catch{return false}};

function row(id,connected,draw){
  const p=PROVIDERS[id];
  return O.listRow(p.icon,p.name,connected?'Токен сохранён · нажмите для управления':p.hint,
    connected?O.icon('check','ok'):O.icon('chevR'),()=>openProvider(id,draw));
}
O.openRemoteBuilds=()=>{
  const body=h('div'),s=O.sheet('Удалённая сборка',body,{full:true});
  const draw=()=>{body.textContent='';const st=O.ciState();
    body.append(h('div',{class:'note'},'Подключите CI-сервис токеном. Полностью безлимитных бесплатных сервисов нет: лимиты зависят от тарифа, public/private репозитория и раннера. Для OCM нужен Docker или Linux runner.'));
    const card=h('div',{class:'settings-card'});Object.keys(PROVIDERS).forEach(id=>card.append(row(id,!!st[id]&&st[id].connected,draw)));body.append(card);
    body.append(h('button',{class:'btn pri wide',style:{marginTop:'12px'},onclick:()=>openBuild(s)},O.icon('play'),'Запустить удалённую сборку'));
  };draw();
};
async function openProvider(id,draw){
  const p=PROVIDERS[id],state=O.ciState()[id]||{};
  const inp=h('input',{type:'password',class:'mono',placeholder:state.connected?'Токен уже сохранён':'Вставьте токен'}); 
  const status=h('div',{class:'note',style:{margin:'8px 0'}},state.connected?'Токен сохранён локально в профиле OCM.':'Токен не подключён.');
  const s=O.sheet(p.name,h('div',null,
    h('div',{class:'note'},p.hint),h('div',{class:'field'},h('label',null,'Personal/API token'),inp),status,
    h('button',{class:'btn pri wide',onclick:async()=>{const token=inp.value.trim();if(!token){O.toast('Введите токен');return}try{await new Promise((res,rej)=>{const sid='ci_save_'+Date.now();const f=e=>{if(!e||e.id!==sid)return;const i=(O.onCiSave||[]).indexOf(f);if(i>=0)(O.onCiSave||[]).splice(i,1);e.ok?res():rej(new Error(e.error||'Не удалось сохранить'))};(O.onCiSave=O.onCiSave||[]).push(f);OC.ciSaveToken(sid,provider,token)});O.toast('Токен сохранён');s.close();draw()}catch(e){O.toast(e.message)}}},O.icon('key'),'Сохранить токен'),
    h('button',{class:'btn wide',style:{marginTop:'8px'},onclick:async()=>{try{const r=await O.ciRequest(id,'GET',id==='github'?'/user':id==='gitlab'?'/user':id==='bitbucket'?'/user':id==='circleci'?'/me':'/');status.textContent='Подключено'+(r.login?' как '+r.login:'');O.toast('Подключение работает')}catch(e){status.textContent='Ошибка: '+e.message;O.toast(e.message)}}},O.icon('check'),'Проверить подключение'),
    state.connected?h('button',{class:'btn dng wide',style:{marginTop:'8px'},onclick:()=>{OC.ciClearToken(id);s.close();draw()}},'Отключить'):null),{hud:true});
}
// ---- wire native responses ----
O.on('ci-resp',d=>{
  const list=O.onCi||[];
  const fn=list.find(f=>f&&d&&f.id===d.id);
  if(fn){const i=list.indexOf(fn);if(i>=0)list.splice(i,1);fn(d)}
});
O.on('ci-save',d=>{
  const list=O.onCiSave||[];
  list.forEach(f=>{try{f(d)}catch(_){}});
});
function openBuild(parent){
  const st=O.ciState(),available=Object.keys(PROVIDERS).filter(x=>st[x]&&st[x].connected);
  const provider=h('select');available.forEach(id=>provider.append(h('option',{value:id},PROVIDERS[id].name)));
  const repo=h('input',{placeholder:'owner/repository или URL репозитория'}),ref=h('input',{value:'main',placeholder:'Ветка'});
  const status=h('div',{class:'note',style:{marginTop:'10px'}});
  const s=O.sheet('Запустить сборку',h('div',null,
    available.length?null:h('div',{class:'errbox'},'Сначала подключите хотя бы один CI-сервис.'),
    h('div',{class:'field'},h('label',null,'Сервис'),provider),
    h('div',{class:'field'},h('label',null,'Репозиторий'),repo),
    h('div',{class:'field'},h('label',null,'Ветка / ref'),ref),status,
    h('button',{class:'btn pri wide',onclick:async()=>{if(!available.length)return;const id=provider.value,r=repo.value.trim(),b=ref.value.trim()||'main';if(!r){O.toast('Укажите репозиторий');return}status.textContent='Запускаю...';try{let out;
      if(id==='github'){const [owner,name]=r.replace(/^https?:\/\/github\.com\//,'').replace(/\.git$/,'').split('/');out=await O.ciRequest(id,'POST','/repos/'+owner+'/'+name+'/actions/workflows/build.yml/dispatches',{ref:b});}
      else if(id==='gitlab'){const project=encodeURIComponent(r.replace(/^https?:\/\/gitlab\.com\//,'').replace(/\.git$/,''));out=await O.ciRequest(id,'POST','/projects/'+project+'/pipeline',{ref:b});}
      else if(id==='bitbucket'){const [workspace,name]=r.replace(/^https?:\/\/bitbucket\.org\//,'').replace(/\.git$/,'').split('/');out=await O.ciRequest(id,'POST','/repositories/'+workspace+'/'+name+'/pipelines/',{target:{type:'pipeline_ref_target',ref_type:'branch',ref_name:b}});}
      else if(id==='circleci'){const slug=r.startsWith('gh/')||r.startsWith('bb/')?r:'gh/'+r;out=await O.ciRequest(id,'POST','/project/'+slug+'/pipeline',{branch:b});}
      else throw new Error('Для этого сервиса укажите pipeline/app ID в его настройках провайдера');
      status.textContent='Сборка запущена. '+JSON.stringify(out).slice(0,240);O.toast('Сборка запущена');
    }catch(e){status.textContent='Ошибка: '+e.message;O.toast(e.message,4000)}}},O.icon('play'),'Запустить')),{hud:true});
}
})();
