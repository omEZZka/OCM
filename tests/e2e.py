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
    # ---- model picker: long name fits, recommendations respect free-only ----
    pg.click('#composer .model-pill')
    pg.wait_for_selector('.sheet .model-row')
    chk('model list','GPT X' in pg.inner_text('.sheet'))
    chk('free badge shown','Бесплатно' in pg.inner_text('.sheet'))
    pg.fill('.sheet.full input[placeholder*="Задача"]','исправь баг в коде')
    pg.click('.sheet.full button:has-text("Подобрать модель")')
    pg.wait_for_timeout(200)
    recs=pg.evaluate("[...document.querySelectorAll('.sheet.full .group-card')].map(c=>c.textContent).join(' ')")
    chk('recommendations rendered','Подходят' in pg.inner_text('.sheet.full') or 'доступна' in recs)
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
    pg.evaluate("OCM.setPlanMode(true);OCM.bus.emit('planMode')")
    pg.wait_for_timeout(150)
    chk('plan button visible when enabled',pg.locator('#composer .plan-btn:not(.hide)').count()==1)
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
        modelsByKind:{image:['vendor/image'],video:[],tts:[],music:[]},hasKey:true};
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
    # separate chat per kind: video thread must be empty
    pg.evaluate("OCM.back();OCM.openMedia('video')")
    pg.wait_for_timeout(200)
    chk('video chat is separate',pg.locator('.media-bubble').count()==0)
    chk('video empty state','Новый чат' in pg.inner_text('.sheet.full'))
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
    chk('tour first step','Чат с агентом' in pg.inner_text('.sheet'))
    pg.click('.sheet button:has-text("Далее")')
    pg.wait_for_timeout(150)
    chk('tour advances','Проекты' in pg.inner_text('.sheet'))
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
    au=pg.inner_text('.sheet.full')
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
    # ---- smart assistant commands ----
    sm=pg.evaluate("""() => {
      const c=t=>(OCM.parseAssistant(t)||[]).map(s=>s.cmd);
      const a=(t,i)=>(OCM.parseAssistant(t)||[])[0].args[i||0];
      return {scrollD:c('прокрути вниз'),scrollU:c('scroll up'),find:c('найди Миша'),
        wait:c('подожди 3'),waitArg:a('подожди 3'),chain:c('открой телеграм и найди Миша')};
    }""")
    chk('smart scroll down',sm['scrollD']==['scroll'])
    chk('smart scroll up en',sm['scrollU']==['scroll'])
    chk('smart find',sm['find']==['find'])
    chk('smart wait',sm['wait']==['wait'] and sm['waitArg']=='3000')
    chk('smart chain open+find',sm['chain']==['open','find'])
    # ---- arena + translit ----
    chk('arena helpers',pg.evaluate("typeof OCM.openArena==='function'&&typeof OCM.arenaPickFour==='function'&&typeof OCM.arenaJudge==='function'"))
    four=pg.evaluate("OCM.arenaPickFour().length")
    chk('arena picks 4',four==4)
    chk('arena judge exists',pg.evaluate("OCM.arenaJudge()")!=None)
    tr=pg.evaluate("""() => ({
      t1:OCM.translit('telegram'),t2:OCM.translit('телеграм'),
      m:OCM.appMatch('телеграм',['Telegram','WhatsApp','Настройки']),
      m2:OCM.appMatch('telegram',['Телеграм','WhatsApp']),
      m3:OCM.appMatch('ватсап',['WhatsApp','Telegram'])
    })""")
    chk('translit latin->cyr',tr['t1']=='телеграм')
    chk('translit cyr->lat',tr['t2']=='telegram')
    chk('fuzzy match cyr query',tr['m']=='Telegram')
    chk('fuzzy match lat query',tr['m2']=='Телеграм')
    chk('fuzzy match ватсап',tr['m3']=='WhatsApp')
    ab=pg.evaluate("""() => ({
      tg:OCM.appMatch('тг',['Telegram','WhatsApp']),
      mine:OCM.appMatch('майн',['Minecraft','Telegram']),
      insta:OCM.appMatch('инста',['Instagram','VK']),
      tele:OCM.appMatch('Теле',['Telegram','Teams']),
      wa:OCM.appMatch('wa',['WhatsApp','Wallet']),
      yt:OCM.appMatch('ют',['YouTube','Yandex']),
      ds:OCM.appMatch('дс',['Discord','Settings']),
      partial:OCM.appMatch(' Whats',['WhatsApp','Wallet'])
    })""")
    chk('abbrev тг',ab['tg']=='Telegram')
    chk('abbrev майн',ab['mine']=='Minecraft')
    chk('abbrev инста',ab['insta']=='Instagram')
    chk('partial Теле',ab['tele']=='Telegram')
    chk('abbrev wa',ab['wa']=='WhatsApp')
    chk('abbrev ют',ab['yt']=='YouTube')
    chk('abbrev дс',ab['ds']=='Discord')
    chk('partial Whats',ab['partial']=='WhatsApp')
    bi=pg.evaluate("""() => {
      const c=t=>(OCM.parseAssistant(t)||[]).map(s=>s.cmd);
      return {shot:c('take a screenshot'),home:c('go home'),torch:c('turn on flashlight'),open:c('open telegram')};
    }""")
    chk('bilingual screenshot',bi['shot']==['shot'])
    chk('bilingual home',bi['home']==['home'])
    chk('bilingual flashlight',bi['torch']==['torch'])
    chk('bilingual open',bi['open']==['open'])
    # ---- phone assistant ----
    asres=pg.evaluate("""() => {
      const chain=OCM.parseAssistant('открой телеграм и в нем открой чат Миша');
      return {chain:chain.map(s=>s.cmd),name:chain[1].args[0],
        shot:OCM.parseAssistant('сделай скриншот')[0].cmd,
        torch:OCM.parseAssistant('выключи фонарик')[0].args[0],
        macro:OCM.parseAssistant('игровой режим')[0].cmd,
        unknown:OCM.parseAssistant('объясни квантовую физику')};
    }""")
    chk('assistant chain parse',asres['chain']==['open','text'])
    chk('assistant keeps name case',asres['name']=='Миша')
    chk('assistant screenshot',asres['shot']=='shot')
    chk('assistant torch off',asres['torch']=='off')
    chk('assistant macro by name',asres['macro']=='macro')
    chk('assistant unknown goes to agent',asres['unknown'] is None)
    tol=pg.evaluate("""() => {
      const c=t=>(OCM.parseAssistant(t)||[]).map(s=>s.cmd);
      return {shot:c('сделай скриншот пожалуйста'),torch:c('вруби фонарик'),
        home:c('на главный экран'),yt:c('открой ютуб'),bare:c('телеграм'),
        macro:c('включи ночной режим'),chain:c('открой телеграм и в нем открой чат Миша')};
    }""")
    chk('tolerant: screenshot+please',tol['shot']==['shot'])
    chk('tolerant: вруби фонарик',tol['torch']==['torch'])
    chk('tolerant: главный экран',tol['home']==['home'])
    chk('tolerant: ютуб',tol['yt']==['open'])
    chk('tolerant: bare app name',tol['bare']==['open'])
    chk('tolerant: macro verb',tol['macro']==['macro'])
    chk('tolerant: chain',tol['chain']==['open','text'])
    chk('macro mirror bridge',pg.evaluate("typeof window.OC.setPref")=='function')
    pg.evaluate("OCM.saveMacros([{id:'t',name:'Тест',steps:[{cmd:'home',args:[]}]}])")
    chk('macros mirrored to native',pg.evaluate("(window.__prefs||{})['assistant_macros']||''").find('Тест')>=0)
    pg.evaluate("OCM.openAssistant()")
    pg.wait_for_selector('.sheet.full:has-text("Ассистент телефона")')
    at=pg.inner_text('.sheet.full')
    chk('assistant sheet quick actions','Скриншот' in at and 'Фонарик' in at)
    chk('assistant macros listed','Игровой режим' in at)
    pg.evaluate("OCM.back()")
    pg.evaluate("OCM.openAssistantSettings()")
    pg.wait_for_selector('.sheet.full:has-text("Настройки ассистента")')
    ast=pg.inner_text('.sheet.full')
    chk('assistant settings wake phrase','Кодовая фраза' in ast)
    chk('assistant settings permissions','Accessibility' in ast)
    chk('assistant control center sections','Интеллект' in ast and 'Разрешения' in ast and 'Голос' in ast)
    chk('assistant session helper',pg.evaluate("typeof OCM.assistantSession==='function'&&typeof OCM.assistantSend==='function'"))
    pg.evaluate("OCM.back()")
    pg.evaluate("OCM.openInstalledApps()")
    pg.wait_for_selector('.sheet.full:has-text("Установленные приложения")')
    ia=pg.inner_text('.sheet.full')
    chk('installed apps listed','Telegram' in ia)
    pg.evaluate("OCM.back()")
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
    chk('settings: phone assistant row','Ассистент телефона' in st)
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
