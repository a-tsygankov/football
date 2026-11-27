# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

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

## Before pushing

- `pnpm -r typecheck`, `pnpm run typecheck:scripts` and `pnpm -r test:run`.
- `pnpm exec playwright test` when touching `e2e/`, `playwright.config.ts`,
  or the Playwright version.
- The version-bump gate (`scripts/check_version_bump.py`) must pass; the
  pre-commit hook in `.githooks/` bumps tier versions automatically.

## GitHub Actions

Pin every action to a full 40-character commit SHA with the version as a
trailing comment, e.g.
`uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`.
For annotated tags, pin the commit the tag dereferences to (`<tag>^{}`).
