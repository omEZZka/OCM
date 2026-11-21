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


// ---------------------------------------------------------------------------
// Hand-drawn signature sprites (16x16, 5 tones) — modelled after the real logos:
//   DeepSeek = the blue whale from the official mark (big rounded head, small eye,
//              tapering body, forked tail, water spout).
//   Claude   = the terracotta spark drawn as a cute octopus: round mantle,
//              huge eyes, six curly legs.
// Letters: o=outline d=dark b=base l=light w=white e=eye/glow a=accent
const CUSTOM={
  // DeepSeek: pixel whale (rounded head, small eye, tapering body, forked fluke, water spout)
  deepseek:[
    '................',
    '.......w........',
    '......w.w.......',
    '....ooooooo.....',
    '..oobllllbboo...',
    '.obllllllllbbo..',
    '.oblllllllllbbo.',
    '.oblelllllllbbo.',
    '.obllllllllbbbbo',
    '..oblllllbbbboo.',
    '...oobbbbbboo...',
    '.....ooooo......',
    '................',
    '................',
    '................',
    '................'
  ],
  // Qwen: violet swirl marked with a Q
  qwen:[
    '................',
    '......oooo......',
    '....oobbbboo....',
    '...obllllllbo...',
    '..obllllllllbo..',
    '..obllwwwwllbo..',
    '.oblllwwwwlllbo.',
    '.oblllwwwwlllbo.',
    '.oblllllwllllbo.',
    '.oblllllwwlllbo.',
    '.oblllllwwllbbo.',
    '..obllllllbbqo..',
    '..obbllllbbboq..',
    '...oobbbbooo.qq.',
    '.....oooo....q..',
    '................'
  ],
  // Hacker cat: grey cat, green visor eyes, hoodie collar
  hacker_cat:[
    '................',
    '..oo........oo..',
    '..obo......obo..',
    '..obboooooobbo..',
    '.obllllllllllbo.',
    '.obllllllllllbo.',
    '.obgggllllgggbo.',
    '.obgggllllgggbo.',
    '.obllllllllllbo.',
    '..obllllllllbo..',
    '..okkkkkkkkkko..',
    '..obllllllllbo..',
    '...obllllllbo...',
    '...ob.o..o.bо...',
    '................',
    '................'
  ]
};
const CUSTOM_COL={
  deepseek:{o:'#16225c',d:'#22307a',b:'#4d6bfe',l:'#8fa7ff',w:'#ffffff',e:'#0b1030',a:'#a8b8ff'},
  qwen:{o:'#2b1a4a',b:'#7c5cff',l:'#b9a6ff',w:'#ffffff',q:'#e8dcff',e:'#2b1a4a'},
  hacker_cat:{o:'#171720',b:'#8f97ab',l:'#cdd5e6',g:'#4ade80',k:'#4ade80',e:'#0d1f12'}
};


