/**

 * 后端 API 根地址

 * 优先：api-domain.config.js 里的 CUSTOM_API_HOST（国内可访问）

 * 其次：Pages 默认域名 → workers.dev

 * 本地：api-config.local.js 覆盖

 */

(function () {

  if (window.API_BASE_URL) return;



  var host = (typeof location !== 'undefined' && location.hostname) || '';



  /** 本机优先走本地 Worker，避免 api-domain.config.js 的 CUSTOM_API_HOST 指到生产 → CORS 拦 */

  if (host === 'localhost' || host === '127.0.0.1') {

    window.API_BASE_URL = 'http://127.0.0.1:8787';

    return;

  }



  var custom = String(window.CUSTOM_API_HOST || '').trim();

  if (custom) {

    window.API_BASE_URL =

      'https://' + custom.replace(/^https?:\/\//i, '').replace(/\/$/, '');

    return;

  }



  var prodByHost = {

    'prompt-hubs.com': 'https://api.prompt-hubs.com',

    'www.prompt-hubs.com': 'https://api.prompt-hubs.com',

    'prompt-hub.cn': 'https://api.prompt-hub.cn',

    'www.prompt-hub.cn': 'https://api.prompt-hub.cn',

    'prompt-hub-hub.pages.dev': 'https://api.prompt-hubs.com',

    'prompt-hub-web.pages.dev': 'https://api.prompt-hubs.com'

  };



  if (prodByHost[host]) {

    window.API_BASE_URL = prodByHost[host];

    return;

  }



  if (/\.prompt-hub-hub\.pages\.dev$/i.test(host) || /\.prompt-hub-web\.pages\.dev$/i.test(host)) {

    window.API_BASE_URL = 'https://api.prompt-hubs.com';

    return;

  }



  window.API_BASE_URL = '';

})();



/** 防止误部署的 api-config.local.js 把生产站指到本机 8787 */

(function () {

  var host = (typeof location !== 'undefined' && location.hostname) || '';

  var prod = {

    'prompt-hubs.com': 'https://api.prompt-hubs.com',

    'www.prompt-hubs.com': 'https://api.prompt-hubs.com',

    'prompt-hub.cn': 'https://api.prompt-hub.cn',

    'www.prompt-hub.cn': 'https://api.prompt-hub.cn',

    'prompt-hub-hub.pages.dev': 'https://api.prompt-hubs.com',

    'prompt-hub-web.pages.dev': 'https://api.prompt-hubs.com'

  };

  var expected = prod[host];

  if (!expected && (/\.prompt-hub-hub\.pages\.dev$/i.test(host) || /\.prompt-hub-web\.pages\.dev$/i.test(host))) {

    expected = 'https://api.prompt-hubs.com';

  }

  if (!expected) return;

  var cur = String(window.API_BASE_URL || '').trim();

  if (/127\.0\.0\.1|localhost/i.test(cur)) {

    window.API_BASE_URL = expected;

    console.warn('[PromptHub] 生产环境已忽略本地 API 配置，使用', expected);

  }

})();



/** 与 API 同域反代 Supabase（api-config 在 supabase-config 之后执行，以 API 为准） */

(function () {

  var host = (typeof location !== 'undefined' && location.hostname) || '';

  if (host === 'localhost' || host === '127.0.0.1') return;

  var api = String(window.API_BASE_URL || '').trim().replace(/\/$/, '');

  if (!api || /127\.0\.0\.1|localhost/i.test(api)) return;

  window.SUPABASE_URL = api + '/supabase';

})();


