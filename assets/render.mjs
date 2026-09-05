// render.mjs - turns a content.json authored by Claude into the explainer page.
// Deterministic: all interactive machinery lives in /static/app.js, so the page
// can be re-rendered at any time without losing comment threads.
import fs from 'node:fs';
import path from 'node:path';
import { Marked } from 'marked';
import { createHighlighter, bundledLanguages } from 'shiki';
import { pageDir, readMeta, writeMeta, ensureHub, safeSlug, hash, readConfig } from './lib/store.mjs';
import { strings, clientStrings, DEFAULT_LANGUAGE } from './lib/i18n.mjs';

const THEMES = { light: 'github-light-default', dark: 'github-dark-default' };

/* ------------------------------------------------------------- utilities -- */

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeLang(lang) {
  if (!lang) return 'text';
  const l = String(lang).toLowerCase().trim();
  const alias = {
    js: 'javascript', ts: 'typescript', py: 'python',
    sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', term: 'bash',
    yml: 'yaml', md: 'markdown', rs: 'rust', 'c++': 'cpp',
    h: 'c', hpp: 'cpp', rb: 'ruby', kt: 'kotlin', cs: 'csharp',
    plain: 'text', txt: 'text', patch: 'diff',
  };
  const resolved = alias[l] || l;
  return resolved in bundledLanguages ? resolved : 'text';
}

