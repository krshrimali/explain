// hub.mjs - the local server behind every explainer page.
// Serves the rendered pages, owns the comment-thread API, streams live updates
// over SSE, and appends an event line that Claude's Monitor tails.
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureHub, pageDir, listPages, pageExists, readMeta, readThreads, writeThreads,
  createThread, addMessage, deleteThread, appendEvent, readHubState, writeHubState,
  safeSlug, DEFAULT_PORT, PAGES_DIR, readWatchers, pageOwner, resolveBind,
} from './lib/store.mjs';
import { buildInbox, buildPrompt } from './lib/inbox.mjs';
import {
  hasPassword, setPassword, checkPassword, createSession, validSession, destroySession,
  parseCookies, sessionCookie, clearCookie, cookieName, signupPage, loginPage,
  issueSetupToken, checkSetupToken, throttled, noteFailure, noteSuccess,
  checkApiKey, API_KEY_HEADER,
} from './lib/auth.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.join(HERE, 'page');
const VENDOR_DIR = path.join(HERE, 'vendor');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/* ---------------------------------------------------------------- sse ----- */

const clients = new Map(); // slug -> Set<res>

function broadcast(slug, event, data) {
  const set = clients.get(slug);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      set.delete(res);
    }
  }
}

// Watch every page directory so changes made by Claude's CLI (threads.json
// rewritten, page re-rendered) reach open browsers immediately.
const watchers = new Map();
const debounce = new Map();

function watchPage(slug) {
  if (watchers.has(slug)) return;
  const dir = pageDir(slug);
  if (!fs.existsSync(dir)) return;
  try {
    const w = fs.watch(dir, (_evt, filename) => {
      if (!filename) return;
      const key = `${slug}:${filename}`;
      clearTimeout(debounce.get(key));
      debounce.set(
        key,
        setTimeout(() => {
          if (filename === 'threads.json') {
            broadcast(slug, 'threads', readThreads(slug));
          } else if (filename === 'index.html') {
            broadcast(slug, 'content', { renderedAt: new Date().toISOString() });
          }
        }, 120)
      );
    });
    w.on('error', () => watchers.delete(slug));
    watchers.set(slug, w);
  } catch {
    /* watching is best-effort; the page also polls */
  }
}

function watchAll() {
  try {
    for (const d of fs.readdirSync(PAGES_DIR, { withFileTypes: true })) {
      if (d.isDirectory()) watchPage(d.name);
    }
  } catch {
    /* no pages yet */
  }
}

/* ------------------------------------------------------------- helpers ---- */

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function json(res, status, data) {
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8' });
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function serveFile(res, file, { download = false } = {}) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not found');
  const ext = path.extname(file).toLowerCase();
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  if (download) headers['Content-Disposition'] = `attachment; filename="${path.basename(file)}"`;
  res.writeHead(200, { 'Cache-Control': 'no-store', ...headers });
  fs.createReadStream(file).pipe(res);
}

async function difitStatus(meta) {
  const port = meta?.difit?.port;
  if (!port) return { configured: false, alive: false, threads: [] };
  try {
    const ctrl = AbortSignal.timeout(2500);
    const r = await fetch(`http://localhost:${port}/api/comments-json`, { signal: ctrl });
    if (!r.ok) return { configured: true, alive: false, threads: [], port };
    const data = await r.json();
    return { configured: true, alive: true, port, url: meta.difit.url, threads: data.threads || [] };
  } catch {
    return { configured: true, alive: false, threads: [], port, url: meta?.difit?.url };
  }
}

/* -------------------------------------------------------------- index ----- */

