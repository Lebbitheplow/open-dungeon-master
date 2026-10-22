# Text backends

The Text Model panel in the sidebar picks the provider and model per story.
Narration streams in as the model writes it on every provider. The preferred
backend is llama.cpp's `llama-server` (the app's defaults point at it); the
legacy Ollama-native "Local" provider and any OpenAI-compatible server keep
working.

## The recommended DM model: Qwen3.6-35B on llama.cpp

The app looks for llama-server (llama.cpp) on `http://127.0.0.1:8001/v1`
first. No model is named in the code: a server that lists exactly one chat
model runs it with the model field left blank, and with several the admin
picks one (the guided setup, or Admin > Text model defaults). The model these
settings are tuned for is base Qwen3.6-35B-A3B Q8 with a 64K context and
Qwen's recommended non-thinking samplers; it needs about 28 GB of graphics
memory at Q4, and a 16 GB card runs gpt-oss-20b instead
([Hardware for a local model](#hardware-for-a-local-model)). A short default context silently
truncates the long DM prompt (party sheets, scene, story summary), which
makes the model loop; the 64K window is what fixes that. Direct llama-server
run:

```bash
llama-server -m Qwen3.6-35B-A3B-Q8_0.gguf \
  -c 65536 --jinja \
  --flash-attn on --cache-type-k q8_0 --cache-type-v q8_0 \
  --temp 0.7 --top-p 0.8 --top-k 20 --min-p 0.0 \
  --port 8001 --alias qwen3.6-35b
```

`--jinja` enables tool calling, which the dice engine and every sheet
mutation depend on. In llama-server's router mode the same settings live in
the model's preset INI instead of flags. Settings to replicate on any server:
**context 65536, temperature 0.7, top-p 0.8, top-k 20, min-p 0,
presence_penalty 0**, plus tool calling enabled and a way to turn reasoning
on for tool calls. If the server runs with `--api-key`, set
`OPENAI_COMPAT_API_KEY` in `.env.server`. Then point the app at the server
(admin panel or `OPENAI_COMPAT_BASE_URL`). Only an admin chooses backend
addresses: a player's campaign always runs on the server's, and only an
admin's own campaign can set another in its Story AI panel.

llama.cpp is the server we recommend, and the one the guided setup's hints
and the desktop app set up. Ollama, LM Studio, vLLM and other servers are
supported. Ollama renders the chat with its own code rather than the model's
template, has no reasoning budget, and ships some models with a presence
penalty that suppresses tool calls (the app now sends 0). Qwen3.5 9B
on Ollama called no tool in the six town turns it finished, narrating or
writing nothing instead; llama-server, sent the same request for the same
model at the same Q4_K_M quant, called them.

The guided setup connects an Ollama on the server's own machine through
Ollama's API (the "Local" provider), which takes the context window with
every call: the model's own, up to 64K
([Local models](#local-models-legacy-local-provider-ollama)). Its
OpenAI-compatible endpoint ignores a window sent with the request and runs
every model at Ollama's own context length, 4K on a card under 24 GB, too
small to narrate. To point the app at `http://127.0.0.1:11434/v1` by hand
anyway, use the same 35B model committed as a Modelfile with the context and
samplers baked in, model `qwen3.6-dm`:

```bash
ollama pull qwen3.6:35b-a3b-q8_0
ollama create qwen3.6-dm -f models/qwen3.6-dm.Modelfile
```

### Context window

The storyteller needs a context window of at least 16K tokens to narrate and
24K to run fights; 32K or more is recommended. The DM's instructions and the
compact tool set come to about 15K tokens before any story is told, and every
request is fitted to the window the backend really has
([request-fit.ts](../src/lib/dm/request-fit.ts)):

| Window | What plays |
|---|---|
| under 16K | nothing: each turn is refused with a note naming the fix |
| 16K (`-c 16384`) | narration, exploration and checks on the compact tool set; a fight turn can be refused for room |
| 24K (`-c 24576`) | fights too, on a trimmed tool set, with only the last few turns in view |
| 32K (`-c 32768`) | everything, with recent turns in view |
| 64K (`-c 65536`) | the default: the full tool set and a long transcript |

Measured on Qwen3.6-35B-A3B and Gemma 4 E4B; a bigger party or a longer
story leaves less of each window for history. llama-server reports its
window on `/props`, read at the start of each turn. On Ollama's own API the
app sets the window itself. Ollama's OpenAI-compatible endpoint and most
other servers report none, so a table plans for 16K and lets the server
decide: set `OPENAI_COMPAT_CONTEXT` to the window the server runs. **Test backend** (the guided setup, and Admin > Text model defaults)
says which window a campaign on that backend gets and whether it is enough.
Hosted models take their window from the model catalog, and the model pickers
leave out a model whose window is too small to narrate.

### Tool calls need thinking mode

This is the setting that matters most for a working table, and it is not obvious.
Under the long DM prompt, qwen3.6-35b in non-thinking mode surfaces tool calls only
about one turn in five: it narrates fights instead of starting an encounter, asks a
player to roll in prose instead of calling `request_roll`, and generally stops
driving the engines. With reasoning enabled it calls tools reliably.

The app handles this per request, so you do not configure it on the server:

- It sends `chat_template_kwargs: { enable_thinking: true }` on the **tool-decision**
  model calls only, and keeps the **final narration** call non-thinking so it still
  streams to players smoothly.
- Every other call (campaign setup, the story arc, the helpers that read a reply)
  asks for no thinking in so many words. A model that thinks by default (Qwen3.5 on a
  stock llama-server) otherwise spent the whole 4,096-token reply of the setup call
  thinking and wrote nothing.
- A model the catalog says does not reason is not asked to think (it would only sample
  cooler for nothing). The Context panel's "Fitted to this model" lines say when that
  happened.
- Set `DM_THINKING=0` to force thinking off everywhere. That makes turns fast but tool
  calls unreliable; it is a fallback, not a normal mode.

### Reasoning budget and latency

Left uncapped, a reasoning-enabled decision call can occasionally spiral for minutes
on a hard turn. Cap the reasoning budget on the server to roughly 1024-2048 tokens
(llama-server's `--reasoning-budget`, or the equivalent key in the preset INI).
Expect the tradeoff: tool-decision calls run about 50-100s and a full turn about
1.5-3 minutes on a single local GPU. Combat and multi-tool turns sit at the longer
end.

A small model (below) gets a budget from the app as well, for servers that have
none: once its thinking passes about 6,000 characters (some 1,500 tokens), the
call is cut off and asked again without thinking. Qwen3.5 9B on Ollama thought
18,700 characters on one turn and then answered nothing; its useful thinking ran
1,000 to 2,500.

### The prompt cache

Most of a turn's prompt is the same as the last turn's: the tool definitions and
the rules, 36K of the default 40K tokens. The app sends them first and unchanged,
as the system message, and the game state after them as a message of its own,
before the transcript. llama-server can then reuse that start from one turn to the
next, which matters most for Qwen3.5 and 3.6 (hybrid models) and Gemma (sliding
window): their cache can only be picked up again where a message begins, and while
the game state sat inside the system message every turn read the whole prompt
again. llama-server's default checkpoint settings are enough; nothing needs setting.

| First call of a turn | Before | Now |
|---|---|---|
| Qwen3.6-35B (the default), prompt reused | none of 40K tokens | 37K of 40K |
| Qwen3.6-35B at Q2, AMD BC-250 | about 145 s | 14 to 33 s |
| Qwen3.5 9B at Q4, AMD BC-250 | about 55 s | 13 to 26 s |

A turn that starts a fight still reads it all once, for the fight's own tools and
rules; every turn of the fight after that reuses them.

### presence_penalty

Keep `presence_penalty` at 0 for the DM. A meaningful presence penalty under the long
prompt suppresses tool calls (the model paraphrases the tool in prose instead of
emitting it). The app pins `presence_penalty: 0` in every request so a server-side
preset penalty cannot break tool calling; if you drive the model from somewhere else,
set it to 0 there too.

The pin is written after the per-role sampling settings are applied, and no sampling
profile offers `presence_penalty`, so this cannot be reintroduced from a settings
screen. Breaking dice rolling should not be one checkbox away.

## Hardware for a local model

The storyteller runs on the GPU, and the GPU's memory decides which model plays:

| Graphics memory | Storyteller | File |
|---|---|---|
| about 28 GB or more | Qwen3.6-35B-A3B, recommended (above): Q4_K_M from about 28 GB, Q8 from about 45 GB | 22 to 38 GB |
| 16 GB, the minimum | gpt-oss-20b, MXFP4 | 12.1 GB |
| under 16 GB | not supported | |

Graphics memory is a card's own memory or, on a machine whose CPU and GPU share
one pool (Apple silicon, AMD Ryzen AI Max), the share the system leaves the GPU: a
Mac needs 24 GB or more for the minimum. The 35B is a mixture of experts, so on a
PC its experts can wait in system memory (llama-server's `--n-cpu-moe`): a 16 GB
card with 32 GB of system memory runs it at Q4, and the desktop app sets that up
itself. gpt-oss-20b fits a 16 GB card whole.

Below the minimum is not supported, and problems there are not treated as bugs. A
smaller model may limp through a scene on the short rules (below), but it skips
rolls, attacks out of turn and narrates past the dice often enough that the table
stops trusting it. Use an API key, an agent program or a human Dungeon Master on a
smaller machine instead.

### The 16 GB minimum: gpt-oss-20b

OpenAI's gpt-oss-20b has 21 billion parameters with 3.6 billion active, so it plays
the full rules and the full tool set at the speed of a much smaller model. The file
is `gpt-oss-20b-MXFP4.gguf` from
[ggml-org/gpt-oss-20b-GGUF](https://huggingface.co/ggml-org/gpt-oss-20b-GGUF):

```bash
llama-server -m gpt-oss-20b-MXFP4.gguf \
  -c 65536 --jinja \
  --flash-attn on --cache-type-k q8_0 --cache-type-v q8_0 \
  --reasoning-budget 1024 \
  --port 8001 --alias gpt-oss-20b
```

Leave the sampling at llama.cpp's defaults, as it was measured. It reasons in a
channel of its own, which the app reads apart from the story; a tool call it starts
in the prose ("to=functions.request_roll") is cut before the table sees it. Its
window is cheap: half its layers look back only 128 tokens, so 64K at `q8_0` takes
about 1 GB beside the file.

Measured with `scripts/smoke-local.mjs` on the full rules: the town (eight turns that
travel, meet an innkeeper, persuade, buy, sneak and fight), the ford (five, with an
ambush) and the skirmish (nine, a fight over several rounds, each line spoken by
whoever is up). A check is missed when its turn lacks the tool call it needs; a slip
is something a player should never read (a recited turn order, a leaked call, a
repeated passage); an invented blow is a hit the narration lands that no tool rolled.

| Model, machine | Town (8 turns a run) | Ford (5) | Skirmish (9) | Seconds a turn |
|---|---|---|---|---|
| gpt-oss-20b, AMD BC-250 | 2 runs: 5 missed, 0 slips | 2 runs: 0, 0 | 4 runs: 6 missed, 0 slips | 90 to 160 |
| Qwen3.6-35B-A3B Q8, Framework Desktop (the default) | 2 runs: 0, 1 | (not rerun) | 5 runs: 2 missed, 0 slips | 135 to 205 |

The Framework Desktop is an AMD Ryzen AI Max+ 395 with 128 GB shared by its
Radeon 8060S graphics; its real play on the default model took a median of 90
seconds a turn. The skirmish, a fight of identical lines, is where every model
slipped most. Before a player's turn ended where the table was told it ends
(pc_attack's approach and endTurn, a narration or the player's own words handing
the turn on), the same skirmish gave gpt-oss-20b 14 missed and 15 slips in five
runs, and the default model 8 and 7 in four: a turn the player had ended stayed
open, and the next player's words went to the same character. Two of gpt-oss's
six misses were replies llama.cpp threw away whole: when the reasoning budget
ends gpt-oss's thought and it writes on without opening its answer, llama.cpp's
parser refuses the reply (every build from the app's b10621 to the newest), and
the app now asks for it once more. Two of its town misses were a player acting
on another character's turn, which the DM rightly answered without an attack.
The town runs had no content pack, so the inn's shop opened bare; a general
store now always stocks everyday gear such as torches, rations and rope. One
run of the default model narrated a hit after the fight had ended, on a goblin
already dead; an attack roll with no fight running is now refused. No other run
narrated a blow that no tool landed. One gpt-oss skirmish run narrated an
ambush with no fight started, which began a turn late; an attack begun on the
party in prose is now read as a fight starting, and the DM is asked to start
it or to say that nobody attacked, so a misread threat costs a call, not a
fight.

Measured before those changes: the 35B at Q2 on the BC-250 played a fight about
as well as gpt-oss-20b (two skirmish runs: 1 missed, 3 slips), slower (130 to 190
seconds a turn), and with more slips around the town; gpt-oss-20b on the
Framework Desktop ran 110 to 190 seconds a turn. gpt-oss-20b is the minimum for
its speed and its memory: it leaves room for a picture model beside it on a
bigger machine. Run it on a llama.cpp release build: a fork built for another
model's speculative decoding ended its streams early and showed its reasoning.

### Below the minimum: short rules

A model with fewer than 16 billion parameters is played differently, with
nothing to set. The app reads the size from llama-server's `/v1/models`
(`meta.n_params`), from Ollama's `/api/show`, or else from the size the model's
name states (`qwen3.5-9b`, `gemma4:12b`), hosted or local alike. The Context
panel's "Fitted to this model" lines say when it applied. For such a model the
turn:

- carries short rules: a few plain numbered steps naming the core tools (about
  800 tokens, 330 more in a fight) instead of the full rules (6,000 to 9,000);
- offers the compact tool set at any window, with the rest one `more_tools` call
  away;
- leaves the server's dice markers out of the past narration it reads (a 9B model
  copied them into its prose instead of rolling).

`DM_BRIEF_RULES=0` in the environment plays a small model like any other, and
`DM_BRIEF_RULES=1` gives any model the short rules. Thinking stays on for the tool
calls. This keeps a small model at the table; it does not make one supported. What
was measured on the BC-250 below the minimum, for the record (the town, checks
missed of eight):

| Model, window | File | Rules | Town |
|---|---|---|---|
| Qwen3.5 9B Q8_0, 64K | 9.5 GB | short | 1 and 2 of 8 |
| Qwen3.5 9B Q4_K_M, 64K | 5.7 GB | short | 0 and 1 of 8 |
| Gemma 4 12B QAT UD-Q4_K_XL, 64K | 6.7 GB | short | 1 of 8 |
| Qwen3.5 9B UD-IQ3_XXS, 24K | 4.0 GB | short | 0 of 8 |

A small model is weakest on the battle map: it attacks out of turn and cannot count squares, so an
attack out of reach is refused with the square to walk to. Qwen3 14B, Qwen3.5 9B at
UD-IQ2_M and Ministral 3 14B missed more; Gemma 4 26B-A4B at UD-Q3_K_XL ran the
BC-250 out of memory.

### AMD BC-250

The BC-250 is the 16 GB box the minimum was measured on.

- The 16 GB of GDDR6 is shared by the CPU and the GPU. Set the VRAM carve-out low
  (512 MB) and let the GPU use the rest as GTT, with the kernel arguments
  `amdgpu.gttsize=14750 ttm.pages_limit=3776000`.
- Build llama.cpp for Vulkan: `cmake -B build -DGGML_VULKAN=ON && cmake --build build -j`
  (on Fedora the build also needs `spirv-headers-devel`). The HIP build failed for
  this GPU (gfx1013) at llama.cpp ff5a233.
- Run one model server at a time. A second one, or a service left enabled, runs the
  box out of memory and the kernel kills one of them.

```bash
llama-server -m gpt-oss-20b-MXFP4.gguf --alias gpt-oss-20b \
  -c 65536 -np 2 --kv-unified --jinja -ngl 99 \
  --flash-attn on --cache-type-k q8_0 --cache-type-v q8_0 \
  --reasoning-budget 1024 --cache-ram 0 \
  --port 8001
```

- With `--kv-unified` the `-c` is shared by both slots, while `/props` reports it
  whole for each: a DM turn and the app's helper call running at once must fit in
  it together. A fight on the full rules runs to about 52K tokens.
- `--cache-ram 0` keeps llama-server from holding extra prompt cache in system
  memory, which on this box is the memory the model needs.

## Local models (legacy "Local" provider, Ollama)

Supported; llama.cpp (above) is the recommended server. The legacy
Ollama-native provider was built around the Gemma 4
quantization-aware-trained (QAT, Q4_0) builds. The storyteller's minimum
([Hardware for a local model](#hardware-for-a-local-model)) holds here too: the
E2B, E4B and 12B are below 16 billion parameters and play only on the short
rules, which is not supported for the storyteller, though any of them serves as
the utility model for summaries:

```bash
ollama pull gemma4:e2b-it-qat       # 4.3 GB
ollama pull gemma4:e4b-it-qat       # 6.1 GB
ollama pull gemma4:12b-it-qat       # 7.2 GB
ollama pull gemma4:26b-a4b-it-qat   # 16 GB
ollama pull gemma4:31b-it-qat       # 19 GB
```

Measured on an M2 Max (32 GB), real story prompts, ~300-token turns. RAM is
resident memory from `ollama ps` at each model's full native window, which
the app asked for at the time (the E-models stream per-layer embeddings, so
they sit below their download size):

| Model | Disk | RAM | Context | Generation | Typical turn | Cold load |
|---|---|---|---|---|---|---|
| E2B | 4.3 GB | 4.5 GB | 128K | 56 tok/s | 3.4 s | ~7 s |
| E4B | 6.1 GB | 3.2 GB | 128K | 44 tok/s | 3.8 s | ~9 s |
| 12B | 7.2 GB | 7.7 GB | 256K | 21 tok/s | 11.5 s | ~9 s |
| 26B MoE | 16 GB | 15 GB | 256K | 48 tok/s | 4.7 s | ~30 s |

The app asks Ollama for the model's own context window, up to 64K (32K for
a model under 16 billion parameters); `LOCAL_TEXT_CONTEXT` sets another.
Gemma 4 uses sliding-window attention for most layers, so its KV cache stays
small even past that: the 12B measured ~7.6 GB of RAM with 50K+ tokens of
story in context.

The 26B MoE is both the strongest writer and nearly the fastest (only ~4B
params active per token), but wants headroom: prefer 24 GB+ RAM, more if you
run local image generation alongside it.

Two implementation notes baked into the app:

- Gemma 4 is a hybrid reasoning model; the app disables its thinking channel
  (`think: false`) so the whole token budget goes to story text. Models that
  don't support the flag are retried without it.
- If a local model's chat template doesn't support function tools, the turn
  is retried without the image tool, so the story continues without auto
  images.

## Choosing a model: the catalog and discovery

Every model field in Admin > Text model defaults lists what its backend
serves right now, with a line under each row about what the model can do.
The list is help, not a gate: **Type a model id…** takes any id, a model
pulled or released after this version shipped is picked the same way, and a
campaign's chosen model is never swapped for another because a list
changed. Three sources feed the pickers (src/lib/model-registry):

- **The backend's own list.** Ollama is asked `/api/tags` and `/api/show`
  (each model's window and whether it calls tools, which outrank the
  catalog); an OpenAI-compatible server or hosted provider is asked
  `/v1/models`, with the key saved for that host and no other; the agent
  programs use their own discovery (Codex's `model/list`, opencode's
  `/api/model` on a private server, Grok's `models` command, Claude Code's
  `initialize` answer). An
  OpenAI-compatible images API is asked `/v1/models` and kept to its picture
  models. No model is named in the code: nothing is preselected that the
  backend does not list, and a backend that lists exactly one chat model
  runs it with the model field left blank (a llama-server started with one
  model, an Ollama with one pull). The picker shows this machine's memory
  and GPU (from ComfyUI's `/system_stats` when one is running) and keeps
  off the list the models that cannot run the storyteller: no tool calls,
  no text, or more weights than the machine can hold. One click shows them.
- **The model catalog**, from [models.dev](https://models.dev): context
  windows, tool calling, reasoning, modalities, prices and deprecations for
  the models each provider serves. The server starts from a bundled copy,
  caches a fresh one beside the database (`data/model-catalog.json`) and
  refreshes it once a day in the background; offline it keeps serving the
  copy it has. The catalog is data read field by field, never code, and it
  never writes to any setting. `ODM_MODEL_CATALOG=off` stops the fetch
  ([configuration.md](configuration.md)); `node scripts/refresh-model-snapshot.mjs`
  rewrites the bundled copy for a release.
- **This server's own tests.** Each **Test backend** result is remembered
  per host and model (no key, no address) and shown beside the model.

`scripts/test-no-model-ids.mjs` keeps it that way: it fails on any string
literal in `src/` that is a model ID in the bundled catalog, apart from the
models ODM downloads and runs itself and the few still waiting to come out.

The catalog's word on a model decides the flags: a model that writes no text
or takes no tool calls is marked unfit for the storyteller, a deprecated one
warns before its provider retires it, a small window warns that the table
will forget turns, and a chosen model its backend no longer lists says so.
An id the catalog has never heard of is simply unknown, and runs as typed.
The same catalog sets the prompt budget: a hosted provider reached by URL
(OpenRouter, DeepSeek, Groq and the rest) packs against the model's catalog
window, capped at 128K like OpenAI; an Ollama model packs against the window
Ollama reports for it, or the catalog's row for the same weights.

A campaign's Story AI panel shows the catalog's line under its model fields
too (no backend is asked, no key is involved).

## Connect a server

The default llama-server setup above uses this provider. Switch a story's
provider to **Connect a server** in the Text Model panel to point it at any
OpenAI-compatible backend: llama.cpp, LM Studio, vLLM, TabbyAPI, KoboldCpp, a
remote Ollama, or **OpenRouter**. Enter:

- **Backend URL** — your server's address. A bare host
  (`http://127.0.0.1:8080`), a versioned base (`.../v1`), or the full
  `.../chat/completions` endpoint all work. Quick-fill buttons set the URL
  for OpenRouter, LM Studio, llama.cpp, and Ollama.
- **Model** — whatever model name your server expects. For OpenRouter, paste
  an id from [openrouter.ai/models](https://openrouter.ai/models).
- **API key** — optional, right in the panel. Most local servers need none;
  OpenRouter does.

### OpenAI and other strict vendor APIs

"OpenAI-compatible" covers two different things: a local server that ignores
fields it does not recognise, and a vendor API that answers 400 for any
unrecognised argument. ODM's request body grew around the former, so the
fields that make the local Qwen preset behave are the ones OpenAI rejects.
The backend URL decides which body gets sent
(`describeEndpoint` in `src/lib/dm/sampling-logic.ts`):

| | local server | OpenRouter | OpenAI |
|---|---|---|---|
| `top_k`, `min_p`, `repeat_penalty` | sent | stripped | stripped |
| `chat_template_kwargs` (thinking mode) | sent | sent | not sent |
| output cap field | `max_tokens` | `max_tokens` | `max_completion_tokens` |
| `presence_penalty: 0` | sent | sent | not sent |

For OpenAI, set the **Backend URL** to `https://api.openai.com/v1`, the
**Model** to whatever you pay for, and paste your key in the **API key**
field (or set `OPENAI_COMPAT_API_KEY`). Nothing else needs changing.

Two things follow from that one field:

- **Pictures are covered too.** Choose **OpenAI** as the Images backend and
  pick its picture model there; with no image key configured anywhere,
  renders go out on this same key: it is the same account, just a different
  API. See [image-generation.md](image-generation.md). Local image generation is
  untouched: ComfyUI and the FLUX workers work exactly as before.
- **The window is 128K.** No vendor API reports its context size, so an
  unknown endpoint packs against a 16K default. OpenAI is known by name
  instead: every chat model it still sells has at least 128K of room, so the
  prompt packs against 128,000 tokens (the retired `gpt-3.5` and 8K/32K
  `gpt-4` models keep their real, smaller sizes). The newest models hold more
  than that, but the prompt is billed by the token here, so ODM stops at the
  floor they share; set `OPENAI_COMPAT_CONTEXT` to go higher or lower.
- **In the apps the key belongs to the device, not to a campaign.** A world
  hosted by the desktop or Android app takes its key once, on the app's
  **Story AI** screen. Every campaign on that device follows it, including
  the ones made before the key was added, and changing the model there
  changes it everywhere. The campaign's Setup tab shows the choice and keeps
  only what is the campaign's own: pictures on or off, their shape and speed,
  and passage length.

**Processing speed.** On `api.openai.com` each model role (the storyteller,
the utility model) can ask for OpenAI's paid Fast tier, about twice the
price per token, under **Admin > Text model defaults**. It is offered for
any named model: which models have the tier is not read from their names.
The reply's `service_tier` says what ran ("priority" or "fast", or
"default" when OpenAI ran the call at standard speed and billed it so), and
a model that refuses the field has it dropped and runs at standard speed;
the line under the setting says which happened on the last call.

Reasoning models (the gpt-5.x and o-series lines) reject `temperature`
outright. That is handled rather than fatal: the 400 names the field, ODM
drops it and retries, and the turn lands with its tool calls intact. The
dropped field is remembered for that model for the life of the process, so
the one wasted round trip is paid once rather than on every turn; a sampling
profile of **ODM default** with no per-role temperature avoids it entirely.

**The GPT-6 line** reasons by default, and on Chat Completions that cannot
be combined with function tools. No route is chosen from a model's name,
which would go stale with the next model OpenAI ships: every model's first
tool call goes to Chat Completions, and the 400 OpenAI answers when a model
cannot carry tools there names the way it can ("To use function tools, use
/v1/responses or set reasoning_effort to 'none'."). ODM reads that answer
(`scripts/lib/openai-tool-route.mjs`, shared with the admin panel's **Test
backend**), switches to the route it names, and retries the same call:

- **the Responses API** (`/v1/responses`) when the refusal offers it, with
  the model's reasoning left on. It carries tools for every model that
  needs it, including the ones that refuse `"none"`. A model whose refusal
  offers both, as `gpt-6-sol` and `gpt-6-luna` do, therefore runs here.
- **Chat Completions with `reasoning_effort: "none"`** when that is all the
  refusal offers.

The route is remembered for the model on that server for the life of the
process, so the refused call (about a second, nothing billed) is paid once
per model after each restart, not on every turn. A call is never switched
back to a route it was already refused on, so two refusals that contradict
each other end the turn with the second one's message. The same learning
applies to any OpenAI-compatible proxy that relays those errors.

The Responses route (`src/lib/openai-responses.ts`) translates the table's
transcript and tool definitions on the way out and the reply on the way
back, so the DM loop never learns which transport answered. Nothing is
stored on OpenAI's side (`store: false`); the model reasons afresh over each
tool result, which OpenAI allows.

What never happens is the quiet alternative: a 400 that mentions reasoning
or the Responses API is not read as "this server has no function calling",
and neither is any tool refusal from `api.openai.com`, so the turn fails
with OpenAI's own message rather than being retried without tools and
narrated with no `request_roll` and no engines.

Two of those rows are why a paid key works. Reasoning models dropped
`max_tokens` in favour of `max_completion_tokens`, and they reject
`presence_penalty` outright; `chat_template_kwargs` is how ODM asks llama.cpp
and vLLM for thinking mode, and a vendor API has no chat template to pass it
to. The thinking request is simply not made against OpenAI, which costs
nothing there: it exists because Qwen is an unreliable tool caller without it,
not because the DM needs it.

Anything ODM does not recognise by host is treated as a permissive local
server. If such a backend turns out to be strict, the first 400 that names a
field is handled rather than failing the turn: that one field is dropped and
the request is retried, up to three times, and the drop is logged. Tool
support is deliberately excluded from that path, because a backend without
function calling is already handled by the retry-without-tools fallback.

Note that the DM leans on tools heavily, so a model with weak function
calling will narrate past its dice no matter which backend serves it.

You can enter everything in-app and store it locally with the story. The Mac
DMG and `Launch.command` can also save first-run defaults to `.env.server`:
`DEFAULT_TEXT_PROVIDER=custom`, `OPENAI_COMPAT_BASE_URL`, and
`OPENAI_COMPAT_MODEL`. If you'd rather keep keys out of the UI, leave the
field blank and set an env var instead — `OPENROUTER_API_KEY` (and optional
`OPENROUTER_MODEL`) for OpenRouter, or `OPENAI_COMPAT_API_KEY` for any other
server. The narrator's `generate_image` tool is sent when your server
advertises tool support; if it doesn't, the turn is retried without it so the
story still flows.

## Long-story memory

Story history is packed into the context window with a token budget that
stays ~10% under the limit. When a story finally outgrows the window, the
oldest passages are evicted in blocks of 16 — keeping the prompt prefix
append-only so Ollama's prompt cache makes each turn pay only for its new
tokens — and the evicted passages are folded into a rolling "story so far"
summary (the same handoff-summary approach Codex CLI uses for context
compaction, adapted for fiction). The narrator keeps plot threads, character
details, debts, and secrets even after the raw text has scrolled out of
context.

Deep prefill is the one real cost of huge contexts (~160 tok/s at 50K depth
on the 12B), and it only bites when the cache goes cold on a very long story;
set `LOCAL_TEXT_CONTEXT` lower if you'd rather bound that. By default the app
asks Ollama for no more than 64K on every platform: Ollama reserves the cache
for the whole window when it loads the model, used or not, and gpt-oss-20b's
native 128K is about 3 GB of cache on top of the model, more than a 16 GB
card has to spare.
Set `LOCAL_TEXT_CONTEXT` higher if your machine has the headroom. A model
under 16B parameters is capped at 32K: Qwen3.5 9B's
native 262K window would ask Ollama for about 8 GB of cache, more than the
weights, on the cards such a model is chosen for.
