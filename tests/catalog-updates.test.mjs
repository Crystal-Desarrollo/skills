import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../scripts/catalog-updates.mjs';

const sha = (char) => char.repeat(40);
const catalog = (extra = {}) => ({ schemaVersion: 1, custom: { keep: true }, sources: [{ id: 'vendor', source: 'acme/skills', revision: sha('a'), license: 'MIT', licenseUrl: 'https://raw.githubusercontent.com/acme/skills/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/LICENSE', skills: [{ name: 'one', description: 'Keep me' }], ...extra }] });
function response(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }
function fetchFor({ commit = sha('b'), branch = sha('b'), license = 'MIT\n', status = 200 } = {}) {
  return async (url) => {
    if (url.includes('/commits/')) return response({ sha: commit }, status);
    if (url.includes('/license?')) return response({ path: 'LICENSE', license: { spdx_id: 'MIT' } }, status);
    if (url.includes('/repos/')) return response({ default_branch: 'main' }, status);
    throw new Error(`Unexpected URL ${url}`);
  };
}
async function fixture(t, value = catalog()) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'catalog-updates-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'catalog.json');
  await writeFile(file, JSON.stringify(value, null, 2) + '\n');
  return { file, original: await readFile(file, 'utf8') };
}
async function invoke(file, args, fetchImpl) {
  let stdout = '', stderr = '';
  const code = await runCli(args, { catalogPath: file, fetchImpl, stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } });
  return { code, stdout, stderr };
}

test('check reports candidate without changing bytes; write pins revision and license URL', async (t) => {
  const { file, original } = await fixture(t);
  const checked = await invoke(file, ['--check'], fetchFor());
  assert.equal(checked.code, 0); assert.match(checked.stdout, /acme\/skills/); assert.equal(checked.stderr, '');
  assert.equal(await readFile(file, 'utf8'), original);
  const written = await invoke(file, ['--write'], fetchFor());
  assert.equal(written.code, 0); assert.match(written.stdout, /aaaaaaaa.*bbbbbbbb/s); assert.equal(written.stderr, '');
  const result = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(result.sources[0].revision, sha('b')); assert.match(result.sources[0].licenseUrl, new RegExp(sha('b')));
  assert.deepEqual(result.sources[0].skills, catalog().sources[0].skills); assert.deepEqual(result.custom, { keep: true });
});

test('unchanged write does not rewrite catalog', async (t) => {
  const value = catalog({ revision: sha('b'), licenseUrl: `https://raw.githubusercontent.com/acme/skills/${sha('b')}/LICENSE` });
  const { file, original } = await fixture(t, value);
  const result = await invoke(file, ['--write'], fetchFor());
  assert.equal(result.code, 0); assert.match(result.stdout, /no updates/i); assert.equal(result.stderr, ''); assert.equal(await readFile(file, 'utf8'), original);
});

test('remote failure preserves exact original bytes and reports failure', async (t) => {
  const { file, original } = await fixture(t);
  const result = await invoke(file, ['--write'], fetchFor({ status: 403 }));
  assert.equal(result.code, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /403/); assert.equal(await readFile(file, 'utf8'), original);
});

test('license changes fail closed and preserve the catalog', async (t) => {
  const { file, original } = await fixture(t);
  const fetchImpl = async (url) => {
    if (url.includes('/commits/')) return response({ sha: sha('b') });
    if (url.includes('/license?')) return response({ path: 'LICENSE', license: { spdx_id: 'Apache-2.0' } });
    return response({ default_branch: 'main' });
  };
  const result = await invoke(file, ['--write'], fetchImpl);
  assert.equal(result.code, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /License changed from MIT to Apache-2\.0/);
  assert.equal(await readFile(file, 'utf8'), original);
});

test('disabled sources are reported and never fetched or enabled', async (t) => {
  const value = { schemaVersion: 1, sources: [{ id: 'unverified', source: 'acme/old', revision: null, license: null, licenseUrl: null, skills: [{ name: 'x' }], disabledReason: 'Not verified' }] };
  const { file, original } = await fixture(t, value);
  const result = await invoke(file, ['--check'], async () => { throw new Error('must not fetch'); });
  assert.equal(result.code, 0); assert.match(result.stdout, /unverified.*disabled/i); assert.equal(result.stderr, ''); assert.equal(await readFile(file, 'utf8'), original);
});

test('company catalog source IDs and pinned disabled sources remain compatible', async (t) => {
  const enabled = catalog({ id: 'acme/skills', sourceNote: 'Keep this metadata' }).sources[0];
  const disabled = {
    id: 'acme/unverified', source: 'acme/unverified', revision: sha('c'), license: null,
    licenseUrl: `https://github.com/acme/unverified/tree/${sha('c')}`,
    skills: [{ name: 'pending' }], disabledReason: 'License needs approval',
  };
  const value = { schemaVersion: 1, custom: { keep: true }, sources: [enabled, disabled] };
  const { file, original } = await fixture(t, value);
  const checked = await invoke(file, ['--check'], fetchFor());
  assert.equal(checked.code, 0, checked.stderr);
  assert.match(checked.stdout, /acme\/skills: a{40} -> b{40}/);
  assert.match(checked.stdout, /acme\/unverified: disabled/);
  assert.equal(checked.stderr, '');
  assert.equal(await readFile(file, 'utf8'), original);
  const written = await invoke(file, ['--write'], fetchFor());
  assert.equal(written.code, 0, written.stderr);
  assert.equal(written.stderr, '');
  const result = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(result.sources[0].revision, sha('b'));
  assert.deepEqual(result.sources[0].skills, enabled.skills);
  assert.equal(result.sources[0].sourceNote, enabled.sourceNote);
  assert.deepEqual(result.sources[1], disabled);
  assert.deepEqual(result.custom, value.custom);
});

test('unknown schema and malformed source fail before network access', async (t) => {
  for (const value of [{ schemaVersion: 2, sources: [] }, { schemaVersion: 1, sources: [{ ...catalog().sources[0], source: '../private' }] }]) {
    const { file, original } = await fixture(t, value); let fetched = false;
    const result = await invoke(file, ['--check'], async () => { fetched = true; throw Error('unexpected'); });
    assert.equal(result.code, 1); assert.equal(result.stdout, ''); assert.match(result.stderr, /invalid|unsupported/i); assert.equal(fetched, false); assert.equal(await readFile(file, 'utf8'), original);
  }
});

test('strict option errors have stable public output', async (t) => {
  const { file } = await fixture(t);
  for (const args of [[], ['--check', '--write'], ['--check', '--unknown']]) {
    const result = await invoke(file, args, fetchFor());
    assert.equal(result.code, 2); assert.equal(result.stdout, ''); assert.ok(result.stderr.startsWith('Select exactly one mode:') || result.stderr.startsWith('Conflicting or repeated mode option:') || result.stderr.startsWith('Unknown option:'));
    assert.ok(result.stderr.endsWith('Usage: node scripts/catalog-updates.mjs (--check | --write) [--catalog PATH]\n'));
  }
});
