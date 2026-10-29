"use client";

import { Check, Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { refusalText } from "@/app/characters/builder/refusal";
import {
  EMPTY_DRAFT,
  OwedPicksFields,
  picksFromDraft,
  useFeatDescOf,
  type PicksDraft,
} from "@/app/campaigns/[campaignId]/OwedPicksFields";
import type { SeatPicks } from "@/lib/characters/seat-picks";
import type { JoinPreview } from "@/lib/characters/join-changes";
import type { CreateSheetInput } from "@/lib/schemas/sheet";

// A hero about to take a seat: one from the player's library (their own, or
// a pregen an adventure brought), a ready-made starter, a pregen the table's
// DM offers its players (src/lib/db/pregen-offers.ts), or one the builder
// just made for this table ("Help me build"), not stored until it seats.
export type JoinHero =
  | { kind: "library" | "pregen" | "offered"; id: string; name: string }
  | { kind: "built"; id: string; name: string; sheet: CreateSheetInput };

// What the preview and the join are asked about this hero.
function previewBody(hero: JoinHero, flow: "join" | "replace", picks: SeatPicks | null) {
  if (hero.kind === "built") return { sheet: hero.sheet, flow };
  const withPicks = picks ? { picks } : {};
  if (hero.kind === "offered") return { offeredPregenId: hero.id, flow, ...withPicks };
  return hero.kind === "library" ? { libraryCharacterId: hero.id, flow, ...withPicks } : { pregenId: hero.id, flow, ...withPicks };
}

// The join itself: the route each kind of hero seats by.
function joinRequest(campaignId: string, hero: JoinHero, flow: "join" | "replace", picks: SeatPicks | null) {
  const withPicks = picks ? { picks } : {};
  if (hero.kind === "pregen" || hero.kind === "offered") {
    return {
      url: `/api/campaigns/${campaignId}/sheet/${hero.kind === "pregen" ? "pregen" : "offered"}`,
      method: "POST",
      body: { id: hero.id, ...withPicks },
    };
  }
  return {
    url: `/api/campaigns/${campaignId}/sheet`,
    method: flow === "join" ? "POST" : "PUT",
    // A built hero is stored as it seats, in the library too.
    body: hero.kind === "built" ? hero.sheet : { libraryCharacterId: hero.id, ...withPicks },
  };
}

type Preview = JoinPreview & { alreadyHere: boolean };

async function askPreview(campaignId: string, body: unknown): Promise<{ preview?: Preview; error?: string }> {
  try {
    const response = await fetch(`/api/campaigns/${campaignId}/sheet/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.preview) {
      return { error: refusalText(data, "Could not check this hero against the table.") };
    }
    return { preview: data.preview };
  } catch {
    return { error: "Could not reach the server." };
  }
}

// The confirm sheet before a hero takes its seat (backlog F6). It shows the
// hero at the table's level, what joining changes, and the table's rules
// check, all answered by the server from the code the join itself runs
// (POST /sheet/preview, src/lib/characters/seat-preview.ts). Cancel changes
// nothing; Take the seat is the join.
//
// The choices the level earned and the hero has not made (a subclass, an
// Ability Score Improvement, class skills, expertise) are picked here with
// the level-up's own pickers (OwedPicksFields.tsx), or left: whatever is
// left stays owed, and the first level-up at the table offers it
// (src/lib/srd/owed-choices.ts). The picks are checked by the same preview
// as the player makes them, and the join applies them through the same
// admit path (src/lib/characters/seat-picks.ts).
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
  // The owed choices picked so far, for this hero only.
  const [draftOf, setDraftOf] = useState<{ key: string; draft: PicksDraft }>({ key: "", draft: EMPTY_DRAFT });
  const draft = draftOf.key === heroKey ? draftOf.draft : EMPTY_DRAFT;
  const featDescOf = useFeatDescOf(draft);
  const owed = hero && hero.kind !== "built" ? (preview?.picks ?? null) : null;
  const picks = picksFromDraft(owed, draft, featDescOf);
  const picksKey = picks ? JSON.stringify(picks) : "";
  // The table's check of the hero with the picks made: the same preview,
  // asked again as they change. The pickers stay on the first answer.
  const [checked, setChecked] = useState<{ key: string; preview?: Preview; error?: string } | null>(null);
  const check = picksKey ? (checked && checked.key === `${heroKey}|${picksKey}` ? checked : null) : null;
  const shown = picksKey ? (check?.preview ?? null) : preview;
  const checking = Boolean(picksKey) && !check;

  useEffect(() => {
    if (!hero) {
      return;
    }
    let cancelled = false;
    const key = `${hero.kind}:${hero.id}:${flow}`;
    void askPreview(campaignId, previewBody(hero, flow, null)).then((result) => {
      if (!cancelled) setAnswer({ key, ...result });
    });
    return () => {
      cancelled = true;
    };
  }, [campaignId, hero, flow]);

  useEffect(() => {
    if (!hero || !picksKey) {
      return;
    }
    let cancelled = false;
    const key = `${hero.kind}:${hero.id}:${flow}|${picksKey}`;
    // A short wait, so a run of clicks asks once.
    const timer = setTimeout(() => {
      void askPreview(campaignId, previewBody(hero, flow, JSON.parse(picksKey) as SeatPicks)).then((result) => {
        if (!cancelled) setChecked({ key, ...result });
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [campaignId, hero, flow, picksKey]);

  async function confirm() {
    if (!hero) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const request = joinRequest(campaignId, hero, flow, picks);
      const response = await fetch(request.url, {
        method: request.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body),
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
    setDraftOf({ key: "", draft: EMPTY_DRAFT });
    onClose();
  }

  const name = preview?.name || hero?.name || "this hero";
  const owedLeft = shown?.owed ?? preview?.owed ?? [];
  return (
    <Dialog
      open={hero !== null}
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
      title={flow === "replace" ? `Switch to ${name}?` : `Take ${name} to the table?`}
    >
      <div className="space-y-4 text-sm" data-join-confirm aria-busy={(!preview && !loadError) || checking}>
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
                  {(shown ?? preview).changes.map((line) => (
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

            {owed && !preview.alreadyHere && preview.ok ? (
              <section className="space-y-2" data-join-owed>
                <h3 className={ui.sectionEyebrow}>Choices to make now</h3>
                <p className="text-xs text-stone-400">
                  This level earned them and {name} has not made them yet. Pick them here, or leave any of them: the first level-up at this table offers what is left, and the character sheet lists it until then.
                </p>
                <OwedPicksFields
                  owed={owed}
                  name={name}
                  draft={draft}
                  onChange={(next) => setDraftOf({ key: heroKey, draft: next })}
                  featDescOf={featDescOf}
                />
              </section>
            ) : null}

            {checking ? (
              <p className="flex items-center gap-2 text-stone-400" data-join-rules="checking">
                <Loader2 className="size-4 animate-spin" /> Checking the picks…
              </p>
            ) : check?.error ? (
              <p className="whitespace-pre-line text-red-400" role="alert">
                {check.error}
              </p>
            ) : shown ? (
              <section className="space-y-1.5" data-join-rules={shown.ok ? "pass" : "fail"}>
                <h3 className={ui.sectionEyebrow}>Table rules</h3>
                {shown.ok ? (
                  <p className="flex items-center gap-2 text-emerald-300">
                    <Check className="size-4 shrink-0" /> Within this table&apos;s rules{picks ? ", with these picks" : ""}.
                  </p>
                ) : (
                  <div className="space-y-1 text-red-300" role="alert">
                    <p className="flex items-center gap-2">
                      <TriangleAlert className="size-4 shrink-0" /> {name} cannot take a seat here {picks && preview.ok ? "with these picks" : "yet"}.
                    </p>
                    <ul className="list-disc space-y-1 pl-5">
                      {shown.problems.map((problem) => (
                        <li key={problem}>{problem}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            ) : null}

            {shown?.ok && owedLeft.length && !owed ? (
              <section className="space-y-1.5" data-join-owed-left>
                <h3 className={ui.sectionEyebrow}>Choices still to make</h3>
                <ul className="list-disc space-y-1 pl-5 text-amber-100">
                  {owedLeft.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="text-xs text-stone-400">
                  This level earned them and {name} has not made them yet. The first level-up at this table offers every one, with the usual pickers, and the character sheet lists them until then.
                </p>
              </section>
            ) : shown?.ok && owed && owedLeft.length ? (
              <p className="text-xs text-amber-100" data-join-owed-left>
                Left for the first level-up: {owedLeft.join("; ")}.
              </p>
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
            disabled={busy || checking || !shown?.ok}
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
