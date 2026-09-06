# difit integration

[difit](https://github.com/yoshiko-pg/difit) is a local GitHub-style diff viewer
with line-level comment threads. It is vendored at
`~/.claude/skills/explain/assets/node_modules/.bin/difit`, so no global install is
needed and the version is pinned.

difit's client is shipped prebuilt, so `assets/setup.sh` prunes its build-time
dependencies after install (~255M -> ~65M). If difit ever dies with
`MODULE_NOT_FOUND`, run `npm install` in `assets/` to restore them.

The `explain` CLI wraps it - prefer the wrapper, since it also registers the
server against the page and keeps the status dot alive.

## Starting a server

```bash
$EX difit start --slug <slug> --repo <dir> [options]
```

| Option | Effect |
|---|---|
| `--target HEAD` | diff a commit-ish (`HEAD`, `abc123`, `v1.2`, `HEAD~3`) |
| `--target main --base v1.0` | diff between two revisions |
| `--target working` / `staged` | uncommitted work |
| `--pr <url>` | a GitHub PR, fetched through `gh pr diff` |
| `--include-untracked` | fold untracked files into the diff |
| `--clean` | start with no comments |
| `--port N` | pin the port (default: derived from the slug, ~4800-4950) |

Returns `{port, url, pid}` and writes it into the page's `meta.json`. The next
`render` wires the button, the status dot, and the per-code-block `diff` links
automatically.

`--pr` needs `gh` authenticated. It works from inside any git repo - difit reads
the patch from stdin, so you do not need a clone of *that* repo. Clone anyway
when you intend to review properly; you cannot judge a diff without its context.

One server per page. Starting again for a slug whose server is still alive reuses
it (`"reused": true`).

## Comments wait to be sent

difit has no Send button of its own, so the gate lives in the hub: a difit
thread is handed to you only after the user submits it, exactly like a page
comment sitting as a draft. Leaving a line comment in difit does **not** wake
you.

The explainer page's **Send to Claude** covers both - its count is page drafts
plus unsent difit threads, and one press releases everything. From the terminal:

```bash
$EX difit submit --slug X     # release this page's difit comments
```

Submission is keyed by thread id + message count, so adding another message to
an already-sent thread makes it unsent again - that new message still has to be
sent. Your replies do not re-open anything, since an answered thread is filtered
out first.

## Reading comments

```bash
$EX inbox                  # both systems, only threads awaiting Claude
$EX difit threads --slug X # raw difit threads, answered ones included
```

A difit thread is pending when its last message is not from `claude` **and** the
user has submitted it. `inbox` shows only submitted ones; `prompt` includes the
unsent ones too, so they can be copied without being sent.

## Writing comments

Reply into an existing thread (matched on file + side + line - **not** thread id):

```bash
$EX difit-reply --slug X --file src/cache.py --side new --line 26 --body "..."
$EX difit-reply --slug X --file src/cache.py --side new --line 26 --body-file /tmp/reply.md
```

Open a new thread - use this to plant your own review findings on the exact lines:

```bash
$EX difit-note --slug X --file src/cache.py --side new --line 26 --body "..."
```

- `--side new` for the post-change file, `old` for pre-change. Getting this wrong
  silently attaches the comment to the wrong column.
- `--line` takes `26` or a range `24-27`. The range must match the thread's range
  exactly for a reply to attach.
- The body is markdown and renders as markdown in difit.
- A reply whose file/side/line matches no thread is **skipped with a warning**,
  not an error. Check the printed `warnings` array.
- Identical body + author on the same position is deduplicated, so a retry is safe.

## Lifecycle

difit runs detached with `--keep-alive`, so it survives the browser closing and
outlives your session. It does **not** survive a reboot.

```bash
$EX status                 # per-page difit liveness
$EX difit stop --slug X    # kill it and unregister
```

If the dot in the page toolbar is red, the server died - restart it with the same
`difit start` command and re-render so the page picks up the new port.

**Comments live in the difit server's memory.** Killing the server loses its
threads. Answer what is in the inbox before stopping one, and prefer leaving a
server running over restarting it mid-review.

## Deep links

difit's per-file anchors are index-based and not derivable from a path, so the
page links to the difit root rather than to a specific file. Always name the file
and line in your prose (`cache.py:26`) so the reader can find it in difit's tree.
