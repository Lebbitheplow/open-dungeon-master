"use client";

import { Eye, VenetianMask } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { KitButton, PanelError } from "./PanelKit";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A player's own pact (issue 503 Phase 7), at the top of their Bonds tab:
// who is in it, who leads, what it plans and when, and that character's own
// secret actions, read from GET /pact, which answers for the viewer's own
// characters alone. A member acts in secret from here: the server holds the
// action and rolls it where only they and the storyteller see
// (POST /actions, secret mode), and the confirmation comes back to them
// alone, never to the table. It comes out when the pact moves or someone
// catches it, as a reveal card in the transcript (MessageParts.tsx).
// Whoever runs the story reads every pact here, without the form.

type OwnSecret = { id: string; kind: string; text: string; total: number; revealed: boolean; caught: boolean };
type PactView = {
  id: string;
  characterId: string;
  characterName: string;
  stance: "joined" | "spy";
  members: string[];
  leader: string;
  plan: string;
  status: string;
  secrets: OwnSecret[];
  kinds: string[];
};

const KIND_TEXT: Record<string, { label: string; hint: string }> = {
  steal: { label: "Steal", hint: "Take something from another character's pack. It leaves their pack now." },
  scheme: { label: "Quiet scheme", hint: "Something harmless, done where nobody sees." },
  harm: { label: "Do harm", hint: "Sabotage that hurts the party. Resolved when the pact moves." },
  attack: { label: "Strike when it moves", hint: "Turn on another player's character, in a fight, as the pact makes its move." },
};

const SKILLS = [
  { id: "stealth", label: "Stealth" },
  { id: "sleight_of_hand", label: "Sleight of Hand" },
  { id: "deception", label: "Deception" },
];

export function OwnPacts({ campaignId, refreshKey, sheets, meUserId }: { campaignId: string; refreshKey: number; sheets: CharacterSheet[]; meUserId: string }) {
  const [pacts, setPacts] = useState<PactView[]>([]);
  const [all, setAll] = useState<PactView[]>([]);
  // Bumped after a secret action, so the list reads it back.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fetch(`/api/campaigns/${campaignId}/pact`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (live && data) {
          setPacts(Array.isArray(data.pacts) ? data.pacts : []);
          setAll(Array.isArray(data.all) ? data.all : []);
        }
      })
      .catch(() => {
        // The tab keeps what it last read.
      });
    return () => {
      live = false;
    };
  }, [campaignId, refreshKey, tick]);
  const load = () => setTick((value) => value + 1);

  if (!pacts.length && !all.length) {
    return null;
  }
  return (
    <div className="space-y-2">
      {pacts.map((pact) => (
        <PactCard key={`${pact.id}-${pact.characterId}`} campaignId={campaignId} pact={pact} sheets={sheets} meUserId={meUserId} onDone={load} />
      ))}
      {all.map((pact) => (
        <section key={pact.id} className="panel rounded-lg border-violet-900/40 px-2.5 py-2 text-xs text-stone-300" data-pact-storyteller={pact.id}>
          <p className="flex items-center gap-1.5 text-violet-200">
            <Eye className="size-3.5" aria-hidden="true" />A pact ({pact.status}): {pact.members.join(", ")}
          </p>
          <p className="mt-0.5">Led by {pact.leader || "nobody yet"}; means to {pact.plan}.</p>
          <span className="sr-only">Only whoever runs the story sees this.</span>
        </section>
      ))}
    </div>
  );
}

