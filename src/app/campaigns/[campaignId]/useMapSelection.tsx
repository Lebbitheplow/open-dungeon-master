"use client";

import { Eye, EyeOff, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { SelectionBar, type SelectionAction } from "@/components/ui/SelectionBar";
import { cn } from "@/lib/cn";
import {
  duplicateObject,
  listObjects,
  moveObject,
  objectAt,
  OBJECT_LABELS,
  refBounds,
  refKey,
  removeObjects,
  sameRef,
  setDmOnly,
  type MapObjects,
  type ObjectRef,
} from "@/lib/battlemap/objects";
import type { XY } from "@/lib/battlemap/types";

// The selection model for the map editors (docs/vtt-parity-implementation-
// plan.md sections 10.1 and 10.8), shared by the workshop map editor and
// the live board studio. Tapping a placed thing with the Select tool
// selects it; the bar above offers Edit, Move, Duplicate, Delete and the
// DM-only flag; Shift-tap extends; Move arms the next tap; Escape and
// Delete come through the map hotkeys. The objects panel lists everything
// placed with the same selection. Every change is one whole-list patch, so
// the caller's undo ring sees it like any other edit.

type Save = (objects: Partial<MapObjects> & { door?: XY }) => Promise<boolean> | void;

export function useMapSelection({
  objects,
  width,
  height,
  save,
  // Which kinds this surface edits; the live board has no props or lights.
  kinds,
}: {
  objects: MapObjects;
  width: number;
  height: number;
  save: Save;
  kinds: Array<keyof MapObjects>;
}) {
  const [refs, setRefs] = useState<ObjectRef[]>([]);
  const [moving, setMoving] = useState(false);
  const [editing, setEditing] = useState<ObjectRef | null>(null);

  // Stale refs (deleted elsewhere) drop out on the next read.
  const live = useMemo(() => refs.filter((ref) => refBounds(objects, ref) !== null), [refs, objects]);
  const boxes = useMemo(
    () => live.map((ref) => refBounds(objects, ref)).filter((box): box is NonNullable<typeof box> => box !== null),
    [live, objects],
  );

  const clear = useCallback(() => {
    setRefs([]);
    setMoving(false);
  }, []);

  const changed = useCallback(
    (next: MapObjects) => {
      const patch: Partial<MapObjects> = {};
      for (const kind of kinds) {
        if (next[kind] !== objects[kind]) {
          (patch as Record<string, unknown>)[kind] = next[kind];
        }
      }
      if (Object.keys(patch).length) {
        void save(patch);
      }
    },
    [kinds, objects, save],
  );

  // A tap on the surface with the Select tool.
  const onSelect = useCallback(
    (x: number, y: number, shift: boolean) => {
      if (moving && live.length) {
        let next = objects;
        for (const ref of live) {
          next = moveObject(next, ref, { x, y });
        }
        changed(next);
        setMoving(false);
        setRefs(live.map((ref) => (ref.kind === "labels" || ref.kind === "props" || ref.kind === "lights" ? { ...ref, x, y } : ref)));
        return;
      }
      const hit = objectAt(objects, x, y);
      if (!hit || !kinds.includes(hit.kind)) {
        if (!shift) {
          clear();
        }
        return;
      }
      setRefs((current) => {
        if (shift) {
          return current.some((ref) => sameRef(ref, hit)) ? current.filter((ref) => !sameRef(ref, hit)) : [...current, hit];
        }
        return [hit];
      });
    },
    [moving, live, objects, kinds, changed, clear],
  );

  const remove = useCallback(() => {
    if (!live.length) {
      return;
    }
    changed(removeObjects(objects, live.filter((ref) => ref.kind !== "doors")));
    clear();
  }, [live, objects, changed, clear]);

  const onAction = useCallback(
    (action: SelectionAction) => {
      const first = live[0];
      if (!first) {
        return;
      }
      switch (action) {
        case "delete":
          remove();
          return;
        case "move":
          setMoving((current) => !current);
          return;
        case "duplicate":
          changed(duplicateObject(objects, first, width, height));
          return;
        case "dmOnly": {
          const label = first.kind === "labels" ? objects.labels.find((entry) => entry.x === first.x && entry.y === first.y) : null;
          changed(setDmOnly(objects, live, !(label?.dmOnly ?? false)));
          return;
        }
        case "edit":
          if (first.kind === "doors") {
            void save({ door: { x: first.x, y: first.y } });
            return;
          }
          setEditing(first);
          return;
        case "link":
          setEditing(first);
          return;
      }
    },
    [live, remove, changed, objects, width, height, save],
  );

  const editValue = useMemo(() => {
    if (!editing) {
      return "";
    }
    if (editing.kind === "labels") {
      return objects.labels.find((entry) => entry.x === editing.x && entry.y === editing.y)?.text ?? "";
    }
    if (editing.kind === "props") {
      return objects.props.find((entry) => entry.x === editing.x && entry.y === editing.y)?.name ?? "";
    }
    if (editing.kind === "lights") {
      const light = objects.lights.find((entry) => entry.x === editing.x && entry.y === editing.y);
      return light ? String(light.brightRadius * 5) : "";
    }
    return "";
  }, [editing, objects]);

  const submitEdit = useCallback(
    (value: string) => {
      const ref = editing;
      setEditing(null);
      if (!ref) {
        return;
      }
      if (ref.kind === "labels") {
        changed({
          ...objects,
          labels: objects.labels.map((entry) => (entry.x === ref.x && entry.y === ref.y ? { ...entry, text: value } : entry)),
        });
      } else if (ref.kind === "props") {
        changed({
          ...objects,
          props: objects.props.map((entry) => (entry.x === ref.x && entry.y === ref.y ? { ...entry, name: value } : entry)),
        });
      } else if (ref.kind === "lights") {
        const feet = Number.parseInt(value, 10);
        if (Number.isFinite(feet) && feet > 0) {
          const bright = Math.max(1, Math.round(feet / 5));
          changed({
            ...objects,
            lights: objects.lights.map((entry) =>
              entry.x === ref.x && entry.y === ref.y ? { ...entry, brightRadius: bright, dimRadius: bright * 2 } : entry,
            ),
          });
        }
      }
    },
    [editing, objects, changed],
  );

  const title = useMemo(() => {
    const first = live[0];
    if (!first) {
      return "";
    }
    const row = listObjects(objects).find((entry) => sameRef(entry.ref, first));
    return row ? `${OBJECT_LABELS[first.kind]}: ${row.name}` : OBJECT_LABELS[first.kind];
  }, [live, objects]);

  const actions = useMemo<SelectionAction[]>(() => {
    const first = live[0];
    if (!first) {
      return [];
    }
    if (live.length > 1) {
      return ["move", "delete"];
    }
    const out: SelectionAction[] = [];
    if (first.kind === "labels" || first.kind === "props" || first.kind === "lights" || first.kind === "doors") {
      out.push("edit");
    }
    if (first.kind !== "doors" && first.kind !== "drawings") {
      out.push("move", "duplicate");
    }
    if (first.kind === "labels") {
      out.push("dmOnly");
    }
    if (first.kind !== "doors") {
      out.push("delete");
    }
    return out;
  }, [live]);

  const bar =
    live.length > 0 ? (
      <>
        <SelectionBar title={title} count={live.length} actions={actions} moving={moving} onAction={onAction} onClear={clear} />
        <PromptDialog
          open={editing !== null}
          onOpenChange={(open) => {
            if (!open) {
              setEditing(null);
            }
          }}
          title={
            editing?.kind === "lights" ? "Bright radius, in feet" : editing?.kind === "props" ? "Rename the prop" : "Change the label"
          }
          defaultValue={editValue}
          submitLabel="Apply"
          onSubmit={submitEdit}
        />
      </>
    ) : null;

  return { refs: live, boxes, moving, onSelect, remove, clear, bar, setRefs };
}

// Every placed thing in a list, with the same selection as the canvas.
export function ObjectsPanel({
  objects,
  refs,
  onSelect,
  onDelete,
  onDmOnly,
  className,
}: {
  objects: MapObjects;
  refs: ObjectRef[];
  onSelect: (refs: ObjectRef[]) => void;
  onDelete: (refs: ObjectRef[]) => void;
  onDmOnly: (refs: ObjectRef[], dmOnly: boolean) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => listObjects(objects), [objects]);
  const selectedKeys = new Set(refs.map(refKey));
  if (!rows.length) {
    return null;
  }
  return (
    <section className={cn("rounded-lg border border-stone-800 bg-stone-950/40", className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-2.5 py-1.5 text-[11px] uppercase tracking-wide text-stone-500 hover:text-stone-300"
      >
        <span>Placed things ({rows.length})</span>
        <span>{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div className="space-y-1 px-2 pb-2">
          {refs.length > 1 ? (
            <div className="flex items-center gap-1 text-[11px] text-stone-400">
              {refs.length} selected
              <button type="button" onClick={() => onDelete(refs)} className="ml-auto flex items-center gap-1 rounded-md border border-red-900/60 px-2 py-0.5 text-red-300">
                <Trash2 className="size-3" /> Delete
              </button>
              <button type="button" onClick={() => onDmOnly(refs, true)} className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-0.5">
                <EyeOff className="size-3" /> DM only
              </button>
              <button type="button" onClick={() => onDmOnly(refs, false)} className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-0.5">
                <Eye className="size-3" /> Shown
              </button>
            </div>
          ) : null}
          <ul className="max-h-56 space-y-0.5 overflow-y-auto">
            {rows.map((row) => {
              const key = refKey(row.ref);
              const selected = selectedKeys.has(key);
              return (
                <li key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected}
                    aria-label={`Select ${row.name}`}
                    onChange={(event) =>
                      onSelect(
                        event.target.checked
                          ? [...refs, row.ref]
                          : refs.filter((ref) => refKey(ref) !== key),
                      )
                    }
                    className="accent-amber-400"
                  />
                  <button
                    type="button"
                    onClick={() => onSelect([row.ref])}
                    className={cn(
                      "min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-xs",
                      selected ? "bg-amber-950/50 text-amber-100" : "text-stone-300 hover:bg-stone-900",
                    )}
                    title={row.detail}
                  >
                    {row.name}
                    <span className="ml-1 text-[10px] text-stone-500">{row.detail}</span>
                    {row.dmOnly ? <span className="ml-1 text-[10px] text-violet-300">DM</span> : null}
                  </button>
                  {row.ref.kind !== "doors" ? (
                    <button
                      type="button"
                      onClick={() => onDelete([row.ref])}
                      aria-label={`Delete ${row.name}`}
                      className="rounded p-1 text-stone-600 hover:text-red-300"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
