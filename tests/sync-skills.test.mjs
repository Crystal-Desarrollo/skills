import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, symlink, chmod, lstat, unlink, readlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../scripts/sync-skills.mjs';

const pin = 'a'.repeat(40), latest = 'b'.repeat(40);
const digest = (data) => createHash('sha1').update(`blob ${Buffer.byteLength(data)}\0`).update(data).digest('hex');
const source = (owner = 'acme') => ({ id: `${owner}/skills`, source: `${owner}/skills`, revision: pin, license: 'MIT', licensePath: 'LICENSE', licenseUrl: `https://github.com/${owner}/skills/blob/${pin}/LICENSE`, skills: [{ name: 'one' }] });
async function fixture(t, sources = [source()]) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sync-skills-'));
  // The parent removes these paths after verification; workers never delete scratch.
  console.log(`scratch: ${root}`);
  await mkdir(path.join(root, 'skills/owned'), { recursive: true });
  await writeFile(path.join(root, 'skills/owned/SKILL.md'), 'owned bytes');
  await writeFile(path.join(root, 'catalog.json'), JSON.stringify({ schemaVersion: 1, extra: 'keep', sources }) + '\n');
  return root;
}
function network({ fail = false, mode = '100644', unsafe = false, ambiguous = false, license = 'MIT', changed = false } = {}) {
  const files = { 'LICENSE': 'Copyright Acme\nMIT\n', 'skills/one/SKILL.md': '---\nname: one\ndescription: Example\n---\n[Guide](references/guide.md)\n', 'skills/one/references/guide.md': 'Guide\n', 'skills/one/run.sh': '#!/bin/sh\nexit 0\n' };
  if (unsafe) files['skills/one/../escape'] = 'unsafe';
  if (ambiguous) files['other/one/SKILL.md'] = files['skills/one/SKILL.md'];
  const calls = [];
  const fetchImpl = async (input) => {
    const url = new URL(input); calls.push(url.href);
    const json = (body) => new Response(JSON.stringify(body));
    if (url.pathname.endsWith('/commits/main')) return json({ sha: latest });
    if (url.pathname.endsWith('/license')) return json({ path: 'LICENSE', license: { spdx_id: license } });
    if (url.pathname.includes('/git/trees/')) return json({ truncated: false, tree: Object.entries(files).map(([p, data]) => ({ path: p, type: 'blob', mode: p.endsWith('SKILL.md') ? mode : p.endsWith('.sh') ? '100755' : '100644', size: Buffer.byteLength(data), sha: digest(data) })) });
    if (url.hostname === 'raw.githubusercontent.com') {
      if (fail && url.pathname.endsWith('guide.md')) return new Response('', { status: 503 });
      const p = url.pathname.split('/').slice(4).join('/');
      assert.ok(Object.hasOwn(files, p), p);
      return new Response(changed && p.endsWith('guide.md') ? 'tampered' : files[p]);
    }
    return json({ full_name: url.pathname.endsWith('/alias') ? 'acme/skills' : url.pathname.split('/').slice(2).join('/'), default_branch: 'main' });
  };
  return { fetchImpl, calls };
}
async function invoke(root, args = [], options = {}) {
  let stdout = '', stderr = '';
  const code = await runCli(args, { root, ...options, stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } });
  return { code, stdout, stderr };
}
async function bytes(root) {
  const result = {};
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name), relative = path.relative(root, p);
      if (entry.isDirectory()) await walk(p);
      else if (entry.isSymbolicLink()) result[relative] = { link: await readlink(p) };
      else result[relative] = { bytes: (await readFile(p)).toString('base64'), mode: (await lstat(p)).mode & 0o777 };
    }
  }
  await walk(root); return result;
}

test('pinned sync copies support files, executable modes, per-skill license and provenance; check is offline and idempotent', async (t) => {
  const root = await fixture(t), remote = network(), original = await readFile(path.join(root, 'catalog.json'));
  const result = await invoke(root, [], remote);
  assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /1 skill/); assert.equal(result.stderr, '');
  const target = path.join(root, 'skills/vendor/acme-skills/one');
  assert.equal(await readFile(path.join(target, 'references/guide.md'), 'utf8'), 'Guide\n');
  assert.equal(await readFile(path.join(target, 'LICENSE.upstream'), 'utf8'), 'Copyright Acme\nMIT\n');
  assert.equal((await lstat(path.join(target, 'run.sh'))).mode & 0o777, 0o755);
  const provenance = JSON.parse(await readFile(path.join(target, 'PROVENANCE.json')));
  assert.equal(provenance.revision, pin); assert.equal(provenance.originalName, 'one'); assert.equal(provenance.sourcePath, 'skills/one');
  assert.deepEqual(await readFile(path.join(root, 'catalog.json')), original);
  assert.equal(await readFile(path.join(root, 'skills/owned/SKILL.md'), 'utf8'), 'owned bytes');
  const before = await bytes(root);
  const checked = await invoke(root, ['--check'], { fetchImpl: () => { throw Error('check must not fetch'); } });
  assert.equal(checked.code, 0, checked.stderr); assert.equal(checked.stderr, ''); assert.match(checked.stdout, /verified/i);
  assert.deepEqual(await bytes(root), before);
  assert.equal((await invoke(root, [], network())).code, 0); assert.deepEqual(await bytes(root), before);
});

