#!/usr/bin/env node
import React, { useRef, useState } from 'react';
import { render, Text, useApp, useInput } from 'ink';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Writable } from 'node:stream';

export type Skill = { name: string; description?: string; disabledReason?: string };
export type Source = {
  id: string; source: string; revision: string | null; license: string | null;
  licenseUrl: string; licensePath?: string; skills: Skill[]; disabledReason?: string;
};
export type Catalog = { schemaVersion: number; sources: Source[] };
export type InstallerRequest = { source: string; revision: string; skills: string[]; agents: string[]; staging: string; env: NodeJS.ProcessEnv };
type Entry = { id: string; source: Source; skill: Skill };
type RecordFile = { schemaVersion: number; selections: string[]; agents: string[]; managedFiles: Record<string, string>; sources: Array<{ id: string; revision: string; license: string; licenseUrl: string }>; checksum: string };
type NativeLock = { version: number; skills: Record<string, Record<string, unknown>>; [key: string]: unknown };
type Options = { command: string; skills: string[]; agents: string[]; commit: boolean };
type Dependencies = {
  cwd?: string; catalog?: Catalog; stdout?: Writable; stderr?: Writable; isTTY?: boolean; scratchRoot?: string;
  env?: NodeJS.ProcessEnv;
  installer?: (request: InstallerRequest) => Promise<void>;
  fetchLicense?: (source: Source) => Promise<string>;
  select?: (entries: Entry[]) => Promise<string[] | null>;
};

const defaultCatalog = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url), 'utf8')) as Catalog;
const supportedAgents = new Set([
  'aider-desk','amp','antigravity','antigravity-cli','astrbot','autohand-code','augment','bob','claude-code','openclaw','cline','codearts-agent','codebuddy','codemaker','codestudio','codex','command-code','continue','cortex','crush','cursor','deepagents','devin','dexto','droid','eve','firebender','forgecode','fx','gemini-cli','github-copilot','goose','grok','hermes-agent','inference-sh','jazz','junie','iflow-cli','kilo','kimchi','kimi-code-cli','kiro-cli','kode','lingma','loaf','mcpjam','minimax-code','mistral-vibe','moxby','mux','opencode','openhands','ona','pi','posit-assistant','qoder','qoder-cn','qwen-code','replit','reasonix','rovodev','roo','sarvam-code','tabnine-cli','terramind','tinycloud','trae','trae-cn','warp','windsurf','zed','zcode','zencoder','zenflow','neovate','pochi','promptscript','adal','universal',
]);
const help = `crystal-skills <list|init|update> [options]

Commands:
  list                    Show catalog entries and availability
  init                    Select and install catalog skills
  update                  Update recorded selections to packaged pins

Options:
  --skill <source/name>   Repeat for explicit noninteractive selection
  --agent <agent>         Repeat for supported agent (default: opencode)
  --commit                Commit only generated files; never stages by default
  --help                  Show this help

Examples:
  crystal-skills list
  crystal-skills init --skill crystal-desarrollo/skills/shadcn-audit --agent opencode
  crystal-skills update --commit`;
const recordName = '.company-skills.json';
const lockName = 'skills-lock.json';
class CommitIndexRestoreError extends Error {}

function sha256(body: string | Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}
function fail(message: string): never { throw new Error(message); }

function validateCatalog(catalog: Catalog): Entry[] {
  if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.sources)) fail('Invalid catalog schema');
  const sourceIds = new Set<string>();
  const selectionIds = new Set<string>();
  const entries: Entry[] = [];
  for (const source of catalog.sources) {
    if (!source || typeof source.id !== 'string' || !/^[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9.-]*$/i.test(source.id)) fail('Invalid source id');
    if (sourceIds.has(source.id)) fail(`Duplicate source id: ${source.id}`);
    sourceIds.add(source.id);
    if (typeof source.source !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.source)) fail(`Invalid source path: ${source.id}`);
    if (!Array.isArray(source.skills)) fail(`Invalid skills list: ${source.id}`);
    const revisionOk = source.revision === null || /^[0-9a-f]{40}$/.test(source.revision);
    if (!revisionOk) fail(`Invalid revision: ${source.id}`);
    if (source.license !== null && (typeof source.license !== 'string' || !/^[A-Za-z0-9.+-]+$/.test(source.license))) fail(`Invalid license: ${source.id}`);
    if (typeof source.licenseUrl !== 'string' || !source.licenseUrl.startsWith('https://')) fail(`Invalid license URL: ${source.id}`);
    if (source.licensePath !== undefined && (!safeRelative(source.licensePath) || source.licensePath.includes('..'))) fail(`Invalid license path: ${source.id}`);
    if ((source.revision === null || source.license === null) && !source.disabledReason) fail(`Unavailable source needs disabledReason: ${source.id}`);
    if (source.revision && source.license && (!source.licensePath || !source.licenseUrl.includes(`/blob/${source.revision}/${source.licensePath}`))) fail(`License URL must name the pinned source revision and license path: ${source.id}`);
    for (const skill of source.skills) {
      if (!skill || typeof skill.name !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(skill.name)) fail(`Invalid skill name in ${source.id}`);
      const id = `${source.id}/${skill.name}`;
      if (selectionIds.has(id)) fail(`Duplicate selection id: ${id}`);
      selectionIds.add(id);
      entries.push({ id, source, skill });
    }
  }
  return entries;
}

