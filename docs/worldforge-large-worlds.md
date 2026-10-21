# WorldForge in large worlds

How the World tab behaves with 100, 1,000 and 4,000 entries, the budgets a 1,000-entry world is held to, and how to measure again. This answers audit finding WF-24 and the measurement step of plan M6.

4,000 entries is the document's limit (`LIMITS.entries` in `src/lib/worldforge/model.ts`).

## The worlds

`scripts/lib/large-world.mjs` builds a WorldForge file of any size. The same size always gives the same world. A world has:

- **Entries:** four in ten are people, a quarter places, one in ten factions, and the rest lore of three types.
- **Text length:** most texts are short (200 to 800 characters). A quarter run to a few paragraphs, and one in twenty is a long article of 8,000 to 15,000 characters.
- **Links and history:** about two links per entry, an event for every two entries, and a secret for every twenty.
- **Organisation:** a folder for every fifty entries, and custom fields (Born, Rank, Population, Climate, Founded).
- **Atlas:** a world map, a regional map for every hundred entries, and pins on a tenth of the places.

| Size | Links | Events | File |
| --- | --- | --- | --- |
| 100 | 200 | 50 | 163 KB |
| 1,000 | 2,000 | 500 | 2.0 MB |
| 4,000 | 8,000 | 2,000 | 8.0 MB |

Three search targets are planted in each world: an entry's exact name, a word found only in the last paragraph of one long article, and a value found only in one character's Rank field.

## How to measure

The server half, in Node against a scratch database:

```bash
node scripts/measure-large-worlds.mjs
```

It brings each world in as a WorldForge file, then times the world route's answer, weighs it as sent and gzipped, and times the wiki's search. Add `--sizes 1000` for one size, or `--json out.json` to keep the rows.

The browser half drives the built app (run `npm run build` first) in Chrome, on a desktop and a phone viewport:

```bash
node scripts/browser/run.mjs --only large-world-measure --out <a new folder>
```

It prints one `MEASURE` line per size and viewport. The scenario only runs when named in full. Set `ODM_MEASURE_SIZES=1000` for one size, or `ODM_MEASURE_ENCODING=identity` to ask for uncompressed answers. Each line records:

- **first usable:** from opening the World tab to the list showing its first entry with the search box ready. The median of 3. "After answer" is the part after the world route answered.
- **on the wire:** the world route's answer as sent.
- **search:** from typing to the entry that holds the target showing in the list. The median of 3 per target.
- **list:** from clearing the search to the whole list drawn again, then the list scrolled top to bottom over 40 frames (the longest frame and the mean).
- **web:** from pressing Web to the web drawn and settled, and how many entries it shows.

Times come from the test runner, so each includes a few milliseconds of its own polling. The 100-entry rows are the first in each run and include the page's own first load, so read their first-usable time as about half a second either way.

The numbers below were taken on 21 October 2026 on an Intel Core i5-11400F with 16 GB, Windows 11, Chrome 155 headless, against `next start` on the same machine. The "before" column is release 0.28.4 (`2bcd162d`), measured with the same scripts.

## What we found

Before, a 4,000-entry world was slow everywhere:

- The world route sent 17.8 MB, uncompressed. `next start` gzips pages and static files but not a route handler's answer.
- A third of that was the same data twice: every entry's WorldForge record was sent in `doc.entries` and again as `entity.entry`.
- The server took about 0.5 s to build the answer. Most of that was each character's play fields reading the whole link list, about 26 million checks.
- The list drew all 4,000 rows. It took over a second to appear, and scrolled at 12 to 15 frames a second.
- Search read names, aliases and tags only. A word in an article or a field's value was never found.
- The Web laid out and drew all 3,926 linked entries. It took 13.5 s to settle into a tangle nobody could read.
- With 20 folders (the 1,000-entry world), the folder list pushed the entry list below a desktop's first screen. The 4,000-entry world has 80.

### Before and after

Desktop viewport (phone in brackets where it differs):

| | 100 before | 100 after | 1,000 before | 1,000 after | 4,000 before | 4,000 after |
| --- | --- | --- | --- | --- | --- | --- |
| Answer on the wire | 358 KB | 48 KB | 4,488 KB | 580 KB | 17,773 KB | 2,368 KB |
| First usable World tab | 0.41 s | 0.40 s | 1.32 s (1.30) | 1.00 s (0.85) | 4.26 s (3.99) | 1.43 s (1.13) |
| After the answer arrived | 0.08 s | 0.09 s | 0.63 s (0.66) | 0.11 s (0.10) | 2.28 s (2.40) | 0.13 s (0.10) |
| Search by name | 0.03 s | 0.09 s | 0.24 s | 0.13 s | 0.49 s (0.50) | 0.24 s (0.20) |
| Search by a word in an article | not found | 0.04 s | not found | 0.12 s | not found | 0.23 s (0.18) |
| Search by a field's value | not found | 0.03 s | not found | 0.13 s | not found | 0.21 s (0.18) |
| Whole list drawn again | 0.08 s | 0.08 s | 0.34 s | 0.10 s | 1.16 s (1.37) | 0.14 s (0.08) |
| Scroll, longest / mean frame | 22 / 17 ms | 19 / 18 ms | 37 / 19 ms | 37 / 24 ms | 142 / 68 ms (71 / 58) | 48 / 31 ms (37 / 22) |
| Web settled (entries shown) | 0.25 s (98) | 0.21 s (98) | 1.87 s (981) | 0.98 s (300) | 13.6 s (3,926) | 1.03 s (300) |
| Rows drawn in the list | 100 | 100 | 1,000 | 21 (19) | 4,000 | 21 (19) |
| JavaScript heap | 18 MB | 46 MB | 42 MB | 24 MB | 84 MB | 70 MB |