// ---------------------------------------------------------------------------
// Soul Knight pets (33 picked) — drawn in the same 16x16 5-tone style.
// Each pet is its own hand-authored sprite so it reads like the real pet.
const SK_ART={
  chilly:['................','..hh........hh..','..hhh......hhh..','..hhhhhhhhhhhh..','.hhbbbbbbbbbbhh.','.hbbbbbbbbbbbbh.','.hbwwebbbwewwbh.','.hbwpebbbwepwbh.','.hbbbbbbbbbbbbh.','..hbbpbbbbpbbh..','...bbbbbbbbbb...','...bbbbbbbbbb...','...bb.hh.hh.bb..','...bb..hh..bb...','................','................'],
  buddy:['................','..ab........ab..','..abb......bba..','..abbbbbbbbbba..','.abbbbbbbbbbbba.','.abbwwebbweewba.','.abbwpebbwepwba.','.abbbbbbbbbbbba.','..abbbpbbbpbba..','...bbbbbbbbbb...','...bbbbbbbbbb...','...bb.bb.bb.bb..','...bb..bb..bb...','................','................','................'],
  hamm:['................','...p........p...','..pp........pp..','..pppppppppppp..','.ppbbbbbbbbbbpp.','.pbbbbbbbbbbbbp.','.pbwwebbbbwewbp.','.pbwpebbbbwepbp.','.pbbbbbbbbbbbbp.','..pbbpbbbbpbbp..','...bbbbbbbbbb...','...bbbbbbbbbb...','...bb.pp.pp.bb..','....b..pp..b....','................','................'],
  blue:['................','................','......oooo......','....oobbbboo....','...obbbbbbbbo...','..obbbbbbbbbbo..','..obwwebbweewbo.','..obwpebbwepbo..','..obbbbbbbbbbo..','..obbbbbbbbbbo..','...obbbbbbbbo...','....oobbbboo....','......oooo......','................','................','................'],
  robo:['................','....m......m....','....mm....mm....','..mmmmmmmmmmmm..','.mmbbbbbbbbbbmm.','.mbbbbbbbbbbbbm.','.mbeebbbbeeebbm.','.mbeebbbbeeebbm.','.mbbbbbbbbbbbbm.','..mbbbammabbbm..','...bbbbbbbbbb...','...bbbbbbbbbb...','...mm.bb.bb.mm..','................','................','................'],
  panda:['................','...k........k...','..kk........kk..','..kkkkkkkkkkkk..','.kkwwwwwwwwwwkk.','.kwwwwwwwwwwwwk.','.kwwkkkwwkkkwwk.','.kwwkkkwwkkkwwk.','.kwwwwwwwwwwwwk.','..kwwkwwwwkwwk..','...wwwwwwwwww...','...wwwwkkwwww...','...ww.kk.kk.ww..','...w..kk..kk.w..','................','................'],
  bonbon:['................','..ll........ll..','..lll......lll..','..llllllllllll..','.llbbbbbbbbbbll.','.lbbbbbbbbbbbbbl','.lbwwebbbbwewbl.','.lbwpebbbbwepbl.','.lbbbbbbbbbbbbbl','..lbbpbbbbpbbl..','...bbbbbbbbbb...','...bbbbbbbbbb...','...bb.ll.ll.bb..','...bb..ll..bb...','................','................'],
  canpig:['................','..p..........p..','..pp........pp..','..pppppppppppp..','.ppbbbbbbbbbbpp.','.pbbbbbbbbbbbbp.','.pbwwebbbbwewbp.','.pbwpebbbbwepbp.','.pbbbbbbbbbbbbp.','..pbbpbbbbpbbp..','...bbbbbbbbbb...','..bbbbbbbbbbbb..','..bb.pppppp.bb..','..b..pppppp..b..','................','................'],
  pigeon:['................','.....gggggg.....','....gwwwwwwg....','...gwwbbwwwwg...','..gwwbbwwwwwwg..','..gwwebbbbbeeg..','...gwbbwwbbwg...','....gwwwwwwg....','.....gggggg.....','......gggg......','......gggg......','.....gg..gg.....','.....g....g.....','................','................','................'],
  bug:['................','...o........o...','..oao......oao..','..oaao....oao...','...oaoooooao....','..ooobbbbbooo...','.obbwweewwbbbo..','.obbbbbbbbbbo...','..oobbbbbboo....','....ooboo.......','.....oobbo......','......oobbo.....','.......oobo.....','........oo......','................','................'],
  tengu:['................','....a......a....','...aa......aa...','...aaaa..aaaa...','..aaaaaaaaaaaa..','.aabbbbbbbbbbaa.','.abwwebbbbwewba.','.abwpebbbbwepba.','.abbbbbbbbbbbba.','..abbbpppbbbba..','...bbbbbbbbbb...','...bbbbbbbbbb...','...aa.bb.bb.aa..','................','................','................'],
  peanut:['................','....a......a....','...aa......aa...','...aaaaaaaaaa...','..abbbbbbbbbba..','.abbbbbbbbbbbba.','.abwwebbbbewbаа.','.abwpebbbbewbаа.','.abbbbbbbbbbbba.','..abbbbbbbbbba..','...bbbbbbbbbb...','...bbbbbbbbbb...','...aa.bb.bb.aa..','................','................','................'],
  snow:['................','.....wwwwww.....','....wwwwwwww....','...wwwwwwwwww...','..wwwwwkkwwwww..','..wwwwkkkkwwww..','..wwwwkkkkwwww..','..wweewwwweeww..','..wwwwkwwkwwww..','...wwwwwwwwww...','...wwwwwwwwww...','...ww.ww.ww.ww..','...ww..ww..ww...','................','................','................'],
  officer:['................','..hh........hh..','..hhh......hhh..','..hhhhhhhhhhhh..','.hhbbbbbbbbbbhh.','.hbbbbbbbbbbbbh.','.hbwwebbbwewwbh.','.hbwpebbbwepwbh.','.haaaaaaaaabbh..','..hbbpbbbbpbbh..','...bbbbbbbbbb...','...bbbbbbbbbb...','...bb.hh.hh.bb..','...bb..hh..bb...','................','................'],
  blani:['................','.......f........','......fff.......','.....fffff......','....fffffff.....','...fffffffff....','..ffyfffffyff...','..ffffffffff....','..ffffffyfff....','...ffffffff.....','....ffffff......','.....ffff.......','................','................','................','................'],
  rosemary:['................','..ee........ee..','..eee......eee..','..hhhhhhhhhhhh..','.hhbbbbbbbbbbhh.','.hbbbbbbbbbbbbh.','.hbwwbbbbbbbwbh.','.hbpebbbbbbe pbh','.hbbbbbbbbbbbbh.','..hbbbbbbbbbbh..','...hbhbhbhbhb...','...h.b.h.b.h....','................','................','................','................'],
  discount:['................','....aaaaaa......','...ayyyyyyaa....','..ayyyyyyyyyа...','..aykkkkkkkya...','..aykwwwwkkya...','..aykwkkkkkkya..','..aykkkkkkkya...','..ayyyyyyyyyа...','...ayyyyyyyya...','....aaaaaaaa....','................','................','................','................','................'],
  pepper:['................','....r......r....','...rr......rr...','...rrrrrrrrrr...','..rbbbbbbbbbbr..','..rbbbbbbbbbbr..','..rbwwebbweebr..','..rbwpebbwepbr..','..rbbbbbbbbbr...','...rbbppppbr....','...bbbbbbbbbb...','...bbbbbbbbbb...','...rr.bb.bb.rr..','................','................','................'],
  roachy:['................','..k..........k..','.kkk.ooooo..kkk.','..kkobbbbbo.kk..','..oobbbbbbboo...','.oobbeebbeeboo..','.obbbbbbbbbbbo..','.obbbbbbbbbbbo..','.oobbbbbbbbboo..','..o.obbo.obbo...','....o.bo..o.bo..','...o..bo...o.bо.','......o.....o...','................','................','................'],
  chillycube:['................','..oooooooooooo..','..obbbbbbbbbbo..','..obbbbbbbbbbo..','..obwwebbweebo..','..obwpebbwepbo..','..obbbbbbbbbbo..','..obbbbbbbbbbo..','..obbbbbbbbbbo..','..obbbbbbbbbbo..','..oooooooooooo..','................','................','................','................','................'],
  mechachilly:['................','..mm........mm..','..mmm......mmm..','..mmmmmmmmmmmm..','.mmbbbbbbbbbbmm.','.mbbbbbbbbbbbbm.','.mbeebbbbeebbm..','.mbeebbbbeebbм..','.mbbbbbbbbbbbbm.','..mbbeebeebbmm..','...bbbbbbbbbb...','...bbbbbbbbbb...','...mm.bb.bb.mm..','................','................','................'],
  tap:['................','....aaaaaaaa....','...awwwwwwwa....','..awwbbbbbwwa...','..awbwewwbwwa...','..awbbbbbbbwa...','..awwwwwwwwa....','...awwwwwwa.....','....aaaaaa......','................','................','................','................','................','................','................'],
  monki:['................','..kk........kk..','..kkk......kkk..','..kkbbbbbbbbkk..','.kkbbbbbbbbbbkk.','.kbbwwebbweebbk.','.kbbwpebbwepbbk.','.kbbbbbbbbbbbbk.','..kbbppppppbbk..','...bbbbbbbbbb...','...bbbbbbbbbb...','...bb.bb.bb.bb..','...bb..bb..bb...','................','................','................'],
  douwa:['................','....yyyyyyyy....','...ywwwwwwwwy...','..ywwbbbbbbwwy..','..ywbbbbbbbbwy..','..ybwewbbbwewy..','..ybbbbbbbbby...','..ybbbppppbbby..','...ywwwwwwwwy...','....yyyyyyyy....','...y.y.y.y.y.y..','..y..y.y.y..y...','................','................','................','................'],
  laicai:['................','...r........r...','..rr........rr..','..rrrrrrrrrrrr..','.rrbbbbbbbbbbrr.','.rbwwebbbbewbrr.','.rbwpebbbbewbrr.','.rrbbbbbbbbbbrr.','..rrbbppppbbrr..','...rrrrrrrrrr...','...rbbbbbbbbr...','...rrrrrrrrrr...','...r..rrrr..r...','................','................','................'],
  toastie:['................','..aaaaaaaaaaaa..','.abbbbbbbbbbbba.','.abwwebbbbewbba.','.abwpebbbbewbba.','.abbbbbbbbbbbba.','.abbbbbbbbbbbba.','.aaaaaaaaaaaaaa.','..aaaaaaaaaaaa..','...a.a.a.a.a.a..','................','................','................','................','................','................'],
  drill:['................','.....kkkkkk.....','....kkbbbbkk....','...kkbbbbbbkk...','...kbbbwwbbbk...','...kbbbeebbbk...','...kkbbbbbbkk...','....kkbbbbkk....','.....kkkkkk.....','....dd....dd....','...ddd....ddd...','................','................','................','................','................'],
  kapikapi:['................','..ee........ee..','..eee......eee..','..eeeeeeeeeeee..','.eebbbbbbbbbbee.','.ebbbbbbbbbbbbbe','.ebkkbbbbbbkkbbe','.ebkkbbbbbbkkbbe','.ebbbbbbbbbbbbbe','..eebbbbbbbbee..','...bbbbbbbbbb...','...bbbbbbbbbb...','...ee......ee...','................','................','................'],
  mahhmot:['................','....a......a....','...aa......aa...','...aaaaaaaaaa...','..abbbbbbbbbba..','.abbbbbbbbbbbba.','.abbkkkkkkkkbba.','.abbkwwkkwwkbba.','.abbkkkkkkkkbba.','..abbbkkkkbbba..','...bbbbbbbbbb...','...bbbbbbbbbb...','...aa.bb.bb.aa..','................','................','................'],
  zongzibro:['................','....t......t....','...tt......tt...','...tttttttttt...','..tbbbbbbbbbtt..','..tbbbbbbbbbbt..','..tbbwweewwbbt..','..tbbwpeepwbbt..','..tbbbbbbbbbbt..','...tbbppppbbt...','...tbbbbbbbbtt..','...ttbbbbbbtt...','....tt....tt....','................','................','................'],
  slimy:['................','................','......gggg......','....ggbbbbgg....','...gbbbbbbbbg...','..gbbbbbbbbbbg..','..gbwwebbweebg..','..gbwpebbwepbg..','..gbbbbbbbbbbg..','..gbbbbbbbbbbg..','...gbbbbbbbbg...','....ggbbbbgg....','......gggg......','................','................','................'],
  meower:['................','..ff........ff..','..fff......fff..','..ffffffffff....','.ffbbbbbbbbff...','.fbwwebbweebf...','.fbwpebbwepbf...','.ffbbbbbbbbff...','..ffbbppbbff....','...ffbbbbff.....','....ffffff......','.....ffff.......','................','................','................','................'],
  fortune:['................','....y......y....','...yy......yy...','...yyyyyyyyyy...','..ybbbbbbbbbby..','.ybbbbbbbbbbbby.','.ybbkkkkkkkkbby.','.ybbkwwkkwwkbby.','.ybbkkkkkkkkbby.','..ybbkkkkkkbby..','...bbbbbbbbbb...','...bbbbbbbbbb...','...yy.bb.bb.yy..','................','................','................']
};
const SK_COL={
  chilly:{o:'#2b1a10',h:'#e0883c',b:'#f2a45c',w:'#ffffff',e:'#2b1a10',p:'#2b1a10'},
  buddy:{o:'#3a2415',a:'#8b5a3a',b:'#c99a63',w:'#ffffff',e:'#2b1a10',p:'#2b1a10'},
  hamm:{o:'#5c2a34',p:'#ff9ad5',b:'#ffb8d8',w:'#ffffff',e:'#2b1a10'},
  blue:{o:'#145c33',b:'#4ade80',w:'#ffffff',e:'#145c33'},
  robo:{o:'#3a4150',m:'#8b93a7',b:'#c4ccd8',e:'#38bdf8',a:'#ff5d5d'},
  panda:{o:'#2b2b2b',k:'#2b2b2b',w:'#f6f6f6'},
  bonbon:{o:'#5b3a5a',l:'#ffffff',b:'#f0b8d8',w:'#ffffff',e:'#2b1a2b'},
  canpig:{o:'#5c2a34',p:'#ff9ad5',b:'#ffc0e0',w:'#ffffff',e:'#2b1a10'},
  pigeon:{o:'#4a5568',g:'#8b93a7',w:'#e8eef5',b:'#5b6b8a',e:'#2b3140'},
  bug:{o:'#3a2a12',a:'#c8a06a',b:'#6b8f3a',w:'#ffe066',e:'#3a2a12'},
  tengu:{o:'#5c2a2a',a:'#e8452f',b:'#c99a63',w:'#ffffff',e:'#2b1a10'},
  peanut:{o:'#6b4a1c',a:'#c8a06a',b:'#e8c08a',w:'#ffffff',e:'#3a2412'},
  snow:{o:'#5b6b8a',w:'#eef6ff',k:'#c8a06a',e:'#2b3140'},
  officer:{o:'#2b1a10',h:'#e0883c',b:'#f2a45c',a:'#3a5a9a',w:'#ffffff',e:'#2b1a10'},
  blani:{o:'#7a2f10',f:'#ff9f43',y:'#ffe066'},
  rosemary:{o:'#3a2a4a',h:'#8b93a7',b:'#c4ccd8',e:'#6b2a5a',w:'#ffffff'},
  discount:{o:'#6b5a1c',a:'#ffd166',y:'#ffe9a8',k:'#8b6b2a',w:'#ffffff'},
  pepper:{o:'#5c1a1a',r:'#e8452f',b:'#ff9f7a',w:'#ffffff',e:'#2b1a10'},
  roachy:{o:'#2b2a12',k:'#5b6b3a',b:'#8b9a4a',e:'#ffe066'},
  chillycube:{o:'#1f4a52',b:'#7ad8e8',w:'#ffffff',e:'#1f4a52'},
  mechachilly:{o:'#2b3140',m:'#5b6b8a',b:'#a8b4c4',e:'#38bdf8'},
  tap:{o:'#5b3a12',a:'#ffd166',b:'#8b6b2a',w:'#fff3c4',e:'#2b1a10'},
  monki:{o:'#3a2412',k:'#8b5a3a',b:'#c99a63',w:'#ffffff',e:'#2b1a10'},
  douwa:{o:'#6b5a1c',y:'#ffd166',b:'#c8a06a',w:'#ffffff',e:'#2b1a10'},
  laicai:{o:'#5c1a1a',r:'#e8452f',b:'#ff9f7a',w:'#ffffff',e:'#2b1a10'},
  toastie:{o:'#6b4a1c',a:'#e8c08a',b:'#fff0c8',w:'#ffffff',e:'#3a2412'},
  drill:{o:'#2b3140',k:'#5b6b8a',b:'#a8b4c4',d:'#8b6b3a',e:'#38bdf8'},
  kapikapi:{o:'#5c3a12',e:'#8b6b3a',b:'#8b6b3a',k:'#3a2412'},
  mahhmot:{o:'#2b1a12',a:'#8b6b3a',b:'#5b4a3a',k:'#2b1a10',w:'#ffe066'},
  zongzibro:{o:'#1f4a33',t:'#2b6b4a',b:'#4a8f5f',w:'#ffffff',e:'#1f2a1a'},
  slimy:{o:'#145c33',g:'#4ade80',b:'#7ddc8f',w:'#ffffff',e:'#145c33'},
  meower:{o:'#4a5568',f:'#8b93a7',b:'#c4ccd8',w:'#ffffff',e:'#2b3140'},
  fortune:{o:'#6b5a1c',y:'#ffd166',b:'#fff0b8',k:'#8b6b2a',w:'#ffffff'}
};
const SK_NAMES={chilly:'Chilly — кот',buddy:'Buddy — пёс',hamm:'Hamm — свинка',blue:'Blue — слайм',robo:'Robo — робот',panda:'Panda — панда',bonbon:'BonBon — кролик',canpig:"Can'bellied Pig — свинка",pigeon:'Pigeon — голубь',bug:'Inherited Bug — жук',tengu:'Mini Tengu — тэнгу',peanut:'Peanut — арахис',snow:'Snow — снежок',officer:'Officer Chilly — кот-офицер',blani:'Blani — огонёк',rosemary:'Rosemary Cat — кот-призрак',discount:'10% Off — скидка',pepper:'Director Pepper — директор',roachy:'Glitchy Roachy — глюк-жук',chillycube:'Chilly Cube — кубик',mechachilly:'Mecha Chilly — меха-кот',tap:'Tap — тап',monki:'Mad Monki — обезьяна',douwa:'Douwa — дува',laicai:'Lai Cai — Лай Цай',toastie:'Toastie — тостик',drill:'Lil Drillmaster — бурильщик',kapikapi:'Kapikapi — капибара',mahhmot:'Mahhmot — махмот',zongzibro:'Zongzi Bro — цзунцзы-брат',slimy:'Slimy — слизень',meower:'Meower — мяуэр',fortune:'Full Of Fortune — золотая свинья'};


