"use client";

import { Crosshair, ExternalLink, Network, Users, Crown } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { KitButton } from "@/app/campaigns/[campaignId]/PanelKit";
import { chain, family, linkInView, neighbourhood, treeRows, webLayout, type Edge, type WebView as View } from "@/lib/worldforge/web";
import type { XY } from "@/lib/worldforge/model";
import type { WorldState } from "./useWorld";
import { EntityAvatar, TypeChip, tint, typeOf } from "./world-ui";

// The world's web, after WorldForge's graph tab: the web of every link (or
// the entries within a few links of one), the family tree read off the
// family words, and the chain of command read off the chain words. The DM
// sees everything, the truth leaves out false beliefs, and "what people
// believe" leaves out hidden truths: the world as the players will hear it.

type Mode = "web" | "family" | "chain";
const W = 1000;
const H = 620;
const MODES: Array<{ id: Mode; label: string; icon: typeof Network }> = [
  { id: "web", label: "Web", icon: Network },
  { id: "family", label: "Family", icon: Users },
  { id: "chain", label: "Chain of command", icon: Crown },
];
const VIEWS: Array<{ id: View; label: string }> = [
  { id: "all", label: "Everything" },
  { id: "truth", label: "The truth" },
  { id: "believed", label: "What people believe" },
];

function rowsLayout(rows: string[][]): Map<string, XY> {
  const at = new Map<string, XY>();
  rows.forEach((row, depth) => {
    row.forEach((ref, index) => at.set(ref, { x: (index + 1) / (row.length + 1), y: (depth + 0.6) / (rows.length + 0.2) }));
  });
  return at;
}