function safeRelative(path: string): boolean {
  return Boolean(path) && !path.startsWith('/') && !/^[A-Za-z]:/.test(path) && !path.includes('\\') && !path.includes('\0') && path.split('/').every(part => part && part !== '.' && part !== '..');
}
function projectPath(root: string, path: string): string {
  if (!safeRelative(path)) fail(`Unsafe relative path: ${path}`);
  const target = resolve(root, path);
  if (!target.startsWith(`${resolve(root)}${sep}`)) fail(`Path escapes project: ${path}`);
  return target;
}
function assertNoSymlinkPath(root: string, path: string): void {
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) fail(`Refusing symlink path: ${relative(root, current)}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
function validateRecord(value: unknown): RecordFile {
  if (!value || typeof value !== 'object') fail('Invalid .company-skills.json record');
  const record = value as RecordFile;
  if (record.schemaVersion !== 1 || !Array.isArray(record.selections) || !Array.isArray(record.agents) || !Array.isArray(record.sources) || !record.managedFiles || typeof record.managedFiles !== 'object' || Array.isArray(record.managedFiles)) fail('Invalid .company-skills.json record');
  if (new Set(record.selections).size !== record.selections.length || new Set(record.agents).size !== record.agents.length) fail('Record contains duplicate selections or agents');
  if (new Set(record.sources.map(source => source.id)).size !== record.sources.length) fail('Record contains duplicate source entries');
  for (const path of Object.keys(record.managedFiles)) if (!safeRelative(path)) fail(`Invalid managed path: ${path}`);
  const { checksum, ...content } = record;
  if (typeof checksum !== 'string' || checksum !== sha256(JSON.stringify(content))) fail('Selection record checksum does not match');
  return record;
}
function parseArgs(argv: string[]): Options {
  const args = [...argv];
  const command = args.shift();
  if (command === '--help' || command === '-h') return { command: 'help', skills: [], agents: [], commit: false };
  if (!['list', 'init', 'update'].includes(command ?? '')) fail('Expected list, init, or update');
  const skills: string[] = [], agents: string[] = [];
  let commit = false;
  while (args.length) {
    const option = args.shift()!;
    if (option === '--help' || option === '-h') return { command: 'help', skills: [], agents: [], commit: false };
    if (option === '--commit') { commit = true; continue; }
    if (option === '--skill' || option === '--agent') {
      const value = args.shift();
      if (!value || value.startsWith('--')) fail(`${option} requires a value`);
      (option === '--skill' ? skills : agents).push(value);
      continue;
    }
    fail(`Unknown option: ${option}`);
  }
  if (command === 'list' && (skills.length || agents.length || commit)) fail('list does not accept --skill, --agent, or --commit');
  if (command === 'update' && skills.length) fail('update does not accept --skill; it uses recorded selections');
  if (command === 'update' && agents.length) fail('update does not accept --agent; it uses recorded agents');
  if (command === 'init' && new Set(skills).size !== skills.length) fail('Duplicate skill selection');
  if (new Set(agents).size !== agents.length) fail('Duplicate agent selection');
  return { command: command!, skills, agents, commit };
}

export function Selection({ entries, initial, onDone }: { entries: Entry[]; initial: string[]; onDone: (ids: string[] | null) => void }) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState(new Set(initial));
  const queryRef = useRef(query);
  const cursorRef = useRef(cursor);
  const selectedRef = useRef(selected);
  queryRef.current = query;
  cursorRef.current = cursor;
  selectedRef.current = selected;
  const { exit } = useApp();
  const visible = entries.filter(entry => `${entry.id} ${entry.skill.description ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  useInput((input, key) => {
    if (key.escape) { onDone(null); exit(); return; }
    if (key.return) { onDone([...selectedRef.current]); exit(); return; }
    const currentVisible = entries.filter(entry => `${entry.id} ${entry.skill.description ?? ''}`.toLowerCase().includes(queryRef.current.toLowerCase()));
    if (key.upArrow) { cursorRef.current = Math.max(0, cursorRef.current - 1); setCursor(cursorRef.current); }
    if (key.downArrow) { cursorRef.current = Math.min(Math.max(currentVisible.length - 1, 0), cursorRef.current + 1); setCursor(cursorRef.current); }
    if (key.backspace || key.delete) { queryRef.current = queryRef.current.slice(0, -1); setQuery(queryRef.current); cursorRef.current = 0; setCursor(0); return; }
    if (input === ' ') {
      const entry = currentVisible[cursorRef.current];
      const id = entry?.id;
      if (id && entry && !entry.source.disabledReason && !entry.skill.disabledReason) {
        const next = new Set(selectedRef.current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        selectedRef.current = next;
        setSelected(next);
      }
    } else if (input && !key.ctrl && !key.meta && !key.return) { queryRef.current += input; setQuery(queryRef.current); cursorRef.current = 0; setCursor(0); }
  });
  return React.createElement(React.Fragment, null,
    React.createElement(Text, null, `Search: ${query} | arrows move, space toggles, enter confirms, escape cancels`),
    ...visible.map((entry, index) => React.createElement(Text, { key: entry.id, color: index === cursor ? 'cyan' : undefined }, `${index === cursor ? '›' : ' '} [${selected.has(entry.id) ? 'x' : ' '}] ${entry.id}${entry.source.disabledReason || entry.skill.disabledReason ? ' (unavailable)' : ''}`)),
  );
}

function writeOut(stream: Writable | undefined, value: string): void {
  if (stream) stream.write(value);
  else process.stdout.write(value);
}
function writeErr(stream: Writable | undefined, value: string): void {
  if (stream) stream.write(value);
  else process.stderr.write(value);
}

function stagingEnv(env: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = { PATH: env.PATH, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local/share'), GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'https:http', CI: '1' };
  if (env.TMPDIR) safe.TMPDIR = env.TMPDIR;
  return safe;
}
async function publishedInstaller(request: InstallerRequest): Promise<void> {
  const args = ['dlx', 'skills@1.7.4', 'add', `${request.source}#${request.revision}`];
  for (const skill of request.skills) args.push('--skill', skill);
  for (const agent of request.agents) args.push('--agent', agent);
  args.push('--yes', '--copy');
  const result = spawnSync('pnpm', args, { cwd: request.staging, encoding: 'utf8', env: request.env, stdio: 'pipe' });
  if (result.status !== 0) fail(`skills@1.7.4 failed (${result.status ?? result.signal}): ${(result.stderr || result.stdout).trim()}`);
}
async function fetchPinnedLicense(source: Source): Promise<string> {
  if (!source.licensePath) fail(`Missing licensePath for ${source.id}`);
  const url = `https://raw.githubusercontent.com/${source.source}/${source.revision}/${source.licensePath}`;
  const response = await fetch(url, { headers: { Accept: 'text/plain' } });
  if (!response.ok) fail(`License fetch failed for ${source.id}: HTTP ${response.status}`);
  const text = await response.text();
  if (!text.trim()) fail(`Empty license text for ${source.id}`);
  return text;
}
function readRecord(root: string): RecordFile | null {
  const path = join(root, recordName);
  if (!existsSync(path)) return null;
  assertNoSymlinkPath(root, recordName);
  try { return validateRecord(JSON.parse(readFileSync(path, 'utf8'))); }
  catch (error) { fail(`Cannot read selection record: ${error instanceof Error ? error.message : String(error)}`); }
}
function collectFiles(root: string, from = root): Map<string, Buffer> {
  const found = new Map<string, Buffer>();
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const absolute = join(directory, name);
      const rel = relative(root, absolute).split(sep).join('/');
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) fail(`Installer created symlink: ${rel}`);
      if (stat.isDirectory()) visit(absolute);
      else if (stat.isFile()) found.set(rel, readFileSync(absolute));
      else fail(`Installer created unsupported file: ${rel}`);
    }
  };
  visit(from);
  return found;
}
function collectModes(root: string): Map<string, number> {
  const modes = new Map<string, number>();
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const absolute = join(directory, name);
      const stat = lstatSync(absolute);
      if (stat.isDirectory()) visit(absolute);
      else if (stat.isFile()) modes.set(relative(root, absolute).split(sep).join('/'), stat.mode & 0o777);
    }
  };
  visit(root);
  return modes;
}
function mergeNativeLock(existing: NativeLock | null, staged: NativeLock, selectedNames: Set<string>): NativeLock {
  if (!staged || staged.version !== 1 || !staged.skills || typeof staged.skills !== 'object') fail('Published installer returned an invalid skills-lock.json');
  const merged: NativeLock = existing ? { ...existing, skills: { ...existing.skills } } : { ...staged, skills: {} };
  if (!merged.skills || typeof merged.skills !== 'object' || Array.isArray(merged.skills)) fail('Existing skills-lock.json has invalid skills');
  for (const [name, entry] of Object.entries(staged.skills)) if (selectedNames.has(name)) merged.skills[name] = entry;
  for (const name of selectedNames) if (!merged.skills[name] || !staged.skills[name]) fail(`Published installer did not lock selected skill ${name}`);
  return merged;
}
function relativeSkillPaths(files: Map<string, Buffer>): string[] {
  return [...files.keys()].filter(path => /(?:^|\/)skills\/[^/]+\/SKILL\.md$/i.test(path));
}
function validateInstallOutputs(files: Map<string, Buffer>, chosen: Entry[], agents: string[]): void {
  const paths = relativeSkillPaths(files);
  if (!paths.length) fail('Installer produced no skill files');
  const selectedNames = new Set(chosen.map(entry => entry.skill.name));
  for (const path of files.keys()) {
    if (path === lockName) continue;
    const parts = path.split('/');
    const skillsIndex = parts.lastIndexOf('skills');
    if (skillsIndex < 0 || !selectedNames.has(parts[skillsIndex + 1] ?? '')) fail(`Unexpected installer output path: ${path}`);
  }
  for (const entry of chosen) {
    if (!paths.some(path => path.split('/').includes(entry.skill.name))) fail(`Installer did not install selected skill ${entry.skill.name}`);
  }
  const actualAgents = new Set(agents);
  if (!actualAgents.size) fail('No agents selected');
}
function recordChecksum(record: Omit<RecordFile, 'checksum'>): RecordFile {
  return { ...record, checksum: sha256(JSON.stringify(record)) };
}
function ensureGitRoot(root: string): void {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0 || realpathSync(result.stdout.trim()) !== root) fail('--commit requires the current directory to be a Git repository root');
}
function hasStagedChanges(root: string, paths: string[]): boolean {
  if (!paths.length) return false;
  const result = spawnSync('git', ['diff', '--cached', '--quiet', '--', ...paths], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  if (result.status === 1) return true;
  if (result.status !== 0) fail(`Cannot inspect staged paths: ${result.stderr}`);
  return false;
}
function commitScoped(root: string, files: string[], stage: string): void {
  ensureGitRoot(root);
  if (hasStagedChanges(root, files)) fail('Refusing --commit because an intended output path already has staged changes');
  const indexPath = join(stage, 'git-index');
  const indexResult = spawnSync('git', ['rev-parse', '--git-path', 'index'], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  if (indexResult.status !== 0) fail(`Cannot locate Git index: ${indexResult.stderr}`);
  const originalIndex = resolve(root, indexResult.stdout.trim());
  const stagedPatchResult = spawnSync('git', ['diff', '--cached', '--binary'], { cwd: root, encoding: 'buffer', stdio: 'pipe' });
  if (stagedPatchResult.status !== 0) fail(`Cannot capture staged changes: ${stagedPatchResult.stderr}`);
  const stagedPatch = Buffer.from(stagedPatchResult.stdout);
  if (existsSync(originalIndex)) copyFileSync(originalIndex, indexPath);
  const env = { ...process.env, GIT_INDEX_FILE: indexPath };
  const add = spawnSync('git', ['add', '--', ...files], { cwd: root, encoding: 'utf8', env, stdio: 'pipe' });
  if (add.status !== 0) fail(`Scoped git add failed (${add.status ?? add.signal}): ${(add.stderr || add.stdout).trim()}`);
  const result = spawnSync('git', ['commit', '--only', '-m', 'feat(skills): install selected company skills', '--', ...files], { cwd: root, encoding: 'utf8', env, stdio: 'pipe' });
  if (result.status !== 0) fail(`git commit failed (${result.status ?? result.signal}): ${(result.stderr || result.stdout).trim()}`);
  try {
    const restoredIndex = join(stage, 'restored-index');
    const restoreEnv = { ...process.env, GIT_INDEX_FILE: restoredIndex };
    const readTree = spawnSync('git', ['read-tree', 'HEAD'], { cwd: root, encoding: 'utf8', env: restoreEnv, stdio: 'pipe' });
    if (readTree.status !== 0) fail(`Cannot rebuild index after scoped commit: ${readTree.stderr}`);
    if (stagedPatch.length) {
      const patchPath = join(stage, 'unrelated-staged.patch');
      writeFileSync(patchPath, stagedPatch);
      const apply = spawnSync('git', ['apply', '--cached', '--binary', patchPath], { cwd: root, encoding: 'utf8', env: restoreEnv, stdio: 'pipe' });
      if (apply.status !== 0) fail(`Cannot restore unrelated staged changes after scoped commit: ${apply.stderr}`);
    }
    const nextIndex = `${originalIndex}.company-skills-${process.pid}`;
    copyFileSync(restoredIndex, nextIndex);
    renameSync(nextIndex, originalIndex);
  } catch (error) {
    throw new CommitIndexRestoreError(`Commit was created, but unrelated staged index restoration failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function installPlan(root: string, ids: string[], agents: string[], update: boolean, commit: boolean, deps: Dependencies, entries: Entry[], previous: RecordFile | null): Promise<void> {
  if (!ids.length) fail('Select at least one installable skill');
  if (new Set(ids).size !== ids.length) fail('Duplicate skill selection');
  if (!agents.length || new Set(agents).size !== agents.length || agents.some(agent => !supportedAgents.has(agent))) fail('Invalid agent selection');
  const chosen = ids.map(id => {
    const entry = entries.find(item => item.id === id);
    if (!entry) fail(`Unknown skill selection: ${id}`);
    if (entry.source.disabledReason || entry.skill.disabledReason || !entry.source.revision || !entry.source.license) fail(`Skill is not installable: ${id}${entry.source.disabledReason ? ` — ${entry.source.disabledReason}` : ''}${entry.skill.disabledReason ? ` — ${entry.skill.disabledReason}` : ''}`);
    return entry;
  });
  if (commit) ensureGitRoot(root);
  const selectedNames = new Set(chosen.map(entry => entry.skill.name));
  if (selectedNames.size !== chosen.length) fail('Selected skills have colliding installed names');
  const nameOwners = new Map<string, string>();
  for (const entry of chosen) {
    const key = entry.skill.name.toLowerCase();
    const previousId = nameOwners.get(key);
    if (previousId) fail(`Selected skills collide at installed name ${entry.skill.name}: ${previousId} and ${entry.id}`);
    nameOwners.set(key, entry.id);
  }
  const desiredSources = [...new Map(chosen.map(entry => [entry.source.id, { id: entry.source.id, revision: entry.source.revision!, license: entry.source.license!, licenseUrl: entry.source.licenseUrl }])).values()];
  if (previous && previous.selections.join('\0') === ids.join('\0') && previous.agents.join('\0') === agents.join('\0') && JSON.stringify(previous.sources) === JSON.stringify(desiredSources)) {
    const unchanged = Object.entries(previous.managedFiles).every(([path, hash]) => {
      const target = projectPath(root, path);
      return existsSync(target) && lstatSync(target).isFile() && sha256(readFileSync(target)) === hash;
    });
    if (unchanged) { writeOut(deps.stdout, 'Selection is already up to date; no changes.\n'); return; }
  }
  const sandbox = mkdtempSync(join(deps.scratchRoot ?? tmpdir(), 'company-skills-stage-'));
  const stage = join(sandbox, 'project');
  const home = join(sandbox, 'home');
  mkdirSync(stage);
  mkdirSync(home);
  const env = stagingEnv(deps.env ?? process.env, home);
  const groups = new Map<string, Entry[]>();
  for (const entry of chosen) groups.set(entry.source.id, [...(groups.get(entry.source.id) ?? []), entry]);
  const installer = deps.installer ?? publishedInstaller;
  for (const group of groups.values()) {
    const first = group[0];
    await installer({ source: first.source.source, revision: first.source.revision!, skills: group.map(entry => entry.skill.name), agents, staging: stage, env });
  }
  const staged = collectFiles(stage);
  const fileModes = collectModes(stage);
  staged.delete('git-index');
  const nativeFile = staged.get(lockName);
  if (!nativeFile) fail('Published installer did not create skills-lock.json');
  let stagedLock: NativeLock;
  try { stagedLock = JSON.parse(nativeFile.toString('utf8')) as NativeLock; } catch { fail('Published installer created malformed skills-lock.json'); }
  validateInstallOutputs(staged, chosen, agents);
  const existingLockPath = join(root, lockName);
  let existingLock: NativeLock | null = null;
  if (existsSync(existingLockPath)) {
    assertNoSymlinkPath(root, lockName);
    try {
      const parsed = JSON.parse(readFileSync(existingLockPath, 'utf8')) as NativeLock;
      if (parsed.version !== 1 || !parsed.skills || typeof parsed.skills !== 'object' || Array.isArray(parsed.skills)) fail('Existing skills-lock.json is malformed');
      existingLock = parsed;
    } catch (error) { fail(`Cannot read native skills lock: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const mergedLock = mergeNativeLock(existingLock, stagedLock!, selectedNames);
  if (existingLock && !previous?.managedFiles[lockName]) {
    for (const name of selectedNames) if (existingLock.skills[name]) fail(`Native lock already contains unmanaged skill ${name}; refusing to replace it`);
  }
  staged.set(lockName, Buffer.from(`${JSON.stringify(mergedLock, null, 2)}\n`));
  for (const group of groups.values()) {
    const source = group[0].source;
    const licenseBody = await (deps.fetchLicense ?? fetchPinnedLicense)(source);
    const licenseTarget = `.company-skills/licenses/${source.id.replace(/[^A-Za-z0-9._-]/g, '-')}/LICENSE`;
    if (staged.has(licenseTarget)) fail(`License path collision: ${licenseTarget}`);
    staged.set(licenseTarget, Buffer.from(licenseBody));
    fileModes.set(licenseTarget, 0o644);
  }
  const fileHashes: Record<string, string> = {};
  for (const [path, body] of staged) {
    if (!safeRelative(path) || path === recordName || path.startsWith('.company-skills-staging/')) fail(`Invalid installer output path: ${path}`);
    projectPath(root, path);
    assertNoSymlinkPath(root, path);
    fileHashes[path] = sha256(body);
  }
  const { checksum: _previousChecksum, ...previousMetadata } = previous ?? {} as RecordFile;
  const nextRecordBase = {
    ...previousMetadata,
    schemaVersion: 1, selections: ids, agents,
    managedFiles: { ...(previous?.managedFiles ?? {}), ...fileHashes },
    sources: desiredSources,
  };
  const nextRecord = recordChecksum(nextRecordBase);
  const recordBytes = Buffer.from(`${JSON.stringify(nextRecord, null, 2)}\n`);
  const recordHash = sha256(recordBytes);
  const allWrites = new Map(staged);
  allWrites.set(recordName, recordBytes);
  fileModes.set(recordName, 0o644);
  const changed: Array<{ path: string; bytes: Buffer; existed: boolean }> = [];
  for (const [path, body] of allWrites) {
    const target = projectPath(root, path);
    assertNoSymlinkPath(root, path);
    if (!existsSync(target) && previous?.managedFiles[path]) fail(`Managed file is missing: ${path}`);
    if (existsSync(target)) {
      if (!statSync(target).isFile()) fail(`Refusing to overwrite non-file managed path: ${path}`);
      const oldBytes = readFileSync(target);
      if (sha256(oldBytes) === sha256(body)) continue;
      if (path === recordName && previous) { changed.push({ path, bytes: oldBytes, existed: true }); continue; }
      if (path === lockName && !previous?.managedFiles[path]) { changed.push({ path, bytes: oldBytes, existed: true }); continue; }
      const oldHash = previous?.managedFiles[path];
      if (!oldHash || oldHash !== sha256(oldBytes)) fail(`Refusing locally modified managed file: ${path}`);
      changed.push({ path, bytes: oldBytes, existed: true });
    } else {
      changed.push({ path, bytes: Buffer.alloc(0), existed: false });
    }
  }
  const exactPaths = [...allWrites.keys()];
  if (commit && hasStagedChanges(root, exactPaths)) fail('Refusing --commit because an intended output path already has staged changes');
  const temporaries: Array<{ temp: string; target: string; path: string }> = [];
  const createdDirectories: string[] = [];
  const applied = new Set<string>();
  try {
    for (const [path, body] of allWrites) {
      const target = projectPath(root, path);
      if (existsSync(target) && readFileSync(target).equals(body)) continue;
      let directory = dirname(target);
      const missing: string[] = [];
      while (directory !== root && !existsSync(directory)) { missing.push(directory); directory = dirname(directory); }
      mkdirSync(dirname(target), { recursive: true });
      createdDirectories.push(...missing);
      const temp = join(dirname(target), `.company-skills-tmp-${process.pid}-${Math.random().toString(16).slice(2)}`);
      writeFileSync(temp, body, { flag: 'wx', mode: fileModes.get(path) ?? 0o644 });
      chmodSync(temp, fileModes.get(path) ?? 0o644);
      temporaries.push({ temp, target, path });
    }
    for (const item of temporaries) { renameSync(item.temp, item.target); applied.add(item.target); }
    if (commit) commitScoped(root, exactPaths, stage);
  } catch (error) {
    if (error instanceof CommitIndexRestoreError) throw error;
    for (const item of [...temporaries].reverse()) {
      try {
        if (existsSync(item.temp)) unlinkSync(item.temp);
        if (applied.has(item.target) && existsSync(item.target)) {
          const prior = changed.find(change => change.path === item.path);
          if (prior?.existed) writeFileSync(item.target, prior.bytes);
          else unlinkSync(item.target);
        }
      } catch { /* preserve the primary failure; report rollback risk in the thrown error */ }
    }
    for (const directory of createdDirectories.sort((a, b) => b.length - a.length)) {
      try { rmdirSync(directory); } catch { /* only empty directories created by this transaction are removed */ }
    }
    throw error;
  }
  writeOut(deps.stdout, `Installed ${chosen.length} skill(s) for ${agents.join(', ')}.\n`);
}

async function runTui(entries: Entry[], deps: Dependencies): Promise<string[] | null> {
  if (!deps.isTTY) fail('Interactive selection requires a TTY. Supply --skill flags for noninteractive use.');
  if (deps.select) return deps.select(entries);
  let selected: string[] | null = null;
  const app = render(React.createElement(Selection, { entries, initial: [], onDone: value => { selected = value; } }));
  await app.waitUntilExit();
  return selected;
}

export async function run(argv: string[], dependencies: Dependencies = {}): Promise<{ code: number }> {
  const stdout = dependencies.stdout, stderr = dependencies.stderr;
  try {
    const options = parseArgs(argv);
    if (options.command === 'help') { writeOut(stdout, `${help}\n`); return { code: 0 }; }
    const root = realpathSync(dependencies.cwd ?? process.cwd());
    const entries = validateCatalog(dependencies.catalog ?? defaultCatalog);
    if (options.command === 'list') {
      for (const entry of entries) {
        const unavailable = entry.source.disabledReason ?? entry.skill.disabledReason;
        writeOut(stdout, `${entry.id}${unavailable ? ` — unavailable: ${unavailable}` : ''}\n`);
      }
      return { code: 0 };
    }
    const previous = readRecord(root);
    let ids: string[];
    let agents: string[];
    if (options.command === 'update') {
      if (!previous) fail(`No ${recordName} selection record exists`);
      ids = previous.selections;
      agents = previous.agents;
    } else {
      ids = options.skills.length ? options.skills : (await runTui(entries, dependencies) ?? []);
      if (!ids.length) { writeOut(stdout, 'Cancelled.\n'); return { code: 0 }; }
      agents = options.agents.length ? options.agents : ['opencode'];
    }
    await installPlan(root, ids, agents, options.command === 'update', options.commit, dependencies, entries, previous);
    return { code: 0 };
  } catch (error) {
    writeErr(stderr, `${error instanceof Error ? error.message : String(error)}\n`);
    return { code: 1 };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const isTTY = Boolean(process.stdin.isTTY);
  void run(process.argv.slice(2), { isTTY }).then(result => { process.exitCode = result.code; });
}
