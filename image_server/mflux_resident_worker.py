#!/usr/bin/env python3
"""Resident MFLUX/MLX uncensored HS worker.

This is launched with uv under the patched MFLUX checkout (see
ultra-fast-image-gen/scripts/setup_mflux_hs.sh; default
~/.cache/ultra-fast-image-gen/mflux). It keeps Flux2Klein and the
uncensored GGUF text encoder alive across requests.
"""

from __future__ import annotations

import contextlib
import gc
import json
import os
from pathlib import Path
import resource
import sys
import time
import traceback
from typing import Any


def configure_env() -> None:
    os.environ.setdefault("MFLUX_DISABLE_COMPILE", "1")
    os.environ.setdefault("MFLUX_UNCENSORED_GGUF_TE", "1")
    os.environ.setdefault("MFLUX_SKIP_STOCK_TEXT_ENCODER", "1")
    os.environ.setdefault("MFLUX_UNCENSORED_GGUF_VARIANT", "4b")
    os.environ.setdefault("MFLUX_UNCENSORED_GGUF_QUANT", "q4_k_m")
    os.environ.setdefault("MFLUX_UNCENSORED_GGUF_DEVICE", "mps")
    os.environ.setdefault(
        "MFLUX_UNCENSORED_GGUF_REPO_ROOT",
        os.path.expanduser(
            os.environ.get(
                "ULTRA_FAST_IMAGE_GEN_DIR", str(Path.home() / "ultra-fast-image-gen")
            )
        ),
    )
    os.environ.setdefault("MFLUX_HS_STRIDE", "2")
    os.environ.setdefault("MFLUX_HS_SKIP_TRANSFORMER_FORWARDS", "0")
    os.environ.setdefault("MFLUX_HS_MAX_TRANSFORMER_FORWARD", "3")
    os.environ.setdefault("MFLUX_HS_SINGLE_START_FRAC", "0.0")
    os.environ.setdefault("MFLUX_HS_SINGLE_END_FRAC", "1.0")


configure_env()

with contextlib.redirect_stdout(sys.stderr):
    import mlx.core as mx
    from mflux.models.common.config import ModelConfig
    from mflux.models.flux2.model.flux2_text_encoder.uncensored_gguf_prompt_encoder import (
        encode_uncensored_gguf_prompt,
    )
    from mflux.models.flux2.model.flux2_transformer import single_transformer_block
    from mflux.models.flux2.model.flux2_transformer import transformer as flux2_transformer
    from mflux.models.flux2.variants import Flux2Klein, Flux2KleinEdit
    from mflux.models.flux2.variants.edit.flux2_klein_edit_helpers import (
        _Flux2KleinEditHelpers,
    )


TXT2IMG_MODEL = None
EDIT_MODEL = None
TXT2IMG_MODEL_KEY = None
EDIT_MODEL_KEY = None
TXT2IMG_LOAD_SECONDS = None
EDIT_LOAD_SECONDS = None
GENERATIONS = 0
CACHE_LIMIT_GB = float(os.environ.get("MFLUX_RESIDENT_MLX_CACHE_LIMIT_GB", "8"))
SINGLE_MODEL = os.environ.get("MFLUX_RESIDENT_SINGLE_MODEL", "1") not in ("", "0", "false", "False")


def rss_gb() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1_000_000_000


def mlx_gb(getter_name: str, default: float = 0.0) -> float:
    getter = getattr(mx, getter_name, None)
    if not callable(getter):
        return default
    return float(getter()) / 1_000_000_000


def memory_stats() -> dict[str, float]:
    return {
        "maxRssGb": round(rss_gb(), 2),
        "mlxActiveGb": round(mlx_gb("get_active_memory"), 2),
        "mlxCacheGb": round(mlx_gb("get_cache_memory"), 2),
        "mlxPeakGb": round(mlx_gb("get_peak_memory"), 2),
    }


def configure_mlx_memory() -> None:
    cache_limit = int(CACHE_LIMIT_GB * 1_000_000_000)
    mx.set_cache_limit(cache_limit)
    clear_mlx_cache()


def clear_mlx_cache() -> None:
    mx.clear_cache()


configure_mlx_memory()


def install_uncensored_edit_encoder_patch() -> None:
    original_encode_text = _Flux2KleinEditHelpers.encode_text

    def encode_text(prompt: str, *, tokenizer, text_encoder):
        if os.environ.get("MFLUX_UNCENSORED_GGUF_TE", "0") not in ("", "0", "false", "False"):
            return encode_uncensored_gguf_prompt(
                prompt=prompt,
                max_sequence_length=512,
                hidden_state_layers=(9, 18, 27),
            )
        return original_encode_text(prompt, tokenizer=tokenizer, text_encoder=text_encoder)

    _Flux2KleinEditHelpers.encode_text = staticmethod(encode_text)


