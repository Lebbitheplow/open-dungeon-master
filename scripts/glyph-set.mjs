// The UI glyphs: the small paintings that stand for a session tab, a
// workshop system, a section or a menu verb. They show at 16 to 28
// pixels, so they are drawn for that size, not for a card:
//
//   - one object, never a scene; a figure only where the thing IS people
//   - the object light and bright all over, so it reads on the dark plate
//     GameIcon draws (a dark subject on a dark disc vanished)
//   - a silhouette no sibling shares: the books, scrolls and suns of the
//     first set were told apart only by detail that 20 pixels cannot show
//   - the convention a player already knows where there is one (a cog for
//     settings, a quill for edit, a bell for a notice), in this world's
//     materials: a modern bin or an emoji face broke the look, so delete
//     is a red enamel X, not a bin
//   - colour as a second cue only: a state is told apart by its shape too
//     (a check, a cross, a padlock), never by hue alone
//   - one meaning, one picture: a menu verb has its own `ui-` glyph instead
//     of borrowing a tab's (Delete used to wear a torn quest scroll)
//
// Rendered on Qwen Image 2.1 (scripts/generate-icons.mjs), which keeps to
// the one object a prompt names. Pure data plus prompt assembly; consumed by
// scripts/icon-set.mjs.

export const GLYPH_STYLE =
  "a hand painted medieval fantasy RPG inventory icon, made of the materials of that world such as gold, bronze, iron, " +
  "wood, parchment, leather, gemstones and coloured enamel, soft painterly brushwork, high key lighting with luminous saturated colour, " +
  "one big simple chunky shape with bold proportions and no fine ornament or small details, the whole object light toned " +
  "with no dark or black parts, a thin warm light rim, front view, readable at very small size, " +
  "isolated on a plain flat black background, centred, filling most of the frame, no text, no letters, no numbers, no frame, no border";

export const GLYPH_NEGATIVE =
  "text, letters, numbers, words, watermark, signature, frame, border, scene, landscape background, many small objects, " +
  "flat vector clip art, emoji, cartoon smiley, modern objects, plastic, photograph, grey background, blurry, low quality";

