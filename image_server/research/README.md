# Research Folder

This folder mirrors the active high-resolution notes from
`ultra-fast-image-gen/research`.

The runtime implementation still lives in the source repo:

```text
flux2_sdnq_hs.py          PyTorch SDNQ + exact MPS chunked attention + HS compression
mflux_hs_uncensored.py    External MFLUX/MLX + uncensored GGUF text encoder + HS compression
mps_chunked_attn.py       Exact query-chunked SDPA patch for MPS
run_mflux_hs_uncensored.py
```

Use these through:

```bash
.venv/bin/python generate.py flux2-4b-uncensored-mflux-hs "prompt" --width 2048 --height 2048 --steps 4
.venv/bin/python generate.py flux2-4b-uncensored-sdnq-hs "prompt" --width 2048 --height 2048 --steps 4
```

Known good targets:

- MFLUX/MLX HS + uncensored GGUF TE: 2048x2048, 4 steps, about 100s fresh-process wall.
- PyTorch SDNQ HS + exact chunked MPS attention: 2048x2048, 4 steps, about 110s wall.
- Query chunking is exact and prevents Metal/MPS SDPA hard crashes at 2K.
