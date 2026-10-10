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

The guided setup (**Admin > Guided setup**, and the first thing a fresh server
shows its admin) walks this as its first question, with the same cards and the
install and sign-in commands to copy. By hand: open **Admin > Agent program**. Each program has a card saying whether it
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
only after **Paint a test picture** makes one real image here. The test
paints the way a table does: a landscape location map, through the same
picture door and queue a campaign uses, then checks the saved file. It
also reports the campaigns: which already paint with the program, which
keep a working backend of their own, and which are stuck on one that
cannot paint (a ComfyUI that is not running, usually because the campaign
was made before pictures were set up). **Paint the tables' pictures with
it** then switches the program on, makes it the default for new
campaigns, and moves the stuck ones onto it, with their area maps back
on. A campaign on a backend that works is never moved. The same rescue
runs whenever the admin panel saves a change to pictures.

Without the program's pictures, pictures come from your image backend
(ComfyUI, an OpenAI key) as before, and with none the tables use their
painted placeholders. A picture that fails says why under its
placeholder, in the program's own words when it answered without one.
Claude Code and opencode cannot paint.

### Where it runs

- **A server started with npm or systemd:** yes. The program is found even
  when the server does not have your shell's `PATH`; set **Path to the
  program** if it lives somewhere unusual.
- **The Docker image:** only with the program installed inside the
  container; a container cannot start programs on its host. Build the image
  with `AGENT_PROGRAMS=@openai/codex` in `.env` (`docker compose up -d
  --build`; `@anthropic-ai/claude-code` and `opencode-ai` work the same way),
  then sign in once with `docker compose exec open-dungeon-master codex login
  --device-auth`. The sign-in lives in the `odm-home` volume and survives
  updates. The image carries the system CA store for this: Codex is a native
  binary and cannot use Node's bundled roots.
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

Open **Settings > Connected agents** (or the guided setup's last question),
name the connection, tick what it may do (read, play, characters, campaigns,
Dungeon Master), optionally limit it to one campaign, pick your program and
copy its one line. The token is shown once. The panel then watches for the
agent's first call and says when it arrives, so you know the line worked.

Every tool is a web route called as you, so the agent can do exactly what
you can do in the browser and nothing more. It can never change backend
URLs or keys, accounts, passwords, the admin panel, backups or raw sheets.
Revoke it any time; changing your password disconnects every agent.

For a connected player agent that should wake when its character has a
decision, see [Player webhooks](player-webhooks.md). This opt-in server
feature includes a Codex receiver on the player's computer. Other clients
need their own wake adapter; an MCP connection alone does not start turns.

Live check (spends a little of the plan):
`HARNESS=claude HARNESS_MODEL=haiku node scripts/smoke-harness.mjs`.
