// inbox.mjs - the pending-comment view, shared by the CLI and the hub server.
// The hub needs it so the page can show a paste-ready prompt; the CLI needs it
// so Claude can read and answer. One implementation, two consumers.
import { listPages, readMeta, readThreads, readDifitSubmitted, difitKey } from './store.mjs';

const SKILL_CLI = '~/.claude/skills/explain/assets/explain';

/* --------------------------------------------------------------- difit --- */

export async function difitAlive(port) {
  if (!port) return false;
  try {
    const r = await fetch(`http://localhost:${port}/api/comments-json`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function difitThreads(port) {
  try {
    const r = await fetch(`http://localhost:${port}/api/comments-json`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return [];
    const data = await r.json();
    return data.threads || [];
  } catch {
    return [];
  }
}

export function lineOf(pos) {
  if (!pos) return null;
  return typeof pos.line === 'number' ? String(pos.line) : `${pos.line.start}-${pos.line.end}`;
}

export function isClaude(author) {
  return String(author || '').toLowerCase().includes('claude');
}

/* --------------------------------------------------------------- inbox --- */

/**
 * Pending comments awaiting Claude.
 * `includeDrafts` adds comments the user saved but has NOT sent - the page's
 * "Copy prompt" uses it so a comment can be copied without being submitted.
 */
export async function buildInbox(slugFilter, { includeDrafts = false } = {}) {
  const pages = listPages().filter((p) => !slugFilter || p.slug === slugFilter);
  const inbox = [];
  for (const p of pages) {
    const meta = readMeta(p.slug);
    const data = readThreads(p.slug);

    for (const t of data.threads) {
      const isDraft = t.status === 'draft';
      if (t.status !== 'pending' && !(includeDrafts && isDraft)) continue;
      const last = t.messages[t.messages.length - 1];
      inbox.push({
        source: 'page',
        draft: isDraft,
        slug: p.slug,
        pageTitle: p.title,
        threadId: t.id,
        where: t.anchor?.label || t.anchor?.sectionTitle || 'page',
        sectionId: t.anchor?.sectionId || null,
        anchorId: t.anchor?.anchorId || null,
        kind: t.kind,
        quote: t.quote,
        conversation: t.messages.map((m) => ({ role: m.role, body: m.body, at: m.createdAt })),
        question: last?.body || '',
        replyWith: `${SKILL_CLI} reply --slug ${p.slug} --thread ${t.id} --body "..."`,
      });
    }

    const port = meta.difit?.port;
    if (port && (await difitAlive(port))) {
      const submitted = readDifitSubmitted(p.slug);
      for (const t of await difitThreads(port)) {
        const msgs = t.messages || [];
        const last = msgs[msgs.length - 1];
        if (!last || isClaude(last.author)) continue; // already answered
        // Not sent yet: same gate as a page comment sitting as a draft.
        const isDraft = !submitted.has(difitKey(t));
        if (isDraft && !includeDrafts) continue;
        inbox.push({
          source: 'difit',
          draft: isDraft,
          slug: p.slug,
          pageTitle: p.title,
          difitPort: port,
          difitUrl: meta.difit.url,
          threadId: t.id,
          file: t.filePath,
          side: t.position?.side,
          line: lineOf(t.position),
          code: t.codeSnapshot?.content || null,
          conversation: msgs.map((m) => ({ author: m.author, body: m.body, at: m.createdAt })),
          question: last.body,
          replyWith: `${SKILL_CLI} difit-reply --slug ${p.slug} --file "${t.filePath}" --side ${t.position?.side} --line ${lineOf(t.position)} --body "..."`,
        });
      }
    }
  }
  return inbox;
}

export function formatInbox(inbox) {
  if (!inbox.length) return 'Inbox khaali hai - koi pending comment nahi.';
  const lines = [`${inbox.length} pending comment(s):`, ''];
  inbox.forEach((it, i) => {
    lines.push(
      `--- [${i + 1}] ${it.source.toUpperCase()}${it.draft ? ' (not sent - saved only)' : ''} - ${it.slug} ---`
    );
    if (it.source === 'page') {
      lines.push(`thread: ${it.threadId}`);
      lines.push(`where:  ${it.where}${it.anchorId ? ` (anchor ${it.anchorId})` : ''}`);
      if (it.quote) lines.push(`user selected: ${JSON.stringify(it.quote.slice(0, 700))}`);
    } else {
      lines.push(`file:   ${it.file}:${it.side}:L${it.line}`);
      if (it.code) lines.push(`code:   ${JSON.stringify(it.code.slice(0, 400))}`);
    }
    it.conversation.forEach((m) => {
      const who = m.role || m.author || 'user';
      lines.push(`  ${who}: ${m.body}`);
    });
    lines.push(`reply:  ${it.replyWith}`);
    lines.push('');
  });
  return lines.join('\n');
}

/* -------------------------------------------------------------- prompt --- */

function indent(text, pad = '      ') {
  return String(text || '')
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}

/**
 * A self-contained prompt the user can paste into any Claude Code session.
 * It embeds the actual comment text, so it still works when the pasted-into
 * session cannot reach the hub (sandboxed shell, hub stopped, different machine).
 */
export function buildPrompt(inbox, { slug } = {}) {
  if (!inbox.length) {
    return 'Koi pending comment nahi hai - explain-hub inbox khaali hai.';
  }
  const pages = [...new Set(inbox.map((it) => it.pageTitle))];
  const slugs = [...new Set(inbox.map((it) => it.slug))];

  const out = [];
  out.push(
    `Use the "explain" skill. Mere ${inbox.length} naye comment hain ` +
      `${pages.length === 1 ? `page "${pages[0]}"` : `${pages.length} pages`} pe ` +
      `(slug: ${slugs.join(', ')}). Inka jawaab do.`
  );
  out.push('');

  inbox.forEach((it, i) => {
    if (it.source === 'page') {
      out.push(`[${i + 1}] PAGE COMMENT - slug ${it.slug}, thread ${it.threadId}`);
      out.push(`    kahan: ${it.where}`);
      if (it.quote) {
        out.push(`    maine ye select kiya tha:`);
        out.push(indent(it.quote.slice(0, 900)));
      }
    } else {
      out.push(`[${i + 1}] CODE COMMENT (difit) - slug ${it.slug}, ${it.file}:${it.side}:L${it.line}`);
      if (it.code) {
        out.push(`    code:`);
        out.push(indent(it.code.slice(0, 600)));
      }
    }
    out.push(`    sawaal:`);
    it.conversation.forEach((m) => {
      const who = m.role === 'claude' || isClaude(m.author) ? 'claude' : 'me';
      out.push(indent(`${who}: ${m.body}`, '      '));
    });
    out.push('');
  });

  out.push('Har ek ka jawaab post karo (Hinglish, concrete, code jahan zaroori ho):');
  inbox.forEach((it, i) => {
    out.push(`  [${i + 1}] ${it.replyWith}`);
  });
  out.push('');
  out.push(
    'Lambe jawaab ke liye --body-file use karo. Agar page hi galat ya adhoora tha to ' +
      'content.json fix karke re-render bhi karo, aur thread mein bata do ki page update kar diya.'
  );
  const hasDrafts = inbox.some((it) => it.draft);
  if (slug) {
    out.push(
      `Pehle \`${SKILL_CLI} inbox --slug ${slug}${hasDrafts ? ' --include-drafts' : ''}\` ` +
        'chala kar latest state confirm kar lena.'
    );
  }
  if (hasDrafts) {
    out.push(
      'Note: inmein se kuch comments "saved" hain (user ne Send to Claude nahi dabaya, ' +
        'sirf prompt copy kiya). Unka jawaab bhi usi tarah post karo.'
    );
  }
  return out.join('\n');
}
