import JSZip from "jszip";
import { escapeXml, type StoryChapter, type StoryDocument } from "./story-document";

// Renders a StoryDocument as an .odt (OpenDocument Text): a ZIP of ODF XML
// parts. Chapters are outline-level headings, so LibreOffice indexes them into
// the table of contents, which regenerates page numbers and links on
// Tools > Update > Indexes and Tables.

const OFFICE_NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"',
].join(" ");

// A text run with ODF soft line breaks for embedded newlines.
function inlineText(text: string): string {
  return escapeXml(text).replace(/\n/g, "<text:line-break/>");
}

function paragraph(styleName: string, text: string): string {
  return `<text:p text:style-name="${styleName}">${inlineText(text)}</text:p>`;
}

function bulletList(items: string[]): string {
  if (!items.length) {
    return "";
  }
  const entries = items
    .map(
      (item) =>
        `<text:list-item><text:p text:style-name="List_20_Bullet">${inlineText(item)}</text:p></text:list-item>`,
    )
    .join("");
  return `<text:list text:style-name="ODMBullets">${entries}</text:list>`;
}

function summaryParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => paragraph("Standard", block))
    .join("");
}

function chapterBody(chapter: StoryChapter): string {
  const highlights = bulletList(chapter.highlights);
  const summary = chapter.summary.trim() ? summaryParagraphs(chapter.summary) : "";
  const transcript = chapter.transcript.length
    ? `<text:h text:style-name="Heading_20_2" text:outline-level="2">Transcript</text:h>` +
      chapter.transcript
        .map(
          (line) =>
            `<text:p text:style-name="Standard"><text:span text:style-name="Speaker">${escapeXml(
              line.speaker,
            )}</text:span>  ${inlineText(line.text)}</text:p>`,
        )
        .join("")
    : "";
  return (
    `<text:h text:style-name="Heading_20_1" text:outline-level="1">${escapeXml(chapter.heading)}</text:h>` +
    highlights +
    summary +
    transcript
  );
}

function tableOfContents(chapters: StoryChapter[]): string {
  const entries = chapters
    .map((chapter) => paragraph("Contents_20_1", chapter.heading))
    .join("");
  return `<text:table-of-content text:style-name="Sect1" text:protected="true" text:name="Table of Contents">
    <text:table-of-content-source text:outline-level="10" text:use-outline-level="true">
      <text:index-title-template text:style-name="Contents_20_Heading">Contents</text:index-title-template>
      <text:table-of-content-entry-template text:outline-level="1" text:style-name="Contents_20_1">
        <text:index-entry-link-start text:style-name="Internet_20_Link"/>
        <text:index-entry-chapter/>
        <text:index-entry-text/>
        <text:index-entry-tab-stop style:type="right" style:leader-char="."/>
        <text:index-entry-page-number/>
        <text:index-entry-link-end/>
      </text:table-of-content-entry-template>
    </text:table-of-content-source>
    <text:index-body>
      <text:index-title text:name="Table of Contents_Head"><text:p text:style-name="Contents_20_Heading">Contents</text:p></text:index-title>
      ${entries}
    </text:index-body>
  </text:table-of-content>`;
}