On the server (Node, median of 3):

| | 100 | 1,000 | 4,000 |
| --- | --- | --- | --- |
| Answer built, before | 5 ms | 57 ms | 479 ms |
| Answer built, after | 4 ms | 37 ms | 146 ms |
| Answer size, before | 358 KB | 4,488 KB | 17,773 KB |
| Answer size, after | 275 KB | 3,197 KB | 12,713 KB |
| Search keys built (once per world) | 2 ms | 21 ms | 82 ms |
| Each search | under 1 ms | 2 ms | 4 ms |
| WorldForge file brought in (unchanged) | 59 ms | 0.9 s | 10.6 s |

The 4,000-entry answer's time to the last byte over `curl` on the same machine:

| Packing | Size | Time |
| --- | --- | --- |
| none | 12.7 MB | 0.23 to 0.35 s |
| brotli, quality 1 | 2.4 MB | 0.24 s |
| gzip, level 1 | 2.7 MB | 0.27 to 0.54 s |
| gzip, level 6, through zlib's thread pool | 2.1 MB | 3.2 to 3.5 s |

The last row is why the packing is synchronous. In the running server, zlib's shared thread pool took 3 to 4 s to pack the same answer that a direct `gzipSync` packs in 0.2 s.

## What changed

- **Each entry's record is sent once.** The world routes send the document without `entries`, and the client puts them back from the entities (`worldAnswer` in `src/lib/db/world-forge.ts`, `fromAnswer` in `useWorld.ts`).
- **The answer is packed.** The world route answers through `compressedJson` (`src/lib/compressed-json.ts`): brotli when the browser takes it, otherwise gzip, both at their fastest setting, for answers over 64 KB.
- **The server reads each character's links once.** `worldEntities` groups links by where they start before working out play fields.
- **Search reads texts and fields** (`src/lib/worldforge/search.ts`). Name, alias and tag matches come first, then field matches, then text matches. Each row says where it matched. The search keys are built once per world, and only when someone searches.
- **The list draws only what is in view** (`EntryList.tsx`) once it has more than 120 rows. Each row says where it stands among all of them. The arrow keys, Home, End, Page Up and Page Down move through the list, and Down from the search box enters it. The open entry is scrolled into view when the list first fills, so an entry opened by its address shows selected.
- **The folder list scrolls on its own**, so the entry list starts on the first screen of a desktop.
- **The whole world's Web shows its 300 most linked entries** and says so. Centring on an entry shows its neighbourhood, whatever the world's size.

## Budgets

A 1,000-entry world is held to these. Sizes are exact, so their budgets sit close to the measurement. Times have wide margins, because CI's runners are slower than this machine.

`scripts/test-world-large-budgets.mjs` (Node):

| Budget | Limit | Measured |
| --- | --- | --- |
| Answer size | 3,500 KB | 3,197 KB |
| Answer, gzipped at level 6 | 600 KB | 513 KB |
| Answer on the wire, packed as sent | 900 KB | 579 KB (brotli), 667 KB (gzip) |
| Answer built | 600 ms | 37 ms |
| Packing, with the JSON | 300 ms | 16 ms (brotli), 23 ms (gzip) |
| Search keys built | 500 ms | 21 ms |
| Each search | 100 ms | 2 ms or less |

`scripts/browser/scenarios/55-large-world.mjs` (desktop and phone):

| Budget | Limit | Measured |
| --- | --- | --- |
| First usable World tab | 8 s | 0.85 to 1.0 s |
| Each search (name, word, field) | 3 s | 0.10 to 0.13 s |
| Web drawn | 10 s | about 1 s |
| Entries in the whole world's Web | 300 | 300 |
| Rows drawn in the list | under 80 | 19 to 21 |
| List on a desktop's first screen | yes | yes |

The scenario also checks that keyboard use works (Down from search, End, Home, Enter), that the search rows show where they matched, and that an entry deep in the world opens by its address after a reload.

## Not done yet

- **Every entry's full text still loads with the World tab.** That is 12.7 MB to read at 4,000 entries, 2.4 MB on the wire. Loading summaries for the list and the full entry on opening would cut the first load further. It needs search on the server (`search.ts` is pure and can run there), and the entry page, Ask and the other views to fetch what they read.
- **A slice save still answers with the whole world.** Every link, pin or folder change gets back 12.7 MB, packed to 2.4 MB, at 4,000 entries. Live sync in another tab reads the whole world again too.
- **The hub card's counts** build the whole world view (146 ms at 4,000).
- **Bringing in a 4,000-entry file** takes 10.6 s inside one request.
- **The Atlas delete and restore and the secret reveal** send the world unpacked. They are rare actions.
- **Not measured:** the Timeline with 2,000 events, the Atlas with 400 pins, the Secrets view, the table's World tab (it uses the same list and search), and the native app shells.
- **Search excerpts** show the matched words in lower case without punctuation, because they come from the search key.