// ---------------------------------------------------------------------------
// REAL ARTWORK (mascot-art.js): official DeepSeek/Claude marks + Soul Knight
// game sprites served as their own animated GIFs — no pixel reconstruction.
const ART=window.OCM_MASCOT_ART||{pets:{},brand:{}};
function realSvg(key,size,state){
  // No brand-logo mascots: every AI mascot is a pixel sprite, so Claude's raster stickers
  // (which brought a black plate in WebView) are gone entirely.
  return null;
  // Claude: the real Clawd sticker for the current state (idle/thinking/writing/waiting/error)
  if(key==='claude'&&ART.clawd){
    const src=ART.clawd[state]||ART.clawd.idle;
    if(src)return '<img class="mascot-img" src="'+src+'" width="'+size+'" height="'+size+'" alt="" draggable="false">';
  }
  const b=ART.brand[key];
  if(!b)return null;
  return '<svg viewBox="'+b.viewBox+'" width="'+size+'" height="'+size+'">'+b.body+'</svg>';
}
function realPet(key,size){
  const p=ART.pets[key];
  if(!p)return null;
  return '<img class="mascot-img" src="'+p.uri+'" width="'+size+'" height="'+size+'" alt="" draggable="false">';
}

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
function customGrid(key,frame){
  const sk=SK_ART[key];
  const rows=sk||CUSTOM[key];if(!rows)return null;
  const pal=(sk?SK_COL[key]:CUSTOM_COL[key])||{};
  const g=[];
  for(let y=0;y<16;y++){
    const row=rows[y]||'................';
    g.push(row.split('').map(ch=>ch==='.'?null:(pal[ch]||pal.b||'#888888')));
  }
  // frame 1: close the eyes (blink); frame 2: sparkle above the head
  if(frame===1){
    for(let y=0;y<16;y++)for(let x=0;x<16;x++){
      const c=g[y][x];
      if(c&&(c===pal.w||c===pal.e))g[y][x]=pal.e||'#222';
    }
  }
  if(frame===2){
    for(const [x,y,ch] of [[2,1,'w'],[13,1,'w'],[7,0,'w'],[9,0,'w']]){
      if(g[y]&&g[y][x]===null&&pal[ch])g[y][x]=pal[ch];
    }
  }
  return g;
}
function svgFor(key,frame,size){
  const real=realSvg(key,size,state)||realPet(key,size);
  if(real)return real;
  const g=customGrid(key,frame)||grid(key,frame);
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
// (legacy pixel ids kept for the hand-drawn fallback set)
const REAL_PETS=Object.keys(ART.pets).filter(k=>ART.pets[k]&&ART.pets[k].uri);
// Only three hand-drawn mascots stay (all the other drawn creatures were removed on request).
const PIXEL_PETS=['deepseek','qwen','hacker_cat'];
const ORDER=PIXEL_PETS.concat(REAL_PETS);
const SK_ORDER=REAL_PETS;
const NAME={deepseek:'DeepSeek кит',claude:'Claude искра',anime:'Аниме-девушка',hacker_cat:'Кот-хакер',fox:'Лисёнок',penguin:'Пингвин',capybara:'Капибара',shiba:'Шиба-ину',hamster:'Хомяк',octopus:'Осьминог',axolotl:'Аксолотль',dragon:'Дракончик',phoenix:'Феникс',frog:'Лягушка',ninja_penguin:'Пингвин-ниндзя',robo_cat:'Робот-кот',robo_dog:'Робот-собака',drone:'Дрон',android:'Андроид',term_ghost:'Терминал-дух',ghost:'Призрак',demon:'Демонёнок',samurai:'Самурай',ninja:'Ниндзя',mage:'Маг',witch:'Ведьмочка',alchemist:'Алхимик',knight:'Рыцарь',slime:'Слайм',goblin:'Гоблин',gnome:'Гном',elf:'Эльф',orc:'Орк',troll:'Тролль',unicorn:'Единорог',pegasus:'Пегас',griffin:'Грифон',cerberus:'Цербер',chimera:'Химера',minotaur:'Минотавр',centaur:'Кентавр',mermaid:'Русалка',siren:'Сирена',harpy:'Гарпия',guardian:'Ангел-хранитель',cherub:'Херувим',astronaut:'Астронавт',alien:'Инопланетянин',ufo:'НЛО',spacecat:'Космокот',star:'Звёздочка',moon:'Луна',sun:'Солнышко',golem:'Голем'};
const PIXEL_NAMES={deepseek:'DeepSeek — кит',qwen:'Qwen — спираль',hacker_cat:'Кот-хакер'};
O.mascotName=k=>{
  if(PIXEL_NAMES[k])return PIXEL_NAMES[k];
  if(ART.pets[k])return ART.pets[k].name;
  if(ART.brand[k])return ART.brand[k].name;
  return NAME[k]||SK_NAMES[k]||k;
};

// emotes (SVG only, no emoji)
const EMOTE={
  thinking:'<g fill="currentColor"><circle cx="4.6" cy="10" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="15.4" cy="10" r="1.5"/></g>',
  writing:'<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11.2 3.2l3.6 3.6-7.4 7.4H3.8v-3.6z"/><path d="M13.4 5.4l1.4-1.4a1.4 1.4 0 012 2l-1.4 1.4"/></g>',
  waiting:'<g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M7.2 6.4a2.9 2.9 0 115.8 0c0 1.9-2.4 2.3-2.9 3.8"/><circle cx="10.1" cy="14.2" r="1.1" fill="currentColor" stroke="none"/></g>',
  error:'<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 3.4l7.2 12.8H2.8z"/><path d="M10 8.2v3.4"/><circle cx="10" cy="14" r="1" fill="currentColor" stroke="none"/></g>',
  jailbreak:'<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2.5h8a1.5 1.5 0 011.5 1.5v12L12 13.4 8.5 16V4A1.5 1.5 0 0110 2.5z" transform="translate(-1.2 0)"/><path d="M13.5 7.5h2.6M14.8 6.2l1.3 1.3-1.3 1.3"/></g>'
};
const emoteSvg=st=>EMOTE[st]?'<svg viewBox="0 0 20 20" width="15" height="15">'+EMOTE[st]+'</svg>':'';

// --------------------------------------------------------------- coding bubble
// While the agent generates, a small speech bubble with an animated code glyph floats above
// the mascot. Pure SVG (no emoji, no images) so it matches any theme and never blinks.
const BUBBLE={
  thinking:'<svg viewBox="0 0 40 26" width="40" height="26"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="13" r="1.7" fill="currentColor" stroke="none" opacity=".35"><animate attributeName="opacity" values=".35;1;.35" dur="1.2s" repeatCount="indefinite"/></circle><circle cx="20" cy="13" r="1.7" fill="currentColor" stroke="none" opacity=".35"><animate attributeName="opacity" values=".35;1;.35" dur="1.2s" begin=".2s" repeatCount="indefinite"/></circle><circle cx="30" cy="13" r="1.7" fill="currentColor" stroke="none" opacity=".35"><animate attributeName="opacity" values=".35;1;.35" dur="1.2s" begin=".4s" repeatCount="indefinite"/></circle></g></svg>',
  writing:'<svg viewBox="0 0 44 26" width="44" height="26"><rect x="1" y="2" width="42" height="22" rx="5" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".55"/><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9l-3.5 4 3.5 4"/><path d="M35 9l3.5 4-3.5 4"/><path d="M25 8.5l-5 9"/></g><circle cx="16" cy="22.5" r="1.1" fill="currentColor"><animate attributeName="opacity" values="1;.15;1" dur="1s" repeatCount="indefinite"/></circle></svg>',
  jailbreak:'<svg viewBox="0 0 26 26" width="26" height="26"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 4h10a1.6 1.6 0 011.6 1.6v15L13 17.2 6.4 20.6V5.6A1.6 1.6 0 018 4z"/><path d="M10 9h6M10 12.5h4"/></g></svg>'
};
let bubbleEl=null;
function paintBubble(st){
  if(!el)return;
  const want=(st==='thinking'||st==='writing'||st==='jailbreak')?BUBBLE[st]:null;
  if(!want){if(bubbleEl){bubbleEl.remove();bubbleEl=null}return}
  if(!bubbleEl){
    bubbleEl=h('div',{class:'mascot-bubble'});
    el.append(bubbleEl);
  }
  if(bubbleEl._kind!==st){bubbleEl._kind=st;bubbleEl.innerHTML=want}
  bubbleEl.classList.toggle('jail',st==='jailbreak');
}

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
  const sp=S.opts.mascot&&(CUSTOM[S.opts.mascot]||SK_ART[S.opts.mascot]||ART.pets[S.opts.mascot])?S.opts.mascot:'deepseek';
  sprite.innerHTML=html(sp,frame%3,S.opts.mascotSize||44);
  el.dataset.state=state;el.dataset.species=sp;
  if(emoteEl)emoteEl.innerHTML=emoteSvg(state);
}
function startFrames(){
  if(frameTimer)clearInterval(frameTimer);
  const speed=state==='writing'?190:state==='thinking'?360:state==='waiting'?280:state==='jailbreak'?420:1100;
  frameTimer=setInterval(()=>{frame++;renderSprite()},speed);
}
function setState(s){
  if(state===s)return;
  state=s;
  if(el){el.dataset.state=s;if(emoteEl)emoteEl.innerHTML=emoteSvg(s);startFrames();paintBubble(s)}
}
// Per-session mascot state: the animation belongs to the SESSION, not to the app.
// Switching chats restores that chat's own state instead of leaking the previous one.
function deriveFor(sid){
  const st=S.status[sid];
  if(S.perms.some(p=>p.sessionID===sid)||S.questions.some(q=>q.sessionID===sid))return 'waiting';
  if(st&&st.type!=='idle'){
    const streaming=O.msgs(sid).list.slice(-2).some(m=>(m.parts||[]).some(p=>p.type==='text'&&p.text&&p.text.length&&!(p.time&&p.time.end)));
    return streaming?'writing':'thinking';
  }
  const jb=O.sessionJbIds?O.sessionJbIds(sid):null;
  if(jb&&jb.size)return 'jailbreak';
  return 'idle';
}
function tick(sid){
  if(sid&&sid!==S.sid)return;               // event for another chat: never touch this animation
  if(!S.sid)return;
  const st=deriveFor(S.sid);
  O.setMascotStateFor(S.sid,st);
  setState(st);
}
O.mascotTick=tick;

