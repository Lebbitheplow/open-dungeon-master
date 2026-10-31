# Contributing to Open Game Master

Thank you for helping. Bug fixes, features, content, art, docs and plain
reports of what went wrong at your table are all welcome.

Most of this project is written with coding agents, and yours is welcome
too. Point it at this file and at [AGENTS.md](../AGENTS.md) before it starts
(Claude Code reads AGENTS.md through CLAUDE.md; Codex and most other agents
read AGENTS.md on their own). You are still the author of what it writes:
read the diff, run the checks, and make sure the pull request says what the
code really does.

## Before you start

- **A pull request needs no issue.** If you are making the change, open the
  pull request and let its description say what changes and why. An issue
  that only repeats a pull request doubles what there is to read, and makes
  it harder to see what still needs work.
- **Open an issue when it needs someone else**: a question, a decision or an
  approach to agree before a large change, something that needs discussion,
  or a bug or idea you are not fixing yourself. Use the bug or feature
  template. Setup and hosting questions go to
  [Discussions](https://github.com/Lebbitheplow/open-game-master/discussions/categories/q-a)
  or [Discord](https://discord.gg/B2tQFr3TYD).
- **One change per pull request**, against `main`. A pull request built on
  another one says so at the top. Small pull requests merge sooner: releases
  are frequent, and a large change collides with every open branch.
- **The rules are SRD 5.1.** No 5.2 or 2024 rules. Content outside the SRD
  needs a licence that covers it; see [docs/content.md](../docs/content.md)
  and [docs/LICENSES.md](../docs/LICENSES.md).
- **No Wizards of the Coast trademarks** in names or anything a player reads.
  The role is the GM (Game Master). Creatures and art follow
  [docs/art/creature-art-guidance.md](../docs/art/creature-art-guidance.md):
  a named SRD creature, an original design, or a subject licensed for it.

## Setting up

Node 22.18 or newer (CI runs Node 24). Then:

```bash
npm ci
npm run setup      # database key, content pack, memory model, production build
npm run dev
```

[docs/install.md](../docs/install.md) covers setup by hand, the content pack
and the tests.

## The checks

Run these before you open a pull request; CI runs them on Linux and Windows.

```bash
npm run lint
npm test           # every scripts/test-*.mjs, under Vitest
npm run build
```

- One suite: `npx vitest run scripts/test-direct-card.mjs`, or
  `node scripts/test-direct-card.mjs`. Each suite is a plain Node program.
- Screens: `npm run test:browser` drives a built server through the
  scenarios in `scripts/browser/scenarios`. The apps compile the server's
  screens into native ones, so a screen change is also checked in the app
  shell (`--app`, see the top of `scripts/browser/run.mjs`).
- Every behaviour change carries a test that fails without it.

## How the code is written

These are the conventions the code already keeps. Follow them in new code;
there is no need to rewrite old code that differs in a change about
something else.

- **Names.** Files are kebab-case, React components PascalCase, events and
  DM tool names snake_case.
- **Pure logic in `*-logic.ts`.** Rules, parsing and decisions live in
  modules with no database, network or model call, so a test imports them
  directly. The file that reads the database or calls the model sits beside
  it and stays thin.
- **Validate at the boundary.** A route parses its body with a zod schema
  (`safeParse`) and answers a bad request with status 400 and
  `{ error: "..." }` in plain words. Responses use `Response.json`.
- **DM tool errors say what kind of "no" they are**:
  `{ error, retry: true }` for a mistake in the call,
  `{ error, refused: "rules" | "limit" }` for the game saying no. See
  [src/lib/dm/tool-errors.ts](../src/lib/dm/tool-errors.ts).
- **Comments say why.** What went wrong without this line, which issue it
  came from, which rule it keeps. Not what the next line does.
- **The host, not the build machine.** Server code never reads
  `process.platform`; ask [src/lib/host-platform.ts](../src/lib/host-platform.ts).
  The desktop apps ship one server built on Linux to every system.
- **No model names in code.** Models come from the model registry (the
  models.dev catalog and the backend's own list), never from a hardcoded id.
- **Plain words on screen.** Say what a control does. No jargon a new
  player would have to look up; where a term is unavoidable, explain it.
- **Keep files small enough to read.** Split along the lines a file already
  has, in a pull request of its own that changes no behaviour.

## Common jobs

Read these before changing the part they name. AGENTS.md has more of them:
artwork, the addon framework, settings and controls, releases.

### A new DM tool

1. The handler parses its arguments with zod and returns errors with their
   kind (above). It refuses in the order
   [tool-errors.ts](../src/lib/dm/tool-errors.ts) describes:
   `scripts/test-check-order.mjs` holds every family to it.
2. Add it to the adjudication catalog (`src/lib/dm/catalog-*.ts`) so a human
   GM can do from the console what the AI GM does with the tool.
   `scripts/test-invoke-catalog.mjs` fails until you do.
3. Decide which group of
   [tool-profiles.ts](../src/lib/dm/tool-profiles.ts) offers it. A small
   context window is offered the core tools and opens the other groups on
   request, so every tool's description costs context.
4. If players play it from the Hand, the card and the tool it names are in
   [intent-logic.ts](../src/lib/dm/intent-logic.ts).
5. The tool description is what the model reads. A change to it changes how
   the GM plays, so test it against a local model, not only the fake one.
   `node scripts/score-cards.mjs --model <name>` plays the Hand's cards
   against it and counts how many the right tool resolved, before and
   after the change (the script's header has the details).

### A new route

1. `src/app/api/.../route.ts` with `export const runtime = "nodejs"`,
   `currentUser()` from `@/lib/auth` (answer `unauthorized()` without one),
   and a zod schema for the body.
2. Check the caller may do it with the helpers in `@/lib/campaign-api`
   (`requireMember`, `requireDm`, `requireLead`, `requirePrepAuthority`)
   rather than by hand.
3. If the app's native screens use the new route or field, add a flag to
   `SERVER_FEATURES` in [src/lib/capabilities.ts](../src/lib/capabilities.ts)
   and show the control only when `hostOffers(useCapabilities(), "flag")`
   says the host has it. An older server then hides the control instead of
   breaking it.

### A new test suite

- `scripts/test-<area>.mjs`. It passes when it finishes without throwing.
  Vitest runs each file in its own worker with its own scratch directory, so
  suites share nothing.
- A pure suite registers the alias loader
  (`register("./lib/register-alias.mjs", import.meta.url)`) and imports the
  `.ts` module directly, as `scripts/test-hand-engine.mjs` does.
- A suite that needs a database opens one with `openWorld()` from
  `scripts/lib/enforce-world.mjs`, and a scripted model with `fakeModel()`
  from `scripts/lib/enforce-narrator.mjs`, as
  `scripts/test-direct-card.mjs` does.
- A rule the engine does not enforce yet is a `gap()` in
  `scripts/lib/enforce-harness.mjs`: it records the gap and fails once the
  rule starts holding, so the fix turns it into a `test()`.

## Pull requests

The [template](pull_request_template.md) asks for these:

- **What changes and why**, in plain words, so the pull request stands on
  its own. If it fixes an open issue, link each with its own keyword:
  `Fixes #123. Fixes #124.` (a comma list links only the first).
- **Screenshots** of anything a player sees, on the website and in the app,
  in the day and night themes and at phone width.
- **A new setting, option or control** carries the justification
  AGENTS.md asks for.
- **Nothing private.** No hostnames, IP addresses, server logs, `.env`
  files, keys, databases or players' names in code, tests, commits or the
  description. The repository is public, and an edited description keeps
  its history.

Commit messages say what changes for the people at the table, in a full
sentence: "A spell card answered only by spending a slot is sent back to the
spell's tool", not "fix intent check".
