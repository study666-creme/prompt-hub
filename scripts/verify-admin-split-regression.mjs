import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const admin = read('admin.html');
const login = read('admin-login.html');
const css = read('styles-admin.css');
const state = read('legacy/admin/part-02.js');

requireTokens('admin.html', admin, [
  'data-admin-page="console"',
  'id="adminApp"',
  'Prompt Hub 运营控制台',
  'admin-tab-icon--overview',
  'admin-logout-btn'
]);

requireTokens('admin-login.html', login, [
  'data-admin-page="login"',
  'id="adminLogin"',
  'id="loginBtn"',
  'Prompt Hub 管理登录',
  'admin-login-shell',
  'admin-login-card'
]);

requireTokens('styles-admin.css', css, [
  '.admin-login-shell',
  '.admin-login-card',
  '.admin-sidebar',
  '.admin-tab-icon--overview',
  '--admin-bg: #f5f5f7',
  'backdrop-filter: blur'
]);

requireTokens('legacy/admin/part-02.js', state, [
  'function adminPageMode()',
  'function adminConsoleHref()',
  'function adminLoginHref()',
  'function redirectAdminTo(href)',
  "if (mode === 'console' && !loggedIn) redirectAdminTo(adminLoginHref());",
  "if (mode === 'login' && loggedIn) redirectAdminTo(adminConsoleHref());"
]);

forbid('admin.html', admin, [
  'id="adminLogin"',
  '📊',
  '👤',
  '🖼',
  '🎫',
  '⚙'
]);

forbid('admin-login.html', login, [
  'id="adminApp"',
  'data-tab="overview"'
]);

console.log('verify-admin-split-regression OK');

function requireTokens(label, text, tokens) {
  const missing = tokens.filter((token) => !text.includes(token));
  if (missing.length) fail(`${label} missing tokens:\n${missing.map((token) => `  - ${token}`).join('\n')}`);
}

function forbid(label, text, tokens) {
  const found = tokens.filter((token) => text.includes(token));
  if (found.length) fail(`${label} contains forbidden tokens: ${found.join(', ')}`);
}

function fail(message) {
  console.error(`verify-admin-split-regression: ${message}`);
  process.exit(1);
}
