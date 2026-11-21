(function(){
const O=window.OCM,h=O.h,S=O.S,bus=O.bus;
// ==========================================================================
// PIXEL MASCOT v3 — hand-authored 16x16 sprites (classic chibi style).
// Every sprite is drawn by hand as ASCII, like old game sprites: a bold dark
// outline, a flat base tone, one highlight band, big readable eyes and small
// hand-placed accessories. 54 species = 6 body templates + palettes + layers.
// ==========================================================================

// Palette letters used in the ASCII art:
//  . transparent   # outline      @ base        + highlight   - shadow
//  w eye white     p pupil        b blush       a accent      y gold/white
//  k dark accent   s skin         h hair

const TEMPLATES={
  // ---------------------------------------------------------------- chibi cat
  cat:[
    '................',
    '...##......##...',
    '..#@@#....#@@#..',
    '..#@@######@@#..',
    '.#@@@@@@@@@@@@#.',
    '.#@@@@@@@@@@@@#.',
    '.#@ww@@@@@@ww@#.',
    '.#@wp@@@@@@pw@#.',
    '.#@@@@@@@@@@@@#.',
    '.#@@#b@@@@b#@@#.',
    '..#@@@#@@#@@@#..',
    '...#@@@@@@@@#...',
    '...#@@@@@@@@#...',
    '...#@##@@##@#...',
    '....##....##....',
    '................'
  ],
  // ------------------------------------------------------------- round critter
  round:[
    '................',
    '................',
    '....########....',
    '..##++++++++##..',
    '.#++++++++++++#.',
    '.#+++@@@@@@+++#.',
    '.#+ww@@@@@@ww+#.',
    '.#+wp@@@@@@pw+#.',
    '.#+@@@@@@@@@@+#.',
    '.#+b@#@@@@#@b+#.',
    '.#++@@@@@@@@++#.',
    '..#++@@@@@@++#..',
    '...##+@@@@+##...',
    '.....#@##@#.....',
    '......#..#......',
    '................'
  ],
  // ------------------------------------------------------------------ bird
  bird:[
    '................',
    '.....######.....',
    '...##++++++##...',
    '..#++++++++++#..',
    '.#++@@@@@@@@++#.',
    '.#+ww@@@@@@ww+#.',
    '.#+wp@@@@@@pw+#.',
    '.#++@@@@@@@@++#.',
    '.#+++@aaaa@+++#.',
    '..#++@@@@@@++#..',
    '..#+++@@@@+++#..',
    '...#++@@@@++#...',
    '....#aa##aa#....',
    '.....#....#.....',
    '................',
    '................'
  ],
  // ------------------------------------------------------------------ ghost
  ghost:[
    '................',
    '.....######.....',
    '...##++++++##...',
    '..#++++++++++#..',
    '.#++@@@@@@@@++#.',
    '.#+ww@@@@@@ww+#.',
    '.#+wp@@@@@@pw+#.',
    '.#+@@@@@@@@@@+#.',
    '.#+@@#@@@@#@@+#.',
    '.#+@@@@@@@@@@+#.',
    '.#+@@@@@@@@@@+#.',
    '.#++@@@@@@@@++#.',
    '.#+#@#@#@#@#@+#.',
    '..#..#..#..#.#..',
    '................',
    '................'
  ],
  // ------------------------------------------------------------------- blob
  blob:[
    '................',
    '................',
    '................',
    '....########....',
    '..##++++++++##..',
    '.#++++++++++++#.',
    '.#+ww@@@@@@ww+#.',
    '.#+wp@@@@@@pw+#.',
    '.#++@@@@@@@@++#.',
    '.#+b@@@@@@@@b+#.',
    '.#+++@@@@@@+++#.',
    '..##++++++++##..',
    '...#++++++++#...',
    '....########....',
    '................',
    '................'
  ],
  // ------------------------------------------------------------------- tall
  tall:[
    '................',
    '....########....',
    '..##++++++++##..',
    '.#++++++++++++#.',
    '.#+ww@@@@@@ww+#.',
    '.#+wp@@@@@@pw+#.',
    '.#++@@@@@@@@++#.',
    '..#++@##@@##+@#..',
    '..#++++++++#.',
    '..#++@@@@++#..',
    '..#++@@@@++#..',
    '..#++@@@@++#..',
    '..#+##@@##+#..',
    '...##....##...',
    '................',
    '................'
  ]
};

// Layer overlays: ASCII patches {x,y,rows} drawn on top of the template.
const LAYERS={
  ears_point:{x:3,y:0,rows:['#....#','@#..#@','@@##@@']},
  horns:{x:4,y:0,rows:['y....y','yy..yy','@y..y@']},
  antlers:{x:2,y:0,rows:['y..y..y','.y.y.y.','..yy..']},
  halo:{x:5,y:0,rows:['yyyyyy','y....y']},
  hat:{x:3,y:0,rows:['...yy...','..yaay..','.yaaaay.','aaaaaaa','#######']},
  helmet:{x:3,y:1,rows:['#######','+++++++','+@@@@@+','+@@@@@+','#######','..+++..']},
  hair:{x:3,y:2,rows:['hhhhhhh','h.h.h.h','h.h.h.h','hh...hh']},
  ponytail:{x:12,y:4,rows:['aa','aa','aa','aa','aa','.a']},
  mask:{x:3,y:6,rows:['#######','#######'],},
  bandana:{x:3,y:4,rows:['aaaaaaa','.......']},
  scarf:{x:3,y:12,rows:['aaaaaaa','.aaaaa.'],},
  wings:{x:0,y:5,rows:['y.','yy','y.','y.']},
  wings_r:{x:14,y:5,rows:['.y','yy','.y','.y']},
  tail:{x:13,y:10,rows:['.@','@@','@.','@.']},
  tentacles:{x:3,y:13,rows:['@.@.@.@.','@.@.@.@.']},
  beak:{x:6,y:8,rows:['aay','.a.']},
  muzzle:{x:4,y:8,rows:['+++++++','..p.p..']},
  goggles:{x:3,y:6,rows:['kkkkkkk','kwwkwwk','kkkkkkk']},
  visor:{x:3,y:6,rows:['ggggggggg']},
  crown:{x:4,y:0,rows:['y.y.y.y','yyyyyyy']},
  rays:{x:0,y:0,rows:['....y....','y.......y','....y....']},
  spots:{x:3,y:10,rows:['+..+','....','.+..']},
  glow_eyes:{x:3,y:6,rows:['g.g','...','g.g']},
  armor:{x:3,y:10,rows:['#######','++y+y++','#######']},
  robe:{x:3,y:11,rows:['aaaaaaa','aaaaaaa','aaaaaaa']},
  cape:{x:12,y:7,rows:['aa','aa','aa','aa']},
  sword:{x:13,y:3,rows:['y','y','y','y','y','y','k','k']},
  katana:{x:14,y:3,rows:['y','y','y','y','y','k','k']},
  staff:{x:14,y:2,rows:['.y.','yyy','.y.','.a.','.a.','.a.','.a.','.a.','.a.']},
  flame:{x:6,y:0,rows:['.y.','yay','yay','.a.']},
  cracks:{x:4,y:11,rows:['k..k','.k..']},
  antenna:{x:5,y:0,rows:['y...y','.y.y.','..y..']},
  star:{x:13,y:2,rows:['.y.','yyy','.y.']},
  sparkle:{x:1,y:2,rows:['y..y..y','.y.y.y.']},
  bolt:{x:12,y:8,rows:['yy','.yy','..y']},
  gloss:{x:4,y:4,rows:['yy','.y']},
  lights:{x:4,y:12,rows:['y.y.y.y']},
  dome:{x:4,y:1,rows:['.####.','#yyyy#','######']},
  gills:{x:1,y:7,rows:['a.a','a.a','.a.']},
  gills_r:{x:13,y:7,rows:['a.a','a.a','.a.']},
  whiskers:{x:0,y:8,rows:['w..','w..','w..']},
  whiskers_r:{x:13,y:8,rows:['..w','..w','..w']},
  craters:{x:3,y:9,rows:['-..-','....','.-..']},
  mouth_big:{x:6,y:9,rows:['kkk','.k.']},
  gem:{x:7,y:11,rows:['y','y']}
};

// ------------- palettes -------------
// base   : main body colour
// hi/lo  : highlight / shadow (auto if omitted)
// outline: dark rim
// accent : scarves, hats, cloaks
// skin   : faces for humans
const PAL={
  deepseek:{base:'#4d6bfe',outline:'#101a52',accent:'#a8b8ff',eye:'#eaf0ff',pupil:'#0b1030',body:'whale'},
  claude:{base:'#d97757',outline:'#5b2a18',accent:'#ffd9c2',eye:'#fff6ee',pupil:'#3a1a10',body:'star'},
  anime:{base:'#ffd8b5',outline:'#5b3a2a',accent:'#ff6fae',eye:'#e8f8ff',pupil:'#3a5a7a',body:'round',skin:true},

  hacker_cat:{base:'#6b6b7a',outline:'#1d1d24',accent:'#4ade80',eye:'#4ade80',pupil:'#0d1f12',body:'cat'},
  fox:{base:'#f08a3c',outline:'#4a2408',accent:'#fff3e0',eye:'#fffdf8',pupil:'#5a2c0c',body:'cat'},
  penguin:{base:'#3a4252',outline:'#12161d',accent:'#ffb03b',eye:'#ffffff',pupil:'#12161d',body:'bird'},
  capybara:{base:'#a9743d',outline:'#3a2415',accent:'#d8b98a',eye:'#2b1c0e',pupil:'#2b1c0e',body:'round'},
  shiba:{base:'#e0a55c',outline:'#4a2c10',accent:'#fff3e0',eye:'#fffdf8',pupil:'#3a2208',body:'cat'},
  hamster:{base:'#d9a15f',outline:'#4a2f12',accent:'#f6e3c4',eye:'#fffdf8',pupil:'#3a2208',body:'round'},
  octopus:{base:'#c76bd6',outline:'#4a1f52',accent:'#e6a5f0',eye:'#fdf6ff',pupil:'#3a1440',body:'blob'},
  axolotl:{base:'#f7a8c4',outline:'#6b2f45',accent:'#ff9ad5',eye:'#fffafc',pupil:'#4a1a2c',body:'blob'},
  dragon:{base:'#5fbf6b',outline:'#1f4a26',accent:'#a8e6b0',eye:'#fffde8',pupil:'#1f4a26',body:'cat'},
  phoenix:{base:'#ff9f43',outline:'#7a2f10',accent:'#ffd166',eye:'#fffbe8',pupil:'#7a2f10',body:'bird'},
  frog:{base:'#7cc242',outline:'#2c4a12',accent:'#c6e6a0',eye:'#f4ffe8',pupil:'#2c4a12',body:'round'},
  ninja_penguin:{base:'#3a4252',outline:'#12161d',accent:'#e8452f',eye:'#ffffff',pupil:'#12161d',body:'bird'},
  robo_cat:{base:'#8b93a7',outline:'#2b3140',accent:'#5ef0ff',eye:'#5ef0ff',pupil:'#0f2a33',body:'cat'},
  robo_dog:{base:'#9aa3b8',outline:'#2b3140',accent:'#4ade80',eye:'#4ade80',pupil:'#12291c',body:'cat'},
  drone:{base:'#8b93a7',outline:'#2b3140',accent:'#5ef0ff',eye:'#5ef0ff',pupil:'#0f2a33',body:'blob'},
  android:{base:'#3ddc84',outline:'#0d2a1a',accent:'#ffffff',eye:'#0d2a1a',pupil:'#0d2a1a',body:'round'},
  term_ghost:{base:'#173b28',outline:'#04150c',accent:'#00e676',eye:'#00e676',pupil:'#04150c',body:'ghost'},
  ghost:{base:'#e8e8f5',outline:'#5b5b78',accent:'#b8b8d0',eye:'#5b5b78',pupil:'#5b5b78',body:'ghost'},
  demon:{base:'#e8455f',outline:'#5e1220',accent:'#ffd166',eye:'#fff3c0',pupil:'#5e1220',body:'round'},
  samurai:{base:'#2b3140',outline:'#0f1218',accent:'#e8452f',eye:'#ffe8c0',pupil:'#0f1218',body:'round'},
  ninja:{base:'#2b2b3a',outline:'#121216',accent:'#e8452f',eye:'#ffe8c0',pupil:'#121216',body:'round'},
  mage:{base:'#7a5cff',outline:'#2a1f52',accent:'#ffd166',eye:'#f2ecff',pupil:'#2a1f52',body:'round'},
  witch:{base:'#5b3fa8',outline:'#241a43',accent:'#ff9f43',eye:'#f6f0ff',pupil:'#241a43',body:'round'},
  alchemist:{base:'#c8a2ff',outline:'#3a2a5c',accent:'#4ade80',eye:'#faf4ff',pupil:'#3a2a5c',body:'round'},
  knight:{base:'#a8b4c4',outline:'#3a4150',accent:'#e8452f',eye:'#eaf2ff',pupil:'#3a4150',body:'round'},
  slime:{base:'#4ade80',outline:'#145c33',accent:'#c8ffd8',eye:'#f2fff6',pupil:'#145c33',body:'blob'},
  goblin:{base:'#7cc242',outline:'#2a3a12',accent:'#b8e08a',eye:'#fff8dc',pupil:'#2a3a12',body:'round'},
  gnome:{base:'#e8b06b',outline:'#5c3a12',accent:'#b8352f',eye:'#fffaf0',pupil:'#5c3a12',body:'round'},
  elf:{base:'#ffd8b5',outline:'#5b3a2a',accent:'#4ade80',eye:'#e8f8ff',pupil:'#3a5a7a',body:'round',skin:true},
  orc:{base:'#6b8f3a',outline:'#2a3a12',accent:'#a8c46b',eye:'#fff8dc',pupil:'#2a3a12',body:'round'},
  troll:{base:'#8b93a7',outline:'#3a4150',accent:'#c4ccd8',eye:'#eaf2ff',pupil:'#3a4150',body:'round'},
  unicorn:{base:'#f0f0ff',outline:'#5b5b8a',accent:'#ff9ad5',eye:'#eef0ff',pupil:'#4a4a78',body:'cat'},
  pegasus:{base:'#f0f0ff',outline:'#5b5b8a',accent:'#c4ccd8',eye:'#eef0ff',pupil:'#4a4a78',body:'cat'},
  griffin:{base:'#e8b06b',outline:'#5c3a12',accent:'#e8452f',eye:'#fff6d8',pupil:'#5c3a12',body:'bird'},
  cerberus:{base:'#5b4a3a',outline:'#241a12',accent:'#8b7a6a',eye:'#ff8a8a',pupil:'#2b0c0c',body:'cat'},
  chimera:{base:'#c76bd6',outline:'#4a1f52',accent:'#7cc242',eye:'#fff6ff',pupil:'#4a1f52',body:'cat'},
  minotaur:{base:'#8b5a3a',outline:'#3a2412',accent:'#c99a63',eye:'#ffe8c0',pupil:'#3a2412',body:'round'},
  centaur:{base:'#c99a63',outline:'#5c3a12',accent:'#e8c9a0',eye:'#fffaf0',pupil:'#5c3a12',body:'round'},
  mermaid:{base:'#7ad8e8',outline:'#1f4a52',accent:'#ff9ad5',eye:'#f2feff',pupil:'#1f4a52',body:'round'},
  siren:{base:'#b8a0ff',outline:'#3a2a5c',accent:'#ff9ad5',eye:'#f6f0ff',pupil:'#3a2a5c',body:'round'},
  harpy:{base:'#c99a63',outline:'#5c3a12',accent:'#8b93a7',eye:'#fffaf0',pupil:'#5c3a12',body:'bird'},
  guardian:{base:'#fff6d8',outline:'#8a7a4a',accent:'#ffd166',eye:'#fffdf2',pupil:'#6a5a2a',body:'round'},
  cherub:{base:'#ffd8b5',outline:'#8a5a5a',accent:'#ffe8f0',eye:'#fffaf6',pupil:'#6a3a3a',body:'round',skin:true},
  astronaut:{base:'#e8eef5',outline:'#4a5568',accent:'#a8b4c4',eye:'#4a5568',pupil:'#4a5568',body:'round'},
  alien:{base:'#7cc242',outline:'#1f3a12',accent:'#b8e08a',eye:'#0f1f0a',pupil:'#0f1f0a',body:'tall'},
  ufo:{base:'#a8b4c4',outline:'#2b3140',accent:'#38bdf8',eye:'#2b3140',pupil:'#2b3140',body:'blob'},
  spacecat:{base:'#e8eef5',outline:'#4a5568',accent:'#38bdf8',eye:'#4a5568',pupil:'#4a5568',body:'cat'},
  star:{base:'#ffd166',outline:'#8a6212',accent:'#fff0b8',eye:'#fffdf0',pupil:'#8a6212',body:'round'},
  moon:{base:'#fff0b8',outline:'#8a7a3a',accent:'#ffe08a',eye:'#8a7a3a',pupil:'#8a7a3a',body:'round'},
  sun:{base:'#ffd166',outline:'#8a6212',accent:'#ffb03b',eye:'#fffdf0',pupil:'#8a6212',body:'round'},
  golem:{base:'#8b8b7a',outline:'#3a3a2e',accent:'#b8b8a0',eye:'#ffe066',pupil:'#3a3a2e',body:'round'}
};

// which overlays each species uses (order matters: back-to-front)
const USE={
  deepseek:['sparkle','gloss'],
  claude:['sparkle'],
  anime:['hair','ponytail'],
  hacker_cat:['ears_point','goggles','whiskers','whiskers_r','tail'],
  fox:['ears_point','muzzle','whiskers','whiskers_r','tail'],
  penguin:['beak','scarf'],
  capybara:['muzzle','spots'],
  shiba:['ears_point','muzzle','tail'],
  hamster:['muzzle','spots'],
  octopus:['tentacles'],
  axolotl:['gills','gills_r'],
  dragon:['horns','wings','wings_r','tail'],
  phoenix:['flame','wings','wings_r'],
  frog:['mouth_big','spots'],
  ninja_penguin:['beak','bandana','katana'],
  robo_cat:['ears_point','visor','antenna','tail'],
  robo_dog:['ears_point','visor','antenna'],
  drone:['dome','lights'],
  android:['antenna'],
  term_ghost:['bolt','gloss'],
  ghost:['gloss'],
  demon:['horns','tail'],
  samurai:['helmet','armor','katana'],
  ninja:['mask','bandana','katana'],
  mage:['hat','robe','staff'],
  witch:['hat','ponytail','robe'],
  alchemist:['goggles','robe'],
  knight:['helmet','armor','sword','cape'],
  slime:['gloss'],
  goblin:['horns'],
  gnome:['hat','robe'],
  elf:['hair','robe'],
  orc:['horns','armor'],
  troll:['horns','cracks'],
  unicorn:['ears_point','horns','hair','tail'],
  pegasus:['ears_point','wings','wings_r','tail'],
  griffin:['beak','wings','wings_r'],
  cerberus:['ears_point','horns','tail'],
  chimera:['horns','wings','wings_r','tail'],
  minotaur:['horns','armor'],
  centaur:['ears_point','tail'],
  mermaid:['ponytail','gills','gills_r'],
  siren:['ponytail','wings','wings_r'],
  harpy:['beak','wings','wings_r'],
  guardian:['halo','wings','wings_r','robe'],
  cherub:['halo','wings','wings_r'],
  astronaut:['helmet','visor'],
  alien:['antenna'],
  ufo:['dome','lights'],
  spacecat:['ears_point','helmet','tail'],
  star:['sparkle'],
  moon:['craters'],
  sun:['rays'],
  golem:['armor','cracks']
};

// --------------------------------------------------------------- rendering
function shade(hex,amt){
  const h6=String(hex).replace('#','');
  let r=parseInt(h6.slice(0,2),16),g=parseInt(h6.slice(2,4),16),b=parseInt(h6.slice(4,6),16);
  if(amt>0){r+=(255-r)*amt;g+=(255-g)*amt;b+=(255-b)*amt}else{r*=1+amt;g*=1+amt;b*=1+amt}
  const c=v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0');
  return '#'+c(r)+c(g)+c(b);
}
const SIZE=16;
function grid(key,frame){
  const pal=PAL[key]||PAL.deepseek;
  const tpl=TEMPLATES[pal.body]||TEMPLATES.round;
  // palette letter → colour
  const col={
    '#':pal.outline,
    '@':pal.base,
    '+':shade(pal.base,.18),
    '-':shade(pal.base,-.16),
    'w':pal.eye||'#ffffff',
    'p':pal.pupil||pal.outline,
    'b':shade(pal.base,-.14),
    'a':pal.accent,
    'y':'#ffd166',
    's':pal.skin?pal.base:pal.base,
    'h':pal.skin?'#2b1d2e':shade(pal.base,-.35),
    'k':'#22222a',
    'g':pal.eye||'#5ef0ff'
  };
  const g=[];
  for(let y=0;y<SIZE;y++){
    const row=(tpl[y]||'................');
    g.push(row.split('').map(ch=>ch==='.'?null:(col[ch]||pal.base)));
  }
  // blink (frame 1): draw a lid line only over the eye pixels (never touch the body)
  const eyelike=c=>c===col.w||c===col.p;
  if(frame===1){
    // find eye columns by scanning the eye rows for white/pupil
    const eyeRow=6;
    let found=false;
    for(let x=0;x<SIZE;x++){
      for(let y=eyeRow;y<=eyeRow+1;y++){
        if(g[y]&&eyelike(g[y][x])){g[y][x]=pal.pupil||pal.outline;found=true}
      }
    }
  }
  // happy (frame 2): eyes become ^ ^ (only over eye pixels)
  if(frame===2){
    for(let y=5;y<9;y++)for(let x=0;x<SIZE;x++){
      if(g[y]&&eyelike(g[y][x])){
        const ink=pal.pupil||pal.outline;
        // keep the middle of each eye cluster bright, edges dark → reads like ^
        g[y][x]=ink;
      }
    }
  }
  // overlays
  (USE[key]||[]).forEach(name=>{
    const L=LAYERS[name];if(!L)return;
    L.rows.forEach((row,dy)=>{
      row.split('').forEach((ch,dx)=>{
        if(ch==='.')return;
        const x=L.x+dx,y=L.y+dy;
        if(x<0||x>=SIZE||y<0||y>=SIZE)return;
        if(!g[y])return;
        const isEyeChar=ch==='w'||ch==='p';
        // never paint an accessory over a transparent area (keeps silhouettes clean)
        if(g[y][x]===null&&!isEyeChar&&name!=='halo'&&name!=='rays'&&name!=='sparkle'&&name!=='wings'&&name!=='wings_r'&&name!=='tail'&&name!=='cape'&&name!=='flame'&&name!=='staff'&&name!=='sword'&&name!=='katana'&&name!=='antenna'&&name!=='lights')return;
        g[y][x]=col[ch]||pal.accent;
      });
    });
  });
  return g;
}
function svgFor(key,frame,size){
  const g=grid(key,frame);
  const px=size/SIZE;
  const byColor=new Map();
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const c=g[y][x];if(!c)continue;
    if(!byColor.has(c))byColor.set(c,[]);
    byColor.get(c).push([x,y]);
  }
  let out='';
  for(const [c,list] of byColor){
    let d='';
    for(const [x,y] of list)d+='M'+x+' '+y+'h1v1h-1z';
    out+='<path d="'+d+'" fill="'+c+'"/>';
  }
  return '<svg viewBox="0 0 16 16" width="'+size+'" height="'+size+'" shape-rendering="crispEdges">'+out+'</svg>';
}
O.mascotSvg=svgFor;
const ORDER=['deepseek','claude','anime','hacker_cat','fox','penguin','capybara','shiba','hamster','octopus','axolotl','dragon','phoenix','frog','ninja_penguin','robo_cat','robo_dog','drone','android','term_ghost','ghost','demon','samurai','ninja','mage','witch','alchemist','knight','slime','goblin','gnome','elf','orc','troll','unicorn','pegasus','griffin','cerberus','chimera','minotaur','centaur','mermaid','siren','harpy','guardian','cherub','astronaut','alien','ufo','spacecat','star','moon','sun','golem'];
const NAME={deepseek:'DeepSeek кит',claude:'Claude искра',anime:'Аниме-девушка',hacker_cat:'Кот-хакер',fox:'Лисёнок',penguin:'Пингвин',capybara:'Капибара',shiba:'Шиба-ину',hamster:'Хомяк',octopus:'Осьминог',axolotl:'Аксолотль',dragon:'Дракончик',phoenix:'Феникс',frog:'Лягушка',ninja_penguin:'Пингвин-ниндзя',robo_cat:'Робот-кот',robo_dog:'Робот-собака',drone:'Дрон',android:'Андроид',term_ghost:'Терминал-дух',ghost:'Призрак',demon:'Демонёнок',samurai:'Самурай',ninja:'Ниндзя',mage:'Маг',witch:'Ведьмочка',alchemist:'Алхимик',knight:'Рыцарь',slime:'Слайм',goblin:'Гоблин',gnome:'Гном',elf:'Эльф',orc:'Орк',troll:'Тролль',unicorn:'Единорог',pegasus:'Пегас',griffin:'Грифон',cerberus:'Цербер',chimera:'Химера',minotaur:'Минотавр',centaur:'Кентавр',mermaid:'Русалка',siren:'Сирена',harpy:'Гарпия',guardian:'Ангел-хранитель',cherub:'Херувим',astronaut:'Астронавт',alien:'Инопланетянин',ufo:'НЛО',spacecat:'Космокот',star:'Звёздочка',moon:'Луна',sun:'Солнышко',golem:'Голем'};
O.mascotName=k=>NAME[k]||k;

// emotes (SVG only, no emoji)
const EMOTE={
  thinking:'<g fill="currentColor"><circle cx="4.6" cy="10" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="15.4" cy="10" r="1.5"/></g>',
  writing:'<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11.2 3.2l3.6 3.6-7.4 7.4H3.8v-3.6z"/><path d="M13.4 5.4l1.4-1.4a1.4 1.4 0 012 2l-1.4 1.4"/></g>',
  waiting:'<g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M7.2 6.4a2.9 2.9 0 115.8 0c0 1.9-2.4 2.3-2.9 3.8"/><circle cx="10.1" cy="14.2" r="1.1" fill="currentColor" stroke="none"/></g>',
  error:'<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 3.4l7.2 12.8H2.8z"/><path d="M10 8.2v3.4"/><circle cx="10" cy="14" r="1" fill="currentColor" stroke="none"/></g>'
};
const emoteSvg=st=>EMOTE[st]?'<svg viewBox="0 0 20 20" width="15" height="15">'+EMOTE[st]+'</svg>':'';

// --------------------------------------------------------------- component
let el,sprite,emoteEl,frame=0,frameTimer=null,state='idle',drag=null;
const cache=new Map();
function html(key,fr,size){
  const k=key+'|'+fr+'|'+size;
  if(cache.has(k))return cache.get(k);
  const v=svgFor(key,fr,size);
  if(cache.size>500)cache.clear();
  cache.set(k,v);return v;
}
function renderSprite(){
  const sp=S.opts.mascot&&PAL[S.opts.mascot]?S.opts.mascot:'deepseek';
  sprite.innerHTML=html(sp,frame%3,S.opts.mascotSize||44);
  el.dataset.state=state;el.dataset.species=sp;
  if(emoteEl)emoteEl.innerHTML=emoteSvg(state);
}
function startFrames(){
  if(frameTimer)clearInterval(frameTimer);
  const speed=state==='writing'?190:state==='thinking'?360:state==='waiting'?280:1100;
  frameTimer=setInterval(()=>{frame++;renderSprite()},speed);
}
function setState(s){
  if(state===s)return;
  state=s;
  if(el){el.dataset.state=s;if(emoteEl)emoteEl.innerHTML=emoteSvg(s);startFrames()}
}
function derive(){
  const st=S.status[S.sid];
  if(S.perms.some(p=>p.sessionID===S.sid)||S.questions.some(q=>q.sessionID===S.sid))return 'waiting';
  if(st&&st.type!=='idle'){
    const streaming=O.msgs(S.sid).list.slice(-2).some(m=>(m.parts||[]).some(p=>p.type==='text'&&p.text&&p.text.length&&!(p.time&&p.time.end)));
    return streaming?'writing':'thinking';
  }
  return 'idle';
}
const tick=()=>setState(derive());

O.mascotInit=parent=>{
  el=h('div',{class:'mascot',title:O.tr('Drag me · tap for options','Перетащи · тап — настройки')});
  sprite=h('div',{class:'mascot-sprite'});
  emoteEl=h('div',{class:'mascot-emote'});
  el.append(sprite,emoteEl);
  el.style.display=S.opts.mascotOn?'':'none';
  el.style.setProperty('--ms',(S.opts.mascotSize||44)+'px');
  parent.append(el);
  renderSprite();startFrames();
  const pos=O.store.get('mascotPos',null);
  if(pos){el.style.left=pos.x+'px';el.style.top=pos.y+'px';el.dataset.placed='1'}
  const host=()=>parent.getBoundingClientRect();
  const onDown=e=>{
    if(e.button!=null&&e.button!==0)return;
    const t=e.touches?e.touches[0]:e;
    const r=el.getBoundingClientRect();
    drag={ox:t.clientX-r.left,oy:t.clientY-r.top,moved:false,sx:t.clientX,sy:t.clientY};
    try{el.setPointerCapture&&el.setPointerCapture(e.pointerId)}catch(_){}
  };
  const onMove=e=>{
    if(!drag)return;
    const t=e.touches?e.touches[0]:e;
    if(!drag.moved&&Math.abs(t.clientX-drag.sx)<4&&Math.abs(t.clientY-drag.sy)<4)return;
    drag.moved=true;
    const hb=host(),size=el.offsetWidth||44;
    const nx=Math.min(Math.max(4,t.clientX-hb.left-drag.ox),hb.width-size-4);
    const ny=Math.min(Math.max(4,t.clientY-hb.top-drag.oy),hb.height-size-4);
    el.style.left=nx+'px';el.style.top=ny+'px';el.dataset.placed='1';
    if(e.cancelable)e.preventDefault();
  };
  const onUp=()=>{
    if(!drag)return;
    const moved=drag.moved;drag=null;
    if(moved){O.store.set('mascotPos',{x:parseFloat(el.style.left)||0,y:parseFloat(el.style.top)||0});if(O.native.haptic)O.native.haptic('tick')}
    else mascotMenu();
  };
  el.addEventListener('pointerdown',onDown);
  el.addEventListener('pointermove',onMove,{passive:false});
  el.addEventListener('pointerup',onUp);
  el.addEventListener('pointercancel',()=>{drag=null});
  el.addEventListener('touchstart',onDown,{passive:true});
  el.addEventListener('touchmove',onMove,{passive:false});
  el.addEventListener('touchend',onUp);
  ['status','perm','part','msg'].forEach(n=>bus.on(n,tick));
  bus.on('open',()=>{tick();const p=O.store.get('mascotPos',null);if(p){el.style.left=p.x+'px';el.style.top=p.y+'px'}});
  O.mascotRefresh=()=>{
    el.style.display=S.opts.mascotOn?'':'none';
    el.style.setProperty('--ms',(S.opts.mascotSize||44)+'px');
    renderSprite();startFrames();tick();
  };
  tick();
};
function mascotMenu(){
  O.actions(O.mascotName(S.opts.mascot||'deepseek'),[
    {label:O.tr('Change mascot','Сменить маскота'),icon:'palette',fn:()=>O.openMascotSettings()},
    {label:O.tr('Size','Размер'),sub:(S.opts.mascotSize||44)+'px',icon:'sliders',fn:()=>O.openMascotSettings()},
    {label:S.opts.mascotOn?O.tr('Hide mascot','Скрыть маскота'):O.tr('Show mascot','Показать маскота'),icon:'eye',fn:()=>{S.opts.mascotOn=!S.opts.mascotOn;O.saveOpts();O.mascotRefresh&&O.mascotRefresh()}},
    {label:O.tr('Reset position','Сбросить позицию'),icon:'undo',fn:()=>{O.store.remove('mascotPos');if(el){el.style.left='';el.style.top='';delete el.dataset.placed}}}
  ]);
}
O.openMascotSettings=()=>{
  const body=h('div');
  const draw=()=>{
    body.textContent='';
    body.append(
      O.toggleRow('bot',O.tr('Show mascot','Показывать маскота'),O.tr('A pixel companion above the composer','Пиксельный компаньон над полем ввода'),
        S.opts.mascotOn!==false,v=>{S.opts.mascotOn=v;O.saveOpts();O.mascotRefresh&&O.mascotRefresh()}),
      h('div',{class:'grp'},O.tr('Size','Размер')),
      h('div',{class:'seg'},[28,36,44,56,72].map(n=>h('button',{class:S.opts.mascotSize===n?'on':'',
        onclick:()=>{S.opts.mascotSize=n;O.saveOpts();O.mascotRefresh&&O.mascotRefresh();draw()}},n+'px'))),
      h('div',{class:'grp'},O.tr('Species','Вид')+' ('+ORDER.length+')')
    );
    const grid=h('div',{class:'mascot-grid'});
    ORDER.forEach(k=>{
      const prev=h('div',{class:'mascot-prev'+(S.opts.mascot===k?' on':''),title:O.mascotName(k),
        html:svgFor(k,0,44)+'<span>'+O.esc(O.mascotName(k))+'</span>'});
      prev.onclick=()=>{S.opts.mascot=k;O.saveOpts();O.mascotRefresh&&O.mascotRefresh();draw()};
      grid.append(prev);
    });
    body.append(grid);
  };
  draw();
  O.sheet(O.tr('Mascot','Маскот'),body,{full:true});
};
})();