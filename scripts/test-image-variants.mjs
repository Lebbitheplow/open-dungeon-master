// Smaller copies of generated and uploaded pictures: how a consumer asks
// for one (variantUrl), how the serve route reads the ask (variantWidth),
// how the sibling is named, how the route picks the file to stream
// without leaving its root, and that the WASM writer really writes them
// under plain Node, once, and never for a name it did not make.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import zlib from "node:zlib";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

register("./lib/register-alias.mjs", import.meta.url);

const { imageSize, isVariantFileName, sniffImage, variantFileName, variantUrl, variantWidth } = await import(
  "../src/lib/image-format.ts"
);
const { servedSegments, writeImageVariants } = await import("../src/lib/image-variants.ts");

const repo = path.resolve(import.meta.dirname, "..");
const samplePng = path.join(repo, "public", "assets", "themes", "default", "diffuse-dark.png");

// A PNG of random RGBA noise: incompressible, so it weighs what a piece of
// scene art weighs and every WebP copy comes out smaller.
function noisePng(width, height) {
  const crc = (bytes) => {
    let value = ~0;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
      }
    }
    return (~value) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(Buffer.concat([Buffer.from([0]), randomBytes(width * 4)]));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
}

await test("variantUrl adds ?w= only to the server's own pictures", () => {
  assert.equal(variantUrl("/generated/a.png", 256), "/generated/a.png?w=256");
  assert.equal(variantUrl("/uploads/b.jpg", 1024), "/uploads/b.jpg?w=1024");
  assert.equal(variantUrl("/generated/a.png?w=256", 1024), "/generated/a.png?w=256");
  assert.equal(variantUrl("/generated/a.png#x", 256), "/generated/a.png#x");
  for (const src of [
    "/assets/placeholders/x.webp",
    "data:image/png;base64,AAAA",
    "blob:https://localhost/1234",
    "https://example.com/generated/a.png",
    "generated/a.png",
    "",
  ]) {
    assert.equal(variantUrl(src, 256), src);
  }
});

await test("variantWidth accepts the two sizes the server writes and nothing else", () => {
  assert.equal(variantWidth("256"), 256);
  assert.equal(variantWidth("1024"), 1024);
  for (const value of ["512", "0", "-256", "abc", "", null, undefined, "256px", "1e3"]) {
    assert.equal(variantWidth(value), null, `w=${value}`);
  }
});

await test("variant names are the stem plus .w<size>.webp, and recognisable", () => {
  assert.equal(variantFileName("a.png", 256), "a.w256.webp");
  assert.equal(variantFileName("1789851467166-openai-map.png", 1024), "1789851467166-openai-map.w1024.webp");
  assert.equal(variantFileName("photo.JPEG", 256), "photo.w256.webp");
  assert.equal(variantFileName("noext", 256), "noext.w256.webp");
  assert.ok(isVariantFileName("a.w256.webp"));
  assert.ok(isVariantFileName("a.w1024.webp"));
  assert.ok(!isVariantFileName("a.webp"));
  assert.ok(!isVariantFileName("a.w512.webp"));
  assert.ok(!isVariantFileName("a.w256.png"));
});

