      ];
    } else if (recipe === 3) {
      parts = [
        pick(WORDS.megaPersComp),
        pick(WORDS.epicArchitecture),
        pick(WORDS.megaPersSubject),
        pick(WORDS.megaPersLight),
        pick(WORDS.epicTension),
        ctx?.tail?.()
      ];
    } else {
      parts = [
        pick(WORDS.megaPersComp),
        pick(WORDS.characterSubject),
        pick(WORDS.megaPersSubject),
        pick(WORDS.megaPersMood),
        pick(WORDS.impactComp),
        pick(WORDS.megaPersLight),
        ctx?.tail?.()
      ];
    }
    return combineParts(parts, { keepFirst: true });
  }

  function buildWideAngle(ctx) {
    const family = ctx?.family || 'neutral';
    return combineParts([
      pick(WORDS.wideAngleLens),
      pick(WORDS.wideAngleScene),
      pick(WORDS.megaPersComp),
      pick(WORDS.sceneComp),
      pick(lightPoolForCharacter(family)),
      pickMaybe(TWIST, 0.45),
      ctx?.tail?.()
    ], { keepFirst: true });
  }

  function buildHighTension(ctx) {
    const family = ctx?.family || 'neutral';
    return combineParts([
      pick(WORDS.highTensionMood),
      pick(WORDS.highTensionBeat),
      pick(WORDS.impactHook),
      pick(WORDS.impactComp),
      pick(WORDS.epicTension),
      pick(lightPoolForCharacter(family)),
      pickMaybe(TWIST, 0.5),
      ctx?.tail?.()
    ], { keepFirst: true });
  }

  function buildLuxurySolidBg(ctx) {
    const family = ctx?.family || 'neutral';
    const finishPool = family === 'anime' ? WORDS.animeStyle : WORDS.premiumFinish;
    return combineParts([
      pick(WORDS.luxurySolidBgHook),
      pick(WORDS.luxurySolidBgColor),
      pick(WORDS.luxurySolidBgSurface),
      pick(WORDS.premiumSubject),
      pick(WORDS.luxurySolidBgLight),
      pick(finishPool),
      pickMaybe(TWIST, 0.3),
      ctx?.tail?.()
    ], { keepFirst: true });
  }

  function buildOppressiveMax(ctx) {
    const family = ctx?.family || 'neutral';
    return combineParts([
      pick(WORDS.oppressiveMaxHook),
      pick(WORDS.oppressiveMaxScale),
      pick(WORDS.oppressiveMaxComp),
      pick(WORDS.oppressiveMaxLight),
      pick(WORDS.epicTension),
      pick(WORDS.highTensionBeat),
      lightPoolForCharacter(family) && pick(lightPoolForCharacter(family)),
      pickMaybe(TWIST, 0.45),
      ctx?.tail?.()
    ], { keepFirst: true });
  }

  const CONTENT_TEMPLATES = {
    character: { label: '人物', hint: '人像 / 半身 / 特写', build: buildCharacter },
    scene: { label: '场景', hint: '环境 / 氛围 / 建筑', build: buildScene },
    product: { label: '产品', hint: '静物 / 商业摄影', build: buildProduct },
    viral: { label: '爆款', hint: '小红书 / 抖音向', build: buildViral },
    premium: { label: '精品', hint: 'Editorial / 奢侈品 / 封面级', build: buildPremium },
    epic: { label: '史诗巨构', hint: '大透视 / 强张力 / 巨型建筑', build: buildEpic },
    impact: { label: '高冲击力', hint: '构图 / 姿态 / 强氛围', build: buildImpact },
    stylized: { label: '高风格化', hint: '怪诞 / 小众 / 高级猎奇', build: buildStylized },
    guofeng: { label: '国风仙侠', hint: '汉服 / 水墨 / 仙侠', build: buildGuofeng },
    cyber: { label: '赛博科幻', hint: '霓虹 / 机甲 / 未来城', build: buildCyber },
    cover916: { label: '竖屏封面', hint: '9:16 短剧 / 封面级', build: buildCover916 },
    glamour: { label: '女性美学', hint: '女性专属 · 夸张比例 · 非常规时装', build: buildGlamour },
    malePower: { label: '男性力量', hint: '男性专属 · 倒三角 · 运动员体态', build: buildMalePower },
    avantFrame: { label: '非常规构图', hint: '失衡镜头 · 瞬时冲击 · 艺术感', build: buildAvantFrame },
    coolMecha: { label: '酷炫机甲', hint: '极致炫酷 · 机体 · 战损光效', build: buildCoolMecha },
    megaPerspective: { label: '大透视', hint: '消失点 · 纵深 · 空间吞噬', build: buildMegaPerspective },
    wideAngle: { label: '广角镜头', hint: '超广角 / 环境大场景', build: buildWideAngle },
    highTension: { label: '张力十足', hint: '动势 / 冲突 / 戏剧高潮', build: buildHighTension },
    moviePoster: { label: '影视海报', hint: '短剧 / 电影 KV · 强情绪', build: buildMoviePoster },
    travel: { label: '旅途风光', hint: '地标 / 公路 / 人文旅行', build: buildTravel },
    sports: { label: '运动瞬间', hint: '竞技 / 力量 / 动态 freeze', build: buildSports },
    vintage: { label: '复古胶片', hint: '年代感 / 胶片 / 怀旧', build: buildVintage },
    lifeAesthetic: { label: '生活美学', hint: '日常 / cozy / 治愈 ritual', build: buildLifeAesthetic },
    doujin: { label: '同人动漫', hint: '随机动漫角色 · 同人插画', build: buildDoujin },
    animeillust: { label: '动漫插画', hint: '角色 / 场景 / SSR 立绘', build: buildAnimeIllust },
    originalchar: { label: '原创主角', hint: '主角感 · 设计感 · 故事感 · 非路人', build: buildOriginalCharacter },
    food: { label: '美食', hint: '食欲 / 静物 / 商业', build: buildFood },
    pet: { label: '萌宠', hint: '猫狗 / 治愈 / 动态', build: buildPet },
    mood: { label: '氛围叙事', hint: '情绪 / 空镜 / 电影感', build: buildMood },
    architecture: { label: '建筑空间', hint: '地标 / 室内 / 光影', build: buildArchitecture },
    fashion: { label: '时尚穿搭', hint: '秀场 / 街拍 / editorial', build: buildFashion },
    horror: { label: '悬疑惊悚', hint: '暗调 / 心理压迫', build: buildHorror },
    liminal: { label: '阈限空间', hint: '空廊 / 荧光灯 / 熟悉陌生感', build: buildLiminal },
    romance: { label: '浪漫叙事', hint: '情侣 / 柔光 / 情绪', build: buildRomance },
    macro: { label: '微距特写', hint: '材质 / 细节 / 质感', build: buildMacro },
    seasonal: { label: '节气时令', hint: '四季 / 节日 / 东方意境', build: buildSeasonal },
    luxurySolidBg: { label: '纯色高级背景', hint: '极简 / 奢侈品广告 / 无缝底色', build: buildLuxurySolidBg },
    oppressiveMax: { label: '压迫感拉满', hint: '低机位 / 巨物 / 心理压迫', build: buildOppressiveMax }
  };

  const ART_STYLES = {
    none: { label: '不指定', hint: '仅内容词', tag: '' },
    auto: { label: '智能匹配', hint: '每条随机画风', tag: '' },
    photo: { label: '真人摄影', hint: '写真 / 胶片', tag: '【画风锁定】真人摄影写真，85mm 浅景深，自然肤质，非插画' },
    photo_film: { label: '胶片人像', hint: '柯达 / 富士', tag: '【画风锁定】35mm 胶片人像，Portra 颗粒，真人摄影' },
    hyperreal: { label: '超写实', hint: '毛孔级写实 / 商业人像', tag: '【画风锁定】超写实摄影，毛孔级肤质与微距级细节，商业广告级 retouch，非插画非动漫' },
    anime: { label: '二次元插画', hint: 'Pixiv / 厚涂 / 立绘', tag: '【画风锁定】日系二次元插画，线稿上色，非摄影非真人' },
    dongman: { label: '动漫画风', hint: 'TV动画 / 漫画 / 番剧截图感', tag: '【画风锁定】日本动漫画风，动画或漫画插画，赛璐璐或数字上色，非真人摄影' },
    anime_90s: { label: '90s 赛璐璐', hint: '复古 TV 动画', tag: '【画风锁定】90 年代赛璐璐动画风，非真人' },
    semireal: { label: '半写实二次元', hint: '韩漫 / 游戏立绘', tag: '【画风锁定】半写实二次元插画，游戏立绘，非摄影' },
    manhwa: { label: '韩漫风', hint: '条漫 / Webtoon', tag: '【画风锁定】韩漫 webtoon 插画，非真人写真' },
    cg_3d: { label: '3D CG', hint: '写实渲染', tag: '【画风锁定】3D CG 渲染，PBR 材质，非真人照片' },
    cg_3d_toon: { label: '3D 卡通', hint: '皮克斯 / 盲盒', tag: '【画风锁定】3D 卡通渲染，非真人' },
    unreal: { label: '虚幻引擎风', hint: '游戏过场', tag: '【画风锁定】Unreal Engine 5 过场 CG，非摄影' },
    ghibli: { label: '吉卜力风', hint: '手绘动画背景', tag: '【画风锁定】吉卜力手绘动画美术，非真人' },
    makoto: { label: '新海诚风', hint: '光与天空', tag: '【画风锁定】新海诚式动画背景与光晕，非摄影' },
    arcane: { label: 'Arcane 风', hint: '手绘纹理 3D', tag: '【画风锁定】Arcane 风手绘纹理 3D，非真人' },
    oil: { label: '油画', hint: '古典 / 印象', tag: '【画风锁定】古典油画插画，非摄影' },
    watercolor: { label: '水彩', hint: '透明水色', tag: '【画风锁定】水彩插画，非摄影' },
    ink: { label: '水墨', hint: '国画 / 墨韵', tag: '【画风锁定】中国水墨写意插画，非摄影' },
    pixel: { label: '像素风', hint: '16-bit / 复古游戏', tag: '【画风锁定】像素 art 插画，非摄影' },
    comic: { label: '美漫', hint: 'Marvel / DC 封面', tag: '【画风锁定】美式漫画插画，非摄影' },
    flat: { label: '扁平插画', hint: '矢量 / 海报', tag: '【画风锁定】扁平矢量插画，非摄影' },
    lineart: { label: '线稿厚涂', hint: '动画 key visual', tag: '【画风锁定】动画 key visual 线稿厚涂，非摄影' },
    cyber_render: { label: '赛博渲染', hint: 'Blade Runner 美术', tag: '【画风锁定】赛博朋克概念 art，非真人写真' },
    dark_aesthetic: { label: '暗黑美学', hint: '哥特 / 暗调 / 颓废华丽', tag: '【画风锁定】暗黑美学，低明度高对比，哥特/颓废/神秘氛围，非明亮卡通非真人摄影' },
    weta: { label: 'Weta 写实 CG', hint: '电影级角色', tag: '【画风锁定】Weta 级写实 CG，非真人照片' },
    hyperreal_3d_cgi: {
      label: '超写实 3D CGI',
      hint: '电影级数字人 / UE5',
      tag: '【画风锁定】超写实3D CGI，电影级数字角色渲染，PBR次表面散射肤质，发丝级细节，UE5/Octane商业品质，非真人摄影非2D插画'
    },
    guoman_25d: {
      label: '2.5D国漫写实',
      hint: '国漫比例 + 3D写实渲染',
      tag: '【画风锁定】2.5D国漫融合3D写实建模，理想化大眼精致五官与国漫面部比例，次表面散射肤质、发丝级头发与PBR服装材质，电影级轮廓光与浅景深虚化，UE5/C4D高品质3D渲染，非真人摄影非平面插画'
    },
    moe_chibi: {
      label: '萌版画风',
      hint: '2头身Q版 / 贴纸立牌 / 软萌',
      tag: '【画风锁定】萌版Q版画风，粗黑完整外轮廓描边，2头身大头小身子，圆滚滚短四肢，超大玻璃珠大眼睛带高光，粉圆形腮红，平涂上色纯色块几乎无阴影，亚克力贴纸立牌/冰箱贴卡通，纯白背景，软萌幼崽，扁平化简笔卡通，非真人非3D'
    }
  };

  const AUTO_STYLE_POOL = [
    'anime', 'dongman', 'semireal', 'lineart', 'cg_3d', 'hyperreal_3d_cgi', 'makoto', 'ghibli', 'photo', 'photo_film', 'hyperreal',
    'manhwa', 'arcane', 'oil', 'ink', 'pixel', 'cyber_render', 'dark_aesthetic', 'cg_3d_toon', 'unreal', 'anime_90s',
    'guoman_25d', 'moe_chibi'
  ];

  function clipPrompt(text, maxLen) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    const max = Math.max(500, Number(maxLen) || 7500);
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + '…';
  }

  function promptSignature(text) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    if (s.length <= 120) return s;
    const mid = Math.floor(s.length / 2);
    return s.slice(0, 48) + '|' + s.slice(mid - 16, mid + 16) + '|' + s.slice(-48);
  }

  function generateInspirationPrompts(contentType, count, styleId) {
    const types = Array.isArray(contentType)
      ? contentType.filter(Boolean)
      : [contentType || 'viral'];
    const stylePick = Array.isArray(styleId) ? styleId[0] || 'auto' : styleId || 'auto';
    const typePool = types.filter((t) => CONTENT_TEMPLATES[t]).length
      ? types.filter((t) => CONTENT_TEMPLATES[t])
      : ['viral'];
    const n = Math.min(8, Math.max(1, Number(count) || 3));
    const prompts = [];
    const seen = new Set();
    let guard = 0;
    const maxGuard = n * 80;
    while (prompts.length < n && guard < maxGuard) {
      guard += 1;
      const ctx = buildCtx(stylePick);
      let p = applyArtStyle(
        buildPromptForTypes(typePool, ctx, { variantIndex: prompts.length }),
        ctx.styleId
      );
      if (guard > n * 8) {
        p += `；${pick(TWIST)}`;
      }
      if (guard > n * 20) {
        p += `；变体 ${prompts.length + 1}-${Math.random().toString(36).slice(2, 6)}`;
      }
      const sig = promptSignature(p);
      if (seen.has(sig)) continue;
      seen.add(sig);
      prompts.push(clipPrompt(p, 7500));
    }
    return prompts;
  }

  /** 风格转换下拉：常用高级画风（不含 auto/none） */
  const STYLE_CONVERT_PRESETS = [
    'hyperreal_3d_cgi', 'cg_3d', 'unreal', 'weta', 'guoman_25d', 'hyperreal',
    'arcane', 'semireal', 'lineart', 'anime', 'dongman', 'photo', 'photo_film',
    'makoto', 'ghibli', 'oil', 'cyber_render', 'dark_aesthetic', 'ink', 'flat', 'comic', 'watercolor'
  ];

  global.ImageGenPromptKit = {
    CONTENT_TEMPLATES,
    ART_STYLES,
    generateInspirationPrompts,
    listContentTypes() {
      return Object.entries(CONTENT_TEMPLATES).map(([id, t]) => ({
        id,
        label: t.label,
        hint: t.hint
      }));
    },
    listArtStyles() {
      return Object.entries(ART_STYLES).map(([id, t]) => ({
        id,
        label: t.label,
        hint: t.hint
      }));
    },
    listStyleConvertPresets() {
      return STYLE_CONVERT_PRESETS.map((id) => {
        const t = ART_STYLES[id];
        return t ? { id, label: t.label, hint: t.hint } : null;
      }).filter(Boolean);
    },
    getArtStyleTag(styleId) {
      const resolved = resolveStyleId(styleId);
      return ART_STYLES[resolved]?.tag || '';
    },
    /** @deprecated 使用 listContentTypes */
    listTypes() {
      return global.ImageGenPromptKit.listContentTypes();
    },
    /** 兼容旧名 */
    get TEMPLATES() {
      return CONTENT_TEMPLATES;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
