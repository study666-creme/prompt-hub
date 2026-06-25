/**
 * 部署前：wireImageGenJobRunner 里传给 ImageGenJobRunner.init 的依赖
 * 不得裸引用仅存在于 job-runner 导出的函数名（须 jr() 薄代理或箭头懒引用）。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = readFileSync(join(root, 'features-draft.js'), 'utf8');

const wireStart = code.indexOf('function wireImageGenJobRunner()');
if (wireStart < 0) {
  console.error('audit-features-draft-wire FAIL: wireImageGenJobRunner not found');
  process.exit(1);
}
const initStart = code.indexOf('ImageGenJobRunner.init({', wireStart);
const initEnd = code.indexOf('});', initStart);
const initBlock = code.slice(initStart, initEnd);

/** 实现已迁入 imagegen-job-runner.js，features-draft 侧须 jr() 或 (...a) => jr(...) */
const jobRunnerExports = [
  'findBestApiJobForPrompt',
  'prunePendingJobsWithWarehouseCards',
  'tryRecoverPendingJobDirect',
  'needsApiImageRecovery',
  'pendingPromptsMatch',
  'resumePendingGenerationJobs',
  'clearSessionGenJob',
  'getSessionGenJobIds',
  'trackSessionGenJob',
  'scheduleGenJobsSync',
  'deferPendingJobRecovery'
];

const fnDef = new Set(
  [...code.matchAll(/(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)\s*\(/g)].map((m) => m[1])
);

const violations = [];
for (const name of jobRunnerExports) {
  const bareRe = new RegExp(`^\\s+${name}\\s*,?$`, 'm');
  if (bareRe.test(initBlock) && !fnDef.has(name)) {
    violations.push(`${name} (bare reference in wireImageGenJobRunner)`);
  }
}

if (violations.length) {
  console.error('audit-features-draft-wire FAIL:\n -', violations.join('\n - '));
  process.exit(1);
}

console.log('audit-features-draft-wire OK:', jobRunnerExports.length, 'checks');