function PactCard({ campaignId, pact, sheets, meUserId, onDone }: { campaignId: string; pact: PactView; sheets: CharacterSheet[]; meUserId: string; onDone: () => void }) {
  return (
    <section className="panel ornate rounded-lg border-violet-400/40 px-2.5 py-2 text-xs" data-own-pact={pact.id} aria-label={`${pact.characterName}'s pact`}>
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-violet-100">
        <VenetianMask className="size-3.5 shrink-0 text-violet-300" aria-hidden="true" />
        {pact.stance === "spy" ? `${pact.characterName} is playing along with a pact` : `${pact.characterName} is in a pact`}
      </p>
      <p className="mt-1 leading-5 text-stone-300">
        With {pact.members.filter((name) => name !== pact.characterName).join(", ")}, led by {pact.leader}. They mean to {pact.plan}.
      </p>
      <p className="mt-0.5 text-[11px] text-stone-500">Only you see this.</p>
      {pact.secrets.length ? (
        <ul className="mt-1.5 space-y-1" aria-label="Your secret actions">
          {pact.secrets.map((secret) => (
            <li key={secret.id} className="flex items-start gap-1.5 text-stone-300" data-own-secret={secret.revealed ? "out" : "held"}>
              <span className={cn("mt-0.5 shrink-0 rounded-full border px-1.5 text-[10px]", secret.caught ? "border-red-800/60 text-red-300" : secret.revealed ? "border-stone-700 text-stone-400" : "border-violet-700/60 text-violet-200")}>
                {secret.caught ? "caught" : secret.revealed ? "out" : "held"}
              </span>
              <span className="min-w-0">
                {secret.text} ({secret.total})
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {pact.status === "forming" && pact.kinds.length ? <SecretActionForm campaignId={campaignId} pact={pact} sheets={sheets} meUserId={meUserId} onDone={onDone} /> : null}
    </section>
  );
}

function SecretActionForm({ campaignId, pact, sheets, meUserId, onDone }: { campaignId: string; pact: PactView; sheets: CharacterSheet[]; meUserId: string; onDone: () => void }) {
  const ids = useId();
  const [kind, setKind] = useState(pact.kinds[0] ?? "scheme");
  const [text, setText] = useState("");
  const [skill, setSkill] = useState("stealth");
  const [targetId, setTargetId] = useState("");
  const [item, setItem] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{ text: string; caught: boolean } | null>(null);
  const others = sheets.filter((sheet) => !sheet.isCompanion && !sheet.summon && sheet.id !== pact.characterId && sheet.userId !== meUserId);
  const target = others.find((sheet) => sheet.id === targetId);
  const needsTarget = kind === "steal" || kind === "attack";
  const ready = !busy && (!needsTarget || Boolean(target)) && (kind !== "steal" || Boolean(item)) && (needsTarget || Boolean(text.trim()));

  async function submit() {
    setBusy(true);
    setError("");
    setConfirmation(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterId: pact.characterId,
          secret: { kind, text: text.trim(), ...(kind === "scheme" || kind === "harm" ? { skill } : {}), ...(needsTarget ? { targetId } : {}), ...(kind === "steal" ? { item } : {}) },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(String(data.error ?? "That did not work."));
        return;
      }
      setConfirmation(data.caught ? { text: `Caught: ${String(data.revealed ?? "")}`, caught: true } : { text: String(data.confirmation ?? "Done in secret."), caught: false });
      setText("");
      setItem("");
      onDone();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="mt-2 space-y-1.5 border-t border-violet-900/40 pt-2"
      aria-label={`Act in secret as ${pact.characterName}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) {
          void submit();
        }
      }}
      data-secret-form={pact.characterId}
    >
      <fieldset>
        <legend className="eyebrow text-[10px] text-violet-300">Act in secret</legend>
        <div className="mt-1 grid gap-1 sm:grid-cols-2" role="radiogroup" aria-label="What you do">
          {pact.kinds.map((option) => (
            <label key={option} className={cn("pk-tap flex min-h-10 cursor-pointer items-start gap-1.5 rounded-md border px-2 py-1.5 focus-within:ring-2 focus-within:ring-violet-400/70", kind === option ? "border-violet-400/60 bg-violet-950/40 text-violet-100" : "border-stone-800 text-stone-300")}>
              <input type="radio" name={`${ids}-kind`} value={option} checked={kind === option} onChange={() => setKind(option)} className="mt-0.5 accent-violet-400" />
              <span>
                <span className="block text-[12px]">{KIND_TEXT[option]?.label ?? option}</span>
                <span className="block text-[11px] leading-snug text-stone-400">{KIND_TEXT[option]?.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {needsTarget ? (
        <label className="block">
          <span className="text-[11px] text-stone-400">{kind === "steal" ? "From whom" : "Whom"}</span>
          <select className={cn(ui.input, "mt-0.5 min-h-10 text-xs")} value={targetId} onChange={(event) => { setTargetId(event.target.value); setItem(""); }} data-secret-target="">
            <option value="">Choose a character</option>
            {others.map((sheet) => (
              <option key={sheet.id} value={sheet.id}>{sheet.name}</option>
            ))}
          </select>
        </label>
      ) : null}
      {kind === "steal" && target ? (
        <label className="block">
          <span className="text-[11px] text-stone-400">What</span>
          <select className={cn(ui.input, "mt-0.5 min-h-10 text-xs")} value={item} onChange={(event) => setItem(event.target.value)} data-secret-item="">
            <option value="">Choose an item</option>
            {target.equipment.map((line) => (
              <option key={line.name} value={line.name}>{line.name}</option>
            ))}
          </select>
        </label>
      ) : null}
      {kind === "scheme" || kind === "harm" ? (
        <label className="block">
          <span className="text-[11px] text-stone-400">Rolled with</span>
          <select className={cn(ui.input, "mt-0.5 min-h-10 text-xs")} value={skill} onChange={(event) => setSkill(event.target.value)}>
            {SKILLS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="block">
        <span className="text-[11px] text-stone-400">{needsTarget ? "In your words (optional)" : "What you do"}</span>
        <input className={cn(ui.input, "mt-0.5 min-h-10 text-xs")} value={text} maxLength={300} onChange={(event) => setText(event.target.value)} placeholder="Loosen the cart's wheel" data-secret-text="" />
      </label>
      <div className="flex items-center justify-end">
        <KitButton type="submit" tone="primary" className="min-h-10 px-4" disabled={!ready} busy={busy}>
          {busy ? null : <VenetianMask className="size-3.5" aria-hidden="true" />}
          Do it in secret
        </KitButton>
      </div>
      {error ? <PanelError>{error}</PanelError> : null}
      <p role="status" aria-live="polite" className={cn("text-xs leading-5", confirmation ? "secret-confirm" : "sr-only", confirmation?.caught ? "text-red-300" : "text-violet-200")} data-secret-confirm={confirmation ? (confirmation.caught ? "caught" : "held") : undefined}>
        {confirmation?.text ?? ""}
      </p>
    </form>
  );
}
