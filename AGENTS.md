<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Token artwork

Before creating or replacing monster, NPC or character artwork, read
[docs/art/token-readability.md](docs/art/token-readability.md). These images also
appear as small round tokens: review the shipped asset at 96px and 40px, preserve
existing paths for repaints, and reuse approved art that already reads well.

## Creature artwork and content sources

Before creating or replacing creature art, adding bestiary content, or changing
image prompts, read [docs/art/creature-art-guidance.md](docs/art/creature-art-guidance.md).
Use a named SRD creature, an original design, or a separately licensed subject
with recorded permission. Do not let a generic prompt such as "aberration"
introduce a beholder or mind flayer. Inspect the rendered anatomy as well as the
prompt, and preserve the source and edit history with each art change.

## Addon framework

Before changing anything under `src/lib/addons/`, the addon routes, or the
board view bridge, read [docs/addons/framework.md](docs/addons/framework.md):
the code map, the rules every change keeps (addons propose and the server
disposes, no secrets in an addon's environment, sandboxed board views), and
the steps for a new manifest field, bridge message or extension point.
Regenerate `docs/addons/addon.schema.json` with
`node scripts/build-addon-schema.mjs` whenever the manifest schema changes.

## Settings, options and toggles

Every setting is paid for by every player who sets up a campaign. Before
adding a setting, option, toggle or picker anywhere (the campaign creator, a
campaign's panels, the admin console, the workshop), and when reviewing an
issue or pull request that asks for one:

1. Ship a good default first. If one default serves most tables, the feature
   needs no setting. A default that is only "off" or "same as before" means
   the feature is not finished.
2. Keep it out of the campaign creator unless it must be decided before the
   first scene and has no safe default (today: the setting, who runs the
   story, the players, safety). Everything else starts from its default and
   is changed later in the campaign's own settings.
3. One control per idea. A preset picker beats several toggles; "Custom"
   opens the detailed fields.
4. Show a control only when it can matter: no art style while pictures are
   off.
5. Someone who always customizes the same way saves it once as their
   personal defaults (`src/app/create-campaign/defaults.ts`); that is not a
   reason for another toggle.
6. A request or pull request that needs a new setting carries a screenshot or
   mockup of the proposed control, where it lives, and its default (the
   feature request and pull request templates ask for it). Without one, ask
   for it before building; do not invent the control yourself.

## Releases

Before cutting, promoting or fixing a release of the server or the apps, read
[docs/releases.md](docs/releases.md). Versions are plain `x.y.z`; whether a
release is a beta or stable is only its GitHub prerelease flag. Once betas
have started (the client repository's `PUBLISH_AS_BETA` variable is `true`),
publish every server release with `--prerelease`, never `--latest`, and make
a release stable only by promoting a beta that meets the doc's checks. Never
promote a release, or set that variable, unless the maintainer asks for it.
