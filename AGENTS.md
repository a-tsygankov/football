# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository. It
summarises the project's own rules and points at where each one lives; when
this file and a source document disagree, the source document wins — fix this
file in the same PR.

## Where the truth lives

| Document | What it is |
|---|---|
| `FC26_TeamPicker_Handoff.md` | Architecture and design spec, and the running record of what shipped (**Recent Changes**) and what is unresolved (**§25 Open Items**). Read the relevant section before changing a subsystem. |
| `DEVELOPMENT.md` | Day-to-day commands and **§14 Project Conventions** ("non-negotiable"). |
| `deployment.local.md` | Local dev environment, ports, smoke tests — written for agents. |
| `docs/superpowers/specs/`, `docs/superpowers/plans/` | Design spec and implementation plan for larger features. |
| `docs/handoffs/` | Per-feature hand-off notes. |
| `.github/workflows/deploy.yml` | What CI actually runs and how deploys happen. |

Documents drift. When prose disagrees with the code, the workflows or
`wrangler.toml`, the code is what runs: trust it, and correct the document in
the same PR rather than working around it.

## Repository map

pnpm 9.15.0 workspace, Node ≥ 20 (CI uses 22), strict TypeScript.

| Path | Package | What |
|---|---|---|
| `apps/web/` | `@fc26/web` | Vite + React PWA, mobile-first (client tier) |
| `worker/` | `@fc26/worker` | Cloudflare Worker, Hono API, D1 + R2 (worker tier) |
| `worker/src/db/migrations/` | — | Numbered D1 migrations (schema tier) |
| `packages/shared/` | `@fc26/shared` | Types, selection strategies, ledger logic, logger (shared tier) |
| `workers/football-app/` | — | Static-assets Worker that serves the client |
| `tools/` | — | One-shot Node tools (squad sync) |
| `redirect-page/` | — | GitHub Pages redirect from the old origin |
| `e2e/` | — | Playwright specs against the real stack |
| `scripts/` | — | Versioning scripts, ledger health check |

Use `pnpm` only (never npm/yarn) and `--filter @fc26/<pkg>` for one package.

## Code rules (from handoff §22 and DEVELOPMENT §14)

- **Readability first.** Small functions, meaningful names, no magic numbers.
  KISS: no DI container, no effect libraries — plain constructor injection.
- **DRY carefully:** three repetitions before extracting.
- **Storage behind `IRepository` interfaces**, with in-memory implementations
  for tests.
- **Validate at the boundary with Zod**; trust types inside.
- **Determinism:** no `Math.random` or `Date.now` in business logic — inject
  `rng` and `Clock`/`now` from the composition root.
- **Logging** goes through the shared `ILogger`, never `console.*`. Every game
  fact, state transition, DB write and auth event is logged (handoff §17,
  *Mandatory log points*).
- **`game_events` is append-only.** No update or delete; corrections are new
  events (`game_voided` + a new `game_recorded`). New event payload fields
  must be additive and optional so `EVENT_SCHEMA_VERSION` can stay put.
- **The chip ledger is derived, never stored** (handoff §27). Don't add a
  balance column; fold it from the event log (`roomChipLedger`) and reuse that
  fold rather than reimplementing it (that drift has happened twice).
- **Visibility is not access control.** Room sessions carry no per-gamer
  identity; client-side filtering is a convenience, not a permission.

### Naming

- **`gamers`** are the humans in a friend group — never "players".
- **`fc_players`** are FC26 footballers; **`clubs`** are FC26 teams.
- **`gamer_team_key`** is the stable hash of sorted gamer IDs.

### Time

- Every `*_at` column is `INTEGER NOT NULL` UTC milliseconds — never ISO text.
- Mutable tables carry `created_at` and `updated_at`.
- The Worker never formats dates; clients use `Intl.DateTimeFormat`.

## Database migrations

