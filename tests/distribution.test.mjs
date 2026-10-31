import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);

function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    ...options,
  });
  assert.equal(result.status, 0, `${executable} failed: ${result.stderr || result.error}`);
  return result.stdout;
}

test('packed company CLI includes its catalog and needs no consumer build hook', (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'company-skills-package-'));
  t.diagnostic(`scratch: ${scratch}`);
  const cache = join(scratch, 'cache');
  mkdirSync(cache);
  const userConfig = join(scratch, 'npmrc');
  const globalConfig = join(scratch, 'global-npmrc');
  writeFileSync(userConfig, '');
  writeFileSync(globalConfig, '');
  const output = command('npm', [
    'pack', '--ignore-scripts', '--json', '--pack-destination', scratch,
  ], {
    env: {
      ...process.env,
      npm_config_cache: cache,
      npm_config_userconfig: userConfig,
      npm_config_globalconfig: globalConfig,
      npm_config_update_notifier: 'false',
    },
  });
  const reports = JSON.parse(output);
  const report = Array.isArray(reports) ? reports[0] : reports['@crystal-desarrollo/skills'];
  assert.ok(report?.filename, 'npm pack must report the company package archive');
  const archive = join(scratch, report.filename);
  const manifest = JSON.parse(command('tar', ['-xOf', archive, 'package/package.json']));
  assert.equal(manifest.scripts?.prepare, undefined,
    'Git consumers must not need approval to compile the company CLI');
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepack']) {
    assert.equal(manifest.scripts?.[hook], undefined, `Unexpected consumer build hook: ${hook}`);
  }
  assert.deepEqual(manifest.bin, { 'crystal-skills': 'dist/cli.js' });
  const files = report.files.map((file) => file.path).sort();
  assert.deepEqual(files, ['LICENSE', 'README.md', 'catalog.json', 'dist/cli.js', 'package.json']);
  const catalog = JSON.parse(command('tar', ['-xOf', archive, 'package/catalog.json']));
  assert.ok(catalog.sources.some((source) => source.source === 'Crystal-Desarrollo/skills'));
  assert.ok(catalog.sources.some((source) => source.source === 'vercel-labs/skills'));
  assert.match(command('tar', ['-xOf', archive, 'package/dist/cli.js']), /^#!\/usr\/bin\/env node\n/);
});

test('distributed JavaScript matches a fresh TypeScript build', (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'company-skills-build-'));
  t.diagnostic(`scratch: ${scratch}`);
  const compilerManifestPath = require.resolve('typescript/package.json');
  const compilerManifest = JSON.parse(readFileSync(compilerManifestPath, 'utf8'));
  const compiler = resolve(dirname(compilerManifestPath), compilerManifest.bin.tsc);
  command(process.execPath, [
    compiler,
    '--project', join(root, 'tsconfig.json'),
    '--outDir', scratch,
  ]);
  assert.equal(readFileSync(join(root, 'dist/cli.js'), 'utf8'),
    readFileSync(join(scratch, 'cli.js'), 'utf8'),
    'Run pnpm build and include dist/cli.js when changing the CLI source');
});

test('distributed CLI lists the catalog and rejects unknown selections without writes', (t) => {
  const project = mkdtempSync(join(tmpdir(), 'company-skills-fresh-project-'));
  t.diagnostic(`scratch: ${project}`);
  const env = {
    PATH: process.env.PATH,
    HOME: project,
    TMPDIR: project,
    XDG_CACHE_HOME: project,
  };
  const list = spawnSync(process.execPath, [join(root, 'dist/cli.js'), 'list'], {
    cwd: project, encoding: 'utf8', env,
  });
  assert.equal(list.status, 0, list.stderr);
  assert.equal(list.stderr, '');
  assert.match(list.stdout, /crystal-desarrollo\/skills\/shadcn-audit/);
  assert.match(list.stdout, /vercel-labs\/skills\/find-skills/);
  assert.deepEqual(readdirSync(project), []);

  const rejected = spawnSync(process.execPath, [
    join(root, 'dist/cli.js'), 'init', '--skill', 'bogus', '--agent', 'opencode',
  ], { cwd: project, encoding: 'utf8', env });
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stdout, '');
  assert.equal(rejected.stderr, 'Unknown skill selection: bogus\n');
  assert.deepEqual(readdirSync(project), []);
});
