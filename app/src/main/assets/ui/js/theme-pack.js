(function(){
// ==========================================================================
// THEME PACK — 100 extra palettes.
// Same compact shape as the built-ins in themes.js: a handful of colours and
// the rest is derived by O.themeVars(), so contrast and surfaces stay coherent.
// Every entry carries `light` so the terminal layer can set color-scheme.
// ==========================================================================
const O=window.OCM;
const T=(id,name,tag,light,bg,fg,acc,accFg,acc2,mut,code,extra)=>Object.assign({id,name,tag,light,bg,fg,acc,accFg,acc2,mut,code},extra||{});

const PACK=[
  // ---------------------------------------------------------------- darks (40)
  T('pk_obsidian','Obsidian','dark',false,'#0b0b0e','#e6e6ea','#8b9cff','#0b0b0e','#5eead4','#8a8a94','#07070a'),
  T('pk_midnight','Midnight Blue','dark',false,'#0d1524','#dbe4f0','#5aa9ff','#0d1524','#8b5cf6','#7d8ba1','#080f1c'),
  T('pk_graphite2','Graphite','dark',false,'#1b1b1d','#e8e8e8','#c9c9c9','#1b1b1d','#9a9a9a','#8f8f8f','#121214'),
  T('pk_inkwell','Inkwell','dark',false,'#101018','#e4e4ee','#a78bfa','#101018','#60a5fa','#83839a','#0a0a12'),
  T('pk_coal','Coal','dark',false,'#141413','#e6e4df','#d4a35b','#141413','#9fb8a0','#8b8a84','#0d0d0c'),
  T('pk_slate','Slate','dark',false,'#1e242b','#e2e8f0','#7dd3fc','#1e242b','#94a3b8','#8896a6','#161b21'),
  T('pk_void','Void','dark',false,'#000000','#d8d8ff','#7c3aed','#000000','#22d3ee','#77779c','#000000'),
  T('pk_emberdark','Ember','dark',false,'#1a1110','#f3e3dc','#ff7043','#1a1110','#ffb74d','#a4877e','#120c0b'),
  T('pk_deepsea','Deep Sea','dark',false,'#071a24','#d3eaf5','#22d3ee','#071a24','#34d399','#7593a3','#04121a'),
  T('pk_moss','Moss','dark',false,'#11170f','#e2ead3','#84cc16','#11170f','#a3e635','#84937a','#0b100a'),
  T('pk_plum','Plum','dark',false,'#1a0f1c','#eddcf0','#d946ef','#1a0f1c','#f472b6','#9a839f','#120a14'),
  T('pk_rust','Rust','dark',false,'#1c1210','#f0ddd4','#e05d3a','#1c1210','#f59e0b','#9c8478','#140d0b'),
  T('pk_steel','Steel','dark',false,'#1a1d22','#dde2e8','#93b4d0','#1a1d22','#6b8299','#87909c','#12151a'),
  T('pk_abyss','Abyss','dark',false,'#05070d','#cfd8e6','#4f8cff','#05070d','#38bdf8','#6f7d92','#03050a'),
  T('pk_nightshade','Nightshade','dark',false,'#130f1e','#e6dff2','#a855f7','#130f1e','#ec4899','#8b82a3','#0c0915'),
  T('pk_amber','Amber','dark',false,'#18130a','#f2e6cd','#f59e0b','#18130a','#fbbf24','#9c8f76','#110d07'),
  T('pk_tundra','Tundra','dark',false,'#141b1f','#dbe6ea','#7fc8d4','#141b1f','#94a9b3','#8198a2','#0d1317'),
  T('pk_cinder','Cinder','dark',false,'#1a1517','#efe3e6','#f0707d','#1a1517','#fda4af','#9d8b90','#120e10'),
  T('pk_cypress','Cypress','dark',false,'#0f1917','#d6e8e2','#34d399','#0f1917','#5eead4','#7a958d','#0a120f'),
  T('pk_onyx','Onyx','dark',false,'#121214','#e9e9ec','#a1a1aa','#121214','#71717a','#8b8b93','#0b0b0d'),
  T('pk_coffee','Coffee','dark',false,'#1b1410','#efe2d4','#c98b5e','#1b1410','#a97c50','#9b8776','#130e0b'),
  T('pk_lava','Lava','dark',false,'#160b0b','#f5dede','#ef4444','#160b0b','#f97316','#a18080','#0f0808'),
  T('pk_grape','Grape','dark',false,'#150f26','#e4ddf5','#8b5cf6','#150f26','#c084fc','#8a80a5','#0e0a1a'),
  T('pk_pine','Pine','dark',false,'#0d1712','#d8e6dd','#22c55e','#0d1712','#4ade80','#7b9588','#080f0c'),
  T('pk_fog','Fog','dark',false,'#1c1f23','#e3e6ea','#a8b3bf','#1c1f23','#7d8895','#8c949e','#14171a'),
  T('pk_charcoal','Charcoal','dark',false,'#1d1d1f','#e7e7e9','#e0a458','#1d1d1f','#9aa9b5','#8f8f93','#151517'),
  T('pk_marine','Marine','dark',false,'#0a1626','#d6e2f2','#3b82f6','#0a1626','#06b6d4','#7387a0','#071020'),
  T('pk_dusk','Dusk','dark',false,'#1a1424','#e8dff2','#b07cf6','#1a1424','#f08ab4','#8e83a2','#120d1a'),
  T('pk_ash','Ash','dark',false,'#191a1c','#dfe0e3','#b9bec6','#191a1c','#7f8590','#8b8d92','#111214'),
  T('pk_teal','Deep Teal','dark',false,'#0a1b1b','#d2eceb','#14b8a6','#0a1b1b','#5eead4','#75918f','#061313'),
  T('pk_burgundy','Burgundy','dark',false,'#1a0c11','#f0dce2','#be123c','#1a0c11','#fb7185','#9c7f88','#12080c'),
  T('pk_indigo','Indigo Night','dark',false,'#0f1030','#dcdcf5','#6366f1','#0f1030','#818cf8','#7d7ea5','#090a22'),
  T('pk_sand','Night Sand','dark',false,'#1c1811','#eadfc9','#d6a35c','#1c1811','#b08a52','#9a8e79','#14100b'),
  T('pk_reef','Reef','dark',false,'#071820','#cfe9f2','#06b6d4','#071820','#a3e635','#7393a0','#041218'),
  T('pk_orchid','Orchid','dark',false,'#1c0f18','#f0dcea','#e879f9','#1c0f18','#a78bfa','#9c8093','#140a11'),
  T('pk_smoke','Smoke','dark',false,'#17191c','#dde0e4','#9ba3ad','#17191c','#6b7280','#878d96','#101215'),
  T('pk_signal','Signal','dark',false,'#0e1310','#d9e8dc','#00c853','#0e1310','#69f0ae','#78947f','#090f0b'),
  T('pk_rusty','Rusty Iron','dark',false,'#1b1614','#eee1d9','#b45309','#1b1614','#92400e','#99887c','#130f0d'),
  T('pk_cosmos','Cosmos','dark',false,'#0a0a1a','#dcdcf0','#818cf8','#0a0a1a','#f472b6','#7878a0','#06060f'),
  T('pk_mintnight','Mint Night','dark',false,'#0c1715','#d5ebe6','#2dd4bf','#0c1715','#a7f3d0','#7c948f','#07100e'),

  // --------------------------------------------------------------- lights (40)
  T('pk_bone','Bone','light',true,'#f7f5f0','#1f1e1c','#8a6d3b','#ffffff','#6b7f5e','#6d6a63','#efeee8'),
  T('pk_parchment','Parchment','light',true,'#f6f1e4','#2b261d','#a16207','#ffffff','#4d7c0f','#756c5c','#efeadb'),
  T('pk_cloud','Cloud','light',true,'#f6f8fa','#12161a','#2563eb','#ffffff','#7c3aed','#65707c','#eef1f5'),
  T('pk_sakura','Sakura','light',true,'#fdf2f6','#241a20','#db2777','#ffffff','#a855f7','#7a626d','#f8e8ef'),
  T('pk_mintlight','Mint Paper','light',true,'#f2faf6','#12211b','#059669','#ffffff','#0d9488','#5f756c','#e8f4ee'),
  T('pk_butter','Butter','light',true,'#fdf8e6','#2a2412','#b45309','#ffffff','#ca8a04','#786f56','#f7f1da'),
  T('pk_linen','Linen','light',true,'#faf7f2','#211e1a','#9f5f2e','#ffffff','#7c8a5a','#736d64','#f3efe7'),
  T('pk_porcelain','Porcelain','light',true,'#fbfcfd','#101317','#0f766e','#ffffff','#1d4ed8','#6a7480','#f3f5f7'),
  T('pk_greypaper','Grey Paper','light',true,'#f4f4f5','#18181b','#52525b','#ffffff','#7c3aed','#6b6b73','#ececee'),
  T('pk_peach','Peach','light',true,'#fff5f0','#2a1a14','#ea580c','#ffffff','#db2777','#7d6a61','#fcece4'),
  T('pk_sky','Sky Paper','light',true,'#f0f7ff','#101a26','#0284c7','#ffffff','#0ea5e9','#617083','#e8f2fe'),
  T('pk_sage','Sage','light',true,'#f4f8f2','#18201a','#4d7c0f','#ffffff','#0f766e','#66705f','#ecf3e9'),
  T('pk_rosepaper','Rose Paper','light',true,'#fdf5f5','#271618','#be123c','#ffffff','#9f1239','#7d6468','#f9ecec'),
  T('pk_ivory','Ivory','light',true,'#fbf9f3','#1f1d18','#8b6c2a','#ffffff','#5f7a4a','#6f6a5d','#f5f2e9'),
  T('pk_frostlight','Frost','light',true,'#f2f6f9','#12202b','#0e7490','#ffffff','#1e40af','#62727f','#e9f0f5'),
  T('pk_apricot','Apricot','light',true,'#fff7ec','#2b2013','#c2410c','#ffffff','#a16207','#7d7059','#fcf1e2'),
  T('pk_lilac','Lilac Paper','light',true,'#f7f4fd','#1d1729','#7c3aed','#ffffff','#c026d3','#6f6580','#f0ebfa'),
  T('pk_canvas','Canvas','light',true,'#f8f6f3','#1c1a17','#78716c','#ffffff','#0f766e','#6e6862','#f1eee9'),
  T('pk_alabaster','Alabaster','light',true,'#fdfdfc','#111112','#3f3f46','#ffffff','#2563eb','#6c6c72','#f5f5f4'),
  T('pk_honey','Honey','light',true,'#fdf6e3','#2a2410','#a16207','#ffffff','#b45309','#7a6f52','#f8f0d8'),
  T('pk_cotton','Cotton','light',true,'#f9f9fb','#16161a','#6366f1','#ffffff','#ec4899','#6c6c76','#f2f2f6'),
  T('pk_mist','Mist','light',true,'#f4f7f9','#141b20','#0891b2','#ffffff','#4f46e5','#64727c','#ecf1f4'),
  T('pk_clay','Clay','light',true,'#faf5f2','#241a16','#9a3412','#ffffff','#78716c','#756a64','#f4ede8'),
  T('pk_celadon','Celadon','light',true,'#f3f8f5','#16211c','#3f7a5c','#ffffff','#2f855a','#64716a','#ebf3ef'),
  T('pk_powder','Powder Blue','light',true,'#f4f9fd','#122029','#0369a1','#ffffff','#3b82f6','#617485','#eaf3fa'),
  T('pk_wheat','Wheat','light',true,'#fcf8ef','#262015','#a16207','#ffffff','#4d7c0f','#766c58','#f6f1e3'),
  T('pk_marshmallow','Marshmallow','light',true,'#fdf9fb','#241a20','#db2777','#ffffff','#8b5cf6','#7a6873','#f8f1f5'),
  T('pk_teapaper','Tea Paper','light',true,'#f9f7f1','#1f1c15','#8a6d3b','#ffffff','#5b7a52','#6f6a5c','#f3f0e7'),
  T('pk_glacier','Glacier','light',true,'#f5fafc','#101d24','#0e7490','#ffffff','#2563eb','#607280','#ecf5f8'),
  T('pk_sunwash','Sun Wash','light',true,'#fffbf0','#2a2412','#d97706','#ffffff','#65a30d','#7d7256','#fdf6e4'),
  T('pk_graphpaper','Graph Paper','light',true,'#f7f8f9','#14171a','#0f766e','#ffffff','#4338ca','#66707a','#eff1f3'),
  T('pk_blush','Blush','light',true,'#fef6f7','#26171a','#e11d48','#ffffff','#f97316','#7c666a','#fbecee'),
  T('pk_snowlight','Snow','light',true,'#fbfcfd','#151a20','#3b82f6','#ffffff','#06b6d4','#68737e','#f2f5f8'),
  T('pk_olive','Olive Paper','light',true,'#f8f8f0','#1d2014','#4d7c0f','#ffffff','#a16207','#6d7059','#f2f2e7'),
  T('pk_terracotta','Terracotta','light',true,'#fdf4f0','#291a14','#c2410c','#ffffff','#9a3412','#7d6a62','#faece5'),
  T('pk_aqua','Aqua Paper','light',true,'#f1fbfa','#102220','#0d9488','#ffffff','#0891b2','#5f7572','#e7f6f5'),
  T('pk_pearl','Pearl','light',true,'#fafafa','#141414','#6b7280','#ffffff','#0f766e','#6f6f73','#f1f1f1'),
  T('pk_nectar','Nectar','light',true,'#fffaf0','#2a2110','#ca8a04','#ffffff','#ea580c','#7d7156','#fdf4e1'),
  T('pk_iceberg','Iceberg','light',true,'#f3f8fb','#101c24','#0284c7','#ffffff','#14b8a6','#607382','#e9f2f8'),
  T('pk_oat','Oat','light',true,'#faf7f1','#1f1d17','#8a6d3b','#ffffff','#5b6f4a','#6f6a5c','#f3efe6'),

  // ------------------------------------------------------------ terminals (20)
  T('pk_crt','CRT Amber','terminal',false,'#100c00','#ffb000','#ffb000','#100c00','#ffd166','#8a6a00','#0a0800'),
  T('pk_dos','DOS Blue','terminal',false,'#0000aa','#f0f0f0','#ffff55','#0000aa','#55ffff','#a8b8d8','#000080'),
  T('pk_ibm','IBM 3270','terminal',false,'#0c1410','#8cf0a0','#8cf0a0','#0c1410','#b8ffc8','#4a8a5a','#07100b'),
  T('pk_solar','Solar Flare','terminal',false,'#12100a','#ffe9a8','#ffb703','#12100a','#fb8500','#8f8054','#0b0906'),
  T('pk_neon','Neon Grid','terminal',false,'#0a0416','#e0d4ff','#ff2fb9','#0a0416','#00e5ff','#7c6aa0','#05010d'),
  T('pk_bios','BIOS Green','terminal',false,'#000000','#00c853','#00e676','#000000','#69f0ae','#2e6b3f','#000000'),
  T('pk_amberterm','Amber Terminal','terminal',false,'#0d0a00','#ffc857','#ff9800','#0d0a00','#ffe082','#8a6b22','#080700'),
  T('pk_cyan','Cyan Terminal','terminal',false,'#001014','#8ff0ff','#00e5ff','#001014','#a5f3fc','#3f7d88','#000a0d'),
  T('pk_magentaterm','Magenta Terminal','terminal',false,'#13000f','#ffb8f0','#ff2fd0','#13000f','#ffb8f0','#8a3a78','#0c000a'),
  T('pk_gruvboxt','Gruvbox Terminal','terminal',false,'#1d2021','#ebdbb2','#fabd2f','#1d2021','#83a598','#928374','#141617'),
  T('pk_kanagawat','Kanagawa Term','terminal',false,'#16161d','#dcd7ba','#7e9cd8','#16161d','#957fb8','#6a6a78','#0f0f14'),
  T('pk_everforestt','Everforest Term','terminal',false,'#1e2326','#d3c6aa','#a7c080','#1e2326','#7fbbb3','#7f8b87','#171b1d'),
  T('pk_tokyonightt','Tokyo Night Term','terminal',false,'#16161e','#c0caf5','#7aa2f7','#16161e','#bb9af7','#6f7aa0','#101015'),
  T('pk_catppuccint','Catppuccin Term','terminal',false,'#181825','#cdd6f4','#cba6f7','#181825','#89b4fa','#828aa6','#11111b'),
  T('pk_rosepinet','Rosé Pine Term','terminal',false,'#191724','#e0def4','#ebbcba','#191724','#9ccfd8','#7d7a95','#13111c'),
  T('pk_onedarkt','One Dark Term','terminal',false,'#21252b','#abb2bf','#61afef','#21252b','#c678dd','#6f757f','#171a1e'),
  T('pk_monokait','Monokai Term','terminal',false,'#1e1f1c','#f8f8f2','#a6e22e','#1e1f1c','#66d9ef','#7d7e70','#161713'),
  T('pk_solarizedt','Solarized Term','terminal',false,'#00212b','#93a1a1','#2aa198','#00212b','#268bd2','#5b7078','#001a21'),
  T('pk_retro','Retro 80s','terminal',false,'#1a0b2e','#e6d7ff','#ff6ac1','#1a0b2e','#57e0ff','#8b7aa8','#120720'),
  T('pk_ghostty','Ghostty','terminal',false,'#101418','#c8d3f5','#82aaff','#101418','#c099ff','#717a96','#0a0d10')
];

O.THEME_PACK=PACK;
// Themes loaded before this script appended the pack are re-read from the merged list.
const baseList=O.themeList;
O.themeList=()=>baseList().concat(PACK);
O.themePack=PACK;
})();