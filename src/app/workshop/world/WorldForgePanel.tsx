"use client";

import { BookOpenText, Download, Hourglass, Lock, Map as MapIcon, MessageCircleQuestion, Network, PenLine, Shapes, Sparkles, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { IconRail, type IconRailItem } from "@/components/ui/IconRail";
import { KitButton, Listed, PanelError } from "@/app/campaigns/[campaignId]/PanelKit";
import { useTourPrepare } from "@/lib/tours/prepare";
import { useWorld } from "./useWorld";
import { WikiView } from "./WikiView";
import { WebView } from "./WebView";
import { TimelineView } from "./TimelineView";
import { AtlasView } from "./AtlasView";
import { SecretsView } from "./SecretsView";
import { StubsView } from "./StubsView";
import { TypesView } from "./TypesView";
import { ForgeView } from "./ForgeView";
import { AskView } from "./AskView";
import { offersImages, offersStoryModel, useCapabilities } from "@/lib/use-capabilities";

// WorldForge in the workshop. WorldForge is Smoebo's world-building app,
// built in with their blessing: a wiki of typed entries, the web of links
// between them, calendars and a timeline, an atlas of maps inside maps,
// secrets and who keeps them, and the names still to be written. Every
// entry is a record the table plays with (src/lib/worldforge/model.ts), so
// what is written here is what the Cast, the Region, Factions and Lore hold
// and what the AI DM is told.

type View = "wiki" | "web" | "timeline" | "atlas" | "secrets" | "stubs" | "types" | "forge" | "ask";

// Forge and Ask need a text model; the rail leaves them out on a server
// that has none, and everything else works the same.
const AI_VIEWS: ReadonlySet<View> = new Set(["forge", "ask"]);
const VIEWS: Array<{ value: View; label: string; icon: IconRailItem["icon"] }> = [
  { value: "wiki", label: "Wiki", icon: BookOpenText },
  { value: "forge", label: "Forge", icon: Sparkles },
  { value: "ask", label: "Ask", icon: MessageCircleQuestion },
  { value: "web", label: "Web", icon: Network },
  { value: "timeline", label: "Timeline", icon: Hourglass },
  { value: "atlas", label: "Atlas", icon: MapIcon },
  { value: "secrets", label: "Secrets", icon: Lock },
  { value: "stubs", label: "To write", icon: PenLine },
  { value: "types", label: "Types", icon: Shapes },
];

type ImportReport = { created: number; updated: number; links: number; events: number; secrets: number; maps: number; beats: number; skipped: string[] };

export function WorldForgePanel({ campaignId, onOpenSystem }: { campaignId: string; onOpenSystem: (system: string) => void }) {
  const api = useWorld(campaignId);
  const capabilities = useCapabilities();
  const canWrite = offersStoryModel(capabilities);
  const canPaint = offersImages(capabilities);
  const [chosenView, setView] = useState<View>("wiki");
  const view: View = !canWrite && AI_VIEWS.has(chosenView) ? "wiki" : chosenView;
  const [focus, setFocus] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const world = api.world;

  // The tour and the palette ask for a view, or for a new entry, by name
  // (src/lib/tours/prepare.ts).
  useTourPrepare((name) => {
    if (name === "open-world-entry") setView("wiki");
    const asked = name.startsWith("world-view-") ? (name.slice("world-view-".length) as View) : null;
    // A tour step for a view this server does not offer has nothing to show.
    if (asked && VIEWS.some((entry) => entry.value === asked)) setView(asked);
  });

  const open = (ref: string | null) => {
    setFocus(ref);
    if (ref) setView("wiki");
  };

  async function importFile(file: File) {
    setReading(true);
    setReport(null);
    try {
      const result = await api.importFile(await file.text());
      if (result) setReport(result as unknown as ImportReport);
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const counts: Partial<Record<View, number>> = world
    ? {
        wiki: world.entities.length,
        web: world.doc.links.length,
        timeline: world.doc.events.length,
        atlas: world.doc.maps.length,
        secrets: world.doc.secrets.filter((secret) => !secret.partyKnows).length,
        stubs: world.doc.stubs.filter((stub) => stub.status === "open").length,
      }
    : {};

  return (
    <section className="flex flex-col gap-3" aria-label="WorldForge">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-stone-500">
          <span className="text-amber-200/90">WorldForge</span>, by Smoebo, built into the workshop. Every entry is a Cast member, place, faction or lore entry here.
        </p>
        <span className="ml-auto flex gap-1.5">
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => event.target.files?.[0] && importFile(event.target.files[0])} />
          <KitButton tone="small" busy={reading} disabled={reading} onClick={() => fileRef.current?.click()} title="Add a WorldForge export to this world" data-tour="world-import">
            {reading ? null : <Upload className="size-3.5" />} Open a WorldForge file
          </KitButton>
          <a href={`/api/campaigns/${campaignId}/world/export`} download className="pk-tap inline-flex items-center gap-1.5 rounded-lg border border-stone-600/60 bg-stone-900/50 px-2.5 py-1 text-xs text-stone-300 hover:border-amber-500/40 hover:text-amber-100 motion-press" data-tour="world-export">
            <Download className="size-3.5" /> Save as a WorldForge file
          </a>
        </span>
      </div>
      {report ? (
        <div className="motion-pop rounded-lg border border-emerald-700/40 bg-emerald-900/15 px-3 py-2 text-xs text-stone-200" role="status">
          Brought in {report.created} new {report.created === 1 ? "entry" : "entries"}
          {report.updated ? `, updated ${report.updated}` : ""}, {report.links} links, {report.events} events, {report.secrets} secrets, {report.maps} maps
          {report.beats ? ` and ${report.beats} storyboard cards` : ""}.
          {report.skipped.length ? <span className="block text-ember-300">Left out: {report.skipped.join("; ")}</span> : null}
        </div>
      ) : null}
      {api.error && !world ? <PanelError>{api.error}</PanelError> : null}
      {!canWrite || !canPaint ? (
        <p className="text-[11px] text-stone-500" data-tour="world-ai-note">
          {!canWrite && !canPaint
            ? "Forge, Ask, Draft and Paint need AI (a text model, an image backend), which this server does not have set up. Everything else here works without it, and pictures can still be uploaded."
            : !canWrite
              ? "Forge, Ask and Draft need a text model, which this server does not have set up. Everything else here works without it."
              : "Paint needs an image backend, which this server does not have set up. Pictures can still be uploaded."}
        </p>
      ) : null}

      <IconRail
        items={VIEWS.filter((entry) => canWrite || !AI_VIEWS.has(entry.value)).map((entry) => ({ ...entry, badge: counts[entry.value] || undefined, tour: `world-view-${entry.value}` }))}
        value={view}
        onChange={setView}
        orientation="horizontal"
        className="border-b border-stone-800/80 pb-1"
      />

      <Listed loaded={api.loaded} error={api.loadError} onRetry={api.refresh} loading="Reading the world" rows={4}>
        {world ? (
          // Keyed by view so the incoming one rises in instead of cutting.
          <div key={view} className="motion-tab">
            {view === "wiki" ? <WikiView api={api} world={world} focus={focus} onFocus={setFocus} onOpenSystem={onOpenSystem} canWrite={canWrite} canPaint={canPaint} /> : null}
            {view === "forge" ? <ForgeView api={api} world={world} onOpen={open} /> : null}
            {view === "ask" ? <AskView api={api} world={world} onOpen={open} /> : null}
            {view === "web" ? <WebView world={world} focus={focus} onOpen={open} /> : null}
            {view === "timeline" ? <TimelineView api={api} world={world} onOpen={open} /> : null}
            {view === "atlas" ? <AtlasView api={api} world={world} onOpen={open} /> : null}
            {view === "secrets" ? <SecretsView api={api} world={world} onOpen={open} /> : null}
            {view === "stubs" ? <StubsView api={api} world={world} onOpen={open} /> : null}
            {view === "types" ? <TypesView api={api} world={world} /> : null}
            {api.error && !["wiki", "forge", "ask"].includes(view) ? <PanelError className="mt-2">{api.error}</PanelError> : null}
          </div>
        ) : null}
      </Listed>
    </section>
  );
}