- New file `worker/src/db/migrations/NNNN_description.sql` (next number),
  applied by `wrangler d1 migrations apply`. Data moves are written in SQL in
  the same file (see `0008_chip_purchases_backfill.sql`); nothing runs a `.ts`
  migration, whatever older docs say. End it with the `INSERT INTO
  schema_migrations` row the other migrations carry.
- **Additive only.** CI applies migrations to production *before* the Worker
  deploy, so new code must work against the new schema and old code must
  survive it.
- Bump `SCHEMA_VERSION` in `worker/wrangler.toml` to the new number (the
  version gate checks it equals the highest migration).
- Apply locally with `pnpm --filter @fc26/worker exec wrangler d1 migrations apply fc26 --local`.

## Versioning

Three independent axes — client, worker, schema (handoff §21). Every PR that
touches a tier must bump it:

- `.githooks/pre-commit` auto-bumps the patch version of each touched tier
  (`pnpm install` enables it via `core.hooksPath`). Don't hand-edit versions
  unless the hook is unavailable.
- `WORKER_VERSION` in `worker/wrangler.toml` must equal `worker/package.json`.
- Doc-only changes (`*.md`, `docs/`) and files outside the tiers (workflows,
  root `package.json`) need no bump.
- Check locally: `BASE_REF=origin/main python3 scripts/check_version_bump.py`.

## Testing

- **Unit tests (Vitest) live next to the source:** `foo.ts` + `foo.test.ts`.
  Every new module ships with tests in the same PR — never "tests later".
- **Coverage targets** (handoff §22): 80% for worker services and client game
  logic, **100%** for `packages/shared/src/selection/`. Presentational
  components are not tracked. No coverage provider is installed, so measuring
  needs `@vitest/coverage-v8` added first.
- **Selection strategies** must pass the parameterised contract tests and add
  their own behaviour tests.
- **End-to-end (Playwright, `e2e/`)** is the slow, thin tier for wiring the
  mocked suites cannot see. Seed over the API, click only the feature under
  test; give every test its own room name. See handoff §29, *Writing one*.
- **Sabotage every new guarantee:** break the behaviour, confirm a test fails,
  restore it. A test that cannot fail is not evidence. Say in the PR which
  tests you sabotaged.

### Before pushing

```sh
pnpm -r typecheck
pnpm run typecheck:scripts
pnpm -r test:run
pnpm exec playwright test   # when touching e2e/, playwright.config.ts, the
                            # Playwright version, or a wired-up user journey
BASE_REF=origin/main python3 scripts/check_version_bump.py
```

## Commits, PRs and docs

- **Commit subjects are plain-English imperative sentences**, sentence case,
  no `feat:`/`fix:`/`ci:` prefixes — e.g. *"Let a debt be paid in part from
  the row it is shown on"*. Say what changes for the user or the system.
- **Commit bodies explain why**: what was wrong, what the change does, what a
  test pins and what it deliberately does not cover. Wrap at ~72 columns.
- **One concern per PR.** The repository allows **squash merges only**
  (merge commits and rebase merges are turned off), so each PR lands on
  `main` as one commit whose subject is the PR title plus ` (#N)` and whose
  body is the PR description. Write PR titles like commit subjects
  (plain-English imperative, sentence case) and keep the description
  accurate, because both become permanent history. Older history on `main`
  still shows `Merge pull request #N: …` commits from before the change.
- **Comments explain why, not what**, and record the history that justifies an
  odd-looking choice (see the comments in `deploy.yml` and
  `playwright.config.ts`).
- **Keep the handoff current.** A structural decision changes the relevant
  section; shipped work gets a **Recent Changes** entry (with the resulting
  tier versions); anything left unresolved goes under **§25 Open Items**.
  Small implementation details belong in code comments instead.
- **Never commit secrets** or `.env*` / `.dev.vars` files. Local Worker
  secrets go in `worker/.dev.vars` (copy `worker/.dev.vars.example`).

## Stacked pull requests

