# Backup and restore

Open Dungeon Master keeps campaign state in an encrypted SQLite database and stores uploaded/generated media on disk. A useful backup therefore needs both the state tree and the database encryption key.

## Create a backup

Stop the app first, then run:

```bash
node scripts/odm-backup.mjs
# or choose a destination explicitly
node scripts/odm-backup.mjs /path/to/backups
```

The command checks the encrypted database, checkpoints its WAL, copies the persistent state into a staging directory, writes a small backup manifest, and creates a timestamped `tar.gz` archive. It prints the archive SHA-256 after creation.

The archive can contain `DB_ENCRYPTION_KEY` (from `.env.server`) or Docker's `data/.db-key`. Treat the archive as a secret. Losing both the key and every backup copy makes the encrypted campaign database unrecoverable.

The standard backup contains `data/`, uploaded/generated media, local model files, and `.env.server` when present. `SQLITE_DB_PATH` is supported when the database remains inside the ODM root; paths outside the root are rejected so the archive stays portable.

## Prove a restore before touching the live install

A restore is verified before it is copied to the requested target:

```bash
node scripts/odm-restore.mjs /path/to/odm-backup-....tar.gz /tmp/odm-restore-check
```

The restore command rejects absolute or parent-traversal archive paths, extracts into a temporary directory, reads the archived key, opens the encrypted SQLite database, runs `PRAGMA integrity_check`, and reports campaign/user/message counts. A dry-run restore does not modify the live installation.

Use an empty target directory for a dry run.

## Restore the live installation

Stop ODM, then run:

```bash
node scripts/odm-restore.mjs /path/to/odm-backup-....tar.gz --live
```

The command refuses a live restore while the application is listening on its configured `PORT` (3005 by default). It verifies the staged restore first and only then replaces the managed state paths from the archive.

After a live restore, start ODM normally and verify the campaign before deleting any older backup.