// Walk the content tree and collect every language we will need up front, so we
// create one highlighter with exactly the right grammars loaded.
function collectLangs(content) {
  // 'bash' is seeded because terminal blocks hard-code it without a lang field.
  const langs = new Set(['text', 'bash']);
  const seen = new Set();
  const scanFences = (str) => {
    for (const m of str.matchAll(/^```([A-Za-z0-9_+#.-]+)/gm)) langs.add(normalizeLang(m[1]));
  };
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node.lang === 'string') langs.add(normalizeLang(node.lang));
    for (const key of ['md', 'a', 'body', 'suggestion', 'verdict', 'meaning']) {
      if (typeof node[key] === 'string') scanFences(node[key]);
    }
    Object.values(node).forEach(visit);
  };
  visit(content);
  return [...langs];
}

/* ---------------------------------------------------------- highlighting -- */

function parseHighlightSpec(spec) {
  // "3,7-9" -> Set{3,7,8,9}
  const out = new Set();
  if (spec == null) return out;
  const list = Array.isArray(spec) ? spec : String(spec).split(',');
  for (const item of list) {
    const s = String(item).trim();
    if (!s) continue;
    const m = s.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      for (let i = Number(m[1]); i <= Number(m[2]); i++) out.add(i);
    } else if (/^\d+$/.test(s)) {
      out.add(Number(s));
    }
  }
  return out;
}

function makeCodeRenderer(highlighter) {
  const loaded = new Set(highlighter.getLoadedLanguages());
  return function renderCode(code, langInput, opts = {}) {
    // Fall back to plain text rather than throwing if a grammar was missed.
    let lang = normalizeLang(langInput);
    if (!loaded.has(lang)) lang = 'text';
    const marked = parseHighlightSpec(opts.highlight);
    const startLine = Number(opts.startLine) || 1;
    let n = startLine - 1;
    const html = highlighter.codeToHtml(String(code ?? '').replace(/\n$/, ''), {
      lang,
      themes: THEMES,
      defaultColor: false,
      transformers: [
        {
          line(node) {
            n += 1;
            node.properties['data-line'] = String(n);
            if (marked.has(n)) node.properties.class = `${node.properties.class || ''} hl`.trim();
          },
          pre(node) {
            node.properties.class = `${node.properties.class || ''} shiki-pre`.trim();
            if (opts.numbers !== false) node.properties['data-numbers'] = 'on';
            node.properties['data-lang'] = lang;
          },
        },
      ],
    });
    // Shiki separates line spans with a literal newline. Those text nodes become
    // extra line boxes once .line is display:block, doubling the line height.
    return html.replace(/\n(?=<span class="line[ "])/g, '');
  };
}

/* ------------------------------------------------------------- markdown -- */

function alignAttr(a) {
  return a ? ` style="text-align:${a}"` : '';
}

function makeMarkdown(renderCode) {
  const marked = new Marked({ gfm: true, breaks: false });
  const pending = [];
  marked.use({
    async: true,
    walkTokens(token) {
      if (token.type === 'code') {
        // Swap the token for an html token holding a placeholder, then splice the
        // Shiki output back in after parsing - keeps marked from escaping it.
        const key = ` XCODEX${pending.length}X `;
        pending.push(renderCode(token.text, token.lang, { numbers: false }));
        token.type = 'html';
        token.text = key;
        token.block = true;
      }
    },
    renderer: {
      link(token) {
        const href = esc(token.href || '');
        const external = /^https?:/i.test(token.href || '');
        const title = token.title ? ` title="${esc(token.title)}"` : '';
        const rel = external ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `<a href="${href}"${title}${rel}>${this.parser.parseInline(token.tokens)}</a>`;
      },
      table(token) {
        const head = token.header
          .map((c, i) => `<th${alignAttr(token.align[i])}>${this.parser.parseInline(c.tokens)}</th>`)
          .join('');
        const body = token.rows
          .map(
            (row) =>
              `<tr>${row
                .map((c, i) => `<td${alignAttr(token.align[i])}>${this.parser.parseInline(c.tokens)}</td>`)
                .join('')}</tr>`
          )
          .join('');
        return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
      },
    },
  });

  return async function md(src) {
    if (src == null || src === '') return '';
    pending.length = 0;
    const html = await marked.parse(String(src));
    return html.replace(/ XCODEX(\d+)X /g, (_, i) => pending[Number(i)] ?? '');
  };
}

async function mdInline(src, md) {
  const html = await md(src);
  return html.replace(/^\s*<p>/, '').replace(/<\/p>\s*$/, '').trim();
}

/* --------------------------------------------------------------- blocks -- */

function codeFrame({ html, file, lines, lang, caption, difitUrl }) {
  const chips = [];
  if (file) chips.push(`<span class="cf-file">${esc(file)}</span>`);
  if (lines) chips.push(`<span class="cf-lines">L${esc(lines)}</span>`);
  if (lang && lang !== 'text') chips.push(`<span class="cf-lang">${esc(lang)}</span>`);
  const actions = `<div class="cf-actions">${
    difitUrl ? `<a class="cf-difit" href="${esc(difitUrl)}" target="_blank" rel="noopener">diff</a>` : ''
  }<button class="cf-copy" type="button" aria-label="Copy code">copy</button></div>`;
  return `<figure class="codeframe"><div class="cf-head"><div class="cf-chips">${chips.join(
    ''
  )}</div>${actions}</div><div class="cf-body">${html}</div>${
    caption ? `<figcaption>${esc(caption)}</figcaption>` : ''
  }</figure>`;
}

const CALLOUT_ICON = {
  info: 'i', tip: '*', warn: '!', danger: 'x',
  edge: '~', gotcha: '?', perf: '>', security: '#',
};
const CALLOUT_LABEL_KEY = {
  info: 'calloutInfo', tip: 'calloutTip', warn: 'calloutWarn', danger: 'calloutDanger',
  edge: 'calloutEdge', gotcha: 'calloutGotcha', perf: 'calloutPerf', security: 'calloutSecurity',
};

const SEVERITY_META = {
  blocker: { label: 'Blocker', rank: 0 },
  major: { label: 'Major', rank: 1 },
  minor: { label: 'Minor', rank: 2 },
  nit: { label: 'Nit', rank: 3 },
  praise: { label: 'Praise', rank: 4 },
};

async function renderBlock(block, ctx, anchorId) {
  const { md, renderCode, difitUrl } = ctx;
  const type = block?.type || 'md';
  const wrap = (cls, inner) =>
    `<div class="block ${cls}" id="${anchorId}" data-anchor="${anchorId}" data-hash="${hash(
      JSON.stringify(block)
    )}">${inner}</div>`;

  switch (type) {
    case 'md':
      return wrap('block-md', `<div class="prose">${await md(block.md)}</div>`);

    case 'code':
      return wrap(
        'block-code',
        codeFrame({
          html: renderCode(block.code || '', block.lang, {
            highlight: block.highlight,
            startLine: block.startLine,
          }),
          file: block.file,
          lines: block.lines,
          lang: normalizeLang(block.lang),
          caption: block.caption,
          difitUrl: block.difit === false ? null : difitUrl,
        })
      );

    case 'terminal':
      return wrap(
        'block-terminal',
        `<figure class="terminal"><div class="term-head"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="term-title">${esc(
          block.title || 'shell'
        )}</span></div><div class="term-body">${renderCode(block.code || '', 'bash', {
          numbers: false,
        })}</div>${block.caption ? `<figcaption>${esc(block.caption)}</figcaption>` : ''}</figure>`
      );

    case 'callout': {
      const variant = block.variant || 'info';
      const icon = CALLOUT_ICON[variant] || CALLOUT_ICON.info;
      const label = ctx.t[CALLOUT_LABEL_KEY[variant] || 'calloutInfo'];
      return wrap(
        `block-callout callout--${esc(variant)}`,
        `<div class="callout"><div class="callout-icon" aria-hidden="true">${esc(icon)}</div>` +
          `<div class="callout-main"><div class="callout-title">${esc(block.title || label)}</div>` +
          `<div class="prose">${await md(block.md)}</div></div></div>`
      );
    }

    case 'walkthrough': {
      const steps = [];
      for (const [i, step] of (block.steps || []).entries()) {
        const code = step.code
          ? codeFrame({
              html: renderCode(step.code.code || '', step.code.lang, {
                highlight: step.code.highlight,
                startLine: step.code.startLine,
              }),
              file: step.code.file,
              lines: step.code.lines,
              lang: normalizeLang(step.code.lang),
              caption: step.code.caption,
              difitUrl,
            })
          : '';
        steps.push(
          `<li class="wt-step"><div class="wt-num">${i + 1}</div><div class="wt-body">` +
            `<h4 class="wt-title">${esc(step.title || '')}</h4>` +
            `<div class="prose">${await md(step.md)}</div>${code}</div></li>`
        );
      }
      return wrap(
        'block-walkthrough',
        `${block.title ? `<h3 class="wt-heading">${esc(block.title)}</h3>` : ''}<ol class="walkthrough">${steps.join(
          ''
        )}</ol>`
      );
    }

    case 'compare': {
      const side = async (s, cls) =>
        `<div class="cmp-side ${cls}"><div class="cmp-label">${esc(s?.label || '')}</div>${
          s?.code
            ? codeFrame({
                html: renderCode(s.code, s.lang, { highlight: s.highlight }),
                lang: normalizeLang(s.lang),
                file: s.file,
              })
            : `<div class="prose">${await md(s?.md)}</div>`
        }</div>`;
      return wrap(
        'block-compare',
        `${block.title ? `<h3 class="cmp-heading">${esc(block.title)}</h3>` : ''}<div class="compare">${await side(
          block.left,
          'cmp-left'
        )}${await side(block.right, 'cmp-right')}</div>`
      );
    }

    case 'table': {
      const headers = (block.headers || []).map((h) => `<th>${esc(h)}</th>`).join('');
      const rows = [];
      for (const row of block.rows || []) {
        const cells = [];
        for (const cell of row) cells.push(`<td>${await mdInline(cell, md)}</td>`);
        rows.push(`<tr>${cells.join('')}</tr>`);
      }
      return wrap(
        'block-table',
        `${block.title ? `<h3 class="tbl-heading">${esc(block.title)}</h3>` : ''}<div class="table-wrap"><table><thead><tr>${headers}</tr></thead><tbody>${rows.join(
          ''
        )}</tbody></table></div>${block.caption ? `<p class="cap">${esc(block.caption)}</p>` : ''}`
      );
    }

    case 'diagram':
      return wrap(
        'block-diagram',
        `<figure class="diagram"><pre class="mermaid">${esc(block.mermaid || '')}</pre>${
          block.caption ? `<figcaption>${esc(block.caption)}</figcaption>` : ''
        }</figure>`
      );

    case 'filetree':
      return wrap(
        'block-filetree',
        `<figure class="filetree"><pre>${esc(block.tree || '')}</pre>${
          block.caption ? `<figcaption>${esc(block.caption)}</figcaption>` : ''
        }</figure>`
      );

    case 'cards': {
      const items = [];
      for (const it of block.items || []) {
        items.push(
          `<div class="card">${it.icon ? `<div class="card-icon">${esc(it.icon)}</div>` : ''}` +
            `<div class="card-title">${esc(it.title || '')}</div>` +
            `<div class="prose">${await md(it.md)}</div></div>`
        );
      }
      return wrap(
        'block-cards',
        `${block.title ? `<h3 class="cards-heading">${esc(block.title)}</h3>` : ''}<div class="cards">${items.join(
          ''
        )}</div>`
      );
    }

    case 'timeline': {
      const items = [];
      for (const it of block.items || []) {
        items.push(
          `<li class="tl-item"><div class="tl-dot"></div><div class="tl-body">` +
            `${it.tag ? `<span class="tl-tag">${esc(it.tag)}</span>` : ''}` +
            `<div class="tl-title">${esc(it.title || '')}</div>` +
            `<div class="prose">${await md(it.md)}</div></div></li>`
        );
      }
      return wrap(
        'block-timeline',
        `${block.title ? `<h3 class="tl-heading">${esc(block.title)}</h3>` : ''}<ul class="timeline">${items.join(
          ''
        )}</ul>`
      );
    }

    case 'keyvalue': {
      const rows = (block.items || [])
        .map((it) => `<div class="kv-row"><dt>${esc(it.k)}</dt><dd>${esc(it.v)}</dd></div>`)
        .join('');
      return wrap('block-keyvalue', `<dl class="keyvalue">${rows}</dl>`);
    }

    case 'quote':
      return wrap(
        'block-quote',
        `<blockquote class="pullquote"><div class="prose">${await md(block.md)}</div>${
          block.cite ? `<cite>${esc(block.cite)}</cite>` : ''
        }</blockquote>`
      );

    default:
      return wrap('block-md', `<div class="prose">${await md(block.md || '')}</div>`);
  }
}

/* ------------------------------------------------------------- sections -- */

function slugifyId(s, fallback) {
  const out = String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return out || fallback;
}

async function renderSections(content, ctx) {
  const out = [];
  const toc = [];
  const used = new Set();
  for (const [si, section] of (content.sections || []).entries()) {
    let secId = `sec-${slugifyId(section.id || section.title, `s${si}`)}`;
    while (used.has(secId)) secId = `${secId}-${si}`;
    used.add(secId);
    toc.push({ id: secId, title: section.title || `Section ${si + 1}` });
    const blocks = [];
    for (const [bi, block] of (section.blocks || []).entries()) {
      blocks.push(await renderBlock(block, ctx, `${secId}-b${bi}`));
    }
    out.push(
      `<section class="section" id="${secId}" data-section="${secId}">` +
        `<header class="section-head">` +
        `${section.kicker ? `<div class="section-kicker">${esc(section.kicker)}</div>` : ''}` +
        `<h2 class="section-title">${esc(
          section.title || ''
        )}<a class="anchor-link" href="#${secId}" aria-label="Link to section">#</a></h2>` +
        `${section.summary ? `<p class="section-summary">${esc(section.summary)}</p>` : ''}` +
        `</header><div class="section-body">${blocks.join('\n')}</div></section>`
    );
  }
  return { html: out.join('\n'), toc };
}

async function renderReview(review, ctx) {
  if (!review) return { html: '', toc: null };
  const { md } = ctx;
  const findings = [...(review.findings || [])].sort(
    (a, b) => (SEVERITY_META[a.severity]?.rank ?? 9) - (SEVERITY_META[b.severity]?.rank ?? 9)
  );
  const items = [];
  for (const [i, f] of findings.entries()) {
    const meta = SEVERITY_META[f.severity] || { label: f.severity || 'Note' };
    const where = [f.file, f.line ? `L${f.line}` : null].filter(Boolean).join(' / ');
    items.push(
      `<article class="finding sev--${esc(f.severity || 'minor')}" id="finding-${i}" data-anchor="finding-${i}" data-hash="${hash(
        JSON.stringify(f)
      )}"><div class="finding-head"><span class="sev-chip">${esc(meta.label)}</span>` +
        `<h3 class="finding-title">${esc(f.title || '')}</h3>` +
        `${where ? `<span class="finding-where">${esc(where)}</span>` : ''}</div>` +
        `<div class="prose">${await md(f.body)}</div>` +
        `${
          f.suggestion
            ? `<div class="finding-fix"><div class="fix-label">${esc(ctx.t.suggestedFix)}</div><div class="prose">${await md(
                f.suggestion
              )}</div></div>`
            : ''
        }</article>`
    );
  }
  const counts = Object.entries(
    findings.reduce((acc, f) => {
      const k = f.severity || 'minor';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {})
  )
    .sort((a, b) => (SEVERITY_META[a[0]]?.rank ?? 9) - (SEVERITY_META[b[0]]?.rank ?? 9))
    .map(
      ([sev, n]) =>
        `<span class="rv-count sev--${esc(sev)}">${esc(SEVERITY_META[sev]?.label || sev)} ${n}</span>`
    )
    .join('');

  return {
    toc: { id: 'sec-review', title: review.title || ctx.t.review },
    html:
      `<section class="section section--review" id="sec-review" data-section="sec-review">` +
      `<header class="section-head"><div class="section-kicker">${esc(ctx.t.reviewKicker)}</div>` +
      `<h2 class="section-title">${esc(review.title || ctx.t.review)}<a class="anchor-link" href="#sec-review">#</a></h2></header>` +
      `<div class="section-body"><div class="verdict" id="review-verdict" data-anchor="review-verdict" data-hash="${hash(
        JSON.stringify(review.verdict || '')
      )}"><div class="verdict-label">${esc(ctx.t.verdict)}</div>` +
      `<div class="prose verdict-body">${await md(review.verdict)}</div>` +
      `${counts ? `<div class="rv-counts">${counts}</div>` : ''}</div>${items.join('\n')}</div></section>`,
  };
}

async function renderFaq(faq, ctx) {
  if (!faq || !faq.length) return { html: '', toc: null };
  const { md } = ctx;
  const items = [];
  for (const [i, item] of faq.entries()) {
    items.push(
      `<details class="faq-item" id="faq-${i}" data-anchor="faq-${i}" data-hash="${hash(
        JSON.stringify(item)
      )}"${item.open ? ' open' : ''}>` +
        `<summary class="faq-q"><span class="faq-marker" aria-hidden="true"></span><span>${esc(
          item.q || ''
        )}</span></summary>` +
        `<div class="faq-a prose">${await md(item.a)}</div></details>`
    );
  }
  return {
    toc: { id: 'sec-faq', title: ctx.t.faq },
    html:
      `<section class="section section--faq" id="sec-faq" data-section="sec-faq">` +
      `<header class="section-head"><div class="section-kicker">${esc(ctx.t.faqKicker)}</div>` +
      `<h2 class="section-title">${esc(ctx.t.faq)}<a class="anchor-link" href="#sec-faq">#</a></h2>` +
      `<p class="section-summary">${esc(ctx.t.faqSummary)}</p></header>` +
      `<div class="section-body faq-list"><div class="faq-toolbar">` +
      `<input type="search" class="faq-search" placeholder="${esc(ctx.t.faqSearch)}" aria-label="Search FAQ">` +
      `<button class="faq-expand" type="button">${esc(ctx.t.expandAll)}</button></div>${items.join('\n')}</div></section>`,
  };
}

async function renderGlossary(glossary, ctx) {
  if (!glossary || !glossary.length) return { html: '', toc: null };
  const { md } = ctx;
  const items = [];
  for (const [i, g] of glossary.entries()) {
    items.push(
      `<div class="gl-item" id="gl-${i}" data-anchor="gl-${i}" data-hash="${hash(JSON.stringify(g))}">` +
        `<div class="gl-term">${esc(g.term)}</div>` +
        `<div class="prose gl-def">${await md(g.meaning)}</div></div>`
    );
  }
  return {
    toc: { id: 'sec-glossary', title: ctx.t.glossary },
    html:
      `<section class="section section--glossary" id="sec-glossary" data-section="sec-glossary">` +
      `<header class="section-head"><div class="section-kicker">${esc(ctx.t.glossaryKicker)}</div>` +
      `<h2 class="section-title">${esc(ctx.t.glossary)}<a class="anchor-link" href="#sec-glossary">#</a></h2></header>` +
      `<div class="section-body gl-grid">${items.join('\n')}</div></section>`,
  };
}

/* ----------------------------------------------------------------- page -- */

const TYPE_LABEL = {
  pr: 'Pull Request',
  commit: 'Commit',
  repo: 'Repository',
  url: 'Link',
  term: 'Concept',
  file: 'File',
  branch: 'Branch',
  issue: 'Issue',
  diff: 'Diff',
};

// Inline SVG beats font glyphs here: box-drawing characters render inconsistently
// (or as tofu) depending on the system's installed fonts.
const SVG = (d, extra = '') =>
  `<svg class="ico" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}${extra}</svg>`;

const ICONS = {
  // marquee / region select
  comment: SVG('<path d="M2 4.5V3.5A1.5 1.5 0 0 1 3.5 2h1M11.5 2h1A1.5 1.5 0 0 1 14 3.5v1M14 11.5v1a1.5 1.5 0 0 1-1.5 1.5h-1M4.5 14h-1A1.5 1.5 0 0 1 2 12.5v-1M6.7 2h2.6M2 6.7v2.6M14 6.7v2.6M6.7 14h2.6"/>'),
  threads: SVG('<path d="M2.5 3.2A1.2 1.2 0 0 1 3.7 2h8.6a1.2 1.2 0 0 1 1.2 1.2v6.1a1.2 1.2 0 0 1-1.2 1.2H6.4L3.4 13V10.5h-.9a1.2 1.2 0 0 1-1.2-1.2V3.2z" stroke-linejoin="round"/>'),
  sun: SVG('<circle cx="8" cy="8" r="3.1"/><path d="M8 1.3v1.4M8 13.3v1.4M14.7 8h-1.4M2.7 8H1.3M12.7 3.3l-1 1M4.3 11.7l-1 1M12.7 12.7l-1-1M4.3 4.3l-1-1"/>'),
  moon: SVG('<path d="M13.4 9.6A5.7 5.7 0 0 1 6.4 2.6a5.9 5.9 0 1 0 7 7z"/>'),
  auto: SVG('<circle cx="8" cy="8" r="6"/><path d="M8 2a6 6 0 0 0 0 12z" fill="currentColor" stroke="none"/>'),
};

const FAVICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect width="32" height="32" rx="8" fill="#5b6cff"/>' +
  '<path d="M9 22V10h4.6c2.6 0 4.2 1.4 4.2 3.7 0 1.7-.9 2.9-2.5 3.4L18.6 22h-2.9l-2.8-4.4h-1.4V22H9zm2.5-6.6h1.8c1.1 0 1.8-.6 1.8-1.6s-.7-1.6-1.8-1.6h-1.8v3.2z" fill="#fff"/>' +
  '<circle cx="22" cy="21" r="2.4" fill="#fff"/></svg>';

async function buildHtml(content, ctx, opts) {
  const { md, t } = ctx;
  const { toc: sectionToc, html: sectionsHtml } = await renderSections(content, ctx);
  const review = await renderReview(content.review, ctx);
  const faq = await renderFaq(content.faq, ctx);
  const glossary = await renderGlossary(content.glossary, ctx);
  const toc = [...sectionToc, review.toc, faq.toc, glossary.toc].filter(Boolean);

  const tocHtml = toc
    .map(
      (item) =>
        `<a class="toc-link" href="#${item.id}" data-toc="${item.id}"><span class="toc-dot"></span><span class="toc-text">${esc(
          item.title
        )}</span></a>`
    )
    .join('');

  const stats = (content.meta?.stats || [])
    .map(
      (s) =>
        `<div class="stat"><div class="stat-value">${esc(s.value)}</div><div class="stat-label">${esc(
          s.label
        )}</div></div>`
    )
    .join('');

  const tldrHtml = (
    await Promise.all((content.tldr || []).map(async (line) => `<li>${await mdInline(line, md)}</li>`))
  ).join('');

  const typeLabel = TYPE_LABEL[content.targetType] || 'Explainer';
  const difit = content.difit || null;
  const base = opts.base || '';

  return `<!doctype html>
<html lang="${esc(opts.htmlLang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(content.title || 'Explainer')}</title>
<link rel="stylesheet" href="${base}/static/app.css">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(FAVICON)}">
<script>(function(){try{var t=localStorage.getItem('explain-theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
</head>
<body>
<a class="skip" href="#doc">Skip to content</a>

<header class="topbar">
  <div class="tb-left">
    <a class="tb-home" href="${base}/" title="All explainers"><span class="tb-logo" aria-hidden="true"></span></a>
    <div class="tb-titles">
      <div class="tb-title" title="${esc(content.title || '')}">${esc(content.title || '')}</div>
      <div class="tb-sub"><span class="badge badge--type">${esc(typeLabel)}</span>${
        content.target?.label
          ? `<span class="tb-target">${
              content.target.url
                ? `<a href="${esc(content.target.url)}" target="_blank" rel="noopener">${esc(
                    content.target.label
                  )}</a>`
                : esc(content.target.label)
            }</span>`
          : ''
      }</div>
    </div>
  </div>
  <div class="tb-right">
    ${
      difit?.url
        ? `<a class="btn btn--difit" href="${esc(
            difit.url
          )}" target="_blank" rel="noopener" id="difit-link"><span class="btn-dot" id="difit-dot" title="difit status"></span><span class="lbl">${esc(t.codeDiff)}</span><span class="btn-meta">difit</span></a>`
        : ''
    }
    <button class="btn btn--ghost" id="btn-comment-mode" type="button" title="${esc(t.comment)} (C)">${ICONS.comment}<span class="lbl">${esc(t.comment)}</span><kbd>C</kbd></button>
    <button class="btn btn--primary" id="btn-submit" type="button" disabled><span class="btn-dot" id="listen-dot" title="Claude session status"></span><span class="lbl">${esc(t.sendToClaude)}</span><span class="pill" id="pending-count">0</span></button>
    <button class="btn btn--ghost btn--icon" id="btn-threads" type="button" title="${esc(t.threads)} (T)">${ICONS.threads}<span class="pill pill--muted" id="thread-count">0</span></button>
    <button class="btn btn--ghost btn--icon" id="btn-theme" type="button" title="Toggle theme"><span id="theme-ico">${ICONS.auto}</span></button>
  </div>