await test("sniffImage and imageSize read PNG, JPEG and every WebP header shape", () => {
  const png = fs.readFileSync(samplePng);
  assert.equal(sniffImage(png)?.format, "png");
  assert.deepEqual(imageSize(png), { width: 1024, height: 1024 });
  assert.equal(sniffImage(Buffer.from("<svg onload=alert(1)>")), null);
  // A VP8L (lossless) header: 3x2 pixels.
  const lossless = Buffer.alloc(30);
  lossless.write("RIFF", 0, "ascii");
  lossless.write("WEBP", 8, "ascii");
  lossless.write("VP8L", 12, "ascii");
  lossless[20] = 0x2f;
  lossless.writeUInt32LE((3 - 1) | ((2 - 1) << 14), 21);
  assert.equal(sniffImage(lossless)?.format, "webp");
  assert.deepEqual(imageSize(lossless), { width: 3, height: 2 });
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-image-variants-"));
try {
  const generated = path.join(dir, "public", "generated");
  fs.mkdirSync(generated, { recursive: true });
  const original = path.join(generated, "sample.png");
  const noise = noisePng(1024, 768);
  fs.writeFileSync(original, noise);
  assert.deepEqual(imageSize(noise), { width: 1024, height: 768 });

  await test("the worker writes both WebP copies of a PNG, sized to the long edge", async () => {
    const first = await writeImageVariants(original);
    assert.equal(first.error, undefined);
    assert.deepEqual(first.written.map((file) => path.basename(file)).sort(), ["sample.w1024.webp", "sample.w256.webp"]);
    const small = fs.readFileSync(path.join(generated, "sample.w256.webp"));
    const large = fs.readFileSync(path.join(generated, "sample.w1024.webp"));
    assert.equal(sniffImage(small)?.format, "webp");
    assert.equal(sniffImage(large)?.format, "webp");
    assert.deepEqual(imageSize(small), { width: 256, height: 192 });
    // The sample is exactly 1024 wide, so the 1024 copy is a re-encode, not a resize.
    assert.deepEqual(imageSize(large), { width: 1024, height: 768 });
    assert.ok(small.length < large.length);
    assert.ok(large.length < noise.length);
    assert.ok(!fs.existsSync(path.join(generated, "sample.w256.webp.tmp-" + process.pid)));
  });

  await test("a same-size copy that would weigh more than the original is not written", async () => {
    // A flat 1024 px PNG (19 KB) encodes to a larger WebP: only the 256 copy is worth having.
    const flat = path.join(generated, "flat.png");
    fs.copyFileSync(samplePng, flat);
    const result = await writeImageVariants(flat);
    assert.equal(result.error, undefined);
    assert.deepEqual(result.written.map((file) => path.basename(file)), ["flat.w256.webp"]);
    assert.ok(!fs.existsSync(path.join(generated, "flat.w1024.webp")));
  });

  await test("a second pass writes nothing: the backfill can run any number of times", async () => {
    const before = fs.statSync(path.join(generated, "sample.w256.webp")).mtimeMs;
    const again = await writeImageVariants(original);
    assert.deepEqual(again.written, []);
    assert.equal(again.skipped.length, 2);
    assert.equal(fs.statSync(path.join(generated, "sample.w256.webp")).mtimeMs, before);
  });

  await test("a WebP original only gets the copies that are smaller than it", async () => {
    // 1024 px WebP (what a harness picture may be): a 256 copy, no 1024 one.
    const big = path.join(generated, "big.webp");
    fs.copyFileSync(path.join(generated, "sample.w1024.webp"), big);
    const result = await writeImageVariants(big);
    assert.equal(result.error, undefined);
    assert.deepEqual(result.written.map((file) => path.basename(file)), ["big.w256.webp"]);
    assert.deepEqual(imageSize(fs.readFileSync(path.join(generated, "big.w256.webp"))), { width: 256, height: 192 });
    assert.ok(!fs.existsSync(path.join(generated, "big.w1024.webp")));
    // 256 px WebP: nothing to write at all, and no worker is needed to know.
    const tiny = path.join(generated, "tiny.webp");
    fs.copyFileSync(path.join(generated, "sample.w256.webp"), tiny);
    const none = await writeImageVariants(tiny);
    assert.deepEqual(none, { written: [], skipped: [path.join(generated, "tiny.w256.webp"), path.join(generated, "tiny.w1024.webp")] });
  });

  await test("something that is not a picture is refused without a worker", async () => {
    const junk = path.join(generated, "junk.png");
    fs.writeFileSync(junk, "<svg onload=alert(1)>");
    const result = await writeImageVariants(junk);
    assert.match(result.error, /not a PNG/);
    assert.deepEqual(result.written, []);
    const missing = await writeImageVariants(path.join(generated, "nope.png"));
    assert.ok(missing.error);
  });

  // servedSegments reads under process.cwd()/public like the routes do.
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    await test("the route serves the variant when it exists and the original when not", async () => {
      assert.deepEqual(await servedSegments("generated", ["sample.png"], 256), ["sample.w256.webp"]);
      assert.deepEqual(await servedSegments("generated", ["sample.png"], 1024), ["sample.w1024.webp"]);
      assert.deepEqual(await servedSegments("generated", ["big.webp"], 256), ["big.w256.webp"]);
      assert.deepEqual(await servedSegments("generated", ["big.webp"], 1024), ["big.webp"]);
      assert.deepEqual(await servedSegments("generated", ["tiny.webp"], 256), ["tiny.webp"]);
      assert.deepEqual(await servedSegments("generated", ["tiny.webp"], 1024), ["tiny.webp"]);
      assert.deepEqual(await servedSegments("generated", ["junk.png"], 256), ["junk.png"]);
      assert.deepEqual(await servedSegments("uploads", ["sample.png"], 256), ["sample.png"]);
    });

    await test("segments that would leave the root come back untouched for serve-file to refuse", async () => {
      fs.mkdirSync(path.join(dir, "public", "secret"));
      fs.writeFileSync(path.join(dir, "public", "secret", "key.w256.webp"), "x");
      for (const segments of [
        ["..", "secret", "key.png"],
        ["generated", "..", "..", "secret", "key.png"],
        [".", "sample.png"],
        [""],
        [],
      ]) {
        assert.deepEqual(await servedSegments("generated", segments, 256), segments);
      }
      // A nested name resolves to a sibling in the same folder, never elsewhere.
      fs.mkdirSync(path.join(generated, "deep"));
      fs.copyFileSync(original, path.join(generated, "deep", "x.png"));
      assert.deepEqual(await servedSegments("generated", ["deep", "x.png"], 256), ["deep", "x.png"]);
      fs.copyFileSync(path.join(generated, "sample.w256.webp"), path.join(generated, "deep", "x.w256.webp"));
      assert.deepEqual(await servedSegments("generated", ["deep", "x.png"], 256), ["deep", "x.w256.webp"]);
    });
  } finally {
    process.chdir(cwd);
  }
} finally {
  removeTempDir(dir);
}

console.log(`image variants: ${passed} tests passed`);
