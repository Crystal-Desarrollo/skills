import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createElement } from 'react';
import { render } from 'ink-testing-library';
import { run, Selection, type Catalog, type InstallerRequest } from '../../src/cli.js';

const source: Catalog['sources'][number] = {
  id: 'test/source', source: 'test/source', revision: 'a'.repeat(40), license: 'MIT',
  licenseUrl: 'https://example.invalid/test/source/blob/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/LICENSE',
  licensePath: 'LICENSE', skills: [{ name: 'skill-one' }, { name: 'skill-two' }],
};
const catalog: Catalog = { schemaVersion: 1, sources: [source] };
const licenseText = 'MIT test license\n';
const fixture = () => mkdtempSync(join(tmpdir(), 'company-skills-cli-test-'));
function streams() {
  let stdout = '', stderr = '';
  return {
    out: new Writable({ write(chunk, _encoding, done) { stdout += chunk.toString(); done(); } }),
    err: new Writable({ write(chunk, _encoding, done) { stderr += chunk.toString(); done(); } }),
    stdout: () => stdout, stderr: () => stderr,
  };
}
function fakeInstaller(files = { '.agents/skills/skill-one/SKILL.md': 'name: skill-one\n' }, fail = false) {
  const calls: InstallerRequest[] = [];
  return { calls, installer: async (request: InstallerRequest) => {
    calls.push(request);
    if (fail) throw new Error('simulated upstream failure');
    for (const [path, body] of Object.entries(files)) {
      const destination = join(request.staging, path);
      mkdirSync(join(destination, '..'), { recursive: true });
      writeFileSync(destination, body);
    }
    const names = Object.keys(files).map(path => path.match(/(?:^|\/)skills\/([^/]+)\/SKILL\.md$/)?.[1]).filter(Boolean);
    writeFileSync(join(request.staging, 'skills-lock.json'), JSON.stringify({ version: 1, skills: Object.fromEntries(names.map(name => [name, { source: request.source, ref: request.revision, sourceType: 'github', skillPath: `skills/${name}/SKILL.md`, computedHash: 'hash' }])) }));
  }};
}
async function invoke(args: string[], root: string, extra: Record<string, unknown> = {}) {
  const io = streams();
  const scratch = fixture();
  try {
    const outcome = await run(args, { cwd: root, catalog, stdout: io.out, stderr: io.err, scratchRoot: scratch, fetchLicense: async () => licenseText, ...extra } as never);
    return { outcome, ...io };
  } finally { rmSync(scratch, { recursive: true }); }
}

test('catalog rejects duplicate source ids and install rejects colliding selected skill names', async () => {
  const root = fixture();
  try {
    const io = streams();
    const duplicate = { schemaVersion: 1, sources: [source, source] } as Catalog;
    const result = await run(['list'], { cwd: root, catalog: duplicate, stdout: io.out, stderr: io.err } as never);
    assert.equal(result.code, 1);
    assert.match(io.stderr(), /duplicate source/i);
    const collide = { ...catalog, sources: [source, { ...source, id: 'other/source', skills: [{ name: 'skill-one' }] }] };
    const other = streams();
    const second = await run(['init', '--skill', 'test/source/skill-one', '--skill', 'other/source/skill-one'], { cwd: root, catalog: collide, stdout: other.out, stderr: other.err, installer: fakeInstaller().installer, fetchLicense: async () => licenseText } as never);
    assert.equal(second.code, 1);
    assert.match(other.stderr(), /collid/i);
    assert.equal(existsSync(join(root, '.company-skills.json')), false);
  } finally { rmSync(root, { recursive: true }); }
});

test('init installs selected skill files, all requested agent outputs, license, record, and native lock', async () => {
  const root = fixture();
  try {
    const files = {
      '.agents/skills/skill-one/SKILL.md': 'name: skill-one\n',
      '.claude/skills/skill-one/SKILL.md': 'name: skill-one\n',
      '.cursor/skills/skill-one/SKILL.md': 'name: skill-one\n',
    };
    const fake = fakeInstaller(files);
    const result = await invoke(['init', '--skill', 'test/source/skill-one', '--agent', 'claude-code', '--agent', 'cursor'], root, { installer: fake.installer });
    assert.equal(result.outcome.code, 0, result.stderr());
    assert.match(result.stdout(), /Installed 1 skill/);
    for (const path of Object.keys(files)) assert.equal(readFileSync(join(root, path), 'utf8'), files[path]);
    assert.equal(readFileSync(join(root, '.company-skills/licenses/test-source/LICENSE'), 'utf8'), licenseText);
    assert.deepEqual(JSON.parse(readFileSync(join(root, '.company-skills.json'), 'utf8')).agents, ['claude-code', 'cursor']);
    assert.equal(JSON.parse(readFileSync(join(root, 'skills-lock.json'), 'utf8')).skills['skill-one'].ref, source.revision);
    assert.equal(fake.calls[0].agents.join(','), 'claude-code,cursor');
  } finally { rmSync(root, { recursive: true }); }
});

