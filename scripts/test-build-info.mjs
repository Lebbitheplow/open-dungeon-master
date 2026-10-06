// What is running (issue 102): the version label a build is given from
// git's description of it, how releases are compared, and what the newest
// release on GitHub means for this build.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { compareVersions, describeBuild, parseLatestRelease, updateStatus, REPOSITORY_URL } = await import("../src/lib/build-info.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const sha = "48a4a7e5c0ffee0123456789abcdef0123456789";
const facts = (describe, extra = {}) => ({ version: "0.24.6", describe, commit: sha, builtAt: "2026-10-05T12:00:00.000Z", ...extra });

test("the tagged release, clean, is the bare version", () => {
  const build = describeBuild(facts("v0.24.6-0-g48a4a7e5"));
  assert.equal(build.label, "0.24.6");
  assert.equal(build.release, true);
  assert.equal(build.shortCommit, "48a4a7e");
  assert.equal(build.commit, sha);
  assert.deepEqual([build.tag, build.ahead, build.dirty, build.known], ["v0.24.6", 0, false, true]);
});

test("commits past the tag and local changes are build metadata", () => {
  assert.equal(describeBuild(facts("v0.24.6-12-g1a2b3c4d")).label, "0.24.6+12.g1a2b3c4");
  const dirty = describeBuild(facts("v0.24.6-0-g48a4a7e5-dirty"));
  assert.equal(dirty.label, "0.24.6+g48a4a7e.dirty");
  assert.equal(dirty.release, false, "a modified tree is not the release, whatever the tag says");
  assert.equal(describeBuild(facts("v0.24.6-3-g1a2b3c4d-dirty")).label, "0.24.6+3.g1a2b3c4.dirty");
});

test("a version bumped past the last tag is not counted from that tag", () => {
  const build = describeBuild(facts("v0.24.5-7-g1a2b3c4d"));
  assert.equal(build.label, "0.24.6+g1a2b3c4", "seven past v0.24.5 says nothing true beside 0.24.6");
  assert.equal(build.release, false);
});

test("a tag with dashes in it, a bare commit, and no git at all", () => {
  assert.equal(describeBuild(facts("v0.25.0-rc.1-2-gabcdef12", { version: "0.25.0-rc.1" })).label, "0.25.0-rc.1+2.gabcdef1");
  const bare = describeBuild(facts("1a2b3c4d-dirty", { commit: "" }));
  assert.equal(bare.label, "0.24.6+g1a2b3c4.dirty");
  assert.equal(bare.commit, "1a2b3c4d");
  const none = describeBuild({ version: "0.24.6", describe: "", commit: "", builtAt: "" });
  assert.deepEqual([none.label, none.known, none.release, none.shortCommit], ["0.24.6", false, false, ""]);
  const told = describeBuild({ version: "0.24.6", describe: "", commit: sha, builtAt: "" });
  assert.equal(told.label, "0.24.6+g48a4a7e", "a commit passed in by hand is still shown");
});

test("versions compare by number, not by letter", () => {
  assert.ok(compareVersions("0.24.10", "0.24.9") > 0);
  assert.ok(compareVersions("v0.25.0", "0.24.99") > 0);
  assert.equal(compareVersions("0.24.6", "v0.24.6"), 0);
  assert.equal(compareVersions("0.24.6+3.gabc", "0.24.6"), 0);
  assert.ok(compareVersions("0.24", "0.24.1") < 0);
});

test("GitHub's latest release is read, and anything else is not a release", () => {
  const release = parseLatestRelease({ tag_name: "v0.24.7", html_url: `${REPOSITORY_URL}/releases/tag/v0.24.7`, published_at: "2026-10-06T10:00:00Z", name: "v0.24.7 - voices" });
  assert.deepEqual(release, { version: "0.24.7", url: `${REPOSITORY_URL}/releases/tag/v0.24.7`, publishedAt: "2026-10-06T10:00:00Z", name: "v0.24.7 - voices" });
  assert.equal(parseLatestRelease({ tag_name: "v0.25.0", prerelease: true }), null);
  assert.equal(parseLatestRelease({ tag_name: "v0.25.0", draft: true }), null);
  assert.equal(parseLatestRelease({ tag_name: "nightly" }), null);
  assert.equal(parseLatestRelease({ message: "API rate limit exceeded" }), null);
  assert.equal(parseLatestRelease(null), null);
  const elsewhere = parseLatestRelease({ tag_name: "v0.24.7", html_url: "https://example.org/phish" });
  assert.equal(elsewhere.url, `${REPOSITORY_URL}/releases/tag/v0.24.7`, "a link is only ever to this project's releases");
});

test("a build is behind, level with, or ahead of the newest release", () => {
  const latest = parseLatestRelease({ tag_name: "v0.24.7" });
  assert.equal(updateStatus({ version: "0.24.6" }, latest, "t").state, "available");
  assert.equal(updateStatus({ version: "0.24.7" }, latest, "t").state, "current");
  assert.equal(updateStatus({ version: "0.25.0" }, latest, "t").state, "ahead", "a development checkout is not out of date");
  assert.deepEqual(updateStatus({ version: "0.24.6" }, null, "t"), { state: "unknown", checkedAt: "t" });
});

console.log(`test-build-info: ${passed} passed`);
