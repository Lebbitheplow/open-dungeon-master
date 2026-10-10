# Wake a connected player agent

Player webhooks let a receiver on a player's computer wake their agent when
the table needs a decision. The server sends a small signed HTTP request.
The receiver checks the current table, then starts an agent turn through
that agent's own client API. A webhook or MCP notification alone cannot
wake an idle Codex desktop conversation, Claude chat or Grok chat.

This implementation includes a Codex app-server receiver. It owns a
separate persistent Codex thread on the player's computer. It does not
inject messages into an existing desktop chat. Other agents need their own
adapter using their client's supported API.

## Enable delivery on the server

1. Choose an HTTPS address for each player's receiver. The server must be
   able to reach it. A private Tailscale HTTPS address can work when both
   machines belong to the same network. Tunnel only the receiver's chosen
   path to its loopback port. Keep the ODM server on its existing address.
2. In the server environment, set `ODM_PLAYER_WEBHOOK_ORIGINS` to the exact
   receiver origins, separated by commas:

   ```dotenv
   ODM_PLAYER_WEBHOOK_ORIGINS=https://player-one.example,https://player-two.example
   ```

   An origin is the scheme, host and port, without a path or trailing slash.
   Approve only origins controlled by trusted receiver operators. Allowing
   an origin authorizes outgoing requests to that host, including a private
   network host. Receiver DNS and TLS are the operator's responsibility.
3. Restart the server. Without this setting, delivery is disabled, no
   receiver origin can be registered, and connected agents are not shown
   the webhook tools or the guard fields on the play tools. Removing an
   origin stops delivery to it, even for an existing subscription.

The server reconciles current player opportunities once a second. It puts
decisions in a SQLite outbox, independently of ephemeral event callbacks,
and delivers them in the background. This catches a parked roll restored
after a restart and a mutation whose live notification was missed. It is a
small server-side reconciliation loop, rather than a long-lived model
polling the campaign. Delivery is best effort within seconds under normal
load, not a real-time latency guarantee. Slow receivers can delay a pass.

## Set up the Codex receiver on the player's computer

Requirements: this repository, Node 22.18 or newer, Codex CLI 0.159.2 or newer,
a reachable HTTPS tunnel, and a player connection grant with
**read** and **play** scopes. Limit the grant to one campaign. Use a player
grant, not a storyteller turn token. You must have an active character at
that table.

1. Create a private directory outside the repository. Restrict it to your
   operating system account. On Windows, use a directory whose inherited
   permissions already exclude other users. On macOS/Linux, use mode 700.
2. Configure a local credential helper that returns JSON HTTP headers to
   its calling process. Keep the bearer token in the operating system
   credential store or an encrypted user account file. The helper's output
   must have an `Authorization` field containing the bearer header. Do not
   run the helper in a visible terminal, paste its output into chat or
   put a token in the receiver config. An existing Codex
   `http_headers_helper` can serve the same purpose.
3. In the private directory, save `receiver.json`. This Windows example
   points to a PowerShell helper that already holds an encrypted token:

   ```json
   {
     "mcpUrl": "https://odm.example/api/mcp",
     "campaignId": "campaign-id-from-odm",
     "characterId": "active-campaign-sheet-id-from-odm",
     "receiverUrl": "https://player-one.example/odm-player",
     "authCommand": [
       "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
       "-NoProfile",
       "-File",
       "C:\\private\\odm-mcp-auth-headers.ps1"
     ],
     "codexBinary": "C:\\tools\\codex.exe",
     "port": 8787,
     "playerInstructions": "Play only my assigned character, concisely and helpfully. Let the other players decide for themselves.",
     "effort": "medium"
   }
   ```

   `characterId` is the campaign sheet ID, not the library character ID.
   `authCommand` is an executable followed by its literal arguments. It is
   executed without a shell and is trusted local configuration. Use an
   executable path when your shell's PATH is incomplete. On macOS/Linux,
   replace this command with your own credential helper and use the path
   to your Codex binary. An optional `model` chooses a model available to
   your Codex sign-in; omitting it uses Codex's default in the receiver profile.
