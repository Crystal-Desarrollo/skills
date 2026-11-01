import { readFile, writeFile, lstat, mkdir, readdir, rename, rm, rmdir, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog, inspectSource } from './catalog-updates.mjs';

const usage = 'Usage: node scripts/sync-skills.mjs [--update | --check | --help]\nDefault: copy approved pins and author groups. --update: propose latest pins and copies. --check: verify local files and author groups offline.\n';
const owned = (source) => source.source.toLowerCase() === 'crystal-desarrollo/skills';
const hash = (data) => createHash('sha256').update(data).digest('hex');
const slug = (source) => source.id.replaceAll('/', '-');
const repoPattern = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
const manifestName = '_manifest.json';
const maxBytes = 32 * 1024 * 1024;

function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\\\x00-\x1f\x7f:]/.test(value) || value.split('/').some((part) => !part || part === '.' || part === '..' || ['.git', '.skills-sync.lock'].includes(part.toLowerCase()))) throw Error(`Unsafe relative path: ${value}`);
  return value;
}
async function info(file) {
  try { return await lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function regular(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error(`Expected regular non-symlink file: ${path.basename(file)}`);
  return stat;
}
async function directory(file) {
  const stat = await lstat(file);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error(`Expected non-symlink directory: ${path.basename(file)}`);
}
async function listFiles(root, prefix = '') {
  const files = [];
  for (const entry of await readdir(path.join(root, prefix))) {
    const relative = safeRelative(prefix ? `${prefix}/${entry}` : entry), target = path.join(root, relative), stat = await lstat(target);
    if (stat.isSymbolicLink()) throw Error(`Local snapshot integrity: symlink at ${relative}`);
    if (stat.isDirectory()) files.push(...await listFiles(root, relative));
    else if (stat.isFile()) files.push(relative);
    else throw Error(`Local snapshot integrity: unsupported file at ${relative}`);
  }
  return files.sort();
}

async function readMarketplace(root) {
  const parent = path.join(root, '.claude-plugin'), file = path.join(parent, 'marketplace.json');
  if (await info(parent)) await directory(parent);
  if (!await info(file)) return null;
  const stat = await regular(file);
  return { bytes: await readFile(file), mode: stat.mode & 0o777 };
}

async function verify(vendor, catalogBytes, requireCatalog, marketplace) {
  const stat = await info(vendor);
  if (!stat) {
    if (marketplace) throw Error('Unmanaged marketplace file; preserve it before syncing.');
    if (requireCatalog) throw Error('Snapshots missing; run skills:sync.');
    return null;
  }
  await directory(vendor);
  await regular(path.join(vendor, manifestName));
  const manifest = JSON.parse(await readFile(path.join(vendor, manifestName), 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.skills) || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) throw Error('Invalid snapshot manifest.');
  if (requireCatalog && manifest.catalogSha256 !== hash(catalogBytes)) throw Error('Snapshot catalog integrity mismatch; run skills:sync after reviewing catalog changes.');
  if (manifest.marketplace) {
    if (!marketplace || manifest.marketplace.sha256 !== hash(marketplace.bytes) || manifest.marketplace.mode !== marketplace.mode) throw Error('Local author grouping metadata modified or missing; preserve edits before syncing.');
  } else {
    if (marketplace) throw Error('Unmanaged marketplace file; preserve it before syncing.');
    if (requireCatalog) throw Error('Author grouping metadata missing; run skills:sync.');
  }
  const expected = Object.keys(manifest.files).sort();
  if (expected.includes(manifestName) || expected.some((file) => !safeRelative(file))) throw Error('Invalid snapshot manifest paths.');
  const actual = (await listFiles(vendor)).filter((file) => file !== manifestName);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error('Local snapshot integrity: added or missing files; preserve edits before syncing.');
  for (const file of expected) {
    const entry = manifest.files[file], target = path.join(vendor, file), stat = await regular(target);
    if (entry.sha256 !== hash(await readFile(target)) || entry.mode !== (stat.mode & 0o777)) throw Error(`Local snapshot modified: ${file}; preserve edits before syncing.`);
  }
  return manifest;
}

// No auth, shell, clone, checkout, dependency install, or upstream execution.
function publicFetch(fetchImpl) {
  return async (input, options = {}) => {
    let url = new URL(input);
    const host = url.hostname;
    if (!['api.github.com', 'raw.githubusercontent.com'].includes(host)) throw Error('Unsupported upstream host.');
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password || url.port) throw Error('Unsafe upstream redirect.');
      const response = await fetchImpl(url.href, { ...options, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
      if ([301, 302, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw Error('Missing upstream redirect location.');
        await response.body?.cancel(); url = new URL(location, url); continue;
      }
      if (!response.ok) throw Error(`Upstream request failed with HTTP ${response.status}.`);
      const reader = response.body?.getReader(), chunks = []; let size = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.length;
          if (size > maxBytes) { await reader.cancel(); throw Error('Upstream response exceeds safety limit.'); }
          chunks.push(value);
        }
      }
      return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
    }
    throw Error('Too many upstream redirects.');
  };
}
async function json(fetchImpl, url) {
  return (await fetchImpl(url, { headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } })).json();
}
async function blob(fetchImpl, repo, revision, entry) {
  safeRelative(entry.path);
  if (!['100644', '100755'].includes(entry.mode) || entry.type !== 'blob' || !/^[a-f0-9]{40}$/.test(entry.sha) || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 4 * 1024 * 1024) throw Error(`Unsafe upstream file: ${entry.path}`);
  const response = await fetchImpl(`https://raw.githubusercontent.com/${repo}/${revision}/${entry.path.split('/').map(encodeURIComponent).join('/')}`);
  const data = Buffer.from(await response.arrayBuffer());
  const sha = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
  if (data.length !== entry.size || sha !== entry.sha) throw Error(`Upstream blob integrity mismatch: ${entry.path}`);
  return data;
}
function renameSkill(data, original, installed) {
  const text = data.toString('utf8'), match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw Error(`Missing frontmatter: ${original}`);
  const names = [...match[1].matchAll(/^name:\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\r\n]+))\s*$/gm)];
  if (names.length !== 1 || (names[0][1] ?? names[0][2] ?? names[0][3]).trim() !== original) throw Error(`Ambiguous or changed upstream skill name: ${original}`);
  return original === installed ? data : Buffer.from(text.replace(match[0], match[0].replace(names[0][0], `name: ${installed}`)));
}

