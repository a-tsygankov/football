#!/usr/bin/env python3
"""Single source of truth for tier/versioning rules.

Ported from the sibling `gigsy` repo so both projects share one mental
model, adapted to this monorepo's layout.

Consumed by:
  bump_versions.py       — pre-commit auto-bump (writes versions)
  check_version_bump.py  — CI gate (verifies versions)

Tiers and their version sources:
  client   apps/web/package.json        `.version`
  worker   worker/package.json          `.version`   (mirrored in wrangler.toml)
  shared   packages/shared/package.json `.version`
  schema   worker/src/db/migrations/    the numbered .sql filename IS the
                                        version — no file to bump, so it has
                                        no Tier entry here; both consumers
                                        special-case it via SCHEMA_DIR.

Unlike gigsy, the worker tier also publishes its version through
`worker/wrangler.toml` (`WORKER_VERSION`), which the /api/version route
serves to clients. That value is what the running Worker actually reports,
so it has to move in lockstep with worker/package.json or the deployed
worker misreports itself. `check_version_bump.py` enforces the match.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

# Doc-only files never trigger a version change.
DOC_SUFFIXES = (".md", ".txt")
DOC_PATHS = (
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    "DEVELOPMENT.md",
    "FC26_TeamPicker_Handoff.md",
    "deployment.local.md",
    "last_session.md",
    "phase-2.md",
    "docs/",
)

SCHEMA_DIR = "worker/src/db/migrations/"
WRANGLER_TOML = "worker/wrangler.toml"


def is_doc_file(path: str) -> bool:
    return path.endswith(DOC_SUFFIXES) or any(
        path == p or path.startswith(p) for p in DOC_PATHS
    )


def _in_client(p: str) -> bool:
    return p.startswith("apps/web/") and not is_doc_file(p)


def _in_worker(p: str) -> bool:
    # worker/src/db/migrations/ is the SCHEMA tier; the worker tier excludes
    # it so a pure-migration change only concerns schema.
    return p.startswith("worker/") and not p.startswith(SCHEMA_DIR) and not is_doc_file(p)


def _in_shared(p: str) -> bool:
    return p.startswith("packages/shared/") and not is_doc_file(p)


@dataclass(frozen=True)
class Tier:
    name: str
    version_file: str
    _matches: Callable[[str], bool] = field(repr=False)

    def matches(self, path: str) -> bool:
        # The tier's own package.json counts too (dependency edits are
        # real changes). No bump loop: the bumper skips tiers whose
        # staged version already differs from HEAD.
        return self._matches(path)


TIERS: list[Tier] = [
    Tier(name="client", version_file="apps/web/package.json", _matches=_in_client),
    Tier(name="worker", version_file="worker/package.json", _matches=_in_worker),
    Tier(name="shared", version_file="packages/shared/package.json", _matches=_in_shared),
]


def bump_patch(v: str) -> str:
    """Next patch version (M.m.p → M.m.p+1). Best-effort; if the
    version doesn't look like semver we append '.1' so callers still
    produce a changed value."""
    parts = v.split(".")
    if len(parts) == 3 and all(p.isdigit() for p in parts):
        return f"{parts[0]}.{parts[1]}.{int(parts[2]) + 1}"
    return f"{v}.1"


def wrangler_var(content: str, key: str) -> str | None:
    """Read a bare `KEY = "value"` out of wrangler.toml.

    Deliberately not a full TOML parse: tomllib is 3.11+ only and we want
    this to run on whatever Python the contributor happens to have. The
    vars we care about are simple quoted scalars in the [vars] table.
    """
    for raw in content.splitlines():
        line = raw.strip()
        if line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        if name.strip() != key:
            continue
        return value.strip().strip('"').strip("'")
    return None