4. From the repository directory, sign in to the receiver's isolated Codex
   profile once. Complete the device sign-in in your browser, outside chat:

   ```powershell
   node scripts/player-webhook-receiver.mjs --login C:/private/receiver.json
   ```

   Codex manages its own sign-in under
   `player-webhook-state/codex-home`. The receiver never reads or copies
   authentication files from your normal Codex profile. Do not add other
   MCP servers, apps or plugins to this isolated profile.
5. Register the webhook:

   ```powershell
   node scripts/player-webhook-receiver.mjs --subscribe C:/private/receiver.json
   ```

   The script retrieves the bearer header through the helper, registers
   through MCP and saves the signing secret directly to
   `player-webhook-state/subscription.json`. It never prints either secret.
   The signing secret is different from the bearer token. The bearer token
   is never saved by the receiver.
6. Start the receiver and keep it running:

   ```powershell
   node scripts/player-webhook-receiver.mjs --listen C:/private/receiver.json
   ```

7. Point your HTTPS tunnel's `/odm-player` path at
   `http://127.0.0.1:8787/odm-player`. The receiver listens only on loopback.
   Keep the tunnel running too. Synchronize the computers' clocks, since
   signatures expire after five minutes.

The receiver disables Codex's shell, web, apps, image tools and subagents,
uses a read-only sandbox with command/file approvals refused, and configures
only this player connection in its isolated profile. Only read and guarded
play tools are enabled and preapproved on that server. Codex can merge
inline configuration with existing MCP settings, which is why this profile
must stay separate from your usual one. It starts or resumes its own thread and calls
`turn/start`, then waits for `turn/completed` before handling another
decision. These model turns use the player's Codex sign-in and plan.

Keep the private state directory. It holds the signing key, queued events,
completed decision IDs and Codex thread ID. The receiver saves a verified
event before returning HTTP 202. It ignores repeated opportunities, checks
current state before waking Codex, and tells the agent to re-read the table
before every write. A combat notification has an `act` or `finish` phase;
the latter permits ending the turn, not submitting another initial action.

## Pause and stop

Lobby, held floor, safety pause, narration in progress and another player's
turn suppress play opportunities. A pending roll wakes only the owner of
the subscribed active character. After a safety or floor pause, fresh
opportunity IDs let an unfinished decision resume. An open-floor narration
notification invites the agent to inspect the passage; it should speak
only when addressed or when the scene calls for party action.

To stop automatic play, stop the receiver with Ctrl+C. To stop deliveries
and delete the server subscription too:

```powershell
node scripts/player-webhook-receiver.mjs --unsubscribe C:/private/receiver.json
```

Then stop the tunnel. Revoking or expiring the player grant also removes
its subscriptions at the next server pass. Leaving the campaign or changing
the active character removes the subscription; create a new one to play
the new character. Disconnect the polling automation for that character
when enabling this receiver, so two agents do not drive it concurrently.

## If something fails

* **Registration fails:** check the exact allowed origin, current active
  sheet ID, campaign pin and read/play scopes. The receiver intentionally
  prints a generic failure instead of raw helper or server errors, which
  could contain credentials.
* **No agent turn starts:** keep both the receiver and HTTPS tunnel running.
  Call `odm_list_player_webhooks` on the player connection to inspect pending
  and failed counts. Confirm that the game is active and the character
  has an opportunity. Delivery stops after eight failures or after a queued
  decision becomes stale. A stale decision is never permission to act.
* **The receiver crashed:** stop any surviving receiver process first.
  Remove only `receiver.lock` from its private state directory if it remains
  after a crash, then restart. Keep `inbox.json` and `subscription.json`.
  The lock prevents two local receiver processes from driving one thread.
