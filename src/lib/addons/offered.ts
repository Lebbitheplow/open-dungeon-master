import type { BoardView, MapGenerator, OptionField, WorkshopImporter } from "@/lib/addons/manifest";
import { listInstalledAddons } from "@/lib/addons/installed";
import { addonSupport } from "@/lib/addons/support";

// What the ready addons contribute, flattened for the pages that offer them
// (GET /api/addons). The shape is the client's (src/lib/addons/use-addons.ts).

type Owner = { addonId: string; addonName: string; addonVersion: string };

export type OfferedImporter = Owner & Pick<WorkshopImporter, "id" | "title" | "description" | "accepts" | "maxInputMB"> & { options: OptionField[] };
export type OfferedGenerator = Owner & Pick<MapGenerator, "id" | "title" | "description"> & { options: OptionField[] };
export type OfferedBoardView = Owner & Pick<BoardView, "id" | "title" | "description" | "needsViewData" | "sessionLayout" | "sessionTheme"> & { url: string; options: OptionField[] };

export type OfferedContributions = {
  supported: boolean;
  workshopImporters: OfferedImporter[];
  mapGenerators: OfferedGenerator[];
  boardViews: OfferedBoardView[];
};

// The address a board view's page is served at (src/app/api/addons/
// [addonId]/ui/[...path]/route.ts), versioned so an update is never answered
// from a cache.
export function boardViewUrl(addonId: string, version: string, entry: string): string {
  const inside = entry.replace(/^ui\//, "");
  return `/api/addons/${encodeURIComponent(addonId)}/ui/${inside.split("/").map(encodeURIComponent).join("/")}?v=${encodeURIComponent(version)}`;
}

export function offeredContributions(): OfferedContributions {
  const support = addonSupport();
  const offered: OfferedContributions = { supported: support.supported, workshopImporters: [], mapGenerators: [], boardViews: [] };
  if (!support.supported) return offered;
  for (const addon of listInstalledAddons()) {
    if (addon.status !== "ready" || !addon.manifest) continue;
    const owner: Owner = { addonId: addon.id, addonName: addon.manifest.name, addonVersion: addon.manifest.version };
    const { contributes } = addon.manifest;
    for (const importer of contributes.workshopImporters) {
      offered.workshopImporters.push({
        ...owner,
        id: importer.id,
        title: importer.title,
        description: importer.description,
        accepts: importer.accepts,
        maxInputMB: importer.maxInputMB,
        options: importer.options,
      });
    }
    for (const generator of contributes.mapGenerators) {
      offered.mapGenerators.push({ ...owner, id: generator.id, title: generator.title, description: generator.description, options: generator.options });
    }
    for (const view of contributes.boardViews) {
      offered.boardViews.push({
        ...owner,
        id: view.id,
        title: view.title,
        description: view.description,
        needsViewData: view.needsViewData,
        sessionLayout: view.sessionLayout,
        sessionTheme: view.sessionTheme,
        url: boardViewUrl(addon.id, addon.manifest.version, view.entry),
        options: view.options,
      });
    }
  }
  return offered;
}
