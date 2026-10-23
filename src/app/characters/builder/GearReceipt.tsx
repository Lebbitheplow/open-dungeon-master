"use client";

import { Minus, Plus, X } from "lucide-react";
import { useState } from "react";
import { InfoButton } from "@/components/ui/InfoDialog";
import { contentSlug } from "@/lib/help";
import { formatPrice } from "@/lib/srd/currency";
import { formatCoin, MAX_QTY, stepDown, type Receipt, type ReceiptRow } from "./receiptMath";

export type ReceiptView = Receipt & { setQty: (name: string, qty: number) => void };

const signed = (value: number) => (value >= 0 ? `+${value}` : `${value}`);

// Free, bought, or both, in words a player reads at a glance.
function sourceLabel(row: ReceiptRow): string {
  if (row.refused) {
    return row.refused === "homebrew" ? "Granted in play" : row.refused === "magic" ? "Found in play" : "No listed price";
  }
  if (!row.bought) {
    return "Free from the kit";
  }
  return row.free ? `${row.free} free, ${row.bought} paid` : "Paid";
}

// The typed count. It commits on Enter or when focus leaves, so a 12 typed
// on the way through a 1 does not settle the kit's set first.
function QtyField({ row, onQty }: { row: ReceiptRow; onQty: (qty: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) {
      const parsed = Number.parseInt(draft, 10);
      onQty(Number.isNaN(parsed) ? row.qty : parsed);
      setDraft(null);
    }
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={MAX_QTY}
      value={draft ?? String(row.qty)}
      aria-label={`How many ${row.name}`}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          setDraft(null);
        }
      }}
      className="h-9 w-12 rounded-md border border-stone-700 bg-stone-950 text-center font-mono text-xs text-stone-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
    />
  );
}

// 36 px buttons whose hit area reaches 44 px (the builder's tap-target
// floor) without widening the column: after:-inset-1 adds 4 px a side.
const stepClass =
  "relative inline-flex size-9 after:absolute after:-inset-1 items-center justify-center rounded-md border border-stone-700 text-stone-300 hover:bg-stone-900 disabled:cursor-not-allowed disabled:opacity-40 motion-press";

// The gear receipt (backlog F14): one table of the pack with how many of
// each, what the kit gave free and what was paid, the price, and the coin
// left at the foot. Weapons carry their to-hit and damage under the name.
export default function GearReceipt({ receipt }: { receipt: ReceiptView }) {
  if (!receipt.rows.length) {
    return <p className="mt-2 text-xs text-stone-500">Nothing in the pack yet.</p>;
  }
  return (
    <div className="mt-2 rounded-lg border border-stone-800">
      <table className="w-full table-fixed text-left text-xs">
        <caption className="sr-only">Your gear: quantity, whether it is free or paid, price, and the coin left</caption>
        <thead className="border-b border-stone-800 text-[11px] text-stone-500">
          <tr>
            <th scope="col" className="px-2 py-1.5 font-normal">Item</th>
            <th scope="col" className="w-[8.5rem] px-1 py-1.5 font-normal">Quantity</th>
            <th scope="col" className="hidden w-28 px-2 py-1.5 font-normal sm:table-cell">Free or paid</th>
            <th scope="col" className="w-20 px-2 py-1.5 text-right font-normal">Price</th>
          </tr>
        </thead>
        <tbody>
          {receipt.rows.map((row) => {
            const homebrew = row.slug?.startsWith("homebrew:") ?? false;
            return (
              <tr key={row.name} className="border-b border-stone-900 align-top last:border-0">
                <td className="px-2 py-1.5">
                  <div className="flex items-start gap-1">
                    <span className="min-w-0 break-words text-stone-200">{row.name}</span>
                    {homebrew ? null : (
                      <InfoButton
                        label={row.name}
                        reference={{ kind: "items", slug: row.slug ?? contentSlug(row.name), name: row.name }}
                      />
                    )}
                  </div>
                  {row.weapon ? (
                    <p className="mt-0.5 font-mono text-[11px] text-amber-200/80">
                      {signed(row.weapon.toHit)} to hit, {row.weapon.damage} {row.weapon.damageType}
                      {row.weapon.notes.length ? (
                        <span className="font-sans text-stone-500">. {row.weapon.notes.join(". ")}.</span>
                      ) : null}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-[11px] text-stone-500 sm:hidden">{sourceLabel(row)}</p>
                </td>
                <td className="px-1 py-1">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className={stepClass}
                      aria-label={
                        stepDown(row) === 0 && row.qty > 1
                          ? `Remove the kit's ${row.qty} ${row.name}`
                          : `One fewer ${row.name}`
                      }
                      title={stepDown(row) === 0 && row.qty > 1 ? "The kit's copies come and go together." : undefined}
                      onClick={() => receipt.setQty(row.name, stepDown(row))}
                    >
                      <Minus className="size-3.5" />
                    </button>
                    <QtyField row={row} onQty={(qty) => receipt.setQty(row.name, qty)} />
                    <button
                      type="button"
                      className={stepClass}
                      aria-label={`One more ${row.name}`}
                      disabled={row.qty >= MAX_QTY}
                      onClick={() => receipt.setQty(row.name, row.qty + 1)}
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                </td>
                <td className="hidden px-2 py-1.5 text-stone-400 sm:table-cell">
                  <span className={row.refused ? "text-amber-300" : undefined}>{sourceLabel(row)}</span>
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-stone-300">
                  <div className="flex items-start justify-end gap-1">
                    <span>
                      {row.bought && row.unitCopper !== null && !row.refused ? formatPrice(row.costCopper) : row.bought ? "—" : "free"}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove all ${row.name}`}
                      onClick={() => receipt.setQty(row.name, 0)}
                      className="relative -mr-1 inline-flex size-6 after:absolute after:-inset-2.5 items-center justify-center rounded text-stone-500 hover:bg-stone-900 hover:text-stone-200"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                  {row.bought > 1 && row.unitCopper !== null && !row.refused ? (
                    <p className="text-[10px] text-stone-500">{formatPrice(row.unitCopper)} each</p>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t border-stone-800 font-mono text-stone-300">
          <tr>
            <th scope="row" colSpan={2} className="px-2 pt-1.5 text-left font-sans font-normal text-stone-500">
              Starting coin
            </th>
            <td className="hidden sm:table-cell" />
            <td className="px-2 pt-1.5 text-right">{formatCoin(receipt.coinCopper)}</td>
          </tr>
          <tr>
            <th scope="row" colSpan={2} className="px-2 text-left font-sans font-normal text-stone-500">
              Spent
            </th>
            <td className="hidden sm:table-cell" />
            <td className="px-2 text-right">{formatPrice(receipt.spentCopper)}</td>
          </tr>
          <tr>
            <th scope="row" colSpan={2} className="px-2 pb-1.5 text-left font-sans font-normal text-stone-400">
              Coin left
            </th>
            <td className="hidden sm:table-cell" />
            <td key={receipt.leftCopper} className="reveal px-2 pb-1.5 text-right text-sm text-amber-200">
              {formatCoin(receipt.leftCopper)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