* **A turn has an uncertain outcome:** inspect the campaign and local inbox.
  A job recovered in `running` state, a failed agent turn or a lost reply
  is quarantined as `uncertain`. It is not replayed automatically because
  an action may already have landed. Do not delete the ledger to retry it.
  Resume play manually after verifying the table, or wait for a new decision.
* **A grant was revoked or a character switched:** remove any old local
  subscription record after confirming the old server subscription is gone,
  then register for the new grant/character. Keep the inbox history for review.

## Event and submission contract

Available MCP tools: `odm_subscribe_player_webhook`,
`odm_list_player_webhooks`, `odm_unsubscribe_player_webhook` and
`odm_get_player_webhook_opportunities`. They require read and play scopes
and operate only on the calling connection's subscriptions. Registration
returns the signing secret once. Listing never returns it. There are at
most five subscriptions per connection and one receiver per campaign character,
including across different connection grants.

Events use schema version 1, with `eventId`, `subscriptionId`, `campaignId`,
`playerId`, `characterId`, `opportunityId`, `type`, campaign `seq` and
`occurredAt`. Types are `turn_started`, `roll_requested`,
`response_requested`, `campaign_paused`, `campaign_resumed` and
`campaign_ended`. Roll requests add `pendingRollId`; combat requests add
`phase`. Events contain no narration, private notes, hidden enemy numbers,
dice results or bearer tokens. `seq` identifies the snapshot revision and
is not itself an opportunity ID.

Every POST carries `X-ODM-Event-Id`, `X-ODM-Timestamp` (Unix seconds) and
`X-ODM-Signature`. The signature is `v1=` followed by the hex HMAC-SHA256 of
`timestamp + "." + exactBody`, using the subscription's signing secret.
Verify against the raw body, use a constant-time comparison, reject clock
skew over five minutes and validate the configured subscription, campaign
and character. Persist and deduplicate by opportunity ID before returning
2xx. Return 5xx if the queue cannot be persisted. Never redirect deliveries.

The server uses a five-second request timeout, eight attempts, exponential
backoff capped at five minutes, a 30-second database lease and a 24-hour
queue expiry. Delivery is **at least once**, not exactly once. Decision
metadata and receipts remain until the subscription is deleted, preserving
deduplication across server restarts. The server stores each signing secret
because it must sign outgoing requests. Protect the database and backups;
use the existing database encryption option where supported.

The agent reads the table with `odm_get_campaign`, `odm_get_sheet` (the
table's copy of its character, not the library copy) and
`odm_get_messages`. Every tool result stays under the agent's result cap
as valid JSON. `odm_get_campaign` puts the safety pause, DM status, floor,
caps, pending rolls and encounter first, then the newest messages that
fit; `history.olderBefore` pages further back through `odm_get_messages`.

For an automatic play submission, send `subscriptionId` and the matching
current `opportunityId` with `odm_take_action`, `odm_answer_roll` or
`odm_end_turn`. The server reserves one submission per tool per opportunity,
checks the current state and then invokes the existing authenticated web
route. Identical retries return its saved result. A changed submission or
an unresolved receipt is refused. A refusal from the game itself (HTTP
4xx: not this character's turn, dice out of range) changes nothing at the
table, so it frees the opportunity for a corrected submission. A transport failure leaves an uncertain
receipt instead of trying again. The ordinary web-route permission and
rules checks still apply. Interactive callers may omit these guards.

This contract prevents duplicate guarded submissions; it cannot promise
exactly-once external effects across a process crash. After any ambiguous
result, inspect the table. Do not start a second unguarded automation for
the same character.

## Validation

`node scripts/test-player-webhooks.mjs` uses a temporary database, synthetic
players and a local HTTP receiver. It does not contact a real game, use a
real player token or spend a model turn. The Codex protocol tests simulate
app-server replies. Test a complete signed-in Codex session on a disposable
campaign before deploying automatic play. No live player session was
started while developing this feature.
