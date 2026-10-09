"use client";

import { ArrowLeft, Brush, ExternalLink, EyeOff, Lock, Pencil, Plus, Theater, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { KitButton } from "@/app/campaigns/[campaignId]/PanelKit";
import { SHELF_LABELS, type WorldLink } from "@/lib/worldforge/model";
import { mentionSegments } from "@/lib/worldforge/text";
import { absoluteYear, fieldLines, formatLifespan, formatYear, lifespan, lifespanIssue, sortEvents } from "@/lib/worldforge/time";
import { folderPath } from "@/lib/worldforge/tree";
import type { WorldEntity } from "@/lib/db/world-forge";
import type { WorldApi, WorldState } from "./useWorld";
import { EntityEditor } from "./EntityEditor";
import { LinkEditor } from "./LinkEditor";
import { EntityAvatar, SHELF_SYSTEMS, TypeChip, typeOf } from "./world-ui";

// One entry, read: its picture and names, what the table plays with, its
// article with every other entry it names linked, its type's fields, its
// links both ways, the events it was part of and the secrets about it, and
// the hidden truth only the DM sees. Edit and the link editor open in place.

const TABLE_WORDS: Record<string, string> = {
  attitude: "Attitude",
  statBlock: "Fights as",
  role: "Role",
  home: "Lives at",
  faction: "Faction",
  visited: "Visited",
  here: "Party is here",
  connections: "Roads to",
  power: "Power",
  goal: "Goal",
  category: "Lore shelf",
  visibility: "Read by",
  pinned: "Pinned",
};

function tableValue(key: string, value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "yes" : "";
  if (key === "visibility") return value === "dm" ? "the DM only" : "the party";
  return String(value);
}

export function EntityPage({
  api,
  world,
  entity,
  onFocus,
  onBack,
  onOpenSystem,
  canWrite,
  canPaint,
}: {
  api: WorldApi;
  world: WorldState;
  entity: WorldEntity;
  onFocus: (ref: string) => void;
  onBack: () => void;
  onOpenSystem: (system: string) => void;
  canWrite: boolean;
  canPaint: boolean;
}) {
  const { doc, entities } = world;
  const [editing, setEditing] = useState(false);
  // The picture this entry had when Paint was pressed; while set, the world
  // is read again every few seconds until a new one lands (a render takes a
  // while, and the media queue may be busy), for three minutes at most.
  const [painting, setPainting] = useState<{ from: string; until: number } | null>(null);
  // Still waiting: the picture on show is the one Paint was pressed over.
  const isPainting = painting !== null && entity.portrait === painting.from;
  const { refresh } = api;
  useEffect(() => {
    if (!isPainting || !painting) return;
    const timer = window.setInterval(() => (Date.now() > painting.until ? setPainting(null) : refresh()), 5_000);
    return () => window.clearInterval(timer);
  }, [isPainting, painting, refresh]);
  const [linking, setLinking] = useState<WorldLink | "new" | null>(null);
  const type = typeOf(doc, entity);
  const byRef = useMemo(() => new Map(entities.map((entry) => [entry.ref, entry])), [entities]);
  const named = useMemo(() => entities.map((entry) => ({ ref: entry.ref, name: entry.name, aliases: entry.aliases })), [entities]);
  const outgoing = doc.links.filter((link) => link.from === entity.ref && byRef.has(link.to));
  const incoming = doc.links.filter((link) => link.to === entity.ref && byRef.has(link.from));
  const events = sortEvents(doc.events.filter((event) => event.refs.includes(entity.ref)), doc.calendars);
  const secrets = doc.secrets.filter((secret) => secret.subject === entity.ref || secret.knownBy.includes(entity.ref));
  const span = lifespan(type, entity.entry, doc.calendars);
  const lifeLine = formatLifespan(type, entity.entry, doc.calendars);
  const article = entity.entry.article || entity.text;
  const folders = folderPath(doc.folders, entity.entry.folderId);
  const home = SHELF_SYSTEMS[entity.shelf];
  const facts = Object.entries(entity.table).filter(([, value]) => tableValue("", value) !== "");

  async function saveLinks(links: WorldLink[]) {
    await api.patch({ links });
    setLinking(null);
  }

  async function remove() {
    const ok = await appConfirm(`${entity.name} is ${entity.shelf === "lore" ? "a lore entry" : `in ${SHELF_LABELS[entity.shelf]}`}: deleting it here deletes it there too, with every link to it.`, {
      title: `Delete ${entity.name}?`,
      actionLabel: "Delete",
      tone: "danger",
    });
    if (ok && (await api.remove(entity.ref))) onBack();
  }

  if (editing) {
    return (
      <EntityEditor
        doc={doc}
        entity={entity}
        saving={api.saving}
        error={api.error}
        onDraft={canWrite ? async (hint) => {
          const payload = await api.ai("draft", { ref: entity.ref, hint });
          return typeof payload?.text === "string" ? payload.text : null;
        } : null}
        onCancel={() => {
          api.clearError();
          setEditing(false);
        }}
        onSave={async (input) => {
          if (await api.update(entity.ref, input)) setEditing(false);
        }}
      />
    );
  }

  const chip = (link: WorldLink, other: WorldEntity, reverse: boolean) => (
    <span key={`${link.id}-${reverse}`} className="motion-pop group inline-flex items-center gap-1 rounded-lg border border-stone-700/70 bg-stone-900/60 py-0.5 pl-0.5 pr-1.5 text-xs">
      <button type="button" onClick={() => onFocus(other.ref)} className="inline-flex items-center gap-1.5 text-stone-200 hover:text-amber-100 motion-press">
        <EntityAvatar entity={other} type={typeOf(doc, other)} size="size-5" />
        {other.name}
        {link.rank ? <span className="text-stone-500">({link.rank})</span> : null}
      </button>
      {link.veracity === "hidden" ? <Lock className="size-3 text-red-400" aria-label="Hidden truth" /> : null}
      {link.veracity === "believed" ? <Theater className="size-3 text-violet-300" aria-label="False belief" /> : null}
      {link.oneway ? <span className="text-[10px] text-stone-500" title="One way">one way</span> : null}
      {!reverse ? (
        <>
          <button type="button" aria-label={`Edit the link to ${other.name}`} onClick={() => setLinking(link)} className="reveal-on-hover text-stone-500 hover:text-amber-200 motion-nudge">
            <Pencil className="size-3" />
          </button>
          <button type="button" aria-label={`Remove the link to ${other.name}`} onClick={() => saveLinks(doc.links.filter((entry) => entry.id !== link.id))} className="reveal-on-hover text-stone-500 hover:text-red-300 motion-nudge">
            <X className="size-3" />
          </button>
        </>
      ) : null}
    </span>
  );

  const grouped = (links: WorldLink[], reverse: boolean) => {
    const groups = new Map<string, WorldLink[]>();
    for (const link of links) groups.set(link.label, [...(groups.get(link.label) ?? []), link]);
    // Theirs read as sentences ending on this entry: "Mira Fenn, rival of
    // Ivo Brannock".
    return [...groups.entries()].map(([label, group]) =>
      reverse ? (
        <div key={label} className="flex flex-wrap items-center gap-1.5">
          {group.map((link) => chip(link, byRef.get(link.from)!, true))}
          <span className="text-xs text-stone-500">{label} {entity.name}</span>
        </div>
      ) : (
        <div key={label} className="flex flex-wrap items-center gap-1.5">
          <span className="w-28 shrink-0 text-xs text-stone-500">{label}</span>
          {group.map((link) => chip(link, byRef.get(link.to)!, false))}
        </div>
      ),
    );
  };

  return (
    <article className="flex flex-col gap-4 animate-fade-up" data-tour="world-entry">
      <header className="flex flex-wrap items-start gap-3">
        <button type="button" onClick={onBack} className="md:hidden" aria-label="Back to the list">
          <ArrowLeft className="size-5 text-stone-400" />
        </button>
        <span key={entity.portrait} className="motion-pop">
          <EntityAvatar entity={entity} type={type} size="size-12 sm:size-16" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="gold-title font-display text-xl tracking-wide">{entity.name}</h3>
            <TypeChip type={type} />
            {entity.entry.canon !== "canon" ? <span className="rounded-md border border-stone-600 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-stone-400">{entity.entry.canon}</span> : null}
          </div>
          {entity.aliases.length ? <p className="text-xs text-stone-400">Also called {entity.aliases.join(", ")}</p> : null}
          {folders.length ? <p className="text-[11px] text-stone-500">{folders.map((folder) => folder.name).join(" / ")}</p> : null}
          {lifeLine ? <p className="text-xs text-stone-400">{lifeLine}</p> : null}
        </div>
        <div className="flex basis-full flex-wrap gap-1.5 sm:basis-auto">
          <KitButton tone="small" onClick={() => setEditing(true)} data-tour="world-edit">
            <Pencil className="size-3.5" /> Edit
          </KitButton>
          {canPaint ? (
            <KitButton
              tone="small"
              busy={isPainting}
              disabled={isPainting}
              title="Paint a picture for this entry: a portrait, a vista, a sigil or an illustration by its type"
              onClick={async () => {
                if (await api.ai("paint", { ref: entity.ref })) setPainting({ from: entity.portrait, until: Date.now() + 180_000 });
              }}
            >
              {isPainting ? null : <Brush className="size-3.5" />} {isPainting ? "Painting" : "Paint"}
            </KitButton>
          ) : null}
          <KitButton tone="small" onClick={() => onOpenSystem(home.system)} title={`Open ${entity.name}'s own tool`}>
            <ExternalLink className="size-3.5" /> {home.label}
          </KitButton>
          <KitButton tone="iconDanger" always aria-label={`Delete ${entity.name}`} onClick={remove}>
            <Trash2 className="size-4" />
          </KitButton>
        </div>
      </header>

      {facts.length ? (
        <div className="flex flex-wrap gap-1.5" aria-label="At the table">
          {facts.map(([key, value]) => (
            <span key={key} className="pk-chip motion-pop text-[11px]">
              <span className="text-stone-500">{TABLE_WORDS[key] ?? key}</span> {tableValue(key, value)}
            </span>
          ))}
        </div>
      ) : null}

      {entity.tagline && !article.startsWith(entity.tagline.replace(/\.\.\.$/, "")) ? <p className="text-sm italic text-stone-300">{entity.tagline}</p> : null}
      {article ? (
        <p className="whitespace-pre-wrap text-sm leading-6 text-stone-200">
          {mentionSegments(article, named, entity.ref).map((segment, index) =>
            segment.ref ? (
              <button key={index} type="button" onClick={() => onFocus(segment.ref!)} className="text-amber-200 underline decoration-amber-500/40 underline-offset-2 hover:text-amber-100">
                {segment.text}
              </button>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </p>
      ) : (
        <p className="text-sm text-stone-500">Nothing written yet.</p>
      )}

      {fieldLines(type, entity.entry, doc.calendars, true).length ? (
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          {fieldLines(type, entity.entry, doc.calendars, true).map(({ def, text }) => (
            <div key={def.id} className={cn("flex gap-2", def.authorOnly && "text-red-300")}>
              <dt className="text-stone-500">{def.name}</dt>
              <dd>{text}</dd>
              {def.authorOnly ? <EyeOff className="size-3.5 self-center" aria-label="Author only" /> : null}
            </div>
          ))}
        </dl>
      ) : null}

      <section className="flex flex-col gap-1.5" aria-label="Links">
        <div className="flex items-center justify-between">
          <h4 className="eyebrow text-[10px] text-amber-400/80">Links</h4>
          {linking === null ? (
            <KitButton tone="link" onClick={() => setLinking("new")} data-tour="world-add-link">
              <Plus className="size-3.5" /> Add a link
            </KitButton>
          ) : null}
        </div>
        {linking !== null ? (
          <LinkEditor
            doc={doc}
            entities={entities}
            from={entity}
            link={linking === "new" ? null : linking}
            onCancel={() => setLinking(null)}
            onSave={(link) => saveLinks([...doc.links.filter((entry) => entry.id !== link.id), link])}
          />
        ) : null}
        {outgoing.length ? grouped(outgoing, false) : linking === null ? <p className="text-xs text-stone-500">No links yet.</p> : null}
        {incoming.filter((link) => !link.oneway).length ? (
          <div className="mt-1 flex flex-col gap-1.5 border-t border-stone-800/80 pt-2">{grouped(incoming.filter((link) => !link.oneway), true)}</div>
        ) : null}
      </section>

      {events.length ? (
        <section className="flex flex-col gap-1" aria-label="Events">
          <h4 className="eyebrow text-[10px] text-amber-400/80">On the timeline</h4>
          {events.map((event) => {
            const when = formatYear(event.when, doc.calendars).primary;
            const issue = lifespanIssue(span, absoluteYear(event.when, doc.calendars));
            return (
              <p key={event.id} className="text-sm text-stone-300">
                <span className="text-stone-500">{when || "Undated"}</span> {event.title}
                {issue ? <span className="ml-2 text-xs text-ember-400">({issue})</span> : null}
              </p>
            );
          })}
        </section>
      ) : null}

      {secrets.length ? (
        <section className="flex flex-col gap-1" aria-label="Secrets">
          <h4 className="eyebrow text-[10px] text-amber-400/80">Secrets</h4>
          {secrets.map((secret) => (
            <p key={secret.id} className="text-sm text-stone-300">
              <Lock className="mr-1 inline size-3.5 text-red-400" />
              {secret.title}
              <span className="ml-2 text-xs text-stone-500">{secret.subject === entity.ref ? "about them" : "they know it"}{secret.partyKnows ? ", the party knows" : ""}</span>
            </p>
          ))}
        </section>
      ) : null}

      {entity.entry.hiddenTruth ? (
        <section className="rounded-lg border border-red-900/60 bg-red-950/30 p-3" aria-label="Hidden truth">
          <h4 className="eyebrow mb-1 flex items-center gap-1 text-[10px] text-red-300">
            <Lock className="size-3" /> Hidden truth, yours alone
          </h4>
          <p className="whitespace-pre-wrap text-sm text-red-100/90">{entity.entry.hiddenTruth}</p>
        </section>
      ) : null}
      {entity.entry.notes ? (
        <section className="rounded-lg border border-stone-700/70 bg-stone-900/40 p-3" aria-label="Author's notes">
          <h4 className="eyebrow mb-1 text-[10px] text-stone-400">Author&apos;s notes</h4>
          <p className="whitespace-pre-wrap text-sm text-stone-300">{entity.entry.notes}</p>
        </section>
      ) : null}
    </article>
  );
}
