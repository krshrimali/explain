// auth.mjs - password gate for the hub, used only when it binds beyond loopback.
//
// Threat model: the hub serves explainer pages and a comment API. On 127.0.0.1
// that is already private, so auth stays off and nothing changes. The moment it
// listens on a shared interface, anyone who can reach the port could otherwise
// read every page and every comment thread - so auth becomes mandatory, not
// optional.
//
// Honest limits, stated here because they matter:
//   * This is plain HTTP. A password crosses the network in the clear and a
//     session cookie can be observed by anyone who can sniff the traffic. On an
//     untrusted network an SSH tunnel is the better answer - see the README.
//   * It stops casual access by others on the same host or LAN. It is not a
//     substitute for TLS.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HUB_ROOT, ensureHub } from './store.mjs';

const AUTH_FILE = path.join(HUB_ROOT, 'auth.json');
const SESSION_DAYS = 30;
const COOKIE = 'explain_sid';

/* ------------------------------------------------------------- storage --- */

function read() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  } catch {
    return { password: null, sessions: [], setupToken: null };
  }
}

function write(data) {
  ensureHub();
  const tmp = `${AUTH_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, AUTH_FILE);
  try {
    fs.chmodSync(AUTH_FILE, 0o600);
  } catch {
    /* best effort on exotic filesystems */
  }
}

export function hasPassword() {
  return Boolean(read().password);
}

/**
 * A local API key for this machine's own processes (Claude's CLI).
 *
 * Loopback is deliberately NOT treated as trusted: on a shared box another
 * user could also reach 127.0.0.1. auth.json is written 0600, so only the owner
 * can read this key - filesystem permissions are the trust anchor for local
 * access, the password is for everyone else.
 */
export function getApiKey() {
  const data = read();
  if (!data.apiKey) {
    data.apiKey = crypto.randomBytes(32).toString('hex');
    write(data);
  }
  return data.apiKey;
}

export function checkApiKey(key) {
  if (!key) return false;
  const { apiKey } = read();
  return Boolean(apiKey) && equal(String(key), apiKey);
}

export const API_KEY_HEADER = 'x-explain-key';

/* ------------------------------------------------------------ password --- */

function hashPassword(password, salt) {
  // scrypt: deliberately slow, so a stolen auth.json is not trivially crackable.
  return crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}

function equal(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function setPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const data = read();
  data.password = { salt, hash: hashPassword(password, salt), setAt: new Date().toISOString() };
  data.sessions = []; // a password change logs every device out
  data.setupToken = null;
  write(data);
}

export function checkPassword(password) {
  const { password: rec } = read();
  if (!rec) return false;
  return equal(hashPassword(String(password ?? ''), rec.salt), rec.hash);
}

export function resetAuth() {
  write({ password: null, sessions: [], setupToken: null });
}

/* -------------------------------------------------------- setup token --- */

// Printed in the terminal when the hub first listens on a shared interface, and
// required to complete signup. Without it, whoever reaches the port first could
// simply claim the hub by choosing a password.
export function issueSetupToken() {
  const data = read();
  if (data.password) return null;
  if (!data.setupToken) {
    data.setupToken = crypto.randomBytes(9).toString('base64url');
    write(data);
  }
  return data.setupToken;
}

export function checkSetupToken(token) {
  const data = read();
  if (!data.setupToken) return false;
  return equal(String(token ?? ''), data.setupToken);
}

/* --------------------------------------------------------- sessions ----- */

function tokenHash(token) {
  // Only the hash is stored, so auth.json never contains a usable cookie.
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const data = read();
  const now = Date.now();
  data.sessions = (data.sessions || []).filter((s) => s.expiresAt > now);
  data.sessions.push({
    hash: tokenHash(token),
    createdAt: now,
    expiresAt: now + SESSION_DAYS * 86400000,
  });
  write(data);
  return token;
}

export function validSession(token) {
  if (!token) return false;
  const data = read();
  const now = Date.now();
  const h = tokenHash(token);
  return (data.sessions || []).some((s) => s.expiresAt > now && equal(s.hash, h));
}

export function destroySession(token) {
  if (!token) return;
  const data = read();
  const h = tokenHash(token);
  data.sessions = (data.sessions || []).filter((s) => !equal(s.hash, h));
  write(data);
}

/* --------------------------------------------------------- http bits ----- */

export function parseCookies(header) {
  const out = {};
  String(header || '')
    .split(';')
    .forEach((part) => {
      const i = part.indexOf('=');
      if (i === -1) return;
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    });
  return out;
}

export function sessionCookie(token) {
  // No Secure flag: the hub speaks plain HTTP, and Secure would stop the cookie
  // being sent at all. SameSite=Strict is what blocks cross-site POSTs (CSRF).
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearCookie() {
  return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

export function cookieName() {
  return COOKIE;
}

/* ------------------------------------------------------- rate limiting --- */

const attempts = new Map(); // ip -> { count, until }

export function throttled(ip) {
  const rec = attempts.get(ip);
  if (!rec) return 0;
  if (Date.now() > rec.until) {
    attempts.delete(ip);
    return 0;
  }
  return rec.count >= 5 ? Math.ceil((rec.until - Date.now()) / 1000) : 0;
}

export function noteFailure(ip) {
  const rec = attempts.get(ip) || { count: 0, until: 0 };
  rec.count += 1;
  // 5 bad guesses buys a minute, and it keeps doubling.
  rec.until = Date.now() + Math.min(60000 * 2 ** Math.max(0, rec.count - 5), 15 * 60000);
  attempts.set(ip, rec);
}

export function noteSuccess(ip) {
  attempts.delete(ip);
}

/* ------------------------------------------------------------- pages ----- */

function shell(title, body) {
  // Self-contained: the login screen must not pull anything from /static, so
  // no asset is reachable before you are authenticated.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
:root{color-scheme:light dark;--bg:#fbfbfd;--card:#fff;--text:#14161d;--muted:#767c8d;
--border:#e2e4ec;--accent:#4a5bd6;--danger:#c02a3d;--warn-bg:#fdf1dc;--warn-fg:#9a6100}
@media(prefers-color-scheme:dark){:root{--bg:#0d0f14;--card:#14171f;--text:#e8eaf2;--muted:#767d92;
--border:#262b38;--accent:#7d8cff;--danger:#ff6b7f;--warn-bg:#251d0f;--warn-fg:#e0a33a}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:var(--bg);color:var(--text);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:20px}
.card{width:100%;max-width:400px;background:var(--card);border:1px solid var(--border);
border-radius:16px;padding:28px;box-shadow:0 16px 48px rgba(0,0,0,.10)}
.logo{width:32px;height:32px;border-radius:9px;background:linear-gradient(140deg,#4a5bd6,#7a3fbd);margin-bottom:16px}
h1{font-size:19px;margin:0 0 6px;letter-spacing:-.02em}
p.sub{margin:0 0 20px;color:var(--muted);font-size:13.5px}
label{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 6px}
input{width:100%;padding:10px 12px;font:inherit;border:1px solid var(--border);border-radius:9px;
background:var(--bg);color:var(--text);margin-bottom:14px}
input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
button{width:100%;padding:11px;font:inherit;font-weight:600;border:0;border-radius:9px;
background:var(--accent);color:#fff;cursor:pointer}
button:hover{filter:brightness(.94)}
.err{background:color-mix(in srgb,var(--danger) 12%,transparent);color:var(--danger);
border:1px solid color-mix(in srgb,var(--danger) 30%,transparent);padding:9px 12px;border-radius:9px;font-size:13px;margin-bottom:14px}
.note{background:var(--warn-bg);color:var(--warn-fg);border-radius:9px;padding:10px 12px;font-size:12.5px;margin-bottom:16px}
code{font-family:ui-monospace,Menlo,monospace;font-size:12px}
</style></head><body><div class="card">${body}</div></body></html>`;
}

