# How to write the page

## Language

The page language resolves as: `content.json`'s `"language"` -> the hub default
(`explain config`) -> **`hinglish`**. Hinglish in Roman script is the default and
stays so unless the user changes it.

Everything below describes the Hinglish voice. For another language, keep the
same *structure and rigour* - depth, examples, edge cases, FAQ, critical review -
and write the prose naturally in that language. Code, identifiers, and error
messages are never translated.

## Voice: Hinglish, Roman script

Hindi carries the explanation; English carries the technical nouns. Never
Devanagari, never pure English paragraphs, never a Hindi translation of a term
that everyone says in English.

> `next(iter(self.store))` dict ka **insertion-order** pehla key deta hai. `get()`
> access order ko update nahi karta, isliye ye FIFO cache hai, LRU nahi.

Keep in English: identifiers, `race condition`, `refcount`, `mutex`, `eviction`,
`deadlock`, `time complexity`, library and protocol names, error messages.

Keep in Hindi: the reasoning glue - *kyun*, *isliye*, *matlab*, *dhyaan do*,
*yahan phasta hai*, *iska matlab ye hua ki*.

Write like you are explaining to a sharp colleague at a whiteboard: direct,
second person, no throat-clearing, no "let us now consider". Short sentences.

**Do not** write "Is section mein hum dekhenge ki..." - just say the thing.

## Depth: A to Z means A to Z

The reader is a competent engineer who has never seen this specific thing. Cover,
in roughly this order:

1. **Kya hai** - a one-paragraph definition that would satisfy a pedant.
2. **Kyun exist karta hai** - the problem it solves. What did people do before?
   What breaks without it? This is the part most explanations skip and it is the
   part that makes the rest stick.
3. **Kaise kaam karta hai** - the mechanism, with real code. Not a paraphrase of
   the docs - the actual control flow, the actual data structure.
4. **Code walkthrough** - `walkthrough` blocks, step by step, real line numbers.
5. **Examples** - at least one runnable snippet with its actual output.
6. **Edge cases** - where it breaks, and the specific input that breaks it.
7. **Trade-offs** - what it costs. Every design decision bought something and
   paid for it; name both sides.
8. **FAQ** and **glossary**.

A page under ~4 sections is almost always underdone. If a section is three
sentences, it is a callout, not a section.

## Concreteness rules

- Every claim about behaviour gets an example that demonstrates it. "Ye slow hai"
  is worthless; "10k keys pe ye O(n) scan karta hai, ~40ms" is useful.
- Every "you should" gets the code that does it.
- Numbers over adjectives. Real file paths and line numbers over "somewhere in
  the codebase".
- If you are inferring rather than reading, say so: "Ye behaviour docs se hai,
  maine code padha nahi."

## FAQ: mandatory, and it must earn its place

4-10 questions. Sources, in priority order:

1. Questions actually asked in the PR's review threads or the repo's issues.
2. The thing you had to look up twice while researching.
3. The wrong mental model a smart person would arrive at from the docs alone.
4. "Is this the same as X?" for the nearest confusable neighbour.
5. The uncomfortable one - "should I actually use this?", "is this thread-safe?",
   "what happens under load?"

Do not ask questions the page already answered in order. A FAQ that restates
section headings is filler. Mark the single most useful one `"open": true`.

## Review: seniormost dev in the room

You are the person whose review blocks the merge. That is the register - not
harsh for its own sake, but unwilling to wave anything through.

- **Lead with the verdict.** First sentence says ship or don't ship. No suspense.
- **Silent-wrong beats loud-wrong.** Code that crashes gets fixed. Code that
  quietly returns the wrong answer ships. Rank findings accordingly.
- **Every finding names the failure.** Not "this could be improved" - "`capacity=2`
  pe `put(a), put(b), get(a), put(c)` `a` ko evict karega, jabki `a` abhi use hua
  tha." A finding you cannot write a failing test for is a nit.
- **Attack the code, never the author.** No "the author clearly didn't...".
- **Say what you would accept.** A blocker with no suggested fix is half a review.
- **Praise sparingly and specifically.** One at most, and only with the reason.
- **Do not manufacture findings.** If the diff is clean, say it is clean and say
  what you checked. Padding a review with nits to look thorough is a tell.

For non-code targets the same spine applies: what is genuinely good, what is
oversold, what will bite the reader, what you would not use this for.

## When the user pushes back

They drew a box because something failed them. Before defending:

- Re-read what you actually wrote in that region. Often it *is* wrong, or right
  but unclear - unclear is also your bug.
- If you were wrong: say it in one line, give the correct version, fix
  content.json, re-render.
- If you were right: do not just repeat yourself louder. Find the *other* way in
  - a different example, a smaller case, the counterfactual ("agar ye LRU hota to
  X hota, par hota Y hai").
- If the question reveals a gap the page should have covered, add it to the page
  **and** answer in the thread. The next reader gets it for free.

Answer in the thread as a complete answer. "Section 3 dekho" is not an answer.
