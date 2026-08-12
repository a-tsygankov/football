#!/usr/bin/env python3
"""Auto-bump tier versions for STAGED changes. Runs as the pre-commit
hook (.githooks/pre-commit); safe to run by hand before committing:

    python3 scripts/bump_versions.py

Ported from the sibling `gigsy` repo, adapted to this monorepo.

For each tier (client, worker, shared — see version_rules.TIERS): if
the staged diff touches that tier and does NOT already change its
package.json version, bump the patch version, write the file, and
`git add` it so the bump rides along in the same commit.

Bumping the worker tier also rewrites WORKER_VERSION in
worker/wrangler.toml, because that — not package.json — is what a
deployed Worker reports from /api/version. check_version_bump.py
enforces the two staying equal, so the bumper has to maintain it or it
would trip our own CI gate.

The schema tier needs no bumping — a new numbered migration file is
its version (check_version_bump.py enforces that on PRs).

Note: the bump rewrites the tier's package.json from its STAGED
content, so any unstaged edits to that file get folded into the
commit. Keep package.json edits staged and this never surprises you.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from version_rules import (  # noqa: E402
    SCHEMA_DIR,
    TIERS,
    WRANGLER_TOML,
    bump_patch,
    highest_migration,
    wrangler_var,
)


def _git(repo: Path, *args: str) -> str:
    return subprocess.check_output(
        ["git", "-C", str(repo), *args], text=True, stderr=subprocess.PIPE
    )


def _staged_files(repo: Path) -> list[str]:
    out = _git(repo, "diff", "--cached", "--name-only")
    return [line.strip() for line in out.splitlines() if line.strip()]


def _show(repo: Path, spec: str) -> str | None:
    """`git show <spec>` — None when the object doesn't exist (e.g.
    the file is new in this commit)."""
    try:
        return _git(repo, "show", spec)
    except subprocess.CalledProcessError:
        return None


def _version_of(content: str | None) -> str | None:
    if content is None:
        return None
    try:
        return str(json.loads(content)["version"])
    except (KeyError, json.JSONDecodeError):
        return None


def _bump_package_json(content: str, new_version: str) -> str:
    """Rewrite only the top-level "version" value, preserving the
    file's formatting (a json.dumps round-trip would reformat it)."""
    replaced = re.sub(
        r'("version"\s*:\s*")[^"]+(")',
        rf"\g<1>{new_version}\g<2>",
        content,
        count=1,
    )
    if _version_of(replaced) != new_version:
        raise RuntimeError("failed to rewrite version field")
    return replaced


def _bump_wrangler_worker_version(content: str, new_version: str) -> str:
    """Rewrite WORKER_VERSION in wrangler.toml, preserving formatting."""
    replaced = re.sub(
        r'(^\s*WORKER_VERSION\s*=\s*")[^"]+(")',
        rf"\g<1>{new_version}\g<2>",
        content,
        count=1,
        flags=re.MULTILINE,
    )
    if wrangler_var(replaced, "WORKER_VERSION") != new_version:
        raise RuntimeError("failed to rewrite WORKER_VERSION")
    return replaced


def _bump_wrangler_schema_version(content: str, new_version: str) -> str:
    """Rewrite SCHEMA_VERSION in wrangler.toml, preserving formatting."""
    replaced = re.sub(
        r'(^\s*SCHEMA_VERSION\s*=\s*")[^"]+(")',
        rf"\g<1>{new_version}\g<2>",
        content,
        count=1,
        flags=re.MULTILINE,
    )
    if wrangler_var(replaced, "SCHEMA_VERSION") != new_version:
        raise RuntimeError("failed to rewrite SCHEMA_VERSION")
    return replaced


def _sync_schema_version(repo: Path, staged: list[str]) -> bool:
    """Point SCHEMA_VERSION at the highest migration when one is added.

    The schema tier has no package.json to bump — the numbered migration
    filename *is* the version. But wrangler.toml mirrors it as
    SCHEMA_VERSION so /api/version can report which schema the Worker
    expects, and check_version_bump.py fails the build when the two
    disagree. Setting it here means adding a migration doesn't also
    require remembering to hand-edit wrangler.toml.

    Returns True when wrangler.toml was rewritten, which makes the worker
    tier count as touched — correct, because the deployed Worker has to
    ship again before it reports the new schema version.
    """
    if not any(p.startswith(SCHEMA_DIR) and p.endswith(".sql") for p in staged):
        return False

    migrations_dir = repo / SCHEMA_DIR
    if not migrations_dir.is_dir():
        return False
    names = [f"{SCHEMA_DIR}{p.name}" for p in migrations_dir.iterdir()]
    highest = highest_migration(names)
    if highest is None:
        return False

    toml_path = repo / WRANGLER_TOML
    if not toml_path.exists():
        return False
    current = toml_path.read_text()
    if wrangler_var(current, "SCHEMA_VERSION") == str(highest):
        return False

    toml_path.write_text(
        _bump_wrangler_schema_version(current, str(highest)), encoding="utf-8"
    )
    _git(repo, "add", WRANGLER_TOML)
    return True


def run(repo: Path) -> list[str]:
    """Bump every tier the staged diff touches. Returns bumped tier
    names (empty when nothing needed)."""
    staged = _staged_files(repo)
    if not staged:
        return []

    bumped: list[str] = []

    # Do this first: it may stage wrangler.toml, which is worker-tier, so
    # the loop below then bumps the worker version too.
    if _sync_schema_version(repo, staged):
        bumped.append("schema")
        staged = _staged_files(repo)
    for tier in TIERS:
        if not any(tier.matches(p) for p in staged):
            continue

        staged_pkg = _show(repo, f":{tier.version_file}")
        head_pkg = _show(repo, f"HEAD:{tier.version_file}")
        staged_v = _version_of(staged_pkg)
        head_v = _version_of(head_pkg)
        if staged_v is None:
            # Version file missing/unparsable in the index — leave it
            # to the CI check to complain with full context.
            continue
        if head_v is None or staged_v != head_v:
            # New file, or already bumped in this commit — done.
            continue

        new_v = bump_patch(staged_v)
        # Rewrite from the staged content (not the worktree) so the
        # bump composes with whatever is actually being committed.
        assert staged_pkg is not None
        (repo / tier.version_file).write_text(
            _bump_package_json(staged_pkg, new_v), encoding="utf-8"
        )
        _git(repo, "add", tier.version_file)

        if tier.name == "worker":
            toml_path = repo / WRANGLER_TOML
            if toml_path.exists():
                staged_toml = _show(repo, f":{WRANGLER_TOML}") or toml_path.read_text()
                toml_path.write_text(
                    _bump_wrangler_worker_version(staged_toml, new_v),
                    encoding="utf-8",
                )
                _git(repo, "add", WRANGLER_TOML)

        bumped.append(tier.name)
    return bumped


def main() -> int:
    repo = Path(
        subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"], text=True
        ).strip()
    )
    for name in run(repo):
        print(f"[bump_versions] {name}: patch version bumped (staged)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
