# content.json schema

One JSON file describes the whole page. The renderer owns all layout, styling,
syntax highlighting, and interaction - you only supply content.

```jsonc
{
  "title":      "LRUCache mein TTL aur eviction",   // required
  "subtitle":   "Ek chhota commit jo do bugs bhi laata hai.",
  "targetType": "pr | commit | repo | url | term | file | branch | issue | diff",
  "target":     { "label": "owner/repo#123", "url": "https://..." },

  "meta": {
    "stats": [ {"label": "Files", "value": "7"}, {"label": "Blockers", "value": "2"} ]
  },

  "tldr": [ "markdown string", "..." ],            // 3-5 bullets, the whole point up front

  "sections": [
    {
      "id": "kya-badla",                            // stable: comment anchors key off it
      "title": "Diff mein kya badla",
      "kicker": "walkthrough",                      // small uppercase label above the title
      "summary": "Ek line ka orientation.",
      "blocks": [ /* see below */ ]
    }
  ],

  "review":   { /* see below */ },                  // when asked, or for any diff target
  "faq":      [ {"q": "...", "a": "markdown", "open": true} ],
  "glossary": [ {"term": "LRU", "meaning": "markdown"} ]
}
```

`difit` is attached automatically from the page's registration - do not hand-write it.

`id` values must stay stable across re-renders: a comment anchored to
`sec-kya-badla-b2` follows that block. Renaming an `id` orphans its threads (they
survive, marked `stale`, but lose their box).

---

## Blocks

### `md` - prose
```json
{ "type": "md", "md": "GFM markdown. **bold**, `code`, lists, tables, links, and\n```python\nfenced blocks (highlighted, no line numbers)\n```" }
```
The default. Fenced code inside `md` gets full Shiki highlighting.

### `code` - a framed, line-numbered code block
```json
{
  "type": "code", "lang": "python",
  "file": "src/cache.py", "lines": "24-27",
  "startLine": 24,
  "highlight": "3,7-9",
  "code": "def put(self, key, value):\n    ...",
  "caption": "Yahi wo jagah hai jahan bug baitha hai.",
  "difit": false
}
```
- `startLine` makes the gutter match the real file. `highlight` is **relative to
  the block**, not the file (line 1 is the first line shown).
- Every framed block gets a `diff` link to difit when one is registered; set
  `"difit": false` to suppress it for illustrative (non-diff) code.

### `walkthrough` - numbered steps, the workhorse for explaining a diff
```json
{
  "type": "walkthrough", "title": "Line by line",
  "steps": [
    { "title": "TTL state constructor mein", "md": "Kyun aur kya.",
      "code": { "lang": "python", "file": "cache.py", "lines": "5-9",
                "startLine": 5, "highlight": "3", "code": "..." } }
  ]
}
```
`code` per step is optional.

### `callout`
```json
{ "type": "callout", "variant": "edge", "title": "Edge case jo test miss karega", "md": "..." }
```
`variant`: `info` `tip` `warn` `danger` `edge` `gotcha` `perf` `security`.
Use `edge` and `gotcha` heavily - that is where the value is.

### `compare` - side by side
```json
{
  "type": "compare", "title": "Eviction: ab vs sahi",
  "left":  { "label": "Abhi (FIFO, galat)", "lang": "python", "code": "..." },
  "right": { "label": "Sahi (LRU)",         "lang": "python", "code": "..." }
}
```
Either side may use `"md"` instead of `"code"`. Left renders as the "before/wrong"
side, right as "after/right".

### `table`
```json
{ "type": "table", "title": "...", "headers": ["Workload", "GIL impact", "Tool"],
  "rows": [["HTTP (I/O)", "Nahi ke barabar", "`threading`"]], "caption": "..." }
```
Cells accept inline markdown.

### `diagram` - mermaid, rendered client-side
```json
{ "type": "diagram", "mermaid": "sequenceDiagram\n  A->>B: take_gil()", "caption": "..." }
```
Use for control flow, sequence, and state - not for decoration. If the diagram
fails to parse it degrades to readable source, so keep it simple and valid.

### `terminal` - a shell session
```json
{ "type": "terminal", "title": "repro", "code": "$ pytest -k lru\nFAILED test_evicts_lru", "caption": "..." }
```

### `filetree`
```json
{ "type": "filetree", "tree": "src/\n|-- cache.py   <- yahan badla\n`-- api.py", "caption": "..." }
```
Plain text, monospace. ASCII connectors survive every font.

### `cards` - parallel concepts of equal weight
```json
{ "type": "cards", "title": "...", "items": [ {"icon": "C", "title": "C extensions", "md": "..."} ] }
```

### `timeline` - history / evolution
```json
{ "type": "timeline", "title": "...", "items": [ {"tag": "2023", "title": "PEP 703 accepted", "md": "..."} ] }
```

### `keyvalue` - dense facts
```json
{ "type": "keyvalue", "items": [ {"k": "Default switch interval", "v": "5 ms"} ] }
```

### `quote`
```json
{ "type": "quote", "md": "Removing the GIL is a **concurrency** feature.", "cite": "PEP 703" }
```

---

## `review`

```json
{
  "title": "Review",
  "verdict": "Markdown. Ship / don't ship, and why - in the first sentence.",
  "findings": [
    {
      "severity": "blocker | major | minor | nit | praise",
      "title": "Eviction LRU nahi, FIFO hai",
      "file": "cache.py", "line": 26,
      "body": "What is wrong and what it costs, concretely.",
      "suggestion": "Markdown, usually a fenced diff or replacement snippet."
    }
  ]
}
```

Findings are auto-sorted by severity and counted in a summary row.

- `blocker` - do not merge. Wrong behaviour, data loss, security, broken contract.
- `major` - merge only with a follow-up. Real risk, unhandled case, bad perf.
- `minor` - should fix. Clarity, naming, missing test.
- `nit` - taste. Keep these rare; too many nits drown the blockers.
- `praise` - only for a genuinely good decision, and say *why* it is good.

Include at most one `praise`. A review that is mostly praise is not a review.

---

## Language support

Shiki highlights any bundled language. Common aliases are normalized (`js`, `ts`,
`py`, `sh`, `yml`, `rs`, `c++`, `patch`). An unknown language degrades to plain
text rather than failing - but pass a real one, since colour carries meaning.

For diff hunks pasted verbatim, use `"lang": "diff"`.


---

## The paste bridge

Comments reach Claude two ways, and the page shows which one is live:

1. **Monitor** - a running `explain watch --session <id>` emits a line per
   submit, waking only the session that **owns** the page (set by
   `render --session` / `claim`). Requires that session to still be alive.
2. **Copy prompt** - the post-submit dialog (and the threads panel button) hands
   the user a self-contained prompt carrying the quoted region and the question.
   Pasting it into any Claude Code session works even with no hub access.

`explain prompt [--slug S]` prints the same text; `explain watchers --slug S`
reports who owns the page and whether they are listening. Path (2) is the one
that survives sandboxes, restarts, and closed sessions - never rely on (1) alone.

## Comment statuses

| status | meaning | in `inbox`? | in `prompt`? |
|---|---|---|---|
| `saved` | written on the page, **not** sent | no (unless `--include-drafts`) | yes |
| `pending` | Send to Claude pressed; owning session notified | yes | yes |
| `answered` | Claude replied in the thread | no | no |

The page's threads drawer has an **All / Saved / Sent / Answered / difit** filter
and a full-screen toggle (the expand icon, or `F`).
