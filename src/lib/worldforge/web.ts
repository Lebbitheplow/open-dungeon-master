import type { Veracity, WorldLink, XY } from "./model.ts";

// The world's web, after WorldForge's veracity, kinship and hierarchy
// modules (by Smoebo). Family trees and chains of command are not stored
// anywhere: they are read off ordinary links that carry the family four
// ("parent of", "child of", "spouse of", "sibling of") or the chain four
// ("superior of", "reports to", "liege of", "vassal of"), whichever side
// the link was added from. Pure.

// Which links a view shows. The DM sees everything; "the truth" leaves out
// false beliefs; "what people believe" leaves out hidden truths, which is
// the world as the players will hear it.
export type WebView = "all" | "truth" | "believed";

export function linkInView(link: WorldLink, view: WebView): boolean {
  return view === "truth" ? link.veracity !== "believed" : view === "believed" ? link.veracity !== "hidden" : true;
}

const MOST_PUBLIC: Record<Veracity, number> = { hidden: 0, believed: 1, known: 2 };
const morePublic = (a: Veracity, b: Veracity) => (MOST_PUBLIC[b] > MOST_PUBLIC[a] ? b : a);

export type Edge = { from: string; to: string; veracity: Veracity };

// ---- family ----

export type Family = {
  // parent -> children, both as refs
  children: Map<string, Set<string>>;
  parents: Map<string, Set<string>>;
  spouses: Edge[];
  siblings: Edge[];
  descent: Edge[];
};

export function family(links: WorldLink[], live: Set<string>, view: WebView): Family {
  const children = new Map<string, Set<string>>();
  const parents = new Map<string, Set<string>>();
  const pairs = new Map<string, Edge>();
  const descent = new Map<string, Edge>();
  const add = (map: Map<string, Set<string>>, key: string, value: string) => map.set(key, (map.get(key) ?? new Set()).add(value));
  const pair = (kind: string, a: string, b: string, veracity: Veracity) => {
    const [x, y] = a < b ? [a, b] : [b, a];
    const key = `${kind}|${x}|${y}`;
    const seen = pairs.get(key);
    pairs.set(key, { from: x, to: y, veracity: seen ? morePublic(seen.veracity, veracity) : veracity });
  };
  for (const link of links) {
    if (!live.has(link.from) || !live.has(link.to) || !linkInView(link, view)) continue;
    const label = link.label.toLowerCase();
    const parentChild = label === "parent of" ? [link.from, link.to] : label === "child of" ? [link.to, link.from] : null;
    if (parentChild) {
      add(children, parentChild[0], parentChild[1]);
      add(parents, parentChild[1], parentChild[0]);
      const key = `${parentChild[0]}|${parentChild[1]}`;
      const seen = descent.get(key);
      descent.set(key, { from: parentChild[0], to: parentChild[1], veracity: seen ? morePublic(seen.veracity, link.veracity) : link.veracity });
    } else if (label === "spouse of") {
      pair("spouse", link.from, link.to, link.veracity);
    } else if (label === "sibling of") {
      pair("sibling", link.from, link.to, link.veracity);
    }
  }
  const all = [...pairs.entries()];
  return {
    children,
    parents,
    spouses: all.filter(([key]) => key.startsWith("spouse|")).map(([, edge]) => edge),
    siblings: all.filter(([key]) => key.startsWith("sibling|")).map(([, edge]) => edge),
    descent: [...descent.values()],
  };
}

// ---- chain of command ----

export type Chain = { above: Map<string, Set<string>>; below: Map<string, Set<string>>; edges: Edge[] };

export function chain(links: WorldLink[], live: Set<string>, view: WebView): Chain {
  const above = new Map<string, Set<string>>();
  const below = new Map<string, Set<string>>();
  const edges = new Map<string, Edge>();
  const add = (map: Map<string, Set<string>>, key: string, value: string) => map.set(key, (map.get(key) ?? new Set()).add(value));
  for (const link of links) {
    if (!live.has(link.from) || !live.has(link.to) || !linkInView(link, view)) continue;
    const label = link.label.toLowerCase();
    const pair =
      label === "superior of" || label === "liege of" ? [link.from, link.to] : label === "reports to" || label === "vassal of" ? [link.to, link.from] : null;
    if (!pair) continue;
    add(below, pair[0], pair[1]);
    add(above, pair[1], pair[0]);
    const key = `${pair[0]}|${pair[1]}`;
    const seen = edges.get(key);
    edges.set(key, { from: pair[0], to: pair[1], veracity: seen ? morePublic(seen.veracity, link.veracity) : link.veracity });
  }
  return { above, below, edges: [...edges.values()] };
}