export function signupPage({ error, needsToken } = {}) {
  return shell(
    'Set up Explain Hub',
    `<div class="logo"></div>
<h1>Set a password</h1>
<p class="sub">This hub is reachable from the network, so it needs a password before anything is served.</p>
${error ? `<div class="err">${error}</div>` : ''}
${
  needsToken
    ? `<div class="note">Enter the setup code printed in the terminal that started the hub. It stops anyone else on this network claiming it first.</div>`
    : ''
}
<form method="POST" action="/signup">
  ${needsToken ? '<label for="token">Setup code</label><input id="token" name="token" autocomplete="off" required>' : ''}
  <label for="password">Password</label>
  <input id="password" name="password" type="password" minlength="8" autocomplete="new-password" required autofocus>
  <label for="confirm">Confirm password</label>
  <input id="confirm" name="confirm" type="password" minlength="8" autocomplete="new-password" required>
  <button type="submit">Create password</button>
</form>`
  );
}

export function loginPage({ error } = {}) {
  return shell(
    'Explain Hub',
    `<div class="logo"></div>
<h1>Explain Hub</h1>
<p class="sub">Sign in to read your explainers.</p>
${error ? `<div class="err">${error}</div>` : ''}
<form method="POST" action="/login">
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
  <button type="submit">Sign in</button>
</form>`
  );
}
