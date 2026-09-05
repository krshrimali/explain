# explain

A [Claude Code](https://claude.com/claude-code) skill that turns a GitHub PR,
repository, commit, link, or any technical term into a **live, commentable
explainer page** — and then stays in the loop to answer whatever you push back on.

Explanations are written A-to-Z in **Hinglish** by default (configurable), with
code walkthroughs, edge cases, an FAQ, and a critical seniormost-engineer review.
Code diffs open in [difit](https://github.com/yoshiko-pg/difit) for line-level
review.

---

## Why

Reading a big PR alone is slow, and an AI explanation you cannot argue with is
worth very little. This gives you both halves:

- a dense, opinionated explainer page you can actually read
- **two ways to disagree with it**, wired straight back to Claude

## The loop

| You comment | Where | Claude answers |
|---|---|---|
| Drag a **bounding box** over any prose, diagram, table, or code sample | the explainer page | in the page's live thread panel |
| Click any **line** in the diff | difit | in that difit thread |

Press <kbd>C</kbd>, drag a box around whatever is wrong or unclear, type your
question, hit **Send to Claude**. The answer appears in place — no reload.

If Claude fixed the page rather than just replying, the page updates itself and
any comment anchored to changed content is flagged `stale`, so a thread never
silently disagrees with the text above it.

### When no session is listening

Comments reach Claude two ways, and the page tells you which one is live:

1. **Monitor** — a running `explain watch` wakes the Claude Code session that
   armed it.
2. **Copy prompt** — the post-submit dialog hands you a self-contained prompt.

Path 2 is the fallback that always works. The prompt **embeds your quoted region
and question text**, not just a thread id, so pasting it into any Claude Code
session works even from a sandboxed shell, on another machine, or long after the
original session ended.

## Install

Requires Node 18+, `git`, and (for PR targets) the `gh` CLI, authenticated.

```bash
git clone https://github.com/krshrimali/explain ~/.claude/skills/explain
cd ~/.claude/skills/explain/assets && ./setup.sh
```

`setup.sh` installs the toolchain and prunes difit's build-time dependencies
(difit ships a prebuilt client), taking `node_modules` from ~255M to ~65M.

Then, in Claude Code:

```
/explain https://github.com/owner/repo/pull/123
/explain HEAD~2
/explain "how does the Python GIL work"
```

## Language

Hinglish in Roman script is the default and stays the default.

```bash
explain config                      # show current default
explain config --language english   # change the default
explain render --slug x --content c.json --language hindi   # one page only
```

Resolution order: the page's `"language"` → the hub default → `hinglish`.

UI chrome ships translated for `hinglish`, `english`, and `hindi`. Any other
value still steers the prose Claude writes; the chrome falls back to English.

## Architecture

Claude authors a structured `content.json`; a deterministic renderer produces the
page. The UI is written and tested once, so every explainer is consistent, and a
page can be re-rendered at any time without losing comment threads.

```
assets/
  explain.mjs      CLI — the surface Claude drives
  hub.mjs          local server: serves pages, owns the comment API, SSE
  render.mjs       content.json -> HTML (Shiki highlighting at build time)
  lib/
    store.mjs      persistence: pages, threads, config, watcher heartbeat
    inbox.mjs      pending comments + the paste-ready prompt
    i18n.mjs       UI chrome strings per language
  page/
    app.css        the page shell (light/dark)
    app.js         bbox commenting, threads drawer, live sync
references/        content schema, authoring rules, difit integration
```

State lives in `~/.claude/explain-hub/` — pages, threads, `config.json`,
`events.log`. Nothing leaves your machine.

### Block types

`md` · `code` · `walkthrough` · `callout` · `compare` · `table` · `diagram`
(mermaid) · `terminal` · `filetree` · `cards` · `timeline` · `keyvalue` · `quote`

Syntax highlighting is [Shiki](https://shiki.style) at render time — dual
light/dark themes, real line numbers with `startLine` offsets, line highlighting,
and zero client-side cost. See [`references/content-schema.md`](references/content-schema.md).

## CLI

```bash
explain up                                  # start the hub
explain render --slug S --content file.json # render / refresh a page
explain open --slug S                       # open in a browser
explain difit start --slug S --repo D --target HEAD
explain inbox                               # pending comments (page + difit)
explain reply --slug S --thread ID --body-file reply.md
explain difit-reply --slug S --file F --side new --line N --body "..."
explain prompt --slug S                     # paste-ready prompt
explain watchers                            # is a session listening?
explain status                              # hub + pages + difit health
```

## Notes and limits

- **difit comments live in that server's memory.** Stopping a difit server loses
  its threads — answer the inbox first.
- difit's per-file anchors are index-based, so the page links to the difit root
  rather than deep-linking a specific file. File and line are always named in the
  prose instead.
- A `Monitor` lives only as long as its Claude Code session. When it ends, the
  Copy-prompt path takes over.
- The hub binds `127.0.0.1` only, on port 7788 or the next free port.

## License

MIT. Built on [difit](https://github.com/yoshiko-pg/difit) (MIT),
[Shiki](https://shiki.style) (MIT), [marked](https://marked.js.org) (MIT), and
[mermaid](https://mermaid.js.org) (MIT).
