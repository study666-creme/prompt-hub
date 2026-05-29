/**
 * 后端 API 根地址
 * 优先：api-domain.config.js 里的 CUSTOM_API_HOST（国内可访问）
 * 其次：Pages 默认域名 → workers.dev
 * 本地：api-config.local.js 覆盖
 */
(function () {
  if (window.API_BASE_URL) return;

  var custom = String(window.CUSTOM_API_HOST || '').trim();
  if (custom) {
    window.API_BASE_URL =
      'https://' + custom.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    return;
  }

  var host = (typeof location !== 'undefined' && location.hostname) || '';
  var prodByHost = {
    'prompt-hub.cn': 'https://api.prompt-hub.cn',
    'www.prompt-hub.cn': 'https://api.prompt-hub.cn',
    'prompt-hub-hub.pages.dev': 'https://api.prompt-hub.cn',
    'prompt-hub-web.pages.dev': 'https://api.prompt-hub.cn'
  };

  if (prodByHost[host]) {
    window.API_BASE_URL = prodByHost[host];
    return;
  }

  if (host === 'localhost' || host === '127.0.0.1') {
    window.API_BASE_URL = 'http://127.0.0.1:8787';
    return;
  }

  if (
    /\.prompt-hub-hub\.pages\.dev$/i.test(host) ||
    /\.prompt-hub-web\.pages\.dev$/i.test(host)
  ) {
    window.API_BASE_URL = 'https://api.prompt-hub.cn';
    return;
  }

  window.API_BASE_URL = '';
})();

/** 防止误部署的 api-config.local.js 把生产站指到本机 8787 */
(function () {
  var host = (typeof location !== 'undefined' && location.hostname) || '';
  var prod = {
    'prompt-hub.cn': 'https://api.prompt-hub.cn',
    'www.prompt-hub.cn': 'https://api.prompt-hub.cn',
    'prompt-hub-hub.pages.dev': 'https://api.prompt-hub.cn',
    'prompt-hub-web.pages.dev': 'https://api.prompt-hub.cn'
  };
  var expected = prod[host];
  if (!expected) return;
  var cur = String(window.API_BASE_URL || '').trim();
  if (/127\.0\.0\.1|localhost/i.test(cur)) {
    window.API_BASE_URL = expected;
    console.warn('[PromptHub] 生产环境已忽略本地 API 配置，使用', expected);
  }
})();
