# Filter routes by grade range

## Context
Route lists currently filter by route tags, but not grade. Add optional minimum/maximum grade controls so climbers can narrow the displayed routes.

## Approach
- Extend shared `RouteList` with optional inclusive V-grade bounds (VB through V17), combining them with the existing any-tag condition. Hide ungraded/unknown grades while either bound is set; show them without grade bounds. Use two labeled native selects with an “Any” option, disabled out-of-range options, and a clear-all-filters button in the no-results state. Keep `minGrade`/`maxGrade` in URL search params like tags and preserve unrelated keys on updates/navigation.
- Validate/canonicalize both bounds against the distinct V grades. Remove unknown/duplicate bound values; if a manually edited URL has Min > Max, drop Max. A valid Min-only or Max-only range is open-ended. Show the final combined result count in the tag picker, and make zero-results copy mention both grade and tag filters when relevant.
- Add a small pure grade-rank/range helper in `web/src/lib/grades.ts` using `uniqueVGrades()` to avoid string/lexical comparisons (`VB` precedes `V0`, then `V1` … `V17`). Test the helper with Node's built-in test runner (Node 24 already used by the web Docker build), without adding a dependency.

## Files to modify
- `web/src/pages/RouteList.tsx` — route filtering and controls.
- `web/src/pages/RouteList.module.css` — responsive toolbar styling and empty-state layout.
- `web/src/lib/grades.ts` — add small V-grade rank/range helper based on existing ordering.
- `web/tests/gradeFilter.test.mjs` (new), `web/package.json` — add dependency-free focused unit tests and test script. No API/server changes; parent route-list pages already share `RouteList` and pass query parameters through.

## Reuse
- `web/src/lib/grades.ts` — canonical V-grade ordering and lookup (`uniqueVGrades`, `gradeIdFromV`).
- `web/src/pages/RouteList.tsx` — current URL-backed tag filter and list.
- `web/src/components/GradePicker.tsx` — existing grade editing picker, but native selects are a better fit for two compact range bounds.
- `web/src/pages/Routes.tsx`, `web/src/pages/RouteDetail.tsx`, `web/src/pages/WallDetail.tsx` — all render `RouteList`; route-row links clone URL params and already preserve extra query keys. Back fallbacks clone URL params; `useGoBack` uses browser history if available.
- `web/src/lib/routeTags.ts` — existing client-side filtering convention and validation of URL tag values. `web/src/lib/api/types.ts` — nullable `Route.grade`.

## Steps
- [x] Set V-scale, inclusive bounds, ungraded behavior, and prevent inconsistent selections (user-confirmed).
- [x] Implement V-grade range comparison helper with tests (VB, V0, mid/high, open ends, ungraded/unknown).
- [x] Read/validate/canonicalize `minGrade` and `maxGrade` URL params in `RouteList`, preserving unrelated params; disable out-of-range choices.
- [x] Combine grade range with existing tag filter, update combined count and zero-results/clear controls; style for mobile and sidebar layouts.
- [ ] Manually smoke-test navigation, reload/deep links, both filters, and responsive layouts; automated tests/build/lint pass.

## Verification
- Run `npm test`, `npm run build`, `npm run lint` from `web/`. Manual smoke: all three route-list surfaces; min-only/max-only/equal/full bounds including VB/V0 and V9/V10; tagged + graded routes, ungraded routes, clear, zero results, direct/invalid URL reload, browser Back and links into/out of route detail. Existing frontend has no test runner, so use Node 24's built-in tests for pure grade logic.