test('only colliding names get stable source aliases; disabled and owned sources stay untouched', async (t) => {
  const disabled = { ...source('disabled'), license: null, disabledReason: 'Not approved' };
  const owned = { ...source('crystal-desarrollo'), source: 'Crystal-Desarrollo/skills', skills: [{ name: 'owned' }] };
  const root = await fixture(t, [source(), source('other'), disabled, owned]), remote = network();
  const result = await invoke(root, [], remote); assert.equal(result.code, 0, result.stderr);
  for (const owner of ['acme', 'other']) {
    const target = path.join(root, `skills/vendor/${owner}-skills/${owner}-skills-one`);
    assert.match(await readFile(path.join(target, 'SKILL.md'), 'utf8'), new RegExp(`name: ${owner}-skills-one`));
    assert.equal(JSON.parse(await readFile(path.join(target, 'PROVENANCE.json'))).originalName, 'one');
  }
  assert.ok(remote.calls.every((url) => !/disabled|crystal-desarrollo/i.test(url)));
});

test('update uses the shared revision and license resolver and writes matching snapshots and blob URLs', async (t) => {
  const root = await fixture(t), remote = network();
  const result = await invoke(root, ['--update'], remote); assert.equal(result.code, 0, result.stderr);
  const value = JSON.parse(await readFile(path.join(root, 'catalog.json')));
  assert.equal(value.extra, 'keep'); assert.equal(value.sources[0].revision, latest);
  assert.equal(value.sources[0].licenseUrl, `https://github.com/acme/skills/blob/${latest}/LICENSE`);
  assert.equal(JSON.parse(await readFile(path.join(root, 'skills/vendor/acme-skills/one/PROVENANCE.json'))).revision, latest);
  assert.equal((await invoke(root, ['--check'])).code, 0);
});

test('download, hash, license, unsafe-tree and ambiguous-path failures preserve original bytes', async (t) => {
  for (const options of [{ fail: true }, { changed: true }, { mode: '120000' }, { unsafe: true }, { ambiguous: true }, { license: 'Apache-2.0' }]) {
    const root = await fixture(t), before = await bytes(root);
    const result = await invoke(root, ['--update'], network(options));
    assert.equal(result.code, 1, JSON.stringify(options)); assert.equal(result.stdout, ''); assert.ok(result.stderr);
    assert.deepEqual(await bytes(root), before); assert.ok(!(await readdir(root)).includes('.skills-sync.lock'));
  }
});

test('local edits, added files and mode changes block check and sync without modifying files', async (t) => {
  for (const edit of ['bytes', 'extra', 'mode']) {
    const root = await fixture(t); assert.equal((await invoke(root, [], network())).code, 0);
    const file = path.join(root, 'skills/vendor/acme-skills/one/references/guide.md');
    if (edit === 'bytes') await writeFile(file, 'local edit');
    if (edit === 'extra') await writeFile(path.join(path.dirname(file), 'local.md'), 'keep');
    if (edit === 'mode') await chmod(file, 0o755);
    const before = await bytes(root);
    for (const args of [['--check'], [], ['--update']]) {
      const result = await invoke(root, args, network()); assert.equal(result.code, 1); assert.match(result.stderr, /local|integrity|modified/i);
      assert.deepEqual(await bytes(root), before);
    }
  }
});

test('symlink destinations, duplicate slugs, stale pins and concurrent writers fail closed', async (t) => {
  const root = await fixture(t), outside = await fixture(t);
  await symlink(path.join(outside, 'skills'), path.join(root, 'skills/vendor'));
  const before = await bytes(outside);
  assert.equal((await invoke(root, [], network())).code, 1); assert.deepEqual(await bytes(outside), before);
  const collision = await fixture(t, [source('a-b'), { ...source('a'), id: 'a/b-skills' }]);
  assert.equal((await invoke(collision, [], network())).code, 1);
  const locked = await fixture(t); await mkdir(path.join(locked, '.skills-sync.lock'));
  assert.equal((await invoke(locked, [], network())).code, 1); assert.ok((await readdir(locked)).includes('.skills-sync.lock'));
  const stale = await fixture(t); assert.equal((await invoke(stale, [], network())).code, 0);
  const catalogPath = path.join(stale, 'catalog.json'), value = JSON.parse(await readFile(catalogPath)); value.sources[0].revision = latest;
  await writeFile(catalogPath, JSON.stringify(value)); assert.equal((await invoke(stale, ['--check'])).code, 1);
});

