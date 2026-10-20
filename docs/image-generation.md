# Image generation

Inline images are optional — text play works without any image setup. Image
requests made while no backend is available show a Generate button that
succeeds once one is up.

Four backends are exposed in the Images panel:

| Backend | Hardware | Models |
|---|---|---|
| MFLUX Mac | Apple Silicon (MLX) | FLUX.2-klein uncensored |
| SDNQ GPU/CPU | NVIDIA CUDA, supported AMD (ROCm), CPU | FLUX.2-klein |
| ComfyUI | anything ComfyUI runs on | the image model catalog, or any checkpoint |
| OpenAI | none, the pictures are made off-box | the picture models your key lists |

## The FLUX worker (MFLUX / SDNQ)

Inline images are produced by a small HTTP worker that wraps the optimized
FLUX.2-klein backends from the
[`ultra-fast-image-gen`](https://github.com/newideas99/ultra-fast-image-gen)
project. Apple Silicon uses the resident MFLUX/MLX path; Windows/Linux use
the PyTorch SDNQ path with `IMAGE_SERVER_DEVICE=cuda` or
`IMAGE_SERVER_DEVICE=cpu`. The app expects that repo at
`~/ultra-fast-image-gen` on macOS/Linux or
`%USERPROFILE%\ultra-fast-image-gen` on Windows (override with
`ULTRA_FAST_IMAGE_GEN_DIR`).

The uncensored text encoder is downloaded once from a gated Hugging Face
repo: accept the terms on the model page, then set your token in
`ultra-fast-image-gen`'s web UI (or add `HF_TOKEN=...` to that repo's
`.env`). Windows/Linux use the standard `flux2-4b-sdnq` route by default, so
the gated token is not required for the normal GPU/CPU path.

Start the worker from the **Images** panel with **Start**; the app launches
and supervises the process for you. The **Models** button in the Images panel
opens the local model/cache folder
so you can inspect the patched MFLUX checkout.

CLI routes behind the app's two FLUX backends:

- MFLUX/MLX uncensored HS: `flux2-4b-uncensored-mflux-hs` (Apple Silicon)
- PyTorch SDNQ: `flux2-4b-uncensored-sdnq-hs` on MPS; `flux2-4b-sdnq` on
  CUDA/CPU because the HS attention patch is MPS-only

Defaults are 1024 long-side, 4 steps, guidance 0.0; the slow size is 2048
long-side. Square, portrait, and landscape aspects are exposed in the UI.
Reference images are capped at two per request. MFLUX runs resident by
default on Apple Silicon: the worker keeps the model loaded between
generations. On Windows, the worker automatically maps MFLUX requests to the
SDNQ backend because MLX is not available there.

## ComfyUI

Already run [ComfyUI](https://github.com/comfyanonymous/ComfyUI)? Pick
**ComfyUI** as the Images backend and the app drives your instance directly:
no FLUX worker, no `ultra-fast-image-gen`, and it works on any hardware
ComfyUI supports.

1. Start ComfyUI (default `http://127.0.0.1:8188`).
2. In **Admin > Image generation**, choose **ComfyUI**, confirm the server URL,
   and pick an **Image model**.

Notes:

- Character portrait references are not used by this backend; scenes with
  saved characters generate from the text prompt alone.
- Generations queue behind whatever else your ComfyUI instance is doing.
- Set `COMFYUI_URL` in `.env.local` to change the default server URL.

### Image models

The **Image model** picker offers two kinds of choice:

- **Models**: the image models the app knows how to run, catalogued in
  `src/lib/image-models`. Each carries its own ComfyUI graph and settings
  (steps, CFG, sampler, scheduler, shift), taken from ComfyUI's own workflow
  templates with the prompt-rewriting nodes left out, since the storyteller
  already writes the prompt. A model is offered once ComfyUI lists every file
  it needs. Names do not have to match exactly: another precision of the same
  weights (fp8, int8, bf16), or a copy in a subfolder, counts. Choosing a model
  paints every campaign's ComfyUI pictures with it.
- **Checkpoints**: any checkpoint ComfyUI lists, and a campaign may keep its
  own; a campaign with none of its own paints with the one picked here.
  Nothing is painted until a model or a checkpoint is picked: the app names
  no checkpoint itself and takes none from ComfyUI's list. Checkpoints the catalog recognises (SDXL, Pony, SD 3.5, NetaYume,
  HiDream-O1) run with their family's settings; others run with the SDXL-era
  defaults (25 steps, CFG 6). Video models, upscalers, refiners and bare
  diffusion models linked into `models/checkpoints` are left out, since none of
  them can paint a picture on their own.

