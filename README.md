# Spraywall

AI-assisted spray wall route setting and climbing app.

## Prerequisites

- Docker & Docker Compose
- Node.js ^20.19.0 or ≥ 22.12.0 (for the web app)
- Go ≥ 1.22 (optional, for local dev outside Docker)

## Self-Hosting

Prebuilt images are published to GHCR (`ghcr.io/shelldandy/spraywall-{server,worker,web}`), so all you need is a compose file:

```bash
mkdir spraywall && cd spraywall
curl -LO https://raw.githubusercontent.com/shelldandy/spraywall/main/deploy/docker-compose.yml
curl -L -o .env https://raw.githubusercontent.com/shelldandy/spraywall/main/deploy/.env.example

# Set POSTGRES_PASSWORD, MINIO_ROOT_PASSWORD and JWT_SECRET (e.g. `openssl rand -hex 32` each)
$EDITOR .env

docker compose up -d
```

The app is served on port 80 (`HTTP_PORT` to change). Migrations run and the storage bucket is created automatically on start.

- **Versions:** `latest` tracks the newest release, `edge` tracks `main`; pin a release with `SPRAYWALL_VERSION=1.2.3`.
- **NVIDIA GPU:** the default worker runs inference on CPU. Use the `-cuda` worker tag (e.g. `latest-cuda`) and uncomment the `deploy` block in the compose file.
- **Upgrading:** `docker compose pull && docker compose up -d`.

## Single sign-on (OIDC)

Spraywall can log users in through any OpenID Connect provider (Pocket-ID, Authelia, Authentik, Keycloak, ...). It is off unless `OIDC_ISSUER_URL` is set; the provider is configured via discovery (`<issuer>/.well-known/openid-configuration`). When enabled, the login page shows a "Sign in with `OIDC_PROVIDER_NAME`" button next to (or instead of) the password form.

| Variable                 | Default                       | Description                                                                                                    |
| ------------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `OIDC_ISSUER_URL`        |                               | Issuer URL, e.g. `https://id.example.com`. Enables OIDC                                                        |
| `OIDC_CLIENT_ID`         |                               | Client ID (required when enabled)                                                                              |
| `OIDC_CLIENT_SECRET`     |                               | Client secret (required when enabled)                                                                          |
| `OIDC_REDIRECT_URL`      |                               | Callback URL, `https://<your-host>/api/auth/oidc/callback` (required when enabled)                             |
| `OIDC_PROVIDER_NAME`     | `SSO`                         | Label for the login button                                                                                     |
| `OIDC_SCOPES`            | `openid email profile groups` | Requested scopes                                                                                               |
| `OIDC_GROUPS_CLAIM`      | `groups`                      | Claim holding the user's group names                                                                           |
| `OIDC_ADMIN_GROUP`       |                               | Members become instance admins (admin in every gym); non-members are demoted to climber on their next SSO login. If unset, roles are never touched |
| `OIDC_ADMIN_MAX_AGE`     | `24h`                         | With `OIDC_ADMIN_GROUP` set, admin rights lapse this long after the user's last SSO login (sessions and password logins don't renew them), so removing someone from the group takes effect within this window. Signing in with SSO again restores them |
| `PASSWORD_LOGIN_ENABLED` | `true`                        | `false` = SSO only (disables password login and registration). The server refuses to start unless OIDC is configured |

### Pocket-ID example

1. In the Pocket-ID admin UI, create an OIDC client. Set the callback URL to `https://<your-host>/api/auth/oidc/callback`.
2. Copy the client ID and secret into `.env`:
   ```bash
   OIDC_ISSUER_URL=https://id.example.com
   OIDC_CLIENT_ID=<client id>
   OIDC_CLIENT_SECRET=<client secret>
   OIDC_REDIRECT_URL=https://<your-host>/api/auth/oidc/callback
   OIDC_PROVIDER_NAME=Pocket-ID
   ```
3. To manage admins from Pocket-ID, create a group such as `spraywall-admins`, add users to it and set `OIDC_ADMIN_GROUP=spraywall-admins`. Pocket-ID includes the `groups` claim when the `groups` scope is requested (the default).
4. Optionally set `PASSWORD_LOGIN_ENABLED=false` to make SSO the only way in, then `docker compose up -d`.

### Notes

- Existing password accounts are linked automatically on first SSO login when the provider reports the email as verified. Because password sign-up never proves email ownership, linking this way removes the account's password, any previously linked identity, and all its sessions; the owner can set a new password from the Profile page. Accounts are only created or linked from verified emails (the provider must send `email_verified=true` in the ID token or UserInfo; Pocket-ID does), and emails match case-insensitively.
- Profile pictures are taken from the provider's `picture` claim unless the user has uploaded their own. They are only downloaded from the provider's own host or from public addresses.
- On the **Profile** page (Settings → Profile) users can change their display name and avatar, link or unlink the provider, and set or change a password. The last remaining login method cannot be removed.

## Releasing

