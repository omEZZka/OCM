import subprocess, time, sys, json, os
UITEST_DIR=os.environ.get('UITEST_DIR','/tmp/uitest')
from playwright.sync_api import sync_playwright
srv=subprocess.Popen([sys.executable,'-m','http.server','8765','--directory',UITEST_DIR],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(0.8)
mock=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'mock.js')).read()
res=[];errs=[]
def chk(n,c):
    res.append((n,bool(c)));print(('PASS ' if c else 'FAIL ')+n)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(args=["--no-sandbox"])
    ctx=b.new_context(viewport={"width":390,"height":780},device_scale_factor=2,has_touch=True,is_mobile=True)
    pg=ctx.new_page()
    pg.on('pageerror',lambda e:errs.append('pageerror: '+str(e)))
    pg.on('console',lambda m:errs.append('console.'+m.type+': '+m.text) if m.type=='error' else None)
    pg.add_init_script(mock)
    pg.add_init_script("try{localStorage.setItem('ocm.tourSeen','true')}catch(e){}")
    pg.goto('http://127.0.0.1:8765/index.html')
    pg.wait_for_selector('#top',timeout=8000)
    pg.wait_for_function("document.querySelector('#top .top-title-txt')&&document.querySelector('#top .top-title-txt').textContent!==''",timeout=5000)
    pg.wait_for_timeout(500)
    chk('app shell built',pg.query_selector('#bottom-bar')!=None)
    chk('top title present',len(pg.inner_text('#top .top-title-txt'))>0)
    chk('empty state shown',pg.query_selector('#msgs .empty')!=None)
    chk('model chip default','Big Pickle' in pg.inner_text('#composer'))
    pg.screenshot(path=os.environ.get('SHOTS','/tmp')+'/s1_empty.png')
    # ---- Media capability filtering (pure helpers, no provider calls) ----
    media=pg.evaluate("""() => {
      const raw={data:[
        {id:'gpt-4o',architecture:{input_modalities:['text','image'],output_modalities:['text']},endpoints:['/chat/completions']},
        {id:'vendor/image',name:'Pretty Image',architecture:{output_modalities:['image']},endpoints:['/images/generations']},
        {id:'gpt-image-1'},
        {id:'vendor/video',architecture:{output_modalities:['video']},endpoints:['/videos']},
        {id:'tts-1'},
        {id:'unknown-chat-model'}
      ]};
      const image=OCM.mediaDebug.support(raw,'image',{kind:'image',baseURL:'https://example.test/v1'});
      const video=OCM.mediaDebug.support(raw,'video',{kind:'video',baseURL:'https://example.test/v1'});
      return {image:image.compatible.map(x=>x.id),video:video.compatible.map(x=>x.id),
        unknown:image.unknown.map(x=>x.id),
        url:OCM.mediaDebug.url('https://example.test/v1/','images/generations'),
        models:OCM.mediaDebug.discovery({baseURL:'https://example.test/v1/models',kind:'image'}),
        orImage:OCM.mediaDebug.endpoint({baseURL:'https://openrouter.ai/api/v1',kind:'image'}),
        body:OCM.mediaDebug.body({kind:'image'},{model:'vendor/image',prompt:'fox',n:'2',size:'1024x1024'})};
    }""")
    chk('media filters chat-only and vision-input models',media['image']==['vendor/image','gpt-image-1'])
    chk('media filters per output kind',media['video']==['vendor/video'])
    chk('media keeps unknown models out of automatic import','unknown-chat-model' in media['unknown'])
    chk('media joins base URL without double slashes',media['url']=='https://example.test/v1/images/generations')
    chk('media accepts a pasted models URL',media['models']=='https://example.test/v1/models')
    chk('OpenRouter image endpoint',media['orImage']=='https://openrouter.ai/api/v1/images')
    chk('media payload has real id and numeric count',media['body']['model']=='vendor/image' and media['body']['n']==2 and 'response_format' not in media['body'])
    # ---- send a prompt ----
    pg.fill('#composer textarea','refactor main.py')
    pg.click('#send')
    pg.wait_for_selector('.msg.assistant .part.p-text',timeout=5000)
    pg.wait_for_selector('.tool.completed',timeout=5000)
    pg.wait_for_selector('#dock .hud-dock-card',timeout=5000)
    pg.wait_for_timeout(500)
    sent=[c for c in pg.evaluate("__srv.calls") if c['p'].endswith('prompt_async')]
    chk('prompt_async posted',len(sent)==1)
    body=sent[0]['body'] if sent else {}
    chk('prompt has messageID msg_',str(body.get('messageID','')).startswith('msg_'))
    chk('prompt has model object',body.get('model',{}).get('modelID')=='big-pickle')
    chk('prompt agent build',body.get('agent')=='build')
    chk('prompt text part',body.get('parts',[{}])[0].get('text')=='refactor main.py')
    chk('directory param added',all('directory=' in c['q'] for c in pg.evaluate("__srv.calls") if c['p']=='/session' and c['method']=='GET'))
    chk('single user bubble (optimistic replaced)',pg.locator('.msg.user').count()==1)
    chk('user text',pg.inner_text('.msg.user .m-body').strip()=='refactor main.py')
    txt=pg.inner_text('.msg.assistant .part.p-text')
    chk('streamed text with delta','Hello' in txt and 'world' in txt)
    chk('code block copy bar',pg.query_selector('.codeblock .code-bar')!=None)
    chk('reasoning shown',pg.query_selector('.think summary')!=None)
    chk('two tool cards',pg.locator('.tool').count()==2)
    chk('permission card patterns','rm -rf build' in pg.inner_text('#dock'))
    # the mock finishes the turn (idle) 60ms after the permission arrives, so force busy to test the dot
    pg.evaluate("__push({type:'session.status',properties:{sessionID:'ses_1',status:{type:'busy'}}})")
    pg.wait_for_timeout(250)
    chk('pending dot in top bar',pg.evaluate("!document.querySelector('.top-title-dot').classList.contains('hide')"))
    pg.screenshot(path=os.environ.get('SHOTS','/tmp')+'/s2_chat.png')
    # permission reply
    pg.click('text=Разрешить раз')
    pg.wait_for_timeout(300)
    rep=[c for c in pg.evaluate("__srv.calls") if 'permission' in c['p'] and c['method']=='POST']
    chk('permission reply posted',len(rep)>=1 and rep[0]['body'].get('reply')=='once')
    pg.evaluate("__push({type:'permission.replied',properties:{requestID:'per_1',sessionID:'ses_1'}})")
    pg.wait_for_timeout(200)
    chk('permission card gone',pg.locator('#dock .hud-dock-card').count()==0)
    pg.evaluate("__push({type:'session.idle',properties:{sessionID:'ses_1'}})")
    pg.wait_for_timeout(200)
    chk('send idle after idle event',pg.locator('#send.stop').count()==0)
    chk('top title updated',len(pg.inner_text('#top .top-title-txt'))>0)
    # slash menu
    pg.fill('#composer textarea','/')
    pg.dispatch_event('#composer textarea','input')
    pg.wait_for_selector('#pop .it')
    chk('slash menu lists builtins+server cmd',pg.locator('#pop .it').count()>10 and 'review' in pg.inner_text('#pop'))
    chk('plan command exists','/plan' in pg.inner_text('#pop'))
    chk('projects command exists','/projects' in pg.inner_text('#pop'))
    pg.fill('#composer textarea','')
    pg.dispatch_event('#composer textarea','input')
    # @ mention
    pg.fill('#composer textarea','look at @ma')
    pg.dispatch_event('#composer textarea','input')
    pg.wait_for_selector('#pop .it',timeout=3000)
    chk('@ menu has files','main.py' in pg.inner_text('#pop'))
    pg.click('#pop .it:has-text("main.py")')
    chk('mention inserted',pg.input_value('#composer textarea').startswith('look at @main.py'))
    pg.fill('#composer textarea','')
    pg.dispatch_event('#composer textarea','input')
    # ---- files tab ----
    pg.evaluate("OCM.setTab('files')")
    pg.wait_for_selector('.tn')
    chk('file tree rows',pg.locator('.tn').count()==3)
    chk('modified file marked',pg.locator('.tn.m').count()==1)
    pg.click('.tn:has-text("main.py")')
    pg.wait_for_selector('.code-view')
    chk('file viewer content','print' in pg.inner_text('.code-view'))
    pg.screenshot(path=os.environ.get('SHOTS','/tmp')+'/s3_viewer.png')
    pg.click('.sheet .sh-h button.ibtn:first-child')
    # ---- terminal tab ----
    pg.evaluate("OCM.setTab('term')")
    pg.wait_for_selector('#agentlog .cmd')
    chk('agent log shows bash command','$ ls -la' in pg.inner_text('#agentlog'))
    pg.click('.tsub button:has-text("Shell")')
    pg.wait_for_timeout(500)
    chk('pty created via API',any(c['p']=='/pty' for c in pg.evaluate("__srv.calls")))
    chk('pty output reaches terminal','root@phone' in (pg.evaluate("window.__termOut||''")))
    pg.click('#keys button:has-text("Esc")')
    chk('key row sends escape',pg.evaluate("(window.__wsSent||[]).includes('\\x1b')"))
    pg.screenshot(path=os.environ.get('SHOTS','/tmp')+'/s4_term.png')
    # ---- changes tab ----
    pg.evaluate("OCM.setTab('changes')")
    pg.wait_for_selector('#pane-side .li')
    chk('changes list',('main.py' in pg.inner_text('#pane-side')))
    pg.click('#pane-side .li')
    pg.wait_for_selector('.sheet .diff')
    chk('session diff rendered',pg.locator('.sheet .diff .a').count()>=1)
    pg.click('.sheet .sh-h button.ibtn:first-child')
    pg.evaluate("OCM.setTab('chat')")
    # ---- model picker: long name fits chip ----
    pg.click('#composer .model-pill')
    pg.wait_for_selector('.sheet .model-row')
    # paid models are hidden by the default free-only filter: turn it off to see GPT X
    pg.evaluate("OCM.store.set('onlyFreeModels',false)")
    pg.evaluate("OCM.back();OCM.openModels()")
    pg.wait_for_selector('.sheet .model-row')
    chk('model list','GPT X' in pg.inner_text('.sheet >> nth=-1'))
    chk('free badge shown','БЕСПЛАТНО' in pg.inner_text('.sheet >> nth=-1').upper())
    pg.click('.sheet .model-row:has-text("Claude Super Long")')
    pg.wait_for_timeout(300)
    chk('long model selected',pg.evaluate("OCM.S.model.modelID")=='claude-super-long-preview-ultra-experimental-context-window-1m')
    modelbb=pg.locator('#composer .model-pill').bounding_box()
    chk('long model name clipped inside chip',modelbb and modelbb['width']<300)
    pg.screenshot(path=os.environ.get('SHOTS','/tmp')+'/s5_long_model.png')
    # ---- nokey hint ----
    pg.evaluate("OCM.S.model=null;OCM.bus.emit('meta')")
    pg.wait_for_timeout(200)
    chk('nokey hint visible',pg.locator('#composer .nokey:not(.hide)').count()==1)
    pg.click('#composer .nokey button')
    pg.wait_for_selector('.sheet.full:has-text("Вы уже вошли")')
    conntxt=pg.inner_text('.sheet.full')
    chk('connect sheet знает про вход','Вы уже вошли' in conntxt and 'Войти через Google / GitHub' not in conntxt)
    pg.click('.sheet.full .sh-h button.ibtn:first-child')
    pg.evaluate("OCM.pickDefaults();OCM.bus.emit('meta')")
    pg.wait_for_timeout(200)
    chk('nokey hint hidden with model',pg.locator('#composer .nokey.hide').count()==1)
    # ---- workspaces ----
    pg.evaluate("OCM.openProjects()")
    pg.wait_for_selector('.sheet.full:has-text("Рабочие пространства")')
    chk('workspaces sheet opens','Добавить папку проекта' in pg.inner_text('.sheet.full'))
    pg.evaluate("OCM.saveWorkspace({dir:'/root/app',name:'My App'});OCM.bus.emit('workspace')")
    pg.wait_for_timeout(200)
    chk('workspace card rendered','My App' in pg.inner_text('.sheet.full'))
    chk('workspace stored',pg.evaluate("OCM.workspaces().some(w=>w.dir==='/root/app'&&w.name==='My App')"))
    pg.evaluate("OCM.back()")
    # ---- step plan (toggle from settings) ----
    # dismiss the pending permission first: dock-active hides the composer
    pg.evaluate("__push({type:'permission.replied',properties:{requestID:'per_1',sessionID:'ses_1'}})")
    pg.wait_for_timeout(150)
    pg.evaluate("OCM.setPlanMode(true);OCM.bus.emit('planMode')")
    pg.wait_for_timeout(150)
    chk('plan button visible when enabled',pg.locator('#composer .plan-btn:not(.hide)').count()==1)
    # openPlan needs a session: earlier tests left S.sid empty, so create one deterministically
    pg.evaluate("OCM.S.sid=OCM.S.sessions[0]&&OCM.S.sessions[0].id||'ses_1'")
    pg.click('#composer .plan-btn')
    pg.wait_for_selector('.sheet.full:has-text("План задачи")')
    pg.fill('.sheet.full textarea','Починить авторизацию')
    pg.fill('.sheet.full .plan-step input','Найти баг')
    pg.click('.sheet.full button:has-text("Добавить шаг")')
    pg.fill('.sheet.full .plan-step >> nth=1 >> input','Написать тест')
    pg.click('.sheet.full button:has-text("В чат")')
    pg.wait_for_timeout(200)
    plantext=pg.input_value('#composer textarea')
    chk('plan sent to composer','Починить авторизацию' in plantext and '1. Найти баг' in plantext and '2. Написать тест' in plantext)
    chk('plan persisted',pg.evaluate("!!OCM.planFor(OCM.S.sid)"))
    pg.fill('#composer textarea','')
    pg.dispatch_event('#composer textarea','input')
    pg.evaluate("OCM.setPlanMode(false);OCM.bus.emit('planMode')")
    pg.wait_for_timeout(150)
    chk('plan button hidden when disabled',pg.locator('#composer .plan-btn.hide').count()==1)
    # ---- media chats ----
    pg.evaluate("""() => {
      const p={id:'testprov',name:'Test Provider',kind:'image',baseURL:'https://example.test/v1',
        modelsByKind:{image:['vendor/image'],video:[],tts:[],music:[]},hasKey:true,requireKey:false};
      localStorage.setItem('ocm.mediaProviders',JSON.stringify([p]));
    }""")
    pg.evaluate("OCM.openMedia('image')")
    pg.wait_for_selector('.sheet.full .media-chat')
    chk('media chat composer',pg.query_selector('.media-chat-input')!=None)
    chk('media chat provider chip','Test Provider' in pg.inner_text('.media-chat-chips'))
    pg.evaluate("window.__netPostResult={ok:true,path:'/root/media/fox.png'}")
    pg.fill('.media-chat-input','a red fox')
    pg.click('.media-chat-send')
    pg.wait_for_timeout(400)
    chk('media prompt bubble',pg.locator('.media-bubble.user').count()==1)
    chk('media result bubble',pg.locator('.media-bubble.bot').count()==1)
    calls=pg.evaluate("window.__mediaCalls||[]")
    posts=[c for c in calls if c.get('op')=='post']
    chk('media request url correct',posts and posts[-1]['url']=='https://example.test/v1/images/generations')
    chk('media request model correct',posts and posts[-1]['body'].get('model')=='vendor/image')
    chk('media chat persisted',pg.evaluate("OCM.store.get('mediaChat.image',[]).length")==2)
    pg.wait_for_selector('.media-bubble.bot img',timeout=3000)
    chk('media result rendered as image',pg.locator('.media-bubble.bot img').count()==1)
    pg.screenshot(path=os.environ.get('SHOTS','/tmp')+'/s6_media_chat.png')
    # separate chat per kind: video thread must be empty (scope to the last sheet: closed ones may linger in DOM)
    pg.evaluate("OCM.back();OCM.openMedia('video')")
    pg.wait_for_timeout(200)
    chk('video chat is separate',pg.locator('.sheet >> nth=-1 >> .media-bubble').count()==0)
    chk('video empty state','Новый чат' in pg.inner_text('.sheet >> nth=-1'))
    pg.evaluate("OCM.back()")
    # ---- answer styles (10 presets + off) ----
    chk('11 style presets',pg.evaluate("OCM.answerStyles().length")==11)
    pg.evaluate("OCM.setAnswerStyle('code')")
    chk('style instruction present',pg.evaluate("OCM.answerStyleText().includes('только кодом')"))
    pg.evaluate("OCM.setAnswerStyle('off')")
    chk('style off is empty',pg.evaluate("OCM.answerStyleText()")=='')
    # ---- prompt queue ----
    pg.evaluate("OCM.enqueuePrompt(OCM.S.sid,'queued task')")
    pg.wait_for_timeout(150)
    chk('queue bar visible',pg.locator('#composer .queue-bar').count()==1)
    pg.evaluate("OCM.dequeuePrompt(OCM.S.sid)")
    pg.wait_for_timeout(150)
    chk('queue bar gone when empty',pg.locator('#composer .queue-bar').count()==0)
    # ---- branch tree ----
    pg.evaluate("OCM.noteFork('ses_x',OCM.S.sid)")
    tree=pg.evaluate("OCM.sessionBranches(OCM.S.sid)")
    chk('branch tree rooted at current',tree and tree['id']==pg.evaluate("OCM.S.sid"))
    # ---- home tiles ----
    tiles=pg.evaluate("OCM.homeTiles()")
    chk('default home tiles',len(tiles)>=4 and 'chat' in tiles)
    pg.evaluate("OCM.store.set('homeTiles',['chat','photo']);OCM.bus.emit('homeTiles')")
    pg.wait_for_timeout(150)
    # ---- global search ----
    pg.evaluate("OCM.openGlobalSearch()")
    pg.wait_for_selector('.sheet.full input')
    pg.fill('.sheet.full input','main')
    pg.wait_for_timeout(600)
    gs=pg.inner_text('.sheet.full')
    chk('global search finds files or sessions','main.py' in gs or 'Файлы' in gs or 'Ничего' not in gs)
    pg.evaluate("OCM.back()")
    # ---- resources ----
    pg.evaluate("OCM.openResources()")
    pg.wait_for_selector('.sheet.full:has-text("Ресурсы")')
    pg.wait_for_timeout(300)
    rs=pg.inner_text('.sheet.full')
    chk('resources shows CPU and RAM','Процессор' in rs and 'ОЗУ' in rs)
    pg.evaluate("OCM.back()")
    # ---- tour ----
    pg.evaluate("OCM.openTour()")
    pg.wait_for_selector('.sheet:has-text("Добро пожаловать")')
    chk('tour first step','Чат с агентом' in pg.inner_text('.sheet >> nth=-1'))
    pg.click('.sheet >> nth=-1 >> button:has-text("Далее")')
    pg.wait_for_timeout(150)
    chk('tour advances','Проекты' in pg.inner_text('.sheet >> nth=-1'))
    pg.evaluate("OCM.back()")
    # ---- snippets / health / audit / env / gallery / lock ----
    chk('snippets defaults',pg.evaluate("OCM.snippets().length")>=8)
    pg.evaluate("OCM.openSnippets()")
    pg.wait_for_selector('.sheet.full:has-text("Сниппеты")')
    pg.click('.sheet.full .settings-row-text:has-text("Исправить ошибку")')
    pg.wait_for_selector('.sheet.hud input, .sheet input',timeout=3000)
    pg.fill('.sheet >> nth=-1 >> input','TypeError: x is undefined')
    pg.click('.sheet >> nth=-1 >> button:has-text("ОК")')
    pg.wait_for_timeout(300)
    chk('snippet variable filled','TypeError: x is undefined' in pg.input_value('#composer textarea'))
    pg.fill('#composer textarea','')
    pg.dispatch_event('#composer textarea','input')
    pg.evaluate("OCM.projectHealth()")
    pg.wait_for_selector('.sheet.full:has-text("Здоровье проекта")')
    pg.wait_for_timeout(600)
    ph=pg.inner_text('.sheet.full')
    chk('health check renders','Незакоммиченные' in ph and 'Свободное место' in ph)
    pg.evaluate("OCM.back()")
    pg.evaluate("OCM.openAgentAudit()")
    pg.wait_for_selector('.sheet.full:has-text("Аудит")')
    au=pg.inner_text('.sheet >> nth=-1')
    chk('audit lists bash calls','bash' in au)
    pg.evaluate("OCM.back()")
    pg.evaluate("OCM.openEnvManager()")
    pg.wait_for_selector('.sheet.full:has-text(".env")')
    pg.evaluate("OCM.back()")
    pg.evaluate("OCM.openMediaGallery()")
    pg.wait_for_selector('.sheet.full:has-text("Галерея")')
    chk('gallery filters',pg.locator('.sheet.full .seg button').count()>=6)
    pg.evaluate("OCM.back()")
    chk('biometric available (mock)',pg.evaluate("OCM.native.biometricAvailable()")==True)
    pg.evaluate("OCM.openAppLockSettings()")
    pg.wait_for_selector('.sheet:has-text("Блокировка приложения")')
    pg.evaluate("OCM.back()")
    # focus mode
    pg.evaluate("OCM.setFocusMode(true)")
    pg.wait_for_timeout(150)
    chk('focus mode hides top',not pg.locator('#top').is_visible())
    chk('focus exit visible',pg.locator('.focus-exit').is_visible())
    pg.click('.focus-exit')
    pg.wait_for_timeout(150)
    chk('focus mode exits',pg.locator('#top').is_visible())
    # themes
    chk('amoled theme applies',pg.evaluate("OCM.S.opts.theme='amoled';OCM.saveOpts();document.documentElement.dataset.theme")=='amoled')
    pg.evaluate("OCM.S.opts.theme='opencode';OCM.saveOpts()")
    # second opinion + regenerate helpers exist
    chk('regenerate helper',pg.evaluate("typeof OCM.regenerateFrom")=='function')
    chk('second opinion helper',pg.evaluate("typeof OCM.secondOpinion")=='function')
    # ---- manually opened tool output must never auto-collapse ----
    pg.evaluate("""() => {
      // open the first tool by hand while it is still 'completed' in the mock
      const t=document.querySelector('.tool');
      if(t)t.querySelector('.tool-h').click();
    }""")
    pg.wait_for_timeout(200)
    opened=pg.evaluate("document.querySelector('.tool').classList.contains('open')")
    chk('tool opens on tap',opened)
    # re-render the same part (simulates a status update / resync)
    pg.evaluate("""() => {
      const sid=OCM.S.sid;const list=OCM.visibleMsgs(sid);
      for(const m of list)for(const p of m.parts)if(p.type==='tool'){OCM.bus.emit('part',sid,m,p);break}
    }""")
    pg.wait_for_timeout(300)
    still=pg.evaluate("document.querySelector('.tool').classList.contains('open')")
    chk('manually opened tool stays open after update',still)
    # ---- focus ring must not overflow the composer ----
    pg.click('#composer textarea')
    pg.wait_for_timeout(200)
    fr=pg.evaluate("""() => {
      const ta=document.querySelector('#composer textarea');
      const cs=getComputedStyle(ta);
      const box=document.querySelector('#composer .cbox').getBoundingClientRect();
      const r=ta.getBoundingClientRect();
      return {outline:cs.outlineStyle+' '+cs.outlineWidth, inside:r.left>=box.left-1&&r.right<=box.right+1};
    }""")
    chk('textarea has no outline',fr['outline'].startswith('none') or fr['outline']==' 0px' or 'none' in fr['outline'])
    chk('textarea stays inside composer card',fr['inside'])
    # ---- haptics + skeleton ----
    pg.fill('#composer textarea','haptic test')
    pg.click('#send')
    pg.wait_for_timeout(300)
    chk('haptic on send',pg.evaluate("(window.__haptics||[]).length")>=1)
    chk('skeleton helpers',pg.evaluate("typeof OCM.chatSkeleton==='function'&&typeof OCM.chatSkeletonOff==='function'"))
    pg.evaluate("OCM.chatSkeleton()")
    chk('skeleton renders',pg.locator('.chat-skeleton .skeleton').count()>=4)
    pg.evaluate("OCM.chatSkeletonOff()")
    chk('skeleton removed',pg.locator('.chat-skeleton').count()==0)
    # ---- fast mode ----
    chk('fast mode helper',pg.evaluate("typeof OCM.setFastMode==='function'&&typeof OCM.fastestModel==='function'"))
    fm=pg.evaluate("OCM.fastestModel()")
    chk('fastest model picked',fm is not None)
    pg.evaluate("OCM.setFastMode(true)")
    pg.wait_for_timeout(200)
    chk('fast mode on',pg.evaluate("OCM.fastMode()")==True)
    chk('fast badge on chip',pg.locator('#composer .model-pill.fast-on').count()==1)
    chk('compact threshold 70',pg.evaluate("OCM.compactThreshold()")==70)
    pg.evaluate("OCM.setFastMode(false)")
    pg.wait_for_timeout(200)
    chk('fast mode off restores',pg.evaluate("OCM.fastMode()")==False)
    # ---- error classification (no fake quota alerts) ----
    ek=pg.evaluate("""() => ({
      overflow:OCM.errorKind({name:'ContextOverflowError'},''),
      outlen:OCM.errorKind({name:'MessageOutputLengthError'},''),
      aborted:OCM.errorKind({name:'MessageAbortedError'},''),
      quota429:OCM.errorKind({data:{statusCode:429}},'Too Many Requests'),
      free:OCM.errorKind({data:{responseBody:'{"error":"FreeUsageLimitError"}'}},''),
      toolfail:OCM.errorKind({name:'UnknownError'},'maximum output tokens exceeded for this tool'),
      credits:OCM.errorKind({name:'UnknownError'},'insufficient credit balance'),
      plain:OCM.errorKind(null,'rate limit reached')
    })""")
    chk('kind: context overflow',ek['overflow']=='context')
    chk('kind: output length is not quota',ek['outlen']=='output-length')
    chk('kind: aborted',ek['aborted']=='abort')
    chk('kind: 429 is quota',ek['quota429']=='quota')
    chk('kind: FreeUsageLimitError is quota',ek['free']=='quota')
    chk('kind: tool "exceeded" is not quota',ek['toolfail']!='quota')
    chk('kind: insufficient credit is quota',ek['credits']=='quota')
    chk('kind: rate limit text is quota',ek['plain']=='quota')
    # transient session.error while status=retry must not pop the quota modal
    pg.evaluate("""() => {
      window.__notified=null;
      __push({type:'session.status',properties:{sessionID:'ses_1',status:{type:'retry',attempt:1,message:'rate limit'}}});
      __push({type:'session.error',properties:{sessionID:'ses_1',error:{name:'APIError',data:{message:'rate limit reached, retrying'}}}});
    }""")
    pg.wait_for_timeout(200)
    chk('no quota alert during retry',pg.evaluate("window.__notified===null"))
    pg.evaluate("__push({type:'session.status',properties:{sessionID:'ses_1',status:{type:'idle'}}})")
    # ---- settings ----
    pg.evaluate("OCM.openSettings()")
    pg.wait_for_selector('.sheet .settings-tabs')
    pg.wait_for_timeout(400)
    st=pg.inner_text('.sheet')
    chk('settings: profile email','Профиль: dev@example.com' in st)
    chk('settings: account row','Аккаунт opencode' in st)
    chk('settings: plan toggle','Пошаговые планы задач' in st)
    chk('settings: answer style row','Стиль ответа' in st)
    chk('settings: auto-compact row','Авто-сжатие контекста' in st)
    chk('settings: home tiles row','Плитки главного экрана' in st)
    chk('settings: haptics row','Тактильный отклик' in st)
    chk('settings: fast mode row','Быстрый режим' in st)
    chk('settings: key check row','Проверить все ключи' in st)
    chk('settings: quick chips',pg.locator('.settings-quick-chip').count()>=5)
    chk('settings: voice control near top','Настройки голосового управления' in st)
    pg.fill('.settings-search','бэкап')
    pg.wait_for_timeout(200)
    sf=pg.inner_text('.sheet')
    chk('settings search filters','Шифрованный бэкап' in sf and 'Обучающий тур' not in sf)
    pg.fill('.settings-search','')
    pg.wait_for_timeout(200)
    pg.click('.sheet .settings-tabs button[data-pane="system"]')
    pg.wait_for_timeout(200)
    st2=pg.inner_text('.sheet')
    chk('settings: system tab','Обновления' in st2 and 'Шифрованный бэкап' in st2)
    chk('settings: telegram bot row','Telegram-бот' in st2)
    chk('settings: app lock row','Блокировка приложения' in st2)
    chk('settings: gallery row','Галерея медиа' in st2)
    chk('settings: git timeline row','История Git' in st2)
    pg.screenshot(path=os.environ.get('SHOTS','/tmp')+'/s7_settings.png')
    pg.evaluate("OCM.back()")
    # ---- agents & rules redesign + AI editor ----
    pg.evaluate("OCM.openAgentsRules()")
    pg.wait_for_timeout(300)
    ar=pg.inner_text('.sheet >> nth=-1').upper()
    chk('agents&rules sections',all(x in ar for x in ['РЕЖИМЫ ЧАТА','СУБАГЕНТЫ','ПРАВИЛА (AGENTS.MD)','НАВЫКИ И КОМАНДЫ']))
    chk('agents&rules create rows','Новый режим…' in pg.inner_text('.sheet >> nth=-1') and 'Новый субагент…' in pg.inner_text('.sheet >> nth=-1'))
    pg.evaluate("OCM.back()")
    pg.evaluate("OCM.openAgents()")
    pg.wait_for_timeout(250)
    chk('agent chip picker has create','Новый режим / агент' in pg.inner_text('.sheet >> nth=-1'))
    pg.evaluate("OCM.back()")
    pg.evaluate("OCM.openAgentEditor('subagent',null)")
    pg.wait_for_timeout(500)
    ae=pg.evaluate("document.querySelector('.sheet:last-child').textContent")
    chk('agent editor AI block','Опишите результат' in ae and 'Системный промпт' in ae)
    pg.evaluate("()=>{const sh=document.querySelector('.sheet:last-child');sh.querySelectorAll('input')[0].value='tester';sh.querySelectorAll('textarea')[1].value='Ты тестировщик. Пиши тесты.'}")
    pg.evaluate("()=>{[...document.querySelector('.sheet:last-child').querySelectorAll('button')].find(b=>b.textContent.includes('Сохранить')).click()}")
    pg.wait_for_timeout(300)
    chk('agent editor saves','Сохранено: tester' in pg.evaluate("(document.querySelector('#toast')||{}).textContent||''"))
    pg.evaluate("OCM.back()")
    # ---- pinned sessions: flat priority block, time right of row ----
    pg.evaluate("__push({type:'session.updated',properties:{info:{id:'ses_pin2',title:'Вторая закреплённая',time:{created:2,updated:Date.now()},directory:'/root'}}})")
    pg.evaluate("()=>{OCM.togglePin('ses_1');OCM.togglePin('ses_pin2')}")
    pg.evaluate("OCM.openSessions()")
    pg.wait_for_selector('.sheet.drawer .sess-row .pin-ic')
    pg.wait_for_timeout(250)
    pin=pg.evaluate("""()=>{
      const rows=[...document.querySelectorAll('.sheet.drawer .sess-row')];
      const grps=[...document.querySelectorAll('.sheet.drawer .grp')].map(g=>g.textContent);
      const first=rows[0];const t=first&&first.querySelector('.sess-time');const d=first&&first.querySelector('button.ibtn');
      let aligned=false,left=false;
      if(t&&d){const tb=t.getBoundingClientRect(),db=d.getBoundingClientRect();
        aligned=Math.abs((tb.top+tb.bottom)/2-(db.top+db.bottom)/2)<8;left=tb.right<=db.left+1}
      return {pinHead:grps[0]==='Закреплённые',twoPinned:rows[0].querySelector('.pin-ic')&&rows[1]&&rows[1].querySelector('.pin-ic'),aligned,left,
        order:OCM.pinnedSessions()};
    }""")
    chk('pinned block first, no day split',pin['pinHead'] and pin['twoPinned'])
    chk('pinned time centered next to dots',pin['aligned'] and pin['left'])
    pg.evaluate("()=>{const po=OCM.pinnedSessions();if(po.length>1)OCM.movePinned(po[1],-1)}")
    pg.wait_for_timeout(200)
    chk('pinned priority move',pg.evaluate("OCM.pinnedSessions()[0]")=='ses_1' and pin['order'][0]=='ses_pin2')
    pg.evaluate("()=>{OCM.pinnedSessions().slice().forEach(id=>OCM.togglePin(id))}")
    pg.evaluate("OCM.back()")
    # ---- MM: pipeline editor, judge merge, memory, resume ----
    pg.evaluate("""()=>{
      OCM.mmSave({id:'mm_t1',name:'Тест-команда',main:null,backup:null,mode:'sessions',pipeline:true,memory:true,
        roles:[{name:'План',icon:'list',prompt:'план',kind:'worker'},
               {name:'Код',icon:'code',prompt:'код',kind:'worker'},
               {name:'Судья',icon:'shield',prompt:'проверка',kind:'judge',merge:true}]});
      OCM.mmSetActive('mm_t1');
      OCM.mmEditor(OCM.mmActive());
    }""")
    pg.wait_for_timeout(300)
    mm=pg.evaluate("""()=>{
      const sh=document.querySelector('.sheet:last-child');
      return {cards:sh.querySelectorAll('.mm-role-card').length,ord:sh.querySelectorAll('.mm-role-ord').length,
        text:sh.textContent};
    }""")
    chk('mm editor role cards',mm['cards']==3 and mm['ord']==3)
    chk('mm pipeline + memory toggles','Конвейер' in mm['text'] and 'Память команды' in mm['text'])
    chk('mm pipeline flow hint','получает результат' in mm['text'])
    chk('mm approve-stage toggle','Приёмка каждого этапа' in mm['text'])
    pg.evaluate("OCM.back()")
    pg.evaluate("OCM.mmMemoryAppend(OCM.mmActive(),'проект на Kotlin')")
    chk('mm memory stored','Kotlin' in pg.evaluate("OCM.mmMemory(OCM.mmActive())"))
    pg.evaluate("OCM.store.set('mm.lastResumable',{mmId:'mm_t1',userText:'тест',at:Date.now(),jobs:[{role:{name:'Код'},task:'писать',result:'',state:'error'}]})")
    chk('mm resumable detected',pg.evaluate("OCM.mmHasResumable()"))
    pg.evaluate("OCM.openMultimodalPicker()")
    pg.wait_for_timeout(250)
    mmp=pg.inner_text('.sheet >> nth=-1')
    chk('mm picker resume + memory','Возобновить прерванный прогон' in mmp and 'Память команды' in mmp)
    pg.evaluate("OCM.back();OCM.mmSetActive(null);OCM.store.remove('mm.lastResumable')")
    # ---- regression: managed rules block survives sends; README untouched ----
    pg.evaluate("OCM.S.dir='/root'")
    pg.evaluate("""()=>{
      __srv.files['/root/AGENTS.md']='# Мои правила\\nВсегда отвечай по-русски.';
      __srv.files['/root/README.md']='# Мой проект\\nВажное описание.';
      __srv.files['/root/.config/opencode/AGENTS.md']='Глобальные правила пользователя.';
      OCM.updateReadmeForModel('big-pickle');
      OCM.updateReadmeForModel('gpt-x');
      OCM.updateReadmeForModel('big-pickle');
    }""")
    rules=pg.evaluate("""()=>{
      const a=__srv.files['/root/AGENTS.md']||'';
      const g=__srv.files['/root/.config/opencode/AGENTS.md']||'';
      return {mine:a.includes('Всегда отвечай по-русски.'),
        block:(a.match(/ocm:managed:start/g)||[]).length===1&&(a.match(/ocm:managed:end/g)||[]).length===1,
        globalMine:g.includes('Глобальные правила пользователя.'),
        readme:__srv.files['/root/README.md']==='# Мой проект\\nВажное описание.',
        noProjReadme:!('/root/README.md' in (window.__writes||[]).reduce((o,p)=>(o[p]=1,o),{}))||true};
    }""")
    chk('rules: user text preserved after model updates',rules['mine'])
    chk('rules: exactly one managed block',rules['block'])
    chk('rules: global user rules preserved',rules['globalMine'])
    chk('rules: README never rewritten',rules['readme'] and not any(p.endswith('README.md') for p in pg.evaluate("window.__writes||[]")))
    legacy=pg.evaluate("""()=>{
      __srv.files['/root/legacy/AGENTS.md']='# OpenCode Mobile Environment & Instructions (v2.0.1)\\nстарый сгенерированный текст';
      const dir=OCM.S.dir;OCM.S.dir='/root/legacy';OCM.updateReadmeForModel('big-pickle');OCM.S.dir=dir;
      const t=__srv.files['/root/legacy/AGENTS.md'];
      return t.startsWith('<!-- ocm:managed:start -->')&&t.includes('ocm:managed:end')&&!t.includes('старый сгенерированный текст');
    }""")
    chk('rules: legacy app-generated file migrated into block',legacy)
    # ---- regression: archive pages cover messages 251-550 ----
    arch=pg.evaluate("""async ()=>{
      const sid='ses_arch';const st=OCM.msgs(sid);
      for(let i=0;i<550;i++){const id='m'+String(i).padStart(4,'0');
        st.list.push({info:{id,sessionID:sid,role:'user',time:{created:i}},parts:[{id:'p'+id,sessionID:sid,messageID:id,type:'text',text:'msg '+i}]});
        st.idx.set(id,st.list[st.list.length-1]);}
      __push({type:'message.part.updated',properties:{part:{id:'pnew',sessionID:sid,messageID:'m0549',type:'text',text:'msg 549'}}});
      await new Promise(r=>setTimeout(r,2600));
      const pages=await OCM.kv.get('msgs:'+sid+':pages');
      const p0=await OCM.kv.get('msgs:'+sid+':p0');
      OCM.dropMsgs(sid);
      const back=await OCM.loadCachedMsgs(sid);
      const ids=new Set(back.map(m=>m.info.id));
      const ok=back.length===550&&ids.has('m0250')&&ids.has('m0300')&&ids.has('m0549')&&back[0].info.id==='m0000';
      OCM.dropMsgs(sid);await OCM.dropCachedMsgs(sid);
      return {pages,p0len:p0&&p0.length,ok};
    }""")
    chk('archive: 550 msgs -> 1 full page + hot window',arch['pages']==1 and arch['p0len']==300)
    chk('archive: messages 251-550 survive reload',arch['ok'])
    # ---- regression: tool state not wiped by lagging snapshot ----
    tool=pg.evaluate("""()=>{
      const sid=OCM.S.sid;
      OCM.upsertPart({id:'pt_x',sessionID:sid,messageID:'mtool',type:'tool',tool:'bash',state:{status:'completed',input:{command:'ls'},output:'main.py',metadata:{exit:0},time:{start:1,end:2}}});
      OCM.upsertPart({id:'pt_x',sessionID:sid,messageID:'mtool',type:'tool',tool:'bash',state:{status:'pending'}});
      const m=OCM.msgs(sid).idx.get('mtool');const p=m&&m.parts.find(x=>x.id==='pt_x');
      const kept=p&&p.state.status==='completed'&&p.state.output==='main.py';
      if(m){const s=OCM.msgs(sid);s.list=s.list.filter(x=>x.info.id!=='mtool');s.idx.delete('mtool')}
      return kept;
    }""")
    chk('tool part: lagging snapshot keeps richer state',tool)
    # ---- outline + context snapshot ----
    pg.evaluate("OCM.openOutline()")
    pg.wait_for_timeout(250)
    ol=pg.inner_text('.sheet >> nth=-1')
    chk('outline lists user prompts','refactor main.py' in ol)
    pg.evaluate("OCM.back()")
    pg.evaluate("OCM.openContextPreview()")
    pg.wait_for_timeout(400)
    ctx=pg.evaluate("[...document.querySelectorAll('.sheet')].map(s=>s.textContent).find(t=>t.includes('Снимок контекста'))||''")
    curmodel=pg.evaluate("OCM.S.model?OCM.S.model.modelID:''")
    chk('context snapshot shows model and folder',bool(curmodel) and curmodel in ctx and 'root' in ctx)
    pg.evaluate("OCM.back()")
    # ---- drafts: attachments survive a re-render ----
    dr=pg.evaluate("""async ()=>{
      const sid=OCM.S.sid;
      OCM.setDraft(sid,'черновик с вложением');
      OCM.setDraftEx(sid,{atts:[{type:'file',mime:'text/plain',filename:'note.txt',url:'data:text/plain;base64,aGk='}],mentions:[]});
      await new Promise(r=>setTimeout(r,250));
      OCM.S.sid=null;OCM.chat.renderAll();
      await OCM.openSession(sid);
      await new Promise(r=>setTimeout(r,500));
      const ta=document.querySelector('#composer textarea');
      const chips=document.querySelectorAll('#composer .atts .chip').length;
      return {text:ta.value,chips};
    }""")
    chk('draft text restored on reopen',dr['text']=='черновик с вложением')
    chk('draft attachment restored on reopen',dr['chips']==1)
    pg.evaluate("OCM.clearDraft(OCM.S.sid);OCM.chat.renderAll()")
    # ---- model capabilities ----
    caps=pg.evaluate("""()=>{
      const a=OCM.modelCaps({attachment:false});
      const b=OCM.modelCaps({modalities:['image','text'],tool_call:true});
      const c=OCM.modelCaps({});
      return {noImg:a.images===false,img:b.images===true,tools:b.tools===true,unknown:c.images===null&&c.tools===null};
    }""")
    chk('caps: attachment=false -> no images',caps['noImg'])
    chk('caps: modalities + tool_call detected',caps['img'] and caps['tools'])
    chk('caps: missing metadata -> unknown',caps['unknown'])
    # ---- configurable bottom bar ----
    nav=pg.evaluate("""()=>{
      OCM.store.set('navTabs',['chat','term','files']);OCM.rebuildBottomBar();
      const pills=[...document.querySelectorAll('#bottom-bar .bottom-pill span')].map(x=>x.textContent).filter(Boolean);
      OCM.store.set('navTabs',['chat','files']);OCM.rebuildBottomBar();
      return pills;
    }""")
    chk('bottom bar: custom tabs rendered',nav[:3]==['Чат','Терминал','Файлы'])
    # ---- crash recovery banner ----
    rec=pg.evaluate("""()=>{
      // fresh session: no assistant history, so canContinue is false and recovery must show
      const sid='ses_rec';OCM.S.sessions.unshift({id:sid,title:'rec',time:{created:1,updated:Date.now()}});
      OCM.S.sid=sid;OCM.S.status[sid]={type:'idle'};
      OCM.markInflight(sid,'msg_x','прерванный запрос');
      OCM.chat.renderAll();
      const shown=[...document.querySelectorAll('.card')].some(c=>c.textContent.includes('прерван перезапуском'));
      OCM.clearInflight();OCM.chat.renderAll();
      const gone=![...document.querySelectorAll('.card')].some(c=>c.textContent.includes('прерван перезапуском'));
      OCM.S.sid=OCM.S.sessions.find(x=>x.id!=='ses_rec').id;OCM.chat.renderAll();
      return {shown,gone};
    }""")
    chk('recovery banner shown after interrupted send',rec['shown'])
    chk('recovery banner dismisses',rec['gone'])
    # ---- status poller reveals a running agent without restart ----
    poll=pg.evaluate("""async ()=>{
      const sid=OCM.S.sid;
      window.__status={};OCM.S.status[sid]={type:'idle'};
      OCM.stopLiveSync();OCM.startLiveSync(sid);
      window.__status={[sid]:{type:'busy'}};
      await new Promise(r=>setTimeout(r,7000));
      const busy=OCM.S.status[sid].type==='busy';
      const line=!document.querySelector('.status-line').classList.contains('hide');
      window.__status={};
      await new Promise(r=>setTimeout(r,4000));
      const idle=OCM.S.status[sid].type==='idle';
      OCM.stopLiveSync();
      return {busy,line,idle};
    }""")
    chk('poller picks up busy status without restart',poll['busy'] and poll['line'])
    chk('poller returns to idle',poll['idle'])
    # ---- MM: approval gate + stage retry helpers ----
    mmx=pg.evaluate("""()=>{
      const mm=OCM.mmList().find(x=>x.id==='mm_t1');
      mm.approve=true;OCM.mmSave(mm);
      OCM.mmEditor(OCM.mmList().find(x=>x.id==='mm_t1'));
      const txt=document.querySelector('.sheet:last-child').textContent;
      OCM.back();
      return {toggle:txt.includes('Приёмка каждого этапа'),retry:typeof OCM.mmRetryRole==='function'};
    }""")
    chk('mm approval toggle in editor',mmx['toggle'])
    chk('mm stage retry helper exists',mmx['retry'])
    # ---- voice draft: recognised text goes to a review sheet ----
    vd=pg.evaluate("""()=>{
      document.querySelector('#composer textarea').value='';
      OCM.voiceDictate();
      OCEvent('stt',{t:'final',text:'голосовой черновик тест'});
      const sh=[...document.querySelectorAll('.sheet')].find(x=>x.textContent.includes('Голосовой черновик'));
      const has=!!sh;
      const ta=sh&&sh.querySelector('textarea');
      const val=ta?ta.value:'';
      OCM.back();
      return {has,val};
    }""")
    chk('voice draft sheet opens with recognised text',vd['has'] and 'голосовой черновик тест' in vd['val'])
    pg.evaluate("OCM.clearDraft('ses_1');OCM.chat.renderAll()")
    # ---- sessions drawer ----
    pg.evaluate("__push({type:'session.updated',properties:{info:{id:'ses_9',title:'Очень длинное название сессии про рефакторинг системы аутентификации пользователей приложения и прочего',time:{created:1,updated:Date.now()},directory:'/root'}}})")
    pg.evaluate("OCM.openSessions()")
    pg.wait_for_selector('.sheet.drawer')
    chk('drawer lists long session','Очень длинное' in pg.inner_text('.sheet.drawer'))
    chk('drawer has workspaces entry','Проекты' in pg.inner_text('.sheet.drawer'))
    chk('drawer has photo tile','Фото' in pg.inner_text('.sheet.drawer'))
    pg.click('.drawer-more-btn')
    pg.wait_for_timeout(150)
    chk('drawer more expands','Чат: Видео' in pg.inner_text('.sheet.drawer'))
    chk('drawer has voice settings in more','Настройки голоса' in pg.inner_text('.sheet.drawer'))
    dots=pg.locator('.sheet.drawer .settings-row:has-text("Очень длинное") button.ibtn').first.bounding_box()
    drawer=pg.locator('.sheet.drawer').bounding_box()
    chk('row actions inside drawer',dots and drawer and dots['x']+dots['width']<=drawer['x']+drawer['width']+1)
    pg.screenshot(path=os.environ.get('SHOTS','/tmp')+'/s8_drawer.png')
    pg.evaluate("OCM.back()")
    # ---- nested settings sheets: MCP, plugins, updates ----
    pg.evaluate("OCM.openMcp()")
    pg.wait_for_selector('.sheet.full >> text=ctx7')
    chk('mcp manager reads config','m.example' in pg.inner_text('.sheet.full'))
    pg.evaluate("OCM.back()")
    pg.evaluate("OCM.openPlugins()")
    pg.wait_for_selector('.sheet.full >> text=Установленные')
    pg.fill('.sheet.full >> input','my-plugin')
    pg.click('.sheet.full >> button:has-text("Добавить")')
    pg.wait_for_timeout(200)
    chk('plugin added to config','my-plugin' in pg.evaluate("window.__cfg||''"))
    chk('jsonc parse kept mcp','ctx7' in pg.evaluate("window.__cfg||''"))
    pg.evaluate("OCM.back()")
    pg.evaluate("OCM.openSettings()")
    pg.click('.sheet .settings-tabs button[data-pane="system"]')
    pg.click('.sheet .settings-row:has-text("Обновления")')
    pg.click('.sheet.full >> button:has-text("Проверить обновления")')
    pg.wait_for_selector('.sheet.full >> button:has-text("Обновить")')
    chk('core update offered for 1.x','v1.18.6' in pg.inner_text('.sheet.full'))
    pg.screenshot(path=os.environ.get('SHOTS','/tmp')+'/s9_updates.png')
    # ---- wide layout ----
    for _ in range(6):
        if not pg.evaluate("OCM.back()"): break
    pg.set_viewport_size({"width":900,"height":412})
    pg.wait_for_timeout(400)
    chk('wide mode set',pg.get_attribute('#app','data-mode')=='wide')
    chk('3 panes visible',pg.locator('#pane-files').is_visible() and pg.locator('#pane-chat').is_visible() and pg.locator('#pane-side').is_visible())
    pg.screenshot(path=os.environ.get('SHOTS','/tmp')+'/s10_wide.png')
    # ---- guest boot ----
    gctx=b.new_context(viewport={"width":390,"height":780},device_scale_factor=2,has_touch=True,is_mobile=True)
    g=gctx.new_page()
    g.on('pageerror',lambda e:errs.append('guest pageerror: '+str(e)))
    g.on('console',lambda m:errs.append('guest console.'+m.type+': '+m.text) if m.type=='error' else None)
    g.add_init_script(mock)
    g.add_init_script("window.__st=window.__mkSt({user:'',name:'',googleConfigured:false,installed:false,ready:false});window.__failInstall=1;try{localStorage.setItem('ocm.permsSeen','true');localStorage.setItem('ocm.tourSeen','true')}catch(e){}")
    g.goto('http://127.0.0.1:8765/index.html')
    g.wait_for_selector('#boot',timeout=8000)
    g.wait_for_timeout(300)
    bt=g.inner_text('#boot')
    chk('guest boot: offers guest continue','Продолжить как гость' in bt)
    chk('guest boot: no Google when unconfigured','Войти через Google' not in bt and 'по почте' in bt)
    g.screenshot(path=os.environ.get('SHOTS','/tmp')+'/s11_boot_guest.png')
    g.click('#boot button:has-text("Продолжить как гость")')
    g.wait_for_timeout(400)
    chk('guest boot: random profile created once',g.evaluate("window.__guestCalls")==1)
    chk('guest boot: install failed screen','Установка не удалась' in g.inner_text('#boot'))
    chk('guest boot: retry+reset buttons','Повторить' in g.inner_text('#boot') and 'Сбросить и установить заново' in g.inner_text('#boot'))
    g.click('#boot button.reset')
    g.wait_for_timeout(500)
    chk('guest boot: resetInstall called',g.evaluate("window.__resetInstall")==1)
    g.wait_for_selector('#top',timeout=8000)
    g.wait_for_timeout(500)
    chk('guest boot: app opened',g.query_selector('#bottom-bar')!=None)
    g.evaluate("OCM.openSettings()")
    g.wait_for_selector('.sheet .settings-tabs')
    g.wait_for_timeout(400)
    gst=g.inner_text('.sheet')
    chk('guest settings: guest card','Гостевой профиль' in gst and 'Гость-7F3A' in gst)
    chk('guest settings: password shown','Пароль: Xy12Ab34Cd56Ef78' in gst)
    g.screenshot(path=os.environ.get('SHOTS','/tmp')+'/s12_guest_settings.png')
    b.close()
finally:
    srv.terminate()
print('\nERRORS:' if errs else '\nno console errors')
for e in errs[:15]: print(' ',e)
f=[n for n,c in res if not c];print('passed',len(res)-len(f),'failed',len(f),f)
hard_errs=[e for e in errs if 'pageerror:' in e]
if hard_errs: print('PAGE ERRORS (failing):',hard_errs[:5])
if f or hard_errs: sys.exit(1)
