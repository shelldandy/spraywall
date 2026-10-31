# Repository audit

What this repo does: Spraywall lets climbers photograph a climbing wall, detect holds, create climbs, and record climbing activity. It uses a Go API, PostgreSQL, image storage, a Python detection worker, and a React web app. I assumed a small self-hosted instance with tens of users, concurrent setters, and one or a few workers.

**Checks:** Go race tests with PostgreSQL passed. All 33 worker tests, 38 web tests, lint checks, Go vet, the production web build, and marketing checks passed. Targeted checks confirmed the failures below. No source files changed during the audit.

## Must fix

1. **One invite can admit two accounts** (`server/internal/invite/handler.go:L149-197`, `server/db/queries/invites.sql:L12-13`)
   - **What this is:** An invite grants one account membership, possibly with admin rights.
   - **Problem:** Two requests can both read the unused invite before either marks it used. I reproduced one admin invite granting admin membership to two accounts.
   - **Fix:** Consume the unused, unexpired invite with a conditional update inside the membership transaction—one all-or-nothing database operation.
   - **If we skip it:** Single-use invitations can grant access more than once.

2. **Malformed route data can block a whole wall reset** (`server/internal/route/handler.go:L205-218,L452-463`, `server/internal/wall/reset.go:L669-674`)
   - **What this is:** Hold roles identify a climb’s starting, finishing, and foot holds.
   - **Problem:** The API accepts `"hold_roles":{"start":123}` without checking its shape. I confirmed that this stored value makes reset application fail with HTTP 500.
   - **Fix:** Validate role arrays and their hold IDs in both create and update requests. Repair existing malformed records.
   - **If we skip it:** Any gym member can save a climb that prevents setters from applying a partial reset.

3. **Logout leaves the server session usable** (`web/src/lib/queryClient.ts:L44-49`, `web/src/pages/Settings.tsx:L9-11`)
   - **What this is:** A refresh token keeps a device signed in after its short-lived access token expires.
   - **Problem:** Logout only clears browser storage. It never calls the existing `/auth/logout` endpoint, so a previously copied refresh token remains usable for its remaining lifetime.
   - **Fix:** On explicit logout, send the saved refresh token to `/auth/logout`. Clear browser state even if that request fails.
   - **If we skip it:** Logging out does not revoke the server-side session.

4. **Deleted wall photos remain publicly reachable** (`server/internal/wall/handler.go:L934-1017`)
   - **What this is:** Deleting a wall or gym removes its database records.
   - **Problem:** Neither deletion removes the stored photos, and `/images/*` serves storage objects without checking whether their records still exist. The old image URL continues working.
   - **Fix:** Collect image keys before deletion, remove their objects after the database commit, and reject image keys that are no longer referenced.
   - **If we skip it:** Deleted photos remain accessible, and abandoned files keep consuming storage.

5. **Two browser tabs can log each other out** (`web/src/lib/api/fetch.ts:L22-30`, `web/src/lib/api/refreshPolicy.ts:L50-53,L93-103`)
   - **What this is:** The frontend shares simultaneous refresh requests within one tab.
   - **Problem:** Separate tabs still refresh the same single-use token independently. I reproduced the losing tab receiving HTTP 401 and clearing the winning tab’s rotated token from shared browser storage.
   - **Fix:** Coordinate refreshes across tabs using a browser lock. Reload the latest stored tokens under that lock and synchronize token changes between tabs.
   - **If we skip it:** Normal multi-tab use causes unexpected sign-outs.

6. **Failed gym creation can leave an inaccessible gym** (`server/internal/wall/handler.go:L211-233`)
   - **What this is:** Creating a gym requires saving the gym and adding its creator as an admin.
   - **Problem:** Those writes commit separately. I forced the membership write to fail: the gym kept its address, but its creator received HTTP 403 when opening it.
   - **Fix:** Put both writes in one database transaction.
   - **If we skip it:** A failed request can leave a gym that its owner cannot access or recreate.

