# Clubhouse preview playground

The [live playground](https://football-preview.atsyg-feedme.workers.dev/) uses Clubhouse Pro. Use the room name and fresh PIN supplied privately. Previously shared design links open Pro. The [player tile comparison](https://football-preview.atsyg-feedme.workers.dev/player-tiles) uses fictional local data to explore three roster patterns.

## Preview operation

Game creation uses side stripes (green Home, blue Away, neutral Reserve), a labeled mini availability toggle and a sliding three-segment side selector. Availability changes are staged for two seconds. A second tap cancels the pending change before it reaches the room API. The Roster view uses the same availability control. Keep the Outline and Shadow alternatives in the player card studio for future panel-wide styling decisions.

- Run `pnpm --filter @fc26/web build:clubhouse`. The output has its own entry point and does not register a service worker.
- Deploy the API from `worker` with `pnpm exec wrangler deploy --config wrangler.clubhouse.toml`. Apply migrations with `pnpm exec wrangler d1 migrations apply fc26-preview --remote --config wrangler.clubhouse.toml`. Provision the preview-only `SESSION_SECRET` as a Worker secret.
- From the same directory deploy the front door with `pnpm exec wrangler deploy --config ../workers/football-app/wrangler.clubhouse.toml`. The internal API uses the dedicated D1 and R2 resources. Squad administration is disabled. Score entry is manual when OCR credentials are absent.
- Run `pnpm exec playwright test --config playwright.clubhouse.ts` against the live preview. The tests create independent PIN-protected QA rooms. Use `CLUBHOUSE_BROWSER_CHANNEL=chrome` to use installed Chrome. Screenshots in `docs/clubhouse-images` contain synthetic test data.

## Room snapshot

The normal room API exposes a bounded match history. The snapshot takes its latest 20 completed results, roster ratings and the settled positions for those matches. Live games, unrelated books, older history and money transfers are excluded. The restore assigns player aliases and fresh IDs, replays the results chronologically in a new preview night and checks match count and per-player net chips. Times show the replay session. The totals describe this sample.

To refresh, run `python scripts/clubhouse_snapshot.py capture "<authorized room>" <private-new-baseline-file>` outside a shared terminal recording. Enter the source PIN at the prompt. To reset into a fresh preview room, run `python scripts/clubhouse_snapshot.py restore <baseline> "<unused preview room name>" <private-new-access-file>`. Keep both files outside the repository. Share the new access file privately after verification. A restore creates a separate room, preserving sessions in earlier rooms.

## Original design brief

## Isolation
- Create separate football-preview frontend and fc26-preview-worker API, binding only fc26-preview D1. Never configure production DB ID as fallback. Separate signing secret, room PINs, R2 write bucket, cookie origin and PWA scope. No production deployment workflow changes.
- Use an explicit preview banner and version/snapshot timestamp. Restrict access with Cloudflare Access or new room PINs and authenticated API routes; no public exports. Disable destructive squad sync/reset and external side effects by default. Read-only public squad assets can be reused if confirmed safe.
- Provision D1 with existing migrations. Export only after an authorized operator selects a source room. Work on an untracked private local copy; never commit data or logs. Inspect schema and foreign keys, select only the room's relational closure including events, games, nights, gamers, bets and projections. Scrub PIN hashes, sessions, attempts, secrets and unnecessary personal fields; replace names/avatars if appropriate. Preserve consistent IDs within the copy, event ordering and derived stats; verify foreign keys and compare scoreboard/ledger totals. Remove or explicitly resolve active games/bets before publishing a baseline. Import into preview only; validate target account and DB ID before every destructive operation. Keep baseline private for reset. Use independent test rooms if testers should not share state.
- Production credentials must not be requested in chat or written into repo. Operator uses existing authorized Wrangler/CI environment. No copy until selected room and access policy are established.

## Implementation
1. Add preview frontend entrypoint separate from production, with design selector in URL, shared state/API adapter, mobile/desktop layouts and persistent preview banner. Keep existing room auth and API types. Use the same feature behavior across designs, not independent authoritative settlement calculations.
2. Implement Game Night: restore room, select active gamers, manual/random assignment including supported multiplayer formats, remember previous sides, swap and quick start, optional clubs, result photo/manual confirmation, interrupt, next match. Existing API requires active game before analysis or result.
3. Implement Wager: open/locked states, virtual chips, participant eligibility, spectator multiple positions, top-up/remove, server settlement/refunds, ledger, individual/group recorded transfers, purchase and history; never treat estimated positions as authoritative. Do not introduce real-money payment functionality.
4. Club scoreboard, individual/team rows, history filters and drilldowns, roster, settings. Respect null scores and void events. Use existing shared rules and endpoints. Render pending/errors and reload live state after mutation; never cache live API data via service worker. Simulate photo recognition only in explicitly labeled demo mode; real preview OCR only with separately configured credentials and limits.
5. Build three designs using shared controller and adapters; validate actual library versions, bundle size, React 18 compatibility, keyboard/focus and mobile safe areas. Keep dependencies local to preview app if practical.
6. Deploy isolated preview front door with service binding to preview API only. Provide a verified URL and fresh PIN separately. Do not merge or deploy production as part of this work.

## Acceptance
- Playwright tests for create/join PIN, quick start/rematch, player swap, manual/random allocation, photo/manual result, interruption/void, wagers locked/refunded/settled, negative chips, ledger/history, multiple phones and style switch retaining room state.
- Verify snapshot consistency and source database unchanged. Verify production hostname, cookies, storage and service worker unaffected. Test iPhone/Android and desktop; record screenshots, tap counts and bundle sizes.
- Reset is an authenticated preview-only operation; test it restores baseline. No real data in public build assets. Share link only after deployment smoke test and access control checks.

## Operator handoff
Use an authorized local checkout or CI environment with Wrangler credentials. Read AGENTS.md and current migration/version rules. Inspect Cloudflare account bindings, provision separate resources, implement above, run tests, open PRs rather than direct main commits. Report exact deployed URL, test results, snapshot selection and remaining limitations. Do not copy arbitrary rooms or expose auth credentials.
