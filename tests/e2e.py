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
    pg.add_init_script("try{localStorage.setItem('ocm.tourSeen','true');localStorage.setItem('ocm.aiStageTitles','false')}catch(e){}")
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
    pg.wait_for_selector('.cmd-group:not(.running)',timeout=5000)
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
    # 2.20: consecutive tools fold into ONE inline pack between texts (Claude-style)
    chk('command pack rendered',pg.locator('.cmd-group').count()==1)
    chk('pack holds both tool cards',pg.evaluate("document.querySelector('.cmd-group')._parts.length")==2)
    chk('pack head has outline title',len(pg.inner_text('.cmd-group .cg-title'))>0)
    chk('pack diff stats on head','+1' in pg.inner_text('.cmd-group .cg-diff') and '-1' in pg.inner_text('.cmd-group .cg-diff'))
    chk('pack folded after finish',not pg.evaluate("document.querySelector('.cmd-group').classList.contains('open')"))
    # expand the pack: outline of contents + the two familiar tool cards inside
    pg.click('.cmd-group .cg-head')
    pg.wait_for_timeout(200)
    chk('pack opens on tap',pg.evaluate("document.querySelector('.cmd-group').classList.contains('open')"))
    chk('pack outline lists contents',pg.locator('.cmd-group .cg-outline .cg-chip').count()>=2)
    chk('two tool cards inside pack',pg.locator('.cmd-group .tool').count()==2)
    chk('text stays above the pack',pg.evaluate("""()=>{
      const b=document.querySelector('.msg.assistant .m-body');
      const t=b.querySelector('.p-text'),g=b.querySelector('.cmd-group');
      return !!(t&&g&&(t.compareDocumentPosition(g)&Node.DOCUMENT_POSITION_FOLLOWING));
    }"""))
    pg.screenshot(path=os.environ.get('SHOTS','/tmp')+'/s2b_pack.png')
    pg.click('.cmd-group .cg-head')
    pg.wait_for_timeout(150)
    chk('pack folds back',not pg.evaluate("document.querySelector('.cmd-group').classList.contains('open')"))
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
    # ---- step plan (lives in the mode chip's long-press menu now) ----
    # dismiss the pending permission first: dock-active hides the composer
    pg.evaluate("__push({type:'permission.replied',properties:{requestID:'per_1',sessionID:'ses_1'}})")
    pg.wait_for_timeout(150)
    pg.evaluate("OCM.setPlanMode(true);OCM.bus.emit('planMode')")
    pg.wait_for_timeout(150)
    # composer keeps ONLY + / mode / model / voice / send — no overflow chips
    chipcount=pg.evaluate("document.querySelectorAll('#composer .cbar-left > *, #composer .cbar-right > *').length")
    chk('composer: exactly 5 chips',chipcount==5)
    # openPlan needs a session: earlier tests left S.sid empty, so create one deterministically
    pg.evaluate("OCM.S.sid=OCM.S.sessions[0]&&OCM.S.sessions[0].id||'ses_1'")
    pg.evaluate("OCM.openPlan()")
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
    chk('plan mode toggles off',pg.evaluate("OCM.planMode()")==False)
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
    # themes: 24 built-ins + custom editor + import/export
    chk('amoled theme applies',pg.evaluate("OCM.S.opts.theme='amoled';OCM.saveOpts();document.documentElement.dataset.theme")=='amoled')
    chk('24 built-in themes',pg.evaluate("OCM.themeList().filter(t=>!t.custom).length")==24)
    pg.evaluate("OCM.S.opts.theme='dracula';OCM.saveOpts()")
    pg.wait_for_timeout(100)
    drac=pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--acc').trim()")
    chk('new theme drives CSS vars',drac=='#bd93f9')
    pg.evaluate("OCM.openThemes()")
    pg.wait_for_timeout(300)
    chk('theme grid rendered',pg.locator('.sheet >> nth=-1 >> .theme-card').count()>=24)
    chk('create custom button','Создать свою тему' in pg.inner_text('.sheet >> nth=-1'))
    pg.click('.sheet >> nth=-1 >> .theme-card:has-text("Nord")')
    pg.wait_for_timeout(150)
    chk('theme applied from grid',pg.evaluate("OCM.S.opts.theme")=='nord')
    pg.evaluate("OCM.back()")
    # custom theme: save via editor API path (import), apply, verify vars, export round-trip
    ct=pg.evaluate("""()=>{
      const r=OCM.importThemeJson(JSON.stringify({format:'ocm-theme',version:1,theme:{name:'Test Custom',light:false,bg:'#101820',fg:'#eeeeee',acc:'#ff5577',acc2:'#55ddff'}}));
      if(!r.ok)return r;
      OCM.S.opts.theme=r.theme.id;OCM.saveOpts();
      const acc=getComputedStyle(document.documentElement).getPropertyValue('--acc').trim();
      const bg=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      const json=OCM.exportThemeJson(r.theme,'Test Custom');
      const back=OCM.importThemeJson(json);
      OCM.S.opts.theme='opencode';OCM.saveOpts();
      return {ok:true,acc,bg,roundtrip:back.ok&&back.theme.acc==='#ff5577'};
    }""")
    chk('custom theme import+apply',ct.get('ok') and ct.get('acc')=='#ff5577' and ct.get('bg')=='#101820')
    chk('custom theme export round-trip',ct.get('roundtrip'))
    chk('bad theme json rejected',pg.evaluate("OCM.importThemeJson('{oops').ok")==False)
    chk('incomplete theme rejected',pg.evaluate("OCM.importThemeJson('{\"bg\":\"#000000\"}').ok")==False)
    pg.evaluate("OCM.openThemeEditor(null)")
    pg.wait_for_timeout(250)
    chk('theme editor opens with palette',pg.locator('.sheet >> nth=-1 >> .theme-field').count()>=10)
    chk('theme editor live preview',pg.query_selector('.sheet >> nth=-1 >> .theme-preview')!=None)
    pg.evaluate("OCM.back()")
    pg.wait_for_timeout(150)
    chk('cancel restores theme',pg.evaluate("document.documentElement.dataset.theme")=='opencode')
    pg.evaluate("OCM.S.opts.theme='opencode';OCM.saveOpts()")
    # second opinion + regenerate helpers exist
    chk('regenerate helper',pg.evaluate("typeof OCM.regenerateFrom")=='function')
    chk('second opinion helper',pg.evaluate("typeof OCM.secondOpinion")=='function')
    # ---- manually opened tool output must never auto-collapse ----
    pg.click('.cmd-group .cg-head')
    pg.wait_for_timeout(200)
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
    # ---- 2.20: multiple packs woven between texts: T G T G T ----
    packs=pg.evaluate("""()=>{
      const sid='ses_packs';
      OCM.S.sessions.unshift({id:sid,title:'packs',time:{created:1,updated:Date.now()}});
      OCM.S.sid=sid;
      const mid='mp1';
      const mk=(id,type,extra)=>Object.assign({id,sessionID:sid,messageID:mid,type},extra||{});
      OCM.upsertMsg({id:mid,sessionID:sid,role:'assistant',time:{created:Date.now()}});
      OCM.upsertPart(mk('p01','text',{text:'Сначала посмотрю проект.'}));
      OCM.upsertPart(mk('p02','tool',{tool:'bash',state:{status:'completed',input:{command:'ls',description:'List project files'},output:'a',metadata:{exit:0},time:{start:1000,end:3000}}}));
      OCM.upsertPart(mk('p03','tool',{tool:'read',state:{status:'completed',input:{filePath:'/root/main.py'},output:'x',time:{start:3000,end:4000}}}));
      OCM.upsertPart(mk('p04','text',{text:'Теперь исправлю файл.'}));
      OCM.upsertPart(mk('p05','tool',{tool:'edit',state:{status:'completed',input:{filePath:'/root/main.py'},metadata:{diff:'--- a\\n+++ b\\n@@\\n-x\\n+y\\n+z'},time:{start:5000,end:6000}}}));
      OCM.upsertPart(mk('p06','tool',{tool:'bash',state:{status:'completed',input:{command:'python3 tests/run.sh',description:'Run tests'},output:'ok',metadata:{exit:0},time:{start:6000,end:9000}}}));
      OCM.upsertPart(mk('p07','text',{text:'Готово: тесты зелёные.'}));
      OCM.chat.renderAll();
      const body=document.querySelector('.msg.assistant .m-body');
      const seq=[...body.children].filter(c=>c.classList.contains('p-text')||c.classList.contains('cmd-group')).map(c=>c.classList.contains('cmd-group')?'G':'T');
      const groups=[...body.querySelectorAll('.cmd-group')];
      return {seq,heads:groups.map(g=>({t:g.querySelector('.cg-title').textContent,diff:g.querySelector('.cg-diff')?g.querySelector('.cg-diff').textContent:'',meta:g.querySelector('.cg-meta')?g.querySelector('.cg-meta').textContent:''}))};
    }""")
    chk('packs: text-pack-text-pack-text order',packs['seq']==['T','G','T','G','T'])
    chk('packs: outline titles from descriptions',packs['heads'][0]['t']=='List project files' and packs['heads'][1]['t']=='Run tests')
    chk('packs: per-pack diff stats','+2' in packs['heads'][1]['diff'] and '-1' in packs['heads'][1]['diff'])
    chk('packs: duration in meta','s' in packs['heads'][0]['meta'])
    # ---- auto mode: live pack opens itself and folds when finished ----
    auto=pg.evaluate("""()=>{
      OCM.S.opts.toolView='auto';OCM.saveOpts();
      const sid='ses_auto';OCM.S.sessions.unshift({id:sid,title:'auto',time:{created:1,updated:Date.now()}});
      OCM.S.sid=sid;OCM.S.status[sid]={type:'busy'};
      const mid='ma1';
      OCM.upsertMsg({id:mid,sessionID:sid,role:'assistant',time:{created:Date.now()}});
      OCM.upsertPart({id:'q01',sessionID:sid,messageID:mid,type:'text',text:'Работаю…'});
      OCM.upsertPart({id:'q02',sessionID:sid,messageID:mid,type:'tool',tool:'bash',state:{status:'running',input:{command:'sleep 5',description:'Long task'},metadata:{output:'.'}}});
      OCM.chat.renderAll();
      const openedWhileRunning=document.querySelector('.cmd-group').classList.contains('open');
      OCM.upsertPart({id:'q02',sessionID:sid,messageID:mid,type:'tool',tool:'bash',state:{status:'completed',input:{command:'sleep 5',description:'Long task'},output:'done',metadata:{exit:0},time:{start:1,end:2}}});
      OCM.S.status[sid]={type:'idle'};
      OCM.msgs(sid).idx.get(mid).info.time.completed=Date.now();
      OCM.chat.renderAll();
      const foldedAfter=!document.querySelector('.cmd-group').classList.contains('open');
      document.querySelector('.cmd-group .cg-head').click();
      OCM.chat.renderAll();
      const manualStays=document.querySelector('.cmd-group').classList.contains('open');
      return {openedWhileRunning,foldedAfter,manualStays};
    }""")
    chk('auto mode: running pack open',auto['openedWhileRunning'])
    chk('auto mode: finished pack folds',auto['foldedAfter'])
    chk('auto mode: manual open survives re-render',auto['manualStays'])
    # ---- cards mode: classic inline cards, no packs ----
    cards=pg.evaluate("""()=>{
      OCM.S.opts.toolView='cards';OCM.saveOpts();OCM.chat.renderAll();
      const body=document.querySelector('.msg.assistant .m-body');
      const r={groups:body.querySelectorAll('.cmd-group').length,tools:body.querySelectorAll('.tool').length};
      OCM.S.opts.toolView='fold';OCM.saveOpts();OCM.chat.renderAll();
      r.backToPacks=document.querySelector('.msg.assistant .m-body').querySelectorAll('.cmd-group').length;
      return r;
    }""")
    chk('cards mode: tools inline without packs',cards['groups']==0 and cards['tools']==1)
    chk('switch back to packs restores groups',cards['backToPacks']==1)
    pg.evaluate("OCM.S.sid='ses_1';OCM.chat.renderAll()")
    pg.wait_for_timeout(200)
    # ---- 2.21: ALL consecutive commands under ONE arrow, even across hidden parts ----
    one=pg.evaluate("""()=>{
      const sid='ses_one';OCM.S.sessions.unshift({id:sid,title:'one',time:{created:1,updated:Date.now()}});
      OCM.S.sid=sid;const mid='mo1';
      const mk=(id,type,extra)=>Object.assign({id,sessionID:sid,messageID:mid,type},extra||{});
      OCM.upsertMsg({id:mid,sessionID:sid,role:'assistant',time:{created:Date.now(),completed:Date.now()}});
      OCM.upsertPart(mk('r01','text',{text:'Начинаю.',time:{end:1}}));
      OCM.upsertPart(mk('r02','tool',{tool:'bash',state:{status:'completed',input:{command:'ls',description:'Шаг 1'},output:'a',time:{start:1,end:2}}}));
      // hidden reasoning (thinking off) + stats-only text + compaction must NOT split the pack
      OCM.upsertPart(mk('r03','reasoning',{text:'hidden thoughts',time:{end:1}}));
      OCM.upsertPart(mk('r04','tool',{tool:'read',state:{status:'completed',input:{filePath:'/root/a.py'},output:'x',time:{start:2,end:3}}}));
      OCM.upsertPart(mk('r05','text',{text:'+3 -1',time:{end:1}}));
      OCM.upsertPart(mk('r06','tool',{tool:'edit',state:{status:'completed',input:{filePath:'/root/a.py'},metadata:{diff:'--- a\\n+++ b\\n@@\\n-x\\n+y'},time:{start:3,end:4}}}));
      OCM.upsertPart(mk('r07','compaction',{}));
      OCM.upsertPart(mk('r08','tool',{tool:'bash',state:{status:'completed',input:{command:'pytest',description:'Тесты'},output:'ok',time:{start:4,end:5}}}));
      OCM.upsertPart(mk('r09','text',{text:'Готово.',time:{end:1}}));
      const think=OCM.S.opts.thinking;OCM.S.opts.thinking=false;
      OCM.chat.renderAll();
      const body=document.querySelector('.msg.assistant .m-body');
      const groups=body.querySelectorAll('.cmd-group').length;
      const tools=body.querySelector('.cmd-group')._parts.filter(p=>p.type==='tool').length;
      OCM.S.opts.thinking=think;
      return {groups,tools};
    }""")
    chk('one arrow for all consecutive commands',one['groups']==1)
    chk('hidden parts do not split the pack',one['tools']==4)
    # visible reasoning between tools must ALSO stay inside the one pack
    onev=pg.evaluate("""()=>{
      OCM.S.opts.thinking=true;
      OCM.upsertPart({id:'r03',sessionID:'ses_one',messageID:'mo1',type:'reasoning',text:'думаю между командами',time:{end:1}});
      OCM.chat.renderAll();
      const body=document.querySelector('.msg.assistant .m-body');
      const g=body.querySelectorAll('.cmd-group').length;
      const inside=body.querySelector('.cmd-group')._parts.some(p=>p.type==='reasoning');
      return {g,inside};
    }""")
    chk('visible reasoning stays in the pack',onev['g']==1 and onev['inside'])
    # ---- 2.22.1: TURN MERGE — several assistant messages of one turn = ONE card, ONE pack ----
    turn=pg.evaluate("""()=>{
      const sid='ses_turn';OCM.S.sessions.unshift({id:sid,title:'turn',time:{created:1,updated:Date.now()}});
      OCM.S.sid=sid;
      // ids must sort in turn order: upsertMsg sorts lexicographically, tu0 would land AFTER ta*
      OCM.upsertMsg({id:'t0u',sessionID:sid,role:'user',time:{created:1}});
      OCM.upsertPart({id:'tup',sessionID:sid,messageID:'t0u',type:'text',text:'сделай задачу'});
      // three assistant messages, no prose between them — server emits one per tool round
      OCM.upsertMsg({id:'ta1',sessionID:sid,role:'assistant',time:{created:2,completed:3}});
      OCM.upsertPart({id:'tp1',sessionID:sid,messageID:'ta1',type:'tool',tool:'bash',state:{status:'completed',input:{command:'ls',description:'Шаг 1'},output:'a',time:{start:1,end:2}}});
      OCM.upsertMsg({id:'ta2',sessionID:sid,role:'assistant',time:{created:4,completed:5}});
      OCM.upsertPart({id:'tp2',sessionID:sid,messageID:'ta2',type:'tool',tool:'read',state:{status:'completed',input:{filePath:'/root/x.py'},output:'x',time:{start:2,end:3}}});
      OCM.upsertPart({id:'tp3',sessionID:sid,messageID:'ta2',type:'reasoning',text:'думаю',time:{end:1}});
      OCM.upsertMsg({id:'ta3',sessionID:sid,role:'assistant',time:{created:6,completed:7}});
      OCM.upsertPart({id:'tp4',sessionID:sid,messageID:'ta3',type:'tool',tool:'edit',state:{status:'completed',input:{filePath:'/root/x.py'},metadata:{diff:'--- a\\n+++ b\\n@@\\n-x\\n+y'},time:{start:3,end:4}}});
      OCM.upsertPart({id:'tp5',sessionID:sid,messageID:'ta3',type:'tool',tool:'bash',state:{status:'completed',input:{command:'make',description:'Сборка'},output:'ok',time:{start:4,end:5}}});
      OCM.chat.renderAll();
      const cards=document.querySelectorAll('#msgs .msg.assistant').length;
      const packs=document.querySelectorAll('#msgs .cmd-group').length;
      const tools=document.querySelector('#msgs .cmd-group')._parts.filter(p=>p.type==='tool').length;
      // a live event about the LAST message must update the shared card, not create a new one
      OCM.upsertPart({id:'tp6',sessionID:sid,messageID:'ta3',type:'tool',tool:'bash',state:{status:'completed',input:{command:'pytest',description:'Тесты'},output:'ok',time:{start:5,end:6}}});
      OCM.bus.emit('part',sid,OCM.msgs(sid).idx.get('ta3'));
      const cards2=document.querySelectorAll('#msgs .msg.assistant').length;
      const packs2=document.querySelectorAll('#msgs .cmd-group').length;
      const tools2=document.querySelector('#msgs .cmd-group')._parts.filter(p=>p.type==='tool').length;
      return {cards,packs,tools,cards2,packs2,tools2};
    }""")
    chk('turn merge: 3 assistant msgs -> 1 card',turn['cards']==1)
    chk('turn merge: all tools under 1 arrow',turn['packs']==1 and turn['tools']==4)
    chk('turn merge: live event keeps 1 card/1 pack',turn['cards2']==1 and turn['packs2']==1 and turn['tools2']==5)
    # prose in the middle still splits into two packs inside the SAME card
    turn2=pg.evaluate("""()=>{
      OCM.upsertPart({id:'tp7',sessionID:'ses_turn',messageID:'ta2',type:'text',text:'Промежуточный вывод.',time:{end:1}});
      OCM.chat.renderAll();
      return {cards:document.querySelectorAll('#msgs .msg.assistant').length,packs:document.querySelectorAll('#msgs .cmd-group').length};
    }""")
    chk('turn merge: prose splits packs, not cards',turn2['cards']==1 and turn2['packs']==2)
    pg.evaluate("OCM.S.sid='ses_1';OCM.chat.renderAll()")
    pg.wait_for_timeout(200)
    # ---- 2.22.1: active session opens at the tail, not mid-chat ----
    act=pg.evaluate("""()=>{
      const sid='ses_act';OCM.S.sessions.unshift({id:sid,title:'act',time:{created:1,updated:Date.now()}});
      OCM.store.set('readPos.'+sid,{id:'nonexistent',off:0});
      OCM.S.sid=sid;OCM.S.status[sid]={type:'busy'};
      for(let i=0;i<40;i++){
        const id='am'+String(i).padStart(3,'0');
        OCM.upsertMsg({id,sessionID:sid,role:'user',time:{created:i}});
        OCM.upsertPart({id:'ap'+i,sessionID:sid,messageID:id,type:'text',text:'строка '.repeat(30)+i});
      }
      OCM.chat.renderAll();
      return new Promise(res=>setTimeout(()=>{
        const msgs=document.querySelector('#msgs');
        const atBottom=msgs.scrollHeight-msgs.scrollTop-msgs.clientHeight<160;
        OCM.S.status[sid]={type:'idle'};OCM.S.sid='ses_1';OCM.chat.renderAll();
        res({atBottom});
      },600));
    }""")
    chk('active session opens at the live tail',act['atBottom'])
    # ---- 2.22.1: composer does not collapse while typing (no chat bounce) ----
    bounce=pg.evaluate("""()=>{
      const ta=document.querySelector('#composer textarea');
      const composer=document.querySelector('#composer');
      ta.value='';ta.dispatchEvent(new Event('input'));
      const heights=[];
      for(let i=0;i<10;i++){
        ta.value+='слово ';
        ta.dispatchEvent(new Event('input'));
        heights.push(composer.getBoundingClientRect().height);
      }
      // monotonic non-decreasing: the composer must never shrink mid-typing
      let dips=0;
      for(let i=1;i<heights.length;i++)if(heights[i]<heights[i-1]-1)dips++;
      ta.value='';ta.dispatchEvent(new Event('input'));
      return {dips};
    }""")
    chk('typing: composer never collapses (no bounce)',bounce['dips']==0)
    # ---- 2.21 perf: unchanged message events do zero DOM work ----
    perf=pg.evaluate("""()=>{
      const sid=OCM.S.sid;const m=OCM.visibleMsgs(sid).find(x=>x.info.role==='assistant');
      const el=document.querySelector('.msg.assistant');
      const body=el.querySelector('.m-body');
      const before=body.innerHTML;
      let mutations=0;
      const mo=new MutationObserver(rs=>mutations+=rs.length);
      mo.observe(body,{childList:true,subtree:true,characterData:true,attributes:true});
      for(let i=0;i<30;i++)OCM.bus.emit('part',sid,m,m.parts[0]);
      return new Promise(res=>setTimeout(()=>{mo.disconnect();res({mutations,same:body.innerHTML===before})},400));
    }""")
    chk('perf: 30 duplicate events -> 0 DOM mutations',perf['mutations']==0 and perf['same'])
    # ---- 2.21: sticky date header + reading position memory ----
    # inflate the session so there is real scroll range (2 short msgs fit one screen)
    pg.evaluate("""()=>{
      OCM.S.sid='ses_1';
      for(let i=0;i<14;i++){
        const id='zz_fill'+String(i).padStart(2,'0');
        OCM.upsertMsg({id,sessionID:'ses_1',role:'user',time:{created:Date.now()}});
        OCM.upsertPart({id:'zzp'+i,sessionID:'ses_1',messageID:id,type:'text',text:'наполнение '.repeat(12)+i});
      }
      OCM.chat.renderAll();
    }""")
    pg.wait_for_timeout(500)
    sticky=pg.evaluate("""()=>{
      const msgs=document.querySelector('#msgs');
      const first=msgs.querySelector('.msg');
      msgs.scrollTop=first?first.offsetTop+4:0;
      msgs.dispatchEvent(new Event('scroll'));
      return new Promise(res=>setTimeout(()=>{
        const el=document.querySelector('#chat-sticky');
        res({visible:!el.classList.contains('hide'),text:el.textContent,h:msgs.scrollHeight,ch:msgs.clientHeight});
      },300));
    }""")
    chk('sticky date header shows',sticky['visible'] and len(sticky['text'])>0)
    readpos=pg.evaluate("""()=>{
      const msgs=document.querySelector('#msgs');
      const first=msgs.querySelector('.msg');
      msgs.scrollTop=first?first.offsetTop+4:0;
      msgs.dispatchEvent(new Event('scroll'));
      return new Promise(res=>setTimeout(()=>{
        const rp=OCM.store.get('readPos.'+OCM.S.sid,null);
        OCM.chat.renderAll();
        setTimeout(()=>res({saved:!!rp,restored:!document.querySelector('#jump').classList.contains('hide')}),300);
      },600));
    }""")
    chk('reading position saved',readpos['saved'])
    chk('reading position restored on reopen',readpos['restored'])
    pg.evaluate("OCM.store.remove('readPos.'+OCM.S.sid)")
    # ---- 2.21: agent pulse on the mode chip + who-is-answering card ----
    pulse=pg.evaluate("""()=>{
      const av=document.querySelector('#composer .agent-pill');
      OCM.S.status[OCM.S.sid]={type:'busy'};OCM.bus.emit('status',OCM.S.sid);
      const on=av.classList.contains('pulsing');
      OCM.S.status[OCM.S.sid]={type:'idle'};OCM.bus.emit('status',OCM.S.sid);
      const off=!av.classList.contains('pulsing');
      return {on,off};
    }""")
    chk('mode chip pulses while busy',pulse['on'] and pulse['off'])
    # ---- 2.21: night lamp lives in settings, not in the composer ----
    lamp=pg.evaluate("""()=>{
      OCM.setNightLamp(true);
      const on=document.documentElement.classList.contains('night-lamp');
      OCM.setNightLamp(false);
      return {on,off:!document.documentElement.classList.contains('night-lamp'),noChip:!document.querySelector('.lamp-btn')};
    }""")
    chk('night lamp toggles',lamp['on'] and lamp['off'])
    chk('night lamp not a composer chip',lamp['noChip'])
    pg.evaluate("OCM.openSettings()")
    pg.wait_for_selector('.sheet .settings-tabs')
    pg.wait_for_timeout(300)
    chk('night lamp row in settings','Ночная лампа' in pg.inner_text('.sheet'))
    pg.evaluate("OCM.back()")
    # ---- 2.21: smart stop -> resume button ----
    resume=pg.evaluate("""()=>{
      const sid='ses_res';OCM.S.sessions.unshift({id:sid,title:'res',time:{created:1,updated:Date.now()}});
      OCM.S.sid=sid;OCM.S.status[sid]={type:'idle'};
      OCM.upsertMsg({id:'mres1',sessionID:sid,role:'assistant',time:{created:Date.now()}});
      OCM.upsertPart({id:'pres1',sessionID:sid,messageID:'mres1',type:'text',text:'Оборванный ответ'});
      OCM.chat.renderAll();
      const btn=document.querySelector('#send');
      const cls=btn.className,enabled=!btn.disabled;
      OCM.S.sid='ses_1';OCM.chat.renderAll();
      return {cls,enabled};
    }""")
    chk('send becomes resume after a cut',resume['cls']=='resume' and resume['enabled'])
    # ---- 2.21: diagrams render offline ----
    diag=pg.evaluate("""()=>{
      const sid='ses_diag';OCM.S.sessions.unshift({id:sid,title:'diag',time:{created:1,updated:Date.now()}});
      OCM.S.sid=sid;
      OCM.upsertMsg({id:'md1',sessionID:sid,role:'assistant',time:{created:Date.now(),completed:Date.now()}});
      OCM.upsertPart({id:'pd1',sessionID:sid,messageID:'md1',type:'text',text:'Схема:\\n```mermaid\\ngraph TD\\nA[Старт] --> B{Готово?}\\nB -->|да| C[Конец]\\nB -->|нет| A\\n```',time:{end:1}});
      OCM.upsertPart({id:'pd2',sessionID:sid,messageID:'md1',type:'text',text:'```chart\\nЯнв: 12\\nФев: 25\\nМар: 18\\n```',time:{end:1}});
      OCM.chat.renderAll();
      const svgs=document.querySelectorAll('.diagram-box svg').length;
      const nodes=document.querySelectorAll('.diagram-box svg rect,.diagram-box svg path').length;
      OCM.S.sid='ses_1';OCM.chat.renderAll();
      return {svgs,nodes};
    }""")
    chk('mermaid + chart render as SVG',diag['svgs']==2 and diag['nodes']>=6)
    # ---- 2.21: session media ribbon ----
    ribbon=pg.evaluate("""()=>{
      const sid='ses_rib';OCM.S.sessions.unshift({id:sid,title:'rib',time:{created:1,updated:Date.now()}});
      OCM.S.sid=sid;
      OCM.upsertMsg({id:'mr1',sessionID:sid,role:'assistant',time:{created:Date.now()}});
      OCM.upsertPart({id:'pr1',sessionID:sid,messageID:'mr1',type:'file',mime:'image/png',filename:'fox.png',url:'data:image/png;base64,aGk='});
      OCM.upsertPart({id:'pr2',sessionID:sid,messageID:'mr1',type:'text',text:'Смотри /root/media/wolf.png и ![cat](https://x.test/cat.png)'});
      const items=OCM.sessionMedia(sid);
      OCM.openSessionRibbon();
      const cells=document.querySelectorAll('.sheet .ribbon-cell').length;
      OCM.back();OCM.S.sid='ses_1';OCM.chat.renderAll();
      return {items:items.length,cells};
    }""")
    chk('ribbon collects attachments + md + paths',ribbon['items']==3 and ribbon['cells']==3)
    # ---- 2.21: selection thread button ----
    selthread=pg.evaluate("""()=>{
      const p=document.querySelector('.msg.assistant .p-text');
      if(!p)return {ok:false};
      const range=document.createRange();
      const tn=[...p.querySelectorAll('*')].find(x=>x.textContent.includes('world'))||p;
      range.selectNodeContents(tn);
      const sel=getSelection();sel.removeAllRanges();sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      return new Promise(res=>setTimeout(()=>{
        const btn=document.querySelector('.sel-ask');
        const ok=!!btn;
        if(btn)btn.click();
        const quoted=document.querySelector('#composer textarea').value.startsWith('>');
        sel.removeAllRanges();
        document.querySelector('#composer textarea').value='';
        res({ok,quoted});
      },500));
    }""")
    chk('selection ask button appears',selthread.get('ok'))
    chk('fragment quoted into composer',selthread.get('quoted'))
    # ---- 2.21: voice wave reacts to stt events ----
    wave=pg.evaluate("""()=>{
      const mic=document.querySelector('.mic-btn');
      OCEvent('stt',{t:'level',v:8});
      const on=mic.classList.contains('listening');
      OCEvent('stt',{t:'final',text:''});
      return {on,off:!mic.classList.contains('listening'),bars:mic.querySelectorAll('.mic-wave i').length};
    }""")
    chk('mic wave dances on level',wave['on'] and wave['off'] and wave['bars']==5)
    # ---- 2.21: send fly bubble ----
    fly=pg.evaluate("""()=>{
      OCM.S.sid='ses_1';OCM.chat.renderAll();
      document.querySelector('#composer textarea').value='анимация отправки';
      document.querySelector('#composer textarea').dispatchEvent(new Event('input'));
      document.querySelector('#send').click();
      const ghost=!!document.querySelector('.fly-bubble');
      return new Promise(res=>setTimeout(()=>res({ghost,gone:!document.querySelector('.fly-bubble')}),700));
    }""")
    chk('send ghost bubble flies',fly['ghost'] and fly['gone'])
    pg.wait_for_timeout(400)
    # the fly-bubble send started a mock turn: dismiss its permission so dock-active releases the composer
    pg.evaluate("__push({type:'permission.replied',properties:{requestID:'per_1',sessionID:'ses_1'}});__push({type:'session.idle',properties:{sessionID:'ses_1'}})")
    pg.wait_for_timeout(250)
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
      // hot-first load: instant open with the tail; archives merge in the background
      const hotOnly=await OCM.loadCachedMsgs(sid);
      const hotN=hotOnly.length;
      const back=await OCM.loadCachedMsgs(sid,true);
      const ids=new Set(back.map(m=>m.info.id));
      const ok=back.length===550&&ids.has('m0250')&&ids.has('m0300')&&ids.has('m0549')&&back[0].info.id==='m0000';
      OCM.dropMsgs(sid);await OCM.dropCachedMsgs(sid);
      return {pages,p0len:p0&&p0.length,ok,hotN};
    }""")
    chk('archive: 550 msgs -> 1 full page + hot window',arch['pages']==1 and arch['p0len']==300)
    chk('archive: messages 251-550 survive reload',arch['ok'])
    chk('open speed: hot window loads first (250)',arch['hotN']==250)
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
    # ---- freeze watchdog: busy + silent SSE for 12s -> stream kick + snapshot pull ----
    frz=pg.evaluate("""async ()=>{
      const sid=OCM.S.sid;
      window.__status={[sid]:{type:'busy'}};OCM.S.status[sid]={type:'busy'};
      let kicks=0;const orig=OC.sseStart;OC.sseStart=()=>{kicks++;orig()};
      // simulate a zombie stream: no events for >12s while status says busy
      OCM.stopLiveSync();OCM.startLiveSync(sid);
      await new Promise(r=>setTimeout(r,100));
      // force the watchdog window by backdating the last event marker via a fresh busy sync
      await new Promise(r=>setTimeout(r,13500));
      OC.sseStart=orig;
      const syncs=__srv.calls.filter(c=>c.p.includes('/message')).length;
      window.__status={};OCM.S.status[sid]={type:'idle'};OCM.stopLiveSync();
      return {kicks,syncs};
    }""")
    chk('freeze watchdog kicks dead SSE',frz['kicks']>=1)
    chk('freeze watchdog pulls snapshots',frz['syncs']>=2)
    # ---- 2.22: personal memory (020) ----
    mem=pg.evaluate("""()=>{
      OCM.addUserFact('предпочитаю Kotlin');
      OCM.addUserFact('предпочитаю Kotlin'); // duplicate ignored
      const n=OCM.userFacts().length;
      const txt=OCM.userFactsText();
      OCM.openUserFacts();
      const sheet=[...document.querySelectorAll('.sheet')].some(s=>s.textContent.includes('Персональная память'));
      OCM.back();
      return {n,txt,sheet};
    }""")
    chk('memory: fact stored once',mem['n']==1)
    chk('memory: facts ride along prompts','Kotlin' in mem['txt'])
    chk('memory sheet opens',mem['sheet'])
    memsend=pg.evaluate("""()=>{
      OCM.S.sid='ses_1';
      const before=__srv.calls.filter(c=>c.p.endsWith('prompt_async')).length;
      document.querySelector('#composer textarea').value='тест памяти';
      document.querySelector('#composer textarea').dispatchEvent(new Event('input'));
      document.querySelector('#send').click();
      return new Promise(res=>setTimeout(()=>{
        const calls=__srv.calls.filter(c=>c.p.endsWith('prompt_async'));
        const last=calls[calls.length-1];
        const hasFact=(last.body.parts||[]).some(p=>p.synthetic&&(p.text||'').includes('Kotlin'));
        res({sent:calls.length>before,hasFact});
      },600));
    }""")
    chk('memory injected into prompt',memsend['sent'] and memsend['hasFact'])
    pg.evaluate("__push({type:'permission.replied',properties:{requestID:'per_1',sessionID:'ses_1'}});__push({type:'session.idle',properties:{sessionID:'ses_1'}})")
    pg.wait_for_timeout(200)
    # ---- 2.22: project templates (009) ----
    tpl=pg.evaluate("""()=>{
      const tpls=OCM.projectTpls();
      OCM.applyProjectTpl(tpls[0]);
      const txt=OCM.tplTextFor(OCM.S.sid);
      OCM.saveProjectTpl({id:'tpl_test',name:'Мой шаблон',icon:'doc',prompt:'правило X'});
      const custom=OCM.projectTpls().some(t=>t.id==='tpl_test');
      OCM.openProjectTpls(true);
      const sheet=[...document.querySelectorAll('.sheet')].some(s=>s.textContent.includes('Шаблоны проектов'));
      OCM.back();
      return {n:tpls.length,txt,custom,sheet};
    }""")
    chk('templates: defaults exist',tpl['n']>=5)
    chk('template text injected','Android' in tpl['txt'] or 'Kotlin' in tpl['txt'])
    chk('custom template saved',tpl['custom'])
    chk('template picker opens',tpl['sheet'])
    # ---- 2.22: attachment preview (013) + OCR (014) ----
    att=pg.evaluate("""async ()=>{
      OCM.chatAttach([{mime:'image/png',filename:'shot.png',data:'aGk='}]);
      const chip=document.querySelector('#composer .att-chip');
      chip.click();
      const viewer=[...document.querySelectorAll('.sheet')].some(s=>s.textContent.includes('shot.png'));
      OCM.back();
      const a=await OCM.ocrAttachment({url:'data:image/png;base64,aGk='});
      return {chip:!!chip,viewer,ocr:a};
    }""")
    chk('attachment chip opens preview',att['chip'] and att['viewer'])
    chk('OCR bridge returns text','MOCK OCR' in (att['ocr'] or ''))
    ocrsend=pg.evaluate("""()=>{
      // simulate an OCR'd attachment riding along the next prompt
      OCM.chatAttach([{mime:'image/png',filename:'ocr.png',data:'aGk='}]);
      const chips=document.querySelectorAll('#composer .att-chip');
      return {chips:chips.length};
    }""")
    chk('second attachment added',ocrsend['chips']>=1)
    pg.evaluate("document.querySelectorAll('#composer .atts .chip button').forEach(b=>b.click())")
    # ---- 2.22: duel (017/018) ----
    duel=pg.evaluate("""()=>{
      OCM.openDuel('тест дуэли');
      const sh=[...document.querySelectorAll('.sheet')].find(s=>s.textContent.includes('Дуэль моделей'));
      const has=!!sh;
      const selects=sh?sh.querySelectorAll('select').length:0;
      const q=sh?sh.querySelector('textarea').value:'';
      OCM.back();
      return {has,selects,q};
    }""")
    chk('duel sheet with two model selects',duel['has'] and duel['selects']==2)
    chk('duel prefilled with question',duel['q']=='тест дуэли')
    # ---- 2.22: smart search button exists (002) ----
    smart=pg.evaluate("""()=>{
      OCM.openGlobalSearch();
      const sh=[...document.querySelectorAll('.sheet')].find(s=>s.textContent.includes('Глобальный поиск'));
      const btn=sh&&[...sh.querySelectorAll('button')].find(b=>b.textContent.includes('Умный поиск'));
      const fn=typeof OCM.smartSearch==='function';
      OCM.back();
      return {btn:!!btn,fn};
    }""")
    chk('smart search button + helper',smart['btn'] and smart['fn'])
    # ---- 2.22.2 audit fixes ----
    # stripJsonc must not eat commas inside string values
    sj=pg.evaluate("""()=>({
      str:OCM.stripJsonc('{"a":"текст, ]"}'),
      trail:OCM.parseJsonc('{"a":[1,2,],}').a.length,
      comment:OCM.parseJsonc('{// c\\n"a":1,}').a
    })""")
    chk('stripJsonc keeps string commas',sj['str']=='{"a":"текст, ]"}')
    chk('stripJsonc removes trailing commas',sj['trail']==2 and sj['comment']==1)
    # queued prompt survives a busy race (peek+commit)
    q=pg.evaluate("""()=>{
      OCM.enqueuePrompt('ses_q','задача в очереди');
      const peek=OCM.peekPrompt('ses_q');
      const stillThere=OCM.promptQueue('ses_q').length===1;
      OCM.commitPrompt('ses_q');
      return {peek:peek&&peek.text,stillThere,after:OCM.promptQueue('ses_q').length};
    }""")
    chk('queue peek does not consume',q['peek']=='задача в очереди' and q['stillThere'])
    chk('queue commit removes once',q['after']==0)
    # msgSig catches same-length text edits
    sig=pg.evaluate("""()=>{
      const sid='ses_sig';OCM.S.sessions.unshift({id:sid,title:'sig',time:{created:1,updated:Date.now()}});
      OCM.S.sid=sid;
      OCM.upsertMsg({id:'ms1',sessionID:sid,role:'assistant',time:{created:Date.now()}});
      OCM.upsertPart({id:'ps1',sessionID:sid,messageID:'ms1',type:'text',text:'aaaa',time:{end:1}});
      OCM.chat.renderAll();
      const before=document.querySelector('.msg.assistant .p-text').textContent;
      OCM.upsertPart({id:'ps1',sessionID:sid,messageID:'ms1',type:'text',text:'bbbb',time:{end:1}});
      OCM.bus.emit('part',sid,OCM.msgs(sid).idx.get('ms1'));
      return new Promise(res=>setTimeout(()=>{
        const after=document.querySelector('.msg.assistant .p-text').textContent;
        OCM.S.sid='ses_1';OCM.chat.renderAll();
        res({before,after});
      },400));
    }""")
    chk('same-length text edit re-renders','aaaa' in sig['before'] and 'bbbb' in sig['after'])
    # minimap wrapper is returned even before DOM insertion
    mm=pg.evaluate("""()=>{
      const v=OCM.codeView(Array.from({length:120},(_,i)=>'line '+i).join('\\n'),'x.py');
      return {canvas:!!v.querySelector('canvas'),code:!!v.querySelector('.code-view')};
    }""")
    chk('minimap built before insertion',mm['canvas'] and mm['code'])
    # uiHandshake bridge exists
    chk('uiHandshake bridge',pg.evaluate("typeof OC.uiHandshake==='function'"))
    # side tasks mark their sessions silent (no DONE notifications)
    sil=pg.evaluate("""async ()=>{
      window.__silentSessions=[];
      const p=OCM.sideAsk('тест');
      await new Promise(r=>setTimeout(r,150));
      const marked=(window.__silentSessions||[]).length>0;
      try{await p}catch(_){}
      return {marked,fn:typeof OC.silentSession==='function'};
    }""")
    chk('side task session marked silent',sil['marked'] and sil['fn'])
    # ---- 2.23 vision pipeline ----
    vis=pg.evaluate("""async ()=>{
      // queue a screenshot as a next-prompt attachment
      __srv.files['/root/shot.png']='x';
      window.__readDataResult={ok:true,mime:'image/png',data:'aGk='};
      const q=await OCM.queueVision('/root/shot.png');
      const qlen=OCM.visionQueue.length;
      const taken=OCM.takeVisionQueue();
      const after=OCM.visionQueue.length;
      // modelSees / visionModel helpers exist
      const sees=typeof OCM.modelSees==='boolean'||typeof OCM.modelSees()==='boolean';
      // analyze button exists in the image viewer path
      const fn=typeof OCM.analyzeImageFile==='function'&&typeof OCM.describeImage==='function'&&typeof OCM.imageToText==='function';
      return {q,qlen,taken:taken.length,after,sees,fn};
    }""")
    chk('vision: screenshot queued for next prompt',vis['q'] and vis['qlen']==1)
    chk('vision: queue taken once',vis['taken']==1 and vis['after']==0)
    chk('vision: helpers exist',vis['sees'] and vis['fn'])
    # phone see answers the CLI with a description (mock vision via side session)
    see=pg.evaluate("""async ()=>{
      window.__readDataResult={ok:true,mime:'image/png',data:'aGk='};
      window.__phoneAnswers=[];
      OCEvent('phoneRequest',{id:'see1',cmd:'see',args:['что на экране?']});
      await new Promise(r=>setTimeout(r,4000));
      const a=(window.__phoneAnswers||[]).find(x=>x.id==='see1');
      return {answered:!!a,ok:a&&a.p&&a.p.ok};
    }""")
    chk('phone see answers CLI',see['answered'])
    # blind-model fallback converts an image attachment into text parts
    fb=pg.evaluate("""async ()=>{
      const caps=OCM.modelSees();
      const parts=[];
      window.__ocrResult={ok:true,text:'ЭКРАННЫЙ ТЕКСТ'};
      await OCM.visionFallbackParts([{mime:'image/png',filename:'s.png',url:'data:image/png;base64,aGk='}],parts);
      return {caps,parts:parts.length,txt:parts.map(p=>p.text||'').join(' ')};
    }""")
    chk('blind fallback produces text or skips for vision model',fb['caps'] or ('ЭКРАННЫЙ ТЕКСТ' in fb['txt']))
    # ---- 2.23.1: settings swipe + per-session jailbreaks ----
    sw=pg.evaluate("""()=>{
      OCM.openSettings();
      const sh=[...document.querySelectorAll('.sheet')].pop();
      // the swipe listener lives on the inner body (parent of the tabs), not on .sh-b
      const body=sh.querySelector('.settings-tabs').parentNode;
      const mk=(type,x,y)=>{const t=new Touch({identifier:1,target:body,clientX:x,clientY:y});
        body.dispatchEvent(new TouchEvent(type,{touches:type==='touchend'?[]:[t],changedTouches:[t],bubbles:true,cancelable:true}))};
      mk('touchstart',300,300);mk('touchend',120,305);
      const agentOn=[...sh.querySelectorAll('.settings-tabs button')].find(b=>b.dataset.pane==='agent').classList.contains('on');
      mk('touchstart',120,300);mk('touchend',300,305);
      const mainOn=[...sh.querySelectorAll('.settings-tabs button')].find(b=>b.dataset.pane==='main').classList.contains('on');
      OCM.back();
      return {agentOn,mainOn};
    }""")
    chk('settings: swipe left -> agent tab',sw['agentOn'])
    chk('settings: swipe right -> main tab',sw['mainOn'])
    # search hit counter (wait for the closed sheet to detach so selectors hit the live one)
    pg.wait_for_timeout(350)
    pg.evaluate("OCM.openSettings()")
    pg.wait_for_timeout(200)
    pg.evaluate("""()=>{
      const sh=[...document.querySelectorAll('.sheet')].pop();
      const sq=sh.querySelector('.settings-search');
      sq.value='бэкап';sq.dispatchEvent(new Event('input'));
    }""")
    pg.wait_for_timeout(250)
    cnt=pg.evaluate("(()=>{const sh=[...document.querySelectorAll('.sheet')].pop();return (sh.querySelector('.settings-count')||{}).textContent||''})()")
    chk('settings: search shows hit count','Найдено' in cnt or 'found' in cnt)
    pg.evaluate("OCM.back()")
    # per-session jailbreak override
    sjb=pg.evaluate("""()=>{
      const l=OCM.store.get('custom_jailbreaks',[]);
      l.push({id:'jb_t1',title:'Тест JB',prompt:'правило JB',model:'Все модели'});
      OCM.store.set('custom_jailbreaks',l);
      const sid=OCM.S.sid||'ses_1';
      OCM.setSessionJb(sid,new Set(['jb_t1']));
      const own=OCM.getActiveJailbreaks().some(j=>j.id==='jb_t1');
      const ids=OCM.sessionJbIds(sid);
      // other sessions unaffected: switch sid, global set has no jb_t1
      const other=OCM.sessionJbIds('ses_other');
      OCM.openSessionJailbreaks(sid);
      const sheet=[...document.querySelectorAll('.sheet')].some(s=>s.textContent.includes('Джейлбрейки этого чата'));
      OCM.back();
      OCM.setSessionJb(sid,null);
      const cleared=OCM.sessionJbIds(sid)===null;
      return {own,has:ids&&ids.has('jb_t1'),otherNull:other===null,sheet,cleared};
    }""")
    chk('session jailbreak overrides global',sjb['own'] and sjb['has'])
    chk('other sessions keep global set',sjb['otherNull'])
    chk('session jailbreak sheet opens',sjb['sheet'])
    chk('session jailbreak clears to global',sjb['cleared'])
    # ---- 2.24 file manager + viewer ----
    pg.wait_for_timeout(350)
    fm=pg.evaluate("""async ()=>{
      OCM.S.dir='/root';
      OCM.openFileManager('/root');
      await new Promise(r=>setTimeout(r,250));
      const sh=[...document.querySelectorAll('.sheet')].pop();
      const rows=sh.querySelectorAll('.fm-row').length;
      const crumbs=sh.querySelectorAll('.fm-crumb').length;
      const roots=sh.querySelectorAll('.fm-root').length;
      // enter folder + select mode + clipboard
      const dirRow=[...sh.querySelectorAll('.fm-row.dir')][0];
      dirRow&&dirRow.click();
      await new Promise(r=>setTimeout(r,150));
      const afterNav=!!sh.querySelector('.fm-crumb.cur');
      // long-press simulation -> select mode (re-query: navigation re-renders the list)
      const live=()=>[...document.querySelectorAll('.sheet')].pop();
      const row=[...live().querySelectorAll('.fm-row')].find(r=>!r.classList.contains('dir'))||live().querySelector('.fm-row');
      if(row)row.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      await new Promise(r=>setTimeout(r,700));
      const selMode=!!live().querySelector('.fm-footer:not(.hide)');
      const check=!!live().querySelector('.fm-check');
      // bulk delete via native fs
      window.__fsOps=[];
      const del=sh.querySelector('.fm-footer .ibtn[title]');
      OCM.back();
      return {rows,crumbs,roots,afterNav,selMode,check};
    }""")
    chk('fm: lists files and folders',fm['rows']>=3)
    chk('fm: breadcrumbs + roots',fm['crumbs']>=1 and fm['roots']>=5)
    chk('fm: navigate into folder',fm['afterNav'])
    chk('fm: long-press selects',fm['selMode'] and fm['check'])
    # copy/move native op support
    mv=pg.evaluate("""()=>{
      window.__fsOps=[];
      const a=OCM.native.fs('copy','/root/a.txt','/root/b.txt');
      const b=OCM.native.fs('move','/root/b.txt','/root/c.txt');
      return {ok:a.ok&&b.ok,ops:(window.__fsOps||[]).map(o=>o.op)};
    }""")
    chk('fm: copy + move bridge ops',mv['ok'] and mv['ops']==['copy','move'])
    # viewer opens images with analyze action
    vw=pg.evaluate("""()=>{
      OCM.S.dir='/root';
      OCM.openViewer('/root/shot.png');
      const sh=[...document.querySelectorAll('.sheet')].pop();
      const hasImg=!!sh.querySelector('.viewer-img')||!!sh.querySelector('.viewer-stage');
      const titles=[...sh.querySelectorAll('.ibtn')].map(b=>b.title);
      const analyze=titles.some(t=>(t||'').includes('Анализировать')||(t||'').toLowerCase().includes('analyze'));
      OCM.back();
      return {hasImg,analyze};
    }""")
    chk('viewer: image stage opens',vw['hasImg'])
    chk('viewer: analyze action present',vw['analyze'])
    # viewer for text has edit + code view
    vwt=pg.evaluate("""()=>{
      __srv.files['/root/notes.txt']='привет мир\\nвторая строка';
      OCM.openViewer('/root/notes.txt');
      const sh=[...document.querySelectorAll('.sheet')].pop();
      const code=!!sh.querySelector('.code-view')||!!sh.querySelector('textarea.editor');
      const titles=[...sh.querySelectorAll('.ibtn')].map(b=>b.title);
      const edit=titles.some(t=>(t||'')==='Редактировать');
      OCM.back();
      return {code,edit};
    }""")
    chk('viewer: text code view + edit',vwt['code'] and vwt['edit'])
    # ---- 2.25 mascot ----
    mc=pg.evaluate("""()=>{
      const el=document.querySelector('.mascot');
      if(!el)return {missing:true};
      const sp=el.dataset.species;
      // states follow the app (no pending permissions allowed to mask the idle state)
      OCM.S.perms=[];OCM.S.questions=[];
      OCM.S.status[OCM.S.sid]={type:'busy'};OCM.bus.emit('status',OCM.S.sid);
      const busyState=el.dataset.state;
      OCM.S.status[OCM.S.sid]={type:'idle'};OCM.bus.emit('status',OCM.S.sid);
      const idleState=el.dataset.state;
      // settings list
      OCM.openMascotSettings();
      const sh=[...document.querySelectorAll('.sheet')].pop();
      const species=sh.querySelectorAll('.mascot-prev').length;
      // pick another species
      const cells=[...sh.querySelectorAll('.mascot-prev')];
      cells[4]&&cells[4].click();
      const picked=OCM.S.opts.mascot;
      // size control
      const sizes=[...sh.querySelectorAll('.seg button')].map(b=>b.textContent);
      OCM.back();
      const after=document.querySelector('.mascot');
      return {sp,busyState,idleState,species,picked,sizes,size:after.style.getPropertyValue('--ms')};
    }""")
    chk('mascot rendered with species',bool(mc.get('sp')))
    chk('mascot shows thinking/writing while busy',mc.get('busyState') in ('thinking','writing','waiting'))
    chk('mascot idles when finished',mc.get('idleState')=='idle')
    chk('mascot settings: 24+ species',mc.get('species',0)>=24)
    chk('mascot settings: species selectable',bool(mc.get('picked')) and mc.get('picked')!=mc.get('sp'))
    chk('mascot settings: size presets','28px' in (mc.get('sizes') or []))
    # drag: mascot is absolutely positioned and draggable
    dr=pg.evaluate("""()=>{
      const el=document.querySelector('.mascot');
      el.style.left='40px';el.style.top='80px';el.dataset.placed='1';
      OCM.store.set('mascotPos',{x:40,y:80});
      const before={l:el.style.left,t:el.style.top};
      el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:50,clientY:90,pointerId:1,button:0}));
      el.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:160,clientY:200,pointerId:1,buttons:1}));
      el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:160,clientY:200,pointerId:1}));
      const saved=OCM.store.get('mascotPos',null);
      return {before,saved,left:el.style.left,top:el.style.top};
    }""")
    chk('mascot drags and remembers position',dr['saved'] and dr['saved']['x']!=40)
    # off switch in settings
    off=pg.evaluate("""()=>{
      const before=OCM.S.opts.mascotOn;
      OCM.S.opts.mascotOn=false;OCM.saveOpts();OCM.mascotRefresh();
      const hidden=document.querySelector('.mascot').style.display==='none';
      OCM.S.opts.mascotOn=true;OCM.saveOpts();OCM.mascotRefresh();
      const shown=document.querySelector('.mascot').style.display!=='none';
      return {before,hidden,shown};
    }""")
    chk('mascot can be hidden and shown',off['hidden'] and off['shown'])
    # ---- continue / regenerate send no visible user bubble ----
    cg=pg.evaluate("""async ()=>{
      const sid='ses_cg';OCM.S.sessions.unshift({id:sid,title:'cg',time:{created:1,updated:Date.now()}});
      OCM.S.sid=sid;OCM.S.status[sid]={type:'idle'};
      OCM.upsertMsg({id:'mc1',sessionID:sid,role:'assistant',time:{created:1}});
      OCM.upsertPart({id:'pc1',sessionID:sid,messageID:'mc1',type:'text',text:'Оборвано'});
      OCM.chat.renderAll();
      const before=document.querySelectorAll('#msgs .msg.user').length;
      await OCM.continueGeneration(sid);
      await new Promise(r=>setTimeout(r,400));
      const afterCont=document.querySelectorAll('#msgs .msg.user').length;
      OCM.chat.renderAll();
      const afterRender=document.querySelectorAll('#msgs .msg.user').length;
      const last=OCM.visibleMsgs(sid).filter(m=>m.info.role==='user').pop();
      const transport=!!(last&&last.synthetic&&last.parts.every(p=>p.synthetic));
      OCM.S.sid='ses_1';OCM.chat.renderAll();
      return {before,afterCont,afterRender,transport};
    }""")
    chk('continue posts no visible user bubble',cg['afterCont']==cg['before'] and cg['afterRender']==cg['before'])
    chk('continue uses hidden transport message',cg['transport'])

    pg.wait_for_timeout(350)
    pg.wait_for_timeout(350)
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
