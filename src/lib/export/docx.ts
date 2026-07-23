import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TableOfContents,
  TextRun,
} from "docx";
import type { StoryDocument } from "./story-document";

// Renders a StoryDocument as a .docx (OOXML). Chapter headings use the
// Heading 1 style, which docx turns into bookmarks that the TableOfContents
// field links to; Word/LibreOffice fill in the page numbers on first open.

// Splits a multi-paragraph string into styled Paragraphs, preserving single
// line breaks inside a paragraph as soft breaks.
function textParagraphs(text: string): Paragraph[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\n/);
      return new Paragraph({
        children: lines.map(
          (line, index) => new TextRun({ text: line, break: index > 0 ? 1 : undefined }),
        ),
        spacing: { after: 140 },
      });
    });
}

function transcriptParagraph(speaker: string, text: string): Paragraph {
  const lines = text.split(/\n/);
  return new Paragraph({
    spacing: { after: 100 },
    children: [
      new TextRun({ text: `${speaker}  `, bold: true }),
      ...lines.map(
        (line, index) => new TextRun({ text: line, break: index > 0 ? 1 : undefined }),
      ),
    ],
  });
}

export async function renderStoryDocx(doc: StoryDocument): Promise<Uint8Array> {
  const metaBits = [
    doc.meta.theme,
    `Level ${doc.meta.startingLevel} start`,
    doc.meta.difficulty,
    doc.meta.status,
  ].filter(Boolean);

  const children: (Paragraph | TableOfContents)[] = [];

  children.push(
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(doc.title)] }),
    new Paragraph({
      children: [new TextRun({ text: metaBits.join("  ·  "), italics: true, color: "808080" })],
      spacing: { after: 160 },
    }),
  );
  if (doc.premise.trim()) {
    for (const paragraph of textParagraphs(doc.premise)) {
      children.push(paragraph);
    }
  }

  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Contents")] }),
    new TableOfContents("Contents", {
      hyperlink: true,
      headingStyleRange: "1-1",
    }),
    new Paragraph({ pageBreakBefore: true, children: [] }),
  );

  if (doc.questLog.length) {
    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Quest Log")] }),
    );
    for (const quest of doc.questLog) {
      children.push(new Paragraph({ text: quest, bullet: { level: 0 } }));
    }
  }

  for (const chapter of doc.chapters) {
    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(chapter.heading)] }),
    );
    for (const highlight of chapter.highlights) {
      children.push(new Paragraph({ text: highlight, bullet: { level: 0 } }));
    }
    for (const paragraph of textParagraphs(chapter.summary)) {
      children.push(paragraph);
    }
    if (chapter.transcript.length) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun("Transcript")],
        }),
      );
      for (const line of chapter.transcript) {
        children.push(transcriptParagraph(line.speaker, line.text));
      }
    }
  }

  const document = new Document({
    creator: "Open Dungeon Master",
    title: `${doc.title} — Story`,
    description: doc.premise.slice(0, 500),
    features: { updateFields: true },
    sections: [{ properties: {}, children }],
  });

  const buffer = await Packer.toBuffer(document);
  return new Uint8Array(buffer);
}