export function WebView({ world, focus, onOpen }: { world: WorldState; focus: string | null; onOpen: (ref: string) => void }) {
  const { doc, entities } = world;
  const [mode, setMode] = useState<Mode>("web");
  const [view, setView] = useState<View>("all");
  const [center, setCenter] = useState<string>(focus ?? "");
  const [hops, setHops] = useState(2);
  const [picked, setPicked] = useState<string>(focus ?? "");
  const byRef = useMemo(() => new Map(entities.map((entity) => [entity.ref, entity])), [entities]);
  const live = useMemo(() => new Set(entities.map((entity) => entity.ref)), [entities]);

  const graph = useMemo(() => {
    const links = doc.links.filter((link) => live.has(link.from) && live.has(link.to) && linkInView(link, view));
    if (mode === "family") {
      const tree = family(links, live, view);
      const nodes = [...new Set([...tree.descent, ...tree.spouses, ...tree.siblings].flatMap((edge) => [edge.from, edge.to]))];
      const edges: Array<Edge & { kind: string; label: string }> = [
        ...tree.descent.map((edge) => ({ ...edge, kind: "descent", label: "parent of" })),
        ...tree.spouses.map((edge) => ({ ...edge, kind: "spouse", label: "spouse of" })),
        ...tree.siblings.map((edge) => ({ ...edge, kind: "sibling", label: "sibling of" })),
      ];
      return { nodes, edges, at: rowsLayout(treeRows(nodes, tree.parents)) };
    }
    if (mode === "chain") {
      const tree = chain(links, live, view);
      const nodes = [...new Set(tree.edges.flatMap((edge) => [edge.from, edge.to]))];
      return { nodes, edges: tree.edges.map((edge) => ({ ...edge, kind: "chain", label: "above" })), at: rowsLayout(treeRows(nodes, tree.above)) };
    }
    const nodes = center ? [...neighbourhood(center, links, hops, view)].filter((ref) => live.has(ref)) : [...new Set(links.flatMap((link) => [link.from, link.to]))];
    const set = new Set(nodes);
    const edges = links
      .filter((link) => set.has(link.from) && set.has(link.to))
      .map((link) => ({ from: link.from, to: link.to, veracity: link.veracity, kind: link.oneway ? "oneway" : "link", label: link.rank ? `${link.label} (${link.rank})` : link.label }));
    return { nodes, edges, at: webLayout(nodes, edges) };
  }, [center, doc.links, hops, live, mode, view]);

  const point = (ref: string) => {
    const at = graph.at.get(ref) ?? { x: 0.5, y: 0.5 };
    return { x: 40 + at.x * (W - 80), y: 30 + at.y * (H - 70) };
  };
  const chosen = byRef.get(picked);
  const labels = graph.nodes.length <= 24;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="tablist" aria-label="Kind of chart">
          {MODES.map((entry) => (
            <button key={entry.id} type="button" role="tab" aria-selected={mode === entry.id} onClick={() => setMode(entry.id)} className={cn(ui.btnSmall, "px-2.5 py-1 text-xs", mode === entry.id && "border-amber-500/60 bg-amber-400/10 text-amber-100")}>
              <entry.icon className="size-3.5" /> {entry.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1" role="radiogroup" aria-label="Which links">
          {VIEWS.map((entry) => (
            <button key={entry.id} type="button" role="radio" aria-checked={view === entry.id} onClick={() => setView(entry.id)} className={cn("rounded-md border border-stone-700 px-2 py-1 text-[11px] motion-press", view === entry.id ? "bg-stone-800 text-amber-100" : "text-stone-400")}>
              {entry.label}
            </button>
          ))}
        </div>
        {mode === "web" && center ? (
          <div className="motion-pop flex items-center gap-1.5 text-xs text-stone-400">
            Around {byRef.get(center)?.name}, within
            {[1, 2, 3].map((count) => (
              <button key={count} type="button" onClick={() => setHops(count)} className={cn("rounded px-1.5 motion-press", hops === count ? "bg-amber-400/15 text-amber-100" : "hover:text-stone-200")}>
                {count}
              </button>
            ))}
            links
            <button type="button" onClick={() => setCenter("")} className="ml-1 underline decoration-stone-600 underline-offset-2 hover:text-stone-200">
              whole world
            </button>
          </div>
        ) : null}
      </div>

      {/* On a phone the web keeps a readable size and scrolls sideways; the
          card for the chosen entry sits under it instead of over it. */}
      <div className="panel relative overflow-x-auto overflow-y-hidden rounded-xl" data-tour="world-web">
        {graph.nodes.length === 0 ? (
          <p className="p-8 text-center text-sm text-stone-500">
            {mode === "family"
              ? "No family yet: link people with parent of, child of, spouse of or sibling of."
              : mode === "chain"
                ? "No chain of command yet: link with superior of, reports to, liege of or vassal of."
                : "No links yet. Open an entry in the wiki and add one."}
          </p>
        ) : (
          // Kept across a recentre, so the entries that stay glide to their
          // new places while the new ones pop in.
          <svg key={`${mode}-${view}`} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full min-w-[720px]" role="img" aria-label={`${MODES.find((entry) => entry.id === mode)?.label} of the world`}>
            <defs>
              <marker id="wf-arrow" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="#a8a29e" />
              </marker>
            </defs>
            {graph.edges.map((edge, index) => {
              const a = point(edge.from);
              const b = point(edge.to);
              // Links between the same two entries bow apart so each line
              // and its words can be read.
              const pair = [edge.from, edge.to].sort().join("|");
              const siblings = graph.edges.filter((other) => [other.from, other.to].sort().join("|") === pair);
              const bow = (siblings.indexOf(edge) - (siblings.length - 1) / 2) * 44 * (edge.from < edge.to ? 1 : -1);
              const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
              const control = { x: (a.x + b.x) / 2 - ((b.y - a.y) / length) * bow, y: (a.y + b.y) / 2 + ((b.x - a.x) / length) * bow };
              const middle = { x: (a.x + 2 * control.x + b.x) / 4, y: (a.y + 2 * control.y + b.y) / 4 };
              const path =
                mode === "web"
                  ? `M${a.x},${a.y} Q${control.x},${control.y} ${b.x},${b.y}`
                  : `M${a.x},${a.y} C${a.x},${(a.y + b.y) / 2} ${b.x},${(a.y + b.y) / 2} ${b.x},${b.y}`;
              const hidden = edge.veracity === "hidden";
              const believed = edge.veracity === "believed";
              return (
                <g key={`${edge.from}-${edge.to}-${index}`} style={{ "--i": index } as React.CSSProperties}>
                  <path
                    d={path}
                    pathLength={1}
                    fill="none"
                    stroke={hidden ? "#f87171" : believed ? "#c4b5fd" : edge.kind === "spouse" ? "#d6b25e" : "#78716c"}
                    strokeWidth={edge.kind === "spouse" ? 2.5 : 1.5}
                    className={cn(hidden || believed || edge.kind === "sibling" ? "wf-edge-dashed" : "wf-edge")}
                    markerEnd={edge.kind === "oneway" || mode === "chain" ? "url(#wf-arrow)" : undefined}
                  >
                    <title>{`${byRef.get(edge.from)?.name} ${edge.label} ${byRef.get(edge.to)?.name}${hidden ? " (hidden truth)" : believed ? " (false belief)" : ""}`}</title>
                  </path>
                  {labels && mode === "web" ? (
                    <text x={middle.x} y={middle.y - 4} textAnchor="middle" className="wf-edge-label fill-stone-500 text-[11px]">
                      {edge.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {graph.nodes.map((ref, index) => {
              const entity = byRef.get(ref);
              if (!entity) return null;
              const type = typeOf(doc, entity);
              const { x, y } = point(ref);
              const active = ref === picked;
              return (
                <g key={ref} className="wf-node" style={{ transform: `translate(${x}px, ${y}px)`, "--i": index } as React.CSSProperties}>
                  <g className="wf-node-body cursor-pointer outline-none" onClick={() => setPicked(ref)} role="button" aria-label={entity.name} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && setPicked(ref)}>
                    <circle r={active ? 22 : 18} fill={tint(type.color, 0.22)} stroke={type.color} strokeWidth={active ? 3 : 1.5} className="wf-node-ring" />
                    {entity.portrait ? (
                      <>
                        <clipPath id={`wf-clip-${index}`}>
                          <circle r={active ? 19 : 15} />
                        </clipPath>
                        <image href={entity.portrait} x={-20} y={-20} width={40} height={40} clipPath={`url(#wf-clip-${index})`} preserveAspectRatio="xMidYMid slice" />
                      </>
                    ) : null}
                    <text y={active ? 38 : 34} textAnchor="middle" className={cn("text-[12px]", active ? "fill-amber-100" : "fill-stone-300")}>
                      {entity.name.length > 22 ? `${entity.name.slice(0, 21)}...` : entity.name}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>
        )}
        {chosen ? (
          <div key={chosen.ref} className="sticky left-0 m-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/25 bg-stone-950/90 p-2 shadow-lg motion-pop sm:absolute sm:bottom-3 sm:left-3 sm:m-0">
            <EntityAvatar entity={chosen} type={typeOf(doc, chosen)} size="size-8" />
            <span className="text-sm text-amber-100">{chosen.name}</span>
            <TypeChip type={typeOf(doc, chosen)} />
            {mode === "web" ? (
              <KitButton tone="small" onClick={() => setCenter(chosen.ref)}>
                <Crosshair className="size-3.5" /> Center here
              </KitButton>
            ) : null}
            <KitButton tone="small" onClick={() => onOpen(chosen.ref)}>
              <ExternalLink className="size-3.5" /> Open in the wiki
            </KitButton>
          </div>
        ) : null}
      </div>
      <p className="text-[11px] text-stone-500">
        Red dashes are hidden truths, violet dashes false beliefs, arrows one-way links. Gold lines join spouses.
      </p>
    </div>
  );
}
