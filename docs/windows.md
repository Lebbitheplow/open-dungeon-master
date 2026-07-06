# Windows guide

## Launching

Double-click `Launch-Windows.bat` in the repo root. The launcher checks
Node.js, installs app dependencies, builds Open Dungeon when needed, and
starts http://localhost:3000. If the app is already running, the same
launcher lets you open it, stop it, or restart it.

Ollama is optional: the launcher only installs, starts, or pulls the default
model if you type `Y` at the prompt. If you skip it, open **Text Model** in
the app and choose **Connect a server** for LM Studio, llama.cpp, OpenRouter,
a remote Ollama, or another OpenAI-compatible backend.

To stop the web app and image worker, double-click `windows\Stop-Windows.bat`;
it leaves Ollama running by default because you may use it for other apps.

## Image setup

Local image generation is optional. The launcher only sets up Git, Python,
and `ultra-fast-image-gen` if you type `Y` at the image prompt, so a missing
Python runtime will not block text play. When enabled it clones
`ultra-fast-image-gen` into `%USERPROFILE%\ultra-fast-image-gen`, creates
`.venv`, and installs the right PyTorch build for your GPU:

- **NVIDIA** (`nvidia-smi` present): CUDA wheels.
- **Supported AMD Radeon**: AMD's official PyTorch-on-Windows (ROCm) wheels —
  see [Image generation](image-generation.md#amd-gpus) for the supported-GPU
  list and driver requirements.
- **Anything else**: CPU wheels.

If GPU setup gives you trouble or you want the most compatible optional image
path, double-click `windows\Launch-Windows-CPU.bat` instead and opt into image
setup there. The image setup also fast-forwards an existing clean
`ultra-fast-image-gen` checkout, keeps the selected PyTorch wheel in place
while installing the rest of that repo's requirements, verifies the expected
`flux2-4b-sdnq` CLI route is still present, and reinstalls image dependencies
when `requirements.txt` changes.

To force CPU for an explicit image setup from PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -SetupImages -CpuOnly
```

## Tuning

On Windows, local text generation defaults to a safer 65K context window and
a 6 minute upstream timeout so a slow or wedged Ollama request returns
control to the app instead of leaving the UI spinning forever. Set
`LOCAL_TEXT_CONTEXT` or `LOCAL_TEXT_TIMEOUT_MS` in `.env.server` to tune
those limits.

## Proving the image path

To sanity-check image routing without downloading models or generating an
image:

```powershell
npm run check:image-routing
npm run check:image-server-http
```

To prove the real Windows image path, double-click
`windows\Launch-Windows-Image-Smoke.bat` (auto GPU when available) or
`windows\Launch-Windows-Image-Smoke-CPU.bat` (forced CPU). This performs a
real 512px FLUX generation, will download model weights the first time, and
writes a transcript to `logs/windows-image-smoke-*.log`. The image server
itself tees backend output to `logs/windows-image-server-*.log`, with the
latest path saved in `logs/windows-image-server-latest.txt`.

For the full proof loop, double-click `windows\Launch-Windows-Image-Loop.bat`;
it runs a fresh CPU smoke and, when a supported GPU is detected, a fresh GPU
smoke, switching the shared PyTorch venv wheel as needed and collecting
diagnostics after each success or failure.

## Diagnostics

If something hangs or GPU/CPU image generation fails, double-click
`windows\Diagnose-Windows.bat` to write a machine, GPU, Ollama, PyTorch,
image-worker, and recent-log snapshot to `logs/windows-diagnostics-*.txt`.

From PowerShell, the same checks are:

```powershell
npm run image:loop:windows
npm run image:smoke:windows
npm run image:smoke:windows:cuda
npm run image:smoke:windows:cpu
npm run windows:diagnose
npm run windows:stop
```