function authorMarketplace(catalog, skills) {
  const groups = new Map();
  function add(source, skillPath) {
    const owner = source.split('/')[0].toLowerCase();
    const name = owner === 'mattpocock' ? 'matt-pocock' : owner;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(`./${safeRelative(skillPath)}`);
  }
  for (const skill of skills) add(skill.source, `skills/vendor/${skill.target}`);
  for (const source of catalog.sources.filter((entry) => owned(entry) && !entry.disabledReason)) {
    for (const skill of source.skills) add(source.source, `skills/${skill.name}`);
  }
  const plugins = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, paths]) => ({ name, source: './', skills: paths.sort() }));
  return Buffer.from(`${JSON.stringify({ name: 'crystal-skills', owner: { name: 'Crystal Desarrollo' }, plugins }, null, 2)}\n`);
}

async function build(catalog, original, stage, update, fetchImpl) {
  const enabled = catalog.sources.filter((source) => !source.disabledReason), names = new Map(), slugs = new Set(), installedNames = new Set(), files = {}, skills = [];
  for (const source of enabled) {
    const key = slug(source);
    if (slugs.has(key)) throw Error(`Colliding source slug: ${key}`);
    slugs.add(key);
    for (const skill of source.skills) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(skill.name)) throw Error(`Unsafe skill name: ${skill.name}`);
      names.set(skill.name, (names.get(skill.name) ?? 0) + 1);
      if (owned(source)) installedNames.add(skill.name);
    }
  }
  let total = 0;
  async function save(relative, data, mode = 0o644) {
    safeRelative(relative); total += data.length;
    if (total > maxBytes || Object.keys(files).length > 3000 || Object.hasOwn(files, relative)) throw Error('Snapshot size, count, or path collision limit.');
    const target = path.join(stage, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data, { flag: 'wx', mode }); await chmod(target, mode);
    files[relative] = { sha256: hash(data), mode };
  }
  for (const source of enabled.filter((entry) => !owned(entry))) {
    const metadata = await json(fetchImpl, `https://api.github.com/repos/${source.source}`), repo = metadata.full_name;
    if (!repoPattern.test(repo ?? '') || repo.includes('..')) throw Error(`Invalid canonical repository for ${source.id}`);
    if (update) {
      const candidate = await inspectSource({ ...source, source: repo }, fetchImpl);
      Object.assign(source, candidate, { licenseUrl: `https://github.com/${repo}/blob/${candidate.revision}/${candidate.licensePath}` });
    }
    const tree = await json(fetchImpl, `https://api.github.com/repos/${repo}/git/trees/${source.revision}?recursive=1`);
    if (tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > 100000) throw Error(`Incomplete upstream tree: ${source.id}`);
    const paths = new Set();
    for (const entry of tree.tree) {
      safeRelative(entry.path);
      if (paths.has(entry.path)) throw Error('Duplicate upstream tree path.'); paths.add(entry.path);
    }
    const licenseEntry = tree.tree.find((entry) => entry.path === source.licensePath);
    if (!licenseEntry) throw Error(`License notice missing: ${source.id}`);
    const license = await blob(fetchImpl, repo, source.revision, licenseEntry);
    for (const skill of source.skills) {
      const candidates = tree.tree.filter((entry) => entry.path.endsWith('/SKILL.md') && path.posix.basename(path.posix.dirname(entry.path)) === skill.name);
      if (candidates.length !== 1) throw Error(`Missing or ambiguous upstream path: ${source.id}/${skill.name}`);
      const sourcePath = path.posix.dirname(candidates[0].path), prefix = `${sourcePath}/`;
      const installed = names.get(skill.name) > 1 ? `${slug(source)}-${skill.name}` : skill.name;
      if (installedNames.has(installed)) throw Error(`Colliding installed skill name: ${installed}`); installedNames.add(installed);
      const target = `${slug(source)}/${installed}`, selected = tree.tree.filter((entry) => entry.path.startsWith(prefix) && entry.type !== 'tree');
      if (selected.length > 1000) throw Error(`Too many files for skill: ${installed}`);
      const provenance = { source: source.source, canonicalRepository: repo, revision: source.revision, sourcePath, originalName: skill.name, installedName: installed, license: source.license, licenseUrl: `https://github.com/${repo}/blob/${source.revision}/${source.licensePath}`, adaptations: installed === skill.name ? [] : ['Frontmatter name uses a source alias to avoid a collision.'] };
      // Fetch only files inside the selected skill, never execute their content.
      for (let offset = 0; offset < selected.length; offset += 6) {
        const batch = selected.slice(offset, offset + 6);
        const downloaded = await Promise.all(batch.map(async (entry) => ({ entry, data: await blob(fetchImpl, repo, source.revision, entry) })));
        for (const { entry, data } of downloaded) {
          const relative = entry.path.slice(prefix.length);
          if (['LICENSE.upstream', 'PROVENANCE.json'].includes(relative)) throw Error(`Reserved provenance path: ${entry.path}`);
          await save(`${target}/${relative}`, relative === 'SKILL.md' ? renameSkill(data, skill.name, installed) : data, entry.mode === '100755' ? 0o755 : 0o644);
        }
      }
      await save(`${target}/LICENSE.upstream`, license);
      await save(`${target}/PROVENANCE.json`, Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`));
      skills.push({ ...provenance, target });
    }
  }
  const catalogBytes = update ? Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`) : original;
  const marketplace = { bytes: authorMarketplace(catalog, skills), mode: 0o644 };
  const manifest = { schemaVersion: 1, catalogSha256: hash(catalogBytes), marketplace: { sha256: hash(marketplace.bytes), mode: marketplace.mode }, skills, files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) };
  await writeFile(path.join(stage, manifestName), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return { catalogBytes, marketplace, count: skills.length };
}

export async function runCli(argv, { root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), fetchImpl = globalThis.fetch, stdout = (text) => process.stdout.write(text), stderr = (text) => process.stderr.write(text) } = {}) {
  if (argv.length > 1 || (argv.length && !['--update', '--check', '--help'].includes(argv[0]))) { stderr(`Invalid sync option.\n${usage}`); return 2; }
  if (argv[0] === '--help') { stdout(usage); return 0; }
  const vendor = path.join(root, 'skills/vendor'), catalogFile = path.join(root, 'catalog.json'), lock = path.join(root, '.skills-sync.lock');
  const pluginParent = path.join(root, '.claude-plugin'), pluginFile = path.join(pluginParent, 'marketplace.json');
  let locked = false, movedOld = false, movedNew = false, replacedCatalog = false, replacedMarketplace = false, createdPluginParent = false, rollbackFailed = false;
  let originalMarketplace;
  try {
    await directory(root); await directory(path.join(root, 'skills')); await regular(catalogFile);
    if (await info(lock)) throw Error('Sync lock exists; another sync or interrupted transaction needs inspection.');
    if (argv[0] !== '--check') { await mkdir(lock); locked = true; }
    const original = await readFile(catalogFile), catalog = validateCatalog(JSON.parse(original));
    originalMarketplace = await readMarketplace(root);
    const before = await verify(vendor, original, argv[0] === '--check', originalMarketplace);
    if (argv[0] === '--check') { stdout(`Snapshot integrity verified: ${before.skills.length} skills.\n`); return 0; }
    const stage = path.join(lock, 'new-vendor'); await mkdir(stage);
    const { catalogBytes, marketplace, count } = await build(catalog, original, stage, argv[0] === '--update', publicFetch(fetchImpl));
    await verify(stage, catalogBytes, true, marketplace);
    // Recheck local files after network access; do not overwrite edits made during downloads.
    const currentMarketplace = await readMarketplace(root);
    const now = await verify(vendor, original, false, currentMarketplace);
    if (JSON.stringify(now) !== JSON.stringify(before) || !(await readFile(catalogFile)).equals(original)) throw Error('Local files changed during sync.');
    const nextManifest = await readFile(path.join(stage, manifestName));
    if (before && nextManifest.equals(await readFile(path.join(vendor, manifestName))) && original.equals(catalogBytes)) { stdout(`Already synchronized: ${count} skills.\n`); return 0; }
    await writeFile(path.join(lock, 'original-catalog'), original, { flag: 'wx', mode: (await regular(catalogFile)).mode & 0o777 });
    await writeFile(path.join(lock, 'new-catalog'), catalogBytes, { flag: 'wx', mode: (await regular(catalogFile)).mode & 0o777 });
    if (originalMarketplace) await writeFile(path.join(lock, 'original-marketplace'), originalMarketplace.bytes, { flag: 'wx', mode: originalMarketplace.mode });
    await writeFile(path.join(lock, 'new-marketplace'), marketplace.bytes, { flag: 'wx', mode: marketplace.mode });
    if (before) { await rename(vendor, path.join(lock, 'old-vendor')); movedOld = true; }
    await rename(stage, vendor); movedNew = true;
    if (!original.equals(catalogBytes)) { await rename(path.join(lock, 'new-catalog'), catalogFile); replacedCatalog = true; }
    if (!originalMarketplace || !originalMarketplace.bytes.equals(marketplace.bytes)) {
      if (!await info(pluginParent)) { await mkdir(pluginParent); createdPluginParent = true; }
      await directory(pluginParent);
      await rename(path.join(lock, 'new-marketplace'), pluginFile); replacedMarketplace = true;
    }
    stdout(`Synchronized ${count} skills at ${argv[0] === '--update' ? 'proposed latest revisions' : 'approved pins'}.\n`);
    return 0;
  } catch (error) {
    const restore = [];
    if (replacedMarketplace) restore.push(() => rename(originalMarketplace ? path.join(lock, 'original-marketplace') : pluginFile, originalMarketplace ? pluginFile : path.join(lock, 'failed-marketplace')));
    if (createdPluginParent) restore.push(() => rmdir(pluginParent));
    if (replacedCatalog) restore.push(() => rename(path.join(lock, 'original-catalog'), catalogFile));
    if (movedNew) restore.push(() => rename(vendor, path.join(lock, 'failed-vendor')));
    if (movedOld) restore.push(() => rename(path.join(lock, 'old-vendor'), vendor));
    for (const operation of restore) {
      try { await operation(); } catch { rollbackFailed = true; }
    }
    stderr(`${error.message}${rollbackFailed ? ' Recovery backup retained in .skills-sync.lock; inspect before retrying.' : ''}\n`);
    return 1;
  } finally {
    if (locked && !rollbackFailed) await rm(lock, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runCli(process.argv.slice(2));
