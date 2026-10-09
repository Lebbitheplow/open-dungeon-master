"use client";

import { FolderOpen, FolderPlus, Lock, Plus, Search, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { useTourPrepare } from "@/lib/tours/prepare";
import { KitButton, PanelError } from "@/app/campaigns/[campaignId]/PanelKit";
import { SHELF_LABELS, newId } from "@/lib/worldforge/model";
import { folderAndBelow, folderTree, removeFolder } from "@/lib/worldforge/tree";
import type { WorldApi, WorldState } from "./useWorld";
import { EntityPage } from "./EntityPage";
import { EntityAvatar, tint, typeOf } from "./world-ui";

// The wiki: every entry of the world, which is every Cast member, place,
// faction and lore entry of the workshop, filtered by type and folder and
// found by name or alias, beside the one that is open.

export function WikiView({
  api,
  world,
  focus,
  onFocus,
  onOpenSystem,
}: {
  api: WorldApi;
  world: WorldState;
  focus: string | null;
  onFocus: (ref: string | null) => void;
  onOpenSystem: (system: string) => void;
}) {
  const { doc, entities } = world;
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [folder, setFolder] = useState("");
  const [making, setMaking] = useState(false);
  const [newType, setNewType] = useState(doc.types[0]?.id ?? "");
  const [newName, setNewName] = useState("");
  const [folderName, setFolderName] = useState<string | null>(null);

  useTourPrepare((name) => {
    if (name === "open-world-entry") setMaking(true);
  });

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    const inFolder = folder === "" ? null : folder === "__none" ? new Set([""]) : folderAndBelow(doc.folders, folder);
    return entities.filter(
      (entity) =>
        (!typeFilter || typeOf(doc, entity).id === typeFilter) &&
        (!inFolder || inFolder.has(entity.entry.folderId)) &&
        (!words || [entity.name, ...entity.aliases, ...entity.tags].some((name) => name.toLowerCase().includes(words))),
    );
  }, [doc, entities, folder, query, typeFilter]);
  const open = entities.find((entity) => entity.ref === focus) ?? null;
  const chosenType = doc.types.find((type) => type.id === newType) ?? doc.types[0];

  async function make() {
    const made = await api.create({ typeId: chosenType.id, name: newName.trim(), folderId: folder && folder !== "__none" ? folder : "" });
    if (made) {
      setMaking(false);
      setNewName("");
      onFocus(made.ref);
    }
  }

  async function addFolder() {
    const name = (folderName ?? "").trim();
    if (!name) return;
    await api.patch({ folders: [...doc.folders, { id: newId("cat"), name, parentId: folder && folder !== "__none" ? folder : "" }] });
    setFolderName(null);
  }

  async function dropFolder(id: string) {
    const target = doc.folders.find((entry) => entry.id === id);
    if (!target || !(await appConfirm(`Its entries and folders move up a level; nothing in it is deleted.`, { title: `Remove the folder ${target.name}?`, actionLabel: "Remove" }))) return;
    const { folders, heir } = removeFolder(doc.folders, id);
    await api.patch({ folders, moveFolder: { from: id, to: heir } });
    if (folder === id) setFolder("");
  }

  return (
    <div className="grid gap-4 md:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className={cn("flex min-w-0 flex-col gap-2", open && "hidden md:flex")} aria-label="Entries">
        <KitButton tone="primary" onClick={() => setMaking((value) => !value)} data-tour="world-new-entry">
          <Plus className="size-3.5" /> New entry
        </KitButton>
        {making ? (
          <form
            className="panel motion-pop flex flex-col gap-2 rounded-lg p-2.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (newName.trim()) void make();
            }}
          >
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Type">
              {doc.types.map((type) => (
                <button key={type.id} type="button" role="radio" aria-checked={newType === type.id} onClick={() => setNewType(type.id)} className={cn("rounded-md border px-1.5 py-0.5 text-[11px] motion-press", newType === type.id ? "text-stone-950" : "text-stone-300")} style={newType === type.id ? { background: type.color, borderColor: type.color } : { borderColor: tint(type.color, 0.4) }}>
                  {type.name}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-stone-500">Lands in {SHELF_LABELS[chosenType.shelf]}{chosenType.shelf === "lore" ? ` (${chosenType.loreCategory})` : ""}.</p>
            <input className={cn(ui.input, "text-sm")} placeholder={`A ${chosenType.name.toLowerCase()}'s name`} aria-label="Name" maxLength={80} value={newName} onChange={(event) => setNewName(event.target.value)} autoFocus />
            {api.error ? <PanelError>{api.error}</PanelError> : null}
            <div className="flex justify-end gap-1.5">
              <KitButton tone="small" onClick={() => setMaking(false)}>
                <X className="size-3.5" /> Cancel
              </KitButton>
              <KitButton tone="primary" type="submit" busy={api.saving} disabled={!newName.trim() || api.saving}>
                Make it
              </KitButton>
            </div>
          </form>
        ) : null}

        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-stone-500" />
          <input className={cn(ui.input, "pl-8 text-xs")} placeholder="Find by name, alias or tag" aria-label="Find an entry" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>

        <div className="flex flex-wrap gap-1" aria-label="Types">
          <button type="button" onClick={() => setTypeFilter("")} className={cn("rounded-md border border-stone-700 px-1.5 py-0.5 text-[11px] motion-press", !typeFilter ? "bg-amber-400/10 text-amber-100" : "text-stone-400")}>
            All {entities.length}
          </button>
          {doc.types.map((type) => {
            const count = entities.filter((entity) => typeOf(doc, entity).id === type.id).length;
            return count ? (
              <button key={type.id} type="button" onClick={() => setTypeFilter(typeFilter === type.id ? "" : type.id)} className="rounded-md border px-1.5 py-0.5 text-[11px] motion-press" style={typeFilter === type.id ? { background: tint(type.color, 0.25), borderColor: type.color, color: "#f5f0e6" } : { borderColor: tint(type.color, 0.35), color: type.color }}>
                {type.name} {count}
              </button>
            ) : null;
          })}
        </div>

        <div className="flex flex-col gap-0.5" aria-label="Folders">
          <div className="flex items-center justify-between">
            <span className="eyebrow text-[10px] text-stone-500">Folders</span>
            <KitButton tone="icon" always aria-label="New folder" onClick={() => setFolderName(folderName === null ? "" : null)}>
              <FolderPlus className="size-3.5" />
            </KitButton>
          </div>
          {folderName !== null ? (
            <form className="motion-pop flex gap-1" onSubmit={(event) => { event.preventDefault(); void addFolder(); }}>
              <input className={cn(ui.input, "py-1 text-xs")} placeholder="Townsfolk" aria-label="Folder name" maxLength={60} value={folderName} onChange={(event) => setFolderName(event.target.value)} autoFocus />
              <KitButton tone="small" type="submit" disabled={!folderName.trim()}>Add</KitButton>
            </form>
          ) : null}
          {[{ id: "", name: "Everything", depth: 0 }, ...folderTree(doc.folders).map(({ folder: entry, depth }) => ({ id: entry.id, name: entry.name, depth })), ...(doc.folders.length ? [{ id: "__none", name: "In no folder", depth: 0 }] : [])].map((entry) => (
            <div key={entry.id || "all"} className="group flex items-center">
              <button type="button" onClick={() => setFolder(entry.id)} className={cn("flex flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs motion-press", folder === entry.id ? "bg-amber-400/10 text-amber-100" : "text-stone-400 hover:text-stone-200")} style={{ paddingLeft: `${0.375 + entry.depth * 0.75}rem` }}>
                <FolderOpen className="size-3.5 shrink-0" /> {entry.name}
              </button>
              {entry.id && entry.id !== "__none" ? (
                <KitButton tone="iconDanger" aria-label={`Remove the folder ${entry.name}`} onClick={() => dropFolder(entry.id)}>
                  <Trash2 className="size-3" />
                </KitButton>
              ) : null}
            </div>
          ))}
        </div>

        <div className="flex max-h-[60vh] flex-col gap-0.5 overflow-y-auto pr-1" role="listbox" aria-label="Entries">
          {shown.length === 0 ? <p className="px-1 py-2 text-xs text-stone-500">{entities.length ? "Nothing matches." : "No entries yet. Make one, or open a WorldForge file."}</p> : null}
          {shown.map((entity) => {
            const type = typeOf(doc, entity);
            return (
              <button
                key={entity.ref}
                type="button"
                role="option"
                aria-selected={entity.ref === focus}
                onClick={() => onFocus(entity.ref)}
                className={cn("flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-left motion-press", entity.ref === focus ? "bg-amber-400/10 shadow-[0_0_16px_rgba(212,171,58,0.12)]" : "hover:bg-stone-900/70")}
              >
                <EntityAvatar entity={entity} type={type} size="size-8" />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-sm", entity.ref === focus ? "text-amber-100" : "text-stone-200")}>{entity.name}</span>
                  <span className="block truncate text-[11px]" style={{ color: type.color }}>{type.name}</span>
                </span>
                {entity.entry.hiddenTruth ? <Lock className="size-3 shrink-0 text-red-400/80" aria-label="Has a hidden truth" /> : null}
              </button>
            );
          })}
        </div>
      </aside>

      <div className={cn("min-w-0", !open && "hidden md:block")}>
        {open ? (
          <EntityPage key={open.ref} api={api} world={world} entity={open} onFocus={onFocus} onBack={() => onFocus(null)} onOpenSystem={onOpenSystem} />
        ) : (
          <div className="panel flex min-h-48 flex-col items-center justify-center gap-2 rounded-xl p-6 text-center animate-fade-up">
            <p className="font-display text-lg text-amber-100">The world, entry by entry</p>
            <p className="max-w-md text-sm text-stone-400">
              Every Cast member, place, faction and lore entry of this workshop is an entry here. Open one to write its article, link it to the rest, give it the fields its type keeps and the truth only you know.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
