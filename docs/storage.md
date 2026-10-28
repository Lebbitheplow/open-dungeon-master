# Storage and the single-writer rule

Back to the [README](../README.md). Backups and moving a world to another server: [backup-restore.md](backup-restore.md).

## The single-writer rule

All state lives in a local SQLite database at `data/local-roleplay.sqlite` (override
with `SQLITE_DB_PATH`), encrypted at rest with the `DB_ENCRYPTION_KEY` from
`.env.server`; losing the key means losing the data. The one exception is a world the
Android app hosts: Node's built-in SQLite there (`ODM_SQLITE_DRIVER=node`) has no
cipher, so that file is plain, kept in the app's private storage, and left out of
the phone's backups. The server logs a line saying so at start. The read-only Open5e content
pack (`data/content/open5e.sqlite`) stays unencrypted. The database driver is
synchronous and the app assumes **one Next.js process owns the database file**. Do
not run `npm run dev` and a production service against the same `data/` directory;
point dev at a scratch database with `SQLITE_DB_PATH`.

The single-process assumption goes beyond the database: the live event bus, the
GM turn queue, and the voice-chat rooms are all in-process state. Running two
instances behind a load balancer would split the table across processes, and a
restart ends any voice call in progress (players simply rejoin). One instance is
the supported shape.

### Changing the embedding model

Story recall and lore search compare new embeddings with the ones already stored,
and embeddings from two different models compare without an error but rank at
random. So the database records which model and dtype built its vectors, and you
can change `EMBEDDING_MODEL` or `EMBEDDING_DTYPE` at any time: set the new values and
restart the server.

At its next start the server sees the change before it serves anything, clears the
old vectors and re-embeds the whole story (lore, notes, house rules, facts, chapter
summaries and every scene) in the background, logging a line when it starts and when
it is done (a campaign with 600 scenes takes about 15 seconds on a desktop CPU).
Nothing else in the database is touched. Until a given entry is re-embedded, search
finds it by keyword only, so a table can keep playing meanwhile. Restoring a backup
made under another model is handled the same way.

`node scripts/backfill-embeddings.mjs` refuses to run against a database indexed with
another model; start the server once first.
