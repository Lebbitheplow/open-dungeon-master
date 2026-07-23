// Browser-side trigger: build the fillable character-sheet PDF and hand it to
// the user as a download. Kept apart from the builder so the pdf-lib layout
// stays environment-agnostic while this half touches the DOM.

import { buildCharacterSheetPdf, type PdfCharacter } from "./character-sheet-pdf";

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "character"
  );
}

export async function downloadCharacterSheetPdf(character: PdfCharacter): Promise<void> {
  const bytes = await buildCharacterSheetPdf(character);
  // Copy into a fresh ArrayBuffer so the Blob never sees a SharedArrayBuffer-backed view.
  const blob = new Blob([bytes.slice()], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${slugify(character.name)}-character-sheet.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
