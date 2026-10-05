import { inflateSync } from "node:zlib";

// A small text extractor for the PDFs a table owns (docs/vtt-parity-
// implementation-plan.md section 5.3). It walks the file's content streams,
// inflates the FlateDecode ones, and reads the text-showing operators (Tj,
// TJ, ', ") in order, with a new line at every text-line move. Simple fonts
// with byte strings come out readable; a subset font with a custom map
// comes out as its glyph codes, which the chunker then mostly ignores.
// That is enough for a rules PDF written with ordinary fonts, which is what
// this is for. Encrypted files yield nothing.

export const PDF_MAX_BYTES = 25 * 1024 * 1024;

// What reading one file may cost. The file is capped at upload, but deflate
// packs a run of identical bytes about a thousand to one, so a 25 MB file
// can claim tens of gigabytes once inflated, and all of it would be
// inflated, decoded and walked synchronously on the server's one event
// loop. A real page's content stream is tens to hundreds of KB; these leave
// a sourcebook plenty of room and an inflation bomb none.
const MAX_STREAM_BYTES = 8 * 1024 * 1024;
const MAX_INFLATED_BYTES = 64 * 1024 * 1024;
const MAX_STREAMS = 20_000;
const DEFLATE_MAX_RATIO = 1032;
// The text a caller gets when it names no budget of its own.
export const PDF_TEXT_MAX = 1_000_000;

// The strings in one content stream, in the order they are drawn.
function textFromContent(content: string): string {
  const out: string[] = [];
  let index = 0;
  let line: string[] = [];
  const flushLine = () => {
    if (line.length) {
      out.push(line.join(""));
      line = [];
    }
  };
  while (index < content.length) {
    const char = content[index];
    if (char === "(") {
      // A literal string, with escapes and balanced parentheses.
      let depth = 1;
      let text = "";
      index += 1;
      while (index < content.length && depth > 0) {
        const c = content[index];
        if (c === "\\") {
          const next = content[index + 1] ?? "";
          const escapes: Record<string, string> = { n: "\n", r: "", t: " ", b: "", f: "", "(": "(", ")": ")", "\\": "\\" };
          if (next in escapes) {
            text += escapes[next];
            index += 2;
            continue;
          }
          const octal = /^[0-7]{1,3}/.exec(content.slice(index + 1, index + 4));
          if (octal) {
            text += String.fromCharCode(Number.parseInt(octal[0], 8));
            index += 1 + octal[0].length;
            continue;
          }
          text += next;
          index += 2;
          continue;
        }
        if (c === "(") {
          depth += 1;
        } else if (c === ")") {
          depth -= 1;
          if (depth === 0) {
            index += 1;
            break;
          }
        }
        text += c;
        index += 1;
      }
      line.push(text);
      continue;
    }
    if (char === "<" && content[index + 1] !== "<") {
      // A hex string.
      const end = content.indexOf(">", index);
      if (end === -1) {
        break;
      }
      const hex = content.slice(index + 1, end).replace(/\s+/g, "");
      let text = "";
      for (let at = 0; at + 1 < hex.length; at += 2) {
        text += String.fromCharCode(Number.parseInt(hex.slice(at, at + 2), 16));
      }
      line.push(text);
      index = end + 1;
      continue;
    }
    // Operators: a text-line move or a text object end breaks the line; a
    // TJ array's kerning numbers wider than a space become a space.
    const op = /^(T\*|Td|TD|ET|'|")/.exec(content.slice(index, index + 2));
    if (op && /[\s\]]/.test(content[index - 1] ?? " ")) {
      flushLine();
      index += op[0].length;
      continue;
    }
    if (char === "-" || /[0-9]/.test(char)) {
      const number = /^-?\d+(\.\d+)?/.exec(content.slice(index, index + 16));
      if (number && content[index - 1] !== "(" && Number(number[0]) < -180) {
        line.push(" ");
      }
      index += number ? number[0].length : 1;
      continue;
    }
    index += 1;
  }
  flushLine();
  return out.join("\n");
}

// Every content stream in the file, inflated when it says so, handed out
// one at a time so the reader can stop as soon as it has enough text. Stops
// for good once the file has cost MAX_INFLATED_BYTES or MAX_STREAMS; a
// single stream that would inflate past MAX_STREAM_BYTES is skipped.
function* streams(bytes: Uint8Array): Generator<string> {
  const latin = Buffer.from(bytes).toString("latin1");
  const pattern = /stream\r?\n/g;
  let spent = 0;
  let seen = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(latin))) {
    const start = match.index + match[0].length;
    const end = latin.indexOf("endstream", start);
    if (end === -1) {
      break;
    }
    // Past the keyword, whose own "stream\n" would otherwise read as the
    // start of another stream.
    pattern.lastIndex = end + "endstream".length;
    seen += 1;
    if (seen > MAX_STREAMS || spent >= MAX_INFLATED_BYTES) {
      return;
    }
    const head = latin.slice(Math.max(0, match.index - 400), match.index);
    // This stream's own dictionary when it fits in the window, so a
    // neighbour's keys do not decide what this one is.
    const objectAt = head.lastIndexOf("obj");
    const dictionary = objectAt === -1 ? head : head.slice(objectAt);
    if (/\/Subtype\s*\/Image\b/.test(dictionary)) {
      // Pictures draw no text, and are the biggest streams a real book
      // has; never inflated, so they cannot spend the budget.
      continue;
    }
    const raw = Buffer.from(latin.slice(start, end), "latin1");
    let text: string;
    if (/FlateDecode/.test(dictionary)) {
      try {
        const inflated = inflateSync(raw, {
          maxOutputLength: Math.min(MAX_STREAM_BYTES, MAX_INFLATED_BYTES - spent),
        });
        spent += inflated.length;
        text = inflated.toString("latin1");
      } catch {
        // Corrupt, or bigger than a page has any reason to be. Whatever was
        // inflated before it gave up still counts, at the most it could have
        // been: deflate never expands past about 1032 to 1.
        spent += Math.min(MAX_STREAM_BYTES, MAX_INFLATED_BYTES - spent, raw.length * DEFLATE_MAX_RATIO);
        continue;
      }
    } else if (/Filter/.test(dictionary)) {
      // An image or a compression this does not read.
      continue;
    } else {
      spent += raw.length;
      text = raw.toString("latin1");
    }
    // Only content streams draw text; fonts, images and xref streams do not.
    if (/\b(Tj|TJ)\b/.test(text)) {
      yield text;
    }
  }
}

export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 5 && Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";
}

export function isEncryptedPdf(bytes: Uint8Array): boolean {
  return /\/Encrypt\b/.test(Buffer.from(bytes).toString("latin1"));
}

// The readable text of a PDF, pages in file order, or "" when there is
// none to be had. Reading stops once `maxChars` of text are in hand, so a
// caller that keeps only the opening of a book never pays for the rest.
export function extractPdfText(bytes: Uint8Array, maxChars = PDF_TEXT_MAX): string {
  if (!isPdf(bytes) || isEncryptedPdf(bytes)) {
    return "";
  }
  const pages: string[] = [];
  let length = 0;
  for (const content of streams(bytes)) {
    const page = textFromContent(content);
    pages.push(page);
    length += page.length + 2;
    if (length >= maxChars) {
      break;
    }
  }
  return pages
    .join("\n\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}