Under the picker, **Image models for this machine** lists the whole catalog
for the hardware ComfyUI runs on: what that hardware was measured doing with
each model, which are installed, and for the rest the files to add, with
their download links and the `ComfyUI/models/` folder each one goes in. The
setup wizard offers the same choices, preselects the model its hardware was
measured recommending when ComfyUI has its files, and names the best measured
model when it does not.

Distilled models (the Turbo, Lightning and schnell ones, and most others at
CFG 1) run without a negative prompt, so a table's boundary cannot keep
anything out of their pictures; the picker says so when one is chosen. The
boundary's words are never folded into the positive prompt instead, because a
diffusion model paints the nouns it is given, negated or not.

### Measured hardware

Each catalog model was timed with `scripts/bench-image-models.mjs`, which
sends the graph the server sends: the app's own portrait, creature and scene
prompts at 1024 px (fast mode), seconds per picture once the model is loaded,
the first picture after a model switch (which loads it from disk), and peak GPU
memory. The rows live in `src/lib/image-models/verified.json`, one per model
and hardware profile, and the picker shows the row for the hardware it
recognises from ComfyUI's `/system_stats`. The strix-halo profile below is a
Framework Desktop: an AMD Ryzen AI Max+ 395 whose Radeon 8060S graphics share
its 128 GB of memory, so a peak figure is memory taken from that one pool. On
a separate card the peak has to fit the card.

<!-- measured-table: node scripts/bench-image-models.mjs --table -->

On strix-halo (AMD Radeon 8060S Graphics, ComfyUI 0.39.2, torch 2.14.0+rocm7.2):