install_uncensored_edit_encoder_patch()


def release_model(kind: str) -> None:
    global TXT2IMG_MODEL, EDIT_MODEL, TXT2IMG_MODEL_KEY, EDIT_MODEL_KEY
    if kind == "txt2img":
        TXT2IMG_MODEL = None
        TXT2IMG_MODEL_KEY = None
    elif kind == "edit":
        EDIT_MODEL = None
        EDIT_MODEL_KEY = None
    gc.collect()
    clear_mlx_cache()


def active_model_names() -> list[str]:
    names = []
    if TXT2IMG_MODEL is not None:
        names.append("txt2img")
    if EDIT_MODEL is not None:
        names.append("edit")
    return names


def configure_hs_for_generation(*, steps: int, image_paths: list[Path]) -> dict[str, int]:
    # The current HS compression assumes one square image-token grid after text tokens.
    # FLUX.2 edit concatenates generated-image and reference-image tokens, and portrait
    # refs can accidentally look like a square sequence, which corrupts the output.
    hs_stride = 1 if image_paths else 2
    hs_max_forward = 0 if image_paths else max(0, steps - 1)

    os.environ["MFLUX_HS_STRIDE"] = str(hs_stride)
    os.environ["MFLUX_HS_MAX_TRANSFORMER_FORWARD"] = str(hs_max_forward)
    single_transformer_block.MFLUX_HS_STRIDE = hs_stride
    single_transformer_block.MFLUX_HS_MAX_TRANSFORMER_FORWARD = hs_max_forward
    flux2_transformer.MFLUX_HS_MAX_TRANSFORMER_FORWARD = hs_max_forward
    return {"hsStride": hs_stride, "hsMaxTransformerForward": hs_max_forward}


def configure_uncensored_text_encoder(*, gguf_variant: str) -> None:
    os.environ["MFLUX_UNCENSORED_GGUF_VARIANT"] = gguf_variant
    os.environ["MFLUX_UNCENSORED_GGUF_QUANT"] = "q4_k_m"
    os.environ["MFLUX_UNCENSORED_GGUF_DEVICE"] = "mps"
    os.environ["MFLUX_SKIP_STOCK_TEXT_ENCODER"] = "1"
    if gguf_variant == "9b":
        os.environ["MFLUX_UNCENSORED_GGUF_REPO"] = "ponpoke/flux2-klein-9b-uncensored-text-encoder"
        os.environ["MFLUX_UNCENSORED_GGUF_SUBDIR"] = ""
        os.environ["MFLUX_UNCENSORED_GGUF_FILENAME"] = "flux2-klein-9b-uncensored-q4_k_m.gguf"
    else:
        os.environ["MFLUX_UNCENSORED_GGUF_REPO"] = "ponpoke/flux2-klein-4b-uncensored-text-encoder"
        os.environ["MFLUX_UNCENSORED_GGUF_SUBDIR"] = "flux2-klein-4b-uncensored-text-encoder"
        os.environ["MFLUX_UNCENSORED_GGUF_FILENAME"] = "flux2-klein-4b-uncensored-q4_k_m.gguf"


def load_txt2img_model(*, model_name: str, gguf_variant: str) -> None:
    global TXT2IMG_MODEL, TXT2IMG_LOAD_SECONDS, TXT2IMG_MODEL_KEY
    model_key = (model_name, gguf_variant)
    if TXT2IMG_MODEL is not None and TXT2IMG_MODEL_KEY == model_key:
        return
    if TXT2IMG_MODEL is not None:
        release_model("txt2img")
    if SINGLE_MODEL and EDIT_MODEL is not None:
        release_model("edit")

    configure_uncensored_text_encoder(gguf_variant=gguf_variant)
    start = time.time()
    with contextlib.redirect_stdout(sys.stderr):
        TXT2IMG_MODEL = Flux2Klein(
            model_config=ModelConfig.from_name(model_name=model_name),
            quantize=4,
        )
        mx.eval(TXT2IMG_MODEL.parameters())
        clear_mlx_cache()
    TXT2IMG_LOAD_SECONDS = time.time() - start
    TXT2IMG_MODEL_KEY = model_key
    print(
        f"[mflux-resident] loaded txt2img {model_name}/{gguf_variant} model in {TXT2IMG_LOAD_SECONDS:.2f}s, memory={memory_stats()}",
        file=sys.stderr,
        flush=True,
    )


