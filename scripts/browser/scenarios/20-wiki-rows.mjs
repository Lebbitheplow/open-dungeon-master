// Issue 282: the WorldForge wiki's entry list, a capped column that
// scrolls, squeezed forty-five entries into slivers drawn over one another
// (motion-press hides overflow, and a flex item that hides overflow has no
// minimum height). Sixty entries in a fresh workshop: every row keeps its
// height, none is drawn over its neighbour, and the list scrolls instead.
// Measured, not read: the unit suite renders no layout.
import { check, eventually, untilStill } from "../lib.mjs";

const COUNT = 60;

export default {
  name: "wiki-rows",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const made = await api.post(`${base}/api/workshops`, { data: { title: "Sixty entries", description: "" } });
    check(made.ok(), "a workshop for the check");
    const id = (await made.json()).workshop.id;
    try {
      for (let index = 1; index <= COUNT; index += 1) {
        const entry = await api.post(`${base}/api/campaigns/${id}/world/entities`, { data: { name: `Entry ${String(index).padStart(2, "0")} of the wiki` } });
        if (index === 1) check(entry.ok(), `an entry is made (${entry.status()})`);
      }
      await t.open(`/workshop/${id}?system=world`);
      const list = page.locator(`${root}[role="listbox"][aria-label="Entries"]`);
      await eventually(() => list.count(), { timeoutMs: 30_000, label: "the wiki's entry list" });
      await eventually(async () => (await list.locator(`[role="option"]`).count()) >= COUNT, { timeoutMs: 30_000, label: `${COUNT} entries listed` });
      // The rows arrive one after another; measure them settled.
      await untilStill(page);
      const metrics = await list.evaluate((node) => {
        const rows = [...node.querySelectorAll('[role="option"]')].map((row) => row.getBoundingClientRect());
        return {
          count: rows.length,
          shortest: Math.min(...rows.map((row) => row.height)),
          overlaps: rows.slice(1).filter((row, index) => row.top < rows[index].bottom - 1).length,
          scrollHeight: node.scrollHeight,
          clientHeight: node.clientHeight,
        };
      });
      check(metrics.shortest >= 36, `every one of ${metrics.count} rows keeps its height (shortest ${Math.round(metrics.shortest)}px)`);
      check(metrics.overlaps === 0, `no row is drawn over its neighbour (${metrics.overlaps} were)`);
      check(metrics.scrollHeight > metrics.clientHeight, `the list scrolls instead (${metrics.scrollHeight}px in ${metrics.clientHeight}px)`);
      await t.shot("rows");
    } finally {
      await api.delete(`${base}/api/workshops/${id}`);
    }
  },
};
