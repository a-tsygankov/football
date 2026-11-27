# CLAUDE.md

The project's rules for every agent live in `AGENTS.md`; this file imports
them so Claude Code loads them automatically. Keep shared guidance there, and
only Claude-specific notes here.

@AGENTS.md

## Claude Code specifics

- **Read before you change.** Open the relevant section of
  `FC26_TeamPicker_Handoff.md` before touching a subsystem, and update it in
  the same PR when a decision changes (see *Commits, PRs and docs* above).
- **Dev servers:** `.claude/launch.json` defines `web` (Vite, 5173),
  `worker` (Wrangler, 8787) and `web-preview` (built client, 4173) for the
  preview harness; `deployment.local.md` §6 explains both that and the plain
  `pnpm` route.
- **Verify, don't assume.** Run the *Before pushing* checks and report their
  real output. When adding a guarantee, sabotage it once and say which test
  caught it.
- **Version bumps** come from the pre-commit hook; if a commit was made without
  it, run `pnpm version:bump` rather than editing versions by hand.
- **Commit attribution:** keep the `Co-Authored-By:` trailer the session asks
  for, after a body written in the project's style.