| Model | Verdict | Portrait (square) | Scene (landscape) | First picture | Peak GPU memory | Steps | Notes |
|---|---|---|---|---|---|---|---|
| Mage-Flow Turbo | recommended | 5 s | 5 s | 9 s | 11.7 GB | 4 | The fastest and lightest measured, under five seconds a picture at a 12 GB peak, in an oil-painted fantasy look: an owl-faced bear, a forge with anvils and a bridge. Dwarves get elf ears and scars come out as sigils. MIT. |
| Lens Turbo | recommended | 10 s | 10 s | 19 s | 38.2 GB | 4 | Under ten seconds a picture: a real owlbear, a forge with anvils, bridge and adventurers, dwarves without elf ears. A glossy 3D-render look with slightly noisy skin; 38 GB peak (its GPT-OSS 20B encoder). MIT. |
| FLUX.2 [klein] 4B | recommended | 15 s | 14 s | 17 s | 20.5 GB | 4 | Among the best and quickest: stocky dwarves without elf ears, a true owlbear, a detailed forge. Apache-2.0. Can leave a faint logo mark in a corner. |
| Z-Image Turbo | recommended | 19 s | 15 s | 24 s | 23.6 GB | 8 | Clean painterly portraits and a true owl-bear in under 20 seconds. Dwarves can come out with elf ears. |
| HunyuanImage 2.1 Distilled | recommended | 22 s | 19 s | 43 s | 44.6 GB | 8 | Quick and unmistakably fantasy: real dwarves, an owl-faced bear, a forge with anvils and a bridge. Heavy (45 GB peak, twice the other quick models) and read the female dwarf as a bearded man. |
| Boogu Image Turbo | recommended | 30 s | 24 s | 33 s | 28.1 GB | 4 | Clean tabletop game art in half a minute: a stout dwarf without elf ears, a true owlbear, a forge full of dwarves at their anvils. Different seeds gave nearly the same portrait. Apache-2.0. |
| Qwen Image 2.1 Turbo | recommended | 45 s | 35 s | 55 s | 21.9 GB | 8 | Nearly the base model's pictures at a third of the time: right dwarf, right owlbear, readable scene. |
| Krea-2 Turbo | recommended | 59 s | 50 s | 38 s | 28.5 GB | 8 | The most tabletop-looking pictures measured: a stout dwarf cleric, a true owlbear, a forge with anvils, bridge and adventurers. Slower than klein or Z-Image Turbo. Krea-2 Community License; check its terms before commercial use. |
| ERNIE-Image Turbo | recommended | 68 s | 50 s | 61 s | 34.1 GB | 8 | Rich painterly fantasy: a true owlbear, a crowded forge with adventurers on the bridge, stout portraits (with elf ears). About a minute a picture, 34 GB peak. Apache-2.0. |
| HiDream-O1 Dev | recommended | 69 s | 49 s | 60 s | 13.9 GB | 28 | Clean painted game art from one 8 GB checkpoint at a 14 GB peak: real dwarves, a true owlbear, a working forge. About a minute a picture; read the female dwarf as a bearded man. MIT. |
| FLUX.1 schnell | works | 30 s | 25 s | 39 s | 32.6 GB | 4 | Paints dwarves as elves, the owlbear as a plain owl, and scribbles signature-like text into corners. |
| Stable Diffusion XL | works | 43 s | 31 s | 41 s | 12.3 GB | 25 | CyberRealistic XL: dwarves come out human and the owlbear as an owl. |
| Pony Diffusion XL | works | 44 s | 32 s | 43 s | 12.2 GB | 25 | Drifts to anime faces and light backgrounds, misses the scene and paints the owlbear as an owl. |
| Qwen-Image 2512 Lightning | works | 46 s | 39 s | 42 s | 76.9 GB | 4 | Qwen-Image 2512's forge at under a minute, but photographic rather than painted, the owlbear is a plain bear, and the LoRA unpacks the 20B model to a 77 GB peak. Qwen Image 2.1 Turbo paints better in less memory. |
| PixelDiT 1.3B | works | 55 s | 39 s | 52 s | 9 GB | 30 | Lively stylised game art on only 9 GB, under a minute a picture, but it ignores the dark backgrounds, turns the forge purple, and gives dwarves elf ears. NVIDIA non-commercial licence. |
| Ming-Image 0.1 Design | works | 65 s | 53 s | 82 s | 47.2 GB | 12 | Superb dark oil-painting fantasy (the best-built owlbear, a forge full of dwarves), about a minute a picture, but a 47 GB peak from its 19.5 GB encoder; elf ears, and a signature mark in a corner. |
| Stable Diffusion 3.5 Medium | works | 78 s | 55 s | 81 s | 21.4 GB | 28 | Painterly and fairly quick for its size, but the owlbear is a plain owl, faces have odd marks, and one portrait came on a white sketch ground. |
| Mage-Flow | works | 85 s | 63 s | 79 s | 12.8 GB | 30 | Much the same pictures as Mage-Flow Turbo (a clean owl-faced bear, an anvil-lined forge) at eighteen times the time; elf ears and sigil scars here too. |
| Lens | works | 1 min 33 s | 69 s | 83 s | 38.1 GB | 20 | A warmer painted look than Lens Turbo with a great owlbear and forge, but ten times the time (about a minute and a half); faces read young and the scars look painted on. |
| HiDream-I1 Fast | works | 1 min 57 s | 89 s | 2 min 22 s | 49.6 GB | 16 | Clean game-art portraits and a good owlbear, but two minutes a picture and a 50 GB peak (four text encoders); dwarves come out as young humans and the forge turned teal. |
| NetaYume Lumina | works | 2 min 6 s | 90 s | 2 min 5 s | 18.2 GB | 30 | Despite its anime training, a clean cartoon-game look on ODM's prompts with a decent forge, but two minutes a picture; the owlbear is an owl and portraits are plain. |
| Qwen Image 2.1 | works | 2 min 8 s | 1 min 34 s | 1 min 50 s | 22 GB | 25 | The most faithful pictures measured, but over two minutes each; the Turbo build looks almost the same. |
| FLUX.2 [klein] 4B Base | works | 2 min 10 s | 1 min 39 s | 2 min 15 s | 20.5 GB | 20 | Pictures much like the distilled klein 4B at eight times the time; worth it only for its real negative prompt. |
| Anima | works | 2 min 13 s | 1 min 32 s | 1 min 59 s | 11.8 GB | 30 | Light (12 GB) and tidy, with clean bust portraits on black, but over two minutes a picture; the owlbear is a bear with an owl's face pasted on, and the forge is a lava canyon without anvils. Non-commercial licence. |
| FLUX.1 dev | works | 2 min 24 s | 1 min 51 s | 2 min 34 s | 32.8 GB | 20 | A good owlbear, but two and a half minutes a picture; dwarves come out as elves, the forge misses its anvils, and a fake signature appears in corners. Non-commercial licence. |
| FLUX.1 Krea dev | works | 2 min 30 s | 1 min 57 s | 2 min 35 s | 26.8 GB | 20 | A fine owlbear and oil-painting look, but two and a half minutes a picture; paints dwarves as elves and signs most pictures with a fake artist signature. Non-commercial licence. |
| Stable Diffusion 3.5 Large | works | 2 min 34 s | 1 min 46 s | 2 min 36 s | 26.6 GB | 20 | A dramatic forge, but two and a half minutes a picture; portraits are close-up young humans rather than dwarves and the owlbear is a plain owl. |
| LongCat-Image | works | 2 min 37 s | 2 min 4 s | 1 min 47 s | 25.7 GB | 20 | Rich, detailed fantasy scenes and gear, but over two and a half minutes a picture; ignores the plain dark background, paints the owlbear as a feathered bear, and dwarves as tall humans. |
| HiDream-I1 Dev | works | 3 min 21 s | 2 min 31 s | 3 min 35 s | 55.2 GB | 28 | Much like Fast at nearly twice the time (over three minutes, 55 GB peak): human-looking dwarves, a fierce owlbear, a teal-lit forge. ComfyUI ran out of memory switching to it once. |
| Capybara | works | 3 min 22 s | 2 min 33 s | 2 min 28 s | 38.2 GB | 20 | A clean cartoon-game style with a fine owlbear and a busy forge, but over three minutes a picture; big elf ears on the dwarves. ComfyUI ran out of memory switching to it once. |
| Z-Image | works | 3 min 26 s | 2 min 31 s | 3 min 37 s | 18.3 GB | 25 | Good owlbear and scene, but three and a half minutes a picture with the int8 weights; one portrait came out as a framed print on a mat. |
| Ovis-Image | works | 3 min 27 s | 2 min 35 s | 3 min 33 s | 23.3 GB | 20 | Soft painterly pictures, but three and a half minutes each; dwarves come out as tall humans, the owlbear is a bear, and the forge has its adventurers but few anvils. |
| Qwen-Image 2512 | works | 5 min 10 s | 4 min 7 s | 5 min 46 s | 48.2 GB | 20 | The best forge scene measured (anvils, bridge, adventurers), but five minutes a picture and a 48 GB peak; portraits lean photographic with elf ears and the owlbear is mostly bear. |
| ERNIE-Image | works | 5 min 36 s | 4 min 3 s | 5 min 34 s | 34 GB | 20 | Pictures much like ERNIE-Image Turbo (a fine owlbear and forge) at five times the time, about five and a half minutes each; worth it only for the real negative prompt. |
| Chroma1-HD | works | 5 min 57 s | 4 min 33 s | 4 min 7 s | 20.7 GB | 26 | Decent painterly pictures with a real negative prompt, but about six minutes each (26 steps, two passes per step); dwarves get elf ears, one portrait came on a grey vignette. |
| Kandinsky 5.0 Image Lite | works | 7 min 41 s | 5 min 46 s | 7 min 52 s | 29.9 GB | 50 | The best owlbear measured and a fine forge, but nearly eight minutes a picture (50 steps); a portrait came with a garbled poster title painted across the top. |
| Chroma1-Radiance | works | 8 min 19 s | 6 min 9 s | 8 min 30 s | 23.8 GB | 30 | Polished game-art pictures, but over eight minutes each; the owlbear is a bear with a beak and dwarves get elf ears. |
| HiDream-I1 Full | works | 11 min 16 s | 8 min 20 s | 11 min 44 s | 55.4 GB | 50 | The best HiDream pictures (a true owlbear, a forge with anvil and bridge) but over eleven minutes each and a 55 GB peak; one portrait came as a round sticker on white. ComfyUI ran out of memory switching to it once. |
| NewBie Image Exp0.1 | poor | 1 min 55 s | 82 s | 1 min 54 s | 21.5 GB | 20 | Murky, mostly black pictures with small subjects (a toy-like owlbear, a cut-out forge); trained on XML anime captions, not plain prompts. Two minutes each. Non-commercial licence. |
| OmniGen2 | poor | 3 min 42 s | 2 min 40 s | 3 min 40 s | 29 GB | 20 | Blurry, dim pictures: a muddled owlbear and an empty, murky forge, nearly four minutes each. |
| Ideogram 4 | fails | - | - | - | - | 20 | Ideogram's built-in safety filter returned its 'Image blocked by safety filter' card for every ODM prompt, plain text or wrapped in its JSON caption format (Ideogram documents a high false-positive rate). Over four minutes per blocked card. |
| FLUX.2 dev | fails | - | - | - | - | 20 | Ran out of memory twice from a freshly restarted ComfyUI: the 35 GB model and 18 GB Mistral encoder do not fit beside this box's other services (about 40 GB, with swap full). |