function indexPage(base) {
  const pages = listPages();
  const esc = (s) =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cards = pages.length
    ? pages
        .map(
          (p) => `<a class="hx-card" href="${base}/p/${esc(p.slug)}/">
      <div class="hx-type">${esc(p.targetType)}</div>
      <div class="hx-title">${esc(p.title)}</div>
      <div class="hx-sub">${esc(p.subtitle || '')}</div>
      <div class="hx-foot">
        <span>${esc((p.updatedAt || '').slice(0, 16).replace('T', ' '))}</span>
        <span class="hx-badges">${p.openCount ? `<b class="hx-open">${p.openCount} open</b>` : ''}${
          p.threadCount ? `<b>${p.threadCount} threads</b>` : ''
        }${p.difit ? '<b class="hx-difit">difit</b>' : ''}</span>
      </div></a>`
        )
        .join('')
    : '<div class="hx-empty">Abhi koi explainer nahi hai. Claude se <code>/explain &lt;target&gt;</code> chalwao.</div>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Explain Hub</title>
<link rel="stylesheet" href="${base}/static/app.css">
<script>(function(){try{var t=localStorage.getItem('explain-theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
</head><body class="hub-index">
<header class="topbar"><div class="tb-left"><span class="tb-logo"></span><div class="tb-titles">
<div class="tb-title">Explain Hub</div><div class="tb-sub">${pages.length} explainer${
    pages.length === 1 ? '' : 's'
  }</div></div></div>
<div class="tb-right"><button class="btn btn--ghost btn--icon" id="btn-theme" type="button"><span class="ico">&#9680;</span></button></div></header>
<main class="hx-main"><div class="hx-grid">${cards}</div></main>
<script>document.getElementById('btn-theme').addEventListener('click',function(){
var el=document.documentElement,cur=el.getAttribute('data-theme')||'auto';
var next=cur==='dark'?'light':cur==='light'?'auto':'dark';
if(next==='auto')el.removeAttribute('data-theme');else el.setAttribute('data-theme',next);
try{localStorage.setItem('explain-theme',next==='auto'?'':next);}catch(e){}});</script>
</body></html>`;
}

/* ---------------------------------------------------------------- auth ---- */

// Set once at listen() time. When false (loopback only) every gate below is a
// no-op, so the local workflow is unchanged.
let AUTH_REQUIRED = false;

function clientIp(req) {
  return req.socket?.remoteAddress || 'unknown';
}

function readForm(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 64 * 1024) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(data))));
    req.on('error', reject);
  });
}

function authed(req) {
  if (!AUTH_REQUIRED) return true;
  // Local tooling presents a key only the file's owner can read.
  if (checkApiKey(req.headers[API_KEY_HEADER])) return true;
  return validSession(parseCookies(req.headers.cookie)[cookieName()]);
}

function htmlPage(res, status, body, headers = {}) {
  send(res, status, body, { 'Content-Type': MIME['.html'], ...headers });
}

/** Returns true when it has fully handled the request. */
async function handleAuthRoutes(req, res, pathname) {
  if (!AUTH_REQUIRED) {
    // Nothing to sign into on a loopback hub.
    if (pathname === '/login' || pathname === '/signup') {
      res.writeHead(302, { Location: '/' });
      return res.end(), true;
    }
    return false;
  }

  const ip = clientIp(req);
  const needSignup = !hasPassword();

  if (pathname === '/signup') {
    if (needSignup && req.method === 'GET') {
      return htmlPage(res, 200, signupPage({ needsToken: true })), true;
    }
    if (needSignup && req.method === 'POST') {
      const form = await readForm(req).catch(() => ({}));
      if (!checkSetupToken(form.token)) {
        noteFailure(ip);
        return htmlPage(res, 400, signupPage({ needsToken: true, error: 'That setup code is not right.' })), true;
      }
      if (String(form.password || '').length < 8) {
        return htmlPage(res, 400, signupPage({ needsToken: true, error: 'Use at least 8 characters.' })), true;
      }
      if (form.password !== form.confirm) {
        return htmlPage(res, 400, signupPage({ needsToken: true, error: 'The two passwords do not match.' })), true;
      }
      setPassword(form.password);
      const token = createSession();
      noteSuccess(ip);
      res.writeHead(302, { Location: '/', 'Set-Cookie': sessionCookie(token) });
      return res.end(), true;
    }
    res.writeHead(302, { Location: '/login' });
    return res.end(), true;
  }

  if (pathname === '/login') {
    if (needSignup) {
      res.writeHead(302, { Location: '/signup' });
      return res.end(), true;
    }
    if (req.method === 'GET') return htmlPage(res, 200, loginPage()), true;
    if (req.method === 'POST') {
      const wait = throttled(ip);
      if (wait) {
        return htmlPage(res, 429, loginPage({ error: `Too many attempts. Try again in ${wait}s.` })), true;
      }
      const form = await readForm(req).catch(() => ({}));
      if (!checkPassword(form.password)) {
        noteFailure(ip);
        return htmlPage(res, 401, loginPage({ error: 'Wrong password.' })), true;
      }
      noteSuccess(ip);
      const token = createSession();
      res.writeHead(302, { Location: '/', 'Set-Cookie': sessionCookie(token) });
      return res.end(), true;
    }
  }

  if (pathname === '/logout') {
    destroySession(parseCookies(req.headers.cookie)[cookieName()]);
    res.writeHead(302, { Location: '/login', 'Set-Cookie': clearCookie() });
    return res.end(), true;
  }

  if (!authed(req)) {
    // Everything else - pages, static assets, API, SSE - is behind the gate.
    if (pathname.startsWith('/api/')) return json(res, 401, { error: 'Not authenticated' }), true;
    res.writeHead(302, { Location: needSignup ? '/signup' : '/login' });
    return res.end(), true;
  }
  return false;
}

/* -------------------------------------------------------------- routes ---- */

async function handle(req, res, base) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  if (await handleAuthRoutes(req, res, p)) return;

  if (p === '/api/health') {
    return json(res, 200, { ok: true, pid: process.pid, pages: listPages().length });
  }

  if (p === '/' || p === '/index.html') {
    return send(res, 200, indexPage(base), { 'Content-Type': MIME['.html'] });
  }

  if (p === '/api/pages') return json(res, 200, { pages: listPages() });

  // Every live watcher on the hub (the page-scoped view is under /api/p/:slug).
  if (p === '/api/watchers') return json(res, 200, { watchers: readWatchers() });

  // /static/*
  if (p.startsWith('/static/')) {
    const name = path.basename(p);
    const candidates = [path.join(STATIC_DIR, name), path.join(VENDOR_DIR, name)];
    const file = candidates.find((f) => fs.existsSync(f));
    if (!file) return send(res, 404, 'Not found');
    return serveFile(res, file);
  }

  // /api/p/:slug/...
  const api = p.match(/^\/api\/p\/([^/]+)(\/.*)?$/);
  if (api) {
    let slug;
    try {
      slug = safeSlug(decodeURIComponent(api[1]));
    } catch {
      return json(res, 400, { error: 'Bad slug' });
    }
    if (!pageExists(slug)) return json(res, 404, { error: 'No such page' });
    const rest = api[2] || '/';
    watchPage(slug);

    if (rest === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`retry: 2000\n\n`);
      res.write(`event: threads\ndata: ${JSON.stringify(readThreads(slug))}\n\n`);
      if (!clients.has(slug)) clients.set(slug, new Set());
      clients.get(slug).add(res);
      const ping = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          clearInterval(ping);
        }
      }, 20000);
      req.on('close', () => {
        clearInterval(ping);
        clients.get(slug)?.delete(res);
      });
      return;
    }

    if (rest === '/threads' && req.method === 'GET') {
      return json(res, 200, readThreads(slug));
    }

    if (rest === '/threads' && req.method === 'POST') {
      const body = await readBody(req);
      if (!String(body.body || '').trim()) return json(res, 400, { error: 'Comment body is empty' });
      const thread = createThread(slug, body);
      broadcast(slug, 'threads', readThreads(slug));
      return json(res, 201, { thread });
    }

    const msg = rest.match(/^\/threads\/([^/]+)\/messages$/);
    if (msg && req.method === 'POST') {
      const body = await readBody(req);
      if (!String(body.body || '').trim()) return json(res, 400, { error: 'Reply body is empty' });
      try {
        const thread = addMessage(slug, msg[1], body.role === 'claude' ? 'claude' : 'human', body.body);
        appendEvent('REPLY', slug, { threadId: thread.id, from: body.role || 'human' });
        broadcast(slug, 'threads', readThreads(slug));
        return json(res, 200, { thread });
      } catch (e) {
        return json(res, 404, { error: e.message });
      }
    }

    const one = rest.match(/^\/threads\/([^/]+)$/);
    if (one && req.method === 'DELETE') {
      const ok = deleteThread(slug, one[1]);
      broadcast(slug, 'threads', readThreads(slug));
      return json(res, ok ? 200 : 404, { ok });
    }
    if (one && req.method === 'PATCH') {
      const body = await readBody(req);
      const data = readThreads(slug);
      const t = data.threads.find((x) => x.id === one[1]);
      if (!t) return json(res, 404, { error: 'No such thread' });
      if (body.status) t.status = body.status;
      if (body.anchor) t.anchor = body.anchor;
      if (typeof body.outdated === 'boolean') t.outdated = body.outdated;
      t.updatedAt = new Date().toISOString();
      writeThreads(slug, data);
      broadcast(slug, 'threads', data);
      return json(res, 200, { thread: t });
    }

    if (rest === '/watcher') return json(res, 200, pageOwner(slug));

    if (rest === '/prompt') {
      // Drafts included: the user may want the prompt without submitting.
      const inbox = await buildInbox(slug, { includeDrafts: true });
      return json(res, 200, {
        count: inbox.length,
        drafts: inbox.filter((i) => i.draft).length,
        prompt: buildPrompt(inbox, { slug }),
        watcher: pageOwner(slug),
      });
    }

    if (rest === '/submit' && req.method === 'POST') {
      const data = readThreads(slug);
      const now = new Date().toISOString();
      const flipped = data.threads.filter((t) => t.status === 'draft');
      flipped.forEach((t) => {
        t.status = 'pending';
        t.submittedAt = now;
        t.updatedAt = now;
      });
      const pending = data.threads.filter((t) => t.status === 'pending');
      writeThreads(slug, data);
      broadcast(slug, 'threads', data);
      appendEvent('SUBMIT', slug, {
        count: pending.length,
        new: flipped.length,
        title: readMeta(slug).title || slug,
      });
      const inbox = await buildInbox(slug, { includeDrafts: true });
      return json(res, 200, {
        ok: true,
        submitted: flipped.length,
        pending: pending.length,
        watcher: pageOwner(slug),
        prompt: buildPrompt(inbox, { slug }),
      });
    }

    if (rest === '/difit') {
      return json(res, 200, await difitStatus(readMeta(slug)));
    }

    if (rest === '/content') {
      return serveFile(res, path.join(pageDir(slug), 'content.json'));
    }

    return json(res, 404, { error: 'Unknown API route' });
  }

  // /p/:slug/...
  const pageMatch = p.match(/^\/p\/([^/]+)(\/.*)?$/);
  if (pageMatch) {
    let slug;
    try {
      slug = safeSlug(decodeURIComponent(pageMatch[1]));
    } catch {
      return send(res, 400, 'Bad slug');
    }
    if (!pageExists(slug)) return send(res, 404, 'No such explainer');
    watchPage(slug);
    const rest = (pageMatch[2] || '/').replace(/^\/+/, '');
    if (!rest || rest === 'index.html') {
      return serveFile(res, path.join(pageDir(slug), 'index.html'));
    }
    // Only serve files that actually live inside the page dir.
    const target = path.join(pageDir(slug), rest);
    if (!target.startsWith(pageDir(slug) + path.sep)) return send(res, 403, 'Forbidden');
    return serveFile(res, target);
  }

  return send(res, 404, 'Not found');
}

/* --------------------------------------------------------------- start ---- */

export function start(port = DEFAULT_PORT, bindMode) {
  ensureHub();
  const bind = resolveBind(bindMode);
  // Reachable beyond loopback => a password is not optional.
  AUTH_REQUIRED = bind.network;

  const server = http.createServer((req, res) => {
    handle(req, res, '').catch((err) => {
      try {
        json(res, 500, { error: String(err?.message || err) });
      } catch {
        /* response already sent */
      }
    });
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(JSON.stringify({ error: 'EADDRINUSE', port }));
      process.exit(3);
    }
    throw err;
  });
  return new Promise((resolve) => {
    server.listen(port, bind.host, () => {
      watchAll();
      const info = {
        port,
        host: bind.host,
        bind: bind.mode,
        network: bind.network,
        auth: AUTH_REQUIRED,
        url: `http://localhost:${port}`,
        pid: process.pid,
      };
      if (bind.network) {
        info.lan = `http://${os.hostname()}:${port}`;
        // Only meaningful until a password exists; it is what stops a stranger
        // on the network claiming the hub before you do.
        const t = issueSetupToken();
        if (t) info.setupToken = t;
      }
      writeHubState({ ...readHubState(), ...info, startedAt: new Date().toISOString() });
      resolve(info);
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2]) || DEFAULT_PORT;
  start(port, process.argv[3]).then((info) => {
    console.log(JSON.stringify(info));
  });
}
