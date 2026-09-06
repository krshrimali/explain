---
name: explain
description: Build an interactive HTML explainer page for a GitHub PR, repository, commit, any link, or any term - written A-to-Z in Hinglish with code walkthroughs, edge cases, FAQ, and a critical seniormost-dev review. Code diffs open in difit for line-level review. The page supports bounding-box comments that come back to Claude, and Claude's answers land in the page's live thread panel and in difit's own threads. Use whenever the user explicitly asks to explain / walk through / review a PR, repo, commit, link, or concept.
---

# explain

Turn any target into a **live, commentable explainer page**, then stay in the loop
to answer whatever the user pushes back on.

Two comment systems, one loop:

| Where the user comments | What they point at | How Claude answers |
|---|---|---|
| The explainer page (drag a bbox) | Any prose, diagram, table, code sample | `explain reply` -> lands in the page's thread panel, live |
| difit (click a line) | The actual diff, line by line | `explain difit-reply` -> lands in the difit thread |

`explain watch` streams one line per pending comment from **both**. A `Monitor`
on that command is what wakes you up.

## The CLI

```bash
EX=~/.claude/skills/explain/assets/explain
```

Everything below assumes that `$EX`. Run `$EX help` for the full surface.

---

## Step 1 - classify the target

| Input | `targetType` | Where the facts come from |
|---|---|---|
| `github.com/o/r/pull/N` | `pr` | `gh pr view N --json ...`, `gh pr diff`, review comments, checks |
| A SHA, `HEAD~2`, `v1.2..main` | `commit` / `diff` | `git show`, `git log`, `git diff` |
| A repo URL or local path | `repo` | README, entry points, `git log`, dependency manifests, dir tree |
| Any other URL | `url` | `WebFetch` (+ `WebSearch` when the page is thin) |
| A bare word or phrase | `term` | Your own knowledge; `WebSearch` for anything post-cutoff or version-specific |

Pick a short kebab-case `slug` (`lru-ttl-commit`, `pep-703-gil`). The slug is the
page's identity - reuse it to update, change it to make a new page.

**Research before you write.** Never explain a diff you have not read or a repo
you have not opened. For a PR, read the description, the diff, *and* the existing
review threads - those tell you what people are actually confused about, which is
your FAQ.

## Step 2 - start difit when code is involved

Any target with a diff (PR, commit, branch comparison, working tree):

```bash
$EX difit start --slug <slug> --repo /path/to/repo --target HEAD          # a commit
$EX difit start --slug <slug> --repo /path/to/repo --target main --base v1.0
$EX difit start --slug <slug> --repo /path/to/repo --pr https://github.com/o/r/pull/N
```

Prints `{port, url, pid}` and registers it on the page - the next `render` picks
it up automatically, so you do **not** need to put `difit` in content.json.

For a PR you have no clone of, `--pr` works from any git repo (difit shells out
to `gh pr diff`). Clone only when you need to read the surrounding code, which
you usually do for a real review.

**Also seed difit with your own findings.** Every blocker/major finding that
lives on a specific line belongs in difit as a thread, so the user can reply to
it right there:

```bash
$EX difit-note --slug <slug> --file cache.py --side new --line 26 \
  --body "Eviction FIFO hai, LRU nahi - next(iter(store)) insertion order deta hai."
```

## Step 3 - pick the language (default: Hinglish)

```bash
$EX config                        # show the current default
$EX config --language english     # change the hub default
```

Resolution order: `content.json`'s `"language"` -> the hub default -> **`hinglish`**.
Hinglish in **Roman script** is the default and stays the default unless the user
changes it - never switch language just because the source material is English.

Page chrome (buttons, tabs, placeholders) ships translated for `hinglish`,
`english`, and `hindi`. Any other value is still honoured for the *prose* Claude
writes - the chrome just falls back to English. To render a single page in a
different language without moving the default:

```bash
$EX render --slug <slug> --content <file> --language english
```

If the user asks for a language in passing ("explain this in English"), use
`--language` for that page. Only touch `$EX config` when they say it should be
the default from now on.

## Step 4 - author content.json

Write the file to your scratchpad, then:

```bash
$EX render --slug <slug> --content /path/to/content.json --session <SESSION_ID>
$EX open   --slug <slug>     # prints the URL and opens a browser
```

**`--session` matters.** It records which Claude session owns the page, and a
submit only ever wakes that session. Use your own Claude Code session id (the
one in your attribution footer) so it stays stable for the whole conversation.
Without it the page is unowned: nobody gets woken, and the page says so.

Read **`references/content-schema.md`** for every block type and
**`references/authoring.md`** for the voice, depth bar, and review rubric. The
short version:

- Write in the **resolved language** (Hinglish by default). For Hinglish: Roman
  script, technical terms stay English (`race condition`, `refcount`), connective
  tissue is Hindi, never Devanagari.
- **A-to-Z**: assume a smart engineer who has never seen this thing. Motivation
  -> mechanism -> code walkthrough -> edge cases -> trade-offs.
- Every non-trivial claim gets a **concrete example** or a code block.
- **FAQ is mandatory** - 4-10 real questions, including the uncomfortable ones.
- **Always critical.** Seniormost dev in the room. Name what is wrong, what will
  break, and what you would reject in review. No cheerleading.
- Add the `review` block when the user asked for a review, or whenever the target
  is a diff (PR / commit) - reviewing is the whole point there.

