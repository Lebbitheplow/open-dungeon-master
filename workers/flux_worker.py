#!/usr/bin/env python3
"""Warm local FLUX.2-klein worker for Local Roleplay.

Run with the ultra-fast-image-gen virtualenv:
  ~/ultra-fast-image-gen/.venv/bin/python workers/flux_worker.py

Set FLUX_REPO if ultra-fast-image-gen lives somewhere else.
"""

from __future__ import annotations

import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import random
import sys
import threading
import time
from typing import Any
from urllib.parse import urlparse


APP_ROOT = Path(__file__).resolve().parents[1]
FLUX_REPO = Path(
    os.environ.get("FLUX_REPO", str(Path.home() / "ultra-fast-image-gen"))
).expanduser()
OUT_DIR = APP_ROOT / "public" / "generated"

os.environ.setdefault("QCHUNK", "1024")
os.environ.setdefault("KV_STRIDE", "1")
os.environ.setdefault("KV_KEEP_TILE_FRAC", "0.0")
os.environ.setdefault("KV_VALUE_MODE", "mean")

sys.path.insert(0, str(FLUX_REPO))

import torch  # noqa: E402
import mps_chunked_attn  # noqa: E402
from loaders import load_flux2_klein_uncensored_pipeline  # noqa: E402
from PIL import Image  # noqa: E402


PATCH_CFG = mps_chunked_attn.patch()
RUNTIME_LOCK = threading.Lock()

current_transformer_call = {"index": None}
current_hs = {
    "stride": 1,
    "skip_forwards": 0,
    "max_forwards": 999,
    "single_start_frac": 0.0,
    "single_end_frac": 1.0,
}


def sync() -> None:
    if torch.backends.mps.is_available():
        torch.mps.synchronize()


def perfect_square(n: int) -> int | None:
    if n <= 0:
        return None
    side = int(n**0.5)
    return side if side * side == n else None


def infer_text_and_side(seq_len: int) -> tuple[int | None, int | None]:
    for text_len in (512, 256, 1024, 0):
        side = perfect_square(seq_len - text_len)
        if side is not None:
            return text_len, side

    for text_len in range(0, min(2048, seq_len) + 1):
        side = perfect_square(seq_len - text_len)
        if side is not None:
            return text_len, side

    return None, None


def in_frac_window(index: int, total: int, start_frac: float, end_frac: float) -> bool:
    start = int(total * start_frac)
    end = int(total * end_frac)
    return start <= index < max(start + 1, end)


def hs_active(kind: str, index: int, total: int) -> bool:
    call_index = current_transformer_call["index"]
    stride = int(current_hs["stride"])
    if stride <= 1 or kind != "single":
        return False
    if call_index is None:
        return False
    if call_index < int(current_hs["skip_forwards"]) or call_index >= int(current_hs["max_forwards"]):
        return False
    return in_frac_window(
        index,
        total,
        float(current_hs["single_start_frac"]),
        float(current_hs["single_end_frac"]),
    )


def downsample_image_tokens(img: torch.Tensor, side: int, stride: int) -> torch.Tensor:
    bsz, _, dim = img.shape
    low_side = side // stride
    grid = img.reshape(bsz, side, side, dim)
    low = grid.reshape(bsz, low_side, stride, low_side, stride, dim).mean(dim=(2, 4))
    return low.reshape(bsz, low_side * low_side, dim)


def upsample_image_tokens(img_low: torch.Tensor, side: int, stride: int) -> torch.Tensor:
    bsz, _, dim = img_low.shape
    low_side = side // stride
    grid = img_low.reshape(bsz, low_side, low_side, dim)
    up = grid.repeat_interleave(stride, dim=1).repeat_interleave(stride, dim=2)
    return up.reshape(bsz, side * side, dim)


