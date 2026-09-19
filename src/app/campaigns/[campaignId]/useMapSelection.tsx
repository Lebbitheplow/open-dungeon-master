"use client";

import { useCallback, useMemo, useState } from "react";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { SelectionBar, type SelectionAction } from "@/components/ui/SelectionBar";
import {
  duplicateObject,
  listObjects,
  moveObject,
  objectAt,
  OBJECT_LABELS,
  refBounds,
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
// Delete come through the map hotkeys. The layers panel (MapLayersPanel.tsx)
// lists everything placed with the same selection, and the inspector
// (MapInspector.tsx) shows it with the same actions. Every change is one
// whole-list patch, so the caller's undo ring sees it like any other edit.

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

  // The edit prompt, apart from the bar so a surface that shows the actions
  // somewhere else (the inspector) still gets the dialog.
  const dialog = (
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
  );
  const bar =
    live.length > 0 ? (
      <SelectionBar title={title} count={live.length} actions={actions} moving={moving} onAction={onAction} onClear={clear} />
    ) : null;

  return { refs: live, boxes, moving, onSelect, remove, clear, bar, dialog, title, actions, onAction, setRefs };
}