// ---------------------------------------------------------------------------
// PHYSICS: the mascot is a little body, not a sticker.
//  • gravity pulls it down onto the composer ledge; a throw arcs and lands back
//  • while the agent generates it paces left/right along the top of the input
//  • dragging lifts it (no gravity), releasing drops it with the throw's velocity
// ---------------------------------------------------------------------------
const PHYS={x:0,y:0,vx:0,vy:0,ground:0,held:false,raf:0,dir:1,walking:false,target:null,nextThink:0};
// Gentler gravity: a soft arc that settles quickly instead of slamming into the ledge.
const GRAV=1250, BOUNCE=0.18, FRICTION=0.9, MAXV=1500, WALK=52;

function physBounds(){
  const pane=el&&el.parentNode;
  if(!pane)return{x0:4,x1:300,ground:300};
  const size=el.offsetWidth||44;
  const w=pane.clientWidth||300,h=pane.clientHeight||400;
  const kb=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--kb'))||0;
  const composerEl=document.getElementById('composer');
  const ch=composerEl?composerEl.offsetHeight:84;
  const gap=8;
  const ground=Math.max(4,Math.min(h-size-4, h-ch-kb-gap-size));
  return{x0:4,x1:Math.max(4,w-size-4),ground};
}

function setPos(){
  if(!el)return;
  el.style.left=PHYS.x+'px';
  el.style.top=PHYS.y+'px';
  el.dataset.placed='1';
}
// The pixel art is drawn facing LEFT (head/eye on the left, tail on the right), so walking
// to the RIGHT requires a mirror. Getting this backwards is exactly what made the pet walk
// tail-first.
const BASE_FACING=-1;   // -1 = artwork faces left
function face(dir){
  if(!el||!dir)return;
  PHYS.dir=dir;
  // Turning = mirroring the WHOLE body (never the animated sprite, whose transform would
  // override the mirror and make the pet walk backwards).
  const needFlip=(dir!==BASE_FACING);
  el.classList.toggle('flip',needFlip);
  const b=el.querySelector('.mascot-bubble');
  if(b)b.style.transform='translateX(-50%) scaleX('+(dir<0?-1:1)+')';
}

