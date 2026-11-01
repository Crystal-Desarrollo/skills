import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('monthly and manual proposals synchronize catalog and snapshots without executing upstream content', async () => {
  const workflow = await readFile(new URL('../.github/workflows/catalog-updates.yml', import.meta.url), 'utf8');
  assert.match(workflow, /cron: '23 9 1 \* \*'/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /run: node scripts\/sync-skills.mjs --update/);
  assert.match(workflow, /run: node scripts\/sync-skills.mjs --check/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /add-paths: \|\s+catalog.json\s+skills\/vendor\//);
  assert.match(workflow, /contents: write/); assert.match(workflow, /pull-requests: write/);
  assert.doesNotMatch(workflow, /npm install|pnpm install|auto-merge|pull_request_target|run:.*skills\/vendor/);
  for (const match of workflow.matchAll(/uses: (\S+)/g)) assert.match(match[1], /@[a-f0-9]{40}$/);
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.scripts['skills:sync'], 'node scripts/sync-skills.mjs');
  assert.ok(pkg.scripts.test.includes('sync-workflow.test.mjs'));
});
