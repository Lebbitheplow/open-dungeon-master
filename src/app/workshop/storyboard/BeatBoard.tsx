"use client";

import { EmptyState } from "@/components/EmptyState";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { BEAT_LABELS, routeOf, type BeatLinks, type Board, type BoardInventory, type BoardNode } from "@/lib/workshop/board";
import { GameIcon } from "@/components/ui/GameIcon";
import { KIND_CHIP, KIND_GLYPH, LINK_FIELDS, LINK_GLYPH } from "@/app/workshop/storyboard/beat-fields";

// The workshop's storyboard: every card as a card. Kind chip, title, the
// first line of what happens, a chip per thing it points at (marked when it
// lives in the shared workshop, flagged when it is gone), and how many cards
// it leads to and how. Tapping one hands it to the caller, which opens the
// editor.
//
// One column on a phone, because the board reads top to bottom there; two
// or three on a desk. Still no canvas: the x and y on each beat wait for
// one, but arrows drawn between cards that reflow with the viewport would
// be arrows pointing at the wrong thing.

// The first line with words in it, so a card whose body opens with a blank
// line still shows something.
function excerpt(body: string): string {
  return body.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

export function BeatBoard({
  board,
  inventory,
  broken = {},
  onOpen,
}: {
  board: Board;
  inventory: BoardInventory;
  broken?: Record<string, Array<keyof BeatLinks>>;
  onOpen: (node: BoardNode) => void;
}) {
  if (board.nodes.length === 0) {
    return (
      <EmptyState size="md" art="board" title="Nothing on the board. Start with a reason the party would go somewhere." />
    );
  }
  return (
    <ul className="stagger-up grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {board.order.map((id) => {
        const node = board.nodes.find((entry) => entry.id === id);
        if (!node) {
          return null;
        }
        const line = excerpt(node.body);
        const links = LINK_FIELDS.flatMap(([field, bucket, , short]) => {
          const linked = node.links[field];
          if (!linked) {
            return [];
          }
          const entry = inventory[bucket].find((row) => row.id === linked);
          if (entry) {
            return [{ field, short, name: entry.name, from: entry.from ?? "", missing: false }];
          }
          return (broken[node.id] ?? []).includes(field)
            ? [{ field, short, name: "missing", from: "", missing: true }]
            : [];
        });
        const choices = node.out.filter((target) => routeOf(node, target) === "choice").length;
        const optional = node.out.filter((target) => routeOf(node, target) === "optional").length;
        return (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => onOpen(node)}
              aria-label={`Open ${node.title}`}
              className={cn(
                ui.cardHover,
                "flex h-full w-full flex-col gap-2 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
              )}
            >
              <span className="flex items-center gap-2">
                <GameIcon icon={{ kind: "glyph", key: KIND_GLYPH[node.kind] }} size="size-8" />
                <span
                  className={cn(
                    "w-fit rounded-sm border px-1.5 py-0.5 font-display text-[10px] tracking-wider",
                    KIND_CHIP[node.kind],
                  )}
                >
                  {BEAT_LABELS[node.kind]}
                </span>
              </span>
              <span className="font-display tracking-wide text-amber-50">{node.title}</span>
              {line ? <span className="line-clamp-1 text-sm text-stone-300">{line}</span> : null}
              {links.length ? (
                <span className="flex flex-wrap gap-1">
                  {links.map((link) => (
                    <span
                      key={link.field}
                      title={link.from ? `From ${link.from}` : undefined}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]",
                        link.missing ? "border-amber-500/50 text-amber-300" : "border-stone-700 text-stone-400",
                      )}
                    >
                      <GameIcon icon={{ kind: "glyph", key: LINK_GLYPH[link.field] }} size="size-4" />
                      <span className="text-stone-500">{link.short} </span>
                      {link.name}
                      {link.from ? <span className="text-sky-300/70"> (shared)</span> : null}
                    </span>
                  ))}
                </span>
              ) : null}
              <span className="mt-auto flex items-center gap-1 text-[11px] text-stone-500">
                <ArrowRight className="size-3" aria-hidden="true" />
                leads to {node.out.length}
                {choices ? <span className="text-amber-300/70"> · {choices} route{choices === 1 ? "" : "s"} to choose</span> : null}
                {optional ? <span className="text-sky-300/70"> · {optional} only if</span> : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
