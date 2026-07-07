/**
 * 灵感抽卡：大词库 + 强风格化（本地随机，无需 API）
 */
(function (global) {
  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function pickFromPool(pool) {
    if (!pool.length) return '';
    const i = Math.floor(Math.random() * pool.length);
    return pool.splice(i, 1)[0];
  }

  function clonePool(arr) {
    return arr.slice();
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** 2～3 段为一组，组序随机，提升同词不同排列的新鲜感 */
  function combineParts(segments, opts = {}) {
    const segs = segments.filter(Boolean).map((s) => String(s).trim()).filter(Boolean);
    if (segs.length <= 1) return segs.join('，');

    if (opts.mode === 'flat') {
      const list = opts.keepFirst && segs.length > 2
        ? [segs[0], ...shuffle(segs.slice(1))]
        : shuffle(segs);
      return list.join('，');
    }

    const groups = [];
    let i = 0;
    while (i < segs.length) {
      const size = i === 0 && opts.keepFirst ? 1 : (Math.random() > 0.55 ? 2 : 3);
      groups.push(segs.slice(i, i + size));
      i += size;
    }
    const ordered = shuffle(groups).map((g) => g.join('，'));
    return ordered.join('；');
  }

  function pickMaybe(arr, chance = 0.45) {
    return Math.random() < chance ? pick(arr) : '';
  }

  const PUNCH = [
    '主体清晰、背景克制，封面级构图',
    '电影级调色，暗部透气、高光不过曝',
    '轮廓光勾勒主体，与背景自然分离',
    '浅景深但焦内纹理锐利',
    '中心构图 + 轻微暗角，视线锁定主体',
    '单一超现实元素点睛，其余极简',
    '主次分明，留白呼吸，拒绝元素堆砌',
    '边缘过渡自然，无廉价 HDR 光晕'
  ];

  const PALETTE = [
    '低饱和莫兰迪底 + 单一琥珀点睛色',
    '青蓝阴影 + 暖金高光，电影 teal-gold',
    '墨绿 + 象牙白 + 古铜，奢侈品广告色',
    '柯达 2383 胶片调色，肤色温润',
    '暗部偏青、高光偏奶白，层次丰富',
    '银灰单色 + 一丝深红点缀',
    '棕褐胶片 + 深巧克力暗部',
    '午夜蓝 + 香槟金，高级商业感',
    '雾紫天空 + 暖灰地面，低饱和统一',
    '炭黑背景 + 单一冷暖对比光源',
    '灰绿苔藓色 + 锈铜，末世高级感',
    '藏青 + 雾粉 + 米白，克制东方色',
    '深紫罗兰 + 冷灰 + 一点金，Editorial 配色'
  ];

  const TEXTURE = [
    '皮肤次表面散射，肤质细腻不假',
    '织物编织纹理可见，金属有微划与指纹',
    '胶片颗粒均匀，非数码噪点',
    '微反差 rich tonal range，拒绝廉价 HDR',
    '体积雾分层，空气透视准确',
    '材质物理正确：玻璃折射、皮革毛孔、丝绸高光',
    '边缘微光晕自然，无过度锐化',
    '环境光反弹柔和，暗部仍有细节',
    '金属氧化层与指纹级微痕，非塑料 CG',
    '织物垂坠与褶皱物理正确，有重量感',
    '皮肤毛孔与绒毛光，修图克制不过磨',
    '玻璃/水面菲涅尔反射准确，高光干净'
  ];

  const QUALITY_NEUTRAL = [
    'high-end illustration finish, controlled color, premium composition',
    '封面级完成度，主次分明，质感统一',
    'key visual quality, polished but not overprocessed'
  ];

  const QUALITY_PHOTO = [
    'photorealistic portrait, natural skin texture, editorial retouch restraint',
    '85mm shallow DOF, analog color science, magazine cover finish',
    'medium format film quality, tactile skin and fabric',
    'cinematic portrait grading, subtle grain, luxe mood'
  ];

  const QUALITY_ANIME = [
    'anime key visual illustration, NOT photograph, clean art finish',
    'Pixiv 日榜级插画完成度，非相机直出，非写实写真',
    'animation promotional art, cel shading or soft gradient, sharp lineart',
    'game SSR splash art quality, illustrated character, not live-action',
    '轻小说封面级精度，线稿闭合，色块干净',
    '动画 OP 第一帧完成度，角色清晰背景服务',
    'Vtuber 封面插画质，非 3D 真人',
    '同人展签售级 poster，印刷清晰',
    'TV 动画总集篇 key visual，赛璐璐或数字上色',
    '漫画单行本封面级，网点或渐变阴影可选',
    '手游卡面 SSR 精度，立绘半身或全身',
    '动画截图级色彩分层，非摄影',
    'Manga color page quality, illustrated only',
    'anime magazine pin-up finish, stylized skin'
  ];

  const QUALITY_CG3D = [
    '3D CG render, PBR materials, Octane-quality lighting, NOT live photo',
    'Unreal cinematic still, subsurface skin, fabric physics',
    'stylized 3D character render, high detail, not real person photography'
  ];

  const QUALITY_PAINTERLY = [
    'painterly illustration, visible brushwork or ink wash, fine art print',
    '油画/水彩插画完成度，非摄影，非真人',
    'traditional media texture on canvas or rice paper'
  ];

  const QUALITY_ILLUST = [
    'graphic illustration, bold shapes, poster-grade finish, not photograph',
    '矢量/扁平/美漫插画完成度，非写实摄影',
    'concept art key art, stylized, not live-action'
  ];

  const TEXTURE_PHOTO = [
    '皮肤次表面散射，毛孔可见但修图克制',
    '织物编织与皮革毛孔，金属微划',
    '胶片颗粒均匀，暗部透气',
    '微反差 rich tonal range，拒绝廉价 HDR'
  ];

  const TEXTURE_ANIME = [
    '赛璐璐阴影边界清晰，高光形明确',
    '线稿闭合，发色/瞳色分层上色',
    '厚涂过渡柔和，仍保持插画感',
    '动画截图级材质简化，色块干净',
    '渐变阴影韩漫风，肤质柔和非写实',
    '细线稿 + 平涂底色 + 柔和阴影两层',
    '水彩边缘晕染但角色轮廓清晰',
    '动画 cel 高光块面明确，非摄影肤质',
    '游戏立绘金属与布料简化纹理',
    '漫画 screentone 质感，印刷友好',
    '数字厚涂笔触感，仍非真人照片',
    '发丝分组上色，高光条形状明确',
    '瞳色双层渐变 + 星形高光点',
    '皮肤仅用两阶阴影，插画化简化',
    '和服纹样平面装饰，不抢主体'
  ];

  const TEXTURE_CG3D = [
    'PBR 金属/布料/皮肤，高光物理正确',
    '次表面散射 + 细微毛孔，CG 而非照片',
    '体积光与 fog 分层，渲染感明确'
  ];

  const TEXTURE_PAINTERLY = [
    '笔触/水痕/纸纹可见，艺术介质感',
    '墨分五色或 impasto 厚涂肌理',
    '颜料堆积与留白，非数码磨皮'
  ];

  const TEXTURE_ILLUST = [
    '大色块平涂或 halftone 网点，图形化',
    '像素边缘清晰或矢量边缘锐利',
    '海报级简化纹理，非写实肤质'
  ];

  const PALETTE_ANIME = [
    '低饱和灰紫底 + 单一高饱和点睛', '墨蓝夜空 + 暖窗光', 'pastel 高明度 + 深紫阴影',
    '黑金 + 深红少量点缀', '炭灰 + 珍珠白，克制配色', '青白冷色 + 暖色肤光',
    '日落橙紫但阴影压暗', '金属冷色 + 丝绸暖反光',
    '樱粉 + 雾灰 + 深棕阴影，春日番剧感', '钴蓝天空 + 奶白云 + 暖肤，新海诚式',
    '暗红 + 玄黑 + 金线，和风水墨点缀', '薄荷绿 + 浅灰 + 一点珊瑚，清新日常番',
    '紫罗兰 + 冷灰 + 荧光青点睛，赛博二次元', '焦糖暖棕 + 米白 + 深绿，吉卜力 earthy',
    '单色蓝灰底 + 仅瞳色饱和，极简 poster', '夕照橙 + 群青阴影，动画黄昏帧',
    '白 + 藏青 + 一点红，校园番经典', '霓虹粉紫 + 深灰街景，都市夜番',
    '雪白带蓝灰阴影，冬番清冷', '琥珀金点缀于低饱和灰绿，奇幻冒险番',
    'lavender + slate + warm skin tone，柔光少女向', '铁锈红 + 烟灰 + 象牙，末世番',
    '水色 + 白 + 浅黄，夏祭典灯笼感', '深紫夜空 + 星芒白 + 暖肤，魔法夜'
  ];

  const PUNCH_ANIME = [
    '单人 poster 构图，背景简化服务角色', '动态 pose + 速度线或粒子点睛',
    '动画 key visual 留白，标题区可扩展', '角色占画面 60%+，视觉焦点明确',
    'SSR 卡面级半身或全身', '轻小说封面构图，情绪优先',
    '漫画跨页大格，主体居中张力', '动画 climax 帧定格，背景 motion blur',
    '视觉 novel 立绘，半身清晰表情', '同人志 cover，角色 solo 无 clutter',
    '游戏 gacha splash，角色几乎占满画幅', '番剧 OP 人物特写，天空或城景简化',
    '对角线构图 + 武器/道具引导视线', '低角度仰拍，角色 dominant',
    '对称构图 + 魔法阵/符文底纹', '三分法，角色偏一侧留故事空间',
    '近景脸部 + 远景 simplified 背景', '多人构图但主角前景最大'
  ];

  const PUNCH_PHOTO = [
    '主体清晰、背景克制，封面级构图',
    '电影级调色，暗部透气、高光不过曝',
    '轮廓光勾勒主体，与背景自然分离',
    '浅景深但焦内纹理锐利',
    '中心构图 + 轻微暗角，视线锁定主体'
  ];

  const STYLE_FAMILIES = {
    neutral: { lock: '', quality: QUALITY_NEUTRAL, texture: TEXTURE, palette: PALETTE, punch: PUNCH },
    photo: {
      lock: '真人摄影或胶片人像',
      quality: QUALITY_PHOTO,
      texture: TEXTURE_PHOTO,
      palette: PALETTE,
      punch: PUNCH_PHOTO
    },
    anime: {
      lock: '必须是二次元插画，禁止真人摄影、禁止写实写真、禁止相机直出',
      quality: QUALITY_ANIME,
      texture: TEXTURE_ANIME,
      palette: PALETTE_ANIME,
      punch: PUNCH_ANIME
    },
    cg3d: {
      lock: '必须是 3D CG 渲染，禁止真人摄影与写实写真',
      quality: QUALITY_CG3D,
      texture: TEXTURE_CG3D,
      palette: PALETTE,
      punch: PUNCH
    },
    painterly: {
      lock: '必须是手绘/油画/水墨插画，禁止真人摄影',
      quality: QUALITY_PAINTERLY,
      texture: TEXTURE_PAINTERLY,
      palette: PALETTE,
      punch: PUNCH
    },
    illustration: {
      lock: '必须是平面/像素/美漫等插画，禁止真人摄影与写实写真',
      quality: QUALITY_ILLUST,
      texture: TEXTURE_ILLUST,
      palette: PALETTE,
      punch: PUNCH
    }
  };

  const STYLE_TO_FAMILY = {
    none: 'neutral',
    auto: null,
    photo: 'photo',
    photo_film: 'photo',
    hyperreal: 'photo',
    anime: 'anime',
    dongman: 'anime',
    anime_90s: 'anime',
    semireal: 'anime',
    manhwa: 'anime',
    lineart: 'anime',
    makoto: 'anime',
    ghibli: 'anime',
    cg_3d: 'cg3d',
    cg_3d_toon: 'cg3d',
    unreal: 'cg3d',
    weta: 'cg3d',
    arcane: 'cg3d',
    oil: 'painterly',
    watercolor: 'painterly',
    ink: 'painterly',
    pixel: 'illustration',
    comic: 'illustration',
    flat: 'illustration',
    cyber_render: 'illustration',
    dark_aesthetic: 'illustration',
    guoman_25d: 'anime',
    moe_chibi: 'anime'
  };

  function resolveStyleId(styleId) {
    const raw = styleId || 'none';
    const id = raw === 'feibi_jubi' || raw === 'chibi_moe' ? 'moe_chibi' : raw;
    if (id === 'auto') return pick(AUTO_STYLE_POOL);
    return ART_STYLES[id] ? id : 'none';
  }

  function getStyleFamily(styleId) {
    return STYLE_TO_FAMILY[styleId] || 'neutral';
  }

  function premiumTail(family) {
    const f = STYLE_FAMILIES[family] || STYLE_FAMILIES.neutral;
    return combineParts([
      pick(f.palette),
      pick(f.texture),
      pick(f.punch),
      pick(f.quality)
    ], { mode: 'flat' });
  }

  function buildCtx(styleId) {
    const resolved = resolveStyleId(styleId);
    const family = getStyleFamily(resolved);
    return { styleId: resolved, family, tail: () => premiumTail(family) };
  }

  function applyArtStyle(prompt, styleId) {
    const resolved = resolveStyleId(styleId);
    const family = getStyleFamily(resolved);
    const style = ART_STYLES[resolved];
    const fam = STYLE_FAMILIES[family] || STYLE_FAMILIES.neutral;
    const parts = [];
    if (style?.tag) parts.push(style.tag);
    if (fam.lock && family !== 'neutral') parts.push(fam.lock);
    parts.push(prompt);
    return parts.join('，');
  }

  function subjectPoolForCharacter(family) {
    if (family === 'anime') return WORDS.characterSubjectAnime;
    if (family === 'cg3d') return WORDS.characterSubject3d;
    if (family === 'photo') return WORDS.characterSubjectPhoto;
    if (family === 'painterly' || family === 'illustration') return WORDS.characterSubjectIllust;
    return WORDS.characterSubject;
  }

  function glamourSubjectPool(family) {
    if (family === 'photo') return WORDS.glamourSubjectPhoto;
    if (family === 'anime') return WORDS.glamourSubjectAnime;
    if (family === 'cg3d') return WORDS.glamourSubject3d;
    if (family === 'painterly' || family === 'illustration') return WORDS.glamourSubjectAnime;
    return WORDS.glamourSubject;
  }

  function glamourMaleSubjectPool(family) {
    if (family === 'photo') return WORDS.glamourSubjectMalePhoto;
    if (family === 'anime') return WORDS.glamourSubjectMaleAnime;
    if (family === 'cg3d') return WORDS.glamourSubjectMale3d;
    if (family === 'painterly' || family === 'illustration') return WORDS.glamourSubjectMaleAnime;
    return WORDS.glamourSubjectMale;
  }

  function malePowerSubjectPool(family) {
    return glamourMaleSubjectPool(family);
  }

  function lightPoolForCharacter(family) {
    if (family === 'anime' || family === 'illustration') return WORDS.animeLight;
    if (family === 'cg3d') return WORDS.cg3dLight;
    if (family === 'painterly') return WORDS.painterlyLight;
    return WORDS.characterLight;
  }

  const TWIST = [
    '画面边缘轻微胶片颗粒',
    '前景飘浮尘埃被光照亮',
    '背景 bokeh 呈六边形光斑',
    '空气中可见丁达尔光束',
    '地面有镜面反射倒影',
    '风扬起微尘与碎屑',
    '画面角落有飞鸟剪影',
    '飘落的樱瓣/雪花每片有高光',
    '镜头边缘轻微 vignette',
    '前景 out-of-focus 枝叶框景',
    '玻璃/水面折射变形背景',
    '逆光 dust motes 可见',
    '雨丝斜线统一方向',
    '画面一角 small mascot 或使魔',
    '背景简化成 gradient + 少量纹理',
    '对话框/拟声词留白区（无文字）',
    'speed lines 仅背景区域',
    '花瓣/羽毛轨迹弧线引导视线',
    '单一强光源形成长 shadow',
    '画面边缘 anime film grain 轻微',
    '远处飞鸟或纸屑形成引导线',
    '前景虚化遮挡增加层次',
    '画面一角 small 道具呼应主题',
    '统一风向的布料/发丝/烟',
    '地面水洼倒映主体半身',
    '窗框或门框自然框景',
    '星芒滤镜点光源',
    '薄雾仅远景，焦内清晰',
    '色彩仅一处饱和其余灰',
    '镜头光晕克制单一',
    '背景重复图案弱化',
    '主体脚下 contact shadow 真实',
    '环境粒子：萤光/尘埃/花瓣',
    '时间感：黄昏长影或蓝调'
  ];

  const WORDS = {
    characterSubject: [
      '赛博朋克女刀客，银发挑染紫', '黑红战袍女刺客，面纱半遮', '宫廷红衣贵妃，金饰压鬓',
      'Y2K 辣妹，金属链与墨镜', '废土女猎人，护目镜与绷带', '白裙精灵射手，花冠与尖耳',
      '港风胶片女郎，波浪卷发', '机甲少女，破损装甲露伤痕', '哥特修女，黑色蕾丝头纱',
      '敦煌飞天，飘带凌空', '蒸汽朋克发明家，护目镜与铜管', '水下人鱼，鳞片反光',
      '西部牛仔女郎，宽檐帽', '忍者女侍，面罩只露双眼', '芭蕾黑天鹅，羽毛头饰',
      '摇滚吉他手，铆钉皮衣', '旗袍军阀夫人，毛领披肩', '滑雪少女，护目镜与雪花',
      '女巫，尖帽与魔法书', '赛博和尚，全息经文环绕', '花魁，夸张发髻与金簪',
      '太空殖民者，透明头盔', '维京女战士，双辫与战斧', '洛丽塔，蝴蝶结与蕾丝',
      '消防英雄，头盔与火光映照', '赛博歌姬，麦克风与霓虹', '沙漠旅人，风沙围巾',
      '京剧花旦，脸谱与水袖', '吸血鬼伯爵，披风与红酒', '未来警察，战术装甲'
    ],
    characterFace: [
      '琥珀瞳孔高光锐利', '泪痣咬唇妆，攻击性美貌', '瓷白肤对浓艳唇', '异色瞳金蓝各一',
      '战损妆，颊上血痕', '冷白皮，眉峰如刀', '雀斑阳光感，大笑露齿', '烟熏妆，眼神凌厉',
      '湿发贴面，刚淋雨', '面具半遮，只露下颌', '雀斑与晒伤红晕', '玻璃肌，高光在颧骨',
      '刀疤穿过眉骨', '红色隐形眼镜', '雀斑鼻，天真感', '成熟细纹，故事感',
      '少年感，清澈眼神', '厌世脸，微张嘴', '精灵尖耳与细眉', '金属唇环与舌钉'
    ],
    characterOutfit: [
      '皮革紧身衣 + 金属链', '重工刺绣汉服 + 金属护肩', '透明 PVC 外套叠霓虹内搭',
      '和服振袖被风吹开', '战术背心与热裤', '液态金属质感长袍', '羽毛披肩与钻石项链',
      '校服但领带松开', '泳装外搭敞开的衬衫', '盔甲与破损披风', 'latex 连体衣反光',
      '民族银饰堆叠', 'oversized 西装无内搭', 'Raincoat 黄雨衣与裸腿',
      '皮草与迷你裙对比', '赛博义肢外露机械臂', '纱丽金线刺绣', '朋克铆钉项圈',
      '白色浴袍刚出浴', '消防服半解', '太空服上半敞开', '芭蕾 tutu 与绑腿'
    ],
    characterPose: [
      '低机位仰拍，Dominant presence', '回眸一瞬，发丝扫过镜头', '拔刀半出鞘动态定格',
      '雨中撑伞，溅起水花', '坐霓虹招牌俯视城市', '特写双眼占满画面',
      '奔跑中回头，motion blur 背景', '漂浮空中，衣摆放射状', '靠墙点烟，侧光半脸',
      '跪地祈祷，双手合十', '舞蹈 mid-air，肢体延伸', '格斗蓄力，肌肉绷紧',
      '手持花束遮半脸', '骑摩托，风吹 scarf', '镜前化妆，镜中双脸',
      '楼梯上回头，透视强烈', '水中半身，波纹折射', '逆光剪影，轮廓清晰'
    ],
    characterLight: [
      '红蓝霓虹对打光', '伦勃朗硬光 + 深黑阴影', '逆光金边轮廓', '暴雨闪电瞬间照亮',
      '烟雾体积光柱', '蓝调夜景 + 面部暖补光', '绿色激光扫过面部', '烛光唯一光源',
      '冰蓝月光 + 暖色窗光', '火焰映照橙红', '屏幕光打在脸上', '频闪灯冻结动作',
      '柔光箱正面 + 边缘 kicker', '顶光戏剧化', '彩色 gel 片红绿对比'
    ],
    characterSubjectPhoto: [
      '都市白领女性，自然妆容', '健身女性，线条健康', '混血模特，高颧骨',
      '街头滑板少年', '咖啡馆读书女孩', '乐队主唱，舞台灯光', '芭蕾舞者，踮脚旋转',
      '潜水员，水下气泡', '滑雪者，雪粉飞扬', '银发老人，故事感皱纹', '新生儿与母亲',
      '厨师，火焰映照', '运动员冲刺瞬间', '程序员，屏幕光打脸', '农民，晒谷场'
    ],
    characterSubjectAnime: [
      '银发剑士少女，和风外套', '双马尾魔法使，星形发饰', '兽耳侦探，风衣与耳',
      '和风巫女，御币与铃', '机甲驾驶员，休息舱便装', '精灵弓手，箭搭弦上',
      '吸血鬼贵族，披风与红酒', '偶像 backstage，麦克风与彩带', '炼金术士，药瓶与火花',
      '龙角少女，鳞片微光', '阴阳师，式神火焰', '不良少年，制服敞开',
      '黑客少女，透明键盘', '体操少女，彩带飞旋', '海盗副官，眼罩与弯刀',
      '魔法学院学姐，法袍与魔导书', '猫耳摇滚主唱', '九尾妖狐，尾巴展开',
      '圣骑士，巨剑插地', '死神，镰刀与锁链', '飞行员，护目镜', '女仆，托盘与咖啡',
      '风纪委员，臂章严肃', '天文社少女，望远镜', '剑道部主将，竹刀',
      '轻音部贝斯，挑染发', '异世界勇者，盾与短剑', '机娘维护，半甲工具',
      '和风舞姬，扇与足袋', '怪盗，礼帽扑克', '元素使，四属性 orb',
      '退魔师，念珠符纸', '龙骑士，骑枪鳞甲', '时间旅人，怀表长 coat',
      '地下偶像，荧光棒汗', '游戏 NPC 旅人，斗篷灯', '图书委员，眼镜书堆',
      '魔法学院新生，法袍书', '兽化混血，耳尾绷带', '咒物商人，面具灯笼'
    ],
    characterSubject3d: [
      '赛博女猎手，义眼发光', '半机械剑士，装甲接缝微光', '浮空摩托骑手',
      'AI 歌姬，全息舞台', '企业特工，战术装甲', '废土拾荒者，护目镜',
      '龙血战士，角与鳞', '太空殖民者，透明头盔', '纳米医生，光针',
      '机甲少女，破损外甲', '数据幽灵，半透明', '地下拳手，机械臂'
    ],
    characterSubjectIllust: [
      '剪影刺客，纯黑轮廓 + 一抹红', '几何面具舞者', '纸艺折纸武士',
      '霓虹线框少女', '浮世绘风格鬼面武士', '美漫英雄，粗墨线',
      '像素冒险者，16-bit 装备', '扁平矢量女巫', '水墨侠客，留白',
      '蒸汽朋克发明家，铜管与护目镜', '塔罗牌女祭司', '剪纸风凤凰少女'
    ],
    animeLight: [
      '动画 cel shading 硬边高光', 'key visual 侧光，阴影形简化',
      '新海诚式天空光溢出', '吉卜力式柔和顶光', 'Ufotable 式强对比 rim light',
      '韩漫柔光，渐变阴影', '90s 赛璐璐电视色 + 粗线稿阴影',
      '魔法 glow 来自道具，非 cheap bloom', '樱花/backlit 轮廓', '雨夜霓虹 edge light',
      '教室窗光侧照，窗帘半透明', '祭典灯笼暖光 + 面部冷补', '月光银蓝 + 室内暖光对比',
      '闪电瞬间 flash，角色轮廓清晰', '舞台 spotlight + 观众席暗', '神社树影斑驳光',
      '水下 caustics 在发丝', '屏幕光映在脸上（游戏/手机）', '蜡烛暖光 + 深紫阴影',
      'overcast 柔光，肤质插画化', 'rim light 勾发丝与武器', '体积光穿过窗格',
      'neon sign 反射在 wet pavement', '魔法阵自发光映脸', '夕照 golden rim + 冷色 fill'
    ],
    cg3dLight: [
      '三点布光 + HDRI 环境', '体积雾 god rays', '霓虹 rim + 冷色 fill',
      '演播室级 area light', '火星夕照 + 长 shadow', '水下 caustics',
      'Unreal 级 lumen 反弹', '电影级 anamorphic streak'
    ],
    painterlyLight: [
      '伦勃朗式明暗', '印象派破碎高光', '水墨留白无强光源',
      '窗光油画侧照', '烛光暖调厚涂', '水彩透明叠色光'
    ],
    characterStyle: [
      '时尚大片 editorial', '赛博朋克电影剧照', '港风复古胶片', '暗黑 fantasy portrait',
      '小红书爆款封面人像', 'Vogue 商业人像', 'Weta 级写实 CG', '90s 杂志扫描质感',
      '黑白高对比时尚', '油画质感 Rembrandt', 'K-pop 专辑封面风', '游戏 CG 过场'
    ],
    scenePlace: [
      '雨夜东京涩谷路口', '重庆洪崖洞夜景', '废弃游乐园旋转木马', '海底神殿光束穿水',
      '火星穹顶外红沙漠', '哥特教堂彩窗炸裂色', '水墨山水 + neon 点缀', '蒸汽朋克飞艇港',
      '冰岛黑沙滩', '纽约时代广场雨夜', '撒哈拉星空营地', '苏州园林曲桥',
      'Cyberpunk  Chinatown 窄巷', '北极光下冰屋', '金字塔内部', '东京塔观景台',
      '地下铁隧道风灌入', '火山口边缘', '古代罗马斗兽场', '新加坡滨海湾',
      '西藏经幡山坡', '伦敦雾都泰晤士河', '香港庙街夜市', '阿尔卑斯雪线',
      '废弃苏联工厂', '热带雨林瀑布', '月球基地环形山', '荷兰 tulip 花田',
      '上海外滩 Art Deco', '摩洛哥蓝墙巷', '南极科考站'
    ],
    sceneDrama: [
      '暴风雨云翻涌如兽', '爆炸余烬悬浮空中', '极光大幕铺满', '洪水淹至腰深',
      '巨大月亮低悬半空', '万灯齐亮雾吞街景', '龙卷风远处逼近', '流星雨划过',
      '雪崩扬起尘雾', '火山灰遮蔽天空', '彩虹横跨峡谷', '闪电连续劈下',
      '沙尘暴逼近', '海啸浪墙在远处', '极光与暴雪同时', '日食边缘光'
    ],
    sceneColor: [
      'Teal and Orange 青橙互补，电影常用', '黑金奢华，低饱和背景', '纯黑白 + 一抹深红',