7. **The request limit can keep users blocked indefinitely** (`server/internal/middleware/ratelimit.go:L64-74`)
   - **What this is:** Authentication requests are limited per IP address.
   - **Problem:** Every request, including rejected ones, moves the reset time forward. After reaching the limit, retrying every 30 seconds prevents a one-minute window from ever resetting.
   - **Fix:** Measure the window from its start, not the latest request. Keep `/auth/me` outside the password-attempt allowance.
   - **If we skip it:** Users sharing gym Wi-Fi can remain blocked while normal background requests continue.

8. **Slow video downloads are cut off after 20 seconds** (`server/internal/route/immich.go:L38-41,L151-175`)
   - **What this is:** The server streams Immich videos to the browser.
   - **Problem:** The HTTP client’s 20-second timeout covers the entire download. I reproduced a response promising two bytes but stopping after one byte at the timeout.
   - **Fix:** Keep the short timeout for share lookup. For streaming, limit connection and response-header waits rather than total download time.
   - **If we skip it:** Larger videos or slower connections produce incomplete playback.

9. **The standard deployment cannot enable Immich as documented** (`deploy/docker-compose.yml:L67-72`)
   - **What this is:** The self-hosting compose file supplies settings to the server container.
   - **Problem:** It never forwards `IMMICH_ALLOWED_HOSTS`. Setting that variable as the README instructs still leaves Immich disabled; I confirmed this in the rendered compose configuration.
   - **Fix:** Forward the variable, matching the root compose file, and add it to `deploy/.env.example`.
   - **If we skip it:** Self-hosters cannot enable the feature by following the instructions.

10. **Route writes ignore the wall named in the request** (`server/internal/route/handler.go:L364-368,L519-523,L566-570`)
    - **What this is:** Update, delete, and publish requests include both a wall ID and a route ID.
    - **Problem:** These handlers check the route’s gym but ignore the requested wall. I successfully published, updated, and deleted a route through a nonexistent wall ID.
    - **Fix:** Compare the route’s wall ID with the parsed URL wall ID in all three handlers, as the read handler already does.
    - **If we skip it:** A request aimed at the wrong wall can still change or delete a climb.

## Should fix

11. **`make test` hides failing worker tests** (`Makefile:L32`)
    - **What this is:** This is the local command for running the test suites.
    - **Problem:** A failed pytest run falls through to “pytest not available” and returns success. I reproduced a failing test command producing exit code zero.
    - **Fix:** Run pytest directly, or separate the availability check from test execution so failures propagate.
    - **If we skip it:** Developers receive a false green result until CI catches the failure.

12. **The old wall editor contains unreachable controls** (`web/src/pages/WallDetail.tsx:L347,L533,L644-676`)
    - **What this is:** The page still contains the older confidence controls and “Create Route” button.
    - **Problem:** The earlier return and later conditions make these blocks impossible to display. I checked every combination of the three relevant mode flags.
    - **Fix:** Delete the two unreachable blocks, then remove their unused supporting state and handlers.
    - **If we skip it:** Developers maintain a second editing path that users cannot reach.

## Nice to have

13. **Remove the unused gym-list hook** (`web/src/lib/hooks/queries.ts:L24-33`)
    - **What this is:** `useGyms` fetches gyms without their walls.
    - **Problem:** A whole-tree search found no callers; the UI uses `useGymsWithWalls`.
    - **Fix:** Delete `useGyms` and its unused `Gym` type import.
    - **If we skip it:** An unused API path remains available to confuse future changes.

**Verdict:** Fix invite reuse and route-input validation first, then session revocation and photo deletion.

**Lean: -44 lines, -0 dependencies possible.** This counts only the unreachable controls and unused hook.

**Not checked:** Live browser/camera behavior, real model or GPU inference, Modal, production deployment, load benchmarks, dependency advisories, or every CSS/generated/asset file.
