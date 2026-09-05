"use client";

import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { BEAT_LABELS, type Board, type BoardInventory, type BoardNode } from "@/lib/workshop/board";
import { KIND_CHIP, LINK_FIELDS } from "@/app/workshop/storyboard/beat-fields";

// The workshop's storyboard: every card as a card. Kind chip, title, the
// first line of what happens, a chip per thing it points at, and how many
// cards it leads to. Tapping one hands it to the caller, which opens the
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
  onOpen,
}: {
  board: Board;
  inventory: BoardInventory;
  onOpen: (node: BoardNode) => void;
}) {
  if (board.nodes.length === 0) {
    return (
      <p className="text-xs text-stone-500">
        Nothing on the board. Start with a reason the party would go somewhere.
      </p>
    );
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {board.order.map((id) => {
        const node = board.nodes.find((entry) => entry.id === id);
        if (!node) {
          return null;
        }
        const line = excerpt(node.body);
        const links = LINK_FIELDS.flatMap(([field, bucket, , short]) => {
          const linked = node.links[field];
          const name = linked ? inventory[bucket].find((entry) => entry.id === linked)?.name : "";
          return name ? [{ field, short, name }] : [];
        });
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
              <span
                className={cn(
                  "w-fit rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                  KIND_CHIP[node.kind],
                )}
              >
                {BEAT_LABELS[node.kind]}
              </span>
              <span className="font-display tracking-wide text-amber-50">{node.title}</span>
              {line ? <span className="line-clamp-1 text-sm text-stone-300">{line}</span> : null}
              {links.length ? (
                <span className="flex flex-wrap gap-1">
                  {links.map((link) => (
                    <span
                      key={link.field}
                      className="rounded-md border border-stone-700 px-1.5 py-0.5 text-[10px] text-stone-400"
                    >
                      <span className="text-stone-600">{link.short} </span>
                      {link.name}
                    </span>
                  ))}
                </span>
              ) : null}
              <span className="mt-auto flex items-center gap-1 text-[11px] text-stone-500">
                <ArrowRight className="size-3" aria-hidden="true" />
                leads to {node.out.length}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
