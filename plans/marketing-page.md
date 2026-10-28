# Spraywall marketing page

## Context

Add a public, single-page marketing site for Spraywall that can deploy to Netlify, with a neobrutalist visual direction.

Initial findings:
- `README.md` describes an AI-assisted spray-wall route-setting and climbing app, distributed for self-hosting and as a mobile-first PWA.
- `web/package.json` uses React 19, TypeScript, and Vite 8; the app has its own backend and PWA behavior.
- `web/public/logo-256.png` is a usable multicolored climbing-wall app icon. Its yellow/cyan/green palette can anchor the marketing design. `icon.svg` is a very large traced illustration, so prefer a compact PNG for the page. The repository license is AGPL-3.0.
- Existing screenshots in `review-screenshots/bottom-nav/` show empty demo states (no wall photograph, routes, or logbook entries); do not present these as hero product imagery.
- `testdata/walls/README.md` documents two tracked real-wall HEIC photos. The user chose original illustrated imagery instead; do not use or modify these fixtures.
- `web/src/pages/Logbook.tsx` and `web/src/pages/RouteDetail.tsx` verify attempts/sends/flashes, notes, grades, and beta videos. No AI route-generation UI was found; describe AI-assisted hold detection, not automatic route generation.
- No existing Netlify configuration or marketing site was found. The repository remote is `https://github.com/shelldandy/spraywall`.

## Approach

Confirmed direction: create an independently deployable static site in `marketing/`, keeping the existing app, API, and PWA behavior unchanged. Target self-hosters (home-wall owners and gyms); the primary CTA leads to setup instructions, with GitHub as a secondary action. No hosted-app signup or waitlist.

Confirmed visual direction: **illustrated climbing poster**. Use oversized typography, chunky black outlines, offset shadows, high-contrast color blocks, and an original SVG climbing-wall/route illustration—not a fabricated screenshot. Palette: warm off-white and ink black, with the icon’s yellow and cyan plus a restrained pink accent. No real wall photos or empty-state screenshots.

### Implementation and deployment

Use semantic HTML and custom CSS, with no JavaScript, framework, package install, build pipeline, forms, analytics, or backend dependency. Use system fonts and local assets only; the page must remain complete with JavaScript disabled. Responsive CSS can keep the small navigation visible/wrapped without a hamburger menu.

