#!/usr/bin/env node
/* explain.mjs - the command surface the skill drives.
   Everything Claude needs: bring the hub up, render a page, run difit, read the
   inbox of human comments, and post replies back into both comment systems. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ensureHub, HUB_ROOT, EVENTS_LOG, DEFAULT_PORT, pageExists, listPages,
  readMeta, writeMeta, readThreads, writeThreads, addMessage, appendEvent, readHubState,
  writeHubState, safeSlug, heartbeat, clearWatcher, readWatchers, watcherFor, pageOwner,
  readConfig, writeConfig,
} from './lib/store.mjs';
import {
  buildInbox, formatInbox, buildPrompt, difitAlive, difitThreads, lineOf, isClaude,
} from './lib/inbox.mjs';
import { SUPPORTED_CHROME, hasChrome } from './lib/i18n.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIFIT_BIN = path.join(HERE, 'node_modules', '.bin', 'difit');

/* ------------------------------------------------------------- arg utils -- */

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) out[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

function say(obj) {
  console.log(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}

function die(msg, code = 1) {
  console.error(`error: ${msg}`);
  process.exit(code);
}

function readInput(args, key) {
  // Accept --key "text", --key-file path, or piped stdin via --key -
  if (args[`${key}-file`]) return fs.readFileSync(args[`${key}-file`], 'utf8');
  const v = args[key];
  if (v === '-' || v === true) return fs.readFileSync(0, 'utf8');
  return v;
}

/* ----------------------------------------------------------------- hub --- */

async function ping(port) {
  try {
    const r = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(1200) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

async function hubUp(preferred = DEFAULT_PORT) {
  ensureHub();
  const known = readHubState().port;
  // Reuse a hub that is already listening, on the preferred port or the one we
  // last recorded (it may have fallen back when the preferred port was taken).
  for (const port of [...new Set([preferred, known].filter(Boolean))]) {
    const existing = await ping(port);
    if (existing) return { port, url: `http://localhost:${port}`, pid: existing.pid, started: false };
  }

  const logFile = path.join(HUB_ROOT, 'hub.log');
  // Something unrelated may own the preferred port, so walk a small range.
  for (let port = preferred; port < preferred + 8; port++) {
    const out = fs.openSync(logFile, 'a');
    const child = spawn(process.execPath, [path.join(HERE, 'hub.mjs'), String(port)], {
      detached: true,
      stdio: ['ignore', out, out],
      cwd: HERE,
    });
    child.unref();

    let dead = false;
    child.on('exit', () => { dead = true; });

    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 120));
      const info = await ping(port);
      if (info) {
        writeHubState({ ...readHubState(), port, pid: info.pid, startedAt: new Date().toISOString() });
        return { port, url: `http://localhost:${port}`, pid: info.pid, started: true };
      }
      if (dead) break; // port was taken; try the next one
    }
  }
  die(`hub did not come up on ports ${preferred}-${preferred + 7}; see ${logFile}`);
}

/* --------------------------------------------------------------- difit --- */

function difitRun(argv, cwd) {
  const res = execFileSync(process.execPath, [DIFIT_BIN, ...argv], {
    cwd: cwd || process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return res.trim();
}

async function difitStart(args) {
  const slug = safeSlug(args.slug || die('--slug required'));
  const repo = args.repo ? path.resolve(args.repo) : process.cwd();
  const port = Number(args.port) || 4800 + (Math.abs(hashCode(slug)) % 150);

  const meta = readMeta(slug);
  if (meta.difit?.port && (await difitAlive(meta.difit.port))) {
    return { ...meta.difit, reused: true };
  }

  const argv = ['--background', '--no-open', '--port', String(port)];
  if (args.pr) argv.push('--pr', String(args.pr));
  else {
    if (args.target) argv.push(String(args.target));
    if (args.base) argv.push(String(args.base));
  }
  if (args['include-untracked']) argv.push('--include-untracked');
  if (args.clean) argv.push('--clean');
  argv.push('--keep-alive');

  let handshake;
  try {
    handshake = JSON.parse(difitRun(argv, repo));
  } catch (e) {
    const stderr = e.stderr ? String(e.stderr) : String(e.message || e);
    die(`difit failed to start: ${stderr.split('\n').slice(0, 6).join(' ')}`);
  }

  const difit = {
    port: handshake.port,
    url: handshake.url,
    pid: handshake.pid,
    repo,
    target: args.pr ? `PR ${args.pr}` : [args.target, args.base].filter(Boolean).join(' vs ') || 'HEAD',
    label: args.label || undefined,
    startedAt: new Date().toISOString(),
  };
  writeMeta(slug, { ...meta, difit });
  return difit;
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/* --------------------------------------------------------------- watch --- */

// One stdout line per actionable event. Monitor turns each into a notification.
async function watch(args) {
  const intervalMs = Number(args.interval) || 3000;
  const watchAll = Boolean(args.all);
  const sessionId = args.session ? String(args.session).trim() : null;
  if (!sessionId && !watchAll) {
    die('watch needs --session <id> so a submit only wakes the session that owns the page (or --all to watch everything)');
  }
  const me = sessionId || '__all__';

  // Only deliver a page to the session that owns it. Without this every
  // session on the machine gets woken by every submit.
  const mine = (slug) => {
    if (watchAll) return true;
    return readMeta(slug).sessionId === sessionId;
  };

  if (watchAll) {
    // Self-announcing: --all re-creates the "every session gets every comment"
    // behaviour, so make sure it is visible in the notification stream.
    console.log(
      'EXPLAIN-WARN watch --all: ye watcher HAR page ke comments lega, sirf apne nahi. ' +
        'Isse band karke `watch --session <id>` use karo.'
    );
  }
  heartbeat(me, process.pid);
  const stop = () => {
    clearWatcher(me);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('exit', () => clearWatcher(me));
  let offset = 0;
  try {
    offset = fs.statSync(EVENTS_LOG).size;
  } catch {
    ensureHub();
  }
  const seenDifit = new Set();

  // Anything already submitted before this watcher started would otherwise be
  // invisible (the log offset starts at EOF), so announce the backlog once.
  const backlog = (await buildInbox(null)).filter((it) => it.source === 'page' && mine(it.slug));
  if (backlog.length) {
    const slugs = [...new Set(backlog.map((it) => it.slug))].join(', ');
    console.log(`EXPLAIN-COMMENTS slug=${slugs} count=${backlog.length} — pehle se ${backlog.length} comment pending hain. Run: explain inbox`);
  }

  // Seed difit threads that already have a Claude reply so we do not re-announce.
  for (const p of listPages()) {
    if (!mine(p.slug)) continue;
    const port = readMeta(p.slug).difit?.port;
    if (!port) continue;
    for (const t of await difitThreads(port)) {
      const last = (t.messages || [])[t.messages.length - 1];
      if (last && isClaude(last.author)) seenDifit.add(`${p.slug}:${t.id}:${t.messages.length}`);
    }
  }

  const tick = async () => {
    heartbeat(me, process.pid);

    // 1. new lines in the hub event log (page comments submitted / replied)
    try {
      const size = fs.statSync(EVENTS_LOG).size;
      if (size > offset) {
        const fd = fs.openSync(EVENTS_LOG, 'r');
        const buf = Buffer.alloc(size - offset);
        fs.readSync(fd, buf, 0, buf.length, offset);
        fs.closeSync(fd);
        offset = size;
        for (const line of buf.toString('utf8').split('\n')) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.slug && !mine(ev.slug)) continue; // another session's page
            if (ev.type === 'SUBMIT') {
              console.log(`EXPLAIN-COMMENTS slug=${ev.slug} count=${ev.count} — user ne ${ev.count} comment bheje hain on "${ev.title || ev.slug}". Run: explain inbox --slug ${ev.slug}`);
            } else if (ev.type === 'REPLY' && ev.from === 'human') {
              console.log(`EXPLAIN-REPLY slug=${ev.slug} thread=${ev.threadId} — user ne thread mein follow-up kiya. Run: explain inbox --slug ${ev.slug}`);
            }
          } catch { /* skip malformed line */ }
        }
      } else if (size < offset) {
        offset = size; // log was rotated/truncated
      }
    } catch { /* log not there yet */ }

    // 2. difit threads awaiting a Claude reply
    for (const p of listPages()) {
      if (!mine(p.slug)) continue;
      const meta = readMeta(p.slug);
      const port = meta.difit?.port;
      if (!port) continue;
      let threads = [];
      try {
        threads = await difitThreads(port);
      } catch { continue; }
      for (const t of threads) {
        const msgs = t.messages || [];
        const last = msgs[msgs.length - 1];
        if (!last || isClaude(last.author)) continue;
        const key = `${p.slug}:${t.id}:${msgs.length}`;
        if (seenDifit.has(key)) continue;
        seenDifit.add(key);
        console.log(`EXPLAIN-DIFIT slug=${p.slug} file=${t.filePath}:L${lineOf(t.position)} — code review comment aaya hai. Run: explain inbox --slug ${p.slug}`);
      }
    }
  };

  await tick();
  for (;;) {
    await new Promise((r) => setTimeout(r, intervalMs));
    try {
      await tick();
    } catch { /* keep the watcher alive through transient errors */ }
  }
}

/* -------------------------------------------------------------- command -- */

const USAGE = `explain <command> [options]

  up [--port N]                          start (or find) the hub server
  config [--language L]                  show/set hub defaults (language: hinglish|english|hindi|<any>)
  status [--slug S]                      hub + pages + difit health
  list                                   list explainer pages
  render --slug S --content <file> [--language L] [--session ID]  render/refresh a page
  claim --slug S --session ID            hand an existing page to a session
  url --slug S                           print the page URL
  open --slug S                          open the page in a browser

  difit start --slug S [--repo D] [--target REV] [--base REV] [--pr URL] [--port N]
  difit stop --slug S
  difit threads --slug S

  inbox [--slug S] [--json] [--include-drafts]   pending comments (page + difit)
  prompt [--slug S]                      paste-ready prompt for another Claude session
  watchers [--slug S]                    who is listening; for --slug, the page's owner
  reply --slug S --thread ID --body TXT  answer a page thread
  difit-reply --slug S --file F --side new|old --line N --body TXT
  difit-note  --slug S --file F --side new|old --line N --body TXT   (new difit thread)
  resolve --slug S --thread ID           mark a page thread resolved

  watch --session ID [--interval MS]     stream comments for THIS session's pages only
        [--all]                          ...or every page, owned or not (legacy)
`;

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));

  if (!cmd || cmd === 'help' || args.help) return say(USAGE);

  switch (cmd) {
    case 'up': {
      return say(await hubUp(Number(args.port) || DEFAULT_PORT));
    }

    case 'list':
      return say({ pages: listPages() });

    case 'config': {
      if (args.language) {
        const language = String(args.language).toLowerCase().trim();
        const next = writeConfig({ language });
        return say({
          ...next,
          chromeTranslated: hasChrome(language),
          note: hasChrome(language)
            ? undefined
            : `UI chrome falls back to English for "${language}"; Claude still writes the content in it.`,
          supportedChrome: SUPPORTED_CHROME,
        });
      }
      return say({ ...readConfig(), supportedChrome: SUPPORTED_CHROME });
    }

    case 'status': {
      const port = Number(args.port) || readHubState().port || DEFAULT_PORT;
      const health = await ping(port);
      const pages = [];
      for (const p of listPages().filter((x) => !args.slug || x.slug === args.slug)) {
        const meta = readMeta(p.slug);
        const threads = readThreads(p.slug).threads;
        pages.push({
          slug: p.slug,
          title: p.title,
          url: `http://localhost:${port}/p/${p.slug}/`,
          drafts: threads.filter((t) => t.status === 'draft').length,
          pending: threads.filter((t) => t.status === 'pending').length,
          answered: threads.filter((t) => t.status === 'answered').length,
          difit: meta.difit
            ? { ...meta.difit, alive: await difitAlive(meta.difit.port) }
            : null,
        });
      }
      return say({ hub: health ? { ok: true, port, url: `http://localhost:${port}` } : { ok: false, port }, pages });
    }

    case 'render': {
      const slug = safeSlug(args.slug || die('--slug required'));
      const file = args.content || args.file || die('--content <file> required');
      const raw = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
      let content;
      try {
        content = JSON.parse(raw);
      } catch (e) {
        die(`content is not valid JSON: ${e.message}`);
      }
      // Carry a live difit registration into the page automatically.
      const meta = readMeta(slug);
      if (!content.difit && meta.difit) content.difit = meta.difit;
      if (args.language) content.language = String(args.language).toLowerCase().trim();
      const sessionId = args.session ? String(args.session).trim() : null;
      const { render } = await import('./render.mjs');
      const res = await render(slug, content, { base: '' });
      // Ownership decides which session a submit wakes.
      if (sessionId) writeMeta(slug, { ...readMeta(slug), sessionId });
      const hub = await hubUp(Number(args.port) || readHubState().port || DEFAULT_PORT);
      return say({
        ...res,
        language: readMeta(slug).language,
        sessionId: readMeta(slug).sessionId || null,
        url: `${hub.url}/p/${res.slug}/`,
        hub: hub.url,
      });
    }

    case 'url': {
      const slug = safeSlug(args.slug || die('--slug required'));
      const port = readHubState().port || DEFAULT_PORT;
      return say(`http://localhost:${port}/p/${slug}/`);
    }

    case 'open': {
      const slug = safeSlug(args.slug || die('--slug required'));
      const hub = await hubUp(Number(args.port) || readHubState().port || DEFAULT_PORT);
      const url = `${hub.url}/p/${slug}/`;
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      try {
        spawn(opener, [url], { detached: true, stdio: 'ignore' }).unref();
      } catch { /* headless is fine, the URL is printed */ }
      return say(url);
    }

    case 'difit': {
      const sub = args._[0];
      if (sub === 'start') return say(await difitStart(args));
      const slug = safeSlug(args.slug || die('--slug required'));
      const meta = readMeta(slug);
      if (sub === 'stop') {
        if (!meta.difit?.pid) return say({ ok: false, reason: 'no difit recorded' });
        try {
          process.kill(meta.difit.pid);
        } catch { /* already gone */ }
        writeMeta(slug, { ...meta, difit: null });
        return say({ ok: true, stopped: meta.difit.port });
      }
      if (sub === 'threads') {
        if (!meta.difit?.port) return say({ threads: [] });
        return say({ port: meta.difit.port, threads: await difitThreads(meta.difit.port) });
      }
      return die(`unknown difit subcommand: ${sub}`);
    }

    case 'inbox': {
      const inbox = await buildInbox(args.slug ? safeSlug(args.slug) : null, {
        includeDrafts: Boolean(args['include-drafts']),
      });
      return say(args.json ? { count: inbox.length, inbox } : formatInbox(inbox));
    }

    case 'prompt': {
      const slug = args.slug ? safeSlug(args.slug) : null;
      // Drafts are included so a comment can be copied without being sent.
      const inbox = await buildInbox(slug, { includeDrafts: args['no-drafts'] !== true });
      const text = buildPrompt(inbox, { slug });
      return say(args.json ? { count: inbox.length, prompt: text } : text);
    }

    case 'claim': {
      const slug = safeSlug(args.slug || die('--slug required'));
      const sessionId = String(args.session || die('--session required')).trim();
      if (!pageExists(slug)) die(`no such page: ${slug}`);
      writeMeta(slug, { ...readMeta(slug), sessionId });
      return say({ ok: true, slug, sessionId });
    }

    case 'watchers': {
      if (args.slug) return say(pageOwner(safeSlug(args.slug)));
      return say({ watchers: readWatchers() });
    }

    case 'reply': {
      const slug = safeSlug(args.slug || die('--slug required'));
      const thread = args.thread || die('--thread required');
      const body = readInput(args, 'body') || die('--body required');
      if (!pageExists(slug)) die(`no such page: ${slug}`);
      const t = addMessage(slug, thread, 'claude', body);
      appendEvent('CLAUDE_REPLY', slug, { threadId: thread });
      // Nudge the hub so open browsers repaint even if the watcher missed it.
      const port = readHubState().port || DEFAULT_PORT;
      fetch(`http://localhost:${port}/api/p/${slug}/threads`).catch(() => {});
      return say({ ok: true, threadId: t.id, status: t.status, messages: t.messages.length });
    }

    case 'resolve': {
      const slug = safeSlug(args.slug || die('--slug required'));
      const data = readThreads(slug);
      const t = data.threads.find((x) => x.id === args.thread);
      if (!t) die(`no such thread: ${args.thread}`);
      t.status = 'resolved';
      t.updatedAt = new Date().toISOString();
      writeThreads(slug, data);
      return say({ ok: true, threadId: t.id });
    }

    case 'difit-reply':
    case 'difit-note': {
      const slug = safeSlug(args.slug || die('--slug required'));
      const meta = readMeta(slug);
      const port = Number(args.port) || meta.difit?.port || die('no difit server for this page');
      const file = args.file || die('--file required');
      const side = args.side || 'new';
      const rawLine = String(args.line ?? die('--line required'));
      const body = readInput(args, 'body') || die('--body required');
      const line = rawLine.includes('-')
        ? { start: Number(rawLine.split('-')[0]), end: Number(rawLine.split('-')[1]) }
        : Number(rawLine);
      const payload = {
        type: cmd === 'difit-reply' ? 'reply' : 'thread',
        filePath: file,
        position: { side, line },
        body,
        author: args.author || 'claude',
      };
      const r = await fetch(`http://localhost:${port}/api/comment-imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([payload]),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) die(`difit rejected the comment: ${out.error || r.status}`);
      if (out.warnings?.length) console.error(`warning: ${out.warnings.join('; ')}`);
      return say({ ok: true, ...out, posted: payload });
    }

    case 'watch':
      return watch(args);

    default:
      return die(`unknown command: ${cmd}\n\n${USAGE}`);
  }
}

main().catch((e) => die(e?.stack || e?.message || String(e)));
