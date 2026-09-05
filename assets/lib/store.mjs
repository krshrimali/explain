// Shared persistence layer for the explain hub.
// Everything lives under ~/.claude/explain-hub (override with EXPLAIN_HUB_ROOT).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const HUB_ROOT =
  process.env.EXPLAIN_HUB_ROOT || path.join(os.homedir(), '.claude', 'explain-hub');
export const PAGES_DIR = path.join(HUB_ROOT, 'pages');
export const EVENTS_LOG = path.join(HUB_ROOT, 'events.log');
export const STATE_FILE = path.join(HUB_ROOT, 'hub.json');
export const WATCHERS_FILE = path.join(HUB_ROOT, 'watchers.json');
export const CONFIG_FILE = path.join(HUB_ROOT, 'config.json');
export const DEFAULT_PORT = Number(process.env.EXPLAIN_HUB_PORT || 7788);

export function ensureHub() {
  fs.mkdirSync(PAGES_DIR, { recursive: true });
  if (!fs.existsSync(EVENTS_LOG)) fs.writeFileSync(EVENTS_LOG, '');
  return HUB_ROOT;
}

export function pageDir(slug) {
  return path.join(PAGES_DIR, safeSlug(slug));
}

export function safeSlug(slug) {
  const s = String(slug || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!s || s === '.' || s === '..') throw new Error(`Invalid slug: ${JSON.stringify(slug)}`);
  return s;
}

export function newId(prefix = 't') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Atomic-ish write so a reader never sees a half-written file.
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/* ---------------------------------------------------------------- pages -- */

export function listPages() {
  ensureHub();
  return fs
    .readdirSync(PAGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const meta = readMeta(d.name);
      const threads = readThreads(d.name);
      return {
        slug: d.name,
        title: meta.title || d.name,
        subtitle: meta.subtitle || '',
        targetType: meta.targetType || 'term',
        target: meta.target || null,
        difit: meta.difit || null,
        updatedAt: meta.updatedAt || meta.generatedAt || null,
        generatedAt: meta.generatedAt || null,
        threadCount: threads.threads.length,
        openCount: threads.threads.filter((t) => t.status !== 'answered' && t.status !== 'resolved').length,
      };
    })
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export function pageExists(slug) {
  try {
    return fs.existsSync(path.join(pageDir(slug), 'meta.json'));
  } catch {
    return false;
  }
}

export function readMeta(slug) {
  return readJson(path.join(pageDir(slug), 'meta.json'), {});
}

export function writeMeta(slug, meta) {
  writeJson(path.join(pageDir(slug), 'meta.json'), meta);
  return meta;
}

export function readContent(slug) {
  return readJson(path.join(pageDir(slug), 'content.json'), null);
}

/* -------------------------------------------------------------- threads -- */

const EMPTY_THREADS = { version: 1, threads: [] };

export function readThreads(slug) {
  const data = readJson(path.join(pageDir(slug), 'threads.json'), null);
  if (!data || !Array.isArray(data.threads)) return { ...EMPTY_THREADS, threads: [] };
  return data;
}

export function writeThreads(slug, data) {
  writeJson(path.join(pageDir(slug), 'threads.json'), data);
  return data;
}

export function mutateThreads(slug, fn) {
  const data = readThreads(slug);
  const result = fn(data);
  writeThreads(slug, data);
  touchPage(slug);
  return result;
}

export function touchPage(slug) {
  const meta = readMeta(slug);
  meta.updatedAt = new Date().toISOString();
  writeMeta(slug, meta);
}

/**
 * Thread shape:
 * {
 *   id, status: 'draft'|'pending'|'answered'|'resolved',
 *     draft    - written in the page, not yet sent to Claude
 *     pending  - submitted, waiting for Claude
 *     answered - Claude has replied
 *   kind: 'bbox'|'selection'|'section',
 *   anchor: { sectionId, blockId, anchorId, rect:{x,y,w,h}, scale, docWidth },
 *   quote: string,            // text the box covered — what Claude reads
 *   contentHash: string,      // hash of the anchored block at capture time
 *   outdated: boolean,
 *   createdAt, updatedAt, submittedAt, answeredAt,
 *   messages: [{ id, role:'human'|'claude', body, createdAt }]
 * }
 */