FLUX.2 [klein] 9B is not measured: its weights are gated behind a licence the
reference machine's account has not accepted. "first picture" is the first after
ComfyUI loads the model; rows from ERNIE-Image on were measured with ComfyUI
restarted before each model, earlier rows after asking it to unload the last one.

### Measuring your own hardware

```bash
node scripts/bench-image-models.mjs                       # every installed model
node scripts/bench-image-models.mjs --models z_turbo,flux2_klein_4b
node scripts/bench-image-models.mjs --models all --download --comfy-dir ~/ComfyUI
```

Pictures and a contact sheet per model land in `/tmp/odm-image-bench` (or
`--out`) for review. `--write` records the rows in `verified.json`; a device
the app does not recognise yet needs a profile in `HARDWARE_PROFILES`
(`src/lib/image-models/curate.ts`) and `--hardware <id>`. `--steps`, `--cfg`,
`--files slot=name` and `--drop-patch <node>` try other settings without
writing anything. `--download` sends a Hugging Face token from `HF_TOKEN` or
`~/.cache/huggingface/token` for the gated repositories (FLUX.2 [klein] 9B).

## OpenAI

The one backend that needs no GPU at all. Pick **OpenAI** in the Images panel
and every picture (scene art, location maps, portraits) is made by OpenAI's
images API and saved alongside the rest. Renders bill to whichever key the
request finds, in this order:

