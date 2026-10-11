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
// asked for. A source that matched on its own tags (incompetech's moods)
// says so with `tagged` and is not asked to match the words as well.
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

// Commons also files every audio under categories ("Spoken English
// Wikipedia", "Audio files of speeches"), which say more than a title can.
const SPOKEN_CATEGORY = /spoken|speech|audio versions of wikipedia|audiobook|pronunciation|podcast|lecture|interview|reading|news|debate|sermon|homil|oral history|remarks|address/i;

const SOUND_CATEGORY = /sound effects|sounds of|field recording|nature sounds|ambien|environmental|noise|soundscape|audio files of (rain|thunder|wind|water|waves|the sea|rivers|waterfalls|fire|birds|animals|insects|frogs|wolves|dogs|cats|horses|bells|gongs|horns|doors|crowds|cities|forests|weather|storms|explosions|footsteps|breathing|heartbeats)/i;

export function spokenWord(title, author = "", categories = "") {
  const text = `${title ?? ""} ${author ?? ""}`;
  return SPOKEN.some((pattern) => pattern.test(text)) || /\b(remarks|testimony|hearing|debate|homily|oral history)\b/i.test(text) || SPOKEN_CATEGORY.test(String(categories ?? ""));
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
// refused, including a blank licence field.
//
// Free licences that ask only for credit (CC BY, CC BY-SA, OpenGameArt's
// OGA-BY) are accepted, because the app keeps the credit for you: every
// file's title, author, source and licence are written to the lock and the
// manifest and shown on /licenses. `publicDomainOnly` narrows it to CC0 and
// the Public Domain Mark. NonCommercial and NoDerivatives are refused
// either way: whether an app that plays them is a commercial or derivative
// use is exactly the question this script must not answer on an operator's
// behalf.
export function acceptLicense(shortName, url, publicDomainOnly = false) {
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
  if (publicDomainOnly) {
    return null;
  }
  if (text.includes("by-nc") || text.includes("noncommercial") || text.includes("non-commercial") || text.includes("noderiv") || text.includes("by-nd")) {
    return null;
  }
  if (text.includes("oga-by")) {
    return "OGA-BY (attribution required)";
  }
  // Order matters: "by-sa" contains "by".
  if (text.includes("by-sa") || text.includes("attribution-sharealike") || text.includes("sharealike")) {
    return "CC BY-SA (attribution and share-alike required)";
  }
  if (text.includes("cc by") || text.includes("cc-by") || text.includes("licenses/by/") || text.includes("attribution")) {
    return "CC BY (attribution required)";
  }
  return null;
}

// Whether a track under this licence label may travel in the sound pack the
// project ships: public domain and the attribution licences, with the
// credit riding along in the pack. Anything the operator declared
// themselves stays on their server.
export function redistributable(license) {
  const text = String(license ?? "").toLowerCase();
  return (
    text.startsWith("public domain") ||
    text.startsWith("cc by") ||
    text.startsWith("oga-by")
  );
}

// Everything above in one answer, with the reason a candidate was refused,
// so a dry run can say why a cue found nothing.
export function admit(candidate, { layer, query }) {
  if (!candidate.license) {
    return { ok: false, why: "licence" };
  }
  if (spokenWord(candidate.title, candidate.author, candidate.categories)) {
    return { ok: false, why: "spoken word" };
  }
  if (!candidate.tagged && !relevant(query, candidate.title)) {
    return { ok: false, why: "off topic" };
  }
  // Commons says what a file is in its categories, and a recording of a
  // place or a thing is filed as one: "Audio files of thunder", "Sounds of
  // rain", "Sound effects". For a bed or a sting a Commons file has to be
  // filed that way; a title with the right word on an interview, a song or
  // an uncategorised upload is not evidence of anything.
  if (layer !== "music" && candidate.categories !== undefined) {
    const categories = String(candidate.categories ?? "");
    if (/\bmusic\b|\bsongs?\b|\balbums?\b|\bband\b|orchestra|choir|opera|anthem|hymn|\bjazz\b/i.test(categories)) {
      return { ok: false, why: "music, not a sound" };
    }
    if (!SOUND_CATEGORY.test(categories)) {
      return { ok: false, why: "not filed as a sound" };
    }
    // A species recording from xeno-canto is one bird at close range; a
    // bed wants the whole plain.
    if (layer === "bed" && /xeno-canto|\(audio\)|bird (calls|songs|vocali)/i.test(categories)) {
      return { ok: false, why: "a single species, not a place" };
    }
  }
  if (!durationOk(layer, candidate.seconds)) {
    return { ok: false, why: `${Math.round(candidate.seconds)}s is the wrong length for a ${layer}` };
  }
  return { ok: true, why: "" };
}
