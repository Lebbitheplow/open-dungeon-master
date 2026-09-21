# Agent programs: Claude Code, Codex, opencode, Grok Build

Open Dungeon Master can use an agent program you already have, signed in
on the server's computer, in two ways:

1. **As the storyteller.** The server starts the program for each DM turn
   and it narrates the table on its own sign-in and plan.
2. **As your own assistant.** Your Claude Code, Codex or other MCP client
   connects to the server and acts as you: reads your campaigns, plays your
   character, or runs a table where you hold the DM seat.

Neither way ever asks for, reads or stores the program's password or key.

## The storyteller

Open **Admin > Agent program**. Each program has a card saying whether it
is installed on this computer, signed in, and how well it is locked down.
Pick one, choose a story model and a cheaper bookkeeping model, save, then
press **Test the table**: one tiny real turn that checks the program starts,
connects to the rules engine, calls a rule, uses its answer and streams its
reply. Switch on **Narrate new campaigns with it**, or pick "The server's
agent" in a campaign's Setup tab.

### What it can and cannot do

The program is started with **none of its own tools**. No shell, no files,
no web, none of your own MCP servers, settings, hooks or CLAUDE.md. Its only
tools are the DM's tools for the turn it is narrating, served by the
server's own MCP endpoint on a token that works from this computer only and
dies with the turn. Every call goes through the same DM loop as the built-in
storyteller, so the server rolls the dice, the per-turn caps apply, a
physical-dice roll parks the turn, and the narration guard checks its prose.
The program never sees the server's database key or any provider key.

| Program | How it is started | Its own tools |
| --- | --- | --- |
| Claude Code | `claude -p`, stream JSON | removed (`--tools ""`), checked every turn |
| opencode | `opencode serve`, HTTP | removed (deny-all agent), checked on this machine |
| Codex | `codex app-server`, JSON-RPC | boxed in: shell off, read-only, approvals refused |
| Grok Build | `grok agent stdio`, ACP | boxed in: dontAsk, only ODM tools allowed |

Codex and Grok Build show **(untested)** until a Test the table run passes
on your machine.

### Pictures

A program's own image tool (Codex, Grok Build) is offered to the tables
only after **Paint a test picture** makes one real image here. Otherwise
pictures come from your image backend (ComfyUI, an OpenAI key) as before,
and with none the tables use their painted placeholders. Claude Code and
opencode cannot paint.

### Where it runs

- **A server started with npm or systemd:** yes. The program is found even
  when the server does not have your shell's `PATH`; set **Path to the
  program** if it lives somewhere unusual.
- **The Docker image:** no. A container cannot start programs on its host.
- **The desktop app:** yes, from **Story AI > An agent you already have**,
  except the Flatpak build, whose sandbox cannot start other programs.
- **The Android app:** no.

### Who pays

The turns use the admin's own plan (or API key, if the program is signed in
with one). **Who may use it** decides whether every campaign on the server
may, or only campaigns an administrator leads. The admin page shows the
plan's usage when the program reports it.

Environment knobs: `HARNESS_MCP_URL` (when the server listens somewhere
other than `127.0.0.1:$PORT`), `HARNESS_CONTEXT` (the context window turns
are packed against; default 128K).

## Your own agent

Open **Settings > Connected agents**, name the connection, tick what it may
do (read, play, characters, campaigns, Dungeon Master), optionally limit it
to one campaign, and copy the setup line for your program. The token is
shown once.

Every tool is a web route called as you, so the agent can do exactly what
you can do in the browser and nothing more. It can never change backend
URLs or keys, accounts, passwords, the admin panel, backups or raw sheets.
Revoke it any time; changing your password disconnects every agent.

Live check (spends a little of the plan):
`HARNESS=claude HARNESS_MODEL=haiku node scripts/smoke-harness.mjs`.
