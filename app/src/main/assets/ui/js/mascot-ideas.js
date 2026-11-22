(function(){
// ==========================================================================
// MASCOT IDEAS — the workshop.
// A curated catalogue of 100 things the companion could learn next: 20 of
// them make it genuinely smarter (context, memory, prediction), the rest are
// animation, speech, looks, interaction and work-awareness.
// Nothing here runs on its own: it is a wish list the user ticks, the picked
// ids are stored locally and can be copied out.
// ==========================================================================
const O=window.OCM,h=O.h;

// t/d are [en,ru] pairs, cost S|M|L, m:1 = "makes it smarter"
const IDEAS=[
  // ---------------------------------------------------------------- 20 × MIND
  {i:'mind-topic-memory',c:'mind',s:'M',m:1,t:['Remembers what earlier chats were about','Помнит, о чём были прошлые чаты'],d:['One-line topic per session, so it can say "last time you fixed auth"','Одна строка темы на сессию — может сказать «в прошлый раз чинили авторизацию»']},
  {i:'mind-next-step',c:'mind',s:'M',m:1,t:['Predicts the agent\'s next step','Предугадывает следующий шаг агента'],d:['Reads the running tool and prepares the matching reaction before the result lands','Смотрит на текущий инструмент и готовит реакцию заранее']},
  {i:'mind-queue',c:'mind',s:'S',m:1,t:['Sees the message queue','Видит очередь сообщений'],d:['Counts queued prompts and says "3 more waiting" instead of idling','Считает очередь запросов и говорит «ещё 3 в очереди»']},
  {i:'mind-adaptive-rate',c:'mind',s:'S',m:1,t:['Adapts how often it talks','Подстраивает частоту реплик'],d:['Fewer lines when the user replies fast, more when the chat is quiet','Меньше слов, когда пользователь отвечает быстро; больше — когда тихо']},
  {i:'mind-mood-fsm',c:'mind',s:'M',m:1,t:['Mood as a real state machine','Настроение как конечный автомат'],d:['Calm → curious → bored → sleepy with explicit transitions, no random jumping','Спокойный → любопытный → скучающий → сонный с явными переходами']},
  {i:'mind-quiet-typing',c:'mind',s:'S',m:1,t:['Knows when to shut up','Знает, когда молчать'],d:['Stops all chatter while the user is actively typing','Перестаёт болтать, пока пользователь печатает']},
  {i:'mind-error-digest',c:'mind',s:'M',m:1,t:['Reads the error for you','Читает ошибку за тебя'],d:['Picks the key line out of stderr and names it in one sentence','Выдёргивает главную строку из stderr и называет её одной фразой']},
  {i:'mind-stuck-detect',c:'mind',s:'M',m:1,t:['Detects being stuck','Замечает тупик'],d:['Three failing attempts in a row → suggests a different approach','Три неудачные попытки подряд → предлагает сменить подход']},
  {i:'mind-cost-watch',c:'mind',s:'M',m:1,t:['Watches the session cost','Следит за стоимостью сессии'],d:['Warns before a long chat gets expensive','Предупреждает, когда долгий чат становится дорогим']},
  {i:'mind-model-pattern',c:'mind',s:'M',m:1,t:['Learns which model you use for what','Запоминает модель под задачу'],d:['Remembers your choices and suggests the usual model for the task type','Запоминает выбор и предлагает привычную модель для типа задачи']},
  {i:'mind-hint-fatigue',c:'mind',s:'S',m:1,t:['Gives up on ignored hints','Не повторяет игнор'],d:['A dismissed hint type is muted for ten minutes','Закрытый тип подсказки замолкает на десять минут']},
  {i:'mind-summary',c:'mind',s:'L',m:1,t:['Summarises a long session','Сжимает длинную сессию'],d:['One sentence in the bubble instead of a wall of text','Одно предложение в пузыре вместо стены текста']},
  {i:'mind-eta',c:'mind',s:'M',m:1,t:['Estimates the answer time','Оценивает время ответа'],d:['Learns per-model latency and shows "~15s" while generating','Учит задержку модели и показывает «~15с» при генерации']},
  {i:'mind-repeat-question',c:'mind',s:'M',m:1,t:['Spots a repeated question','Ловит повторный вопрос'],d:['Reminds you where the same question was already answered','Напоминает, где на такой вопрос уже отвечали']},
  {i:'mind-intent',c:'mind',s:'L',m:1,t:['Understands the intent','Понимает намерение'],d:['Code / question / refactor / explain → a different set of lines','Код / вопрос / рефакторинг / объяснение → свой набор реплик']},
  {i:'mind-no-progress',c:'mind',s:'M',m:1,t:['Notices a stalling session','Замечает застой'],d:['No successful tool for N minutes → offers a concrete hint','Нет удачных инструментов N минут → предлагает конкретную подсказку']},
  {i:'mind-uncommitted',c:'mind',s:'S',m:1,t:['Reminds about uncommitted work','Напоминает про коммит'],d:['Changed files but no commit in a while → a gentle nudge','Файлы изменены, коммита нет → мягкий намёк']},
  {i:'mind-file-memory',c:'mind',s:'L',m:1,t:['Remembers past failures per file','Помнит прошлые ошибки по файлу'],d:['"This file broke last time — check the imports"','«Этот файл уже ломался — глянь импорты»']},
  {i:'mind-hint-rank',c:'mind',s:'M',m:1,t:['Ranks its own hints','Ранжирует свои подсказки'],d:['Scores Continue / compact / error by urgency and shows the best one','Оценивает подсказки по важности и показывает лучшую']},
  {i:'mind-tone',c:'mind',s:'M',m:1,t:['Reads success from the stream','Понимает успех по стриму'],d:['Guess from the stream whether the run is going well and react accordingly','По стриму угадывает, идёт ли всё хорошо, и реагирует']},

  // ------------------------------------------------------------ 20 × ANIMATION
  {i:'anim-breath',c:'anim',s:'S',t:['Breathing synced with blinking','Дыхание в такт морганию'],d:['Blink lands on the exhale, not on a random frame','Моргание попадает на выдох, а не в случайный кадр']},
  {i:'anim-run',c:'anim',s:'M',t:['A real run cycle','Настоящий бег'],d:['Two-frame trot when it is in a hurry','Двухкадровая рысь, когда торопится']},
  {i:'anim-jump-over',c:'anim',s:'M',t:['Hops over obstacles','Перепрыгивает преграды'],d:['Jumps over message cards instead of walking through them','Перепрыгивает карточки сообщений, а не проходит сквозь']},
  {i:'anim-zzz',c:'anim',s:'S',t:['Sleep particles','Частицы сна'],d:['Tiny floating Z particles while napping','Маленькие всплывающие «Z», пока спит']},
  {i:'anim-stretch',c:'anim',s:'S',t:['Stretches after waking','Потягивается после сна'],d:['A short stretch animation when you wake it','Короткое потягивание, когда его будят']},
  {i:'anim-scratch',c:'anim',s:'S',t:['Scratches behind the ear','Чешет за ухом'],d:['Random idle self-care beat','Случайный жест ухода за собой']},
  {i:'anim-news-hop',c:'anim',s:'S',t:['Hops on a new message','Подпрыгивает на новое сообщение'],d:['A small hop when a message arrives','Небольшой прыжок при новом сообщении']},
  {i:'anim-dance',c:'anim',s:'M',t:['Dances on a green build','Танцует на зелёном билде'],d:['A short victory dance when tests pass','Короткий победный танец, когда тесты прошли']},
  {i:'anim-dust',c:'anim',s:'S',t:['Landing dust','Пыль при приземлении'],d:['A puff of pixels when it lands','Облачко пикселей при приземлении']},
  {i:'anim-ice',c:'anim',s:'M',t:['Slides after a hard throw','Скользит после броска'],d:['A flick across the screen leaves an ice trail','Резкий бросок оставляет ледяной след']},
  {i:'anim-pawprints',c:'anim',s:'M',t:['Leaves pawprints','Оставляет следы лап'],d:['Fading prints behind it on the ledge','Исчезающие отпечатки на «земле»']},
  {i:'anim-lean',c:'anim',s:'S',t:['Leans into turns','Наклоняется в поворотах'],d:['The body tilts while changing direction','Тело наклоняется при смене направления']},
  {i:'anim-ears',c:'anim',s:'S',t:['Ears react to sound','Уши реагируют на звук'],d:['Ears twitch when a notification plays','Уши дёргаются на звук уведомления']},
  {i:'anim-tail-speed',c:'anim',s:'S',t:['Tail follows your typing','Хвост следует за печатью'],d:['Tail speed tracks your typing rhythm','Скорость хвоста повторяет ритм печати']},
  {i:'anim-mood-breath',c:'anim',s:'S',t:['Mood changes the breathing','Настроение меняет дыхание'],d:['Calm slow breath, excited fast breath','Спокойное медленное дыхание, взволнованное быстрое']},
  {i:'anim-stare-blink',c:'anim',s:'S',t:['Blushes when stared at','Смущается от взгляда'],d:['Long gaze on the pet → it blinks and looks away','Долгий взгляд на питомца → моргает и отводит глаза']},
  {i:'anim-startle',c:'anim',s:'S',t:['Startles on errors','Пугается ошибок'],d:['A quick jump instead of only shaking','Быстрый подскок вместо одного дрожания']},
  {i:'anim-edge-sleep',c:'anim',s:'M',t:['Sleeps at the screen edge','Спит у края экрана'],d:['Walks to the corner and curls up for a nap','Уходит в угол и сворачивается калачиком']},
  {i:'anim-impatient',c:'anim',s:'S',t:['Fidgets while waiting','Ёрзает в ожидании'],d:['Micro-taps a paw when a request takes too long','Мелко стучит лапой, если запрос долгий']},
  {i:'anim-scroll-lean',c:'anim',s:'S',t:['Leans with the scroll','Наклоняется со скроллом'],d:['Follows the message list momentum with a small tilt','Повторяет инерцию списка лёгким наклоном']},

  // --------------------------------------------------------------- 15 × SPEECH
  {i:'say-morning',c:'say',s:'S',t:['Morning greeting','Утреннее приветствие'],d:['A different line at dawn, noon and night','Своя фраза на рассвете, днём и ночью']},
  {i:'say-bye',c:'say',s:'S',t:['Says goodbye','Прощается при выходе'],d:['A short farewell when the app closes','Короткое «пока», когда приложение закрывают']},
  {i:'say-long-msg',c:'say',s:'S',t:['Comments on long prompts','Комментирует длинный запрос'],d:['Reacts to a wall of text with one wry line','Реагирует на стену текста одной ехидной фразой']},
  {i:'say-whisper',c:'say',s:'S',t:['Whispers during silence','Шепчет в тишине'],d:['Very rare quiet line after long inactivity','Очень редкая тихая фраза после долгого простоя']},
  {i:'say-languages',c:'say',s:'M',t:['Speaks your language','Говорит на твоём языке'],d:['Names and lines follow the UI language','Имена и фразы следуют языку интерфейса']},
  {i:'say-code-quote',c:'say',s:'M',t:['Quotes your code','Цитирует твой код'],d:['Mentions the function name it is looking at','Упоминает имя функции, на которую смотрит']},
  {i:'say-emoji',c:'say',s:'S',t:['Answers emoji','Отвечает на эмодзи'],d:['Recognises a smile or a skull and replies in kind','Узнаёт улыбку или череп и отвечает в тон']},
  {i:'say-howareyou',c:'say',s:'S',t:['Answers "how are you"','Отвечает «как дела»'],d:['A truthful status line from its own mood','Честный ответ из собственного настроения']},
  {i:'say-days-together',c:'say',s:'S',t:['Counts days together','Считает дни вместе'],d:['Anniversary lines for 7, 30, 365 days','Фразы на 7, 30, 365 дней']},
  {i:'say-topic-change',c:'say',s:'S',t:['Notices a topic change','Замечает смену темы'],d:['"New task? I am resetting my focus"','«Новая задача? Сбрасываю фокус»']},
  {i:'say-context-words',c:'say',s:'S',t:['Explains context in own words','Объясняет контекст словами'],d:['"Half the window is full" instead of a percentage','«Половина окна занята» вместо процентов']},
  {i:'say-praise',c:'say',s:'S',t:['Praises quick work','Хвалит за скорость'],d:['Compliments a fast, clean answer','Хвалит быстрый и чистый ответ']},
  {i:'say-encourage',c:'say',s:'S',t:['Encourages on failure','Подбадривает при провале'],d:['A short line after a failed build','Короткая фраза после неудачной сборки']},
  {i:'say-joke',c:'say',s:'S',t:['Tells a joke on request','Шутит по просьбе'],d:['A developer joke when the chat is idle','Шутка про разработку, когда в чате тихо']},
  {i:'say-species-voice',c:'say',s:'M',t:['Each species has a voice','У каждого вида свой голос'],d:['A cat, a whale and a hacker cat speak differently','Кот, кит и кот-хакер говорят по-разному']},

  // ----------------------------------------------------------------- 15 × LOOK
  {i:'look-time-accessory',c:'look',s:'M',t:['Accessories by time of day','Аксессуары по времени суток'],d:['Nightcap at night, sunglasses at noon','Ночной колпак ночью, очки днём']},
  {i:'look-season',c:'look',s:'M',t:['Seasonal outfit','Сезонный наряд'],d:['Scarf in winter, leaf in autumn','Шарф зимой, листик осенью']},
  {i:'look-holiday',c:'look',s:'M',t:['Holiday skins','Праздничные скины'],d:['New Year and Halloween variants','Варианты на Новый год и Хэллоуин']},
  {i:'look-aura',c:'look',s:'S',t:['Aura colour by mood','Цвет ауры по настроению'],d:['The glow shifts hue with its mood','Свечение меняет оттенок вместе с настроением']},
  {i:'look-tired-eyes',c:'look',s:'S',t:['Tired eyes','Усталые глаза'],d:['Dark rims after a very long session','Тёмные круги после очень долгой сессии']},
  {i:'look-blush',c:'look',s:'S',t:['Blush on praise','Румянец от похвалы'],d:['Cheeks light up when petted','Щёки загораются от поглаживания']},
  {i:'look-dirty',c:'look',s:'S',t:['Gets dirty from work','Пачкается от работы'],d:['Smudges after heavy file edits, clean after a bath','Пятна после правок, чистота после «купания»']},
  {i:'look-invisible',c:'look',s:'M',t:['Focus-mode cloak','Плащ фокуса'],d:['Almost transparent in focus mode','Почти прозрачный в режиме фокуса']},
  {i:'look-wings',c:'look',s:'M',t:['Wings at high affection','Крылья при высокой симпатии'],d:['Unlocked after real friendship','Открываются после настоящей дружбы']},
  {i:'look-jailbreak-glow',c:'look',s:'S',t:['Richer jailbreak glow','Богаче свечение джейлбрейка'],d:['Colour and intensity follow the active preset','Цвет и яркость зависят от активного пресета']},
  {i:'look-model-hat',c:'look',s:'S',t:['Hat of the chosen model','Шляпа выбранной модели'],d:['A tiny badge of the current provider','Маленький значок текущего провайдера']},
  {i:'look-pixel-colour',c:'look',s:'S',t:['Custom pixel colour','Свой цвет пикселей'],d:['Pick the base colour of the sprite','Выбор базового цвета спрайта']},
  {i:'look-grid-size',c:'look',s:'M',t:['Three sprite resolutions','Три разрешения спрайта'],d:['16, 24 and 32 pixel grids per size','Сетки 16, 24 и 32 пикселя под размер']},
  {i:'look-frame',c:'look',s:'S',t:['Animated frame','Анимированная рамка'],d:['A thin looping border around the pet','Тонкая бегущая рамка вокруг питомца']},
  {i:'look-theme-palette',c:'look',s:'S',t:['Palette from the theme','Палитра из темы'],d:['Accent colours taken from the app theme','Акцентные цвета берутся из темы']},

  // ------------------------------------------------------------ 15 × INTERACTION
  {i:'int-longpress-pet',c:'int',s:'S',t:['Long press to pet','Долгое нажатие — погладить'],d:['Hold the pet for a purr instead of opening a menu','Держи питомца — мурчание вместо меню']},
  {i:'int-flick',c:'int',s:'M',t:['Throw with real inertia','Бросок с инерцией'],d:['A fast swipe sends it flying and bouncing','Быстрый свайп уносит его в полёт и отскок']},
  {i:'int-home-corner',c:'int',s:'S',t:['A home corner','Домик в углу'],d:['Drag it to a corner to make that its den','Перетащи в угол — там будет его дом']},
  {i:'int-bubble-tap',c:'int',s:'S',t:['Tap the bubble to act','Тап по пузырю — действие'],d:['The "Continue" bubble actually continues','Пузырь «Продолжить» действительно продолжает']},
  {i:'int-foods',c:'int',s:'M',t:['Different treats','Разная еда'],d:['Each treat shifts the mood differently','Каждая вкусняшка меняет настроение по-своему']},
  {i:'int-chase',c:'int',s:'M',t:['Play chase','Игра «догони»'],d:['Tap a spot and it runs there','Тапни в точку — он бежит туда']},
  {i:'int-brush',c:'int',s:'S',t:['Brush its fur','Расчесать шёрстку'],d:['Swipe over it to groom and calm it','Проведи по нему — расчёсывание и успокоение']},
  {i:'int-tricks',c:'int',s:'L',t:['Learns tricks','Учит трюки'],d:['A new trick unlocked after N pets','Новый трюк открывается после N поглаживаний']},
  {i:'int-companion',c:'int',s:'L',t:['A second companion','Второй компаньон'],d:['Two pets that interact with each other','Два питомца, которые общаются между собой']},
  {i:'int-voice-cmd',c:'int',s:'L',t:['Voice commands','Голосовые команды'],d:['"Come here", "sleep" said out loud','«Иди сюда», «спать» вслух']},
  {i:'int-widget',c:'int',s:'L',t:['Android home widget','Виджет на рабочий стол'],d:['The pet lives on the launcher too','Питомец живёт и на лаунчере']},
  {i:'int-miss-you',c:'int',s:'S',t:['Misses you','Скучает'],d:['A notification after a long absence','Уведомление после долгого отсутствия']},
  {i:'int-sleep-together',c:'int',s:'S',t:['Sleeps with the app','Спит вместе с приложением'],d:['Curled up in night mode','Сворачивается в ночном режиме']},
  {i:'int-birthday',c:'int',s:'S',t:['Install birthday','День рождения установки'],d:['A small party once a year','Маленький праздник раз в год']},
  {i:'int-cross-session',c:'int',s:'M',t:['Friendship across sessions','Дружба между сессиями'],d:['Shared memory of affection between chats','Общая память о симпатии между чатами']},

  // ----------------------------------------------------------------- 15 × WORK
  {i:'work-tool-anim',c:'work',s:'S',t:['Animated tools in paws','Анимированные инструменты'],d:['The terminal cursor blinks, the pen moves','Курсор терминала мигает, ручка пишет']},
  {i:'work-progress',c:'work',s:'S',t:['Tiny progress bar','Мини-прогресс-бар'],d:['A slim bar above the head while generating','Тонкая полоска над головой при генерации']},
  {i:'work-diff-stat',c:'work',s:'M',t:['Shows diff stats','Показывает статистику диффа'],d:['"+12 −3" after an edit','«+12 −3» после правки']},
  {i:'work-file-hl',c:'work',s:'M',t:['Points at the edited file','Указывает на правимый файл'],d:['A short arrow to the file name','Короткая стрелка к имени файла']},
  {i:'work-terminal-post',c:'work',s:'S',t:['Stands at the terminal','Стоит у терминала'],d:['Moves next to the terminal tab during bash','Встаёт рядом с вкладкой терминала при bash']},
  {i:'work-fm-follow',c:'work',s:'S',t:['Follows the file manager','Следит за файлами'],d:['Walks with you while browsing files','Гуляет рядом при просмотре файлов']},
  {i:'work-git',c:'work',s:'M',t:['Reads git status','Читает git-статус'],d:['A dirty tree makes it fidgety','Грязное дерево заставляет его нервничать']},
  {i:'work-test-pass',c:'work',s:'S',t:['Celebrates a passing test','Радуется зелёным тестам'],d:['A thumbs-up when a test run passes','Палец вверх, когда тесты прошли']},
  {i:'work-coffee',c:'work',s:'S',t:['Brings coffee','Приносит кофе'],d:['A mug prop on tasks longer than 5 minutes','Кружка на задачах дольше 5 минут']},
  {i:'work-queue-badge',c:'work',s:'S',t:['Queue badge','Значок очереди'],d:['A small "2" when messages are waiting','Маленькая «2», когда ждут сообщения']},
  {i:'work-retry',c:'work',s:'S',t:['Retry indicator','Индикатор ретраев'],d:['Shows the key rotation or retry count','Показывает смену ключа или номер ретрая']},
  {i:'work-model-plate',c:'work',s:'S',t:['Model nameplate','Табличка модели'],d:['The current model on a tiny sign','Текущая модель на маленькой табличке']},
  {i:'work-cost-meter',c:'work',s:'M',t:['Cost meter','Счётчик стоимости'],d:['A thin gauge that fills with the session','Тонкая шкала, заполняющаяся за сессию']},
  {i:'work-hide-focus',c:'work',s:'S',t:['Hides in focus mode','Прячется в фокусе'],d:['Out of the way until focus mode ends','Уходит с дороги до конца фокуса']},
  {i:'work-continue-arrow',c:'work',s:'S',t:['Arrow to Continue','Стрелка к «Продолжить»'],d:['A real arrow pointing at the button','Настоящая стрелка на кнопку']}
];

// The set the user picked in the workshop (2.28.2). Pre-ticked when the backlog is still empty,
// so the chosen direction survives a reinstall of the UI without a hidden local state.
const SELECTED=['mind-adaptive-rate','mind-quiet-typing','mind-hint-fatigue','mind-uncommitted',
  'anim-run','anim-jump-over','anim-zzz','anim-stretch','anim-scratch','anim-news-hop','anim-dust',
  'anim-ice','anim-edge-sleep','anim-impatient','say-languages','say-days-together',
  'int-longpress-pet','int-flick','int-home-corner','int-foods','int-chase','int-cross-session',
  'work-tool-anim','work-diff-stat'];
O.mascotIdeaSelected=()=>SELECTED.slice();

const CATS={mind:['Smart','Умнее'],anim:['Animation','Анимация'],say:['Speech','Речь'],look:['Looks','Внешний вид'],int:['Interaction','Взаимодействие'],work:['Work','Работа']};
const COST={S:['cheap','дёшево'],M:['medium','средне'],L:['big','крупно']};
const BACKLOG_KEY='mascotIdeaBacklog';

const backlog=()=>{
  const v=O.store.get(BACKLOG_KEY,null);
  if(Array.isArray(v))return v;
  return SELECTED.slice();   // first run: show the curated pick
};
O.mascotIdeas=()=>IDEAS.slice();
O.mascotIdeaBacklog=backlog;
O.mascotIdeaSetBacklog=ids=>{
  const seen=new Set();
  const clean=(ids||[]).filter(x=>x&&!seen.has(x)&&seen.add(x)).slice(0,100);
  O.store.set(BACKLOG_KEY,clean);return clean;
};
O.mascotIdeaAdd=ids=>O.mascotIdeaSetBacklog(backlog().concat(ids||[]));
O.mascotIdeaRemove=ids=>{const drop=new Set(ids||[]);return O.mascotIdeaSetBacklog(backlog().filter(x=>!drop.has(x)))};
O.mascotIdeaByCategory=()=>{
  const out={};IDEAS.forEach(x=>{(out[x.c]=out[x.c]||[]).push(x)});return out;
};
O.mascotIdeasSmart=()=>IDEAS.filter(x=>x.m);

const title=x=>O.tr(x.t[0],x.t[1]);
const desc=x=>O.tr(x.d[0],x.d[1]);

O.openMascotIdeas=()=>{
  const body=h('div');
  let q='',cat='all',cost='all',onlySmart=false;
  const picked=new Set(backlog());

  const draw=()=>{
    body.textContent='';
    const head=h('div',{class:'note'},
      O.tr('100 ideas for the companion: 20 of them make it genuinely smarter. Tick what you want and it lands in the local backlog.',
        '100 идей для компаньона: 20 из них делают его по-настоящему умнее. Отметьте нужные — они попадут в локальный бэклог.'));
    const stats=h('div',{class:'note',style:{marginTop:'-4px'}},
      O.tr('In backlog: ','В бэклоге: ')+picked.size+' / '+IDEAS.length);
    const search=h('input',{type:'search',placeholder:O.tr('Search ideas…','Поиск по идеям…')});
    search.value=q;search.oninput=()=>{q=search.value;draw();setTimeout(()=>{const s2=body.querySelector('input[type=search]');if(s2){s2.focus();try{s2.setSelectionRange(s2.value.length,s2.value.length)}catch(_){}}},0)};

    const chip=(label,on,fn)=>h('button',{class:'chip'+(on?' on':''),onclick:fn},label);
    const catRow=h('div',{class:'fchips',style:{margin:'8px 0',flexWrap:'wrap'}},
      chip(O.tr('All','Все'),cat==='all',()=>{cat='all';draw()}),
      chip(O.tr('Smart','Умнее')+' ('+O.mascotIdeasSmart().length+')',cat==='mind',()=>{cat='mind';draw()}),
      ...Object.keys(CATS).filter(k=>k!=='mind').map(k=>chip(O.tr(CATS[k][0],CATS[k][1]),cat===k,()=>{cat=k;draw()})));
    const costRow=h('div',{class:'fchips',style:{margin:'0 0 8px',flexWrap:'wrap'}},
      chip(O.tr('Any size','Любой размер'),cost==='all',()=>{cost='all';draw()}),
      ...Object.keys(COST).map(k=>chip(k+' · '+O.tr(COST[k][0],COST[k][1]),cost===k,()=>{cost=k;draw()})),
      chip(onlySmart?O.tr('Smart only ✓','Только умные ✓'):O.tr('Smart only','Только умные'),onlySmart,()=>{onlySmart=!onlySmart;draw()}));

    const list=h('div');
    const visible=IDEAS.filter(x=>{
      if(cat!=='all'&&x.c!==cat)return false;
      if(cost!=='all'&&x.s!==cost)return false;
      if(onlySmart&&!x.m)return false;
      if(!q)return true;
      const hay=(title(x)+' '+desc(x)+' '+x.i+' '+x.s).toLowerCase();
      return hay.includes(q.toLowerCase());
    });
    if(!visible.length)list.append(h('div',{class:'mut',style:{padding:'18px',textAlign:'center'}},
      O.tr('Nothing matches these filters.','Под эти фильтры ничего не подходит.')));
    let lastCat='';
    visible.forEach(x=>{
      if(x.c!==lastCat&&cat==='all'){
        lastCat=x.c;
        list.append(h('div',{class:'grp',style:{marginTop:'10px'}},O.tr(CATS[x.c][0],CATS[x.c][1])));
      }
      const chk=h('input',{type:'checkbox',style:{width:'auto',margin:'0 8px 0 0',flex:'0 0 auto'}});
      chk.checked=picked.has(x.i);
      chk.onchange=()=>{if(chk.checked)picked.add(x.i);else picked.delete(x.i);draw()};
      const meta=h('span',null,(x.m?O.tr('smart','умнее')+' · ':'')+x.s+' · '+O.tr(COST[x.s][0],COST[x.s][1]));
      const row=h('label',{class:'settings-row',style:{cursor:'pointer',alignItems:'flex-start'}},
        h('div',{class:'settings-row-icon'},O.icon(x.m?'bulb':x.c==='anim'?'drag':x.c==='say'?'note':x.c==='look'?'palette':x.c==='int'?'thumbUp':'terminal')),
        h('div',{class:'settings-row-text'},h('b',null,title(x)),h('span',{style:{whiteSpace:'normal'}},desc(x)),meta),
        chk);
      list.append(row);
    });

    const addVisible=h('button',{class:'btn sm',onclick:()=>{
      visible.forEach(x=>picked.add(x.i));draw();
    }},O.icon('plus'),O.tr('Select shown','Выбрать показанные'));
    const clearAll=h('button',{class:'btn sm',onclick:()=>{picked.clear();draw()}},O.icon('x'),O.tr('Clear','Очистить'));
    const save=h('button',{class:'btn pri wide',style:{marginTop:'10px'},onclick:()=>{
      const ids=O.mascotIdeaSetBacklog([...picked]);
      O.toast(O.tr('Backlog saved: ','Бэклог сохранён: ')+ids.length,1800);
      if(O.native&&O.native.haptic)O.native.haptic('tick');
    }},O.icon('check'),O.tr('Save backlog','Сохранить бэклог')+' ('+picked.size+')');
    const copy=h('button',{class:'btn wide',style:{marginTop:'8px'},onclick:()=>{
      const lines=[];
      const byCat=O.mascotIdeaByCategory();
      Object.keys(CATS).forEach(k=>{
        const items=(byCat[k]||[]).filter(x=>picked.has(x.i));
        if(!items.length)return;
        lines.push('# '+O.tr(CATS[k][0],CATS[k][1]));
        items.forEach(x=>lines.push('- ['+x.s+'] '+title(x)+' — '+desc(x)));
        lines.push('');
      });
      const text=lines.join('\n')||O.tr('(backlog is empty)','(бэклог пуст)');
      try{O.native.copy(text)}catch(_){}
      O.toast(O.tr('Copied as markdown','Скопировано как markdown'),1800);
    }},O.icon('copy'),O.tr('Copy as markdown','Скопировать как markdown'));

    body.append(head,stats,
      h('div',{class:'field'},search),
      catRow,costRow,
      h('div',{style:{display:'flex',gap:'8px',margin:'4px 0 6px'}},addVisible,clearAll),
      list,
      save,copy,
      h('div',{class:'note',style:{marginTop:'8px'}},O.tr('Stored on this phone only. Nothing is sent anywhere.','Хранится только на этом телефоне. Никуда не отправляется.')));
  };
  draw();
  O.sheet(O.tr('Mascot workshop','Мастерская маскота'),body,{full:true});
};
})();