</header>

<div class="progress"><div class="progress-bar" id="progress-bar"></div></div>

<div class="shell">
  <aside class="toc" id="toc">
    <div class="toc-head">${esc(t.contents)}</div>
    <nav class="toc-nav">${tocHtml}</nav>
    <div class="toc-foot">
      <div class="toc-hint"><kbd>C</kbd> ${esc(t.hintCommentMode)}</div>
      <div class="toc-hint"><kbd>T</kbd> ${esc(t.hintThreads)}</div>
      <div class="toc-hint"><kbd>D</kbd> ${esc(t.hintOpenDifit)}</div>
    </div>
  </aside>

  <main class="doc" id="doc">
    <section class="hero">
      <h1 class="hero-title">${esc(content.title || '')}</h1>
      ${content.subtitle ? `<p class="hero-sub">${esc(content.subtitle)}</p>` : ''}
      ${stats ? `<div class="stats">${stats}</div>` : ''}
      ${
        tldrHtml
          ? `<div class="tldr" id="tldr" data-anchor="tldr" data-hash="${hash(
              JSON.stringify(content.tldr)
            )}"><div class="tldr-label">${esc(t.tldr)}</div><ul class="tldr-list">${tldrHtml}</ul></div>`
          : ''
      }
      ${
        difit?.url
          ? `<div class="difit-card"><div class="dc-main"><div class="dc-title">${esc(t.difitCardTitle)}</div><div class="dc-sub">${esc(
              difit.label || t.difitCardSub
            )}</div></div><a class="btn btn--primary" href="${esc(
              difit.url
            )}" target="_blank" rel="noopener">${esc(t.openDifit)}</a></div>`
          : ''
      }
    </section>

    ${sectionsHtml}
    ${review.html}
    ${faq.html}
    ${glossary.html}

    <footer class="doc-foot">
      <div>${esc(t.generated)} ${esc(content.meta?.generatedAt || '')}</div>
      <div class="foot-hint">${esc(t.footHint)} <button class="linkish" id="foot-comment">${esc(t.footCta)}</button> ${esc(t.footTail)}</div>
    </footer>
  </main>