test('repeat init is a no-op and preserves unrelated files in managed directories', async () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'keep.txt'), 'unrelated');
    const fake = fakeInstaller();
    assert.equal((await invoke(['init', '--skill', 'test/source/skill-one'], root, { installer: fake.installer })).outcome.code, 0);
    mkdirSync(join(root, '.agents/skills/unrelated'), { recursive: true });
    writeFileSync(join(root, '.agents/skills/unrelated/SKILL.md'), 'unrelated skill');
    const repeat = await invoke(['init', '--skill', 'test/source/skill-one'], root, { installer: fake.installer });
    assert.equal(repeat.outcome.code, 0, repeat.stderr());
    assert.match(repeat.stdout(), /already up to date|no changes/i);
    assert.equal(fake.calls.length, 1);
    assert.equal(readFileSync(join(root, '.agents/skills/unrelated/SKILL.md'), 'utf8'), 'unrelated skill');
    assert.equal(readFileSync(join(root, 'keep.txt'), 'utf8'), 'unrelated');
  } finally { rmSync(root, { recursive: true }); }
});

test('update uses recorded agents and refuses locally edited managed files without mutation', async () => {
  const root = fixture();
  try {
    const fake = fakeInstaller();
    await invoke(['init', '--skill', 'test/source/skill-one', '--agent', 'cursor'], root, { installer: fake.installer });
    writeFileSync(join(root, '.agents/skills/skill-one/SKILL.md'), 'local edit');
    const before = readFileSync(join(root, '.company-skills.json'), 'utf8');
    const update = await invoke(['update'], root, { installer: fake.installer });
    assert.equal(update.outcome.code, 1);
    assert.match(update.stderr(), /locally modified/i);
    assert.equal(fake.calls.at(-1)?.agents[0], 'cursor');
    assert.equal(readFileSync(join(root, '.agents/skills/skill-one/SKILL.md'), 'utf8'), 'local edit');
    assert.equal(readFileSync(join(root, '.company-skills.json'), 'utf8'), before);
  } finally { rmSync(root, { recursive: true }); }
});

test('update installs an approved new pin and preserves unmanaged native lock entries', async () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'skills-lock.json'), JSON.stringify({ version: 1, skills: { unrelated: { source: 'other/repo', ref: 'old', sourceType: 'github', skillPath: 'skills/unrelated/SKILL.md', computedHash: 'kept' } }, extra: 'keep-me' }));
    const first = fakeInstaller({ '.agents/skills/skill-one/SKILL.md': 'version one' });
    const initial = await invoke(['init', '--skill', 'test/source/skill-one'], root, { installer: first.installer });
    assert.equal(initial.outcome.code, 0, initial.stderr());
    const newerSource = { ...source, revision: 'b'.repeat(40), licenseUrl: `https://github.com/test/source/blob/${'b'.repeat(40)}/LICENSE` };
    const newerCatalog: Catalog = { schemaVersion: 1, sources: [newerSource] };
    const second = fakeInstaller({ '.agents/skills/skill-one/SKILL.md': 'version two' });
    const updated = await invoke(['update'], root, { catalog: newerCatalog, installer: second.installer });
    assert.equal(updated.outcome.code, 0, updated.stderr());
    assert.equal(readFileSync(join(root, '.agents/skills/skill-one/SKILL.md'), 'utf8'), 'version two');
    const lock = JSON.parse(readFileSync(join(root, 'skills-lock.json'), 'utf8'));
    assert.equal(lock.skills['skill-one'].ref, 'b'.repeat(40));
    assert.equal(lock.skills.unrelated.computedHash, 'kept');
    assert.equal(lock.extra, 'keep-me');
    assert.equal(second.calls[0].agents[0], 'opencode');
  } finally { rmSync(root, { recursive: true }); }
});

