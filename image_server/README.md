# Optimized Image Server

This folder is the Local Roleplay wrapper around the optimized uncensored
FLUX.2-klein backends from the `ultra-fast-image-gen` repo (expected at
`~/ultra-fast-image-gen`, or set `ULTRA_FAST_IMAGE_GEN_DIR`).

It does not reimplement the optimization logic. Requests are delegated through
`generate.py` to:

- `flux2-4b-uncensored-mflux-hs`
- `flux2-4b-uncensored-sdnq-hs`

Defaults are 1024x1024, 4 steps, guidance 0.0, square aspect, MFLUX HS backend.
Portrait uses 768x1024 and landscape uses 1024x768. The slow size is 2048
square, 1536x2048 portrait, or 2048x1536 landscape.

Reference images are limited to two per request. They can be any aspect ratio;
the local wrappers fit them inside the requested output canvas with padding
instead of stretching them. MFLUX resident mode is used for text-only requests;
reference requests run through the reference-capable CLI path.

MFLUX runs in resident mode by default. The HTTP server starts a long-lived
worker process under the patched MFLUX checkout (default
`~/.cache/ultra-fast-image-gen/mflux`, created by
`ultra-fast-image-gen/scripts/setup_mflux_hs.sh`; override with `MFLUX_DIR`),
loads `Flux2Klein` once, keeps the uncensored
GGUF text encoder alive after first prompt encoding, and sends later generations
over JSON-lines IPC.

Run:

```bash
npm run image:server
```

Health:

```bash
curl http://127.0.0.1:7869/health
```

Warm the default backend with a 512 smoke generation:

```bash
curl -X POST http://127.0.0.1:7869/warm \
  -H 'Content-Type: application/json' \
  -d '{"backend":"mflux-hs"}'
```

Health reports the resident PID and generation count:

```bash
curl http://127.0.0.1:7869/health
```
