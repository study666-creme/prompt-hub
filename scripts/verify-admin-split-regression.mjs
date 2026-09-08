/* Verifies the admin console module graph: every view exports the contract
 * (title/init/load), admin.html has a panel for each view, the login page and
 * admin.js point at the module entry, and core admin session state survived. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const admin = read('admin.html');
const login = read('admin-login.html');
const css = read('styles-admin.css');
const adminJs = read('admin.js');
const mainJs = read('admin/main.js');
const apiJs = read('admin/modules/api.js');

const views = [
  'overview', 'users', 'orders', 'ledger', 'audit', 'announcements',
  'cards', 'community', 'codes', 'models', 'canvas', 'video-catalog'
];

requireTokens('admin.html', admin, [
  'data-admin-page="console"',
  'id="adminApp"',
  'Prompt Hub 运营控制台',
  'admin-logout-btn',
  'admin/main.js',
  'id="adminNav"',
  'id="canvasVideoModelBody"',
  'id="canvasModelStatsBody"',
  'id="canvasErrorLogsBody"'
]);

for (const name of views) {
  const panelKey = name.replace(/-(\w)/g, (m, ch) => ch.toUpperCase());
    requireTokens('admin.html', admin, [`id="panel-${panelKey}"`]);
  const view = read(`admin/views/${name}.js`);
  requireTokens(`admin/views/${name}.js`, view, [
    'export const title = [',
    'export function init(',
    'export function load('
  ]);
}

requireTokens('admin-login.html', login, [
  'data-admin-page="login"',
  'id="adminLogin"',
  'id="loginBtn"',
  'Prompt Hub 管理登录',
  'admin-login-shell',
  'admin-login-card',
  'admin/main.js'
]);

requireTokens('admin.js', adminJs, [
  '__PROMPT_HUB_ADMIN_MODULE__',
  'admin/main.js'
]);

requireTokens('admin/main.js', mainJs, [
  'function showApp(loggedIn)',
  'admin-login.html',
  'hashchange',
  'validateStoredSession'
]);

requireTokens('admin/modules/api.js', apiJs, [
  'export async function adminFetch(',
  'export function friendlyFetchError(',
  'export function resolveApiBase(',
  'ph_admin_session_v1'
]);

requireTokens('styles-admin.css', css, [
  '.admin-login-shell',
  '.admin-login-card',
  '.admin-sidebar',
  '.admin-tab-icon--overview',
  '.admin-tab-icon--orders',
  '.admin-tab-icon--ledger',
  '.admin-tab-icon--audit',
  '.admin-btn--danger'
]);

forbid('admin.html', admin, [
  'id="adminLogin"',
  'legacy/admin',
  '📊',
  '👤',
  '🖼',
  '🎫',
  '⚙'
]);

forbid('admin-login.html', login, [
  'id="adminApp"',
  'data-tab="overview"',
  'legacy/admin'
]);

console.log('verify-admin-split-regression OK: 10 views + module graph + panels');

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
