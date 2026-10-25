# Testing Open Dungeon Master

The developers can only try a few setups. Every tester who plays on a different
computer, model or kind of table finds problems nobody else can. This page explains
what to test, how to save a report file, and where to send it.

## The setups we need most

- **macOS.** This is the biggest gap. The automated checks run on Linux and Windows
  only, and nobody on the team plays on a Mac. Any session on a Mac helps, in the
  desktop app or in a browser on a Mac.
- **Narrator models we have not tried.** Local models in Ollama, LM Studio, llama.cpp
  or vLLM, hosted APIs other than OpenAI, and the agent programs (Claude Code, Codex,
  opencode, Grok Build). Small models and slow machines are useful too.
- **The other DM modes.** Most testing happens with the AI as Dungeon Master. A person
  steering the AI, a person running the game, and a person running it with AI help
  get less use.
- **Tables of several players**, especially with phones and computers mixed.
- **The Android app**, and any phone browser.

## How to run a session worth reporting

1. Note your setup before you start: the version (account menu > About), your
   operating system, how you installed it, the narrator backend and model, and the
   DM mode.
2. Play the way you normally would. Try a fight, a skill check, a rest and some
   conversation with characters in the story. You do not need a script.
3. When something goes wrong, note what you did just before. Save a report file
   straight away (below), while the details are still on the server.
4. At the end, write down what went well, what broke, and every time you had to
   correct the AI.

## How to save a report file

- **At the table:** use **Report a problem** in the header (on a phone, it is in the
  table menu).
- **As the server's admin:** go to **Admin > Server log** and use **Report a problem**.

Choose what goes in the file, then save it. The file is saved to your own device and
is never sent anywhere. You attach it to the issue yourself, so open it first if you
want to check what it holds.

What the file can hold:

| Part | Who can include it | Ticked at first |
|---|---|---|
| Version, operating system, DM mode, narrator backend kind and model | anyone | yes |
| Recent errors from the game page in this browser | anyone | yes |
| Turn ids and timings for the last few turns, and the table's recent [narrator quality](#narrator-quality) rows | the party lead or the DM | yes |
| The last lines of the server log, with keys and tokens removed | the server's admin | yes |
| A transcript of the last few turns: your own lines and the DM's narration | anyone | no |
| What the narrator did in those turns (tools it called, how its prompt was spent) | whoever steers the story: the party lead at an AI table, otherwise the DM | no |

The file never holds other players' lines, whispers, passwords or API keys. The
server checks who you are before it adds each part, whatever the page asks for.

The desktop and Android apps have their own diagnostics under
**Settings > Troubleshooting**. Copy that summary into the issue as well if you play in
an app.

## Narrator quality

Every time a table fixes something the AI DM did (an undo, a sheet edit, an enemy's
hit points, the turn order, a narration edit, a reroll, a retry, an overruled ruling,
a rewind), the server counts it. It also notes how each AI turn ended: which kind of
backend and model ran it, how many tool calls were refused, and whether the narration
check had to step in. After a fix you can tap one reason (wrong rule, wrong number,
wrong target, story, changed my mind), or skip it. Fixes at a table a person runs are
not counted, and "changed my mind" is left out of every rate.

**Admin > Usage > Narrator quality** shows the rates for each kind of backend and DM
mode, and the tools tables fix most often. **Export narrator quality** saves those rows
as one file, with every id scrambled and no names, prompts or story text. Attach it to
a [session report](https://github.com/Lebbitheplow/open-dungeon-master/issues/new?template=session_report.yml).
The party lead's report file carries the same rows for their own table.

What the export is for: before a release is promoted to stable, we read the exports
testers sent in. A tool and reason that keep coming back become a scripted test turn,
and then either a check in the engine so no backend can make that mistake, or a known
gap in the rules ledger. Only compare rates within one kind of backend and DM mode. The
numbers only count mistakes someone noticed.

## Which form to use

When the file is saved, the app opens the right form on GitHub for you. You can also
open one yourself:

- **[Bug report](https://github.com/Lebbitheplow/open-dungeon-master/issues/new?template=bug_report.yml)**
  for one thing that went wrong. Only "What happened" and "Your setup" are required.
- **[Session report](https://github.com/Lebbitheplow/open-dungeon-master/issues/new?template=session_report.yml)**
  for how a whole session went. Only "Your setup" is required, so it can be one line
  or a page.
- **[Feature request](https://github.com/Lebbitheplow/open-dungeon-master/issues/new?template=feature_request.yml)**
  for an idea.

GitHub cannot attach a file through a link, so drag the report file into the last box
of the form. Nothing from the report is put in the link itself.

You can also talk to us on [Discord](https://discord.gg/B2tQFr3TYD).
