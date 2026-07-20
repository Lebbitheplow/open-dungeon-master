# Image generation

Inline images are optional — text play works without any image setup. Image
requests made while no backend is available show a Generate button that
succeeds once one is up.

Three backends are exposed in the Images panel:

| Backend | Hardware | Models |
|---|---|---|
| MFLUX Mac | Apple Silicon (MLX) | FLUX.2-klein uncensored |
| SDNQ GPU/CPU | NVIDIA CUDA, supported AMD (ROCm), CPU | FLUX.2-klein |
| ComfyUI | anything ComfyUI runs on | your ComfyUI checkpoints |

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
**ComfyUI** as the Images backend and the app drives your instance directly —
no FLUX worker, no `ultra-fast-image-gen`, and it works on any hardware
ComfyUI supports.

1. Start ComfyUI (default `http://127.0.0.1:8188`).
2. In the Images panel, choose **ComfyUI**, confirm the server URL, and pick
   a checkpoint from the list (or leave it on **Auto** to use the first one).

The app submits a plain text-to-image workflow (positive/negative prompt,
KSampler at 25 steps, CFG 6) and saves the finished PNG alongside the other
generated images. Sizes clamp to a 1024/1344 long side, which suits
SDXL-class checkpoints. Notes:

- Character portrait references are not used by this backend; scenes with
  saved characters generate from the text prompt alone.
- Generations queue behind whatever else your ComfyUI instance is doing.
- Set `COMFYUI_URL` in `.env.local` to change the default server URL.

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