test('public help and invalid options do not fetch or write', async (t) => {
  const root = await fixture(t), before = await bytes(root);
  assert.equal((await invoke(root, ['--help'])).code, 0);
  for (const args of [['--wat'], ['--check', '--update'], ['--update', '--update'], ['--check', '--check']]) {
    const result = await invoke(root, args, { fetchImpl: () => { throw Error('unexpected network'); } });
    assert.equal(result.code, 2); assert.match(result.stderr, /Usage:/);
  }
  assert.deepEqual(await bytes(root), before);
});

test('a failure after replacement restores catalog and both initial and existing snapshot states', async (t) => {
  for (const existing of [false, true]) {
    const root = await fixture(t);
    if (existing) assert.equal((await invoke(root, [], network())).code, 0);
    await chmod(path.join(root, 'catalog.json'), 0o640);
    const before = await bytes(root);
    let stderr = '';
    const code = await runCli(['--update'], { root, ...network(), stdout: () => { throw Error('output failure after replacement'); }, stderr: (text) => { stderr += text; } });
    assert.equal(code, 1); assert.match(stderr, /output failure/);
    assert.deepEqual(await bytes(root), before);
    assert.ok(!(await readdir(root)).includes('.skills-sync.lock'));
  }
});

test('a local edit during downloads is retained and blocks replacement', async (t) => {
  const root = await fixture(t); assert.equal((await invoke(root, [], network())).code, 0);
  const file = path.join(root, 'skills/vendor/acme-skills/one/references/guide.md');
  const remote = network(), catalogBefore = await readFile(path.join(root, 'catalog.json'));
  const fetchImpl = async (...args) => { await writeFile(file, 'edit during sync'); return remote.fetchImpl(...args); };
  const result = await invoke(root, ['--update'], { fetchImpl });
  assert.equal(result.code, 1); assert.match(result.stderr, /modified|changed/i);
  assert.equal(await readFile(file, 'utf8'), 'edit during sync');
  assert.deepEqual(await readFile(path.join(root, 'catalog.json')), catalogBefore);
});

test('native author groups combine repositories, sort names, and preserve installed skill names in every sync mode', async (t) => {
  const root = await fixture(t, [source('vercel-labs'), { ...source('vercel-labs'), id: 'vercel-labs/other' }, source('mattpocock')]);
  const file = path.join(root, '.claude-plugin/marketplace.json');
  for (const args of [[], ['--update']]) {
    const result = await invoke(root, args, network()); assert.equal(result.code, 0, result.stderr);
    const marketplace = JSON.parse(await readFile(file));
    assert.deepEqual(marketplace.plugins.map((plugin) => plugin.name), ['matt-pocock', 'vercel-labs']);
    assert.equal(marketplace.plugins[1].skills.length, 2);
    for (const plugin of marketplace.plugins) {
      assert.equal(plugin.source, './');
      assert.deepEqual(plugin.skills, [...plugin.skills].sort());
      for (const skillPath of plugin.skills) assert.ok((await readFile(path.join(root, skillPath, 'SKILL.md'), 'utf8')).includes('name: '));
    }
    const before = await bytes(root);
    assert.equal((await invoke(root, ['--check'], { fetchImpl: () => { throw Error('offline'); } })).code, 0);
    assert.deepEqual(await bytes(root), before);
  }
});

test('locally edited, missing, symlinked, or unmanaged grouping metadata blocks sync and is preserved', async (t) => {
  for (const kind of ['edit', 'mode', 'missing', 'symlink', 'unmanaged', 'parent-link']) {
    const root = await fixture(t), file = path.join(root, '.claude-plugin/marketplace.json');
    if (!['unmanaged', 'parent-link'].includes(kind)) assert.equal((await invoke(root, [], network())).code, 0);
    if (kind === 'edit') await writeFile(file, '{"plugins":[]}');
    if (kind === 'mode') await chmod(file, 0o755);
    if (kind === 'missing') await unlink(file);
    if (kind === 'symlink') { await unlink(file); await symlink(path.join(root, 'catalog.json'), file); }
    if (kind === 'unmanaged') { await mkdir(path.dirname(file)); await writeFile(file, 'local configuration'); }
    if (kind === 'parent-link') await symlink(path.join(root, 'skills'), path.dirname(file));
    const before = await bytes(root);
    for (const args of [[], ['--update'], ['--check']]) {
      const result = await invoke(root, args, network()); assert.equal(result.code, 1, kind);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /group|marketplace|symlink|directory|snapshots/i);
      assert.deepEqual(await bytes(root), before);
    }
  }
});

test('replacement failure restores existing author metadata when catalog selection changes', async (t) => {
  const root = await fixture(t); assert.equal((await invoke(root, [], network())).code, 0);
  const file = path.join(root, 'catalog.json'), catalog = JSON.parse(await readFile(file));
  catalog.sources.push(source('other')); await writeFile(file, JSON.stringify(catalog));
  const before = await bytes(root); let stderr = '';
  const code = await runCli(['--update'], { root, ...network(), stdout: () => { throw Error('output failure'); }, stderr: (s) => { stderr += s; } });
  assert.equal(code, 1); assert.match(stderr, /output failure/);
  assert.deepEqual(await bytes(root), before);
});
