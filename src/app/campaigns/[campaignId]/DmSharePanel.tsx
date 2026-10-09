"use client";

import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Download, Loader2, Package } from "lucide-react";
import { useState } from "react";
import { ui } from "@/lib/ui";
import { SectionHead } from "@/components/ui/SectionHead";
import { FieldLabel } from "@/app/campaigns/[campaignId]/DmConsoleParts";
import { UnofficialPackNotice } from "@/components/UnofficialPackNotice";
import { BUNDLE_KIND_LABELS } from "@/lib/workshop/bundle";

// Handing a workshop to somebody else.
//
// The manifest form is the whole point of this panel. Exporting could have
// been one button that guessed a name from the title, and the reason it is
// not is that `inspiredBy` and `rightsHolder` are DECLARATIONS: only the
// person who built the thing knows whose setting it stands on, and a world
// pack has required those fields since docs/worlds.md. A workshop bundle
// carrying the same fields is what lets the same notice ride along with it.

type Counts = Record<string, number>;

function download(name: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function fileStem(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "workshop"
  );
}

export function DmSharePanel({ campaignId }: { campaignId: string }) {
  const [name, setName] = useState("");
  const [blurb, setBlurb] = useState("");
  const [author, setAuthor] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [homepage, setHomepage] = useState("");
  const [inspiredBy, setInspiredBy] = useState("");
  const [rightsHolder, setRightsHolder] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [refusals, setRefusals] = useState<Array<{ field: string; reason: string }>>([]);
  // Your shelf (hand-built monsters, homebrew items, spells and options):
  // all of it, or only what this workshop uses; and what the export said.
  const [shelfScope, setShelfScope] = useState<"all" | "used">("all");
  const [shelf, setShelf] = useState<{ included: string[]; unused: string[]; missing: string[] } | null>(null);

  const manifest = {
    name: name.trim(),
    blurb: blurb.trim(),
    version: version.trim() || "1.0.0",
    author: author.trim(),
    homepage: homepage.trim(),
    inspiredBy: inspiredBy.trim(),
    rightsHolder: rightsHolder.trim(),
    shelf: shelfScope,
  };
  const ready = Boolean(manifest.name && manifest.blurb && manifest.inspiredBy);

  async function post(path: string) {
    const response = await fetch(`/api/campaigns/${campaignId}/dm/bundle${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manifest }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? "That could not be built.");
    }
    return data;
  }

  async function exportBundle() {
    setBusy("bundle");
    setError("");
    setRefusals([]);
    try {
      const data = await post("");
      setCounts(data.counts);
      setWarnings(data.warnings ?? []);
      setShelf(data.shelf ?? null);
      download(`${fileStem(manifest.name)}.odm-workshop.json`, data.bundle);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "That could not be built.");
    } finally {
      setBusy("");
    }
  }

  async function exportPack() {
    setBusy("pack");
    setError("");
    try {
      const data = await post("/pack");
      setRefusals(data.refusals ?? []);
      setWarnings(data.warnings ?? []);
      setCounts(null);
      if (!data.filled) {
        setError(
          "Nothing in this workshop maps onto a world pack yet. Write some lore, places or hook cards first.",
        );
        return;
      }
      download(`${fileStem(manifest.name)}.world-pack.json`, data.draft);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "That could not be built.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className={ui.card + " p-4"}>
      <SectionHead title="Share this workshop" glyph="system-share" level="h2" />
      <p className="mb-4 text-sm text-stone-400">
        A bundle is everything you prepared here as one file: lore, places, NPCs, fights with
        their maps and plans, tables, maps with their doors, labels and props, the region map,
        the board with what each card picks, and your hand-built monsters. Pictures travel with
        it too, within the size caps. A chapter carries the records its cards pick from its
        shared workshop. Nothing from any campaign does.
      </p>

      <div className="mb-4 grid gap-3 sm:grid-cols-2" data-tour="share-manifest">
        <label className="block sm:col-span-2">
          <FieldLabel>Name</FieldLabel>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={70}
            placeholder="The Sunken Vault"
            className={ui.input}
          />
        </label>
        <label className="block sm:col-span-2">
          <FieldLabel>One line about it</FieldLabel>
          <input
            value={blurb}
            onChange={(event) => setBlurb(event.target.value)}
            maxLength={200}
            placeholder="A drowned dwarven city and the things that kept living in it."
            className={ui.input}
          />
        </label>
        <label className="block">
          <FieldLabel>Author</FieldLabel>
          <input
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
            maxLength={80}
            className={ui.input}
          />
        </label>
        <label className="block">
          <FieldLabel>Version</FieldLabel>
          <input
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            maxLength={20}
            className={ui.input}
          />
        </label>
        <label className="block sm:col-span-2">
          <FieldLabel>Homepage (optional)</FieldLabel>
          <input
            value={homepage}
            onChange={(event) => setHomepage(event.target.value)}
            maxLength={300}
            className={ui.input}
          />
        </label>
        <label className="block sm:col-span-2">
          <FieldLabel>Inspired by</FieldLabel>
          <input
            value={inspiredBy}
            onChange={(event) => setInspiredBy(event.target.value)}
            maxLength={200}
            placeholder="Original work, or the setting this is a homage to"
            className={ui.input}
          />
        </label>
        <label className="block sm:col-span-2">
          <FieldLabel>Rights holder</FieldLabel>
          <input
            value={rightsHolder}
            onChange={(event) => setRightsHolder(event.target.value)}
            maxLength={120}
            placeholder="Leave empty if this is your own world"
            className={ui.input}
          />
          <span className="mt-1 block text-xs text-stone-500">
            Fill this in if it is built on somebody else&apos;s setting. It is what turns the
            notice below into an explicit non-affiliation disclaimer.
          </span>
        </label>
      </div>

      <fieldset className="mb-4 space-y-1">
        <legend className="mb-1 text-xs text-stone-400">Your homebrew shelf in the bundle</legend>
        <SegmentedControl
          options={[
            { value: "all", label: "All of it" },
            { value: "used", label: "What this workshop uses" },
          ]}
          value={shelfScope}
          onChange={(value) => setShelfScope(value as "all" | "used")}
          size="sm"
          label="Your homebrew shelf in the bundle"
        />
        <span className="block text-xs text-stone-500">
          Used means the monsters its Cast and fights name, what its pregens carry, and anything its prepared text mentions by name. Whoever
          imports it keeps their own entries of the same name; a different one arrives beside theirs under this bundle&apos;s name.
        </span>
      </fieldset>

      <UnofficialPackNotice
        rightsHolder={rightsHolder}
        inspiredBy={inspiredBy.trim() || undefined}
        className="mb-4"
      />

      <div className="flex flex-wrap gap-2" data-tour="share-export">
        <button
          type="button"
          onClick={() => void exportBundle()}
          disabled={!ready || Boolean(busy)}
          aria-busy={busy === "bundle"}
          className={ui.btnPrimary}
        >
          {busy === "bundle" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          Download bundle
        </button>
        <button
          type="button"
          onClick={() => void exportPack()}
          disabled={!ready || Boolean(busy)}
          className={ui.btnSecondary}
        >
          {busy === "pack" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Package className="size-4" />
          )}
          Compile a world pack
        </button>
      </div>
      {!ready ? (
        <p className="reveal mt-2 text-xs text-stone-500">
          A name, a line about it and what it is inspired by are required before it can leave.
        </p>
      ) : null}

      {error ? <p className="motion-shake mt-3 text-sm text-red-300">{error}</p> : null}

      {counts ? (
        <ul className="stagger mt-4 flex flex-wrap gap-1.5">
          {Object.entries(counts)
            .filter(([, count]) => count > 0)
            .map(([kind, count]) => (
              <li
                key={kind}
                className="rounded-full border border-amber-500/30 bg-amber-400/5 px-2.5 py-0.5 text-xs text-stone-300"
              >
                {count} {BUNDLE_KIND_LABELS[kind] ?? kind}
              </li>
            ))}
        </ul>
      ) : null}

      {shelf ? (
        <div className="reveal mt-3 space-y-1 border-t border-stone-800 pt-3 text-xs text-stone-400" data-testid="bundle-shelf">
          <p>
            <span className="text-stone-300">From your shelf: </span>
            {shelf.included.length ? shelf.included.join(", ") : "nothing"}.
          </p>
          {shelf.unused.length ? (
            <p>
              <span className="text-stone-300">{shelfScope === "used" ? "Left out (this workshop does not use them): " : "Taken though this workshop does not use them: "}</span>
              {shelf.unused.join(", ")}.
            </p>
          ) : null}
          {shelf.missing.length ? (
            <p className="text-amber-300">
              Named by its Cast or fights but found nowhere, here or in the books: {shelf.missing.join(", ")}. The importer&apos;s table will not find them either.
            </p>
          ) : null}
        </div>
      ) : null}

      {refusals.length ? (
        <div className="dm-card reveal mt-4 border-t border-amber-500/15 pt-3">
          <SectionHead title="What did not fit in a world pack" glyph="quest-failed" />
          <ul className="stagger space-y-1.5">
            {refusals.map((refusal) => (
              <li key={refusal.field} className="text-xs text-stone-400">
                <span className="text-stone-300">{refusal.field}</span>
                <span className="block text-stone-500">{refusal.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {warnings.length ? (
        <ul className="stagger mt-3 space-y-1 border-t border-stone-800 pt-3">
          {warnings.map((warning) => (
            <li key={warning} className="text-xs text-amber-200/80">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
