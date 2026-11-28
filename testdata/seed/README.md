# Development seed fixture

All five accounts use the password `spraywall`:

- `admin@spraywall.test`
- `user2@spraywall.test`
- `user3@spraywall.test`
- `user4@spraywall.test`
- `user5@spraywall.test`

Run `make seed` to replace the current database and MinIO bucket contents with this fixture. With the dev stack running, `make snapshot` regenerates the sanitized fixture and first saves an unsanitized local backup under `.snapshots/` (gitignored).
