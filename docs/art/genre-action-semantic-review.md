# Genre action art: meaning and readability review

Revision requested October 30, 2026. The first review checked file availability,
transparency, layout and genre styling but missed misleading action meanings.
Those automated checks did not establish that the pictures were understandable.

## Code evidence

`src/lib/battlemap/hand.ts` deals `unarmed-strike` for an unarmed attack and item
art for a weapon attack. `hand-class.ts` uses the same unarmed key for bonus
strikes. The genre selector previously covered only the legacy `attack` key,
so the actual unarmed card missed the variants entirely. Both action keys now
select the genre fist. Fantasy/custom fallback and named weapons keep their art.

The basic action definitions in `hand.ts` distinguish a sustained grapple,
a shove that pushes or knocks prone, escape from a grappler, standing from
prone, and ending the turn. Their images need distinct visual cues.

## Audit of all 75 illustrations

Each row covers the five genre versions: cyberpunk, steampunk, mystery, horror
and post-apocalyptic. Replace means the original image failed this review.

| Action | Disposition | Meaning checked |
| --- | --- | --- |
| Attack / Unarmed strike | Replace all five | A fist, not an arbitrary sword or firearm; route the real unarmed card to it. |
| Cast | Replace mystery and steampunk; retain three | Mystery uses an active seance with a spectral vortex rising from a journal; steampunk projects a large aether vortex from a brass apparatus. Both emphasize activation. |
| Dash | Retain all five | Extended running stride and forward motion. |
| Disengage | Retain all five | One figure retreats from an opponent, with separation between them. |
| Dodge | Retain all five | A body evades a visible incoming strike or projectile. |
| Help | Replace mystery; retain four | Assistance or a supportive forearm grip. The mystery handshake read as greeting. |
| Hide | Retain all five | A figure conceals their body behind a clear piece of cover. |
| Ready | Retain all five | A held aiming stance, without discharge, with genre-appropriate ranged equipment. |
| Grapple | Replace cyberpunk; retain four | Close contact and bent arms in a sustained hold. Cyberpunk showed an extended push. |
| Shove | Replace cyberpunk; retain four | Open pushing hands and a target leaning away. Cyberpunk showed a wrist grip. |
| Use object | Retain all five | A hand operates a distinct tool or mechanism. |
| End turn | Retain cyberpunk; replace four | Consistent hourglass plus completion mark. Holstering or lowering equipment was ambiguous. |
| Search | Replace steampunk, horror and post-apocalyptic; retain two | Steampunk magnifies a footprint beside a dropped cog. Horror discovers a bloody handprint, gouges and a watching eye through a door crack. Post-apocalyptic light reveals supplies partly hidden under rubble. |
| Escape | Replace all five | A simple broken-chain symbol, without hands or people. The attempted released-wrist composition also failed: distorted fingers and disconnected arms obscured the action. |
| Stand up | Replace all five | Rising from a knee, with a large explicit upward arrow. A kneeling pose alone was ambiguous. |

Total: 27 replacements and 48 retained illustrations. Genre is expressed through
clothing, materials and palette; the action cue stays consistent across settings.
These judgments are a visual review, not a claim of user-testing or automatic
semantic validation.

The October 31 follow-up rejected the intermediate Escape replacements as well.
Their prompts produced two isolated arms rather than a readable release from a
grip. The final broken-chain cue is deliberately symbolic; genre differences
come from metal and finish. Both rejected versions remain in the source history.

The next October 31 review refined Mystery and Steampunk Cast plus three Search
images. The setting definitions support seances for Mystery and aether technology
for Steampunk. The previous pendulum was too specific to hypnosis, while the
previous brass device needed a stronger active effect. Search now emphasizes
discovery of evidence or concealed supplies rather than machinery or inventory
inspection. The first new Horror Search was rejected as insufficiently creepy;
the final version adds a bloody smear, gouges and an eye watching through a crack.
The flashlight remains its Search cue. The exact prompts and source selections
are in `genre-action-cast-search-revision-2026-10-31.json`.

Steampunk Search was then refined from modern hiking tread to a distinct heel
and hobnail pattern. The period direction is supported by the London Museum's
[nineteenth-century boot record](https://www.londonmuseum.org.uk/collections/v/object-772985/boot/).
Only the textual description informed the design; no museum image was used.

## Review evidence

The active art manifest preserves the superseded source names, prompts and hashes
in each changed record's history. The revision manifest records the replacement
prompts and selected generated files. Originals and the first review PDF remain
available for comparison. Review the final assets at 112x56 and 80x40 on both
light and dark surfaces, and compare Grapple, Shove and Escape side by side.

The regression check in `scripts/test-hand-look.mjs` now derives a real unarmed
card and checks its genre artwork and fantasy fallback. It would fail under the
previous mapping, unlike a test that only constructs the legacy `attack` key.