def reduced_rotary_emb(image_rotary_emb: Any, text_len: int, side: int, stride: int) -> Any:
    if image_rotary_emb is None:
        return None

    low_side = side // stride
    yy = torch.arange(low_side, device=image_rotary_emb[0].device) * stride + stride // 2
    xx = torch.arange(low_side, device=image_rotary_emb[0].device) * stride + stride // 2
    grid_y, grid_x = torch.meshgrid(yy, xx, indexing="ij")
    image_idx = (grid_y * side + grid_x).flatten()

    reduced = []
    for emb in image_rotary_emb:
        text_emb = emb[:text_len]
        img_emb = emb[text_len:].index_select(0, image_idx)
        reduced.append(torch.cat([text_emb, img_emb], dim=0))
    return tuple(reduced)


def run_hidden_compressed_single_block(orig: Any, args: tuple[Any, ...], kwargs: dict[str, Any], index: int, total: int):
    if not hs_active("single", index, total):
        return orig(*args, **kwargs)
    if args or kwargs.get("encoder_hidden_states", None) is not None:
        return orig(*args, **kwargs)

    hidden_states = kwargs.get("hidden_states")
    if hidden_states is None:
        return orig(*args, **kwargs)

    text_len, side = infer_text_and_side(hidden_states.shape[1])
    stride = int(current_hs["stride"])
    if text_len is None or side is None or side % stride != 0:
        return orig(*args, **kwargs)

    text, img = hidden_states[:, :text_len], hidden_states[:, text_len:]
    img_low = downsample_image_tokens(img, side, stride)
    reduced_hidden = torch.cat([text, img_low], dim=1)

    reduced_kwargs = dict(kwargs)
    reduced_kwargs["hidden_states"] = reduced_hidden
    reduced_kwargs["image_rotary_emb"] = reduced_rotary_emb(
        kwargs.get("image_rotary_emb"), text_len, side, stride
    )

    out = orig(**reduced_kwargs)
    out_text, out_img_low = out[:, :text_len], out[:, text_len:]
    img_delta_low = out_img_low - img_low
    restored_img = img + upsample_image_tokens(img_delta_low, side, stride)
    return torch.cat([out_text, restored_img], dim=1)


def install_block_policy(transformer: Any) -> None:
    if getattr(transformer, "_local_roleplay_policy_installed", False):
        return

    for kind, blocks in (
        ("double", transformer.transformer_blocks),
        ("single", transformer.single_transformer_blocks),
    ):
        total = len(blocks)
        for index, block in enumerate(blocks):
            orig = block.forward

            def wrapped(*args, _orig=orig, _kind=kind, _index=index, _total=total, **kwargs):
                if _kind == "single":
                    return run_hidden_compressed_single_block(_orig, args, kwargs, _index, _total)
                return _orig(*args, **kwargs)

            block.forward = wrapped

    transformer._local_roleplay_policy_installed = True


def time_method(obj: Any, method_name: str, label: str) -> None:
    if getattr(obj, f"_local_roleplay_timed_{method_name}", False):
        return

    orig = getattr(obj, method_name)

    def wrapped(*args, **kwargs):
        if label == "transformer":
            current_transformer_call["index"] = getattr(wrapped, "_count", 0)
        try:
            out = orig(*args, **kwargs)
            setattr(wrapped, "_count", getattr(wrapped, "_count", 0) + 1)
            return out
        finally:
            if label == "transformer":
                current_transformer_call["index"] = None

    setattr(obj, method_name, wrapped)
    setattr(obj, f"_local_roleplay_timed_{method_name}", True)