Re-render any time. Comment threads live outside the HTML, so they survive.

## Step 5 - arm the watcher, then hand over

**Arm this before you hand the page over.** Without it, "Send to Claude" reaches
nothing and the user has to paste the prompt by hand.

```
Monitor({
  command: "node ~/.claude/skills/explain/assets/explain.mjs watch --session <SESSION_ID>",
  description: "explain-hub: comments from <slug> page + difit",
  persistent: true,
  timeout_ms: 3600000
})
```

Use the **same `<SESSION_ID>` you rendered with**. `watch` refuses to start
without one, because a hub-wide watcher wakes every Claude session on the
machine for every page - including pages another session built.

Arm it **once per session**, not once per page - it covers every page *you* own.
While it runs it heartbeats into `watchers/<session>.json`, which is what turns
the page's Send button dot green and names the owning session in the dialog.

To take over a page made by an earlier session:

```bash
$EX claim --slug <slug> --session <SESSION_ID>
$EX watchers --slug <slug>     # who owns it, and are they listening
```

Then tell the user, in one short message: the page URL, the difit URL, what the
page covers, and that they can drag a box anywhere to comment (or comment on any
line in difit) and you will answer in place.

### What the user sees on Submit

A saved comment is **not** pending. Writing one leaves it `saved` (local only) -
the user can copy its prompt without ever sending it. Only **Send to Claude**
flips `saved -> pending` and notifies the owning session.

On submit the page POSTs to the hub, a `SUBMIT` line lands in `events.log`, and
a dialog opens showing either:

- **green** - a session is listening; the answer will arrive in the panel, or
- **amber** - nothing is listening; copy the prompt shown and paste it into any
  Claude Code session.

That prompt is **self-contained** - it embeds the quoted region and the question
text, not just a thread id. So it still works when the pasted-into session is
sandboxed, on another machine, or started long after the hub stopped. The user
can also get it any time from the threads panel's **Copy prompt** button, or from
the terminal:

```bash
$EX prompt --slug <slug>              # same text (includes saved, unsent comments)
$EX inbox  --slug <slug> --include-drafts
$EX watchers --slug <slug>            # who owns this page, and are they listening
$EX watchers                          # every live session watcher
```

`inbox` **excludes** saved comments by default - they were never sent, so they
are not yours to answer unprompted. `prompt` includes them, because that is the
copy-without-sending path.

If you are handed that pasted prompt in a fresh session, just answer it - run
`$EX inbox` first to confirm nothing changed, then reply as in Step 6. If the CLI
is unreachable (sandbox with no access to the hub), answer in chat and say the
reply could not be posted to the thread.

## Step 6 - the answer loop

The Monitor fires a line like:

```
EXPLAIN-COMMENTS slug=lru-pr count=2 - user ne 2 comment bheje hain ...
EXPLAIN-DIFIT slug=lru-pr file=cache.py:L26 - code review comment aaya hai ...
```

When it does:

```bash
$EX inbox                 # human-readable, every pending comment from both systems
$EX inbox --slug X --json # same thing as JSON
```

The inbox gives you the anchor label, the **exact text the user's box covered**,
and the full conversation so far. For each item:

1. **Take the pushback seriously.** The user drew that box because something was
   wrong, unclear, or unconvincing. Assume they might be right; check before you
   defend. If you were wrong, say so plainly and fix the page.
2. **Answer in the same register** - Hinglish, concrete, with code when code
   settles it. A thread reply is a real answer, not a pointer to the page.
3. Post it:

```bash
$EX reply --slug <slug> --thread <threadId> --body "..."                      # page thread
$EX difit-reply --slug <slug> --file <path> --side new --line <n> --body "..." # difit thread
```

Use `--body-file <path>` instead of `--body` for anything long or with tricky
quoting.

4. **If the page itself was wrong or incomplete, fix content.json and re-render.**
   Open browsers reload themselves. Then say so in the thread ("Page update kar
   diya - section X ab sahi hai"), so the reply and the page never disagree.
5. Keep the Monitor running. The conversation continues.

`$EX resolve --slug X --thread ID` closes a thread you have fully settled.

## Housekeeping

```bash
$EX status          # hub health, per-page draft/pending/answered counts, difit liveness
$EX list            # every page
$EX difit stop --slug X
```

Hub root is `~/.claude/explain-hub/` (pages, threads, `events.log`). The hub
server starts itself whenever it is needed - port 7788, or the next free port if
that one is taken, so read the URL that `render` / `open` prints rather than
assuming 7788. The hub root URL is an index of every explainer.

**Remote sessions.** Over SSH the hub binds `0.0.0.0` automatically, and then a
password is mandatory - the first page load is a signup screen that wants the
setup code `explain up` printed. Surface that code and the LAN URL to the user;
do not try to work around the gate. `explain auth` reports the state, and
`explain config --bind local` keeps it on loopback if they would rather tunnel
(`ssh -L 7788:localhost:7788`). Your own CLI keeps working either way - it
authenticates with a key in `auth.json`.

## Rules

- **Never fabricate.** If you did not read a file, do not describe its contents.
  Unknown is a fine thing to write down; invented detail is not.
- **Do not water down the review to be agreeable.** If the user pushes back and
  they are right, change your position and say why. If they are wrong, hold it
  and show the evidence.
- One page per target. Re-render the same slug rather than making `foo-v2`.
- Do not put secrets, tokens, or private paths into a page.