</div>

<div class="bbox-layer" id="bbox-layer"></div>
<div class="marker-layer" id="marker-layer"></div>

<aside class="threads" id="threads" aria-label="Comment threads">
  <div class="th-head">
    <div class="th-title">${esc(t.threads)}<span class="pill pill--muted" id="th-count">0</span></div>
    <div class="th-head-actions">
      <button class="th-icon" id="th-refresh" type="button" title="Refresh">${SVG('<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.7 2.2v3h-3"/>')}</button>
      <button class="th-icon" id="th-close" type="button" aria-label="Close">${SVG('<path d="M4 4l8 8M12 4l-8 8"/>')}</button>
    </div>
  </div>
  <div class="th-tabs">
    <button class="th-tab is-active" data-filter="all" type="button">${esc(t.tabAll)}</button>
    <button class="th-tab" data-filter="pending" type="button">${esc(t.tabPending)}</button>
    <button class="th-tab" data-filter="answered" type="button">${esc(t.tabAnswered)}</button>
    <button class="th-tab" data-filter="difit" type="button">${esc(t.tabDifit)}</button>
  </div>
  <div class="th-list" id="th-list"></div>
  <div class="th-foot">
    <div class="th-status" id="th-status"><span class="live-dot"></span>${esc(t.live)}</div>
    <div class="th-foot-actions">
      <button class="btn btn--ghost btn--sm" id="th-prompt" type="button" title="Paste-ready prompt for a Claude session">${esc(t.copyPrompt)}</button>
      <button class="btn btn--primary btn--sm" id="th-submit" type="button" disabled>${esc(t.sendPending)}</button>
    </div>
  </div>
