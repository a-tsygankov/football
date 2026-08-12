#!/usr/bin/env python3
"""CI gate: verify every tier touched by this PR bumped its version.

Ported from the sibling `gigsy` repo. Runs as the `version-check` GitHub
Actions job (see .github/workflows/version-check.yml). Local invocation:

    BASE_REF=main python3 scripts/check_version_bump.py

Tier definitions live in version_rules.py (shared with the pre-commit
auto-bumper, scripts/bump_versions.py — with the hook installed this
check should never fire; it's the backstop for commits made without
hooks, e.g. via the GitHub web UI).

  client   apps/web/package.json        `.version`
  worker   worker/package.json          `.version`
  shared   packages/shared/package.json `.version`
  schema   worker/src/db/migrations/    a NEW numbered .sql file is the bump

Two extra invariants beyond gigsy's, because this repo publishes versions
through wrangler.toml as well as package.json:

  * WORKER_VERSION must equal worker/package.json's version — it's what a
    deployed Worker reports from /api/version, so drift means the running
    worker lies about itself.
  * SCHEMA_VERSION must equal the highest numbered migration.

Pure-doc PRs (README, handoff, *.md, docs/) are exempt. Exits non-zero
if ANY touched tier skipped its bump, with `::error::` annotations the
GitHub UI surfaces in the file diff.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).parent))

from version_rules import (  # noqa: E402
    SCHEMA_DIR,
    TIERS,
    WRANGLER_TOML,
    bump_patch,
    is_doc_file,
    wrangler_var,
)

MIGRATION_RE = re.compile(r"(\d+)[^/]*\.sql$")


def package_json_version(content: str) -> Optional[str]:
    try:
        return str(json.loads(content)["version"])
    except (KeyError, json.JSONDecodeError):
        return None


def sh(cmd: list[str]) -> str:
    """Run `cmd`, return stdout. Raises on non-zero exit."""
    return subprocess.check_output(cmd, text=True, stderr=subprocess.PIPE)


def diff_files(base_ref: str) -> list[str]:
    """All paths touched in this PR vs. `base_ref`."""
    out = sh(["git", "diff", "--name-only", f"{base_ref}...HEAD"])
    return [line.strip() for line in out.splitlines() if line.strip()]


def added_files(base_ref: str) -> list[str]:
    """Subset of diff_files that's NEW (status A)."""
    out = sh([
        "git", "diff", "--name-only", "--diff-filter=A",
        f"{base_ref}...HEAD",
    ])
    return [line.strip() for line in out.splitlines() if line.strip()]


def show_at(path: str, ref: str) -> Optional[str]:
    """`git show ref:path` — returns None when the file doesn't exist
    at that ref (e.g. the version file was added in this PR)."""
    try:
        return sh(["git", "show", f"{ref}:{path}"])
    except subprocess.CalledProcessError:
        return None


def check_schema(touched: list[str], added: list[str]) -> Optional[str]:
    """Return an error message if the migrations dir was touched but no
    NEW migration file was added (schema "version" = highest numbered
    migration file)."""
    touched_migrations = [
        p for p in touched
        if p.startswith(SCHEMA_DIR) and not is_doc_file(p)
    ]
    if not touched_migrations:
        return None
    new_migrations = [
        p for p in added
        if p.startswith(SCHEMA_DIR) and p.endswith(".sql")
    ]
    if new_migrations:
        return None
    return (
        f"{SCHEMA_DIR} touched without a new migration .sql file. "
        "Schema changes need a new numbered migration; edit-in-place "
        "would skip Wrangler's d1_migrations tracker and fail to apply "
        "in production."
    )


def highest_migration(paths: list[str]) -> Optional[int]:
    """Largest leading number across migration filenames, or None."""
    numbers: list[int] = []
    for p in paths:
        if not p.startswith(SCHEMA_DIR) or not p.endswith(".sql"):
            continue
        match = MIGRATION_RE.search(p)
        if match:
            numbers.append(int(match.group(1)))
    return max(numbers) if numbers else None


