// WorldForge's reading of a world's text (src/lib/worldforge/text.ts): the
// links an entry's text makes to the entries it names, and the scan for
// names that have no entry yet. Both read structure, the same way in every
// language: Unicode letters for word edges and capitals, a word the world
// writes in lower case for a common one, and a lower-case word the world
// writes between two different pairs of capitalised words for a connector.
import assert from "node:assert/strict";

const { mentionSegments, stubResolved, stubScan } = await import("../src/lib/worldforge/text.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const named = (...names) => names.map((name, index) => ({ ref: `npc:${index}`, name, aliases: [] }));
const linked = (text, known) => mentionSegments(text, known).filter((segment) => segment.ref).map((segment) => segment.text);
const found = (texts, known = [], stubs = []) => stubScan(texts, known, stubs).map((entry) => entry.name);

test("a mention is a whole word by Unicode letters, the longest name first", () => {
  const known = named("Arvendeth", "Arvendeth Keep", "José", "Élodie", "Женя", "Jean-Luc", "O'Brien");
  assert.deepEqual(linked("Arvendeth Keep stands above Arvendeth.", known), ["Arvendeth Keep", "Arvendeth"]);
  assert.deepEqual(linked("Élodie e José parlano con Женя.", known), ["Élodie", "José", "Женя"]);
  assert.deepEqual(linked("Joséphine non è José.", known), ["José"], "José is not inside Joséphine");
  assert.deepEqual(linked("Jean-Luc and O'Brien.", known), ["Jean-Luc", "O'Brien"]);
  assert.deepEqual(linked("Élodies and Женяся.", known), [], "a name inside a longer word is no mention");
});

test("English: a connector the world writes between two pairs of names joins a run; a sentence's opening word starts none", () => {
  const texts = [
    "The Vale of Sorrows lies north of the city. Pilgrims cross the Vale of Sorrows each spring.",
    "The Order of Dawn guards it, and the Tower of Dawn watches the road. Then Vex came.",
    "Nobody trusts Vex, and the old pilgrims fear Vex. A tower falls. The Captain laughs; the Captain lies; a captain dies.",
  ];
  const names = found(texts);
  for (const name of ["Vale of Sorrows", "Order of Dawn", "Tower of Dawn", "Vex"]) {
    assert.ok(names.includes(name), `${name} missing from ${names.join(", ")}`);
  }
  for (const name of names) {
    assert.doesNotMatch(name, /^(The|Then|Pilgrims|Nobody|A|Captain)\b/, names.join(", "));
  }
});

test("Italian, French, Spanish and German connectors and articles are read the same way", () => {
  const italian = found([
    "La Casa della Gilda è chiusa. I mercanti della città evitano la Casa della Gilda.",
    "Il Ponte della Morte crolla, e il fiume porta via il Ponte della Morte.",
  ]);
  assert.ok(italian.includes("Casa della Gilda") && italian.includes("Ponte della Morte"), italian.join(", "));
  assert.ok(!italian.some((name) => /^(La|Il|I) /.test(name)), italian.join(", "));
  const french = found(["La Tour de Garde veille. On voit la Tour de Garde et la Porte de Fer.", "La Porte de Fer est close."]);
  assert.ok(french.includes("Tour de Garde") && french.includes("Porte de Fer"), french.join(", "));
  const spanish = found(["El Paso del Lobo es frío. Cruzan el Paso del Lobo hacia la Torre del Alba.", "La Torre del Alba arde."]);
  assert.ok(spanish.includes("Paso del Lobo") && spanish.includes("Torre del Alba"), spanish.join(", "));
  const german = found(["Die Burg von Eisenwald steht. Man sieht die Burg von Eisenwald und das Tor von Hammerfeld.", "Das Tor von Hammerfeld fällt."]);
  assert.ok(german.includes("Burg von Eisenwald") && german.includes("Tor von Hammerfeld"), german.join(", "));
});

test("a single word needs two sightings, one mid-sentence, in any script", () => {
  assert.deepEqual(found(["Вчера пришёл Олег. потом Олег ушёл."]), ["Олег"]);
  assert.deepEqual(found(["Élodie dort. Élodie rêve."]), [], "only ever at a sentence start");
  assert.deepEqual(found(["« Bonjour », dit Élodie. Puis Élodie part."]), ["Élodie"]);
});

test("a connector seen once joins nothing until the world writes it again, its own names included", () => {
  const once = found(["The Vale of Sorrows lies north."]);
  assert.ok(!once.includes("Vale of Sorrows"), once.join(", "));
  const known = named("Casa della Gilda");
  const bridge = found(["Il Ponte della Morte crolla. Tutti temono il ponte."], known);
  assert.deepEqual(bridge, ["Ponte della Morte"], "a name may start with a common noun");
});

test("an entry's name, and every run holding it, and a kept stub are never suggested, by Unicode case", () => {
  const texts = ["L'Église de Saint-Rémi brûle. On fuit l'église de Saint-Rémi, puis l'Église de Saint-Rémi."];
  assert.ok(found(texts).includes("Saint-Rémi"));
  assert.deepEqual(found(texts, named("saint-rémi")), []);
  const stub = { id: "s1", name: "SAINT-RÉMI", note: "" };
  assert.ok(!found(texts, [], [stub]).includes("Saint-Rémi"));
  assert.equal(stubResolved(stub, named("Saint-Rémi"))?.name, "Saint-Rémi");
});

console.log(`test-worldforge-text: ${passed} passed`);