test('installer failure leaves project state unchanged', async () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'keep'), 'old');
    const before = readFileSync(join(root, 'keep'), 'utf8');
    const fake = fakeInstaller({}, true);
    const result = await invoke(['init', '--skill', 'test/source/skill-one'], root, { installer: fake.installer });
    assert.equal(result.outcome.code, 1);
    assert.match(result.stderr(), /simulated upstream failure/);
    assert.equal(readFileSync(join(root, 'keep'), 'utf8'), before);
    assert.equal(existsSync(join(root, '.company-skills.json')), false);
    assert.equal(existsSync(join(root, '.agents')), false);
    assert.equal(existsSync(join(root, 'skills-lock.json')), false);
  } finally { rmSync(root, { recursive: true }); }
});

test('a later source failure leaves the complete target unchanged', async () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'keep.txt'), 'unchanged');
    const secondSource = { ...source, id: 'second/source', source: 'second/source', skills: [{ name: 'skill-two' }] };
    const multiple: Catalog = { schemaVersion: 1, sources: [source, secondSource] };
    const called: string[] = [];
    const installer = async (request: InstallerRequest) => {
      called.push(request.source);
      if (request.source === 'second/source') throw new Error('second source failed');
      const skill = join(request.staging, '.agents/skills/skill-one/SKILL.md');
      mkdirSync(join(skill, '..'), { recursive: true });
      writeFileSync(skill, 'skill-one');
    };
    const result = await invoke(['init', '--skill', 'test/source/skill-one', '--skill', 'second/source/skill-two'], root, { catalog: multiple, installer });
    assert.equal(result.outcome.code, 1);
    assert.match(result.stderr(), /second source failed/);
    assert.deepEqual(called, ['test/source', 'second/source']);
    assert.deepEqual(readdirSync(root), ['keep.txt']);
    assert.equal(readFileSync(join(root, 'keep.txt'), 'utf8'), 'unchanged');
  } finally { rmSync(root, { recursive: true }); }
});

test('license fetch failure and empty installer output leave project untouched', async () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'keep.txt'), 'unchanged');
    const fetched = await invoke(['init', '--skill', 'test/source/skill-one'], root, { installer: fakeInstaller().installer, fetchLicense: async () => { throw new Error('license unavailable'); } });
    assert.equal(fetched.outcome.code, 1);
    assert.match(fetched.stderr(), /license unavailable/);
    const empty = await invoke(['init', '--skill', 'test/source/skill-one'], root, { installer: fakeInstaller({}, false).installer });
    assert.equal(empty.outcome.code, 1);
    assert.match(empty.stderr(), /no skill files/i);
    assert.deepEqual(readdirSync(root), ['keep.txt']);
    assert.equal(readFileSync(join(root, 'keep.txt'), 'utf8'), 'unchanged');
  } finally { rmSync(root, { recursive: true }); }
});

test('symlinked managed paths and malformed records fail before writes', async () => {
  const root = fixture();
  const outside = fixture();
  try {
    mkdirSync(join(root, '.agents'), { recursive: true });
    const linked = spawnSync('ln', ['-s', outside, join(root, '.agents/skills')], { encoding: 'utf8' });
    assert.equal(linked.status, 0, linked.stderr);
    const result = await invoke(['init', '--skill', 'test/source/skill-one'], root, { installer: fakeInstaller().installer });
    assert.equal(result.outcome.code, 1);
    assert.match(result.stderr(), /symlink/i);
    assert.equal(existsSync(join(outside, 'skill-one/SKILL.md')), false);
  } finally { rmSync(root, { recursive: true }); rmSync(outside, { recursive: true }); }
});

test('malformed selection records, duplicate selections, and unsafe installer paths fail without writes', async () => {
  const root = fixture();
  try {
    writeFileSync(join(root, '.company-skills.json'), '{broken');
    const malformed = await invoke(['init', '--skill', 'test/source/skill-one'], root, { installer: fakeInstaller().installer });
    assert.equal(malformed.outcome.code, 1);
    assert.match(malformed.stderr(), /selection record/i);
    assert.equal(existsSync(join(root, 'skills-lock.json')), false);
  } finally { rmSync(root, { recursive: true }); }

  const duplicateRoot = fixture();
  try {
    const duplicate = await invoke(['init', '--skill', 'test/source/skill-one', '--skill', 'test/source/skill-one'], duplicateRoot, { installer: fakeInstaller().installer });
    assert.equal(duplicate.outcome.code, 1);
    assert.equal(duplicate.stderr().trim(), 'Duplicate skill selection');
    const unsafe = await invoke(['init', '--skill', 'test/source/skill-one'], duplicateRoot, { installer: fakeInstaller({ '.agents/skills/skill-one/SKILL.md': 'skill-one', 'escape/file.txt': 'outside' }).installer });
    assert.equal(unsafe.outcome.code, 1);
    assert.match(unsafe.stderr(), /unexpected installer output path/i);
    assert.equal(existsSync(join(duplicateRoot, '.company-skills.json')), false);
    assert.equal(existsSync(join(duplicateRoot, 'escape')), false);
  } finally { rmSync(duplicateRoot, { recursive: true }); }
});

