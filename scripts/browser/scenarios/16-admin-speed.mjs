// Issue 255: the admin settings offer a model role's paid Fast tier on a
// connection that has one (OpenAI's own API) for any model named there
// (PR 298: OpenAI's reply says whether it ran, so no list of models is
// kept), say why not elsewhere, state the price before Fast is chosen, and
// save the choice. The rig never calls a model: it saves Fast, reads it
// back, and puts the settings back as found.
import { check, eventually } from "../lib.mjs";

const UNAVAILABLE = '[data-speed-unavailable]';
const OFFERED = '[data-speed-field]';

export default {
  name: "admin-speed",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, api, base } = t;
    const blank = { text: { customBaseUrl: "", customModel: "", speed: "" } };
    const restored = await api.patch(`${base}/api/admin/settings`, { data: blank });
    check(restored.ok(), `clearing the story backend answered ${restored.status()}`);
    await t.open("/admin");

    // The story model's speed sits with its connection; with no OpenAI
    // connection it says why Fast is not offered.
    const storyBlock = page.locator(`${root}#admin-text`).first();
    const baseUrl = storyBlock.locator("label").filter({ hasText: /^Backend base URL/ }).locator("input").first();
    await eventually(() => baseUrl.count(), { timeoutMs: 30_000, label: "the story backend's base URL" });
    const unavailable = storyBlock.locator(UNAVAILABLE).first();
    await eventually(() => unavailable.count(), { label: "the speed field saying Fast is not offered here" });
    const why = (await storyBlock.innerText()).replace(/\s+/g, " ");
    check(/Fast is offered on OpenAI's own API/.test(why), "it says Fast is OpenAI's own API's");

    // OpenAI's API with a model that has Fast: the choice is offered, and
    // its price is said once it is picked.
    await baseUrl.fill("https://api.openai.com/v1");
    // The model field is the registry's picker (PR 273): a text field while
    // the backend lists nothing (OpenAI without a key here), a menu with
    // "Type a model id…" once it does.
    const model = storyBlock.locator('input[aria-label="Model name"]').first();
    if (!(await model.isVisible().catch(() => false))) {
      await t.tap(storyBlock.locator('button[aria-label="Model name"]').locator("visible=true").first());
      const typeOwn = page.getByRole("option", { name: /Type a model id/ }).or(page.getByRole("menuitemradio", { name: /Type a model id/ })).locator("visible=true").first();
      await eventually(() => typeOwn.count(), { label: "Type a model id in the model menu" });
      await t.tap(typeOwn);
    }
    await eventually(() => model.isVisible(), { label: "the model field" });
    await model.fill("gpt-6-sol");
    const offered = storyBlock.locator(OFFERED).first();
    await eventually(() => offered.count(), { label: "Fast offered for gpt-6-sol on OpenAI" });
    check(/premium price; the default keeps today's speed and cost/.test(await offered.innerText()), "the default's hint says what Fast costs");
    await offered.scrollIntoViewIfNeeded();
    await t.tap(offered.locator('button[aria-label="Processing speed"]'));
    const fast = page.getByRole("menuitemradio", { name: /Fast \(premium price\)/ }).or(page.getByRole("option", { name: /Fast \(premium price\)/ })).locator("visible=true").first();
    await eventually(() => fast.count(), { label: "the Fast row in the menu" });
    await t.tap(fast);
    await eventually(async () => /No call has run at this setting since the server started/.test(await offered.innerText()), {
      label: "Fast chosen, with what the last call ran at",
    });
    await t.shot("fast");

    // Any other model named on OpenAI's API keeps the choice: no model is
    // ruled out by its name.
    await model.fill("gpt-4o");
    await eventually(async () => (await storyBlock.locator(OFFERED).count()) > 0 && (await storyBlock.locator(UNAVAILABLE).count()) === 0, {
      label: "Fast still offered for gpt-4o on OpenAI",
    });

    // No model named (the rig's server has no OPENAI_COMPAT_MODEL, so the
    // blank field has nothing to fall back to): not offered, and a Fast
    // left set is said to ask for nothing.
    await model.fill("");
    await eventually(async () => /Name the model first; Fast depends on it\./.test(await storyBlock.innerText()), {
      label: "a blank model said to need naming before Fast",
    });
    check(/Fast is set, but this connection has no Fast tier, so none is asked for/.test(await storyBlock.innerText()), "a Fast left set asks for nothing");

    // Saved and read back.
    await model.fill("gpt-6-sol");
    await eventually(() => offered.count(), { label: "Fast offered again" });
    const save = page.locator(`${root}button`).filter({ hasText: /Save settings/ }).locator("visible=true").first();
    await save.scrollIntoViewIfNeeded();
    // The page's last control. In the app's phone emulation the fields above
    // leave the visual viewport 48 px into the layout one, so a tap's hit
    // point lands on the Storage section above the button; the click it
    // answers is sent straight to it.
    await (t.touch && t.app ? save.dispatchEvent("click") : t.tap(save));
    await eventually(async () => {
      const saved = await (await api.get(`${base}/api/admin/settings`)).json();
      return saved.config?.text?.speed === "fast";
    }, { label: "Fast saved for the story model" });
    const back = await api.patch(`${base}/api/admin/settings`, { data: blank });
    check(back.ok(), `putting the settings back answered ${back.status()}`);
  },
};
