      return `〔${label}〕${line}`;
    }).filter(Boolean);

    const weave = shuffle(essenceTagged);
    const anchorType = rotated[variant % rotated.length];
    const anchor = clipPromptLead(CONTENT_TEMPLATES[anchorType].build(ctx), 3);

    return combineParts(
      [fusionHead, ...weave, pick(FUSION_GLUE), anchor, pickMaybe(TWIST, 0.55), ctx?.tail?.() ],
      { mode: 'flat' }
    );
  }

  function buildViral(ctx) {
    const family = ctx?.family || 'neutral';
    if (family === 'anime') {
      return combineParts([
        pick(WORDS.viralHook),
        pick(WORDS.animeRole),
        pick(WORDS.animeAction),
        pick(WORDS.viralLook),
        pick(WORDS.animePalette),
        pick(WORDS.animeLight),
        pickMaybe(WORDS.animeFx, 0.5),
        pick(WORDS.animeStyle),
        ctx?.tail?.()
      ], { keepFirst: true });
    }
    return combineParts([
      pick(WORDS.viralHook),
      pick(WORDS.viralLook),
      pick(WORDS.sceneColor),
      pick(lightPoolForCharacter(family)),
      pickMaybe(WORDS.animeFx, family === 'anime' ? 0.35 : 0),
      ctx?.tail?.()
    ], { keepFirst: true });
  }

  function buildEpic(ctx) {
    return combineParts([
      pick(WORDS.epicScale),
      pick(WORDS.epicArchitecture),
      pick(WORDS.epicSubject),
      pick(WORDS.epicTension),
      pick(WORDS.sceneColor),
      pick(WORDS.sceneComp),
      ctx?.tail?.()
    ]);
  }

  function buildImpact(ctx) {
    const family = ctx?.family || 'neutral';
    const recipe = pick([1, 2, 3, 4, 5]);
    let parts;
    if (recipe === 1) {
      parts = [
        pick(WORDS.impactHook),
        pick(WORDS.impactComp),
        pick(WORDS.impactPose),
        pick(WORDS.impactScene),
        pick(WORDS.impactStyle),
        pick(WORDS.sceneColor),
        pick(lightPoolForCharacter(family))
      ];
    } else if (recipe === 2) {
      parts = [
        pick(WORDS.impactScene),
        pick(WORDS.impactComp),
        pick(WORDS.characterSubject),
        pick(WORDS.impactPose),
        pick(WORDS.impactHook),
        pick(WORDS.impactStyle),
        ctx?.tail?.()
      ];
    } else if (recipe === 3) {
      parts = [
        pick(WORDS.impactStyle),
        pick(WORDS.epicScale),
        pick(WORDS.impactScene),
        pick(WORDS.impactComp),
        pick(WORDS.epicTension),
        pick(WORDS.sceneColor),
        ctx?.tail?.()
      ];
    } else if (recipe === 4) {
      parts = [
        pick(WORDS.impactHook),
        pick(WORDS.guofengRole),
        pick(WORDS.impactPose),
        pick(WORDS.impactScene),
        pick(WORDS.impactComp),
        pick(WORDS.impactStyle),
        ctx?.tail?.()
      ];
    } else {
      parts = [
        pick(WORDS.cyberSubject),
        pick(WORDS.impactPose),
        pick(WORDS.impactScene),
        pick(WORDS.impactComp),
        pick(WORDS.impactHook),
        pick(WORDS.cyberFx),
        ctx?.tail?.()
      ];
    }
    return combineParts(parts, { keepFirst: recipe <= 2 });
  }

  function buildStylized(ctx) {
    const family = ctx?.family || 'neutral';
    const recipe = pick([1, 2, 3, 4]);
    let parts;
    if (recipe === 1) {
      parts = [
        pick(WORDS.stylizedMood),
        pick(WORDS.stylizedSubject),
        pick(WORDS.stylizedVisual),
        pick(WORDS.stylizedPalette),
        pick(WORDS.stylizedCraft),
        pickMaybe(lightPoolForCharacter(family), 0.5),
        ctx?.tail?.()
      ];
    } else if (recipe === 2) {
      parts = [
        pick(WORDS.stylizedCraft),
        pick(WORDS.stylizedSubject),
        pick(WORDS.stylizedVisual),
        pick(WORDS.stylizedMood),
        pick(WORDS.stylizedPalette),
        pick(WORDS.impactComp),
        ctx?.tail?.()
      ];
    } else if (recipe === 3) {
      parts = [
        pick(WORDS.stylizedVisual),
        pick(WORDS.epicArchitecture),
        pick(WORDS.stylizedMood),
        pick(WORDS.stylizedPalette),
        pick(WORDS.stylizedCraft),
        '尺度夸张但细节精致',
        ctx?.tail?.()
      ];
    } else {
      parts = [
        pick(WORDS.stylizedMood),
        pick(WORDS.glamourSubjectAnime),
        pick(WORDS.stylizedVisual),
        pick(WORDS.stylizedPalette),
        '衣着完整，猎奇气质但可公开发布',
        pick(WORDS.stylizedCraft),
        ctx?.tail?.()
      ];
    }
    return combineParts(parts, { keepFirst: true });
  }

  function buildGuofeng(ctx) {
    const family = ctx?.family || 'neutral';
    return combineParts([
      pick(WORDS.guofengRole),
      pick(WORDS.characterOutfit),
      pick(WORDS.guofengScene),
      pick(WORDS.guofengMood),
      pick(lightPoolForCharacter(family)),
      ctx?.tail?.()
    ], { keepFirst: true });
  }

  function buildCyber(ctx) {
    const family = ctx?.family || 'neutral';
    return combineParts([
      pick(WORDS.cyberSubject),
      pick(WORDS.cyberScene),
      pick(WORDS.cyberFx),
      pick(WORDS.sceneColor),
      pick(lightPoolForCharacter(family)),
      ctx?.tail?.()
    ], { keepFirst: true });
  }

  function buildCover916(ctx) {
    const family = ctx?.family || 'neutral';
    return combineParts([
      pick(WORDS.cover916Hook),
      pick(WORDS.cover916Layout),
      pick(WORDS.viralLook),
      pick(WORDS.sceneColor),
      pick(lightPoolForCharacter(family)),
      ctx?.tail?.()
    ], { keepFirst: true });
  }

  function buildGlamour(ctx) {
    const family = ctx?.family || 'neutral';
    const subject = pick(glamourSubjectPool(family));
    const bodyLine = pick(WORDS.glamourBodyFemale);
    const outfit = pick(WORDS.glamourOutfit);
    const pose = pick([...WORDS.glamourPose, ...WORDS.glamourPoseArt]);
    const gaze = pick(WORDS.glamourGaze);
    const emotion = pick(WORDS.glamourEmotion);
    const expression = pick(WORDS.glamourExpression);
    const atmosphere = pick(WORDS.glamourAtmosphere);
    const mood = pick(WORDS.glamourMood);
    const light = family === 'photo'
      ? pick(WORDS.glamourLight)
      : pick(lightPoolForCharacter(family));
    const prop = pickMaybe(WORDS.glamourProp, 0.65);
    const detail = pickMaybe(WORDS.glamourDetail, 0.6);
    const vibe = pickMaybe(WORDS.glamourVibe, 0.5);
    const genderTag = '女性主体';
    const safe = '衣着完整、泳装/礼服/运动装规范，社区可发，性感但不露点';
    const fantasyTag = pickMaybe(['不写实身材比例', '漫画化夸张曲线', 'SSR 卡面级比例'], 0.55);
    const recipe = pick([1, 2, 3, 4, 5]);
    let parts;
    if (recipe === 1) {
      parts = [subject, bodyLine, outfit, pose, gaze, emotion, expression, atmosphere, mood, light, prop, detail, vibe, fantasyTag, genderTag, safe, ctx?.tail?.()];
    } else if (recipe === 2) {
      parts = [atmosphere, subject, bodyLine, emotion, gaze, expression, outfit, mood, light, pose, detail, prop, vibe, fantasyTag, genderTag, safe, ctx?.tail?.()];
    } else if (recipe === 3) {
      parts = [subject, bodyLine, gaze, emotion, detail, outfit, atmosphere, pose, expression, mood, light, vibe, fantasyTag, genderTag, safe, ctx?.tail?.()];
    } else if (recipe === 4) {
      parts = [mood, subject, bodyLine, atmosphere, emotion, gaze, light, outfit, pose, expression, prop, detail, fantasyTag, genderTag, safe, ctx?.tail?.()];
    } else {
      parts = [emotion, gaze, subject, bodyLine, pose, expression, outfit, atmosphere, mood, light, detail, vibe, fantasyTag, genderTag, safe, ctx?.tail?.()];
    }
    return combineParts(parts, { keepFirst: recipe !== 4 });
  }

  function buildMalePower(ctx) {
    const family = ctx?.family || 'neutral';
    const subject = pick(malePowerSubjectPool(family));
    const bodyLine = pick(WORDS.glamourBodyMale);
    const outfit = pick(WORDS.glamourOutfitMale);
    const pose = pick(WORDS.malePowerPose);
    const atmosphere = pick(WORDS.malePowerAtmosphere);
    const mood = pick(WORDS.malePowerMood);
    const light = family === 'photo'
      ? pick(WORDS.glamourLight)
      : pick(lightPoolForCharacter(family));
    const detail = pickMaybe(WORDS.malePowerDetail, 0.65);
    const vibe = pickMaybe(WORDS.malePowerVibe, 0.5);
    const prop = pickMaybe(WORDS.glamourProp, 0.45);
    const genderTag = '男性主体';
    const safe = '衣着完整、泳裤/运动装/西装规范，社区可发，力量感非裸露';
    return combineParts(
      [subject, bodyLine, outfit, pose, mood, atmosphere, light, detail, prop, vibe, genderTag, safe, ctx?.tail?.()],
      { keepFirst: true }
    );
  }

  function buildAvantFrame(ctx) {
    const family = ctx?.family || 'neutral';
    const recipe = pick([1, 2, 3]);
    let parts;
    if (recipe === 1) {
      parts = [
        pick(WORDS.avantFrameComp),
        pick(WORDS.avantFrameSubject),
        pick(WORDS.avantFrameMood),
        pick(WORDS.avantFrameLight),
        pick(WORDS.sceneColor),
        pick(lightPoolForCharacter(family)),
        ctx?.tail?.()
      ];
    } else if (recipe === 2) {
      parts = [
        pick(WORDS.avantFrameMood),
        pick(WORDS.avantFrameComp),
        pick(WORDS.characterSubject),
        pick(WORDS.avantFrameLight),
        pick(WORDS.avantFrameSubject),
        pickMaybe(TWIST, 0.5),
        ctx?.tail?.()
      ];
    } else {
      parts = [
        pick(WORDS.avantFrameComp),
        pick(WORDS.avantFrameComp),
        pick(WORDS.avantFrameSubject),
        pick(WORDS.avantFrameMood),
        pick(WORDS.avantFrameLight),
        '构图优先，瞬时冲击力，艺术感',
        ctx?.tail?.()
      ];
    }
    return combineParts(parts, { keepFirst: true });
  }

  function buildDoujin(ctx) {
    const family = ctx?.family || 'anime';
    const effectiveFamily = family === 'neutral' || family === 'photo' ? 'anime' : family;
    const tailFn = () => premiumTail(effectiveFamily === 'photo' ? 'anime' : effectiveFamily);
    const recipe = pick([1, 2, 3]);
    let parts;
    if (recipe === 1) {
      parts = [
        pick(WORDS.doujinArchetype),
        pick(WORDS.doujinAction),
        pick(WORDS.doujinScene),
        pick(WORDS.doujinMood),
        pick(WORDS.animePalette),
        pickMaybe(WORDS.animeFx, 0.7),
        pick(WORDS.animeStyle)
      ];
    } else if (recipe === 2) {
      parts = [
        pick(WORDS.animeRole),
        pick(WORDS.animeAction),
        pick(WORDS.animeScene),
        pick(WORDS.animeMood),
        pick(WORDS.animeLight),
        pick(WORDS.animeStyle),
        pickMaybe(WORDS.animeFx, 0.55)
      ];
    } else {
      parts = [
        pick(WORDS.doujinScene),
        pick(WORDS.animeRole),
        pick(WORDS.doujinAction),
        pick(WORDS.animePalette),
        pick(WORDS.animeStyle),
        pick(WORDS.animeLight),
        pickMaybe(WORDS.animeFx, 0.6)
      ];
    }
    return combineParts([
      ...parts,
      '同人向随机动漫角色插画，原创设定，不出现具体 IP 角色名或标志造型',
      tailFn()
    ], { keepFirst: true });
  }

  function buildAnimeIllust(ctx) {
    const recipe = pick([1, 2, 3, 4, 5]);
    let parts;
    if (recipe === 1) {
      parts = [
        pick(WORDS.animeRole),
        pick(WORDS.animeAction),
        pick(WORDS.animeScene),
        pick(WORDS.animeMood),
        pick(WORDS.animeStyle),
        pick(WORDS.animeLight),
        pickMaybe(WORDS.animeFx, 0.6)
      ];
    } else if (recipe === 2) {
      parts = [
        pick(WORDS.animeScene),
        pick(WORDS.animeRole),
        pick(WORDS.animeAction),
        pick(WORDS.animePalette),
        pick(WORDS.animeStyle),
        pick(WORDS.animeLight),
        pickMaybe(TWIST, 0.4)
      ];
    } else if (recipe === 3) {
      parts = [
        pick(WORDS.doujinArchetype),
        pick(WORDS.animeAction),
        pick(WORDS.animeMood),
        pick(WORDS.animeStyle),
        pick(WORDS.animeLight),
        pick(WORDS.animePalette),
        pickMaybe(WORDS.animeFx, 0.55)
      ];
    } else if (recipe === 4) {
      parts = [
        pick(WORDS.animeRole),
        pick(WORDS.characterFace),
        pick(WORDS.characterOutfit),
        pick(WORDS.animeAction),
        pick(WORDS.animeStyle),
        pick(WORDS.animeLight),
        pick(WORDS.animeMood)
      ];
    } else {
      parts = [
        pick(WORDS.animeMood),
        pick(WORDS.animeRole),
        pick(WORDS.animeScene),
        pick(WORDS.animeAction),
        pick(WORDS.animeStyle),
        pick(WORDS.animePalette),
        pick(WORDS.animeLight),
        pickMaybe(WORDS.animeFx, 0.5)
      ];
    }
    return combineParts([...parts, ctx?.tail?.()], { keepFirst: true });
  }

  function buildOriginalCharacter(ctx) {
    const family = ctx?.family || 'neutral';
    const format = pick(WORDS.ocFormat);
    const recipe = pick([1, 2, 3]);
    const design = pick(WORDS.ocDesign);
    let parts;
    if (recipe === 1) {
      parts = [
        format,
        design,
        pick(WORDS.ocIdentity),
        pick(WORDS.ocAnchor),
        pick(WORDS.ocHumanCore),
        pick(WORDS.ocDistinctive),
        pick(WORDS.ocWeapon),
        pick(WORDS.ocCombat),
        pick(WORDS.ocCostume),
        pick(WORDS.ocPalette),
        pick(WORDS.ocStoryBeat),
        pick(WORDS.ocMemorable),
        pick(WORDS.ocPresence),
        pick(WORDS.ocLight),
        pickMaybe(lightPoolForCharacter(family), 0.35),
        '全原创主角级角色设计，非设定表非三视图，非任何现有 IP，强调设计感与故事感',
        ctx?.tail?.()
      ];
    } else if (recipe === 2) {
      parts = [
        pick(WORDS.ocHumanCore),
        pick(WORDS.ocIdentity),
        pick(WORDS.ocStoryBeat),
        design,
        pick(WORDS.ocAnchor),
        pick(WORDS.ocWeapon),
        pick(WORDS.ocCostume),
        pick(WORDS.ocDistinctive),
        pick(WORDS.ocMemorable),
        format,
        pick(WORDS.ocPalette),
        pick(WORDS.ocPresence),
        pick(WORDS.ocLight),
        '主角级原创人设：一眼非普通人，服饰武器皆有设计逻辑，可公开发布',
        ctx?.tail?.()
      ];
    } else {
      parts = [
        format,
        pick(WORDS.ocMemorable),
        pick(WORDS.ocIdentity),
        pick(WORDS.ocCombat),
        pick(WORDS.ocWeapon),
        pick(WORDS.ocCostume),
        design,
        pick(WORDS.ocAnchor),
        pick(WORDS.ocHumanCore),
        pick(WORDS.ocStoryBeat),
        pick(WORDS.ocDistinctive),
        pick(WORDS.ocPresence),
        pick(WORDS.ocPalette),
        pick(WORDS.ocLight),
        '原创主角：造型/武器/气质一体，让人想知道他的故事',
        ctx?.tail?.()
      ];
    }
    return combineParts(parts, { keepFirst: true });
  }

  function buildCoolMecha(ctx) {
    const family = ctx?.family || 'neutral';
    const recipe = pick([1, 2, 3]);
    let parts;
    if (recipe === 1) {
      parts = [
        pick(WORDS.mechaSubject),
        pick(WORDS.mechaPose),
        pick(WORDS.mechaVfx),
        pick(WORDS.mechaScene),
        pick(WORDS.mechaMood),
        pick(WORDS.sceneColor),
        pick(lightPoolForCharacter(family)),
        ctx?.tail?.()
      ];
    } else if (recipe === 2) {
      parts = [
        pick(WORDS.mechaMood),
        pick(WORDS.mechaSubject),
        pick(WORDS.mechaVfx),
        pick(WORDS.mechaPose),
        pick(WORDS.mechaScene),
        pickMaybe(WORDS.cyberFx, 0.45),
        ctx?.tail?.()
      ];
    } else {
      parts = [
        pick(WORDS.mechaScene),
        pick(WORDS.mechaSubject),
        pick(WORDS.mechaSubject),
        pick(WORDS.mechaPose),
        pick(WORDS.mechaVfx),
        pick(WORDS.mechaMood),
        pick(WORDS.epicTension),
        ctx?.tail?.()
      ];
    }
    return combineParts(parts, { keepFirst: true });
  }

  function buildMegaPerspective(ctx) {
    const family = ctx?.family || 'neutral';
    const recipe = pick([1, 2, 3, 4]);
    let parts;
    if (recipe === 1) {
      parts = [
        pick(WORDS.megaPersComp),
        pick(WORDS.megaPersComp),
        pick(WORDS.megaPersSubject),
        pick(WORDS.megaPersMood),
        pick(WORDS.megaPersLight),
        pick(WORDS.sceneColor),
        ctx?.tail?.()
      ];
    } else if (recipe === 2) {
      parts = [
        pick(WORDS.megaPersMood),
        pick(WORDS.megaPersSubject),
        pick(WORDS.megaPersComp),
        pick(WORDS.epicScale),
        pick(WORDS.megaPersLight),
        pick(lightPoolForCharacter(family)),
        ctx?.tail?.()
