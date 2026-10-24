# Testing Open Dungeon Master

The developers can only try a few setups. Every tester who plays on a different
computer, model or kind of table finds problems nobody else can. This page explains
what to test, what to attach, and where to send it.

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
3. When something goes wrong, note what you did just before. If you run the server,
   download its log straight away (below): it keeps only recent lines, and a restart
   empties it.
4. At the end, write down what went well, what broke, and every time you had to
   correct the AI.

## What to attach

- **The server log**, if you run the server: **Admin > Server log > Download**. Keys
  and tokens are already cut out of it.
- **The apps' diagnostics**, if you play in the desktop or Android app: copy the
  summary under **Settings > Troubleshooting**.
- **A screenshot** of anything that looked wrong.

Check what a file holds before you attach it. Leave out other players' messages and
anything said to you in private.

## Which form to use

Open the form that fits on GitHub:

- **[Bug report](https://github.com/Lebbitheplow/open-dungeon-master/issues/new?template=bug_report.yml)**
  for one thing that went wrong. Only "What happened" and "Your setup" are required.
- **[Session report](https://github.com/Lebbitheplow/open-dungeon-master/issues/new?template=session_report.yml)**
  for how a whole session went. Only "Your setup" is required, so it can be one line
  or a page.
- **[Feature request](https://github.com/Lebbitheplow/open-dungeon-master/issues/new?template=feature_request.yml)**
  for an idea.

Drag your files into the last box of the form.

You can also talk to us on [Discord](https://discord.gg/B2tQFr3TYD).
