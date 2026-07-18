import Link from "next/link";
import { listDocuments } from "@/lib/content";
import { contentPackInstalled } from "@/lib/content/db";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Licenses | Open Dungeon Master",
};

// Attribution for the imported Open5e dataset (a mix of CC-BY and OGL
// documents) plus the bundled SRD data. Required by the content licenses.
export default function LicensesPage() {
  const documents = listDocuments();
  const installed = contentPackInstalled();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/" className="text-sm text-amber-200 hover:text-amber-400">
        Back to Open Dungeon Master
      </Link>
      <h1 className="mt-4 font-serif text-3xl text-stone-100">Licenses and attribution</h1>

      <section className="mt-6 space-y-3 text-sm leading-6 text-stone-300">
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
      </section>

      {documents.length ? (
        <section className="mt-8">
          <h2 className="font-serif text-xl text-stone-100">Imported source documents</h2>
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
        </section>
      ) : null}

      <p className="mt-10 text-xs text-stone-500">
        Open Dungeon Master itself is MIT licensed. Homebrew content belongs to the user
        who created it.
      </p>
    </main>
  );
}