def check_wrangler_sync(repo_root: Path) -> list[tuple[str, str]]:
    """WORKER_VERSION / SCHEMA_VERSION must track their real sources.

    Read from the working tree rather than git so this is also useful as
    a local pre-push sanity check.
    """
    errors: list[tuple[str, str]] = []
    toml_path = repo_root / WRANGLER_TOML
    pkg_path = repo_root / "worker" / "package.json"
    if not toml_path.exists() or not pkg_path.exists():
        return errors

    toml = toml_path.read_text()
    worker_version = package_json_version(pkg_path.read_text())
    declared = wrangler_var(toml, "WORKER_VERSION")
    if worker_version and declared and declared != worker_version:
        errors.append((
            "worker",
            f"{WRANGLER_TOML} WORKER_VERSION is {declared} but "
            f"worker/package.json is {worker_version}. A deployed Worker "
            f"reports WORKER_VERSION from /api/version, so these must match.",
        ))

    migrations_dir = repo_root / SCHEMA_DIR
    if migrations_dir.is_dir():
        names = [f"{SCHEMA_DIR}{p.name}" for p in migrations_dir.iterdir()]
        highest = highest_migration(names)
        declared_schema = wrangler_var(toml, "SCHEMA_VERSION")
        if highest is not None and declared_schema is not None:
            if declared_schema != str(highest):
                errors.append((
                    "schema",
                    f"{WRANGLER_TOML} SCHEMA_VERSION is {declared_schema} but "
                    f"the highest migration is {highest:04d}. Bump "
                    f"SCHEMA_VERSION to {highest}.",
                ))
    return errors


def main() -> int:
    base_ref = os.environ.get("BASE_REF", "origin/main")
    # Allow callers to pass `main` and we'll prepend `origin/`. In CI
    # we run with fetch-depth: 0 so origin/main is materialised.
    if "/" not in base_ref:
        base_ref = f"origin/{base_ref}"

    try:
        files = diff_files(base_ref)
    except subprocess.CalledProcessError as e:
        print(f"::error::git diff failed: {e.stderr}", file=sys.stderr)
        return 2

    errors: list[tuple[str, str]] = []
    repo_root = Path(__file__).resolve().parent.parent

    # The wrangler invariants hold regardless of what this PR touched —
    # a drifted WORKER_VERSION is wrong even on a docs-only branch.
    errors.extend(check_wrangler_sync(repo_root))

    if not files:
        print("No files changed — nothing to check.")
        return _report(errors)

    for tier in TIERS:
        touched = [p for p in files if tier.matches(p)]
        if not touched:
            continue

        head_content = show_at(tier.version_file, "HEAD")
        base_content = show_at(tier.version_file, base_ref)

        if head_content is None:
            errors.append((
                tier.name,
                f"{tier.version_file} not found at HEAD",
            ))
            continue
        if base_content is None:
            # Version file is new to this PR — that's a bump by
            # definition. Nothing to compare against.
            continue

        head_v = package_json_version(head_content)
        base_v = package_json_version(base_content)
        if head_v is None or base_v is None:
            errors.append((
                tier.name,
                f"could not parse version from {tier.version_file}",
            ))
            continue
        if head_v == base_v:
            sample = ", ".join(touched[:3])
            more = f" (+{len(touched) - 3} more)" if len(touched) > 3 else ""
            errors.append((
                tier.name,
                f"{tier.version_file} version unchanged ({head_v}). "
                f"This PR touches {len(touched)} file(s) in {tier.name} "
                f"({sample}{more}); bump the patch version (e.g. {head_v} → "
                f"{bump_patch(head_v)}), or install the auto-bump hook "
                f"(pnpm install sets core.hooksPath).",
            ))

    try:
        added = added_files(base_ref)
    except subprocess.CalledProcessError as e:
        print(f"::error::git diff --diff-filter=A failed: {e.stderr}",
              file=sys.stderr)
        return 2
    schema_err = check_schema(files, added)
    if schema_err:
        errors.append(("schema", schema_err))

    return _report(errors)


def _report(errors: list[tuple[str, str]]) -> int:
    if errors:
        for name, msg in errors:
            print(f"::error title=Missing version bump ({name})::{msg}",
                  file=sys.stderr)
        return 1
    print("All touched tiers bumped their version.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