const FIXED=1/60;
function step(){
  PHYS.raf=0;
  if(!el||!el.isConnected)return;
  const b=physBounds();
  const landing=b.ground;
  if(!PHYS.held){
    PHYS.vy+=GRAV*FIXED;
    if(PHYS.vy>MAXV)PHYS.vy=MAXV;
    PHYS.y+=PHYS.vy*FIXED;
    PHYS.x+=PHYS.vx*FIXED;
    PHYS.vx*=FRICTION;
    if(Math.abs(PHYS.vx)<2)PHYS.vx=0;
    if(PHYS.y>=landing){
      PHYS.y=landing;
      if(PHYS.vy>150){PHYS.vy=-PHYS.vy*BOUNCE;el.classList.remove('landed');void el.offsetWidth;el.classList.add('landed')}
      else{PHYS.vy=0}
    }
  }
  if(PHYS.x<b.x0){PHYS.x=b.x0;PHYS.vx=0;PHYS.dir=-1/1*0+1;face(1)}
  if(PHYS.x>b.x1){PHYS.x=b.x1;PHYS.vx=0;face(-1)}
  if(PHYS.y<4){PHYS.y=4;PHYS.vy=Math.abs(PHYS.vy)*0.3}

  // ---- walking AI: pick a target on the ledge, face it, stroll there, then think ----
  if(PHYS.walking&&!PHYS.held&&PHYS.vy===0){
    if(PHYS.target==null||Date.now()>PHYS.nextThink){chooseTarget(b,PHYS.busy)}
    const d=(PHYS.target==null?0:PHYS.target-PHYS.x);
    if(PHYS.target==null||Math.abs(d)<2.5){
      PHYS.vx=0;
      if(PHYS.target!=null&&Math.abs(d)<2.5){
        PHYS.x=PHYS.target;PHYS.target=null;
        const rest=2600+Math.random()*4200;
        PHYS.pauseUntil=Date.now()+rest;                      // stand and look around
        PHYS.nextThink=Date.now()+rest;
        if(Math.random()<0.35)stopWalking();                  // sometimes it just sits down
      }
    }else{face(d>0?1:-1);PHYS.vx=PHYS.dir*WALK}
  }
  setPos();
  if(PHYS.held||PHYS.vy!==0||PHYS.vx!==0||PHYS.walking)schedulePhys();
}
function startWalking(){
  if(PHYS.walking)return;
  PHYS.walking=true;
  PHYS.target=null;
  PHYS.nextThink=0;
  schedulePhys();
}
function stopWalking(){
  PHYS.walking=false;
  PHYS.target=null;
  PHYS.vx=0;
}
function chooseTarget(b,busy){
  const room=b.x1-b.x0;
  if(!room||room<8){PHYS.target=null;return}
  // never aim at the very edge (that is what made it stare into the wall)
  const margin=Math.min(24,Math.max(8,room*0.12));
  const lo=b.x0+margin, hi=b.x1-margin;
  const maxStep=busy?room*0.22:room*0.75;    // while generating it only shifts a little
  let t=lo+Math.random()*(hi-lo);
  if(Math.abs(t-PHYS.x)>maxStep)t=PHYS.x+Math.sign(t-PHYS.x)*maxStep;
  if(Math.abs(t-PHYS.x)<room*0.18)t=PHYS.x+((t>PHYS.x?1:-1))*room*0.22;
  PHYS.target=Math.min(hi,Math.max(lo,t));
  face(PHYS.target>PHYS.x?1:-1);
  PHYS.nextThink=Date.now()+9000;   // safety net if it cannot reach the target
}
function schedulePhys(){
  if(PHYS.raf)return;
  PHYS.raf=requestAnimationFrame(step);
}