1. the key in **Admin > Image generation**
2. `OPENAI_IMAGE_API_KEY`, then `OPENAI_API_KEY`
3. **the story's own OpenAI text key**, when that story's Text Model points at
   `api.openai.com`

That third rule is what makes a bring-your-own-key table work with one key
instead of two: the DM model and the pictures are two APIs on the same
account, so pasting the key once in the Text Model panel covers both. It is
gated on the host, so a key for llama.cpp, LM Studio or OpenRouter is never
sent to OpenAI. Keys stay server-side either way; the campaign's settings are
masked before they reach any player.

Pick the model in the admin panel, from the picture models the server lists
(or set `OPENAI_IMAGE_MODEL`); with none picked, no picture is asked for.
`OPENAI_IMAGE_BASE_URL` exists for OpenAI-compatible image proxies. The app's
fast/slow dial maps onto the quality tiers (`medium` and `high`), so **slow**
is several times the price of **fast**. A model that takes other tiers (a
dall-e model behind a proxy) is asked once more without the field, at its own
default, and a size it refuses is replaced by one from the list its refusal
names. Notes:

- Character portrait references are not used by this backend, same as ComfyUI;
  the picture comes from the text prompt alone.
- Nothing is probed: a backend with no key or no model simply records the
  request and the placeholder tells the table a picture is coming.
