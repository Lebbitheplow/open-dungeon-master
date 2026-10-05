# Setting up pictures, narration and dictation

All three are optional. The game plays in text without any of them, and each
one fails soft: a missing picture shows a placeholder, a passage that could not
be read aloud says why at the table. Set up only what you want.

Everything here is done once by the server's admin, in **Admin** (the account
menu, top right). Players never touch it.

| You want | Easiest route | Needs |
|---|---|---|
| Pictures (portraits, scene art, maps) | ComfyUI on the same machine | a GPU, a checkpoint file |
| Pictures with no GPU | an OpenAI key | an OpenAI account (paid per picture) |
| Narration read aloud | Kokoro-FastAPI in Docker | Docker; a GPU is optional |
| Narration with no local service | an OpenAI key | an OpenAI account (paid per passage) |
| Dictation and push-to-talk | the built-in engine | a 76 MB download, nothing else |

## Pictures with ComfyUI

1. **Install ComfyUI.** Follow the install for your system in the
   [ComfyUI README](https://github.com/comfyanonymous/ComfyUI#installing). The
   desktop installer and the portable Windows build both work; so does a
   manual install:

   ```bash
   git clone https://github.com/comfyanonymous/ComfyUI
   cd ComfyUI
   python -m venv venv && source venv/bin/activate
   pip install -r requirements.txt
   ```

   Install the PyTorch build for your GPU first if the ComfyUI README says to.

2. **Give it a checkpoint.** Put one checkpoint file (`.safetensors`) in
   `ComfyUI/models/checkpoints/`. Any checkpoint works; an SDXL-class one suits
   the sizes the game asks for (1024 to 1344 on the long side). The campaign's
   genre supplies the art style, so a general-purpose checkpoint is the right
   pick.

3. **Start it.**

   ```bash
   python main.py --listen 127.0.0.1 --port 8188
   ```

   Open `http://127.0.0.1:8188` in a browser to confirm it is up. If Open
   Dungeon Master runs in Docker, or on another machine, start ComfyUI with
   `--listen 0.0.0.0` so it can be reached from outside its own machine.

4. **Point the server at it.** In **Admin > Image generation**:
   - **Default backend**: ComfyUI (local)
   - **Server URL**: `http://127.0.0.1:8188` (in Docker:
     `http://host.docker.internal:8188`, which is the compose file's default)
   - **Checkpoint (model file)**: pick yours from the list, or leave it on
     Auto to use the first one

   Save. New characters get a portrait, scenes get art, and fights get a
   painted map.

Things to know:

- Pictures and narration share one queue and run one at a time. On a machine
  where the DM model and the image model share memory, that is what keeps a
  picture from stalling a turn.
- ComfyUI must be running whenever you want pictures. Nothing breaks when it is
  not; the placeholder has a Generate button that works once it is back.
- The other backends (the FLUX worker, OpenAI) are covered in
  [image-generation.md](image-generation.md).

## Pictures with an OpenAI key (no GPU)

In **Admin > Image generation** choose **OpenAI-compatible images API** as the default backend and
paste a key. If the story's text model already runs on OpenAI, the same key
covers pictures and you can leave the field empty. Each picture is billed to
that key.

## Narration (text to speech)

### Kokoro-FastAPI, the default

1. **Start the service.** With Docker:

   ```bash
   # CPU
   docker run -d --name kokoro -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
   # NVIDIA GPU
   docker run -d --name kokoro --gpus all -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-gpu:latest
   ```

   Other ways to run it are in the
   [Kokoro-FastAPI README](https://github.com/remsky/Kokoro-FastAPI). The first
   start downloads the voice model.

2. **Point the server at it.** In **Admin > Speech**, under **Narration (text
   to speech)**:
   - **Narration server**: Kokoro-FastAPI (local)
   - **Kokoro server URL**: `http://127.0.0.1:8880` (in Docker:
     `http://host.docker.internal:8880`, the compose file's default)

   Press **Test narration**. It speaks one line through the settings as
   typed, saved or not, and tells you what went wrong if it could not.

3. **Pick a voice.** Each campaign chooses its narrator in its own settings,
   from the voices the service lists. Players mute, replay and set the volume
   for themselves.

### Any OpenAI-compatible speech server

Anything that answers OpenAI's `/v1/audio/speech` works: OpenAI itself, or a
local server such as Speaches or openedai-speech. In **Admin > Speech**:

- **Narration server**: OpenAI-compatible server
- **Server base URL**: the server's `/v1` address
  (`https://api.openai.com/v1` for OpenAI)
- **Model name**: the model to ask for (`gpt-4o-mini-tts` on OpenAI)
- **API key**: the server's key. On OpenAI itself, empty falls back to the key
  saved for pictures
- **Default voice**: used when a campaign names a voice this server lacks

Press **Test narration** before you save. Campaigns pick from the voices the server
lists, or type a custom one.

### No narration

Set **Narration server** to **Off: no narration on this server**. The speaker buttons leave the table.

## Dictation and push-to-talk (speech to text)

**The built-in engine is the easy route.** In **Admin > Speech**, under
**Dictation (speech to text)**, press the install button on **Built-in speech
recognition**. It downloads Whisper once (76 MB) and runs it inside the server
on the CPU. No separate service, and nothing leaves the machine.

A separate Whisper service is only worth it for a bigger model or a GPU. Any
server that answers `/v1/audio/transcriptions` works (faster-whisper-server,
Speaches). Enter its address as **Whisper STT URL**; when it answers, it is
used ahead of the built-in engine.

With neither, a saved OpenAI key is used, and after that the browser's or the
phone's own speech recognition.

## In Docker

Inside a container `127.0.0.1` is the container itself, so the compose file
points every service at `host.docker.internal` instead. Two things follow:

- Start ComfyUI, Kokoro and any Whisper service so they listen beyond
  loopback (`--listen 0.0.0.0` for ComfyUI; the Docker commands above already
  publish Kokoro's port).
- If you type an address into Admin, use `host.docker.internal`, not
  `127.0.0.1`.

## When it does not work

- **No pictures, only placeholders.** Open the ComfyUI address in a browser
  from the machine the server runs on. If it does not load there, the server
  cannot reach it either. Then check that the checkpoint list in **Admin >
  Image generation** is not empty.
- **A passage is not read aloud.** The table shows the reason on the message
  and above the composer. **Test narration** in **Admin > Speech** repeats the same call
  on demand.
- **The dictation button is missing.** No engine is available: install the
  built-in one.

Every setting here also has an environment variable, listed in
[configuration.md](configuration.md). A value saved in Admin wins over the
environment.
