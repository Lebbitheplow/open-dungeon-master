"use client";

import { EmptyState } from "@/components/EmptyState";
import { BookmarkPlus, Check, ChevronDown, Loader2 } from "lucide-react";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { useCallback, useEffect, useState } from "react";
import { ListHead, useListHead } from "@/app/workshop/ListHead";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";
import { Select } from "@/components/ui/Select";
import { FieldLabel, GlyphPlate, RowMenu, chip, chipOn, chipRow } from "@/app/workshop/kit";
import { KIND_GLYPHS } from "@/app/workshop/homebrew/HomebrewIcon";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import {
  activeVariantRules,
  describeRuleset,
  type Ruleset,
  type RulesetChange,
} from "@/lib/rulesets/logic";

const readRuleset = (ruleset: Ruleset) => ({ name: ruleset.name });

type HomebrewRow = { id: string; name: string; kind: string };

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
  const head = useListHead(rulesets, readRuleset);
  const [openId, setOpenId] = useState<string | null>(null);
  const [changes, setChanges] = useState<RulesetChange[]>([]);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [busy, setBusy] = useState("");
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  // The DM's homebrew, so a ruleset can say which of it is canon at a table
  // that runs it. Read once, the first time a ruleset is opened.
  const [homebrew, setHomebrew] = useState<HomebrewRow[] | null>(null);

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

  useEffect(() => {
    if (openId === null || homebrew !== null) {
      return;
    }
    fetch("/api/homebrew")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { entries?: HomebrewRow[] } | null) => setHomebrew(data?.entries ?? []))
      .catch(() => setHomebrew([]));
  }, [openId, homebrew]);

  // Ticks a homebrew entry into or out of the ruleset's canon list. Saved
  // straight away: the list is the ruleset, not a draft of it.
  async function toggleHomebrew(ruleset: Ruleset, id: string) {
    const next = ruleset.homebrewIds.includes(id)
      ? ruleset.homebrewIds.filter((entry) => entry !== id)
      : [...ruleset.homebrewIds, id];
    setRulesets((current) =>
      current.map((entry) => (entry.id === ruleset.id ? { ...entry, homebrewIds: next } : entry)),
    );
    const response = await fetch(`/api/rulesets/${ruleset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ homebrewIds: next }),
    });
    if (!response.ok) {
      await load();
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
    if (!await appConfirm(`Delete the "${ruleset.name}" ruleset? Tables already using it keep it.`)) {
      return;
    }
    const response = await fetch(`/api/rulesets/${ruleset.id}`, { method: "DELETE" });
    if (response.ok) {
      setRulesets((current) => current.filter((entry) => entry.id !== ruleset.id));
    }
  }

  return (
    <section className={`${ui.card} mb-4 p-3`} data-tour="rules-library">
      <SectionHead title="Ruleset library" glyph="system-rulesets" level="h2" />
      <p className="mb-3 text-xs text-stone-400">
        A ruleset is your table&apos;s variant rules and house rulings kept as one thing, reusable
        across campaigns. Applying one copies it here; editing it later never reaches back.
      </p>

      {loading ? (
        <div className="reveal mb-3 space-y-1.5" aria-busy="true">
          <div className="skeleton-block h-10 rounded-lg" />
          <div className="skeleton-block h-10 rounded-lg" />
        </div>
      ) : rulesets.length ? (
        <>
        <ListHead head={head} noun={["ruleset", "rulesets"]} placeholder="Find a ruleset" />
        <ul className="stagger mb-3 space-y-1.5">
          {head.shown.map((ruleset) => {
            // Opening is the row; deleting sits behind the kebab and the
            // right-click or long-press menu. Applying stays inside the opened
            // row, under the list of what it would change.
            const items: ContextMenuItem[] = [
              { id: "open", label: openId === ruleset.id ? "Close" : "Open", glyph: "system-rulesets", onSelect: () => void open(ruleset) },
              { id: "delete", label: "Delete", glyph: "quest-failed", tone: "danger", separated: true, onSelect: () => void remove(ruleset) },
            ];
            return (
            <ContextMenu as="li" key={ruleset.id} label={ruleset.name} items={items} className="panel rounded-xl">
              <div className="flex items-center gap-3 p-2.5">
                <GlyphPlate glyph="system-rulesets" size="size-11" />
                <button
                  type="button"
                  onClick={() => open(ruleset)}
                  aria-expanded={openId === ruleset.id}
                  className="flex min-h-10 min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display tracking-wide text-amber-50">{ruleset.name}</span>
                    <span className="block truncate text-xs text-stone-500">{describeRuleset(ruleset)}</span>
                  </span>
                  <ChevronDown className={cn("size-4 shrink-0 text-stone-500 transition-transform", openId === ruleset.id && "rotate-180")} aria-hidden="true" />
                </button>
                <RowMenu items={items} label={ruleset.name} />
              </div>
              {openId === ruleset.id ? (
                <div className="reveal space-y-3 border-t border-stone-800/70 p-3">
                  {activeVariantRules(ruleset.variantRules).length ? (
                    <ul className="stagger text-xs text-stone-400">
                      {activeVariantRules(ruleset.variantRules).map((label) => (
                        <li key={label}>{label}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div>
                    <FieldLabel className="mb-1 block">Applying here would</FieldLabel>
                    <ChangeList changes={changes} />
                  </div>
                  <div data-tour="rules-homebrew">
                    <SectionHead title="Homebrew this ruleset ships" glyph="system-homebrew" level="h4" />
                    {homebrew === null ? (
                      <Loader2 className="size-3.5 animate-spin text-stone-500" />
                    ) : homebrew.length ? (
                      <ul className={cn("stagger", chipRow)}>
                        {homebrew.map((entry) => {
                          const on = ruleset.homebrewIds.includes(entry.id);
                          return (
                            <li key={entry.id}>
                              <button
                                type="button"
                                aria-pressed={on}
                                onClick={() => void toggleHomebrew(ruleset, entry.id)}
                                className={cn(ui.btnSmall, chip, "normal-case", on && chipOn)}
                              >
                                <GameIcon icon={{ kind: "glyph", key: KIND_GLYPHS[entry.kind as keyof typeof KIND_GLYPHS] ?? "system-homebrew" }} size="size-4" />
                                {entry.name}
                                <span className="ml-1 text-stone-500">{entry.kind}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="text-xs text-stone-500">
                        Nothing homebrewed yet. Entries made in the Homebrew tool appear here.
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-stone-500">
                      Ticked entries are canon wherever this ruleset is applied; prepared monsters
                      that lean on anything else get flagged.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="w-full sm:w-72">
                      <Select<"replace" | "append">
                        value={mode}
                        onChange={setMode}
                        label="How to handle existing house rules"
                        options={[
                          { value: "replace", label: "Replace the house rules here" },
                          { value: "append", label: "Add to the house rules here" },
                        ]}
                      />
                    </span>
                    <button
                      type="button"
                      onClick={() => apply(ruleset)}
                      disabled={busy === ruleset.id}
                      className={ui.btnPrimary}
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
            </ContextMenu>
            );
          })}
        </ul>
        </>
      ) : (
        <EmptyState size="md" art="scrolls" title="No saved rulesets yet. Set the rules below the way your table plays, then save them." />
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm" data-tour="rules-save-as">
        <input
          value={saveName}
          onChange={(event) => setSaveName(event.target.value)}
          maxLength={80}
          placeholder="Save these rules as..."
          aria-label="Save these rules as"
          className={cn(ui.input, "w-full sm:w-64")}
        />
        <button
          type="button"
          onClick={capture}
          disabled={saving || !saveName.trim()}
          className={ui.btnSecondary}
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <BookmarkPlus className="size-3.5" />
          )}
          Save
        </button>
      </div>
      {note ? <p className="live-in mt-2 text-xs text-emerald-400">{note}</p> : null}
    </section>
  );
}
