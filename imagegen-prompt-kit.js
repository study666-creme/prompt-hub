/**
 * 灵感抽卡：高风格化槽位词库（本地随机，无需 API）
 * 面向小红书/抖音引流：强对比、强风格、强记忆点
 */
(function (global) {
  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  const PUNCH = [
    '视觉冲击力强，第一眼抓人',
    '高对比度配色，社交媒体封面质感',
    '电影级调色，暗部深邃高光干净',
    '强轮廓光 rim light，主体从背景跳出',
    '粒子与光斑飞溅，画面有「事件感」',
    '极端景深，主体锐利背景梦幻虚化'
  ];

  const QUALITY = [
    'masterpiece, best quality, ultra detailed, bold composition, striking visual impact',
    '8k, cinematic color grading, high contrast, dramatic lighting, trending on artstation',
    '超精细，高饱和点睛色，画面有张力，适合封面'
  ];

  const TEMPLATES = {
    character: {
      label: '人物',
      hint: '人像 / 半身 / 特写',
      build() {
        const subject = pick([
          '赛博朋克女刀客，银发挑染紫', '黑红战袍女刺客，面纱半遮',
          '宫廷红衣贵妃，金饰压鬓', 'Y2K 辣妹，金属配饰堆叠',
          '废土女猎人，护目镜与绷带', '白裙精灵射手，尖耳与花冠',
          '港风胶片女郎，波浪卷发', '机甲少女，破损装甲露出伤痕'
        ]);
        const face = pick([
          '琥珀瞳孔高光锐利', '泪痣与咬唇妆，攻击性美貌',
          '瓷白皮肤对上浓艳唇色', '异色瞳，一侧金一侧蓝',
          '战损妆，脸颊血痕未干', '冷白皮，眉峰如刀'
        ]);
        const outfit = pick([
          '皮革紧身衣 + 金属链条', '重工刺绣汉服 + 金属护肩',
          '透明 PVC 外套叠霓虹内搭', '和服振袖被风吹开像翅膀',
          '战术背心与短热裤', '液态金属质感长袍'
        ]);
        const pose = pick([
          '低机位仰拍，Dominant presence', '回眸一瞬，发丝扫过镜头',
          '拔刀半出鞘，动态定格', '雨中撑伞，溅起水花',
          '坐在霓虹招牌上俯视城市', '特写双眼，占满画面'
        ]);
        const light = pick([
          '红蓝双色霓虹对打光', '单一硬光 + 深黑阴影（伦勃朗光）',
          '逆光剪影 + 边缘金边', '暴雨中闪电瞬间照亮',
          '烟雾中体积光柱', '蓝调夜景 + 面部暖色补光'
        ]);
        const style = pick([
          '时尚大片 editorial', '赛博朋克电影剧照', '港风复古胶片',
          '暗黑 fantasy portrait', '小红书爆款人像封面', 'Vogue 级商业人像'
        ]);
        return `${subject}，${face}，${outfit}，${pose}，${light}，${style}，${pick(PUNCH)}，${pick(QUALITY)}`;
      }
    },
    scene: {
      label: '场景',
      hint: '环境 / 氛围 / 建筑',
      build() {
        const place = pick([
          '雨夜东京涩谷十字路口', '重庆洪崖洞夜景，层层叠叠',
          '废弃游乐园旋转木马', '海底神殿，光束穿水而下',
          '火星殖民穹顶外红色沙漠', '哥特教堂内部，彩窗炸裂色',
          '中国水墨山水但 neon 点缀', '蒸汽朋克飞艇港口'
        ]);
        const drama = pick([
          '暴风雨将至，云层翻涌如兽', '爆炸余烬仍在空中悬浮',
          '极光大幕铺满天空', '洪水淹没街道至 waist depth',
          '巨大月亮低悬占半天空', '万灯齐亮，雾气吞没街景'
        ]);
        const color = pick([
          '青橙互补色 Teal and Orange', '洋红 + 电光蓝 Cyber palette',
          '黑金奢华色调', '单色系只剩红色', '高饱和糖果色但暗角压暗'
        ]);
        const comp = pick([
          '超广角透视夸张', '对称构图如韦斯·安德森',
          '一人渺小对比巨构建筑', '无人机俯冲角度', '框中框，门窗框住主体'
        ]);
        const style = pick([
          'Blade Runner 2049 美术', '概念艺术 key art',
          '国家地理但调色极端', '动画背景美术（新海诚级）', '游戏 CG 过场'
        ]);
        return `${place}，${drama}，${color}，${comp}，${style}，${pick(PUNCH)}，${pick(QUALITY)}`;
      }
    },
    product: {
      label: '产品',
      hint: '静物 / 商业摄影',
      build() {
        const item = pick([
          '限量版香水瓶，切面如宝石', '霓虹渐变运动鞋悬浮',
          '机械键盘，键帽透光', '黑金口红，膏体微距',
          '精酿啤酒瓶，冷凝水珠', '智能手表，表盘发光'
        ]);
        const drama = pick([
          '爆炸式粉末/水花包裹产品', '黑色背景一束聚光灯',
          '悬浮空中，底部镜面反射', '烟雾缭绕，仅产品清晰',
          '彩色凝胶片投射不规则色块'
        ]);
        const material = pick([
          '金属高光如刀锋', '玻璃折射彩虹', '磨砂与亮面对比',
          '液体飞溅冻结瞬间', '皮革纹理微距'
        ]);
        const style = pick([
          'Apple 级极简但高对比', '奢侈品广告大片',
          '电商爆款主图，主体占 70%', 'Magazine cover product hero shot'
        ]);
        return `${item} 商业静物，${drama}，${material}，${style}，${pick(PUNCH)}，${pick(QUALITY)}`;
      }
    },
    anime: {
      label: '动漫',
      hint: '二次元 / 插画',
      build() {
        const role = pick([
          '双马尾魔法少女，法杖顶端星核旋转', '黑长直咒术师，符咒环绕',
          '机甲少年，半脸被面罩遮住', '猫耳摇滚主唱，舞台灯光',
          '和风妖狐，九尾展开如扇', '校园不良少年，制服敞开',
          '龙族少女，龙角与鳞片反光', '异世界圣骑士，巨剑插地'
        ]);
        const action = pick([
          '施法瞬间，魔法阵占满地面', '拔刀居合，刀光划破雨幕',
          '跳跃空中，衣摆与头发呈放射状', '回眸，花瓣/雪花爆炸式飞散',
          '双眼发光，能量从瞳孔溢出', '战斗残影，多重曝光效果'
        ]);
        const palette = pick([
          '霓虹紫粉 + 电光蓝，高饱和', '黑金 + 血红点缀',
          '青白冷色 + 单一暖色点睛', '日落橙紫渐变天空',
          '故障艺术 Glitch 色块穿插', '荧光色平涂，赛璐璐硬边阴影'
        ]);
        const fx = pick([
          '火花、闪电、羽毛粒子满天飞', '镜头光晕与星芒',
          '速度线 + 冲击波环', '魔法符文漂浮发光',
          '雨滴/樱花每片带高光', '烟雾体积光从背后溢出'
        ]);
        const style = pick([
          'Pixiv 日榜级 key visual', '动画 OP 第一帧构图',
          '厚涂 + 强线稿，Ufotable 风', '90 年代赛璐璐但现代上色',
          '韩漫半写实 + 二次元脸', '游戏立绘 SSR 稀有度质感'
        ]);
        return `${role}，${action}，${palette}，${fx}，背景层次丰富，${style}，${pick(PUNCH)}，${pick(QUALITY)}`;
      }
    },
    viral: {
      label: '爆款',
      hint: '小红书 / 抖音向',
      build() {
        const hook = pick([
          '一张图讲一个故事：雨夜分手在电话亭',
          '「神明少女」降临废弃商场',
          '赛博观音，霓虹 halo 与机械臂',
          '古风侠客在现代地铁里拔刀',
          '透明水母裙少女走在沙漠',
          '黑猫与红裙女孩对视，背景全黑'
        ]);
        const look = pick([
          '小红书封面级构图，主体居中偏上',
          '抖音竖屏 9:16，人物占 60% 画面',
          '强情绪：孤独/燃/诡谲/浪漫 择一拉满',
          '单主体 + 极简背景，拒绝杂乱',
          '一个超现实元素让人停滑'
        ]);
        const color = pick([
          '只保留两种颜色，其余压灰', '霓虹点缀 + 大面积暗部',
          '胶片暖色但阴影偏青', '高饱和红或蓝独占画面',
          '金属质感 + 单一荧光色'
        ]);
        const lens = pick([
          '35mm 电影镜头，轻微畸变增强冲击',
          '85mm 人像，背景强烈虚化',
          '超近特写，五官或道具占满',
          '低角度仰拍显高大与压迫'
        ]);
        const style = pick([
          'AI 艺术但像真人电影剧照', '二次元但电影级光影',
          '超现实摄影', '概念插画爆款风', '时尚 editorial × 幻想元素'
        ]);
        return `${hook}，${look}，${color}，${lens}，${style}，${pick(PUNCH)}，${pick(QUALITY)}`;
      }
    }
  };

  function generateInspirationPrompts(type, count) {
    const tpl = TEMPLATES[type] || TEMPLATES.viral;
    const n = Math.min(8, Math.max(1, Number(count) || 3));
    const prompts = [];
    const seen = new Set();
    let guard = 0;
    while (prompts.length < n && guard < n * 12) {
      guard += 1;
      const p = tpl.build();
      if (seen.has(p)) continue;
      seen.add(p);
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
