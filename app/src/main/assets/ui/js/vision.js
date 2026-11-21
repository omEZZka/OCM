(function(){
const O=window.OCM,h=O.h,S=O.S,api=O.api,bus=O.bus;
// ---- vision pipeline: make the agent actually SEE images ----
// 1) phone shot → the screenshot lands as a real attachment on the next prompt
// 2) phone see  → screenshot + immediate analysis by a vision model, text back to the CLI
// 3) file viewer "Analyze" button for any image on disk
// 4) blind models: image attachments auto-convert to OCR text + vision-model description

// Pending screenshots captured by the agent mid-turn: they ride along the NEXT prompt.
O.visionQueue=O.visionQueue||[];
O.queueVision=async(path,note)=>{
  try{
    const f=await O.native.readDataUrl(path);
    if(!f||!f.mime||!f.mime.startsWith('image/'))return false;
    O.visionQueue.push({type:'file',mime:f.mime,filename:O.basename(path),url:'data:'+f.mime+';base64,'+f.data,
      source:{type:'file',path,text:{value:'@'+O.basename(path),start:0,end:0}},_note:note||''});
    if(O.visionQueue.length>4)O.visionQueue.shift();
    bus.emit('visionQueue');
    return true;
  }catch(_){return false}
};
O.takeVisionQueue=()=>{const q=O.visionQueue.slice();O.visionQueue.length=0;bus.emit('visionQueue');return q};

// Does the CURRENT model see images?
O.modelSees=()=>{
  if(!S.model)return false;
  const caps=O.modelCapsOf?O.modelCapsOf(S.model.providerID,S.model.modelID):null;
  if(caps&&caps.images===true)return true;
  if(caps&&caps.images===false)return false;
  const mi=O.modelInfo(S.model.providerID,S.model.modelID);
  return !!(mi&&mi.attachment!==false);
};
// Best vision-capable model available (current first, then any with images:true).
O.visionModel=()=>{
  if(O.modelSees())return S.model;
  const all=O.allModels?O.allModels():[];
  for(const x of all){
    if(O.isModelHidden&&O.isModelHidden(x.pid+'/'+x.mid))continue;
    const caps=O.modelCapsOf?O.modelCapsOf(x.pid,x.mid):null;
    if(caps&&caps.images===true)return{providerID:x.pid,modelID:x.mid};
  }
  return null;
};
// Describe an image with a vision model in a throwaway session; returns text (or '').
O.describeImage=async(dataUrl,question)=>{
  const vm=O.visionModel();
  if(!vm)return '';
  const ses=await api('POST','/session',{title:'OCM side task'},{dir:false});
  try{if(window.OC&&OC.silentSession)OC.silentSession(ses.id)}catch(_){}
  try{
    const q=question||'Опиши изображение подробно: что видно, весь текст дословно, ключевые детали. По-русски.';
    await api('POST','/session/'+ses.id+'/prompt_async',{messageID:O.mid(),model:vm,parts:[
      {type:'text',text:q},
      {type:'file',mime:'image/png',filename:'image.png',url:dataUrl}
    ]},{timeout:30000,dir:false});
    const deadline=Date.now()+120000;
    while(Date.now()<deadline){
      await new Promise(r=>setTimeout(r,1500));
      const st=await api('GET','/session/status',null,{timeout:5000,dir:false}).catch(()=>null);
      const t0=st&&st[ses.id],t=typeof t0==='string'?t0:(t0&&t0.type);
      if(!t||t==='idle'||t==='error')break;
    }
    const arr=await api('GET','/session/'+ses.id+'/message',null,{timeout:15000,dir:false});
    let txt='';
    for(const mm of arr||[])if(mm.info&&mm.info.role==='assistant'){const t2=(mm.parts||[]).filter(p=>p.type==='text').map(p=>p.text).join('\n');if(t2.trim())txt=t2}
    return txt.trim();
  }finally{try{await api('DELETE','/session/'+ses.id,null,{dir:false})}catch(_){}}
};
// Full fallback for a blind model: OCR (on-device) + vision description (side model).
O.imageToText=async att=>{
  const chunks=[];
  try{
    if(O.ocrAttachment){
      const t=await O.ocrAttachment(att);
      if(t&&t.trim())chunks.push('[OCR текст с изображения '+att.filename+']:\n'+t.trim().slice(0,6000));
    }
  }catch(_){}
  try{
    const d=await O.describeImage(att.url);
    if(d)chunks.push('[Описание изображения '+att.filename+' от vision-модели]:\n'+d.slice(0,6000));
  }catch(_){}
  return chunks.join('\n\n');
};
// ---- phone shot: after the agent takes a screenshot, queue it for its next turn ----
O.on('phoneRequest',async d=>{
  if(!d||!d.id)return;
  const cmd=String(d.cmd||'').toLowerCase();
  if(cmd!=='shot'&&cmd!=='screenshot')return;
  // the main handler in phone.js answers the CLI; we only piggyback the result AFTER it lands
  const off=O.on('phoneResult',async r=>{
    if(!r||r.id!==d.id)return;
    off();
    let path='';
    try{const j=typeof r.result==='string'?JSON.parse(r.result):r.result;path=(j&&(j.path||j.dest))||''}catch(_){}
    if(!path&&d.args&&d.args[0])path=String(d.args[0]);
    if(!path)return;
    const ok=await O.queueVision(path,'screenshot');
    if(ok)O.toast(O.tr('Screenshot will be attached to your next message','Скриншот приложится к следующему сообщению'),2200);
  });
  // safety: detach the piggyback listener if the result never comes
  setTimeout(()=>{try{off()}catch(_){}},35000);
});
// ---- phone see: dedicated CLI command handled HERE (phone.js passes unknown cmds through) ----
O.on('phoneRequest',async d=>{
  if(!d||!d.id||String(d.cmd||'').toLowerCase()!=='see')return;
  try{
    // 1) take the screenshot via the async bridge
    const dest='/sdcard/Download/OCM/screens/see_'+Date.now()+'.png';
    const shot=await O.phone.async('shot',[dest]);
    const path=(shot&&(shot.path||shot.dest))||dest;
    if(!shot||shot.ok===false){O.phone.answer(d.id,{ok:false,err:(shot&&shot.err)||'screenshot failed'});return}
    // 2) read bytes
    const f=await O.native.readDataUrl(path);
    const dataUrl='data:'+f.mime+';base64,'+f.data;
    // 3) analyze with a vision model
    const question=(d.args&&d.args[0])||'';
    const desc=await O.describeImage(dataUrl,question||undefined);
    if(desc){O.phone.answer(d.id,{ok:true,path,description:desc});return}
    // 4) no vision model: OCR fallback
    let ocr='';
    try{ocr=await O.ocrAttachment({url:dataUrl})}catch(_){}
    O.phone.answer(d.id,{ok:true,path,description:ocr||'(no vision model connected; screenshot saved)',ocr:!!ocr});
  }catch(e){O.phone.answer(d.id,{ok:false,err:e.message||String(e)})}
});
// ---- file viewer: Analyze button for images ----
O.analyzeImageFile=async abs=>{
  try{
    const f=await O.native.readDataUrl(abs);
    if(!f||!f.mime||!f.mime.startsWith('image/'))return O.toast(O.tr('Not an image','Это не изображение'),2000);
    const att={type:'file',mime:f.mime,filename:O.basename(abs),url:'data:'+f.mime+';base64,'+f.data,
      source:{type:'file',path:abs,text:{value:'@'+O.basename(abs),start:0,end:0}}};
    if(O.modelSees()){
      // vision model: attach directly and let the user ask
      if(O.chatAttachVision)O.chatAttachVision([att]);
      O.setTab('chat');
      O.toast(O.tr('Image attached — ask the agent about it','Картинка приложена — спросите агента о ней'),2500);
      return;
    }
    // blind model: convert to text right away
    O.toast(O.tr('Model cannot see images — extracting text…','Модель не видит картинки — извлекаю текст…'),2500);
    const txt=await O.imageToText(att);
    if(txt){
      O.insertPrompt('[Изображение '+O.basename(abs)+']\n'+txt+'\n\n');
      O.setTab('chat');
      O.toast(O.tr('Image converted to text — add your question','Картинка превращена в текст — добавьте вопрос'),2500);
    }else O.toast(O.tr('No text extracted and no vision model','Текст не извлечён и нет vision-модели'),3000);
  }catch(e){O.toast(e.message||String(e),3000)}
};
// ---- blind-model auto-fallback on send: convert image attachments to text parts ----
O.visionFallbackParts=async(atts,parts)=>{
  if(O.modelSees())return;
  for(const a of atts){
    if(!String(a.mime||'').startsWith('image/'))continue;
    if(a._ocr)continue; // manual OCR already rides along
    try{
      const txt=await O.imageToText(a);
      if(txt)parts.push({type:'text',text:txt,synthetic:true});
    }catch(_){}
  }
};
})();