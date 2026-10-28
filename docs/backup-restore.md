# Backup and restore

Open Game Master keeps campaign state in an encrypted SQLite database and stores uploaded/generated media on disk. A useful backup therefore needs both the state tree and the database encryption key.

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

Nothing live is deleted. The archive's files are first copied in beside the live ones, on the same disk (into a hidden `.odm-restore-incoming` folder inside each managed folder); if that copy fails, for instance on a full disk, the installation is exactly as it was. Then each live entry is renamed into a hidden `.odm-restore-previous` folder and the archive's renamed into place, and a failure part way puts every entry back. The managed folders themselves are never removed, so a restore also works where they are Docker volumes.

The state that was there before the restore stays in those `.odm-restore-previous` folders (and `.env.server.odm-restore-previous`) until the next restore replaces them, and backups leave them out. After a live restore, start ODM normally and verify the campaign before deleting them or any older backup.

## Upgrading and going back

Take a backup before upgrading (on Docker: before `docker compose pull`, or pin `ODM_IMAGE_TAG` and move it deliberately). The database records the schema revision of the newest server that opened it; when a release changes the schema in a way older code would misread, it raises that revision, and an older server then refuses to open the database instead of writing to it, with a message saying to update. Going back to an older version across such a change means restoring the backup taken before the upgrade together with the older version, not just reinstalling the older version.

## From the admin panel

The admin panel's Backups section takes the same archive while the server keeps playing: the database is snapshotted with `VACUUM INTO` in a separate process, files are copied and compressed off the request thread, and only one backup, verify or restore runs at a time. Downloaded models are left out unless **Include downloaded models** is switched on, since they download again on first use. A backup that would not fit is refused before anything is written, with the free space it found.

A live restore from the panel verifies the archive first and copies its files in beside the live ones while play goes on, after checking there is room. Only then does the server stop taking play: every API request answers 503, live streams close and the database is closed, so nothing is written to the replaced file, and the files are swapped in as described above. Restart the server to load the restored world.
