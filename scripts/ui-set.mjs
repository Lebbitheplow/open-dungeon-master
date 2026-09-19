// The catalogue of painted UI furniture (docs/visual-overhaul-plan.md 8b.4):
// the parts of the scroll, the book, the plates and frames, painted once and
// animated by the app. Text is never baked in; the app lays it on top.
//
// Two shapes. A `cutout` is one object on white, matted and shipped on
// transparency (a roller, a seal, a ribbon, a bracket). A `flat` is a texture
// or a spread that ships as it is; `tiling` flats wrap.
//
// Consumed by scripts/generate-ui.mjs. Pure data plus prompt assembly.

const STYLE =
  "hand painted fantasy illustration, rich warm colour, soft top light, painterly texture, " +
  "no text, no writing, no letters, no symbols, no logo";

const CUTOUT = "isolated on a plain flat white background, centred, the whole object visible with empty margin, straight on, not tilted, orthographic";

// [id, what it is, width, height, options]
//   options: { shape: "cutout"|"flat", tiling, use }
const PARTS = [
  // the scroll
  ["scroll-roller", "a single dark wooden scroll roller rod with carved round end caps, horizontal, no parchment on it", 1024, 256, { shape: "cutout", use: "scroll" }],
  ["scroll-roller-brass", "a single scroll roller rod of dark wood with brass end caps, horizontal, no parchment on it", 1024, 256, { shape: "cutout", use: "scroll" }],
  ["parchment-body", "seamless texture of aged parchment paper, subtle fibres and faint stains, warm cream, evenly lit, fills the frame edge to edge", 1024, 1024, { shape: "flat", tiling: true, use: "scroll" }],
  ["parchment-dark", "seamless texture of old darkened parchment, mottled brown, evenly lit, fills the frame edge to edge", 1024, 1024, { shape: "flat", tiling: true, use: "scroll" }],
  ["parchment-edge", "a long horizontal strip of torn ragged parchment edge with fibres, running the full width of the frame, the parchment above the tear and white below", 1024, 256, { shape: "cutout", use: "scroll" }],
  ["wax-seal", "a round red wax seal with an embossed dragon crest, slightly irregular edge", 512, 512, { shape: "cutout", use: "scroll" }],
  ["wax-seal-gold", "a round gold wax seal with an embossed sun crest", 512, 512, { shape: "cutout", use: "scroll" }],
  ["ribbon-bookmark", "a single red silk ribbon bookmark hanging vertically with a small gold tassel at the bottom", 320, 1024, { shape: "cutout", use: "book" }],
  ["ribbon-banner", "a horizontal unfurled red silk banner ribbon with folded swallowtail ends, empty, seen straight on", 1024, 320, { shape: "cutout", use: "banner" }],
  ["ribbon-banner-gold", "a horizontal unfurled gold silk banner ribbon with folded swallowtail ends, empty, seen straight on", 1024, 320, { shape: "cutout", use: "banner" }],

  // the book
  ["book-closed", "a closed thick leather bound tome with brass corner fittings and a clasp, seen from directly above, the cover flat and square to the frame", 1024, 1024, { shape: "cutout", use: "book" }],
  ["book-spread", "an open old book seen from directly above, two blank aged parchment pages with a soft gutter shadow in the middle and worn leather cover edges around them, filling the frame, straight on", 1024, 768, { shape: "flat", use: "book" }],
  ["page-single", "a single blank aged parchment book page seen straight on, faint fibres, the outer edge slightly worn, filling the frame", 768, 1024, { shape: "flat", use: "book" }],
  ["page-turning", "a single blank parchment page curling as it turns, seen straight on, white background", 768, 1024, { shape: "cutout", use: "book" }],
  ["leather-cover", "seamless texture of dark red brown tooled leather with a faint grain, evenly lit, fills the frame edge to edge", 1024, 1024, { shape: "flat", tiling: true, use: "book" }],
  ["corner-ornament", "an ornate gold filigree corner bracket ornament, an L shape for the corner of a page, seen straight on", 512, 512, { shape: "cutout", use: "frame" }],
  ["corner-ornament-iron", "an ornate black wrought iron corner bracket ornament, an L shape, seen straight on", 512, 512, { shape: "cutout", use: "frame" }],

  // plates and frames
  ["icon-plate", "a round dark stone medallion plate with a thin polished gold rim, empty centre, seen straight on", 512, 512, { shape: "cutout", use: "plate" }],
  ["icon-plate-rare", "a round dark blue enamel medallion plate with a silver rim, empty centre, seen straight on", 512, 512, { shape: "cutout", use: "plate" }],
  ["icon-plate-epic", "a round dark violet enamel medallion plate with an ornate gold rim, empty centre, seen straight on", 512, 512, { shape: "cutout", use: "plate" }],
  ["portrait-medallion", "an ornate round gold and bronze medallion frame with an empty dark centre, filigree and a small crest at the top, seen straight on", 768, 768, { shape: "cutout", use: "frame" }],
  ["card-frame", "an ornate rectangular tall playing card frame of dark bronze filigree with gold corner flourishes and an empty dark centre, seen straight on, portrait orientation", 768, 1088, { shape: "cutout", use: "card" }],
  ["panel-frame", "an ornate rectangular bronze and dark wood picture frame with gold corner flourishes, the inside of the frame is a plain flat black void, nothing inside the frame, wider than tall, seen straight on", 1024, 768, { shape: "cutout", use: "frame" }],
  ["title-cartouche", "an ornate horizontal bronze cartouche nameplate with scrolled ends, empty centre, seen straight on", 1024, 320, { shape: "cutout", use: "frame" }],
  ["divider-rule", "a thin horizontal gold ornamental rule with a small diamond in the middle and tapered filigree ends, on white", 1024, 128, { shape: "cutout", use: "frame" }],
  ["button-plate", "a horizontal gold foil button plate with bevelled edges and a soft highlight, empty, seen straight on", 1024, 256, { shape: "cutout", use: "plate" }],
  ["stamp-diamond", "a small gold diamond shaped stud with a bevel, seen straight on", 256, 256, { shape: "cutout", use: "frame" }],
  // chrome for the rest of the app (plan 8c): loaders, switches, chips, tabs,
  // crests, pins and the empty-state vignettes
  ["sigil-loading", "a circular arcane sigil ring of gold runes and thin concentric circles, empty centre, seen straight on", 512, 512, { shape: "cutout", use: "loader" }],
  ["compass-rose", "an ornate gold and bronze compass rose with eight points, seen straight on", 512, 512, { shape: "cutout", use: "loader" }],
  ["hourglass", "a small brass hourglass with pale sand, upright, seen straight on", 256, 512, { shape: "cutout", use: "loader" }],
  ["quill", "a single white goose quill pen with an ink tipped nib, diagonal", 512, 512, { shape: "cutout", use: "indicator" }],
  ["candle", "a single lit beeswax candle in a small brass holder, upright, seen straight on", 256, 512, { shape: "cutout", use: "indicator" }],
  ["toggle-track", "a horizontal brass switch track, a rounded pill shape with a recessed dark channel, empty, seen straight on", 512, 256, { shape: "cutout", use: "control" }],
  ["toggle-knob", "a round polished brass switch knob with a soft highlight, seen straight on", 256, 256, { shape: "cutout", use: "control" }],
  ["chip-plate", "a small horizontal rounded parchment chip with a thin dark leather border, empty, seen straight on", 512, 192, { shape: "cutout", use: "control" }],
  ["tab-plate", "a small horizontal dark wooden tab plate with brass rivets in the corners, empty, seen straight on", 512, 192, { shape: "cutout", use: "control" }],
  ["shield-blank", "a plain heraldic shield shape of dark burnished steel with a thin gold rim, empty, seen straight on", 512, 512, { shape: "cutout", use: "crest" }],
  ["banner-vertical", "a long hanging heraldic cloth banner of deep red with a gold fringe and a wooden rod at the top, empty, seen straight on", 384, 1024, { shape: "cutout", use: "crest" }],
  ["map-pin", "a single gold map pin with a round head, seen from the side, upright", 256, 384, { shape: "cutout", use: "map" }],
  ["stars-sky", "seamless texture of a deep night sky with small soft stars and faint nebula haze, evenly spread, fills the frame edge to edge", 1024, 1024, { shape: "flat", tiling: true, use: "ambient" }],
  ["empty-chest", "a single open wooden treasure chest with iron bands, empty inside, seen from the front and slightly above", 768, 768, { shape: "cutout", use: "empty" }],
  ["empty-scroll-rack", "a single small wooden scroll rack with all its pigeonholes empty, seen straight on", 768, 768, { shape: "cutout", use: "empty" }],
  ["empty-notice-board", "a single wooden notice board with a few empty pins and no notices, seen straight on", 768, 768, { shape: "cutout", use: "empty" }],
  ["empty-map-table", "a single wooden map table with an unrolled blank parchment and a candle, seen from above at a slight angle", 768, 768, { shape: "cutout", use: "empty" }],
  ["dust-motes", "seamless texture of tiny soft glowing gold dust motes scattered on pure black, evenly spread, fills the frame edge to edge", 1024, 1024, { shape: "flat", tiling: true, use: "ambient" }],
];

export const UI_LIST = PARTS.map(([id, detail, width, height, options]) => ({
  id,
  detail,
  width,
  height,
  shape: options.shape,
  tiling: Boolean(options.tiling),
  use: options.use,
  prompt: options.shape === "cutout" ? `${detail}, ${CUTOUT}, ${STYLE}` : `${detail}, ${STYLE}`,
}));
