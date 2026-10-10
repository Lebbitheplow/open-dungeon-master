// The gates scripts/fetch-ambience.mjs puts every archive candidate through,
// kept apart from the script so scripts/test-ambience.mjs can try them.
//
// A search that returns something correctly licensed but about the wrong
// thing is the worse failure of the two: a missing cue is silent, and a
// wrong one is an audiobook in the cave. The first run of the script found
// exactly that: Commons answered "cave" with a Lovecraft reading, "sewer"
// with someone pronouncing "sewer rat", "forest" with the Brussels commune
// of that name read aloud, and "temple" with a Lully minuet.

// Words that appear in every query and so distinguish nothing.
const NOISE = new Set([
  "sound", "sounds", "effect", "effects", "ambience", "ambient", "ambiance",
  "loop", "public", "domain", "music", "instrumental", "orchestral", "noise",
  "the", "and", "with", "from", "field", "recording",
]);

export function words(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .split(" ")
    .filter((word) => word.length >= 4 && !NOISE.has(word));
}

// The candidate's title has to share a distinguishing word with what was
// asked for.
export function relevant(query, title) {
  const wanted = words(query);
  if (!wanted.length) {
    return true;
  }
  const found = new Set(words(title));
  return wanted.some((word) => found.has(word));
}

// Spoken word: audiobooks, pronunciation clips, articles read aloud, news
// bulletins, podcasts. All of it is correctly licensed and none of it is
// ambience, and the archives are full of it.
const SPOKEN = [
  /librivox/i,
  /\bll-q\d+\b/i, // Lingua Libre pronunciation clips
  /pronunciation/i,
  /\bspoken\b/i,
  /audio wikipedia/i,
  /wikipedia/i,
  /audiobook/i,
  /\bchapter \d+/i,
  /\bpodcast/i,
  /\bnews\b/i,
  /\binterview/i,
  /\bspeech\b/i,
  /\blecture/i,
  /\bsermon/i,
  /\bread by\b/i,
  /\bnarrat/i,
  /\bpoem\b|\bpoetry\b/i,
  /\(eng\)|\(fra\)|\(deu\)|\(spa\)|\(ita\)|\(por\)|\(nld\)|\(pol\)|\(rus\)/i,
];

export function spokenWord(title, author = "") {
  const text = `${title ?? ""} ${author ?? ""}`;
  return SPOKEN.some((pattern) => pattern.test(text));
}

// How long a file for this layer may run. A bed loops under a scene and a
// music cue carries one, so neither is of use under half a minute; a sting
// is one beat and a four-minute "thunder" is a storm recording, not a clap.
// Unknown length (the archive did not say) passes: the size gate still
// applies and the operator can listen.
export function durationOk(layer, seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return true;
  }
  if (layer === "sting") {
    return seconds <= 20;
  }
  if (layer === "music") {
    return seconds >= 45 && seconds <= 900;
  }
  return seconds >= 30 && seconds <= 1800;
}

// Returns a short label when the licence is acceptable, null when it is not.
// Deliberately conservative: anything this cannot positively identify is
// refused, including a blank licence field. NC and ND are refused even under
// allowAttribution: whether an app that plays them is a commercial or
// derivative use is exactly the question this script must not answer on an
// operator's behalf.
export function acceptLicense(shortName, url, allowAttribution = false) {
  const text = `${shortName ?? ""} ${url ?? ""}`.toLowerCase();
  if (
    text.includes("publicdomain/zero") ||
    text.includes("publicdomain/mark") ||
    text.includes("creative commons 0") ||
    /\bcc0\b/.test(text) ||
    text.includes("public domain")
  ) {
    return "Public domain (CC0 or PD Mark)";
  }
  if (!allowAttribution) {
    return null;
  }
  // Order matters: "by-sa" contains "by".
  if (text.includes("by-sa") || text.includes("attribution-sharealike")) {
    return "CC BY-SA (attribution and share-alike required)";
  }
  if (text.includes("by-nc") || text.includes("noncommercial") || text.includes("noderiv")) {
    return null;
  }
  if (text.includes("cc by") || text.includes("cc-by") || text.includes("licenses/by/")) {
    return "CC BY (attribution required)";
  }
  return null;
}

// Everything above in one answer, with the reason a candidate was refused,
// so a dry run can say why a cue found nothing.
export function admit(candidate, { layer, query }) {
  if (!candidate.license) {
    return { ok: false, why: "licence" };
  }
  if (spokenWord(candidate.title, candidate.author)) {
    return { ok: false, why: "spoken word" };
  }
  if (!relevant(query, candidate.title)) {
    return { ok: false, why: "off topic" };
  }
  if (!durationOk(layer, candidate.seconds)) {
    return { ok: false, why: `${Math.round(candidate.seconds)}s is the wrong length for a ${layer}` };
  }
  return { ok: true, why: "" };
}
