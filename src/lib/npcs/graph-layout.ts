// A small force layout for the relationship graph (docs/vtt-parity-
// implementation-plan.md section 5.5). Nodes repel, edges pull, everything
// drifts toward the centre, and the whole thing is seeded from the node
// names so the same roster lands in the same place every time it is drawn.
// Pure: no DOM, no randomness beyond the seed.

export type LayoutNode = { id: string; x: number; y: number };

export type LayoutInput = {
  nodes: string[];
  edges: Array<{ from: string; to: string }>;
  width: number;
  height: number;
  // Minimum centre distance the layout tries to keep between nodes.
  spacing?: number;
  iterations?: number;
};

function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function layoutGraph(input: LayoutInput): LayoutNode[] {
  const ids = [...new Set(input.nodes)];
  if (!ids.length) {
    return [];
  }
  const width = Math.max(1, input.width);
  const height = Math.max(1, input.height);
  const spacing = input.spacing ?? 72;
  const iterations = input.iterations ?? 240;
  const random = mulberry(hashSeed(ids.join("|")));
  // Start on a jittered ring so the first frame is already readable.
  const radius = Math.min(width, height) * 0.35;
  const nodes: LayoutNode[] = ids.map((id, index) => {
    const angle = (index / ids.length) * Math.PI * 2 + random() * 0.4;
    return {
      id,
      x: width / 2 + Math.cos(angle) * radius * (0.7 + random() * 0.3),
      y: height / 2 + Math.sin(angle) * radius * (0.7 + random() * 0.3),
    };
  });
  const at = new Map(nodes.map((node, index) => [node.id, index]));
  const edges = input.edges
    .map((edge) => [at.get(edge.from), at.get(edge.to)] as const)
    .filter((pair): pair is readonly [number, number] => pair[0] !== undefined && pair[1] !== undefined && pair[0] !== pair[1]);
  const rest = spacing * 1.6;
  let temperature = Math.min(width, height) / 8;
  for (let step = 0; step < iterations; step += 1) {
    const force = nodes.map(() => ({ x: 0, y: 0 }));
    for (let a = 0; a < nodes.length; a += 1) {
      for (let b = a + 1; b < nodes.length; b += 1) {
        let dx = nodes[a].x - nodes[b].x;
        let dy = nodes[a].y - nodes[b].y;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.01) {
          dx = random() - 0.5;
          dy = random() - 0.5;
          distance = 0.01;
        }
        const push = (spacing * spacing) / distance;
        force[a].x += (dx / distance) * push;
        force[a].y += (dy / distance) * push;
        force[b].x -= (dx / distance) * push;
        force[b].y -= (dy / distance) * push;
      }
    }
    for (const [a, b] of edges) {
      const dx = nodes[a].x - nodes[b].x;
      const dy = nodes[a].y - nodes[b].y;
      const distance = Math.max(0.01, Math.hypot(dx, dy));
      const pull = ((distance - rest) * distance) / rest / 4;
      force[a].x -= (dx / distance) * pull;
      force[a].y -= (dy / distance) * pull;
      force[b].x += (dx / distance) * pull;
      force[b].y += (dy / distance) * pull;
    }
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      // Gravity toward the centre keeps a disconnected roster in frame.
      force[index].x += (width / 2 - node.x) * 0.02;
      force[index].y += (height / 2 - node.y) * 0.02;
      const magnitude = Math.hypot(force[index].x, force[index].y);
      const stepSize = Math.min(magnitude, temperature);
      if (magnitude > 0) {
        node.x += (force[index].x / magnitude) * stepSize;
        node.y += (force[index].y / magnitude) * stepSize;
      }
      node.x = Math.min(width - spacing / 2, Math.max(spacing / 2, node.x));
      node.y = Math.min(height - spacing / 2, Math.max(spacing / 2, node.y));
    }
    temperature = Math.max(0.5, temperature * 0.97);
  }
  return nodes.map((node) => ({ id: node.id, x: Math.round(node.x * 10) / 10, y: Math.round(node.y * 10) / 10 }));
}

// The closest any two nodes stand, for the test and for a caller deciding
// whether to widen the frame.
export function closestPair(nodes: LayoutNode[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let a = 0; a < nodes.length; a += 1) {
    for (let b = a + 1; b < nodes.length; b += 1) {
      best = Math.min(best, Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y));
    }
  }
  return best;
}