test('scoped commit excludes unrelated staged files and keeps the user index intact', async () => {
  const root = fixture();
  try {
    for (const args of [['init'], ['config', 'user.name', 'Test User'], ['config', 'user.email', 'test@example.invalid']]) {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }
    writeFileSync(join(root, 'unrelated.txt'), 'user staged change');
    assert.equal(spawnSync('git', ['add', 'unrelated.txt'], { cwd: root }).status, 0);
    const fake = fakeInstaller();
    const installed = await invoke(['init', '--skill', 'test/source/skill-one', '--commit'], root, { installer: fake.installer });
    assert.equal(installed.outcome.code, 0, installed.stderr());
    const committed = spawnSync('git', ['show', '--pretty=format:', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' });
    assert.equal(committed.status, 0);
    assert.match(committed.stdout, /\.agents\/skills\/skill-one\/SKILL.md/);
    assert.doesNotMatch(committed.stdout, /unrelated\.txt/);
    const staged = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' });
    assert.equal(staged.stdout.trim(), 'unrelated.txt');
  } finally { rmSync(root, { recursive: true }); }
});

test('invalid option combinations and invalid agent values fail before installer call', async () => {
  const root = fixture();
  try {
    const fake = fakeInstaller();
    for (const args of [['list', '--commit'], ['update', '--skill', 'test/source/skill-one'], ['init', '--skill', 'test/source/skill-one', '--agent', 'made-up']]) {
      const result = await invoke(args, root, { installer: fake.installer });
      assert.equal(result.outcome.code, 1);
      assert.notEqual(result.stderr(), '');
    }
    assert.equal(fake.calls.length, 0);
    assert.equal(existsSync(join(root, '.company-skills.json')), false);
  } finally { rmSync(root, { recursive: true }); }
});

test('--commit rejects a non-Git project before calling the installer', async () => {
  const root = fixture();
  try {
    const fake = fakeInstaller();
    const result = await invoke(['init', '--skill', 'test/source/skill-one', '--commit'], root, { installer: fake.installer });
    assert.equal(result.outcome.code, 1);
    assert.match(result.stderr(), /Git repository root/);
    assert.equal(fake.calls.length, 0);
    assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true }); }
});

test('noninteractive init requires explicit selection and selected agents are retained across search filtering', async () => {
  const root = fixture();
  try {
    const noTty = await invoke(['init'], root, { isTTY: false });
    assert.equal(noTty.outcome.code, 1);
    assert.match(noTty.stderr(), /--skill/);
    assert.equal(existsSync(join(root, '.company-skills.json')), false);
  } finally { rmSync(root, { recursive: true }); }

  let selected: string[] | null = null;
  const ui = render(createElement(Selection, { entries: entriesForTest(), initial: ['test/source/skill-one'], onDone: value => { selected = value; } }));
  await waitFor(() => assert.match(ui.lastFrame() ?? '', /skill-one/));
  ui.stdin.write('skill-two');
  await waitFor(() => assert.match(ui.lastFrame() ?? '', /Search: skill-two/));
  ui.stdin.write(' ');
  await waitFor(() => assert.match(ui.lastFrame() ?? '', /\[x\] test\/source\/skill-two/));
  for (let i = 0; i < 'skill-two'.length; i += 1) ui.stdin.write('\b');
  ui.stdin.write('\r');
  await waitFor(() => assert.deepEqual(selected, ['test/source/skill-one', 'test/source/skill-two']));
  let cancelled: string[] | null = ['prior'];
  const cancelUi = render(createElement(Selection, { entries: entriesForTest(), initial: [], onDone: value => { cancelled = value; } }));
  await waitFor(() => assert.match(cancelUi.lastFrame() ?? '', /skill-one/));
  cancelUi.stdin.write('\u001b');
  await waitFor(() => assert.equal(cancelled, null));
});

function entriesForTest() { return source.skills.map(skill => ({ id: `test/source/${skill.name}`, source, skill })); }

async function waitFor(check: () => void) {
  for (let attempt = 0; ; attempt += 1) {
    try { check(); return; }
    catch (error) { if (attempt === 99) throw error; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
