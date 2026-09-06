/* app.js - interactive layer for every explainer page.
   Owns: theme, TOC scrollspy, code copy, FAQ search, mermaid, bounding-box
   commenting, the threads drawer, live SSE sync, and the difit bridge. */
(function () {
  'use strict';

  var CFG = window.__EXPLAIN__ || {};
  var API = (CFG.base || '') + '/api/p/' + encodeURIComponent(CFG.slug);

  // Chrome strings come from the server-resolved locale; every lookup falls back
  // to the English default baked in here so a missing key never renders blank.
  var I18N = CFG.i18n || {};
  // Named T, not t: thread objects are conventionally bound to `t` in this file
  // (threadHtml(t, i), .map(function (t, i))), which would shadow the helper.
  function T(key, fallback) {
    return Object.prototype.hasOwnProperty.call(I18N, key) ? I18N[key] : fallback;
  }

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var state = {
    threads: [],
    difit: { alive: false, threads: [], url: CFG.difit && CFG.difit.url },
    filter: 'all',
    commentMode: false,
    activeId: null,
    draft: null,
    connected: false,
  };

  /* ------------------------------------------------------------ helpers -- */

  function toast(msg, kind) {
    var wrap = $('#toasts');
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast--' + kind : '');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .25s ease, transform .25s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      setTimeout(function () { el.remove(); }, 260);
    }, kind === 'err' ? 5200 : 2800);
  }

  function api(pathname, opts) {
    return fetch(API + pathname, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts))
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) {
          if (!r.ok) throw new Error(body.error || ('HTTP ' + r.status));
          return body;
        });
      });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Minimal markdown for thread messages. Input is escaped first, so every
  // branch below only ever produces tags we generated ourselves.
  function mdLite(src) {
    var text = escapeHtml(src);
    var blocks = [];
    text = text.replace(/```([a-zA-Z0-9+#._-]*)\n([\s\S]*?)```/g, function (_, lang, code) {
      blocks.push('<pre><code' + (lang ? ' class="language-' + lang + '"' : '') + '>' + code.replace(/\n$/, '') + '</code></pre>');
      return '\u0000CODE' + (blocks.length - 1) + '\u0000';
    });
    text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    text = text.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');

    var lines = text.split('\n');
    var out = [];
    var list = null;
    function closeList() { if (list) { out.push('</' + list + '>'); list = null; } }
    function cells(row) {
      return row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return c.trim(); });
    }
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      // GFM table: a header row followed by a |---|---| delimiter row.
      if (/\|/.test(ln) && i + 1 < lines.length && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1]) && /\|/.test(lines[i + 1])) {
        closeList();
        var head = cells(ln);
        var body = [];
        i += 2;
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) {
          body.push(cells(lines[i]));
          i++;
        }
        i--;
        out.push('<div class="table-wrap"><table><thead><tr>' +
          head.map(function (c) { return '<th>' + c + '</th>'; }).join('') +
          '</tr></thead><tbody>' +
          body.map(function (r) {
            return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
          }).join('') +
          '</tbody></table></div>');
        continue;
      }
      var h = ln.match(/^(#{1,4})\s+(.*)$/);
      var ul = ln.match(/^\s*[-*]\s+(.*)$/);
      var ol = ln.match(/^\s*\d+[.)]\s+(.*)$/);
      if (h) { closeList(); out.push('<h4>' + h[2] + '</h4>'); }
      else if (ul) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + ul[1] + '</li>'); }
      else if (ol) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + ol[1] + '</li>'); }
      else if (!ln.trim()) { closeList(); }
      else { closeList(); out.push('<p>' + ln + '</p>'); }
    }
    closeList();
    return out.join('').replace(/\u0000CODE(\d+)\u0000/g, function (_, i2) { return blocks[Number(i2)]; });
  }

  function timeAgo(iso) {
    if (!iso) return '';
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function docHeight() {
    return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
  }

  /* -------------------------------------------------------------- theme -- */

  var THEME_ICON = {
    sun: '<circle cx="8" cy="8" r="3.1"/><path d="M8 1.3v1.4M8 13.3v1.4M14.7 8h-1.4M2.7 8H1.3M12.7 3.3l-1 1M4.3 11.7l-1 1M12.7 12.7l-1-1M4.3 4.3l-1-1"/>',
    moon: '<path d="M13.4 9.6A5.7 5.7 0 0 1 6.4 2.6a5.9 5.9 0 1 0 7 7z"/>',
    auto: '<circle cx="8" cy="8" r="6"/><path d="M8 2a6 6 0 0 0 0 12z" fill="currentColor" stroke="none"/>',
  };

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'auto';
  }

  function applyTheme(next) {
    if (next === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('explain-theme', next === 'auto' ? '' : next); } catch (e) {}
    var ico = $('#theme-ico');
    if (ico) {
      var svg = ico.querySelector('svg');
      // Reuse the server-rendered SVG shell, just swap the paths inside it.
      if (svg) svg.innerHTML = next === 'dark' ? THEME_ICON.moon
        : next === 'light' ? THEME_ICON.sun : THEME_ICON.auto;
    }
    renderMermaid();
  }

  var themeBtn = $('#btn-theme');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var cur = currentTheme();
      applyTheme(cur === 'dark' ? 'light' : cur === 'light' ? 'auto' : 'dark');
    });
    applyTheme(currentTheme());
  }

  /* ------------------------------------------------------------ mermaid -- */

  function isDark() {
    var t = currentTheme();
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function renderMermaid() {
    if (typeof window.mermaid === 'undefined') return;
    var nodes = $$('.mermaid');
    if (!nodes.length) return;
    nodes.forEach(function (n) {
      if (!n.dataset.src) n.dataset.src = n.textContent;
      n.removeAttribute('data-processed');
      n.innerHTML = escapeHtml(n.dataset.src);
    });
    try {
      window.mermaid.initialize({
        startOnLoad: false,
        theme: isDark() ? 'dark' : 'default',
        securityLevel: 'strict',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        themeVariables: isDark() ? { background: '#14171f', primaryColor: '#1b2040' } : {},
      });
      window.mermaid.run({ nodes: nodes }).catch(function () {});
    } catch (e) { /* diagram stays as readable source */ }
  }

  /* --------------------------------------------------------- scroll spy -- */

  var tocLinks = $$('.toc-link');
  var sections = $$('.section, .hero');
  var progressBar = $('#progress-bar');

  function onScroll() {
    var top = window.scrollY;
    var max = docHeight() - window.innerHeight;
    if (progressBar) progressBar.style.width = (max > 0 ? Math.min(100, (top / max) * 100) : 0) + '%';
    if (!tocLinks.length) return;
    var probe = top + window.innerHeight * 0.28;
    var active = null;
    sections.forEach(function (s) {
      if (s.offsetTop <= probe) active = s.id;
    });
    tocLinks.forEach(function (l) {
      l.classList.toggle('is-active', l.dataset.toc === active);
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  /* --------------------------------------------------------- copy code -- */

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.cf-copy');
    if (!btn) return;
    var frame = btn.closest('.codeframe, .terminal');
    var code = frame && frame.querySelector('code');
    if (!code) return;
    navigator.clipboard.writeText(code.innerText).then(function () {
      btn.textContent = 'copied';
      btn.classList.add('is-done');
      setTimeout(function () { btn.textContent = 'copy'; btn.classList.remove('is-done'); }, 1400);
    }).catch(function () { toast(T('toastClipboardBlocked', 'Clipboard blocked by the browser'), 'err'); });
  });

  /* --------------------------------------------------------------- faq -- */

  var faqSearch = $('.faq-search');
  if (faqSearch) {
    faqSearch.addEventListener('input', function () {
      var q = faqSearch.value.trim().toLowerCase();
      $$('.faq-item').forEach(function (item) {
        var hit = !q || item.textContent.toLowerCase().indexOf(q) !== -1;
        item.classList.toggle('is-hidden', !hit);
        if (q && hit) item.open = true;
        if (!q) item.open = false;
      });
    });
  }
  var faqExpand = $('.faq-expand');
  if (faqExpand) {
    faqExpand.addEventListener('click', function () {
      var items = $$('.faq-item');
      var anyClosed = items.some(function (i) { return !i.open; });
      items.forEach(function (i) { i.open = anyClosed; });
      faqExpand.textContent = anyClosed ? T('collapseAll', 'collapse all') : T('expandAll', 'expand all');
    });
  }

  /* ------------------------------------------------------- anchor logic -- */

  function anchorEls() {
    return $$('[data-anchor]');
  }

  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
  }

  // Pick the anchored block that best contains the drawn box: the smallest one
  // whose rect overlaps it most. Smallest wins so a box inside a code block
  // anchors to that block, not to the whole section.
  function bestAnchor(box) {
    var best = null;
    var bestScore = 0;
    anchorEls().forEach(function (el) {
      var r = rectOf(el);
      var ox = Math.max(0, Math.min(box.x + box.w, r.x + r.w) - Math.max(box.x, r.x));
      var oy = Math.max(0, Math.min(box.y + box.h, r.y + r.h) - Math.max(box.y, r.y));
      var overlap = ox * oy;
      if (overlap <= 0) return;
      var score = overlap / Math.max(1, r.w * r.h);
      if (score > bestScore) { bestScore = score; best = el; }
    });
    return best;
  }

  function makeAnchor(box) {
    var el = bestAnchor(box);
    var section = el && el.closest('.section');
    if (!el) {
      return {
        anchorId: null, sectionId: section ? section.id : null,
        rel: null, abs: box, docWidth: document.documentElement.clientWidth, hash: null,
        label: 'page',
      };
    }
    var r = rectOf(el);
    return {
      anchorId: el.dataset.anchor,
      sectionId: section ? section.id : null,
      sectionTitle: section ? (section.querySelector('.section-title') || {}).textContent : null,
      hash: el.dataset.hash || null,
      rel: {
        x: (box.x - r.x) / Math.max(1, r.w),
        y: (box.y - r.y) / Math.max(1, r.h),
        w: box.w / Math.max(1, r.w),
        h: box.h / Math.max(1, r.h),
      },
      abs: box,
      docWidth: document.documentElement.clientWidth,
      label: describeAnchor(el),
    };
  }

  function describeAnchor(el) {
    var section = el.closest('.section');
    var title = section && section.querySelector('.section-title');
    var kind = (el.className.match(/block-([a-z]+)/) || [])[1] || el.className.split(' ')[0];
    var head = title ? title.textContent.replace(/#$/, '').trim() : 'page';
    return head + (kind ? ' › ' + kind : '');
  }

  function resolveAnchor(anchor) {
    if (!anchor) return null;
    if (!anchor.anchorId) return anchor.abs || null;
    var el = document.querySelector('[data-anchor="' + CSS.escape(anchor.anchorId) + '"]');
    if (!el) return null;
    var r = rectOf(el);
    var rel = anchor.rel;
    if (!rel) return r;
    return { x: r.x + rel.x * r.w, y: r.y + rel.y * r.h, w: rel.w * r.w, h: rel.h * r.h };
  }

  function anchorChanged(anchor) {
    if (!anchor || !anchor.anchorId) return false;
    var el = document.querySelector('[data-anchor="' + CSS.escape(anchor.anchorId) + '"]');
    if (!el) return true;
    return !!(anchor.hash && el.dataset.hash && anchor.hash !== el.dataset.hash);
  }

  // Collect the text actually sitting under the box, so Claude sees exactly
  // what was pointed at rather than just coordinates.
  function textInBox(box) {
    var doc = $('#doc');
    if (!doc) return '';
    var walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        return n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    var parts = [];
    var total = 0;
    var node;
    while ((node = walker.nextNode())) {
      if (total > 3000) break;
      var range = document.createRange();
      range.selectNodeContents(node);
      var rects = range.getClientRects();
      var hit = false;
      for (var i = 0; i < rects.length; i++) {
        var r = rects[i];
        var x = r.left + window.scrollX, y = r.top + window.scrollY;
        if (x < box.x + box.w && x + r.width > box.x && y < box.y + box.h && y + r.height > box.y) {
          hit = true;
          break;
        }
      }
      if (hit) {
        var t = node.nodeValue.replace(/\s+/g, ' ').trim();
        if (t) { parts.push(t); total += t.length; }
      }
    }
    return parts.join(' ').slice(0, 3000);
  }

  /* -------------------------------------------------------- comment mode -- */

  var bboxLayer = $('#bbox-layer');
  var markerLayer = $('#marker-layer');
  var composer = $('#composer');
  var hintEl = null;

  function setCommentMode(on) {
    state.commentMode = on;
    document.body.classList.toggle('comment-mode', on);
    var btn = $('#btn-comment-mode');
    if (btn) btn.classList.toggle('is-active', on);
    if (on) {
      if (!hintEl) {
        hintEl = document.createElement('div');
        hintEl.className = 'bbox-hint';
        hintEl.innerHTML = escapeHtml(T('bboxHint', 'Drag a box on the page, then write your comment')) +
          ' <kbd>Esc</kbd> ' + escapeHtml(T('toExit', 'to exit'));
        document.body.appendChild(hintEl);
      }
    } else if (hintEl) {
      hintEl.remove();
      hintEl = null;
    }
  }

  $('#btn-comment-mode').addEventListener('click', function () { setCommentMode(!state.commentMode); });
  var footBtn = $('#foot-comment');
  if (footBtn) footBtn.addEventListener('click', function () { setCommentMode(true); window.scrollTo({ top: 0, behavior: 'smooth' }); });

  var drag = null;
  var draftEl = null;

  bboxLayer.addEventListener('mousedown', function (e) {
    if (!state.commentMode || e.button !== 0) return;
    e.preventDefault();
    drag = { x0: e.pageX, y0: e.pageY };
    draftEl = document.createElement('div');
    draftEl.className = 'bbox-draft';
    bboxLayer.appendChild(draftEl);
  });

  window.addEventListener('mousemove', function (e) {
    if (!drag) return;
    var box = normBox(drag.x0, drag.y0, e.pageX, e.pageY);
    Object.assign(draftEl.style, {
      left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px',
    });
    draftEl.dataset.size = Math.round(box.w) + '×' + Math.round(box.h);
  });

  window.addEventListener('mouseup', function (e) {
    if (!drag) return;
    var box = normBox(drag.x0, drag.y0, e.pageX, e.pageY);
    drag = null;
    if (draftEl) { draftEl.remove(); draftEl = null; }
    if (box.w < 12 || box.h < 12) return; // ignore stray clicks
    openComposer({ kind: 'bbox', box: box, quote: textInBox(box), anchor: makeAnchor(box) });
  });

  function normBox(x0, y0, x1, y1) {
    return {
      x: Math.min(x0, x1), y: Math.min(y0, y1),
      w: Math.abs(x1 - x0), h: Math.abs(y1 - y0),
    };
  }

  /* ---------------------------------------------------- text selection -- */

  var selBubble = $('#sel-bubble');
  var pendingSelection = null;

  document.addEventListener('mouseup', function () {
    if (state.commentMode) return;
    setTimeout(function () {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) { selBubble.hidden = true; return; }
      var range = sel.getRangeAt(0);
      var doc = $('#doc');
      if (!doc || !doc.contains(range.commonAncestorContainer)) { selBubble.hidden = true; return; }
      var r = range.getBoundingClientRect();
      var box = { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
      pendingSelection = { kind: 'selection', box: box, quote: sel.toString().trim().slice(0, 3000), anchor: makeAnchor(box) };
      selBubble.hidden = false;
      selBubble.style.left = Math.max(8, box.x) + 'px';
      selBubble.style.top = (box.y - 42) + 'px';
    }, 10);
  });

  $('#sel-comment').addEventListener('click', function () {
    selBubble.hidden = true;
    if (pendingSelection) openComposer(pendingSelection);
    window.getSelection().removeAllRanges();
  });

  document.addEventListener('mousedown', function (e) {
    if (!selBubble.hidden && !selBubble.contains(e.target)) selBubble.hidden = true;
  });

  /* ----------------------------------------------------------- composer -- */

  function openComposer(draft) {
    state.draft = draft;
    $('#cm-kind').textContent = draft.kind === 'selection'
      ? T('selectionComment', 'Selection comment')
      : T('regionComment', 'Region comment');
    var q = $('#cm-quote');
    q.textContent = draft.quote ? draft.quote.slice(0, 600) : '';
    var input = $('#cm-input');
    input.value = '';
    composer.hidden = false;

    var top = draft.box.y + draft.box.h + 10;
    var left = draft.box.x;
    var w = composer.offsetWidth || 400;
    left = Math.min(left, window.scrollX + document.documentElement.clientWidth - w - 16);
    left = Math.max(window.scrollX + 12, left);
    // Flip above the box if it would fall off the bottom of the document.
    if (top + composer.offsetHeight > docHeight()) top = Math.max(12, draft.box.y - composer.offsetHeight - 10);
    composer.style.left = left + 'px';
    composer.style.top = top + 'px';
    input.focus();
    var cy = top + composer.offsetHeight;
    if (cy > window.scrollY + window.innerHeight) {
      window.scrollTo({ top: cy - window.innerHeight + 30, behavior: 'smooth' });
    }
  }

  function closeComposer() {
    composer.hidden = true;
    state.draft = null;
  }

  $('#cm-cancel').addEventListener('click', closeComposer);
  $('#cm-close').addEventListener('click', closeComposer);
  $('#cm-save').addEventListener('click', saveComment);
  $('#cm-input').addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveComment(); }
    if (e.key === 'Escape') { e.preventDefault(); closeComposer(); }
  });

  function saveComment() {
    var body = $('#cm-input').value.trim();
    if (!body) { toast(T('toastEmptyComment', 'The comment is empty'), 'err'); return; }
    var d = state.draft;
    if (!d) return;
    api('/threads', {
      method: 'POST',
      body: JSON.stringify({
        kind: d.kind, anchor: d.anchor, quote: d.quote, body: body, contentHash: d.anchor && d.anchor.hash,
      }),
    }).then(function (res) {
      closeComposer();
      setCommentMode(false);
      toast(T('toastSavedDraft', 'Comment saved as draft'), 'ok');
      state.activeId = res.thread.id;
      return refreshThreads();
    }).then(function () {
      openThreads(true);
    }).catch(function (err) { toast(T('toastSaveFailed', 'Save failed: ') + err.message, 'err'); });
  }

  /* ------------------------------------------------------------ markers -- */

  // A marker overlays real content, so it must never extend the scrollable area.
  // Clamping here means a stale or malformed anchor degrades to a smaller box
  // instead of stretching the page.
  function clampToDoc(box) {
    var maxW = document.documentElement.clientWidth;
    var x = Math.max(0, Math.min(box.x, maxW - 8));
    var w = Math.max(8, Math.min(box.w, maxW - x));
    return { x: x, y: Math.max(0, box.y), w: w, h: Math.max(8, box.h) };
  }

  function drawMarkers() {
    markerLayer.innerHTML = '';
    var nums = threadNumbers();
    var visible = state.threads.filter(function (t) { return t.anchor && t.status !== 'resolved'; });
    visible.forEach(function (t) {
      var box = resolveAnchor(t.anchor);
      var stale = !box || anchorChanged(t.anchor);
      if (!box) return;
      box = clampToDoc(box);
      var el = document.createElement('div');
      var cls = 'marker';
      if (t.status === 'answered') cls += ' marker--answered';
      else if (t.status === 'draft') cls += ' marker--saved';
      if (stale) cls += ' marker--outdated';
      el.className = cls;
      el.dataset.threadId = t.id;
      Object.assign(el.style, {
        left: box.x + 'px', top: box.y + 'px',
        width: Math.max(16, box.w) + 'px', height: Math.max(16, box.h) + 'px',
      });
      var pin = document.createElement('div');
      pin.className = 'marker-pin';
      pin.textContent = String(nums[t.id] || '?');
      pin.title = (t.messages[0] && t.messages[0].body || '').slice(0, 140);
      el.appendChild(pin);
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        focusThread(t.id);
      });
      markerLayer.appendChild(el);
    });
  }

  var redrawTimer = null;
  function scheduleRedraw() {
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(drawMarkers, 90);
  }
  window.addEventListener('resize', scheduleRedraw);
  if (window.visualViewport) {
    // Pinch-zoom changes layout without firing a window resize.
    window.visualViewport.addEventListener('resize', scheduleRedraw);
  }
  document.addEventListener('toggle', scheduleRedraw, true);

  /* ------------------------------------------------------ threads panel -- */

  var FULL_KEY = 'explain-threads-full';

  function setThreadsFull(full) {
    // Full screen without an open panel shows nothing at all, so the two always
    // move together.
    if (full) document.body.classList.add('threads-open');
    document.body.classList.toggle('threads-full', full);
    var btn = $('#th-expand');
    if (btn) btn.title = full ? T('collapse', 'Exit full screen') : T('expand', 'Full screen');
    // Per-tab, not per-origin: this is a transient view mode. Persisting it in
    // localStorage meant one toggle made every explainer open full screen in
    // every future tab. sessionStorage still survives the reload Claude
    // triggers after re-rendering, which is the case worth keeping.
    try { sessionStorage.setItem(FULL_KEY, full ? '1' : ''); } catch (e) {}
    scheduleRedraw();
  }

  function threadsFull() {
    return document.body.classList.contains('threads-full');
  }

  function openThreads(open) {
    document.body.classList.toggle('threads-open', open !== false);
    if (open !== false) scheduleRedraw();
  }
  $('#btn-threads').addEventListener('click', function () { openThreads(!document.body.classList.contains('threads-open')); });
  $('#th-close').addEventListener('click', function () {
    if (threadsFull()) setThreadsFull(false);
    openThreads(false);
  });
  $('#th-expand').addEventListener('click', function () { setThreadsFull(!threadsFull()); });
  try {
    // Anyone left stuck full-screen by the old per-origin flag gets unstuck.
    localStorage.removeItem(FULL_KEY);
    if (sessionStorage.getItem(FULL_KEY)) setThreadsFull(true);
  } catch (e) {}
  $('#th-refresh').addEventListener('click', function () { refreshThreads(); refreshDifit(); });

  $$('.th-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      $$('.th-tab').forEach(function (t) { t.classList.remove('is-active'); });
      tab.classList.add('is-active');
      state.filter = tab.dataset.filter;
      renderThreads();
    });
  });

  function focusThread(id) {
    state.activeId = id;
    openThreads(true);
    // If the active tab filters this thread out, clicking its marker would look
    // like nothing happened. Fall back to All so the card is actually there.
    if (!threadPassesFilter(id)) {
      state.filter = 'all';
      $$('.th-tab').forEach(function (tab) {
        tab.classList.toggle('is-active', tab.dataset.filter === 'all');
      });
    }
    renderThreads();
    var node = $('.thread[data-id="' + CSS.escape(id) + '"]');
    if (node) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    var t = state.threads.find(function (x) { return x.id === id; });
    var box = t && resolveAnchor(t.anchor);
    if (box) {
      var y = box.y - window.innerHeight / 3;
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }
    $$('.marker').forEach(function (m) { m.classList.toggle('is-active', m.dataset.threadId === id); });
  }

  // draft = saved locally, never sent. pending = actually sent to Claude.
  function threadPassesFilter(id) {
    var th = state.threads.find(function (x) { return x.id === id; });
    if (!th) return false;
    var f = state.filter;
    if (f === 'all') return true;
    if (f === 'saved') return th.status === 'draft';
    if (f === 'pending') return th.status === 'pending';
    if (f === 'answered') return th.status === 'answered';
    return false;
  }

  function statusOf(th) {
    if (th.status === 'resolved') return 'resolved';
    if (th.status === 'answered') return 'answered';
    if (th.status === 'draft') return 'saved';
    return 'pending';
  }

  // One number per thread, taken from its position in the full list. Markers and
  // cards both read this, so marker 3 always opens card 3 - previously each
  // numbered its own filtered subset and they drifted apart.
  function threadNumbers() {
    var map = {};
    state.threads.forEach(function (th, i) { map[th.id] = i + 1; });
    return map;
  }

  function statusLabel(kind) {
    if (kind === 'resolved') return T('stResolved', 'resolved');
    if (kind === 'answered') return T('stAnswered', 'answered');
    if (kind === 'saved') return T('stSaved', 'saved');
    return T('stPending', 'sent');
  }

  function renderThreads() {
    var list = $('#th-list');
    var nums = threadNumbers();
    var items = state.threads.slice();
    var showDifit = state.filter === 'difit' || state.filter === 'all';

    if (state.filter === 'saved') items = items.filter(function (t) { return t.status === 'draft'; });
    else if (state.filter === 'pending') items = items.filter(function (t) { return t.status === 'pending'; });
    else if (state.filter === 'answered') items = items.filter(function (t) { return t.status === 'answered'; });
    else if (state.filter === 'difit') items = [];

    var html = '';

    if (showDifit && state.difit.configured) {
      var dt = state.difit.threads || [];
      html += '<a class="th-difit-link" href="' + escapeHtml(state.difit.url || '#') + '" target="_blank" rel="noopener">' +
        '<b>difit</b> — ' + (state.difit.alive
          ? dt.length + ' ' + escapeHtml(dt.length === 1 ? T('codeThread', 'code thread') : T('codeThreads', 'code threads')) + ' · ' + escapeHtml(T('difitServerLive', 'server live'))
          : escapeHtml(T('difitServerDown', 'server is down'))) +
        '</a>';
      if (state.filter === 'difit') {
        html += dt.length
          ? dt.map(function (t, i) { return difitThreadHtml(t, i); }).join('')
          : '<div class="th-empty"><b>' + escapeHtml(T('difitEmptyTitle', 'No comments in difit')) + '</b>' + escapeHtml(T('difitEmptyBody', 'Comment on any line in difit.')) + '</div>';
      }
    }

    if (state.filter !== 'difit') {
      html += items.length
        ? items.map(function (t) { return threadHtml(t, (nums[t.id] || 0) - 1); }).join('')
        : '<div class="th-empty"><b>' + escapeHtml(T('emptyTitle', 'No threads yet')) + '</b>' + escapeHtml(T('emptyBody', 'Press C and drag a box.')) + '</div>';
    }

    list.innerHTML = html;

    var pending = state.threads.filter(function (t) { return t.status === 'draft'; }).length;
    var pendingSent = state.threads.filter(function (t) { return t.status === 'pending'; }).length;
    $('#pending-count').textContent = String(pending);
    $('#btn-submit').disabled = pending === 0;
    $('#th-submit').disabled = pending === 0;
    $('#th-submit').textContent = pending
      ? T('sendToClaude', 'Send to Claude') + ' (' + pending + ')'
      : T('sendPending', 'Send pending');
    $('#thread-count').textContent = String(state.threads.length);
    $('#th-count').textContent = String(state.threads.length);
    drawMarkers();
  }

  function threadHtml(t, i) {
    var st = statusOf(t);
    var stale = anchorChanged(t.anchor);
    var where = (t.anchor && t.anchor.label) || 'page';
    var msgs = t.messages.map(function (m) {
      return '<div class="msg msg--' + (m.role === 'claude' ? 'claude' : 'human') + '">' +
        '<div class="msg-head"><span class="msg-who">' + escapeHtml(m.role === 'claude' ? T('claude', 'Claude') : T('you', 'You')) + '</span>' +
        '<span>' + escapeHtml(timeAgo(m.createdAt)) + '</span></div>' +
        '<div class="msg-body">' + mdLite(m.body) + '</div></div>';
    }).join('');

    return '<article class="thread thread--' + st + (state.activeId === t.id ? ' is-active' : '') + '" data-id="' + escapeHtml(t.id) + '">' +
      '<div class="thread-head" data-act="focus">' +
        '<span class="thread-num">' + (i + 1) + '</span>' +
        '<span class="thread-where" title="' + escapeHtml(where) + '">' + escapeHtml(where) + '</span>' +
        (stale ? '<span class="st st--outdated" title="' + escapeHtml(T('staleTitle', 'The page changed after this comment')) + '">' + escapeHtml(T('stale', 'stale')) + '</span>' : '') +
        '<span class="st st--' + st + '" title="' + escapeHtml(st === 'saved' ? T('savedHint', '') : '') + '">' +
          escapeHtml(statusLabel(st)) + '</span>' +
      '</div>' +
      '<div class="thread-body">' +
        (t.quote ? '<div class="th-quote">' + escapeHtml(t.quote.slice(0, 320)) + (t.quote.length > 320 ? '…' : '') + '</div>' : '') +
        msgs +
        '<textarea class="thread-reply" data-act="reply-input" rows="2" placeholder="' + escapeHtml(T('followUpPlaceholder', 'Ask a follow-up...')) + '"></textarea>' +
        '<div class="thread-actions">' +
          '<button class="btn btn--primary btn--sm" data-act="reply">' + escapeHtml(T('replyAndSend', 'Reply & send')) + '</button>' +
          '<button class="th-mini" data-act="locate">' + escapeHtml(T('locate', 'Locate')) + '</button>' +
          '<button class="th-mini th-mini--danger" data-act="delete">' + escapeHtml(T('del', 'Delete')) + '</button>' +
        '</div>' +
      '</div></article>';
  }

  function difitThreadHtml(t, i) {
    var line = t.position && (typeof t.position.line === 'number' ? t.position.line : t.position.line.start + '-' + t.position.line.end);
    var msgs = (t.messages || []).map(function (m) {
      var who = (m.author || '').toLowerCase().indexOf('claude') !== -1 ? 'claude' : 'human';
      return '<div class="msg msg--' + who + '">' +
        '<div class="msg-head"><span class="msg-who">' + escapeHtml(m.author || (who === 'claude' ? 'Claude' : 'You')) + '</span>' +
        '<span>' + escapeHtml(timeAgo(m.createdAt)) + '</span></div>' +
        '<div class="msg-body">' + mdLite(m.body) + '</div></div>';
    }).join('');
    var answered = (t.messages || []).some(function (m) { return (m.author || '').toLowerCase().indexOf('claude') !== -1; });
    return '<article class="thread thread--difit">' +
      '<div class="thread-head"><span class="thread-num">' + (i + 1) + '</span>' +
      '<span class="thread-where">' + escapeHtml(t.filePath || '') + ':L' + escapeHtml(String(line || '?')) + '</span>' +
      '<span class="st st--' + (answered ? 'answered' : 'pending') + '">' + (answered ? 'answered' : 'pending') + '</span></div>' +
      '<div class="thread-body">' +
      (t.codeSnapshot && t.codeSnapshot.content ? '<div class="th-quote">' + escapeHtml(t.codeSnapshot.content.slice(0, 300)) + '</div>' : '') +
      msgs + '</div></article>';
  }

  $('#th-list').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var article = e.target.closest('.thread');
    if (!article || !article.dataset.id) return;
    var id = article.dataset.id;
    var act = btn.dataset.act;
    if (act === 'focus' || act === 'locate') { focusThread(id); return; }
    if (act === 'delete') {
      api('/threads/' + encodeURIComponent(id), { method: 'DELETE' })
        .then(refreshThreads)
        .then(function () { toast(T('toastDeleted', 'Thread deleted')); })
        .catch(function (err) { toast(err.message, 'err'); });
      return;
    }
    if (act === 'reply') {
      var ta = article.querySelector('[data-act="reply-input"]');
      var body = ta.value.trim();
      if (!body) { toast(T('toastEmptyReply', 'The reply is empty'), 'err'); return; }
      btn.disabled = true;
      api('/threads/' + encodeURIComponent(id) + '/messages', {
        method: 'POST', body: JSON.stringify({ role: 'human', body: body }),
      }).then(function () {
        toast(T('toastSentToClaude', 'Sent to Claude'), 'ok');
        return refreshThreads();
      }).catch(function (err) { toast(err.message, 'err'); btn.disabled = false; });
    }
  });

  $('#th-list').addEventListener('keydown', function (e) {
    if (e.target.dataset.act === 'reply-input' && (e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      var article = e.target.closest('.thread');
      var btn = article && article.querySelector('[data-act="reply"]');
      if (btn) btn.click();
    }
  });

  /* ------------------------------------------------------------- submit -- */

  function submit() {
    var n = state.threads.filter(function (t) { return t.status === 'draft'; }).length;
    if (!n) return;
    $('#btn-submit').disabled = true;
    api('/submit', { method: 'POST' })
      .then(function (res) {
        openThreads(true);
        openSentModal(res);
        return refreshThreads();
      })
      .catch(function (err) { toast(T('toastSubmitFailed', 'Submit failed: ') + err.message, 'err'); $('#btn-submit').disabled = false; });
  }
  $('#btn-submit').addEventListener('click', submit);
  $('#th-submit').addEventListener('click', submit);

  /* --------------------------------------------------- the paste bridge -- */

  // Two ways a comment reaches Claude:
  //   1. a running `explain watch` under a Monitor wakes the session directly
  //   2. the user pastes this prompt into any Claude Code session
  // (2) always works - including sandboxed shells and after a session ends -
  // because the prompt embeds the comment text rather than pointing at the hub.

  var sentModal = $('#sent-modal');
  var sentBackdrop = $('#sent-backdrop');

  function openSentModal(res) {
    var w = res.watcher || {};
    var listening = !!w.listening;
    var count = res.submitted != null ? res.submitted : (res.count || 0);

    $('#sm-title').textContent = res.submitted != null
      ? count + ' ' + T('sentTitle', 'comments sent')
      : T('promptTitle', 'Prompt for pending comments');

    $('#sm-status').className = 'sm-status ' + (listening ? 'is-live' : 'is-idle');
    var title = listening
      ? T('listeningTitle', 'A Claude session is listening.')
      : (w.owned ? T('ownerNotListening', 'The owning session is not listening.')
                 : T('ownerNone', 'No Claude session owns this page.'));
    $('#sm-status').innerHTML = '<span class="sm-dot"></span><div><b>' + escapeHtml(title) + '</b>' +
      escapeHtml(listening ? T('listeningBody', 'The answer will appear in this panel.')
                           : T('idleBody', 'Copy the prompt below into a Claude Code session.')) +
      (w.sessionId ? '<div class="sm-owner">session: ' + escapeHtml(w.sessionId) + '</div>' : '') +
      '</div>';

    $('#sm-prompt').value = res.prompt || '';
    $('#sm-hint').textContent = listening ? T('monitorArmed', 'Monitor armed') : T('noWatcher', 'No watcher - paste it');
    sentModal.hidden = false;
    sentBackdrop.hidden = false;
    // Pre-select so a plain Ctrl+C works even if the clipboard API is blocked.
    var ta = $('#sm-prompt');
    ta.focus();
    ta.setSelectionRange(0, ta.value.length);
    ta.scrollTop = 0; // selecting scrolls to the caret; show the top instead
  }

  function closeSentModal() {
    sentModal.hidden = true;
    sentBackdrop.hidden = true;
  }

  $('#sm-close').addEventListener('click', closeSentModal);
  $('#sm-done').addEventListener('click', closeSentModal);
  sentBackdrop.addEventListener('click', closeSentModal);

  $('#sm-copy').addEventListener('click', function () {
    var ta = $('#sm-prompt');
    var btn = $('#sm-copy');
    var done = function () {
      btn.textContent = T('copied', 'Copied');
      setTimeout(function () { btn.textContent = T('copyPrompt', 'Copy prompt'); }, 1600);
    };
    // Clipboard API needs a secure context; localhost qualifies, but fall back
    // to selecting the text so the user can still hit Ctrl+C.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(done).catch(selectFallback);
    } else {
      selectFallback();
    }
    function selectFallback() {
      ta.focus();
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      if (ok) done();
      else toast(T('toastCopyBlocked', 'Copy blocked - text selected, press Ctrl+C'), 'err');
    }
  });

  $('#th-prompt').addEventListener('click', function () {
    // Includes saved-but-unsent comments, so you can copy without sending.
    api('/prompt').then(function (res) {
      if (!res.count) { toast(T('toastNoPending', 'No pending comments')); return; }
      openSentModal(res);
    }).catch(function (err) { toast(err.message, 'err'); });
  });

  function refreshWatcher() {
    // Page-scoped: only the session that owns this page counts as listening.
    return api('/watcher')
      .then(function (w) {
        state.watcher = w;
        var dot = $('#listen-dot');
        if (dot) {
          dot.classList.toggle('is-alive', !!w.listening);
          dot.title = w.listening
            ? T('listeningTitle', 'A Claude session is listening.') + (w.sessionId ? ' (' + w.sessionId + ')' : '')
            : (w.owned ? T('ownerNotListening', 'Owning session is not listening.')
                       : T('ownerNone', 'No session owns this page.'));
        }
      })
      .catch(function () {});
  }

  /* --------------------------------------------------------- data sync -- */

  function refreshThreads() {
    return api('/threads').then(function (data) {
      state.threads = data.threads || [];
      renderThreads();
      return data;
    }).catch(function (err) {
      // Never swallow silently: a render bug here looks identical to a dead
      // connection, which is exactly the kind of thing that hides for days.
      console.error('[explain] refreshThreads failed:', err);
      setLive(false);
    });
  }

  function refreshDifit() {
    if (!CFG.difit) return Promise.resolve();
    return api('/difit').then(function (d) {
      state.difit = Object.assign({}, d, { url: (CFG.difit && CFG.difit.url) || d.url });
      var dot = $('#difit-dot');
      if (dot) {
        dot.classList.toggle('is-alive', !!d.alive);
        dot.classList.toggle('is-dead', d.configured && !d.alive);
        dot.title = d.alive ? 'difit server live' : 'difit server band hai';
      }
      renderThreads();
    }).catch(function () {});
  }

  function setLive(on) {
    state.connected = on;
    var el = $('#th-status');
    el.classList.toggle('is-off', !on);
    el.lastChild.nodeValue = on ? T('live', 'live') : T('reconnecting', 'reconnecting...');
  }

  var es = null;
  var lastCount = null;
  function connect() {
    try { if (es) es.close(); } catch (e) {}
    es = new EventSource(API + '/events');
    es.addEventListener('open', function () { setLive(true); });
    es.addEventListener('threads', function (ev) {
      try {
        var data = JSON.parse(ev.data);
        var answered = (data.threads || []).filter(function (t) { return t.status === 'answered'; }).length;
        if (lastCount !== null && answered > lastCount) {
          toast(T('toastAnswered', 'Claude replied'), 'ok');
          openThreads(true);
        }
        lastCount = answered;
        state.threads = data.threads || [];
        renderThreads();
        setLive(true);
      } catch (e) {
        console.error('[explain] threads event failed:', e);
      }
    });
    es.addEventListener('content', function () {
      // Never blow away something the user is halfway through typing.
      if (hasUnsavedInput()) {
        showReloadPrompt();
        return;
      }
      toast(T('toastPageUpdated', 'Page updated - reloading'));
      setTimeout(function () { location.reload(); }, 900);
    });
    es.addEventListener('error', function () {
      setLive(false);
      // EventSource retries on its own; this only covers a hard close.
      if (es.readyState === 2) setTimeout(connect, 3000);
    });
  }

  function hasUnsavedInput() {
    if (!composer.hidden && $('#cm-input').value.trim()) return true;
    return $$('.thread-reply').some(function (t) { return t.value.trim(); });
  }

  function showReloadPrompt() {
    if ($('#reload-prompt')) return;
    var el = document.createElement('div');
    el.className = 'toast';
    el.id = 'reload-prompt';
    el.appendChild(document.createElement('span')).textContent =
      T('toastPageUpdatedDraft', 'Claude updated the page - your draft is safe.');
    var btn = document.createElement('button');
    btn.className = 'toast-btn';
    btn.type = 'button';
    btn.textContent = T('toastReload', 'Reload');
    btn.addEventListener('click', function () { location.reload(); });
    el.appendChild(btn);
    $('#toasts').appendChild(el);
  }

  /* ---------------------------------------------------------- shortcuts -- */

  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (e.key === 'Escape') {
      if (!sentModal.hidden) { closeSentModal(); return; }
      if (!composer.hidden) { closeComposer(); return; }
      if (state.commentMode) { setCommentMode(false); return; }
      if (threadsFull()) { setThreadsFull(false); return; }
      if (document.body.classList.contains('threads-open')) openThreads(false);
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key.toLowerCase();
    if (k === 'c') { e.preventDefault(); setCommentMode(!state.commentMode); }
    else if (k === 't') { e.preventDefault(); openThreads(!document.body.classList.contains('threads-open')); }
    else if (k === 'f') {
      e.preventDefault();
      if (!document.body.classList.contains('threads-open')) openThreads(true);
      setThreadsFull(!threadsFull());
    }
    else if (k === 'd' && CFG.difit && CFG.difit.url) { e.preventDefault(); window.open(CFG.difit.url, '_blank', 'noopener'); }
  });

  /* ------------------------------------------------------------- init ---- */

  renderMermaid();
  onScroll();
  refreshThreads().then(function () {
    var pending = state.threads.filter(function (t) { return t.status !== 'answered'; }).length;
    if (pending) openThreads(true);
  });
  refreshDifit();
  refreshWatcher();
  connect();
  setInterval(refreshDifit, 15000);
  setInterval(refreshWatcher, 10000);
  window.addEventListener('load', function () { setTimeout(scheduleRedraw, 250); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleRedraw);
})();