function buildContentXml(doc: StoryDocument): string {
  const metaBits = [
    doc.meta.theme,
    `Level ${doc.meta.startingLevel} start`,
    doc.meta.difficulty,
    doc.meta.status,
  ].filter(Boolean);

  const questLog = doc.questLog.length
    ? `<text:h text:style-name="Heading_20_1" text:outline-level="1">Quest Log</text:h>` +
      bulletList(doc.questLog)
    : "";

  const body =
    paragraph("Title", doc.title) +
    paragraph("Subtitle", metaBits.join("  ·  ")) +
    (doc.premise.trim() ? paragraph("Standard", doc.premise) : "") +
    tableOfContents(doc.chapters) +
    questLog +
    doc.chapters.map(chapterBody).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${OFFICE_NS} office:version="1.3">
  <office:automatic-styles>
    <text:list-style style:name="ODMBullets">
      <text:list-level-style-bullet text:level="1" text:bullet-char="•">
        <style:list-level-properties text:list-level-position-and-space-mode="label-alignment">
          <style:list-level-label-alignment text:label-followed-by="listtab" fo:margin-left="0.5cm" fo:text-indent="-0.5cm"/>
        </style:list-level-properties>
      </text:list-level-style-bullet>
    </text:list-style>
  </office:automatic-styles>
  <office:body>
    <office:text>
      ${body}
    </office:text>
  </office:body>
</office:document-content>`;
}

function buildStylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${OFFICE_NS} office:version="1.3">
  <office:styles>
    <style:style style:name="Standard" style:family="paragraph" style:class="text">
      <style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.212cm"/>
      <style:text-properties fo:font-family="Georgia" fo:font-size="11pt"/>
    </style:style>
    <style:style style:name="Title" style:family="paragraph" style:parent-style-name="Standard">
      <style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.2cm"/>
      <style:text-properties fo:font-size="26pt" fo:font-weight="bold" fo:color="#8a6d1f"/>
    </style:style>
    <style:style style:name="Subtitle" style:family="paragraph" style:parent-style-name="Standard">
      <style:paragraph-properties fo:margin-bottom="0.4cm"/>
      <style:text-properties fo:font-size="11pt" fo:font-style="italic" fo:color="#6b6b6b"/>
    </style:style>
    <style:style style:name="Heading_20_1" style:display-name="Heading 1" style:family="paragraph" style:parent-style-name="Standard" style:default-outline-level="1">
      <style:paragraph-properties fo:margin-top="0.5cm" fo:margin-bottom="0.2cm"/>
      <style:text-properties fo:font-size="17pt" fo:font-weight="bold" fo:color="#8a6d1f"/>
    </style:style>
    <style:style style:name="Heading_20_2" style:display-name="Heading 2" style:family="paragraph" style:parent-style-name="Standard" style:default-outline-level="2">
      <style:paragraph-properties fo:margin-top="0.35cm" fo:margin-bottom="0.15cm"/>
      <style:text-properties fo:font-size="12pt" fo:font-weight="bold" style:text-transform="uppercase" fo:color="#6b6b6b"/>
    </style:style>
    <style:style style:name="Contents_20_Heading" style:display-name="Contents Heading" style:family="paragraph" style:parent-style-name="Standard">
      <style:text-properties fo:font-size="15pt" fo:font-weight="bold" fo:color="#8a6d1f"/>
    </style:style>
    <style:style style:name="Contents_20_1" style:display-name="Contents 1" style:family="paragraph" style:parent-style-name="Standard"/>
    <style:style style:name="List_20_Bullet" style:display-name="List Bullet" style:family="paragraph" style:parent-style-name="Standard"/>
    <style:style style:name="Speaker" style:family="text">
      <style:text-properties fo:font-weight="bold" fo:color="#8a6d1f"/>
    </style:style>
    <style:style style:name="Internet_20_Link" style:display-name="Internet Link" style:family="text">
      <style:text-properties fo:color="#b8860b" style:text-underline-style="solid"/>
    </style:style>
  </office:styles>
</office:document-styles>`;
}

function buildMetaXml(doc: StoryDocument): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta ${OFFICE_NS} office:version="1.3">
  <office:meta>
    <meta:generator>Open Dungeon Master</meta:generator>
    <dc:title>${escapeXml(doc.title)} — Story</dc:title>
    <dc:creator>Open Dungeon Master</dc:creator>
    <meta:creation-date>${escapeXml(doc.meta.exportedAt)}</meta:creation-date>
    <dc:date>${escapeXml(doc.meta.exportedAt)}</dc:date>
  </office:meta>
</office:document-meta>`;
}

function buildManifestXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
  <manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;
}

export async function renderStoryOdt(doc: StoryDocument): Promise<Uint8Array> {
  const zip = new JSZip();
  // The mimetype part must be the first entry and stored uncompressed.
  zip.file("mimetype", "application/vnd.oasis.opendocument.text", { compression: "STORE" });
  zip.file("content.xml", buildContentXml(doc));
  zip.file("styles.xml", buildStylesXml());
  zip.file("meta.xml", buildMetaXml(doc));
  zip.file("META-INF/manifest.xml", buildManifestXml());
  return zip.generateAsync({ type: "uint8array" });
}