When a change depends on another that is still in review, **stack** it rather
than folding both into one PR or waiting. GitHub supports stacks natively
([about](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs),
[quickstart](https://docs.github.com/en/pull-requests/get-started/stacked-prs-quickstart),
[CLI reference](https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands)):
the bottom PR targets `main`, each PR above targets the branch below it, and
GitHub tracks them as one stack.

### Rules

- **Each layer is one concern and stands on its own.** It must pass CI, the
  version gate and review by itself; "fixed in the next PR" is not allowed.
  Put the foundation at the bottom (for example docs, refactors or schema)
  and the code that depends on it above.
- **Merge bottom-up.** Merging a PR also merges everything below it, and the
  PRs above retarget automatically. Branch protection and required checks
  apply to every layer and cannot be bypassed.
- **Link the stack natively** (`gh stack init`/`submit`, or `gh stack link`
  for PRs that already exist). A PR whose base was simply edited to another
  branch is not a stack to GitHub. The workflows here trigger on
  `pull_request` to `main` only, and GitHub runs those checks for every layer
  of a *native* stack. A hand-retargeted PR gets no `ci`/`e2e`/version runs,
  so link it, and confirm the checks appear on every layer.
- **Version bumps are per layer.** The version gate diffs each PR against its
  own base (`github.base_ref`), so each layer bumps the tiers it touches
  relative to the layer below; the pre-commit hook does this. If a restack
  conflicts in a `package.json` version or `wrangler.toml`, keep the higher
  version and rerun the hook or `pnpm version:bump`.
- **Restack with the tool, not by hand.** `gh stack rebase` and `sync` rebase
  every layer in order and push with `--force-with-lease`. Never `git push
  --force`, and never rewrite a branch someone else owns. If force-pushing is
  not allowed in your environment, merge the lower branch into the upper one
  instead (a merge commit is acceptable on a stack branch).
- **Say where a PR sits** in its description, e.g. "Stacked on #58 — review
  that first," and keep that line accurate as the stack changes.

### With the `gh` CLI

Install once. The extension needs `gh` 2.0+ and **Git 2.36+** (it checks Git
and refuses older versions; GitHub's quickstart says 2.20, which is too low).
`gh skill`, used below for agents, only exists from `gh` **2.90.0**, so in
practice use 2.90.0 or later:

```sh
gh extension install github/gh-stack
gh extension upgrade stack           # later updates
```

Starting a new stack:

```sh
gh stack init -b main docs-foo           # bottom branch (creates or adopts)
# ...commit...
gh stack add ci-bar                      # next layer, checked out on top
# ...commit...
gh stack submit --auto                   # push all, open/update linked PRs
gh stack view                            # status of every layer
```

Turning PRs that already exist into a stack, bottom first (bases are corrected
to form the chain):

```sh
gh stack link 58 57
```

Keeping it current and landing it:

```sh
gh stack sync                  # fetch, fast-forward main, cascade rebase, push
gh stack rebase                # on conflict: resolve, git add, then
gh stack rebase --continue     #   (or --abort to restore every branch)
gh stack merge 57 --squash     # merges 57 and everything below it
```

Use `--squash`: it is the only merge method the repository allows, and
`--merge` or `--rebase` fail with "this repository does not allow … merges".

### For agents

- **Run the `gh stack` commands yourself.** Creating, linking, submitting,
  syncing and restacking a stack is the agent's job, not a hand-off: when a
  change should be stacked, the agent builds the branches, runs `gh stack
  init`/`add`/`submit` (or `gh stack link <bottom> <top>` for PRs that
  already exist), and checks the result.
- **Check a linked stack through the API.** `gh stack link` creates the
  stack on GitHub but writes no local tracking, so `gh stack view` then says
  the branch "is not part of a stack". Read the stack number from `link`'s
  output and confirm with `gh api repos/<owner>/<repo>/stacks/<n>` and
  `gh pr view <pr> --json baseRefName`; `gh stack view --json` works for
  stacks built locally with `init`/`add`.
- **Name the repo when `origin` is a fork.** In a clone where `origin` is a
  fork and `upstream` is `a-tsygankov/football`, pass full PR URLs (or `-R
  a-tsygankov/football` to plain `gh` commands) so nothing resolves against
  the fork, and track the PR branches from `upstream`.
- **Set it up first.** Check `gh --version` (2.90.0+), `git --version`
  (2.36+) and `gh auth status`, then `gh extension install github/gh-stack`
  and `gh skill install github/gh-stack`. Install the extension from GitHub;
  don't build it from source to get around a blocked download.
- **Stay non-interactive.** Use `gh stack submit --auto`, `gh stack view
  --json`, `gh stack checkout <pr> --print-path` and `gh stack sync
  --accept-base-change`. `gh stack switch` and `modify` need a TTY; avoid
  them.
- `rebase` and `sync` only touch clean worktrees, so commit or stash first.
  Stop on a conflict and resolve it, or `--abort`; never paper over it.
- **Confirm the checks.** After linking or submitting, make sure `ci`, `e2e`
  and the version check ran on every layer; a layer with no runs is not
  linked.
- **Merging stays the user's call**, exactly as for a single PR:
  `gh stack merge <top> --squash --yes` only when they have asked.
- **If `gh stack` cannot run** (no `gh`, a `gh` older than 2.90.0, no
  authentication, or a sandbox that blocks GitHub's API for the extension's
  download), don't silently fall back to retargeting PR bases by hand. Do the
  git-level part (branches, commits, the base of each PR), then stop and tell
  the user exactly which step failed and what would unblock it: an attached
  machine with `gh`, a permission rule, or running the one `gh stack link`
  command themselves.

## GitHub Actions

- Pin every action to a full 40-character commit SHA with the version as a
  trailing comment, e.g.
  `uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`.
  For annotated tags, pin the commit the tag dereferences to (`<tag>^{}`).
- Path filters in `deploy.yml` must include anything the jobs depend on;
  a PR touching only the e2e suite once skipped the job it was editing.
- Don't change job logic, triggers or deploy targets as a side effect of an
  unrelated change.

## Container images: prefer the AWS Public Gallery

Whenever an image is available there, pull it from the
[AWS ECR Public Gallery](https://gallery.ecr.aws/) (`public.ecr.aws/...`)
rather than Docker Hub. Docker Hub rate-limits anonymous pulls (`429 Too Many
Requests`), and that has already blocked local test runs here.

- Official Docker Hub images are mirrored under `public.ecr.aws/docker/library/`,
  e.g. `public.ecr.aws/docker/library/ubuntu:26.04`,
  `public.ecr.aws/docker/library/node:22`.
- Vendor-published images live under their own namespace, e.g.
  `public.ecr.aws/ubuntu/ubuntu:26.04`.
- This applies everywhere an image is named: `docker run`/`docker pull`,
  Dockerfiles (`FROM`), compose files, `act -P` platform mappings, and any
  `container:`/`services:` image in GitHub Actions workflows.
- Fall back to another registry (Docker Hub, `ghcr.io`, `mirror.gcr.io`) only
  when the image or tag is not published on the Gallery, and say so in the PR.

## Testing locally

- **Use a Docker container of the matching distribution** when a problem
  depends on the OS, e.g. the CI runner image. `ubuntu-latest` on GitHub is
  currently Ubuntu 26.04, so reproduce CI issues in
  `public.ecr.aws/docker/library/ubuntu:26.04`. This matters most on macOS,
  where a host run says nothing about Linux packages or browser builds.
- **Use [`act`](https://github.com/nektos/act) to simulate GitHub Actions**
  when you need to check a workflow change, mapping runners to Gallery images:

  ```sh
  act pull_request -n -P ubuntu-latest=public.ecr.aws/docker/library/ubuntu:26.04
  ```

  `-n` (dry run) checks that every job and step resolves. A bare Ubuntu image
  has no Node, so JavaScript actions only fully *run* in a runner-style image.
  If `act` cannot clone an action, use `--local-repository
  owner/repo@<sha>=<path>` with a local checkout of that commit.
- The e2e suite needs no Cloudflare credentials: it runs the Worker on
  Miniflare with a throwaway local D1 (see `playwright.config.ts`).
