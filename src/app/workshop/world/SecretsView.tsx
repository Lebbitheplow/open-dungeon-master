"use client";

import { Check, Eye, EyeOff, Lock, Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { KitButton } from "@/app/campaigns/[campaignId]/PanelKit";
import { newId, type Secret } from "@/lib/worldforge/model";
import type { WorldEntity } from "@/lib/db/world-forge";
import type { WorldApi, WorldState } from "./useWorld";
import { EntityAvatar, EntityPicker, typeOf } from "./world-ui";

// Secrets, after WorldForge's knowledge tracker, turned to the table: what
// the secret is, whom it is about, who in the world keeps it, and whether
// the party has learned it. The AI DM is told the ones the party has not,
// with their keepers, so a keeper can let one slip; marking it learned takes
// it out of that list.

const blank = (): Secret => ({ id: "", title: "", subject: "", notes: "", knownBy: [], partyKnows: false });

export function SecretsView({ api, world, onOpen }: { api: WorldApi; world: WorldState; onOpen: (ref: string) => void }) {
  const { doc, entities } = world;
  const [editing, setEditing] = useState<Secret | null>(null);
  const byRef = useMemo(() => new Map(entities.map((entity) => [entity.ref, entity])), [entities]);
  const open = doc.secrets.filter((secret) => !secret.partyKnows);
  const learned = doc.secrets.filter((secret) => secret.partyKnows);

  async function save(secret: Secret) {
    const id = secret.id || newId("sec");
    await api.patch({ secrets: [...doc.secrets.filter((entry) => entry.id !== id), { ...secret, id }] });
    setEditing(null);
  }

  const person = (ref: string) => {
    const entity = byRef.get(ref);
    return entity ? (
      <button key={ref} type="button" onClick={() => onOpen(ref)} className="pk-chip motion-press text-[11px]">
        <EntityAvatar entity={entity} type={typeOf(doc, entity)} size="size-4" /> {entity.name}
      </button>
    ) : null;
  };

  const card = (secret: Secret) =>
    editing?.id === secret.id ? (
      <SecretForm key={secret.id} secret={editing} world={world} onSave={save} onCancel={() => setEditing(null)} />
    ) : (
      <li key={`${secret.id}-${secret.partyKnows}`} className={cn("panel wf-flip rounded-lg p-3", secret.partyKnows && "opacity-75")}>
        <div className="flex flex-wrap items-start gap-2">
          <Lock className={cn("mt-0.5 size-4 shrink-0", secret.partyKnows ? "text-stone-500" : "text-red-400")} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-stone-100">{secret.title}</p>
            {secret.subject && byRef.get(secret.subject) ? <p className="text-[11px] text-stone-500">About {byRef.get(secret.subject)!.name}</p> : null}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={secret.partyKnows}
            onClick={() => save({ ...secret, partyKnows: !secret.partyKnows })}
            className={cn(ui.btnSmall, "px-2 py-1 text-xs", secret.partyKnows && "border-emerald-600/50 text-emerald-200")}
            title={secret.partyKnows ? "The party has learned it" : "The party does not know it yet"}
          >
            {secret.partyKnows ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
            {secret.partyKnows ? "The party knows" : "The party does not know"}
          </button>
          <KitButton tone="icon" aria-label={`Edit ${secret.title}`} onClick={() => setEditing(secret)}>
            <Pencil className="size-3.5" />
          </KitButton>
          <KitButton tone="iconDanger" aria-label={`Delete ${secret.title}`} onClick={() => api.patch({ secrets: doc.secrets.filter((entry) => entry.id !== secret.id) })}>
            <Trash2 className="size-3.5" />
          </KitButton>
        </div>
        {secret.notes ? <p className="mt-1.5 whitespace-pre-wrap text-sm text-stone-300">{secret.notes}</p> : null}
        {secret.knownBy.length ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="text-[11px] text-stone-500">Kept by</span>
            {secret.knownBy.map(person)}
          </div>
        ) : null}
      </li>
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-stone-400">
          {open.length} secret{open.length === 1 ? "" : "s"} the party does not know{learned.length ? `, ${learned.length} learned` : ""}. The AI DM is told the ones not yet learned, and who keeps each.
        </p>
        <KitButton tone="primary" onClick={() => setEditing(blank())} data-tour="world-new-secret">
          <Plus className="size-3.5" /> New secret
        </KitButton>
      </div>
      {editing && !editing.id ? <SecretForm secret={editing} world={world} onSave={save} onCancel={() => setEditing(null)} /> : null}
      <ul className="flex flex-col gap-2">{open.map(card)}</ul>
      {learned.length ? (
        <>
          <h3 className="eyebrow mt-2 text-[10px] text-stone-500">Learned by the party</h3>
          <ul className="flex flex-col gap-2">{learned.map(card)}</ul>
        </>
      ) : null}
      {doc.secrets.length === 0 && !editing ? <p className="text-sm text-stone-500">No secrets yet. Every world has some.</p> : null}
    </div>
  );
}

function SecretForm({ secret, world, onSave, onCancel }: { secret: Secret; world: WorldState; onSave: (secret: Secret) => void; onCancel: () => void }) {
  const { doc, entities } = world;
  const [draft, setDraft] = useState(secret);
  const [picking, setPicking] = useState<"subject" | "keepers" | null>(null);
  const subject = entities.find((entity) => entity.ref === draft.subject);
  const chip = (entity: WorldEntity, onRemove: () => void) => (
    <button key={entity.ref} type="button" onClick={onRemove} className="pk-chip motion-pop text-[11px]" aria-label={`Take ${entity.name} off`}>
      <EntityAvatar entity={entity} type={typeOf(doc, entity)} size="size-4" /> {entity.name} <X className="size-3" />
    </button>
  );
  return (
    <form className="panel motion-pop flex flex-col gap-2 rounded-lg p-3" onSubmit={(event) => { event.preventDefault(); if (draft.title.trim()) onSave(draft); }}>
      <input className={ui.input} placeholder="The warden sold the codes" aria-label="The secret" maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} autoFocus />
      <textarea className={cn(ui.input, "min-h-16")} placeholder="What it means, and how it might come out" aria-label="More about it" maxLength={4_000} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
      <div className="flex flex-wrap items-center gap-1">
        <span className="eyebrow w-16 text-[10px] text-stone-500">About</span>
        {subject ? chip(subject, () => setDraft({ ...draft, subject: "" })) : null}
        <KitButton tone="link" onClick={() => setPicking(picking === "subject" ? null : "subject")}>{subject ? "Change" : "Pick"}</KitButton>
      </div>
      {picking === "subject" ? <EntityPicker doc={doc} entities={entities} chosen={[draft.subject]} label="whom it is about" onPick={(entity) => { setDraft({ ...draft, subject: entity.ref }); setPicking(null); }} /> : null}
      <div className="flex flex-wrap items-center gap-1">
        <span className="eyebrow w-16 text-[10px] text-stone-500">Kept by</span>
        {draft.knownBy.map((ref) => {
          const entity = entities.find((entry) => entry.ref === ref);
          return entity ? chip(entity, () => setDraft({ ...draft, knownBy: draft.knownBy.filter((entry) => entry !== ref) })) : null;
        })}
        <KitButton tone="link" onClick={() => setPicking(picking === "keepers" ? null : "keepers")}><Plus className="size-3.5" /> Add</KitButton>
      </div>
      {picking === "keepers" ? (
        <EntityPicker doc={doc} entities={entities} chosen={draft.knownBy} label="who keeps it" onPick={(entity) => setDraft({ ...draft, knownBy: draft.knownBy.includes(entity.ref) ? draft.knownBy.filter((entry) => entry !== entity.ref) : [...draft.knownBy, entity.ref] })} />
      ) : null}
      <div className="flex justify-end gap-1.5">
        <KitButton tone="small" onClick={onCancel}><X className="size-3.5" /> Cancel</KitButton>
        <KitButton tone="primary" type="submit" disabled={!draft.title.trim()}><Check className="size-3.5" /> Save secret</KitButton>
      </div>
    </form>
  );
}