</aside>

<div class="composer" id="composer" hidden>
  <div class="cm-head"><span class="cm-kind" id="cm-kind">${esc(t.regionComment)}</span><button class="cm-close" id="cm-close" type="button" aria-label="Cancel">&#10005;</button></div>
  <div class="cm-quote" id="cm-quote"></div>
  <textarea class="cm-input" id="cm-input" rows="4" placeholder="${esc(t.composerPlaceholder)}"></textarea>
  <div class="cm-foot">
    <div class="cm-hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> ${esc(t.saveHint)}</div>
    <div class="cm-actions"><button class="btn btn--ghost btn--sm" id="cm-cancel" type="button">${esc(t.cancel)}</button><button class="btn btn--primary btn--sm" id="cm-save" type="button">${esc(t.saveComment)}</button></div>
  </div>
</div>

<div class="sent-backdrop" id="sent-backdrop" hidden></div>
<div class="sent-modal" id="sent-modal" hidden role="dialog" aria-modal="true" aria-labelledby="sm-title">
  <div class="sm-head">
    <div class="sm-title" id="sm-title">${esc(t.promptTitle)}</div>
    <button class="cm-close" id="sm-close" type="button" aria-label="Close">&#10005;</button>
  </div>
  <div class="sm-status" id="sm-status"></div>
  <div class="sm-label">${esc(t.promptLabel)}</div>
  <textarea class="sm-prompt" id="sm-prompt" readonly spellcheck="false"></textarea>
  <div class="sm-foot">
    <div class="sm-hint" id="sm-hint"></div>
    <div class="cm-actions">
      <button class="btn btn--ghost btn--sm" id="sm-done" type="button">${esc(t.close)}</button>
      <button class="btn btn--primary btn--sm" id="sm-copy" type="button">${esc(t.copyPrompt)}</button>
    </div>
  </div>
