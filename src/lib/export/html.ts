import { escapeXml, type StoryDocument } from "./story-document";

// Renders a StoryDocument as a self-contained, stylized HTML page: an indexed
// table of contents that jumps to each chapter, chapter summaries with
// highlights, and the full transcript. No external assets, all CSS inline.

function chapterAnchor(index: number): string {
  return `chapter-${index}`;
}

function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeXml(block).replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

export function renderStoryHtml(doc: StoryDocument): string {
  const metaBits = [
    doc.meta.theme,
    `Level ${doc.meta.startingLevel} start`,
    doc.meta.difficulty,
    doc.meta.status,
  ].filter(Boolean);

  const toc = doc.chapters
    .map(
      (chapter) =>
        `<li><a href="#${chapterAnchor(chapter.index)}">${escapeXml(chapter.heading)}</a></li>`,
    )
    .join("\n");

  const questLog = doc.questLog.length
    ? `<section class="quests"><h2>Quest Log</h2><ul>${doc.questLog
        .map((quest) => `<li>${escapeXml(quest)}</li>`)
        .join("")}</ul></section>`
    : "";

  const chapters = doc.chapters
    .map((chapter) => {
      const highlights = chapter.highlights.length
        ? `<ul class="highlights">${chapter.highlights
            .map((h) => `<li>${escapeXml(h)}</li>`)
            .join("")}</ul>`
        : "";
      const summary = chapter.summary.trim() ? paragraphs(chapter.summary) : "";
      const transcript = chapter.transcript.length
        ? `<div class="transcript"><h3>Transcript</h3>${chapter.transcript
            .map(
              (line) =>
                `<p class="line ${line.kind}"><span class="speaker">${escapeXml(
                  line.speaker,
                )}</span>${escapeXml(line.text).replace(/\n/g, "<br />")}</p>`,
            )
            .join("\n")}</div>`
        : "";
      return `<section class="chapter" id="${chapterAnchor(chapter.index)}">
  <h2>${escapeXml(chapter.heading)}</h2>
  ${highlights}
  ${summary}
  ${transcript}
</section>`;
    })
    .join("\n");

  const exportedDate = new Date(doc.meta.exportedAt).toLocaleString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="${escapeXml(doc.premise).slice(0, 300)}" />
<meta name="generator" content="Open Dungeon Master" />
<title>${escapeXml(doc.title)} — Story</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #0c0a09; color: #d6d3d1;
    font-family: Georgia, "Iowan Old Style", "Times New Roman", serif;
    line-height: 1.65; padding: 2.5rem 1.25rem 5rem;
  }
  .sheet { max-width: 52rem; margin: 0 auto; }
  h1 { font-family: "Trebuchet MS", system-ui, sans-serif; font-size: 2.2rem; color: #fef3c7; margin: 0 0 .35rem; letter-spacing: .01em; }
  h2 { font-family: "Trebuchet MS", system-ui, sans-serif; color: #fcd34d; font-size: 1.5rem; margin: 2.25rem 0 .75rem; border-bottom: 1px solid #292524; padding-bottom: .35rem; }
  h3 { font-family: "Trebuchet MS", system-ui, sans-serif; color: #a8a29e; font-size: 1rem; text-transform: uppercase; letter-spacing: .12em; margin: 1.5rem 0 .5rem; }
  a { color: #fbbf24; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .meta { color: #78716c; font-size: .9rem; margin: 0 0 .25rem; }
  .premise { color: #e7e5e4; font-style: italic; margin: 1rem 0 0; }
  nav.toc { margin: 2rem 0; padding: 1rem 1.25rem; border: 1px solid #292524; border-radius: .6rem; background: #1c1917; }
  nav.toc h2 { margin: 0 0 .5rem; font-size: 1rem; border: 0; color: #fcd34d; }
  nav.toc ol { margin: 0; padding-left: 1.35rem; }
  nav.toc li { margin: .2rem 0; }
  .quests ul { padding-left: 1.35rem; }
  .chapter { scroll-margin-top: 1rem; }
  ul.highlights { padding-left: 1.35rem; color: #fde68a; }
  ul.highlights li { margin: .2rem 0; }
  .transcript { margin-top: 1.25rem; padding-top: .5rem; border-top: 1px dashed #292524; }
  .line { margin: .55rem 0; }
  .line .speaker { display: inline-block; font-family: "Trebuchet MS", system-ui, sans-serif; font-weight: 700; margin-right: .5rem; }
  .line.dm .speaker { color: #fcd34d; }
  .line.player .speaker { color: #7dd3fc; }
  .footer { margin-top: 3rem; color: #57534e; font-size: .8rem; text-align: center; }
</style>
</head>
<body>
<div class="sheet">
  <h1>${escapeXml(doc.title)}</h1>
  <p class="meta">${metaBits.map(escapeXml).join(" · ")}</p>
  ${doc.premise.trim() ? `<p class="premise">${escapeXml(doc.premise)}</p>` : ""}
  <nav class="toc">
    <h2>Contents</h2>
    <ol>
${toc}
    </ol>
  </nav>
  ${questLog}
  ${chapters}
  <p class="footer">Exported from Open Dungeon Master on ${escapeXml(exportedDate)}.</p>
</div>
</body>
</html>`;
}
