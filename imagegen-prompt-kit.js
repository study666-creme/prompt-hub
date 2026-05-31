/**
 * 灵感抽卡：分类型槽位词库（本地随机，无需 API）
 */
(function (global) {
  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function pickUnique(arr, n) {
    const pool = arr.slice();
    const out = [];
    while (out.length < n && pool.length) {
      const i = Math.floor(Math.random() * pool.length);
      out.push(pool.splice(i, 1)[0]);
    }
    return out;
  }

  const QUALITY = [
    'masterpiece, best quality, highly detailed, sharp focus',
    '8k uhd, cinematic lighting, professional photography',
    '超高清细节，精致光影，画面干净'
  ];

  const TEMPLATES = {
    character: {
      label: '人物',
      hint: '人像 / 半身 / 特写',
      build() {
        const subject = pick([
          '年轻东亚女性', '银发少女', '古风公子', '赛博朋克女猎手', '温柔系男生',
          '精灵耳少女', '职场御姐', '街头潮流少年', '和服少女', '机械义肢战士'
        ]);
        const face = pick([
          '精致五官，自然妆容', '清冷气质，薄唇微抿', '明亮双眼，浅笑',
          '雀斑妆，阳光感', '凌厉眉峰，成熟神态'
        ]);
        const outfit = pick([
          '白色丝绸衬衫与高腰裙', '黑色机能风夹克', '刺绣汉服广袖',
          '未来感金属护甲', '针织毛衣与围巾', '校服风格水手服'
        ]);
        const pose = pick([
          '半身肖像，微微侧脸', '回眸，发丝随风', '双手抱臂，自信站姿',
          '坐在窗边，手持咖啡', '低角度仰拍，气场强'
        ]);
        const light = pick([
          '柔和窗光，浅景深', '金色夕阳侧光', '霓虹蓝紫氛围光',
          '影棚柔光箱，干净背景', '逆光轮廓光，胶片颗粒'
        ]);
        const lens = pick([
          '85mm 人像镜头', '50mm 自然透视', '特写构图，背景虚化',
          '中景构图，环境留白'
        ]);
        const style = pick([
          '写实摄影风', '电影剧照质感', '时尚杂志封面', '韩系清透人像', '轻胶片色调'
        ]);
        return `${subject}，${face}，${outfit}，${pose}，${light}，${lens}，${style}，${pick(QUALITY)}`;
      }
    },
    scene: {
      label: '场景',
      hint: '环境 / 氛围 / 建筑',
      build() {
        const place = pick([
          '雨夜东京街头', '清晨山间云海', '废弃科幻工厂', '江南水乡石桥',
          '北欧雪林小木屋', '沙漠孤独公路', '赛博朋克高架城', '古庙红叶庭院'
        ]);
        const time = pick([
          '蓝调时刻', '正午强对比', '薄雾清晨', '星夜长曝光', '暴雨将至的压抑天空'
        ]);
        const mood = pick([
          '宁静治愈', '史诗宏大', '孤独诗意', '神秘悬疑', '温暖生活感'
        ]);
        const comp = pick([
          '广角透视，引导线构图', '对称构图，中心主体', '低机位仰拍增强气势',
          '航拍俯瞰，城市脉络', '框景构图，前景虚化'
        ]);
        const detail = pick([
          '湿润路面反光', '体积光穿过尘埃', '飘雪与暖色窗灯',
          '飞鸟掠过天际线', '旗帜与烟雾动态'
        ]);
        const style = pick([
          '电影概念艺术', '国家地理风光摄影', '动画背景美术', '写实数字绘景'
        ]);
        return `${place}，${time}，${mood}，${comp}，${detail}，${style}，${pick(QUALITY)}`;
      }
    },
    product: {
      label: '产品',
      hint: '静物 / 商业摄影',
      build() {
        const item = pick([
          '香水瓶', '无线耳机', '机械键盘', '护肤霜罐', '运动鞋', '咖啡杯', '智能手表', '蛋糕甜品'
        ]);
        const material = pick([
          '玻璃折射与高光', '金属拉丝质感', '磨砂塑料与柔和阴影',
          '陶瓷釉面反射', '皮革纹理细节'
        ]);
        const bg = pick([
          '纯色渐变背景', '大理石台面', '极简几何道具', '自然植物点缀场景', '暗调高级灰背景'
        ]);
        const light = pick([
          '三点布光，边缘轮廓清晰', '柔光棚拍，无硬阴影', '侧光强调质感',
          '顶部俯拍平铺构图'
        ]);
        const style = pick([
          '商业广告摄影', '电商主图风格', '杂志静物大片', '极简北欧风'
        ]);
        return `${item} 产品摄影，${material}，${bg}，${light}，${style}，${pick(QUALITY)}`;
      }
    },
    anime: {
      label: '动漫',
      hint: '二次元 / 插画',
      build() {
        const role = pick([
          '双马尾魔法少女', '黑长直冷感少女', '热血少年主角', '猫耳女仆',
          '机甲驾驶员', '和风巫女', '校园系男生', '异世界冒险者'
        ]);
        const action = pick([
          '动态奔跑，衣摆飞扬', '施法姿势，魔法阵发光', '回眸微笑，花瓣飘落',
          '持剑立姿， wind effect', '坐在屋顶看夕阳'
        ]);
        const palette = pick([
          '粉蓝 pastel 配色', '高饱和赛璐璐', '低饱和莫兰迪色',
          '霓虹紫蓝夜景', '暖橙 sunset 色调'
        ]);
        const bg = pick([
          '樱花街道', '星空与流星', '现代教室', '浮空岛屿', '雨夜霓虹 alley'
        ]);
        const style = pick([
          '日系轻小说插画', '动画 key visual', '厚涂二次元', '赛璐璐平涂，清晰线稿'
        ]);
        return `${role}，${action}，${palette}，背景 ${bg}，${style}，${pick(QUALITY)}`;
      }
    }
  };

  function generateInspirationPrompts(type, count) {
    const tpl = TEMPLATES[type] || TEMPLATES.character;
    const n = Math.min(8, Math.max(1, Number(count) || 3));
    const prompts = [];
    const seen = new Set();
    let guard = 0;
    while (prompts.length < n && guard < n * 8) {
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
