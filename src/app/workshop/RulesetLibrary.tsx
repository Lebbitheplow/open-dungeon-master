"use client";

import { BookmarkPlus, Check, Loader2, Scale, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import {
  activeVariantRules,
  describeRuleset,
  type Ruleset,
  type RulesetChange,
} from "@/lib/rulesets/logic";

// The ruleset library, and applying one to a table.
//
// Shown above the ordinary rules editor in a workshop, so the relationship is
// visible: the library is where a table's rules are KEPT, and the editor
// below is this workshop's own copy. Applying overwrites the copy; the
// library is untouched either way.

function ChangeList({ changes }: { changes: RulesetChange[] }) {
  if (!changes.length) {
    return <p className="text-xs text-stone-500">Nothing would change.</p>;
  }
  return (
    <ul className="space-y-0.5 text-xs text-stone-400">
      {changes.map((change, index) => (
        <li key={index}>
          {change.kind === "variant" ? (
            <>
              {change.label}:{" "}
              <span className="text-stone-500">
                {typeof change.from === "boolean" ? (change.from ? "on" : "off") : change.from}
              </span>{" "}
              to{" "}
              <span className="text-amber-200">
                {typeof change.to === "boolean" ? (change.to ? "on" : "off") : change.to}
              </span>
            </>
          ) : (
            <>
              House rules: {change.to} ruling{change.to === 1 ? "" : "s"}
              {change.replaces ? (
                <span className="text-amber-300/90">
                  {" "}
                  replacing the {change.from} already written here
                </span>
              ) : null}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

export function RulesetLibrary({
  campaignId,
  onApplied,
}: {
  // The table to apply onto. A workshop id is a campaign id.
  campaignId: string;
  onApplied?: () => void;
}) {
  const [rulesets, setRulesets] = useState<Ruleset[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [changes, setChanges] = useState<RulesetChange[]>([]);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [busy, setBusy] = useState("");
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(
    () =>
      fetch("/api/rulesets")
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data) {
            setRulesets(data.rulesets ?? []);
          }
        })
        .catch(() => {
          // transient; the next action reloads
        })
        .finally(() => setLoading(false)),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Opening a ruleset asks the server what applying it WOULD do, rather than
  // computing it here from a stale copy of the campaign's settings.
  async function open(ruleset: Ruleset) {
    if (openId === ruleset.id) {
      setOpenId(null);
      return;
    }
    setOpenId(ruleset.id);
    setChanges([]);
    const response = await fetch(
      `/api/rulesets/${ruleset.id}?preview=${encodeURIComponent(campaignId)}`,
    );
    if (response.ok) {
      const data = await response.json();
      setChanges(data.changes ?? []);
    }
  }

  async function apply(ruleset: Ruleset) {
    setBusy(ruleset.id);
    setNote("");
    try {
      const response = await fetch(`/api/rulesets/${ruleset.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, houseRules: mode }),
      });
      if (response.ok) {
        const data = await response.json();
        setNote(
          data.changes?.length
            ? `Applied ${ruleset.name}: ${data.changes.length} change${data.changes.length === 1 ? "" : "s"}.`
            : `${ruleset.name} was already what this table runs.`,
        );
        setOpenId(null);
        onApplied?.();
      }
    } finally {
      setBusy("");
    }
  }

  async function capture() {
    if (!saveName.trim()) {
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/rulesets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: saveName.trim(), captureFrom: campaignId }),
      });
      if (response.ok) {
        setSaveName("");
        setNote("Saved these rules to your library.");
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove(ruleset: Ruleset) {
    if (!window.confirm(`Delete the "${ruleset.name}" ruleset? Tables already using it keep it.`)) {
      return;
    }
    const response = await fetch(`/api/rulesets/${ruleset.id}`, { method: "DELETE" });
    if (response.ok) {
      setRulesets((current) => current.filter((entry) => entry.id !== ruleset.id));
    }
  }

  return (
    <section className={`${ui.card} mb-4 p-3`}>
      <h2 className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
        <Scale className="size-3.5" /> Ruleset library
      </h2>
      <p className="mb-3 text-xs text-stone-500">
        A ruleset is your table&apos;s variant rules and house rulings kept as one thing, reusable
        across campaigns. Applying one copies it here; editing it later never reaches back.
      </p>

      {loading ? (
        <Loader2 className="size-4 animate-spin text-stone-500" />
      ) : rulesets.length ? (
        <ul className="mb-3 space-y-1.5">
          {rulesets.map((ruleset) => (
            <li key={ruleset.id} className="rounded-lg border border-stone-800 bg-stone-950/50">
              <div className="flex items-center gap-2 p-2">
                <button
                  type="button"
                  onClick={() => open(ruleset)}
                  aria-expanded={openId === ruleset.id}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm text-stone-200">{ruleset.name}</p>
                  <p className="truncate text-xs text-stone-500">{describeRuleset(ruleset)}</p>
                </button>
                <button
                  type="button"
                  onClick={() => remove(ruleset)}
                  aria-label={`Delete ${ruleset.name}`}
                  className={ui.iconAction}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              {openId === ruleset.id ? (
                <div className="space-y-2 border-t border-stone-800/70 p-2">
                  {activeVariantRules(ruleset.variantRules).length ? (
                    <ul className="text-xs text-stone-400">
                      {activeVariantRules(ruleset.variantRules).map((label) => (
                        <li key={label}>{label}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wide text-stone-500">
                      Applying here would
                    </p>
                    <ChangeList changes={changes} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={mode}
                      onChange={(event) => setMode(event.target.value as "replace" | "append")}
                      aria-label="How to handle existing house rules"
                      className={cn(ui.input, "w-auto py-1 text-xs")}
                    >
                      <option value="replace">Replace the house rules here</option>
                      <option value="append">Add to the house rules here</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => apply(ruleset)}
                      disabled={busy === ruleset.id}
                      className={ui.btnSmall}
                    >
                      {busy === ruleset.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Check className="size-3.5" />
                      )}
                      Apply
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-xs text-stone-500">
          No saved rulesets yet. Set the rules below the way your table plays, then save them.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={saveName}
          onChange={(event) => setSaveName(event.target.value)}
          maxLength={80}
          placeholder="Save these rules as..."
          className={cn(ui.input, "w-56 py-1 text-xs")}
        />
        <button
          type="button"
          onClick={capture}
          disabled={saving || !saveName.trim()}
          className={ui.btnSmall}
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <BookmarkPlus className="size-3.5" />
          )}
          Save
        </button>
      </div>
      {note ? <p className="mt-2 text-xs text-emerald-400">{note}</p> : null}
    </section>
  );
}