// [id, label, subject] per group. The id is the file name under
// public/assets/icons/glyph without the group's prefix.
export const UI_GLYPHS = {
  tab: [
    ["dm", "Game master", "a golden royal crown with three red gems"],
    ["lead", "Story lead", "a brass lantern held up, glowing warm yellow"],
    ["party", "Party", "the heads and shoulders of three adventurers side by side, a shining gold helmed knight, a mage in a bright sky blue hood and a ranger in a bright leaf green hood, faces lit warmly"],
    ["battle", "Battle", "two crossed swords with bright polished silver blades that shine white and gold hilts"],
    ["map", "Map", "an unrolled parchment treasure map with a red X"],
    ["story", "Story", "an open book with glowing cream pages"],
    ["quests", "Quests", "a rolled parchment scroll tied with a red ribbon and a gold exclamation mark"],
    ["timeline", "Timeline", "a gold hourglass with blue sand"],
    ["facts", "Facts", "a grey stone tablet carved with lines"],
    ["log", "Log", "a wooden clipboard holding a parchment list with tick marks"],
    ["notes", "Notes", "a small stack of three parchment note cards, the top one lined"],
    ["chat", "Chat", "a big rounded ivory speech bubble"],
    ["context", "Context", "a pair of round gold spectacles"],
    ["settings", "Settings", "a solid filled golden cog wheel with a small round hole in the middle"],
    ["bonds", "Bonds", "two interlocked gold rings"],
    ["factions", "Factions", "a tall hanging heraldic banner, blue with a gold lion"],
    ["market", "Market", "a market stall with a red and white striped awning"],
    ["handout", "Handout", "a sealed parchment envelope with a red wax seal"],
    ["shop", "Shop", "a hanging wooden shop sign on an iron bracket, shaped like a potion bottle"],
    ["trade", "Trade", "a fat tan leather coin pouch passing between two open hands"],
    ["loot", "Loot", "an open wooden treasure chest full of gold coins"],
    ["journal", "Journal", "a closed brown leather diary with a strap and a gold clasp"],
    ["session", "Session", "a lit white candle in a brass holder"],
    ["friends", "Friends", "two small smiling people side by side with a red heart above them"],
    ["reference", "Reference", "a wooden lectern holding a big open book"],
    ["characters", "Characters", "a silver knight's helmet with a red plume"],
    ["campaigns", "Campaigns", "a small stone castle with two towers and a red flag on top"],
    ["ambience", "Ambience", "a small golden harp"],
    ["dice", "Dice", "two red six sided dice tumbling"],
    ["admin", "Admin", "a large ornate gold key"],
  ],
  system: [
    ["storyboard", "Storyboard", "a cork board with three pinned cards"],
    ["party", "Party", "the heads and shoulders of three adventurers side by side, a shining gold helmed knight, a mage in a bright sky blue hood and a ranger in a bright leaf green hood, faces lit warmly"],
    ["maps", "Battle maps", "a square map with a grid and a red round token on it"],
    ["region", "Region", "a gold and white compass rose"],
    ["encounters", "Encounters", "a crossed sword and axe over a round red shield"],
    ["cast", "Cast", "a pair of theatre masks, one smiling gold, one frowning silver"],
    ["factions", "Factions", "a tall hanging heraldic banner, blue with a gold lion"],
    ["bestiary", "Bestiary", "a pale horned monster skull"],
    ["homebrew", "Homebrew", "a round glass alchemy flask of bubbling purple potion"],
    ["lore", "Lore", "a standing grey rune stone with glowing blue runes"],
    ["tables", "Tables", "an ivory twenty sided die resting on a parchment list"],
    ["rules", "Rules", "a thick red rulebook with a gold twenty sided die on its cover"],
    ["plugin", "Plugin", "a green jigsaw puzzle piece"],
    ["share", "Share", "a white carrier pigeon flying with a small scroll"],
    ["rulesets", "Rulesets", "a stack of three thick books, red, blue and green"],
    ["world", "WorldForge", "a small glowing blue globe resting on an iron anvil"],
  ],
  // Menu verbs and settings sections: one picture per meaning.
  ui: [
    ["delete", "Delete", "a bold red X of two thick crossed enamel strokes with a thin gold rim"],
    ["edit", "Edit", "a white feather quill pen writing a gold line on a small parchment sheet"],
    ["duplicate", "Duplicate", "two small parchment cards with thick gold borders, one directly behind the other and shifted up and to the right so both cards show clearly"],
    ["upload", "Upload", "a big bold gold arrow pointing straight up out of a small open wooden box"],
    ["export", "Export", "a big gold arrow pointing down into an open wooden box"],
    ["pin", "Pin", "a red round pushpin"],
    ["up", "Move up", "a bold gold arrow pointing straight up"],
    ["down", "Move down", "a bold gold arrow pointing straight down"],
    ["skip", "Skip", "two bold gold chevrons pointing right"],
    ["zoom", "Enlarge", "a large round brass magnifying glass with a clear glass lens and a short wooden handle, tilted"],
    ["restore", "Restore", "a thick bold gold arrow bent into a U turn, its head pointing back to the left"],
    ["paint", "Paint", "a paintbrush with a big drop of bright paint"],
    ["placeholder", "Placeholder", "an empty gold picture frame"],
    ["join", "Join", "an open wooden door with warm light spilling out"],
    ["new", "New", "a cream parchment page with a big bold gold plus sign painted in its centre"],
    ["quickstart", "Quick start", "a burning torch with a bright flame"],
    ["solo", "Solo", "a single hooded wanderer with a walking staff, green cloak"],
    ["act", "Act", "a long bright steel sword pointing straight up, held by a gauntlet at its hilt"],
    ["ooc", "Out of character", "a pale blue cloud shaped thought bubble with three small round bubbles trailing below it"],
    ["key", "Key", "a large ornate silver key"],
    ["ai", "Text model", "a crystal ball glowing blue on a gold stand"],
    ["agent", "Agent", "the head of a brass clockwork automaton with glowing blue eyes"],
    ["utility", "Utility model", "a small brass clockwork songbird"],
    ["voice", "Voice chat", "an old brass microphone"],
    ["speech", "Speech", "a big brass speaking trumpet seen from the side with three bold curved sound waves coming out of its bell"],
    ["backup", "Backup", "a sturdy iron safe with a round dial"],
    ["storage", "Storage", "a stack of three wooden crates"],
    ["accounts", "Accounts", "three oval cameo portraits in gold frames side by side, pale ivory faces"],
    ["lock", "Lock", "a gold padlock"],
    ["terms", "Terms", "a rolled parchment charter with a hanging red ribbon seal"],
    ["licenses", "Licenses", "a gold medal rosette with ribbons"],
  ],
};