- Prompts go to OpenAI, so this is the one backend that is not on-device.
- A key that lives only in ONE campaign's Story AI panel (an admin's
  campaign: a player's campaign always runs on the server's keys) covers that
  campaign's own pictures: scene art, the story image tool, and location maps.
  Campaign covers and library portraits are painted from the server's default
  image settings, because a library character belongs to no campaign. Put the
  key in **Admin > Image generation** (or make OpenAI the server-wide text
  backend) and every picture on the server is covered.
- In the desktop and Android apps none of that applies: the key is saved once
  for the device on the app's **Story AI** screen, and it covers every
  picture in every campaign on that device, covers and portraits included.

## AMD GPUs

On supported Radeon cards the Windows launcher runs the FLUX backends
natively through AMD's official PyTorch-on-Windows (ROCm) wheels — no NVIDIA
hardware required. Supported by AMD's ROCm 7.2.x Windows release: RX 9070 XT,
RX 9070, RX 9060 XT, RX 7900 XTX, RX 7700, Radeon AI PRO R9700, and Radeon
PRO W7900. Requirements the launcher handles or checks for you:

- Python 3.12 (AMD's wheels only ship for 3.12; the launcher creates or
  rebuilds the image venv with it automatically)
- AMD Adrenalin 26.2.2 or newer graphics driver (install this yourself)

`Launch-Windows.bat` detects a supported Radeon automatically when no NVIDIA
GPU is present. Overrides: set `OPEN_DUNGEON_ROCM=0` to disable the AMD path,
or `OPEN_DUNGEON_ROCM=1` to try it on an unlisted Radeon (untested; expect
rough edges). AMD notes known convolution performance gaps on RX 9000-series
Windows drivers, so the VAE decode step may be slower than the raw
transformer — still enormously faster than the CPU fallback.

On Linux, install the ROCm build of PyTorch into `ultra-fast-image-gen`'s
venv instead (`pip install torch torchvision --index-url
https://download.pytorch.org/whl/rocm6.4`) and run with
`IMAGE_SERVER_DEVICE=cuda` — PyTorch's ROCm build exposes the CUDA device
API. AMD cards without official PyTorch support (RX 7800/7600, RX 6000
series and older) can use the ComfyUI backend above, or fall back to CPU.

## The story image tool

The narrator can call a `generate_image` function tool through the selected
text provider. The app turns that tool call into a request against the
selected image backend, using the current image settings for backend, mode,
and aspect ratio. Old or interrupted image requests show as
`Image tool requested` with a Generate button instead of pretending a job is
still running.
