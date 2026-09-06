import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = relativePath => readFileSync(join(root, relativePath), 'utf8');

const studioHtml = read('asset-studio.html');
const optionIds = [...studioHtml.matchAll(/<option\s+value="(deepseek[^"]*)"[^>]*>([^<]*)<\/option>/gi)]
  .map(match => ({ id: match[1], label: match[2].trim() }));
assert.deepEqual(optionIds, [
  { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash' },
  { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro' }
]);

const studioChat = `${read('legacy/asset-studio/part-05.js')}\n${read('legacy/asset-studio/part-06.js')}`;
assert(!studioChat.includes('CHAT_COST_HINTS'), 'asset studio must not contain a local chat price table');
assert(!studioChat.includes('按实际 token 计费'), 'asset studio must display the live per-request quote');

const chatRoute = read('server/src/routes/v1/chat.ts');
assert(!chatRoute.includes('isLegacyModel'), 'Flash must not use a legacy direct branch');
assert(!chatRoute.includes('CHAT_API_'), 'public chat must use the shared New API bindings');
assert(/submitChatCompletions[\s\S]*?thinking,\s*reasoningEffort:/.test(chatRoute), 'thinking mode must remain forwarded after catalog routing');

const workerConfig = [
  read('server/src/env.ts'),
  read('server/wrangler.toml'),
  read('server/secrets.ps1')
].join('\n');
for (const retiredBinding of ['CHAT_API_KEY', 'CHAT_API_BASE_URL', 'CHAT_MODEL', 'FISSION_CHAT_MODEL']) {
  assert(!workerConfig.includes(retiredBinding), `retired text binding remains: ${retiredBinding}`);
}

console.log('verify-deepseek-text-models OK');
