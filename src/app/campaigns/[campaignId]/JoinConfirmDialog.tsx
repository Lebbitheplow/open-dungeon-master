"use client";

import { Check, Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { refusalText } from "@/app/characters/builder/refusal";
import type { JoinPreview } from "@/lib/characters/join-changes";
import type { CreateSheetInput } from "@/lib/schemas/sheet";

// A hero about to take a seat: one from the player's library (their own, or
// a pregen an adventure brought), a ready-made starter, or one the builder
// just made for this table ("Help me build"), not stored until it seats.
export type JoinHero =
  | { kind: "library" | "pregen"; id: string; name: string }
  | { kind: "built"; id: string; name: string; sheet: CreateSheetInput };

// What the preview and the join are asked about this hero.
function previewBody(hero: JoinHero, flow: "join" | "replace") {
  if (hero.kind === "built") return { sheet: hero.sheet, flow };
  return hero.kind === "library" ? { libraryCharacterId: hero.id, flow } : { pregenId: hero.id, flow };
}

type Preview = JoinPreview & { alreadyHere: boolean };

// The confirm sheet before a hero takes its seat (backlog F6). It shows the
// hero at the table's level, what joining changes, and the table's rules
// check, all answered by the server from the code the join itself runs
// (POST /sheet/preview, src/lib/characters/seat-preview.ts). Cancel changes
// nothing; Take the seat is the join.
//
// The choices the level earned and the hero has not made (a subclass, an
// Ability Score Improvement) are listed, not picked here: the level-up
// dialog that takes them works on a seated sheet, and the first level-up at
// the table offers every one of them (src/lib/srd/owed-choices.ts).
export function JoinConfirmDialog({
  campaignId,
  hero,
  flow = "join",
  onClose,
  onSeated,
}: {
  campaignId: string;
  // The hero being confirmed; null keeps the sheet closed.
  hero: JoinHero | null;
  // join = a first seat; replace = a lobby switch from the current hero.
  flow?: "join" | "replace";
  onClose: () => void;
  onSeated: () => void;
}) {
  // The server's answer, kept with the hero it answers for: a sheet opened
  // on another hero shows its own check, never the last one's.
  const heroKey = hero ? `${hero.kind}:${hero.id}:${flow}` : "";
  const [answer, setAnswer] = useState<{ key: string; preview?: Preview; error?: string } | null>(null);
  const current = answer && answer.key === heroKey ? answer : null;
  const preview = current?.preview ?? null;
  const loadError = current?.error ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hero) {
      return;
    }
    let cancelled = false;
    const key = `${hero.kind}:${hero.id}:${flow}`;
    fetch(`/api/campaigns/${campaignId}/sheet/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(previewBody(hero, flow)),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (cancelled) {
          return;
        }
        if (!response.ok || !data.preview) {
          setAnswer({ key, error: refusalText(data, "Could not check this hero against the table.") });
          return;
        }
        setAnswer({ key, preview: data.preview });
      })
      .catch(() => {
        if (!cancelled) setAnswer({ key, error: "Could not reach the server." });
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, hero, flow]);

  async function confirm() {
    if (!hero) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response =
        hero.kind !== "pregen"
          ? await fetch(`/api/campaigns/${campaignId}/sheet`, {
              method: flow === "join" ? "POST" : "PUT",
              headers: { "Content-Type": "application/json" },
              // A built hero is stored as it seats, in the library too.
              body: JSON.stringify(hero.kind === "built" ? hero.sheet : { libraryCharacterId: hero.id }),
            })
          : await fetch(`/api/campaigns/${campaignId}/sheet/pregen`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: hero.id }),
            });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(refusalText(data, "Could not seat that hero."));
        return;
      }
      onSeated();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setError("");
    onClose();
  }

  const name = preview?.name || hero?.name || "this hero";
  return (
    <Dialog
      open={hero !== null}
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
      title={flow === "replace" ? `Switch to ${name}?` : `Take ${name} to the table?`}
    >
      <div className="space-y-4 text-sm" data-join-confirm aria-busy={!preview && !loadError}>
        {!preview && !loadError ? (
          <p className="flex items-center gap-2 text-stone-400">
            <Loader2 className="size-4 animate-spin" /> Checking {name} against this table…
          </p>
        ) : null}
        {loadError ? (
          <p className="whitespace-pre-line text-red-400" role="alert">
            {loadError}
          </p>
        ) : null}
        {preview ? (
          <>
            <section className="space-y-1.5">
              <h3 className={ui.sectionEyebrow}>At this table</h3>
              {preview.alreadyHere ? (
                <p className="text-stone-300">{name} is already at this table. Joining picks them again and changes nothing.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-5 text-stone-300" data-join-changes>
                  {preview.changes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
              {preview.rollsHp ? (
                <p className="text-xs text-stone-400">
                  This table rolls hit points, so they are rolled {hero?.kind === "built" ? "" : "again "}when {name} takes the seat.
                </p>
              ) : null}
            </section>

            <section className="space-y-1.5" data-join-rules={preview.ok ? "pass" : "fail"}>
              <h3 className={ui.sectionEyebrow}>Table rules</h3>
              {preview.ok ? (
                <p className="flex items-center gap-2 text-emerald-300">
                  <Check className="size-4 shrink-0" /> Within this table&apos;s rules.
                </p>
              ) : (
                <div className="space-y-1 text-red-300" role="alert">
                  <p className="flex items-center gap-2">
                    <TriangleAlert className="size-4 shrink-0" /> {name} cannot take a seat here yet.
                  </p>
                  <ul className="list-disc space-y-1 pl-5">
                    {preview.problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {preview.ok && preview.owed.length ? (
              <section className="space-y-1.5" data-join-owed>
                <h3 className={ui.sectionEyebrow}>Choices still to make</h3>
                <ul className="list-disc space-y-1 pl-5 text-amber-100">
                  {preview.owed.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="text-xs text-stone-400">
                  This level earned them and {name} has not made them yet. The first level-up at this table offers every one, with the usual pickers, and the character sheet lists them until then.
                </p>
              </section>
            ) : null}
          </>
        ) : null}

        {error ? (
          <p className="motion-shake whitespace-pre-line text-red-400" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button type="button" onClick={close} disabled={busy} className={ui.btnSecondary}>
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy || !preview?.ok}
            aria-busy={busy}
            className={cn(ui.btnPrimary)}
            data-join-take
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {flow === "replace" ? `Switch to ${name}` : "Take the seat"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