A root `netlify.toml` will explicitly use the repository root as base, `marketing` as publish directory, and an empty build command. No SPA rewrite, API proxy, functions, or service worker. Only files inside `marketing/` are public—never the repository root or `.env`. Optional Netlify Dev configuration should use its static framework mode. This follows [Netlify’s file-based configuration documentation](https://docs.netlify.com/build/configure-builds/file-based-configuration/), which confirms publish paths are relative to the base directory and TOML overrides matching UI settings.

### Single-page narrative

1. **Header:** app icon/wordmark; anchors to Features, How it works, and Self-host; secondary GitHub link.
2. **Hero:** oversized headline such as “YOUR WALL. YOUR RULES.”, a concise explanation of AI-assisted hold detection and user-created climbs, and a primary **Self-host Spraywall** CTA linking to `https://github.com/shelldandy/spraywall#self-hosting`. Secondary **See how it works** links to the workflow section. Pair with a large original SVG wall: bolt-hole grid, asymmetric hold shapes, and a highlighted route. Include text labels/legend so color is not the only distinction. It is a static explanatory illustration, not an interactive product demo.
3. **Proof strip + workflow:** static “OPEN SOURCE / SELF-HOSTED / MOBILE-FIRST” band, followed by “Upload your wall → Detect and review holds → Set climbs and log sessions.” Do not imply that AI generates routes or that detection requires no review.
4. **Features:** four short, visually varied bordered panels covering AI hold detection; route setting with grades/tags; circuits and climb logs; and mobile PWA use. Explain that cached content supports offline browsing, while changes require a connection. Avoid invented testimonials, adoption counts, pricing, performance promises, and fully-offline claims.
5. **Self-host section:** contrasting dark panel explaining Docker Compose + prebuilt images, local CPU inference with optional NVIDIA GPU, and user-controlled hosting. Present a short setup overview (download compose/environment files, configure secrets, start services), with the README as the authoritative complete guide. Do not present `docker compose up -d` as sufficient without configuration.
6. **Footer:** repeat self-host CTA; GitHub, setup documentation, and AGPL-3.0 license links under `https://github.com/shelldandy/spraywall`.

### Visual and accessibility details

- Suggested tokens: paper #fff9ed, ink #171717, yellow #ffcf24, cyan #49dce8, pink #ff91b7. Use dark text on bright panels, 2–3px outlines, 5–8px hard shadows, small sticker-like rotations, and generous whitespace. Avoid gradients/glass, soft SaaS cards, and continuous animation.
- Desktop: asymmetric two-column hero and varied feature grid. Mobile: single-column reading order, scaled headline, fully visible CTAs and illustration, no off-screen rotated content.
- Semantic landmarks, one H1, logical headings, skip link, visible focus states, meaningful link labels, 44px minimum primary tap targets, and contrast verified to WCAG AA. Give informative SVGs a title/description and hide purely decorative marks from assistive technology.
- Prefer a static composition; any smooth scrolling or small hover transitions must respect `prefers-reduced-motion`.
- Include viewport, descriptive title/description, Open Graph title/description/type, theme color, and favicon. Do not invent a production domain or ship placeholder canonical/`og:url` values.

## Files to modify

| Path | Change |
| --- | --- |
| `marketing/index.html` | Entire semantic single-page content, anchors, metadata, and CTAs. |
| `marketing/styles.css` | Isolated neobrutalist tokens, typography, layout, interaction states, and responsive/reduced-motion rules. |
| `marketing/assets/wall-illustration.svg` | New original route/hold illustration; no fixture photos or fake app screenshot. |
| `marketing/assets/logo-256.png` | Copy existing `web/public/logo-256.png` for independent serving. |
| `marketing/assets/favicon.png` | Copy existing `web/public/favicon.png`. |
| `netlify.toml` | Root-level static publish configuration; no build dependencies or SPA fallback. |
| `scripts/check-marketing.py` | Small Python-standard-library validation script, kept outside the publish directory. |
| `.github/workflows/ci.yml` | Add independent marketing validation job using Python 3.12; preserve existing jobs. |
| `README.md` | Add static preview, validation, and Netlify deployment instructions; distinguish the marketing site from hosting the app itself. |

No changes to `web/`, backend services, Docker deployment, release configuration, original assets, or test fixtures.

## Reuse

- `README.md`: verified product claims and self-hosting documentation.
- `web/public/logo-256.png` and `web/public/favicon.png`: copy rather than redraw the existing brand or reference files outside the publish directory.
- `deploy/docker-compose.yml`: existing prebuilt-image deployment and configuration requirements; link to its documented setup rather than invent a new installer.
- `web/src/pages/WallDetail.tsx`: confirmed hold detection status, manually selecting start/hand/finish/foot holds, and wall-image reset management.
- `web/src/pages/RouteCreate.tsx`: confirmed naming, grades, descriptions, and style tags.
- `web/src/router.tsx`: confirmed routes, circuits, logbook, and profile screens.
- `web/src/index.css`: app accent cyan and dark-purple colors, useful for a truthful illustrative preview; do not import app styles or components into the marketing site.
- `web/vite.config.ts`: app-specific service worker and API proxies reinforce keeping the marketing site independent.

## Steps

- [x] Confirm page purpose, audience, and deployment separation: self-hosting CTA, separate `marketing/` site.
- [x] Inspect product flows and assets; confirm original illustrated-poster direction and documentation-based CTAs.
- [x] Create semantic page sections and accurate self-hosting/product copy in `marketing/index.html`.
- [x] Add the original SVG illustration, copied brand assets, and responsive neobrutalist CSS.
- [x] Add `netlify.toml` and README instructions for dependency-free preview, validation, and deploy.
- [x] Add a lightweight validation script and independent CI job.
- [x] Run validation and browser checks; inspect final diff for isolation from the app.
- [ ] After connecting a Netlify site, smoke-test a Deploy Preview; do not create accounts, change DNS, or publish to production without authorization.

## Verification

1. **Automated:** run `python3 scripts/check-marketing.py` (Python 3.11+). Parse HTML with `html.parser`, SVG with `xml.etree.ElementTree`, and Netlify config with `tomllib`. Check required metadata/landmarks and a single H1; unique IDs and valid local fragment targets; existence of every locally referenced asset (including SVG and CSS URL references); expected repository/setup/license CTA URLs; and that Netlify publishes only `marketing/` with no build command. Run this same command in the new Python 3.12 CI job; do not add Node/browser dependencies for a static-page check.
2. **Local end-to-end:** run `python3 -m http.server 4173 --directory marketing`, then open `http://localhost:4173`. Confirm the page, CSS, logo, favicon, and illustration load with no backend services or secrets. Check no missing requests and no external font/script requests.
3. **Responsive/visual:** inspect at 320, 390, 768, and 1440px widths plus 200% browser zoom. Check line wrapping, no horizontal overflow, readable feature panels, a fully visible illustration, and accessible CTAs. Capture desktop/mobile screenshots for visual review using available browser tooling.
4. **Accessibility/behavior:** keyboard-only traversal and skip link; visible focus; working anchor destinations; readable SVG description/legend; sufficient text contrast; reduced-motion preference; JavaScript disabled; all GitHub/setup/license links resolve to the intended destination. Automated structural checks complement rather than replace this review.
5. **Deploy readiness:** inspect `netlify.toml` and README together: import the repo into Netlify with no framework/build command and publish `marketing`; preview `/` and direct asset URLs. Real deployment verification is conditional on an authorized connected Netlify project, otherwise explicitly report it as not run. No fabricated domain-specific metadata.
6. **Regression boundary:** `git diff --check` and inspect changed paths. Existing `web/` routing, service worker, API, Docker, and release files remain untouched; no backend test runs are needed for this isolated static site.

## Execution results

- Static validation passes from both the repository root and another working directory. Eleven temporary mutation cases confirm rejection of missing assets, invalid fragments, duplicate IDs, external CSS imports, empty references, publish-root escapes, unsafe publish settings, and unexpected build commands.
- Chromium checks pass at 16 widths from 320–1920px without horizontal overflow. JavaScript-disabled loading, local-only asset requests, keyboard skip/focus, navigation anchors, primary tap targets, and reduced-motion behavior pass. Rendered text contrast samples are at least 6.49:1 (outlined text measured using its stroke).
- Checked 200% zoom-equivalent reflow using 720 CSS pixels at 2× device scale; no overflow. Desktop/mobile screenshots are in `/tmp/spraywall-marketing-review/` (temporary review artifacts, not published assets).
- Repository, self-hosting, and license links return HTTP 200. Original logo/favicon copies match byte-for-byte. `git diff --check` passes, and existing application/backend/deployment files are unchanged.
- **Netlify Deploy Preview not run:** no project-local Netlify connection, Netlify CLI, or configured MCP server is available. Step 8 remains pending until a project is connected and a preview is authorized. No account, DNS, or production deployment changes were made.
