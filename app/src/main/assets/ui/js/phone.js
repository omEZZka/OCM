(function(){
const O=window.OCM;

// ---------- native wrappers ----------
const pend=new Map();let seq=0;
O.on('phoneResult',d=>{
  const p=pend.get(d.id);if(!p)return;pend.delete(d.id);clearTimeout(p.timer);
  try{p.res(JSON.parse(d.result||'{}'))}catch(e){p.rej(e)}
});
function phoneAsync(cmd,args){
  return new Promise((res,rej)=>{
    const id='pa'+(++seq)+'_'+Date.now().toString(36);
    const timer=setTimeout(()=>{if(pend.delete(id))rej(new Error('timeout'))},30000);
    pend.set(id,{res,rej,timer});
    try{OC.phoneCommandAsync(id,cmd,JSON.stringify(args||[]))}catch(e){clearTimeout(timer);pend.delete(id);rej(e)}
  });
}
function phoneSync(cmd,args){
  try{return JSON.parse(OC.phoneCommand(cmd,JSON.stringify(args||[]))||'{}')}catch(e){return{ok:false,err:String(e)}}
}
O.phone={
  status:()=>{try{return JSON.parse(OC.phoneStatus()||'{}')}catch(_){return{}}},
  cmd:phoneSync,
  async:phoneAsync,
  enableAccessibility:()=>{try{OC.phoneEnableAccessibility()}catch(_){}},
  grantOverlay:()=>{try{OC.phoneGrantOverlay()}catch(_){}},
  grantDnd:()=>{try{OC.phoneGrantDnd()}catch(_){}},
  grantWrite:()=>{try{OC.phoneGrantWriteSettings()}catch(_){}},
  serverStart:()=>{try{OC.phoneServerStart()}catch(_){}},
  serverStop:()=>{try{OC.phoneServerStop()}catch(_){}},
  answer:(id,payload)=>{try{OC.phoneAnswer(id,JSON.stringify(payload||{}))}catch(_){}}
};

// ---------- agent → phone (PhoneServer, the `phone` CLI) ----------
O.on('phoneRequest',async d=>{
  if(!d||!d.id)return;
  const cmd=String(d.cmd||'');
  const args=[];const arr=d.args||[];
  for(let i=0;i<arr.length;i++)args.push(String(arr[i]));
  // confirm dangerous commands unless the user allowed silent agent control
  const silent=O.store.get('phone.agentSilent',false);
  const dangerous=['tap','swipe','text','type','longpress'];
  if(!silent&&dangerous.includes(cmd)){
    const ok=await O.confirm(O.tr('Agent wants to control the phone','Агент хочет управлять телефоном'),
      cmd+' '+args.join(' '),O.tr('Allow','Разрешить'));
    if(!ok){O.phone.answer(d.id,{ok:false,err:'declined'});return}
  }
  try{
    let r;
    if(cmd==='see'){
      // vision.js owns 'see' (screenshot + immediate analysis); it answers the CLI itself
      return;
    }
    if(['tap','longpress','swipe','text','type','screen','shot','screenshot','find','scroll','waittext'].includes(cmd)){
      r=await phoneAsync(cmd,args);
    }else{
      r=phoneSync(cmd,args);
    }
    O.phone.answer(d.id,r||{ok:false});
  }catch(e){O.phone.answer(d.id,{ok:false,err:e.message||String(e)})}
});

// start the phone bridge lazily
setTimeout(()=>{try{O.phone.serverStart()}catch(_){}},3500);

})();