// Walking is a WILL. The mascot has moods and an agenda:
//   idle      → strolls often (it is bored)
//   generating→ mostly stays put and works (coding bubble), only short repositioning
//   waiting   → stands still and watches you
//   jailbreak → restless, paces quickly
function personality(sid){
  if(!sid)return 0.5;
  let h=0;for(let i=0;i<sid.length;i++)h=(h*31+sid.charCodeAt(i))|0;
  return Math.abs(h%100)/100;
}
let aiTimer=null,lastEventAt=0,eventKinds={};
function startAI(){
  stopAI();
  const p=personality(S.sid);           // per-session temperament
  let lastPlan=0;
  const tickAI=()=>{
    if(!el||!el.isConnected)return;
    if(S.opts.mascotRoam===false){stopWalking();return}
    if(PHYS.held||drag)return;
    const sid=S.sid||'local';
    const st=S.status[sid];
    const busy=!!st&&st.type!=='idle';
    const mood=O.mascotStateFor(sid);
    PHYS.busy=busy;
    // Busy → the pet stays put and works (coding bubble). Free time → it wanders.
    if(busy){
      if(PHYS.walking)stopWalking();
      return;
    }
    if(mood==='waiting'){if(PHYS.walking)stopWalking();return}
    // Idle: stroll most of the time, with a short pause between trips.
    const pause=pausedUntil();
    const now=Date.now();
    if(now<pause)return;
    if(!PHYS.walking&&now-lastPlan>900){
      lastPlan=now;
      // curiosity after a new message; personality adds eagerness
      const eager=0.55+p*0.35+(Date.now()-lastEventAt<8000?0.25:0);
      if(Math.random()<eager)startWalking();
    }
  };
  tickAI();
  aiTimer=setInterval(tickAI,700);
  // small introspection hook (used by tests and the "what is it doing" tooltip)
  O.mascotAI=()=>({mood:O.mascotStateFor(S.sid||'local'),
    busy:!!(S.status[S.sid||'local']&&S.status[S.sid||'local'].type!=='idle'),
    personality:p,walking:PHYS.walking,target:PHYS.target,x:Math.round(PHYS.x)});
}
function pausedUntil(){return PHYS.pauseUntil||0}
function stopAI(){if(aiTimer){clearInterval(aiTimer);aiTimer=null}}
// Event curiosity: the mascot notices new answers/errors and reacts with a look or a hop.
function noticeMascot(kind){
  lastEventAt=Date.now();
  eventKinds[kind]=(eventKinds[kind]||0)+1;
  if(!el||PHYS.held)return;
  if(kind==='error'&&O.chatAnim&&O.chatAnim()){
    el.classList.remove('landed');void el.offsetWidth;el.classList.add('landed');
  }
}

