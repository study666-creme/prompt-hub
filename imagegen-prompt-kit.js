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

  const PUNCH = [
    '视觉冲击力强，第一眼抓人，适合封面',
    '高对比配色，社交媒体爆款质感',
    '电影级调色，暗部深、高光干净',
    '强 rim light 轮廓光，主体从背景跳出',
    '粒子光斑飞溅，画面有事件感与动感',
    '极端浅景深，主体锐利背景梦幻',
    '中心构图 + 四周暗角，视线锁定主体',
    '超现实元素一个就够，其余极简'
  ];

  const QUALITY = [
    'masterpiece, best quality, ultra detailed, bold composition, striking visual impact',
    '8k uhd, cinematic color grading, high contrast, dramatic lighting, trending on artstation',
    '超精细纹理，高饱和点睛色，画面张力强，封面级'
  ];

  const TWIST = [
    '画面边缘轻微胶片颗粒',
    '局部 chromatic aberration 色散',
    '前景飘浮尘埃被光照亮',
    '背景 bokeh 呈六边形光斑',
    '空气中可见丁达尔光束',
    '地面有镜面反射倒影',
    '风扬起微尘与碎屑',
    '画面角落有飞鸟剪影'
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
      'Teal and Orange 青橙互补', '洋红 + 电光蓝 Cyber', '黑金奢华', '单色系只剩红',
      '高饱和糖果 + 暗角', '莫奈紫 + 柠檬黄点缀', '纯黑白 + 一抹红', '翡翠绿 + 金',
      '日落紫粉渐变', '冰蓝 + 暖橙对撞', '故障 RGB 分离', '银灰 + 荧光绿'
    ],
    sceneComp: [
      '超广角透视夸张', '韦斯·安德森对称', '人小景大史诗感', '无人机俯冲',
      '框中框门窗构图', 'S 形 river 引导线', '三分法地平线低', '螺旋楼梯俯视',
      '长曝光车流光轨', '反射面对称', '前景遮挡 peek 构图', '极简留白 70%'
    ],
    sceneStyle: [
      'Blade Runner 2049 美术', '概念 art key art', '国家地理但调色极端',
      '新海诚级动画背景', '游戏 CG 过场', 'Roger Deakins  cinematography',
      'Ghibli 云与光', 'Cyberpunk 2077 街景', 'Zdzisław Beksiński 超现实'
    ],
    animeRole: [
      '双马尾魔法少女，星核法杖', '黑长直咒术师，符咒环绕', '机甲少年，面罩半遮',
      '猫耳摇滚主唱', '九尾妖狐，尾巴展开', '校园不良，制服敞开', '龙角少女，鳞片反光',
      '圣骑士，巨剑插地', '忍者，苦无在手', '偶像，舞台麦克风', ' witch 帽与使魔',
      '兽耳冒险者，地图在手', '吸血鬼萝莉，蝙蝠伴飞', '剑士，和风太刀', '飞行员，护目镜',
      '黑客少女，全息键盘', '巫女，御币与铃', '海盗船长，望远镜', '炼金术士，药瓶爆炸',
      '死神，镰刀与锁链', '精灵弓手，箭搭弦上', '魔王，角与 throne', '女仆，托盘与咖啡',
      '赛车手，头盔抱怀', '阴阳师，式神火焰', '体操少女， ribbons 飞', '侦探，放大镜',
      '厨师，火焰炒锅', 'DJ，耳机与控制台', '幽灵，半透明飘浮'
    ],
    animeAction: [
      '施法，魔法阵铺满地面', '居合拔刀，刀光划雨', '跳跃空中，衣摆放射',
      '回眸，花瓣爆炸飞散', '双眼发光，能量溢出', '战斗残影多重曝光',
      '召唤 lightning 劈下', '展开 wings 遮天', 'time stop 悬浮水滴', 'rage aura 气焰',
      'dance spin，丝带轨迹', 'hug 自己，孤独感', 'eat 拉面， steam 升腾',
      'play guitar，音波可视化', 'cry 眼泪反光', 'laugh 仰天', 'sleep 漂浮 dream',
      'run 带 speed lines', 'block 盾牌碎裂', 'die 倒地但眼神坚定'
    ],
    animePalette: [
      '霓虹紫粉 + 电光蓝高饱和', '黑金 + 血红点缀', '青白冷色 + 暖色点睛',
      '日落橙紫天空', 'Glitch 色块穿插', '荧光赛璐璐硬边阴影', ' pastel 但阴影深紫',
      '金属色 + 洋红', '毒液绿 + 黑', ' sakura 粉 + 天青', ' lava 橙 + 炭灰'
    ],
    animeFx: [
      '火花闪电羽毛粒子飞', '镜头光晕星芒', '速度线冲击波环', '魔法符文漂浮发光',
      '雨滴/樱花每片高光', '烟雾体积光溢出', 'confetti 彩纸', 'bubble 魔法泡',
      'fire embers 上升', 'ice crystal 悬浮', 'blood splatter 艺术化', 'hologram UI 环绕',
      'petals tornado', 'lightning chain', 'aura 粒子环', 'lens dirt flare'
    ],
    animeStyle: [
      'Pixiv 日榜 key visual', '动画 OP 第一帧', 'Ufotable 厚涂 + 强线稿',
      '90s 赛璐璐现代上色', '韩漫半写实二次元脸', 'SSR 游戏立绘', 'Vtuber 封面',
      '轻小说封面', 'Mappa 级动态感', 'Kyoto Animation 柔光', 'Arcane 风手绘纹理'
    ],
    viralHook: [
      '雨夜分手，电话亭 alone', '神明少女降临废弃商场', '赛博观音，霓虹 halo 机械臂',
      '古风侠客在现代地铁拔刀', '透明水母裙少女走沙漠', '黑猫与红裙女孩对视纯黑背景',
      '巨人手从云下探出', '倒置城市，人走在天花板', '燃烧的书本飘雪',
      '玻璃罐中困住的 galaxy', '时钟融化 dripping', '双生姐妹镜像对称',
      '机器人抱人类婴儿', '龙缠绕摩天大楼', '钢琴漂浮海上',
      '面具摘下后是另一张脸', '血月下的婚礼', '千纸鹤风暴',
      '水晶球里是真实世界', '影子与本体不同步', '门后是无尽楼梯',
      '蝴蝶停在枪口', '雪地里唯一红伞', '深海中发光的人形',
      '公路尽头站着过去的自己', '天空裂开展现另一维度', '荆棘王座上的少女',
      '所有路牌指向不同方向', '破碎镜面每个碎片不同场景', '电梯门开是森林'
    ],
    viralLook: [
      '小红书封面，主体居中偏上', '抖音 9:16，人物占 60%', '强情绪：孤独/燃/诡谲/浪漫拉满',
      '单主体 + 极简背景', '一个超现实元素让人停滑', '对比色块背景 split',
      '文字留白区在上方 30%', '眼神直视镜头', '低饱和环境 + 高饱和主体',
      'snapshot 抓拍感，非摆拍', 'flash 直打，hard shadow', 'film grain 重'
    ],
    productItem: [
      '限量版香水瓶', '霓虹渐变运动鞋', '机械键盘 RGB', '黑金口红微距',
      '精酿啤酒冷凝珠', '智能手表发光表盘', '蛋糕切面', '无线耳机悬浮',
      '护肤霜玻璃罐', '跑车模型', '咖啡拉花', '球鞋与涂鸦墙',
      'whiskey 冰块', '相机镜头', '游戏手柄', '智能戒指', '茶叶罐',
      '巧克力 bonbon', 'VR 头显', '无人机', '滑板', '香薰蜡烛火焰'
    ],
    productDrama: [
      '爆炸粉末/水花包裹', '黑色背景一束聚光', '悬浮 + 地面镜面反射',
      '烟雾仅产品清晰', '彩色 gel 不规则色块', 'splash 液体冻结',
      '碎冰环绕', '花瓣飘落', 'gold dust 飞扬', 'lightning 背景但产品稳',
      'minimal 单灯侧光', 'gradient backdrop 无缝', 'hand 即将触碰产品'
    ],
    productStyle: [
      'Apple 级极简高对比', '奢侈品广告', '电商爆款主图 70% 占比',
      'Magazine hero shot', 'Cyberpunk product ad', '自然光 lifestyle 但产品 sharp'
    ]
  };

  function buildCharacter() {
    const s = pickFromPool(clonePool(WORDS.characterSubject));
    const f = pick(WORDS.characterFace);
    const o = pick(WORDS.characterOutfit);
    const p = pick(WORDS.characterPose);
    const l = pick(WORDS.characterLight);
    const st = pick(WORDS.characterStyle);
    return `${s}，${f}，${o}，${p}，${l}，${st}，${pick(PUNCH)}，${pick(TWIST)}，${pick(QUALITY)}`;
  }

  function buildScene() {
    return [
      pick(WORDS.scenePlace),
      pick(WORDS.sceneDrama),
      pick(WORDS.sceneColor),
      pick(WORDS.sceneComp),
      pick(WORDS.sceneStyle),
      pick(PUNCH),
      pick(TWIST),
      pick(QUALITY)
    ].join('，');
  }

  function buildProduct() {
    return [
      `${pick(WORDS.productItem)} 商业静物`,
      pick(WORDS.productDrama),
      pick(WORDS.productStyle),
      pick(PUNCH),
      pick(QUALITY)
    ].join('，');
  }

  function buildAnime() {
    return [
      pick(WORDS.animeRole),
      pick(WORDS.animeAction),
      pick(WORDS.animePalette),
      pick(WORDS.animeFx),
      '背景层次丰富',
      pick(WORDS.animeStyle),
      pick(PUNCH),
      pick(QUALITY)
    ].join('，');
  }

  function buildViral() {
    return [
      pick(WORDS.viralHook),
      pick(WORDS.viralLook),
      pick(WORDS.sceneColor),
      pick(WORDS.characterLight),
      pick(WORDS.animeStyle),
      pick(PUNCH),
      pick(QUALITY)
    ].join('，');
  }

  const TEMPLATES = {
    character: { label: '人物', hint: '人像 / 半身 / 特写', build: buildCharacter },
    scene: { label: '场景', hint: '环境 / 氛围 / 建筑', build: buildScene },
    product: { label: '产品', hint: '静物 / 商业摄影', build: buildProduct },
    anime: { label: '动漫', hint: '二次元 / 插画', build: buildAnime },
    viral: { label: '爆款', hint: '小红书 / 抖音向', build: buildViral }
  };

  function promptSignature(text) {
    return String(text || '')
      .replace(/\s+/g, '')
      .slice(0, 48);
  }

  function generateInspirationPrompts(type, count) {
    const tpl = TEMPLATES[type] || TEMPLATES.viral;
    const n = Math.min(8, Math.max(1, Number(count) || 3));
    const prompts = [];
    const seen = new Set();
    let guard = 0;
    const maxGuard = n * 40;
    while (prompts.length < n && guard < maxGuard) {
      guard += 1;
      let p = tpl.build();
      if (guard > n * 8) p += `，${pick(TWIST)}`;
      const sig = promptSignature(p);
      if (seen.has(sig)) continue;
      seen.add(sig);
      prompts.push(p);
    }
    return prompts;
  }

  global.ImageGenPromptKit = {
    TEMPLATES,
    generateInspirationPrompts,
    listTypes() {
      return Object.entries(TEMPLATES).map(([id, t]) => ({
        id,
        label: t.label,
        hint: t.hint
      }));
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
