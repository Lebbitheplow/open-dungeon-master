#!/usr/bin/env python3
"""Smoke-check Open Dungeon image-server backend routing without generating images."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
SERVER_PATH = ROOT / "image_server" / "optimized_image_server.py"


def load_server_module():
    spec = importlib.util.spec_from_file_location("optimized_image_server", SERVER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {SERVER_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def command_for(server, *, backend: str, device: str) -> list[str]:
    server.IMAGE_DEVICE = device
    command, _env = server.backend_command(
        backend=backend,
        prompt="routing smoke test",
        dimensions=server.Dimensions(width=512, height=512, aspect="square"),
        steps=12 if device != "mps" else 4,
        seed=1234,
        guidance=3.5 if device != "mps" else 0.0,
        output_path=Path("routing-smoke.png"),
        timeout=30,
        reference_paths=[],
    )
    return command


def main() -> int:
    server = load_server_module()

    cuda_command = command_for(server, backend="sdnq-hs", device="cuda")
    assert cuda_command[2] == "flux2-4b-sdnq", cuda_command
    assert cuda_command[cuda_command.index("--device") + 1] == "cuda", cuda_command
    assert "--qchunk" not in cuda_command, cuda_command
    assert not any(arg.startswith("--hs-") for arg in cuda_command), cuda_command
    assert "--gguf-quant" not in cuda_command, cuda_command

    cpu_command = command_for(server, backend="sdnq-hs", device="cpu")
    assert cpu_command[2] == "flux2-4b-sdnq", cpu_command
    assert cpu_command[cpu_command.index("--device") + 1] == "cpu", cpu_command

    mps_command = command_for(server, backend="sdnq-hs", device="mps")
    assert mps_command[2] == "flux2-4b-uncensored-sdnq-hs", mps_command
    assert "--qchunk" in mps_command, mps_command
    assert "--gguf-quant" in mps_command, mps_command

    original_platform = server.RUNTIME_PLATFORM
    try:
        server.RUNTIME_PLATFORM = "win32"
        server.IMAGE_DEVICE = "cuda"
        backend, warnings = server.normalize_backend("mflux-hs")
    finally:
        server.RUNTIME_PLATFORM = original_platform

    assert backend == "sdnq-hs", backend
    assert any("MFLUX/MLX is Apple Silicon only" in warning for warning in warnings), warnings
    assert any("HS path is MPS-only" in warning for warning in warnings), warnings

    print("image server routing checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