class FluxRuntime:
    def __init__(self) -> None:
        self.pipe = None

    def load(self):
        if self.pipe is not None:
            return self.pipe

        print(f"Loading local roleplay FLUX runtime from {FLUX_REPO}")
        print(f"Attention patch: {PATCH_CFG}")
        pipe = load_flux2_klein_uncensored_pipeline("mps", quant="q4_k_m")
        install_block_policy(pipe.transformer)
        time_method(pipe.transformer, "forward", "transformer")
        self.pipe = pipe
        return pipe

    def generate(self, payload: dict[str, Any]) -> dict[str, Any]:
        with RUNTIME_LOCK:
            return self._generate_locked(payload)

    def _generate_locked(self, payload: dict[str, Any]) -> dict[str, Any]:
        pipe = self.load()
        mode = payload.get("mode") if payload.get("mode") in ("fast", "slow") else "fast"
        aspect = payload.get("aspect") if payload.get("aspect") in ("square", "portrait", "landscape") else "portrait"
        width = int(payload.get("width") or (2048 if mode == "slow" else 1024))
        height = int(payload.get("height") or width)
        steps = int(payload.get("steps") or 4)
        seed = int(payload.get("seed") or random.randint(1, 2**31 - 1))
        prompt = str(payload.get("prompt") or "").strip()

        if not prompt:
            raise ValueError("prompt is required")

        current_hs.update(
            {
                "stride": 2 if mode == "slow" else int(os.environ.get("FAST_HS_STRIDE", "1")),
                "skip_forwards": 0,
                "max_forwards": 3 if mode == "slow" else steps,
                "single_start_frac": 0.0 if mode == "slow" else float(os.environ.get("FAST_HS_SINGLE_START_FRAC", "0.0")),
                "single_end_frac": 1.0,
            }
        )
        mps_chunked_attn.QCHUNK = 1024
        mps_chunked_attn.KV_STRIDE = 1
        mps_chunked_attn.reset_stats()

        references = decode_references(payload.get("references") or [], width, height)
        generator = torch.Generator("mps").manual_seed(seed)

        t0 = time.perf_counter()
        sync()
        with torch.inference_mode():
            if references:
                if hasattr(pipe.vae, "disable_tiling"):
                    pipe.vae.disable_tiling()
                image = pipe(
                    prompt=prompt,
                    image=references if len(references) > 1 else references[0],
                    height=height,
                    width=width,
                    num_inference_steps=steps,
                    guidance_scale=0.0,
                    generator=generator,
                ).images[0]
                if hasattr(pipe.vae, "enable_tiling"):
                    pipe.vae.enable_tiling()
            else:
                image = pipe(
                    prompt=prompt,
                    height=height,
                    width=width,
                    num_inference_steps=steps,
                    guidance_scale=0.0,
                    generator=generator,
                ).images[0]
        sync()
        elapsed = time.perf_counter() - t0

        OUT_DIR.mkdir(parents=True, exist_ok=True)
        image_id = f"{int(time.time())}-{random.randrange(100000, 999999)}"
        filename = f"{image_id}.png"
        image.save(OUT_DIR / filename)

        return {
            "id": image_id,
            "url": f"/generated/{filename}",
            "prompt": prompt,
            "mode": mode,
            "aspect": aspect,
            "width": width,
            "height": height,
            "elapsedSeconds": round(elapsed, 2),
            "seed": seed,
            "attention": mps_chunked_attn.get_stats(),
        }


def decode_references(references: list[dict[str, Any]], width: int, height: int) -> list[Image.Image]:
    images: list[Image.Image] = []
    for reference in references[:6]:
        data_url = reference.get("dataUrl")
        if not data_url or "," not in data_url:
            continue
        _, encoded = data_url.split(",", 1)
        raw = base64.b64decode(encoded)
        image = Image.open(io.BytesIO(raw)).convert("RGB").resize((width, height), Image.Resampling.LANCZOS)
        images.append(image)
    return images


RUNTIME = FluxRuntime()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:
        if urlparse(self.path).path != "/health":
            self.respond_json({"error": "Not found"}, status=404)
            return
        self.respond_json({"ok": True, "loaded": RUNTIME.pipe is not None, "patch": PATCH_CFG})

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/generate":
            self.respond_json({"error": "Not found"}, status=404)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            result = RUNTIME.generate(payload)
            self.respond_json(result)
        except Exception as exc:  # noqa: BLE001
            print(f"generation failed: {exc}", file=sys.stderr)
            self.respond_json({"error": str(exc)}, status=500)

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[flux-worker] {fmt % args}")

    def respond_json(self, payload: dict[str, Any], status: int = 200) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "http://localhost:3000")
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    host = os.environ.get("FLUX_WORKER_HOST", "127.0.0.1")
    port = int(os.environ.get("FLUX_WORKER_PORT", "7869"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Local Roleplay FLUX worker listening on http://{host}:{port}")
    print("First generation will load the model; later generations reuse it.")
    server.serve_forever()


if __name__ == "__main__":
    main()
