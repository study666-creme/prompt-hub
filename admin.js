/* __PROMPT_HUB_ADMIN_MODULE__ admin.js
 * The admin console now lives in admin/main.js as native ES modules.
 * This shim only exists so old bookmarks / cached HTML pointing at
 * admin.js keep working: it forwards to the module entry.
 */
(function () {
  'use strict';
  if (document.querySelector('script[src*="admin/main.js"]')) return;
  var s = document.createElement('script');
  s.type = 'module';
  s.src = 'admin/main.js?v=' + (window.__ADMIN_BUILD__ || Date.now());
  document.head.appendChild(s);
})();
