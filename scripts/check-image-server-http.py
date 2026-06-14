#!/usr/bin/env python3
"""End-to-end image-server HTTP smoke using a fake ultra-fast-image-gen repo."""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)


def write_fake_generate(repo: Path) -> None:
    script = repo / "generate.py"
    script.write_text(
        """
from pathlib import Path
import json
import sys

png = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010804000000b51c0c020000000b4944415478da63fcff1f0003030200efbfa7db0000000049454e44ae426082"
)
args = sys.argv[1:]
output = Path("output.png")
if "--output" in args:
    output = Path(args[args.index("--output") + 1])
output.parent.mkdir(parents=True, exist_ok=True)
output.write_bytes(png)
(Path(__file__).resolve().parent / "last-command.json").write_text(json.dumps(args), encoding="utf-8")
print(f"fake generate wrote {output}")
""".lstrip(),
        encoding="utf-8",
    )


def wait_json(url: str, timeout_seconds: float) -> dict:
    deadline = time.time() + timeout_seconds
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            with urlopen(url, timeout=2) as response:
                return json.loads(response.read().decode("utf-8"))
        except (OSError, URLError) as error:
            last_error = error
            time.sleep(0.25)
    raise TimeoutError(f"Timed out waiting for {url}: {last_error}")


def post_json(url: str, payload: dict) -> dict:
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    temp_root = Path(tempfile.mkdtemp(prefix="open-dungeon-image-smoke-"))
    process: subprocess.Popen[str] | None = None
    try:
        fake_repo = temp_root / "ultra-fast-image-gen"
        fake_repo.mkdir()
        write_fake_generate(fake_repo)

        output_dir = temp_root / "generated"
        env = os.environ.copy()
        env.update(
            {
                "ULTRA_FAST_IMAGE_GEN_DIR": str(fake_repo),
                "ULTRA_FAST_IMAGE_GEN_PYTHON": sys.executable,
                "IMAGE_SERVER_OUTPUT_DIR": str(output_dir),
                "IMAGE_SERVER_PORT": "7876",
                "IMAGE_SERVER_DEVICE": "cuda",
                "IMAGE_SERVER_DEFAULT_BACKEND": "sdnq-hs",
                "IMAGE_SERVER_PLATFORM_OVERRIDE": "win32",
                "MFLUX_RESIDENT": "0",
            }
        )

        process = subprocess.Popen(
            [sys.executable, str(ROOT / "image_server" / "optimized_image_server.py")],
            cwd=str(ROOT),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )

        health = wait_json("http://127.0.0.1:7876/health", 10)
        assert health["device"] == "cuda", health
        assert health["defaultBackend"] == "sdnq-hs", health
        assert health["sdnqModel"] == "flux2-4b-sdnq", health

        result = post_json(
            "http://127.0.0.1:7876/generate",
            {
                "backend": "mflux-hs",
                "prompt": "fake smoke test",
                "mode": "fast",
                "aspect": "square",
                "width": 512,
                "height": 512,
                "steps": 4,
                "guidance": 0.0,
                "seed": 42,
            },
        )
        assert result["backend"] == "sdnq-hs", result
        assert result["steps"] == 12, result
        assert result["guidance"] == 3.5, result
        assert any("MFLUX/MLX is Apple Silicon only" in warning for warning in result["warnings"]), result
        assert any("HS path is MPS-only" in warning for warning in result["warnings"]), result

        image_path = output_dir / Path(result["url"]).name
        assert image_path.exists(), result
        assert image_path.read_bytes() == PNG_1X1, image_path

        command = json.loads((fake_repo / "last-command.json").read_text(encoding="utf-8"))
        assert command[0] == "flux2-4b-sdnq", command
        assert command[command.index("--device") + 1] == "cuda", command
        assert "--qchunk" not in command, command
        assert "--gguf-quant" not in command, command

        print("image server HTTP smoke passed")
        return 0
    finally:
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        shutil.rmtree(temp_root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