O.mascotInit=parent=>{
  el=h('div',{class:'mascot',title:O.tr('Drag me · tap for options','Перетащи · тап — настройки')});
  sprite=h('div',{class:'mascot-sprite'});
  emoteEl=h('div',{class:'mascot-emote'});
  el.append(sprite,emoteEl);
  el.style.display=S.opts.mascotOn?'':'none';
  el.style.setProperty('--ms',(S.opts.mascotSize||44)+'px');
  parent.append(el);
  renderSprite();startFrames();
  // start the body on its ledge and let gravity settle it
  const initPos=()=>{
    const b=physBounds();
    const saved=O.store.get('mascotPos',null);
    PHYS.x=saved&&saved.x!=null?Math.min(Math.max(b.x0,saved.x),b.x1):b.x0+8;
    PHYS.y=b.ground;PHYS.vx=0;PHYS.vy=0;
    setPos();
  };
  initPos();
  const reanchor=()=>{
    if(!el||!el.isConnected)return;
    const b=physBounds();
    if(PHYS.y>b.ground||PHYS.held===false){PHYS.y=Math.max(b.ground,Math.min(PHYS.y,b.ground))}
    PHYS.y=b.ground;
    if(PHYS.x<b.x0)PHYS.x=b.x0;
    if(PHYS.x>b.x1)PHYS.x=b.x1;
    setPos();
  };
  O.mascotReanchor=reanchor;
  window.addEventListener('resize',reanchor,{passive:true});
  // composer size changes (typing, permission cards, keyboard) → keep the ledge tight
  try{
    const comp=document.getElementById('composer');
    if(comp&&window.ResizeObserver){
      let t=null;
      new ResizeObserver(()=>{clearTimeout(t);t=setTimeout(reanchor,60)}).observe(comp);
    }
  }catch(_){}
  setTimeout(()=>{const b=physBounds();PHYS.y=document.getElementById('composer')?b.ground:PHYS.y;setPos()},300);
  const host=()=>parent.getBoundingClientRect();
  const onDown=e=>{
    if(e.button!=null&&e.button!==0)return;
    const t=e.touches?e.touches[0]:e;
    const r=el.getBoundingClientRect();
    drag={ox:t.clientX-r.left,oy:t.clientY-r.top,moved:false,sx:t.clientX,sy:t.clientY,lx:t.clientX,ly:t.clientY,lt:Date.now(),vx:0,vy:0};
    PHYS.held=true;stopAI();stopWalking();PHYS.vx=0;PHYS.vy=0;
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
    // track velocity so a flick throws the mascot instead of dropping it straight down
    const dt=Math.max(1,Date.now()-drag.lt);
    drag.vx=(t.clientX-drag.lx)/dt*1000;
    drag.vy=(t.clientY-drag.ly)/dt*1000;
    drag.lx=t.clientX;drag.ly=t.clientY;drag.lt=Date.now();
    PHYS.x=nx;PHYS.y=ny;setPos();
    if(e.cancelable)e.preventDefault();
  };
  const onUp=()=>{
    if(!drag)return;
    const moved=drag.moved;
    const vx=Math.max(-MAXV,Math.min(MAXV,drag.vx||0));
    const vy=Math.max(-MAXV,Math.min(MAXV,drag.vy||0));
    drag=null;
    if(moved){
      // hand it back to gravity with the release velocity
      PHYS.held=false;PHYS.vx=vx;PHYS.vy=vy;
      schedulePhys();
      if(S.sid)setTimeout(startAI,1400);
      setTimeout(()=>{if(!PHYS.held&&PHYS.vy===0)O.store.set('mascotPos',{x:PHYS.x,y:PHYS.y})},900);
      if(O.native.haptic)O.native.haptic('tick');
      if(S.sid)startAI();
    }else mascotMenu();
  };
  el.addEventListener('pointerdown',onDown);
  el.addEventListener('pointermove',onMove,{passive:false});
  el.addEventListener('pointerup',onUp);
  el.addEventListener('pointercancel',()=>{drag=null});
  el.addEventListener('touchstart',onDown,{passive:true});
  el.addEventListener('touchmove',onMove,{passive:false});
  el.addEventListener('touchend',onUp);
  bus.on('status',sid=>tick(sid));
  bus.on('perm',()=>tick());
  bus.on('part',sid=>tick(sid));
  bus.on('msg',sid=>tick(sid));
  bus.on('jailbreak',()=>tick());
  bus.on('sessionJailbreak',sid=>tick(sid));
  // switching session: restore THAT session's own mascot state
  bus.on('open',()=>{if(el){setState(O.mascotStateFor(S.sid));paintBubble(O.mascotStateFor(S.sid))}});
  // walk back and forth over the input while the agent is generating
  bus.on('mascotState',(sid,st)=>{if(!el||sid!==S.sid)return;startAI()});
  bus.on('status',()=>{if(el)startAI()});
  bus.on('open',()=>{tick();const p=O.store.get('mascotPos',null);if(p){el.style.left=p.x+'px';el.style.top=p.y+'px'}});
  O.mascotBubble=st=>paintBubble(st);
  O.mascotSetRoam=on=>{S.opts.mascotRoam=!!on;O.saveOpts();if(on)startAI();else{stopAI();stopWalking()}};
  O.mascotRefresh=()=>{
    el.style.display=S.opts.mascotOn?'':'none';
    el.style.setProperty('--ms',(S.opts.mascotSize||44)+'px');
    renderSprite();startFrames();tick();
    setTimeout(()=>{const b=physBounds();PHYS.y=b.ground;PHYS.x=Math.min(PHYS.x,b.x1);setPos()},40);
  };
  tick();
  paintBubble(state);
  startAI();
};
function mascotMenu(){
  O.actions(O.mascotName(S.opts.mascot||'deepseek'),[
    {label:O.tr('Change mascot','Сменить маскота'),icon:'palette',fn:()=>O.openMascotSettings()},
    {label:O.tr('Size','Размер'),sub:(S.opts.mascotSize||44)+'px',icon:'sliders',fn:()=>O.openMascotSettings()},
    {label:S.opts.mascotOn?O.tr('Hide mascot','Скрыть маскота'):O.tr('Show mascot','Показать маскота'),icon:'eye',fn:()=>{S.opts.mascotOn=!S.opts.mascotOn;O.saveOpts();O.mascotRefresh&&O.mascotRefresh()}},
    {label:S.opts.mascotRoam===false?O.tr('Let it walk around','Пусть гуляет'):O.tr('Keep it still','Пусть сидит на месте'),icon:'drag',fn:()=>O.mascotSetRoam&&O.mascotSetRoam(S.opts.mascotRoam===false)},
    {label:O.tr('Reset position','Сбросить позицию'),icon:'undo',fn:()=>{O.store.remove('mascotPos');if(el){const b=physBounds();PHYS.x=b.x0+8;PHYS.y=b.ground;setPos()}}}
  ]);
}
O.openMascotSettings=()=>{
  const body=h('div');
  const gridFor=keys=>{
    const grid=h('div',{class:'mascot-grid'});
    keys.forEach(k=>{
      const prev=h('div',{class:'mascot-prev'+(S.opts.mascot===k?' on':''),title:O.mascotName(k),
        html:svgFor(k,0,44)+'<span>'+O.esc(O.mascotName(k))+'</span>'});
      prev.onclick=()=>{S.opts.mascot=k;O.saveOpts();O.mascotRefresh&&O.mascotRefresh();draw()};
      grid.append(prev);
    });
    return grid;
  };
  const draw=()=>{
    body.textContent='';
    body.append(
      O.toggleRow('bot',O.tr('Show mascot','Показывать маскота'),O.tr('A pixel companion above the composer','Пиксельный компаньон над полем ввода'),
        S.opts.mascotOn!==false,v=>{S.opts.mascotOn=v;O.saveOpts();O.mascotRefresh&&O.mascotRefresh()}),
      O.toggleRow('drag',O.tr('Walks around','Гуляет'),O.tr('The mascot decides when to stroll along the input (more often while generating)','Маскот сам решает, когда пройтись по полю ввода (чаще во время генерации)'),
        S.opts.mascotRoam!==false,v=>O.mascotSetRoam&&O.mascotSetRoam(v)),
      h('div',{class:'grp'},O.tr('Size','Размер')),
      h('div',{class:'seg'},[28,36,44,56,72,96].map(n=>h('button',{class:S.opts.mascotSize===n?'on':'',
        onclick:()=>{S.opts.mascotSize=n;O.saveOpts();O.mascotRefresh&&O.mascotRefresh();draw()}},n+'px'))),
      h('div',{class:'grp'},O.tr('Assistants','Ассистенты')),
      h('div',{class:'grp'},O.tr('AI mascots','Маскоты ИИ')+' ('+PIXEL_PETS.length+')'),
      gridFor(PIXEL_PETS),
      h('div',{class:'grp'},O.tr('Soul Knight pets — in-game sprites','Питомцы Soul Knight — игровые спрайты')+' ('+REAL_PETS.length+')'),
      gridFor(REAL_PETS)
    );
  };
  draw();
  O.sheet(O.tr('Mascot','Маскот'),body,{full:true});
};
})();