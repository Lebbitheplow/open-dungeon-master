# Running the server: settings, admin panel, sign-in

Back to the [README](../README.md).

## Configuration and settings precedence

Most things are configurable in the app itself. When the same setting exists in
several places, the order is:

1. **Campaign settings** (in-game Text Model / image panels), which always win
2. **Admin panel** (`/admin`, stored in the database)
3. **Environment variables** (`.env.server`, see
   [configuration.md](configuration.md))
4. Built-in defaults

Secrets (API keys, `DB_ENCRYPTION_KEY`, Discord credentials) belong in `.env.server`
or the admin panel, never in code or `.env.local`.

## Admin panel

Log in as an admin and open `/admin` (linked from the account menu):

- **Guided setup**: the storyteller, pictures, voice, sign-ups and your own agent,
  one question at a time, with what runs on the computer found and filled in (see
  [Quick start](install.md#quick-start)).
- **Server settings**: default text model backend / URL / API key, ComfyUI and
  image-worker URLs and image model, TTS / STT URLs, Discord sign-in credentials, and
  the sign-up toggle (close registration once your party is in). The model pickers
  list what each backend serves ([text-backends.md](text-backends.md#choosing-a-model-the-catalog-and-discovery)).
- **Agent program**: Claude Code, Codex, opencode or Grok Build as the storyteller,
  with the models each program lists for its sign-in
  ([agent-harness.md](agent-harness.md)).
- **Player agents**: the HTTPS receiver addresses a player's own agent may be woken
  at, live as soon as they are saved ([player-webhooks.md](player-webhooks.md)).
- **Users**: list everyone, promote / demote admins, delete accounts, and reset
  passwords; a temporary password is shown once, and the user must set a new one at
  their next login.

## Discord sign-in (optional)

1. Create an application at <https://discord.com/developers/applications>.
2. Under OAuth2, add the redirect URI `<public-url>/api/auth/discord/callback` using
   the exact URL players reach the app on: `http://<lan-host>:3005/...` on a LAN, or
   `https://your.domain/...` behind a reverse proxy.
3. Put the Client ID and Client Secret in the admin panel (or `DISCORD_CLIENT_ID` /
   `DISCORD_CLIENT_SECRET` in `.env.server`).
4. Behind a reverse proxy: set the **Public URL** in the admin panel's Server section
   (or `APP_PUBLIC_URL` in `.env.server`) to the address players use, e.g.
   `https://your.domain`. A saved Public URL that is a private address this machine
   no longer holds (one a desktop app left behind, or one from a copied data folder)
   is skipped, and `APP_PUBLIC_URL` or the proxy's forwarded host is used instead.

The "Sign in with Discord" button appears automatically once both are set. Existing
users can link Discord to their account from Settings.
