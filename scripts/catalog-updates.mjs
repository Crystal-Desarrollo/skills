import { readFile, lstat, open, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.github.com';
const shaPattern = /^[a-f0-9]{40}$/i;
const sourceIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/;
const usage = 'Usage: node scripts/catalog-updates.mjs (--check | --write) [--catalog PATH]\n';

export function validateCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog) || catalog.schemaVersion !== 1 || !Array.isArray(catalog.sources)) throw new Error('Invalid catalog: expected schemaVersion 1 and sources array.');
  const ids = new Set();
  for (const source of catalog.sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source) || !sourceIdPattern.test(source.id ?? '') || ids.has(source.id)) throw new Error('Invalid catalog: source IDs must be unique safe slugs or owner/repo IDs.');
    ids.add(source.id);
    if (typeof source.source !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.source) || source.source.includes('..')) throw new Error(`Invalid source path for ${source.id}.`);
    if (!Array.isArray(source.skills) || source.skills.some((skill) => !skill || typeof skill !== 'object' || typeof skill.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(skill.name))) throw new Error(`Invalid skills for ${source.id}.`);
    if (source.disabledReason !== undefined) {
      if (typeof source.disabledReason !== 'string' || !source.disabledReason.trim() || (source.revision !== null && !shaPattern.test(source.revision ?? '')) || source.license !== null) throw new Error(`Invalid disabled source ${source.id}.`);
    } else if (!shaPattern.test(source.revision ?? '') || typeof source.license !== 'string' || !source.license.trim() || typeof source.licenseUrl !== 'string' || !source.licenseUrl.startsWith('https://')) throw new Error(`Invalid pins for enabled source ${source.id}.`);
    if (source.licensePath !== undefined && (typeof source.licensePath !== 'string' || source.licensePath.startsWith('/') || source.licensePath.split('/').includes('..'))) throw new Error(`Invalid licensePath for ${source.id}.`);
  }
  return catalog;
}

function parseArgs(argv) {
  let mode;
  let catalogPath;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check' || arg === '--write') {
      if (mode) throw new Error(`Conflicting or repeated mode option: ${arg}`);
      mode = arg;
    } else if (arg === '--catalog') {
      if (catalogPath || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Option --catalog requires one path and may appear once.');
      catalogPath = argv[++i];
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (!mode) throw new Error('Select exactly one mode: --check or --write.');
  return { mode, catalogPath };
}

async function githubJson(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }, redirect: 'error' });
  if (!response.ok) throw new Error(`GitHub request failed with HTTP ${response.status}.`);
  return response.json();
}

function rawLicenseUrl(source, revision, licensePath) {
  return `https://raw.githubusercontent.com/${source}/${revision}/${licensePath}`;
}

export async function inspectSource(source, fetchImpl) {
  const [owner, repo] = source.source.split('/');
  const root = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const repoData = await githubJson(fetchImpl, root);
  if (typeof repoData.default_branch !== 'string' || !repoData.default_branch) throw new Error(`GitHub returned no default branch for ${source.source}.`);
  const commit = await githubJson(fetchImpl, `${root}/commits/${encodeURIComponent(repoData.default_branch)}`);
  if (!shaPattern.test(commit.sha ?? '')) throw new Error(`GitHub returned an invalid revision for ${source.source}.`);
  const revision = commit.sha.toLowerCase();
  const licenseInfo = await githubJson(fetchImpl, `${root}/license?ref=${encodeURIComponent(revision)}`);
  const spdx = licenseInfo.license?.spdx_id;
  if (typeof spdx !== 'string' || !spdx || spdx === 'NOASSERTION') throw new Error(`License is unknown at candidate revision for ${source.source}.`);
  const licensePath = source.licensePath ?? licenseInfo.path ?? 'LICENSE';
  if (typeof licenseInfo.path !== 'string' || licenseInfo.path !== licensePath) throw new Error(`License path changed or cannot be verified for ${source.source}; review required.`);
  if (spdx !== source.license) throw new Error(`License changed from ${source.license} to ${spdx} for ${source.source}; review required.`);
  return { revision, license: spdx, licensePath, licenseUrl: rawLicenseUrl(source.source, revision, licensePath) };
}

function summary(source, candidate) {
  const old = source.revision;
  const base = `https://github.com/${source.source}`;
  return `${source.id}: ${old} -> ${candidate.revision}\n  Source: ${base}/compare/${old}...${candidate.revision}\n  License: ${base}/compare/${old}:${candidate.licensePath}...${candidate.revision}:${candidate.licensePath}\n  Content: ${base}/compare/${old}...${candidate.revision}`;
}

async function atomicWrite(target, content) {
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Catalog target must be a regular non-symlink file.');
  const handle = await open(target, 'r+');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Catalog target changed and is not a regular file.');
  } finally { await handle.close(); }
  // Keep replacement beside the target so rename is atomic on the same filesystem.
  const temp = `${target}.proposal-${process.pid}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeFile(temp, content, { flag: 'wx', mode: info.mode & 0o777 });
    await rename(temp, target);
  } catch (error) {
    try { await unlink(temp); } catch { /* No temporary file remains when creation failed. */ }
    throw error;
  }
}

export async function runCli(argv, { catalogPath, fetchImpl = globalThis.fetch, stdout = (text) => process.stdout.write(text), stderr = (text) => process.stderr.write(text) } = {}) {
  let parsed;
  try { parsed = parseArgs(argv); } catch (error) { stderr(`${error.message}\n${usage}`); return 2; }
  const target = path.resolve(catalogPath ?? parsed.catalogPath ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'catalog.json'));
  let original;
  try {
    const targetInfo = await lstat(target);
    if (!targetInfo.isFile() || targetInfo.isSymbolicLink()) throw new Error('Catalog target must be a regular non-symlink file.');
    original = await readFile(target, 'utf8');
    const catalog = validateCatalog(JSON.parse(original));
    const updates = [];
    const messages = [];
    for (const source of catalog.sources) {
      if (source.disabledReason !== undefined) { messages.push(`${source.id}: disabled (${source.disabledReason}); skipped`); continue; }
      const candidate = await inspectSource(source, fetchImpl);
      if (candidate.revision !== source.revision || candidate.licenseUrl !== source.licenseUrl) updates.push({ source, candidate });
      else messages.push(`${source.id}: current (${source.revision})`);
    }
    if (parsed.mode === '--check') {
      for (const { source, candidate } of updates) messages.push(summary(source, candidate));
      stdout(`${messages.length ? messages.join('\n') : 'No sources to check.'}\n`);
      return 0;
    }
    if (!updates.length) { stdout('No updates available; catalog unchanged.\n'); return 0; }
    const report = updates.map(({ source, candidate }) => summary(source, candidate)).join('\n');
    for (const { source, candidate } of updates) Object.assign(source, candidate);
    await atomicWrite(target, `${JSON.stringify(catalog, null, 2)}\n`);
    stdout(`${report}\n`);
    return 0;
  } catch (error) {
    stderr(`${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runCli(process.argv.slice(2));