export function createThread(slug, input) {
  return mutateThreads(slug, (data) => {
    const now = new Date().toISOString();
    const thread = {
      id: newId('th'),
      status: input.status === 'pending' ? 'pending' : 'draft',
      kind: input.kind || 'bbox',
      anchor: input.anchor || null,
      quote: (input.quote || '').slice(0, 4000),
      contentHash: input.contentHash || null,
      outdated: false,
      createdAt: now,
      updatedAt: now,
      submittedAt: null,
      answeredAt: null,
      messages: [
        { id: newId('m'), role: 'human', body: String(input.body || '').trim(), createdAt: now },
      ],
    };
    data.threads.push(thread);
    return thread;
  });
}

export function addMessage(slug, threadId, role, body) {
  return mutateThreads(slug, (data) => {
    const thread = data.threads.find((t) => t.id === threadId);
    if (!thread) throw new Error(`No such thread: ${threadId}`);
    const now = new Date().toISOString();
    thread.messages.push({ id: newId('m'), role, body: String(body).trim(), createdAt: now });
    thread.updatedAt = now;
    if (role === 'claude') {
      thread.status = 'answered';
      thread.answeredAt = now;
    } else {
      // A new human message re-opens the thread for Claude.
      thread.status = 'pending';
      thread.submittedAt = now;
    }
    return thread;
  });
}

export function setThreadStatus(slug, threadId, status) {
  return mutateThreads(slug, (data) => {
    const thread = data.threads.find((t) => t.id === threadId);
    if (!thread) throw new Error(`No such thread: ${threadId}`);
    thread.status = status;
    thread.updatedAt = new Date().toISOString();
    if (status === 'pending') thread.submittedAt = thread.updatedAt;
    return thread;
  });
}

export function deleteThread(slug, threadId) {
  return mutateThreads(slug, (data) => {
    const i = data.threads.findIndex((t) => t.id === threadId);
    if (i === -1) return false;
    data.threads.splice(i, 1);
    return true;
  });
}

/* --------------------------------------------------------------- events -- */

export function appendEvent(type, slug, detail = {}) {
  ensureHub();
  const line = JSON.stringify({ ts: new Date().toISOString(), type, slug, ...detail });
  fs.appendFileSync(EVENTS_LOG, line + '\n');
  return line;
}

/* ------------------------------------------------------------- hub state -- */

export function readHubState() {
  return readJson(STATE_FILE, { port: null, pid: null, startedAt: null, difit: {} });
}

export function writeHubState(state) {
  writeJson(STATE_FILE, state);
  return state;
}

/* --------------------------------------------------------------- config -- */

// Hub-wide defaults. `language` steers both the page chrome and the language
// Claude writes the explanation in; a page may override it in content.json.
export function readConfig() {
  return { language: 'hinglish', ...readJson(CONFIG_FILE, {}) };
}

export function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  writeJson(CONFIG_FILE, next);
  return next;
}

/* ------------------------------------------------------------- watchers -- */

// A running `explain watch` refreshes this file every tick. The page reads it to
// decide whether a Claude session is actually listening, or whether the user
// needs to paste the prompt into one themselves.
const WATCHER_STALE_MS = 20000;

export function heartbeat(pid) {
  ensureHub();
  writeJson(WATCHERS_FILE, { pid, at: new Date().toISOString(), interval: WATCHER_STALE_MS });
}

export function readWatcher() {
  const w = readJson(WATCHERS_FILE, null);
  if (!w || !w.at) return { alive: false, lastSeen: null, pid: null };
  const age = Date.now() - new Date(w.at).getTime();
  let alive = age < WATCHER_STALE_MS;
  // A heartbeat file outlives the process that wrote it, so confirm the pid.
  if (alive && w.pid) {
    try {
      process.kill(w.pid, 0);
    } catch {
      alive = false;
    }
  }
  return { alive, lastSeen: w.at, pid: w.pid, ageMs: age };
}

export function clearWatcher() {
  try {
    fs.rmSync(WATCHERS_FILE, { force: true });
  } catch {
    /* nothing to clear */
  }
}

export function hash(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex').slice(0, 16);
}