// Rows for a top-down tree (a family or a chain): each ref on the row one
// below its lowest parent, loops broken, and within a row the order that
// keeps children under their parents.
export function treeRows(nodes: string[], up: Map<string, Set<string>>): string[][] {
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (ref: string): number => {
    if (depth.has(ref)) return depth.get(ref)!;
    if (visiting.has(ref)) return 0;
    visiting.add(ref);
    const ups = [...(up.get(ref) ?? [])].filter((parent) => nodes.includes(parent));
    const value = ups.length ? Math.max(...ups.map(depthOf)) + 1 : 0;
    visiting.delete(ref);
    depth.set(ref, value);
    return value;
  };
  nodes.forEach(depthOf);
  const rows: string[][] = [];
  for (const ref of nodes) (rows[depth.get(ref)!] ??= []).push(ref);
  const placed = new Map<string, number>();
  return rows.filter(Boolean).map((row) => {
    const score = (ref: string) => {
      const ups = [...(up.get(ref) ?? [])].map((parent) => placed.get(parent)).filter((at): at is number => at !== undefined);
      return ups.length ? ups.reduce((sum, at) => sum + at, 0) / ups.length : Infinity;
    };
    const ordered = [...row].sort((a, b) => score(a) - score(b) || a.localeCompare(b));
    ordered.forEach((ref, index) => placed.set(ref, index / Math.max(1, ordered.length - 1)));
    return ordered;
  });
}

// ---- the web ----

function seeded(ref: string): number {
  let hash = 2166136261;
  for (let i = 0; i < ref.length; i += 1) hash = Math.imul(hash ^ ref.charCodeAt(i), 16777619);
  return ((hash >>> 0) % 10_000) / 10_000;
}

// A force layout in a 0..1 square: linked entries pull together, everything
// pushes apart, and the same world always settles the same way (positions
// start from each ref's hash, not from chance), so the web does not jump
// between visits.
export function webLayout(nodes: string[], edges: Array<{ from: string; to: string }>, iterations = 240): Map<string, XY> {
  const count = nodes.length;
  const at = new Map<string, XY>();
  nodes.forEach((ref, index) => {
    const angle = (index / Math.max(1, count)) * Math.PI * 2 + seeded(ref) * 0.6;
    const radius = 0.25 + seeded(`${ref}#r`) * 0.2;
    at.set(ref, { x: 0.5 + Math.cos(angle) * radius, y: 0.5 + Math.sin(angle) * radius });
  });
  if (count < 2) return at;
  const ideal = Math.min(0.3, 0.9 / Math.sqrt(count));
  const live = edges.filter((edge) => at.has(edge.from) && at.has(edge.to) && edge.from !== edge.to);
  for (let step = 0; step < iterations; step += 1) {
    const heat = 0.08 * (1 - step / iterations) + 0.002;
    const push = new Map(nodes.map((ref) => [ref, { x: 0, y: 0 }]));
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        const a = at.get(nodes[i])!;
        const b = at.get(nodes[j])!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 1e-4) {
          dx = seeded(nodes[i]) - 0.5;
          dy = seeded(nodes[j]) - 0.5;
          distance = Math.hypot(dx, dy) || 1e-4;
        }
        const force = (ideal * ideal) / distance;
        const pi = push.get(nodes[i])!;
        const pj = push.get(nodes[j])!;
        pi.x += (dx / distance) * force;
        pi.y += (dy / distance) * force;
        pj.x -= (dx / distance) * force;
        pj.y -= (dy / distance) * force;
      }
    }
    for (const edge of live) {
      const a = at.get(edge.from)!;
      const b = at.get(edge.to)!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const distance = Math.hypot(dx, dy) || 1e-4;
      const force = (distance * distance) / ideal;
      const pa = push.get(edge.from)!;
      const pb = push.get(edge.to)!;
      pa.x -= (dx / distance) * force;
      pa.y -= (dy / distance) * force;
      pb.x += (dx / distance) * force;
      pb.y += (dy / distance) * force;
    }
    for (const ref of nodes) {
      const p = at.get(ref)!;
      const d = push.get(ref)!;
      // A gentle pull to the middle keeps islands from drifting off.
      d.x += (0.5 - p.x) * 0.05;
      d.y += (0.5 - p.y) * 0.05;
      const length = Math.hypot(d.x, d.y) || 1;
      p.x = Math.min(0.97, Math.max(0.03, p.x + (d.x / length) * Math.min(length, heat)));
      p.y = Math.min(0.97, Math.max(0.03, p.y + (d.y / length) * Math.min(length, heat)));
    }
  }
  return at;
}

// Everyone within `hops` links of `center`, for the web around one entry.
export function neighbourhood(center: string, links: WorldLink[], hops: number, view: WebView): Set<string> {
  const out = new Set([center]);
  let frontier = [center];
  for (let hop = 0; hop < hops; hop += 1) {
    const next: string[] = [];
    for (const link of links) {
      if (!linkInView(link, view)) continue;
      for (const [a, b] of [[link.from, link.to], [link.to, link.from]]) {
        if (frontier.includes(a) && !out.has(b)) {
          out.add(b);
          next.push(b);
        }
      }
    }
    frontier = next;
  }
  return out;
}
