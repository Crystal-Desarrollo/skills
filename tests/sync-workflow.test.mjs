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
  assert.match(workflow, /\n\s+\.claude-plugin\/marketplace.json/);
  assert.match(workflow, /contents: write/); assert.match(workflow, /pull-requests: write/);
  assert.doesNotMatch(workflow, /npm install|pnpm install|auto-merge|pull_request_target|run:.*skills\/vendor/);
  for (const match of workflow.matchAll(/uses: (\S+)/g)) assert.match(match[1], /@[a-f0-9]{40}$/);
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.scripts['skills:sync'], 'node scripts/sync-skills.mjs');
  assert.ok(pkg.scripts.test.includes('sync-workflow.test.mjs'));
});

test('Matt selection matches his published plugin, excludes Other, and all installed skills have author groups', async () => {
  const root = new URL('../', import.meta.url);
  const catalog = JSON.parse(await readFile(new URL('catalog.json', root)));
  const matt = catalog.sources.find((source) => source.id === 'mattpocock/skills');
  const expected = 'ask-matt diagnosing-bugs grill-with-docs triage improve-codebase-architecture setup-matt-pocock-skills tdd to-spec to-tickets wayfinder implement implement-spec prototype research domain-modeling codebase-design code-review pr retro wizard grill-me grilling handoff teach to-questionnaire wait-what writing-for-agents'.split(' ').sort();
  assert.deepEqual(matt.skills.map((skill) => skill.name).sort(), expected);
  const manifest = JSON.parse(await readFile(new URL('skills/vendor/_manifest.json', root)));
  const marketplace = JSON.parse(await readFile(new URL('.claude-plugin/marketplace.json', root)));
  assert.deepEqual(marketplace.plugins.map((plugin) => plugin.name), ['antfu', 'crystal-desarrollo', 'kaankiziltug', 'matt-pocock', 'nextlevelbuilder', 'nutlope', 'pbakaus', 'shadcn', 'vercel-labs', 'wshobson']);
  const all = marketplace.plugins.flatMap((plugin) => plugin.skills);
  assert.equal(all.length, 49); assert.equal(new Set(all).size, 49);
  for (const skill of manifest.skills) assert.ok(all.includes(`./skills/vendor/${skill.target}`));
  assert.ok(all.includes('./skills/shadcn-audit'));
  for (const skill of manifest.skills.filter((entry) => entry.source === 'mattpocock/skills')) assert.match(skill.sourcePath, /^skills\/(engineering|productivity)\//);
});

test('frontend additions have fixed provenance and leave external and excluded skills out', async () => {
  const root = new URL('../', import.meta.url);
  const catalog = JSON.parse(await readFile(new URL('catalog.json', root)));
  const additions = ['nutlope/hallmark', 'pbakaus/impeccable', 'nextlevelbuilder/ui-ux-pro-max-skill', 'kaankiziltug/logo-design-skill'];
  const names = [];
  for (const id of additions) {
    const source = catalog.sources.find((entry) => entry.id === id);
    assert.match(source.revision, /^[a-f0-9]{40}$/);
    assert.ok(['MIT', 'Apache-2.0'].includes(source.license));
    assert.ok(source.licenseUrl.includes(`/blob/${source.revision}/${source.licensePath}`));
    names.push(...source.skills.map((skill) => skill.name));
  }
  assert.deepEqual(names.sort(), ['hallmark', 'impeccable', 'logo-design', 'ui-ux-pro-max']);
  const all = catalog.sources.flatMap((source) => source.skills.map((skill) => skill.name));
  for (const name of ['ui-taste', 'unslop', 'playwright-cli']) assert.ok(!all.includes(name));
  const impeccable = catalog.sources.find((source) => source.id === 'pbakaus/impeccable');
  assert.equal(impeccable.skills[0].path, '.agent/skills/impeccable');
  assert.deepEqual(impeccable.noticePaths, ['NOTICE.md']);
  const guide = await readFile(new URL('docs/frontend-skills.md', root), 'utf8');
  assert.ok(guide.includes('pnpm dlx skills add https://uizze.sh --skill ui-taste --agent opencode'));
});
