// The roster portrait as it arrives (backlog F25): the card says "Painting
// portrait…" in words while it paints, a finished portrait is announced once
// and fades in only where motion is allowed, the toast never takes focus,
// and a failed painting says so with a way to try again.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const arrival = await import("../src/app/characters/portrait-arrival.ts");
const { PortraitToast, RosterPortraitSlot, RosterPortraitStatus } = await import("../src/app/characters/RosterPortrait.tsx");

// Line endings as git wrote them: a Windows checkout reads CRLF, and the
// multi-line patterns below are written with \n.
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const base = { id: "c1", name: "Thornwick", race: "hill_dwarf", class: "fighter" };
const painting = { ...base, portraitStatus: "generating", sheet: { portrait: null } };
const queued = { ...base, portraitStatus: "queued", sheet: { portrait: null } };
const painted = { ...base, portraitStatus: null, sheet: { portrait: { url: "/p/thornwick.webp" } } };
const failed = { ...base, portraitStatus: "failed", sheet: { portrait: null } };
const none = { ...base, portraitStatus: null, sheet: { portrait: null } };

const status = (character, extra = {}) =>
  renderToStaticMarkup(
    createElement(RosterPortraitStatus, { character, retrying: false, retryError: "", onRetry() {}, ...extra }),
  );
const statusText = (markup) => (markup.match(/<p role="status"[^>]*>(.*?)<\/p>/)?.[1] ?? null);

await test("a portrait's phase reads off its picture and the painter's status", () => {
  assert.equal(arrival.portraitPhase(painting), "painting");
  assert.equal(arrival.portraitPhase(queued), "painting");
  assert.equal(arrival.portraitPhase(painted), "painted");
  assert.equal(arrival.portraitPhase(failed), "failed");
  assert.equal(arrival.portraitPhase(none), "none");
});

await test("while it paints, the card says Painting portrait… as a polite status", () => {
  const markup = status(painting);
  const text = statusText(markup);
  assert.ok(text, `a status region: ${markup}`);
  assert.match(text, /Painting portrait…/, "the words are visible, not only a spinner");
  assert.match(text, /<span class="sr-only">Thornwick: <\/span>/, "a screen reader hears whose portrait");
  assert.doesNotMatch(markup, /aria-live="assertive"|role="alert"/, "polite, not an interruption");
  const slot = renderToStaticMarkup(createElement(RosterPortraitSlot, { character: painting, arriving: false, still: false }));
  assert.match(slot, /^<span aria-hidden="true"/, "the spinner is the picture of the words, hidden from a reader");
});

await test("the status region stays mounted and falls quiet once painted", () => {
  assert.equal(statusText(status(painted)), "", "painted: the region is there and empty, the toast speaks");
  assert.equal(statusText(status(none)), "", "no portrait: nothing to say");
});

await test("a failed painting says so in words, with a named Try again", () => {
  const markup = status(failed);
  assert.match(statusText(markup), /The portrait could not be painted\./);
  const button = markup.match(/<button[^>]*>.*?<\/button>/)?.[0] ?? "";
  assert.match(button, /aria-label="Paint Thornwick&#x27;s portrait again"/, `a named retry: ${markup}`);
  assert.match(button, /Try again/);
  assert.match(button, /min-h-10/, "a finger-sized target");
  assert.doesNotMatch(statusText(markup), /<button/, "the button sits outside the live region");
  const refused = status(failed, { retryError: "This server has no image model to paint with." });
  assert.match(refused, /<p role="alert"[^>]*>This server has no image model to paint with\.<\/p>/, "a refused retry is said in the server's words");
  assert.match(status(failed, { retrying: true }), /<button[^>]*disabled=""/, "one retry at a time");
});

await test("the ready announcement fires once, on the read where it lands", () => {
  // The page's own sequence: each read compares with the phases of the last.
  let phases = {};
  const read = (list) => {
    const ready = arrival.portraitsReady(phases, list);
    phases = arrival.portraitPhases(list);
    return ready;
  };
  assert.deepEqual(read([painting]), [], "the first read is the baseline");
  assert.deepEqual(read([painting]), [], "still painting");
  assert.deepEqual(read([painted]), [{ id: "c1", name: "Thornwick" }], "it lands: one arrival");
  assert.deepEqual(read([painted]), [], "the next poll is not news");
  assert.deepEqual(read([painted]), [], "nor the one after");
  assert.equal(arrival.portraitReadyLine("Thornwick"), "Thornwick's portrait is ready");
});

