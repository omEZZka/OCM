(function(){
const O=window.OCM,h=O.h;let el=null,entered=false,permsRender=null,waitT=null;
const screen=(...k)=>{if(!el){el=h('div',{id:'boot'});document.body.append(el)}el.textContent='';el.append(h('div',{class:'center'},...k.flat()));return el};
O.bootHide=()=>{if(el){el.remove();el=null}};
const logo=()=>[O.logo(44),h('b',{style:{fontSize:'22px'}},'OpenCode')];
function login(msg){
  const st=O.native.state();
  let em=null,gb=null,gbtn=null;
  const goEmail=()=>{const v=em.value.trim();if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)){O.toast('Введите корректный email');return}gb.disabled=true;OC.signInEmail(v)};
  const emailBox=h('div',{style:{width:'100%',display:'flex',gap:'6px'}},
    em=h('input',{type:'email',placeholder:'ваша@почта.ru',autocapitalize:'off',autocorrect:'off',style:{flex:1},onkeydown:e=>{if(e.key==='Enter')goEmail()}}),
    gb=h('button',{class:'btn pri',onclick:goEmail},'Создать'));
  if(st.user){
    // a profile exists on this phone: continue with it, or spin up another guest
    screen(logo(),
      h('b',{style:{fontSize:'20px'}},'Профиль на этом телефоне'),
      h('button',{class:'btn pri wide',onclick:next},'Продолжить как '+(st.name||st.user)),
      h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:()=>OC.signInGuest(true)},O.icon('user'),'Новый профиль гостя'),
      h('div',{class:'note',style:{margin:'10px 0'}},'Новому гостю создастся свой случайный ник, пароль и отдельный профиль.'),
      h('span',{class:'mut s'},'v'+st.version));
    return}
  screen(logo(),
    h('b',{style:{fontSize:'20px'}},'Профиль на этом телефоне'),
    h('p',{class:'mut'},msg||'Чаты, файлы и ключи хранятся только на этом телефоне. Гостю ник и пароль создаются автоматически.'),
    gbtn=h('button',{class:'btn pri wide',onclick:()=>{gbtn.disabled=true;OC.signInGuest(false)}},O.icon('user'),'Продолжить как гость'),
    h('div',{class:'note',style:{margin:'10px 0'}},'У каждого гостя — свой случайный ник и пароль, свой профиль и своя бесплатная квота. Никто не сидит на общем аккаунте.'),
    h('details',{style:{width:'100%'}},
      h('summary',{class:'mut',style:{cursor:'pointer',padding:'6px 0'}},'Войти по почте (не Google)'),
      h('p',{class:'mut s'},'Почта нужна только для имени профиля. Пароль не требуется, данные не покидают телефон.'),
      emailBox),
    st.googleConfigured?h('button',{class:'btn wide',style:{marginTop:'10px'},onclick:()=>OC.signIn()},O.icon('user'),'Войти через Google'):null,
    h('span',{class:'mut s',style:{marginTop:'10px'}},'Бесплатные модели работают сразу. Личную квоту Zen можно подключить позже: Настройки → Аккаунт opencode.'),
    h('span',{class:'mut s'},'v'+st.version))}
function perms(){const render=()=>{const rows=O.permRows();const box=el&&el.querySelector('#pl');if(box){box.textContent='';box.append(...rows)}};permsRender=render;
  screen(h('div',{style:{textAlign:'left',width:'100%'}},h('b',{style:{fontSize:'20px'}},'Разрешения'),h('p',{class:'mut'},'OpenCode нужны эти разрешения, чтобы работать как терминальным агентом на компьютере.'),h('div',{id:'pl'},...O.permRows()),
    h('button',{class:'btn pri wide',style:{marginTop:'14px'},onclick:()=>{O.store.set('permsSeen',true);permsRender=null;next()}},'Продолжить')))}
let inst=null;
function install(){const bar=h('i'),msg=h('p',{class:'mut'},'Распаковываем Linux-окружение. Это происходит один раз.'),err=h('p',{class:'err'});
  inst={bar,msg,err};screen(logo(),msg,h('div',{class:'bar',style:{width:'100%'}},bar),err);OC.install()}