def load_edit_model(*, model_name: str, gguf_variant: str) -> None:
    global EDIT_MODEL, EDIT_LOAD_SECONDS, EDIT_MODEL_KEY
    model_key = (model_name, gguf_variant)
    if EDIT_MODEL is not None and EDIT_MODEL_KEY == model_key:
        return
    if EDIT_MODEL is not None:
        release_model("edit")
    if SINGLE_MODEL and TXT2IMG_MODEL is not None:
        release_model("txt2img")

    configure_uncensored_text_encoder(gguf_variant=gguf_variant)
    start = time.time()
    with contextlib.redirect_stdout(sys.stderr):
        EDIT_MODEL = Flux2KleinEdit(
            model_config=ModelConfig.from_name(model_name=model_name),
            quantize=4,
        )
        mx.eval(EDIT_MODEL.parameters())
        clear_mlx_cache()
    EDIT_LOAD_SECONDS = time.time() - start
    EDIT_MODEL_KEY = model_key
    print(
        f"[mflux-resident] loaded edit {model_name}/{gguf_variant} model in {EDIT_LOAD_SECONDS:.2f}s, memory={memory_stats()}",
        file=sys.stderr,
        flush=True,
    )


def generate(payload: dict[str, Any]) -> dict[str, Any]:
    global GENERATIONS
    prompt = str(payload["prompt"])
    width = int(payload.get("width") or 1024)
    height = int(payload.get("height") or 1024)
    steps = int(payload.get("steps") or 4)
    seed = int(payload.get("seed") or 1234)
    # FLUX.2 klein distilled path expects guidance 1.0 in MFLUX API terms.
    guidance = float(payload.get("mfluxGuidance", 1.0) or 1.0)
    output_path = Path(payload["output_path"])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image_paths = [Path(path) for path in payload.get("image_paths") or []][:2]
    model_name = str(payload.get("mflux_model") or "flux2-klein-4b")
    gguf_variant = str(payload.get("gguf_variant") or "4b")
    configure_uncensored_text_encoder(gguf_variant=gguf_variant)

    hs_config = configure_hs_for_generation(steps=steps, image_paths=image_paths)
    if image_paths:
        load_edit_model(model_name=model_name, gguf_variant=gguf_variant)
        model = EDIT_MODEL
        load_seconds = EDIT_LOAD_SECONDS
        generation_kind = "edit"
    else:
        load_txt2img_model(model_name=model_name, gguf_variant=gguf_variant)
        model = TXT2IMG_MODEL
        load_seconds = TXT2IMG_LOAD_SECONDS
        generation_kind = "txt2img"
    assert model is not None

    start = time.time()
    with contextlib.redirect_stdout(sys.stderr):
        if image_paths:
            image = model.generate_image(
                seed=seed,
                prompt=prompt,
                width=width,
                height=height,
                guidance=guidance,
                image_paths=image_paths,
                num_inference_steps=steps,
                scheduler="flow_match_euler_discrete",
            )
        else:
            image = model.generate_image(
                seed=seed,
                prompt=prompt,
                width=width,
                height=height,
                guidance=guidance,
                num_inference_steps=steps,
                scheduler="flow_match_euler_discrete",
            )
        image.save(path=output_path, overwrite=True)
        generation_time = getattr(image, "generation_time", None)
        del image
        mx.eval(model.parameters())
        clear_mlx_cache()
    elapsed = time.time() - start
    GENERATIONS += 1
    return {
        "output_path": str(output_path),
        "elapsedSeconds": round(elapsed, 2),
        "generationTime": generation_time,
        "loadSeconds": round(load_seconds or 0, 2),
        "generations": GENERATIONS,
        "cacheLimitGb": CACHE_LIMIT_GB,
        "singleModel": SINGLE_MODEL,
        "generationKind": generation_kind,
        "mfluxModel": model_name,
        "ggufVariant": gguf_variant,
        "referenceCount": len(image_paths),
        "activeModels": active_model_names(),
        **hs_config,
        **memory_stats(),
    }


def handle(payload: dict[str, Any]) -> dict[str, Any]:
    action = payload.get("action")
    if action == "load":
        model_name = str(payload.get("mflux_model") or "flux2-klein-4b")
        gguf_variant = str(payload.get("gguf_variant") or "4b")
        load_txt2img_model(model_name=model_name, gguf_variant=gguf_variant)
        return {
            "loaded": True,
            "loadSeconds": round(TXT2IMG_LOAD_SECONDS or 0, 2),
            "generations": GENERATIONS,
            "cacheLimitGb": CACHE_LIMIT_GB,
            "singleModel": SINGLE_MODEL,
            "mfluxModel": model_name,
            "ggufVariant": gguf_variant,
            "activeModels": active_model_names(),
            **memory_stats(),
        }
    if action == "generate":
        return generate(payload)
    raise ValueError(f"unknown action: {action}")


def main() -> int:
    print("[mflux-resident] ready", file=sys.stderr, flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        request_id = None
        try:
            payload = json.loads(line)
            request_id = payload.get("id")
            result = handle(payload)
            response = {"id": request_id, "ok": True, **result}
        except Exception as error:
            response = {
                "id": request_id,
                "ok": False,
                "error": str(error),
                "traceback": traceback.format_exc()[-4000:],
            }

        print(json.dumps(response), flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