Releases are cut by [Release Please](https://github.com/googleapis/release-please) from [Conventional Commits](https://www.conventionalcommits.org/) on `main`.

1. Squash-merge PRs with a conventional title: `fix: …` bumps the patch version, `feat: …` the minor, `feat!: …` a breaking change (minor while on 0.x). Other prefixes (`chore:`, `docs:`, …) don't trigger a release.
2. Release Please keeps a `chore(main): release X.Y.Z` PR open with the version bump and `CHANGELOG.md`.
3. Merging that PR tags `vX.Y.Z`, creates the GitHub release, and publishes images as `X.Y.Z`, `X.Y` and `latest` (worker also with `-cuda`).

## Development

```bash
# Clone and configure
git clone https://github.com/bowlinedandy/spraywall.git
cd spraywall
cp .env.example .env

# Start backend services (Postgres, MinIO, Go server, Python worker)
make dev

# In another terminal — start the web app (proxies /api, /images, and /beta-media to :8080)
make web
```

The app is a mobile-first PWA. Open it on your phone and use "Add to Home Screen" to install it.
It caches the app shell, wall images and recently viewed data for offline browsing; changes need a connection.

## Beta Videos

Climbers can add YouTube, Instagram, TikTok, and Immich video links to climbs. Immich links are resolved and streamed by the server, so Immich can remain accessible only on your LAN or tailnet. To enable Immich, set `IMMICH_ALLOWED_HOSTS` to a comma-separated list of exact hostnames (optionally including ports), without a scheme; for example `photos.example.net,immich.tailnet:2283`. The allow-list is required as an SSRF guard. Leave it empty to disable Immich links. YouTube, Instagram, and TikTok links work without this setting.

## Services (dev)

| Service  | URL                    |
| -------- | ---------------------- |
| Server   | http://localhost:8080   |
| Postgres | localhost:5433         |
| MinIO    | http://localhost:9000   |
| MinIO UI | http://localhost:9001   |
| Web app  | http://localhost:5173   |

## Useful Commands

| Command         | Description                                      |
| --------------- | ------------------------------------------------ |
| `make dev`      | Start all backend services (SAM enabled)         |
| `make web`      | Start the web app (Vite) dev server              |
| `make migrate`  | Run database migrations                          |
| `make sqlc`     | Generate Go code from SQL queries                |
| `make lint`     | Run Go, TypeScript, and Python linters           |
| `make test`     | Run Go and Python tests                          |
| `make clean`    | Stop services and remove volumes                 |

In production (`make prod`), nginx serves the built web app at `/` and proxies the API at `/api/`.

> **Note:** `docker compose down -v` (or `make clean`) is required to re-run `infra/postgres/init.sql`.

## SAM Segmentation

Hold detection uses YOLOv8 for bounding boxes. By default, [Segment Anything Model (SAM)](https://github.com/facebookresearch/segment-anything) refines each box into a polygon outline.

### Setup

Worker Docker images (including the published ones) install SAM and download the checkpoint at build time. For local (non-Docker) runs and the `make dev` bind mount, download a SAM checkpoint into the worker models directory:

```bash
wget -P worker/models https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth
```

For local (non-Docker) runs, also install the optional `sam` extra (`pip install '.[sam]'`). To opt out, set `SAM_ENABLED=false` or build the image with `INSTALL_SAM=false`; detection then returns YOLO bounding boxes without polygon segmentation. If SAM is enabled but the package or checkpoint is missing, the worker logs a warning and falls back to boxes.

### How it works

- SAM refines YOLOv8 bounding boxes into polygon masks
- OpenCV post-processing (erode/dilate/contour/simplify) cleans the masks
- Polygons are stored in the `holds.polygon` column and rendered as SVG polygons in the app
- Holds without polygon data fall back to rectangle rendering

### Environment variables

| Variable         | Default                              | Description              |
| ---------------- | ------------------------------------ | ------------------------ |
| `SAM_ENABLED`    | `true`                               | Enable SAM segmentation  |
| `SAM_MODEL_TYPE` | `vit_b`                              | SAM model variant        |
| `SAM_CHECKPOINT` | `./models/sam_vit_b_01ec64.pth`      | Path to checkpoint file  |

## Detection Backends

The worker polls for detection jobs and runs inference with one of two backends, chosen by `INFERENCE_BACKEND`:

- `local` (default): runs YOLOv8 in the worker process (CUDA if available, otherwise CPU). SAM is enabled by default; set `SAM_ENABLED=false` to skip it.
- `modal`: sends the image to a [Modal](https://modal.com) serverless GPU (T4, per-second billing, scales down after 30 seconds idle).
  At the reviewed $0.59/hour rate, the idle tail is about $0.005 per isolated request; active compute is billed separately.

### Modal setup

```bash
cd worker
pip install modal
modal token new
modal run modal_app.py::download_weights   # one-off: populate the models volume
modal deploy modal_app.py
modal run modal_app.py --image-path /path/to/wall.jpg   # smoke test
```

Then set these in `.env` and rebuild the worker:

| Variable             | Default | Description                                 |
| -------------------- | ------- | ------------------------------------------- |
| `INFERENCE_BACKEND`  | `local` | `local` or `modal`                          |
| `INSTALL_MODAL`      | `false` | Build arg: install the Modal client         |
| `MODAL_TOKEN_ID`     |         | Modal API token ID (from `modal token new`) |
| `MODAL_TOKEN_SECRET` |         | Modal API token secret                      |