await test("a portrait already painted, new to the list, or failed is not announced as ready", () => {
  assert.deepEqual(arrival.portraitsReady({}, [painted]), [], "painted when the page opened");
  assert.deepEqual(arrival.portraitsReady({ other: "painting" }, [painted]), [], "a copy that just appeared");
  assert.deepEqual(arrival.portraitsReady({ c1: "painting" }, [failed]), [], "a failure is said on the card instead");
});

await test("the toast is one polite line that never takes focus", () => {
  const empty = renderToStaticMarkup(createElement(PortraitToast, { toast: null }));
  assert.equal(empty, '<div role="status" class="portrait-toast-region"></div>', "the region waits, mounted and empty");
  const markup = renderToStaticMarkup(createElement(PortraitToast, { toast: { id: "c1", name: "Thornwick" } }));
  assert.match(markup, /^<div role="status" class="portrait-toast-region"><p class="portrait-toast">Thornwick&#x27;s portrait is ready<\/p><\/div>$/);
  assert.doesNotMatch(markup, /<button|<a |tabindex|autofocus/i, "nothing in it to take focus");
  const page = read("src/app/characters/page.tsx");
  assert.equal((page.match(/<PortraitToast\b/g) ?? []).length, 1, "the page mounts one toast region");
  assert.match(page, /PORTRAIT_TOAST_MS/, "the toast leaves on its own");
});

await test("a portrait that just landed fades in, unless Effects is off or motion is reduced", () => {
  const slot = (props) => renderToStaticMarkup(createElement(RosterPortraitSlot, { character: painted, ...props }));
  assert.match(slot({ arriving: true, still: false }), /class="[^"]*\bportrait-arrive\b/, "with motion: the fade");
  assert.doesNotMatch(slot({ arriving: true, still: true }), /portrait-arrive/, "still (Effects low or reduced motion): no animation");
  assert.doesNotMatch(slot({ arriving: false, still: false }), /portrait-arrive/, "a portrait that was already there does not fade");
  const page = read("src/app/characters/page.tsx");
  assert.match(page, /const still = lowEffects \|\| prefersReducedMotion\(\);/, "still follows the Effects setting and the OS");

  const css = read("src/app/styles/moments.css");
  const fade = css.match(/\.portrait-arrive \{ animation: portrait-arrive (\d+)ms/);
  assert.ok(fade, "the fade is drawn");
  assert.ok(Number(fade[1]) <= 400, `at most about 400 ms, got ${fade[1]}`);
  const keyframes = css.slice(css.indexOf("@keyframes portrait-arrive"), css.indexOf("}", css.indexOf("to {", css.indexOf("@keyframes portrait-arrive"))));
  assert.doesNotMatch(keyframes, /transform/, "a fade, with no movement");
  assert.match(css, /\[data-effects="low"\] \.portrait-arrive,\n\[data-effects="low"\] \.portrait-toast \{ animation: none; \}/, "low effects stills it in CSS too");
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\.portrait-arrive,\n\s+\.portrait-toast \{ animation: none; \}/, "reduced motion stills it");
});

await test("the page waits on a retried painting as on the first", () => {
  const page = read("src/app/characters/page.tsx");
  const repaint = page.slice(page.indexOf("async function repaint"), page.indexOf("async function setPortrait"));
  assert.match(repaint, /fetch\(`\/api\/characters\/\$\{id\}\/portrait`, \{ method: "POST" \}\)/, "the sheet's Paint one route");
  assert.match(repaint, /\[id\]: "painting"/, "the retried portrait is awaited, so its arrival is announced");
  assert.match(repaint, /pollCount\.current = 0/, "polling starts again");
  assert.equal((page.match(/receive\((?:outcome\.payload|data)\.characters\)/g) ?? []).length, 2, "the first read and every poll go through receive");
});

console.log(`${passed} portrait arrival checks passed`);
