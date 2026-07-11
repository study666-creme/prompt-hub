/**
 * 生图错误文案、可恢复判定、轮询间隔（与 features-draft 任务状态解耦）
 */
(function (global) {
  'use strict';

  const ACTIVE_POLL_MAX_MS = 5 * 60 * 1000;

  function normalizeImageGenModelId(modelId) {
    const id = String(modelId || '').trim().toLowerCase();
    if (!id) return 'image2';
    const legacy = {
      quanneng2: 'image2',
      'gpt-image-2': 'image2',
      'gpt-image-2-vip': 'image2-pro',
      jimeng: 'lingtu-pro',
      'nano-banana-fast': 'lingtu-fast',
      'nano-banana-2': 'lingtu-2',
      'nano-banana-pro': 'lingtu-pro',
      'nano-banana-pro-vt': 'lingtu-pro',
      'nano-banana-pro-vip': 'lingtu-pro',
      'nano-banana-pro-cl': 'lingtu-pro',
      'nano-banana-2-cl': 'lingtu-2',
      'nano-banana-2-4k-cl': 'lingtu-2',
      'nano-banana': 'lingtu',
      'apimart-gpt-image-2-official-budget': 'image2-hd',
      'apimart-gpt-image-2': 'image2',
      'apimart-seedream-5-lite': 'image2',
      'apimart-gemini-2-5-flash-preview': 'lingtu-fast',
      'apimart-gemini-2-5-flash-official': 'lingtu-fast',
      'apimart-gemini-3-1-flash-preview': 'lingtu-2',
      'apimart-gemini-3-1-flash-official': 'lingtu-2',
      'apimart-gemini-3-pro-preview': 'lingtu-pro',
      'apimart-gemini-3-pro-official': 'lingtu-pro',
      'ithink-gpt-image-2-slow': 'image2',
      'mooko-gpt-image-2-pro': 'image2-pro'
    };
    return legacy[id] || id;
  }

  function normalizeImageGenResolution(res) {
    const r = String(res || '1k').toLowerCase();
    return ['1k', '2k', '4k'].includes(r) ? r : '1k';
  }

  function stringifyGenErrorRaw(errRaw) {
    if (errRaw == null) return '';
    if (typeof errRaw === 'string') return errRaw.trim();
    if (typeof errRaw === 'object') {
      const o = errRaw;
      if (typeof o.message === 'string') return o.message.trim();
      if (o.message != null) return String(o.message).trim();
      if (typeof o.error === 'string') return o.error.trim();
      try {
        return JSON.stringify(o);
      } catch (e) {
        return String(o);
      }
    }
    return String(errRaw).trim();
  }

  function isStaleConfigError(msg) {
    return /积分小数|apply_credit_delta|SQL 编辑器|扣费函数|SERVER_CONFIG|decimal/i.test(String(msg || ''));
  }

  function isSlowGenProviderModel(modelId) {
    const id = normalizeImageGenModelId(modelId);
    return id.startsWith('mooko-') || id.startsWith('ithink-');
  }

  function isLongRunningGenJob(ctx) {
    if (isSlowGenProviderModel(ctx?.model)) return true;
    const res = normalizeImageGenResolution(ctx?.resolution);
    if (res === '2k' || res === '4k') return true;
    const id = normalizeImageGenModelId(ctx?.model);
    if (id.includes('vip') || id.includes('-pro')) return true;
    return false;
  }

  function genActivePollMaxMs(ctx) {
    return isLongRunningGenJob(ctx) ? 15 * 60 * 1000 : 5 * 60 * 1000;
  }

  function genRecoveringDeferGiveUpMs(ctx) {
    return isLongRunningGenJob(ctx) ? 45 * 60 * 1000 : 22 * 60 * 1000;
  }

  function slowGenDeferNote(ctx) {
    return isSlowGenProviderModel(ctx?.model)
      ? '约 2–12 分钟，后台继续等待（请勿重复提交）'
      : isLongRunningGenJob(ctx)
        ? '2K/4K 约 5–15 分钟，后台继续等待（请勿重复提交）'
        : '可能已出图，正在后台恢复（请勿重复提交）';
  }

  function isDefinitiveGenFailure(errRaw, pollData) {
    const s = String(errRaw || pollData?.message || pollData?.errorMessage || '');
    if (/upstream_content_violation|prohibited words or images|prohibited|flagged as containing|违规不返还|violation/i.test(s)) return true;
    if (/content.*policy|safety|moderation|blocked|违规|敏感/i.test(s)) return true;
    if (/insufficient balance|insufficient credits/i.test(s)) return true;
    if (/apikey|invalid.*api.*key|unauthorized/i.test(s)) return true;
    if (/This content may violate|content may violate/i.test(s)) return true;
    return false;
  }

  function isLikelyRecoverableGenFailure(errRaw, ctx, opts = {}) {
    const s = stringifyGenErrorRaw(errRaw);
    if (!s) return opts.confirmedFailed !== true;
    const model = String(ctx?.model || '').toLowerCase();
    if (model.includes('ithink') && /UPSTREAM_FAILED|upstream_failed|502|ThinkAI|无效.*令牌/i.test(s)) {
      return false;
    }
    if (/upstream_content_violation|违规不返还|violation/i.test(s)) return false;
    if (/prohibited words or images|prohibited|flagged as containing/i.test(s)) return false;
    if (isStaleConfigError(s)) return true;
    if (/error code:\s*524|\b524\b|请求失败 \(524\)/i.test(s)) return true;
    if (/debit_failed|upstream_no_image|missing_task_id|upstream_submit/i.test(s)) return true;
    if (/upstream_failed/i.test(s)) {
      const id = normalizeImageGenModelId(ctx?.model);
      if (id.startsWith('apimart-')) return false;
      if (/timeout|524|upstream_timeout|排队/i.test(s)) return isLongRunningGenJob(ctx);
      return isLongRunningGenJob(ctx);
    }
    if (/不存在该模型|model.*not.*exist|GrsAI 未返回任务 ID/i.test(s)) return true;
    if (/upstream_timeout/i.test(s) && isLongRunningGenJob(ctx)) return true;
    if (/NETWORK_ERROR|API_UNREACHABLE|无法连接 api\.prompt-hub|连接.*超时|Failed to fetch/i.test(s)) {
      return true;
    }
    return false;
  }

  function friendlyGenErrorMessage(msg) {
    const s = stringifyGenErrorRaw(msg);
    if (!s || s === '[object Object]') return '生图失败，积分已全额退回';
    if (isStaleConfigError(s)) {
      return '扣费曾异常，正在从服务器恢复已完成任务；若仍未出图请点「重试」';
    }
    if (/登录已过期|请先登录|UNAUTHORIZED/i.test(s)) {
      return '登录状态已失效，请退出后重新登录';
    }
    if (/upstream_auth_failed|无效.*令牌|invalid.*token/i.test(s)) {
      return '生图令牌无效或已过期，请联系站长在 thinkai.tv 重新创建令牌；您的积分已全额退回';
    }
    if (/upstream_submit_not_configured/i.test(s)) {
      return '生图服务未配置，请联系站长；您的积分已全额退回';
    }
    if (/upstream_model_rejected/i.test(s)) {
      return '当前模型暂不可用，请换其他模型；您的积分已全额退回';
    }
    if (/insufficient balance|insufficient credits/i.test(s)) {
      return '生图服务商账户余额不足（不是您的站内积分），请联系站长；您的积分已全额退回';
    }
    if (/apikey|api.key|invalid.*api.*key|无效.*令牌|invalid.*token|unauthorized/i.test(s)) {
      return '生图服务认证失败，请联系站长；您的积分已全额退回';
    }
    if (/error code:\s*524|\b524\b/.test(s)) {
      return '连接超时（524），任务可能已提交；请强刷页面查看是否在生成中';
    }
    if (/upstream_timeout|timeout/i.test(s)) {
      return '生图排队超时（约 12 分钟），积分已全额退回，可点「重试」';
    }
    if (/images\[\]\.image_url is required/i.test(s)) {
      return '参考图格式不兼容，请去掉参考图后重试；积分已全额退回';
    }
    if (/upstream_image_archive_failed|atob\(\)|invalid base64|invalid_data_url/i.test(s)) {
      return '图片入库失败，积分已全额退回，请重试';
    }
    if (/upstream_no_image|no_image/i.test(s)) {
      return '上游未返回图片，积分已全额退回，可点「重试」';
    }
    if (/upstream_submit_not_started/i.test(s)) {
      return '未能连接生图服务，积分已退回，请重试或换其他模型';
    }
    if (/upstream_submit_interrupted/i.test(s)) {
      return '提交被中断，积分已退回；请等 1 分钟后重试，勿重复连点';
    }
    if (/upstream_submit_stale/i.test(s)) {
      return '生图长时间无响应，积分已退回；请稍后再试或换其他模型';
    }
    if (/missing_task_id/i.test(s)) {
      return '任务提交异常，积分已全额退回，请重试';
    }
    if (/upstream_content_violation|prohibited words or images|prohibited|flagged as containing/i.test(s)) {
      return '提示词触发内容审核（含禁用词/图），请改描述后重试；积分已全额退回';
    }
    if (/upstream_content_violation/i.test(s)) {
      return '提示词触发内容审核，积分已全额退回，请调整描述后重试';
    }
    if (/违规不返还|violation.*no.*refund/i.test(s)) {
      return s.includes('违规不返还') ? s : '提示词触发内容审核，该模型违规不返还积分，请调整描述后重试';
    }
    if (/content.*policy|safety|moderation|blocked|违规|敏感/i.test(s)) {
      return '提示词可能触发内容审核，请改描述后重试；积分已全额退回';
    }
    if (/RATE_LIMITED|过于频繁|rate limit|429/i.test(s)) {
      return '提交过快，请稍等几秒再批量生成；积分已全额退回';
    }
    if (/不存在该模型|model.*not.*exist|unknown model|invalid model/i.test(s)) {
      return '模型相关提示，任务可能仍在排队；请强刷页面查看进度';
    }
    if (/GrsAI 未返回任务 ID/i.test(s)) {
      return '可能已接单但响应异常，请强刷页面查看是否在生成中';
    }
    if (s.length > 120) return s.slice(0, 120) + '…';
    return s;
  }

  function genJobPollDelayMs(ctx, attemptIndex) {
    const elapsed = Math.max(0, Date.now() - (ctx?.startedAt || Date.now()));
    const activeMax = genActivePollMaxMs(ctx);
    if (elapsed >= activeMax) return isLongRunningGenJob(ctx) ? 9000 : 7000;
    if (attemptIndex <= 1) return 1500;
    if (attemptIndex <= 4) return 2200;
    if (isLongRunningGenJob(ctx)) {
      if (elapsed < 120_000) return 4000;
      if (elapsed < 360_000) return 6000;
      if (elapsed < 720_000) return 8000;
      return 10000;
    }
    if (elapsed < 60_000) return 3200;
    if (elapsed < 180_000) return 4500;
    return 5500;
  }

  global.ImageGenGenErrors = {
    ACTIVE_POLL_MAX_MS,
    stringifyGenErrorRaw,
    isStaleConfigError,
    isSlowGenProviderModel,
    isLongRunningGenJob,
    genActivePollMaxMs,
    genRecoveringDeferGiveUpMs,
    slowGenDeferNote,
    isDefinitiveGenFailure,
    isLikelyRecoverableGenFailure,
    friendlyGenErrorMessage,
    genJobPollDelayMs,
    normalizeImageGenModelId,
    normalizeImageGenResolution
  };
})(typeof window !== 'undefined' ? window : globalThis);