</div>

<div class="sel-bubble" id="sel-bubble" hidden><button type="button" id="sel-comment">${esc(t.commentOnSelection)}</button></div>
<div class="toast-wrap" id="toasts"></div>

<script>window.__EXPLAIN__ = ${JSON.stringify({
    slug: content.slug,
    title: content.title,
    base,
    difit: difit || null,
    generatedAt: content.meta?.generatedAt || null,
    language: content.language,
    i18n: clientStrings(content.language),
  }).replace(/</g, '\\u003c')};</script>
<script src="${base}/static/mermaid.min.js"></script>
<script src="${base}/static/app.js"></script>
</body>
</html>`;
}

/* ------------------------------------------------------------------ api -- */

export async function render(slug, contentInput, { base = '' } = {}) {
  ensureHub();
  const s = safeSlug(slug);
  const dir = pageDir(s);
  fs.mkdirSync(dir, { recursive: true });

  const content = typeof contentInput === 'string' ? JSON.parse(contentInput) : contentInput;
  content.slug = s;
  content.meta = content.meta || {};
  content.meta.generatedAt = new Date().toISOString();
  // Page-level language wins, then the hub default, then Hinglish.
  content.language = (content.language || readConfig().language || DEFAULT_LANGUAGE)
    .toString().toLowerCase().trim();
  const t = strings(content.language);

  const highlighter = await createHighlighter({
    themes: [THEMES.light, THEMES.dark],
    langs: collectLangs(content),
  });
  const renderCode = makeCodeRenderer(highlighter);
  const ctx = { renderCode, md: makeMarkdown(renderCode), difitUrl: content.difit?.url || null, t };

  const HTML_LANG = { hindi: 'hi', hi: 'hi', english: 'en', en: 'en' };
  const html = await buildHtml(content, ctx, {
    base,
    htmlLang: HTML_LANG[content.language] || 'en',
  });
  fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify(content, null, 2));
  fs.writeFileSync(path.join(dir, 'index.html'), html);

  const prev = readMeta(s);
  writeMeta(s, {
    ...prev,
    slug: s,
    title: content.title || s,
    subtitle: content.subtitle || '',
    targetType: content.targetType || 'term',
    target: content.target || null,
    difit: content.difit || null,
    language: content.language,
    generatedAt: content.meta.generatedAt,
    updatedAt: new Date().toISOString(),
  });
  highlighter.dispose?.();
  return { slug: s, dir, html: path.join(dir, 'index.html'), bytes: Buffer.byteLength(html) };
}

export default { render, esc };