O.on('install',d=>{if(!inst||!el)return;
  if(d&&d.done){try{const st=O.native.state();if(st.assetStamp)O.store.set('runtime.stamp',st.assetStamp)}catch(_){}}
  if(d.error){inst.msg.textContent='Установка не удалась';inst.err.textContent=d.error;
    if(!el.querySelector('.retry'))el.firstChild.append(h('button',{class:'btn retry',onclick:install},O.icon('refresh'),'Повторить'));
    if(!el.querySelector('.reset'))el.firstChild.append(h('button',{class:'btn reset',style:{marginTop:'8px'},onclick:()=>OC.resetInstall()},O.icon('trash'),'Сбросить и установить заново'))}
  else if(d.done){inst=null;start()}else inst.bar.style.width=d.pct+'%'});
const PHASES={proxy:['Готовим прокси','Preparing proxy'],starting:['Запускаем ядро OpenCode','Starting the OpenCode core'],waiting:['Ждём ответа сервера','Waiting for the server'],ready:['Готово','Ready'],down:['Сервер остановлен','Server stopped'],idle:['Запуск OpenCode','Starting OpenCode']};
function paintPhase(ph){
  const p=el&&el.querySelector('.boot-phase');if(!p)return;
  const t=PHASES[ph]||PHASES.idle;
  p.textContent=O.tr(t[1],t[0]);
  const steps=['proxy','starting','waiting','ready'];
  const i=steps.indexOf(ph);
  const bar=el&&el.querySelector('.boot-steps');
  if(bar)bar.querySelectorAll('i').forEach((d,k)=>d.classList.toggle('on',k<=i));
}
function start(){
  const msg=h('p',{class:'mut boot-phase'},O.tr('Starting OpenCode','Запуск OpenCode')),err=h('p',{class:'err'}),extra=h('div');
  const spin=h('span',{class:'spin'});
  const steps=h('div',{class:'boot-steps'},['i','i','i','i'].map(()=>h('i')));
  screen(logo(),h('div',{style:{display:'flex',gap:'8px',alignItems:'center'}},spin,msg),steps,err,extra);
  paintPhase('proxy');
  OC.start();clearTimeout(waitT);
  waitT=setTimeout(()=>{
    if(el&&!entered){
      extra.append(
        h('button',{class:'btn wide',onclick:()=>{O.bootHide();entered=true;O.enter({offline:true})}},O.icon('doc'),'Читать кэшированные чаты, пока идёт запуск'),
        h('button',{class:'btn wide',style:{marginTop:'8px'},onclick:()=>{
          if(spin)spin.remove();
          msg.textContent='Сброс конфигурации...';
          if(window.OC&&OC.resetConfig)OC.resetConfig();else if(window.OC&&OC.restartServer)OC.restartServer();
        }},O.icon('refresh'),'Сбросить конфигурацию и перезапустить')
      );
    }
  },4000);
}
function next(){const st=O.native.state(),p=st.perms||{};
  if(!O.store.get('permsSeen')&&!(p.notifications&&p.files&&p.battery&&p.install))return perms();
  // A bundled runtime that differs from the installed one (new offset, new core) must be re-extracted:
  // otherwise the app keeps launching an old rootfs against a new server contract and "cannot connect".
  let stale=false;
  try{
    const idx=O.store.get('runtime.stamp','');
    stale=!!st.assetStamp&&idx&&idx!==st.assetStamp;
  }catch(_){}
  if(stale){O.store.remove('runtime.stamp');return install()}
  if(!st.installed)return install();start()}
O.on('signin',d=>{if(!el)return;d.ok?next():login(d.error||'Не удалось войти')});
O.on('perms',()=>{if(permsRender)permsRender()});
O.on('phase',d=>{if(el&&d&&d.phase)paintPhase(d.phase)});
O.on('boot',d=>{
  if(!el)return;
  const e=el.querySelector('.err');
  if(e)e.textContent=d.error;
  const sp=el.querySelector('.spin');
  if(sp)sp.remove();
  const m=el.querySelector('.mut');
  if(m)m.textContent='Ошибка запуска сервера';
  if(!el.querySelector('.retry')){
    el.firstChild.append(
      h('button',{class:'btn retry pri wide',style:{marginTop:'10px'},onclick:start},O.icon('refresh'),'Повторить запуск'),
      h('button',{class:'btn wide',style:{marginTop:'8px'},onclick:()=>{if(window.OC&&OC.resetConfig)OC.resetConfig();start()}},O.icon('trash'),'Сбросить конфигурацию и запустить')
    );
  }
});
O.on('ready',()=>{clearTimeout(waitT);O.bootHide();if(!entered){entered=true;O.enter()}else O.reconnect()});
O.bootRun=()=>{const st=O.native.state();
  if(st.ready&&st.user&&st.installed){entered=true;O.enter();return}
  if(st.user)return next();
  login()};
})();
