import Link from "next/link";
import { PIXEL_ICONS } from "@/lib/ui";
import { PageSection, PageShell } from "@/components/PageShell";
import { listDocuments } from "@/lib/content";
import { contentPackInstalled } from "@/lib/content/db";
import { listWorldPackSummaries } from "@/lib/worlds";
import { installedTracks } from "@/lib/ambience/library";
import { cueById } from "@/lib/ambience/catalog";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Licenses | Open Dungeon Master",
};

// Attribution for the imported Open5e dataset (a mix of CC-BY and OGL
// documents) plus the bundled SRD data. Required by the content licenses.
export default function LicensesPage() {
  const documents = listDocuments();
  const installed = contentPackInstalled();
  const worldPacks = listWorldPackSummaries();
  const ambience = installedTracks();

  return (
    <PageShell
      icon={PIXEL_ICONS.support}
      title="Licenses and attribution"
      blurb="Where the bundled rules, imported content and sounds come from."
      actions={
        <Link href="/" className="text-sm text-amber-200 hover:text-amber-100">
          Back to Open Dungeon Master
        </Link>
      }
    >
      <PageSection bodyClassName="space-y-3 text-sm leading-6 text-stone-300">
        <p>
          Open Dungeon Master bundles game content from the System Reference Document 5.1
          (SRD 5.1) by Wizards of the Coast LLC, available under the Creative Commons
          Attribution 4.0 International License (CC-BY-4.0).
        </p>
        <p>
          Expanded character options, spells, items, and monsters are imported from the{" "}
          <span className="text-stone-100">Open5e</span> dataset (open5e.com), which
          aggregates open-licensed tabletop content. Each source document and its license
          is listed below.
        </p>
        {!installed ? (
          <p className="rounded border border-stone-700 bg-stone-900 p-3 text-stone-400">
            The Open5e content pack is not installed on this server. Run
            <span className="font-mono"> node scripts/import-open5e.mjs</span> to download
            it; until then the app uses only the bundled SRD 5.1 data.
          </p>
        ) : null}
      </PageSection>

      {documents.length ? (
        <PageSection heading="Imported source documents">
          <ul className="mt-4 space-y-3">
            {documents.map((document) => (
              <li
                key={document.slug}
                className="rounded-lg border border-stone-800 bg-stone-900/60 p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-stone-100">{document.title}</span>
                  <span className="text-xs text-amber-200">{document.license}</span>
                </div>
                {document.author ? (
                  <p className="mt-1 text-xs text-stone-400">by {document.author}</p>
                ) : null}
                {document.url ? (
                  <a
                    href={document.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block break-all text-xs text-stone-500 hover:text-stone-300"
                  >
                    {document.url}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </PageSection>
      ) : null}

      {worldPacks.length ? (
        <PageSection heading="Campaign plugins">
          <p className="text-sm leading-6 text-stone-400">
            World packs rename existing SRD races, classes, spells, items and monsters to fit a
            setting. No rule and no stat block is changed.
          </p>
          <p className="text-sm leading-6 text-stone-400">
            Community campaign packs were installed on this server by its operator. They are{" "}
            <span className="text-stone-200">not distributed with Open Dungeon Master</span>, are
            not covered by its MIT license, and are the work of their own authors. Where a pack
            references an existing setting it is an unofficial fan work with no affiliation with
            or endorsement from that setting&apos;s rights holders. Each pack names its own
            attribution wherever it appears in the app.
          </p>
        </PageSection>
      ) : null}

      {ambience.length ? (
        <PageSection heading="Sound library">
          <p className="text-sm leading-6 text-stone-400">
            Ambience and music files were fetched from public archives by this server&apos;s
            operator and are{" "}
            <span className="text-stone-200">not distributed with Open Dungeon Master</span>.
            Each one is credited below as its archive recorded it.
          </p>
          <ul className="mt-4 space-y-2">
            {ambience.map((track) => (
              <li
                key={track.cueId}
                className="rounded-lg border border-stone-800 bg-stone-900/60 p-3 text-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-stone-100">
                    {cueById(track.cueId)?.label ?? track.cueId}
                    <span className="ml-2 text-xs text-stone-500">{track.title}</span>
                  </span>
                  <span className="text-xs text-amber-200">{track.license}</span>
                </div>
                <p className="mt-1 text-xs text-stone-400">by {track.author}</p>
                {track.source ? (
                  <a
                    href={track.source}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block break-all text-xs text-stone-500 hover:text-stone-300"
                  >
                    {track.source}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </PageSection>
      ) : null}

      <p className="px-1 text-xs text-stone-500">
        Open Dungeon Master itself is MIT licensed. Homebrew content belongs to the user who
        created it, and installed campaign plugins belong to their authors.
      </p>
    </PageShell>
  );
}
