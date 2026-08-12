#!/usr/bin/env python3
"""Unit tests for the version tooling (run in CI before the gate itself).

    python3 -m unittest discover -s scripts
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import bump_versions
from check_version_bump import highest_migration, package_json_version
from version_rules import SCHEMA_DIR, TIERS, bump_patch, is_doc_file, wrangler_var

TIER_BY_NAME = {t.name: t for t in TIERS}


def tiers_matching(path: str) -> set[str]:
    return {t.name for t in TIERS if t.matches(path)}


class TestTierClassification(unittest.TestCase):
    def test_client_paths(self) -> None:
        self.assertEqual(tiers_matching("apps/web/src/App.tsx"), {"client"})
        self.assertEqual(tiers_matching("apps/web/package.json"), {"client"})

    def test_worker_paths(self) -> None:
        self.assertEqual(tiers_matching("worker/src/routes/rooms.ts"), {"worker"})
        self.assertEqual(tiers_matching("worker/wrangler.toml"), {"worker"})

    def test_shared_paths(self) -> None:
        self.assertEqual(
            tiers_matching("packages/shared/src/types/events.ts"), {"shared"}
        )

    def test_migrations_are_schema_not_worker(self) -> None:
        # A pure migration change concerns the schema tier only — it must
        # not also demand a worker bump.
        self.assertEqual(tiers_matching(f"{SCHEMA_DIR}0007_thing.sql"), set())

    def test_unrelated_paths_match_nothing(self) -> None:
        self.assertEqual(tiers_matching("tools/squad-sync/src/index.ts"), set())
        self.assertEqual(tiers_matching(".github/workflows/deploy.yml"), set())


class TestDocExemptions(unittest.TestCase):
    def test_markdown_is_doc(self) -> None:
        self.assertTrue(is_doc_file("README.md"))
        self.assertTrue(is_doc_file("apps/web/NOTES.md"))
        self.assertTrue(is_doc_file("docs/anything.txt"))

    def test_handoff_and_docs_dir(self) -> None:
        self.assertTrue(is_doc_file("FC26_TeamPicker_Handoff.md"))
        self.assertTrue(is_doc_file("docs/adr/0001.md"))

    def test_code_is_not_doc(self) -> None:
        self.assertFalse(is_doc_file("apps/web/src/App.tsx"))

    def test_doc_inside_tier_does_not_trigger_bump(self) -> None:
        # Editing a markdown file under apps/web shouldn't demand a bump.
        self.assertEqual(tiers_matching("apps/web/README.md"), set())


class TestBumpPatch(unittest.TestCase):
    def test_semver(self) -> None:
        self.assertEqual(bump_patch("0.1.2"), "0.1.3")
        self.assertEqual(bump_patch("1.0.9"), "1.0.10")

    def test_non_semver_still_changes(self) -> None:
        self.assertEqual(bump_patch("weird"), "weird.1")


class TestPackageJsonVersion(unittest.TestCase):
    def test_reads_version(self) -> None:
        self.assertEqual(package_json_version('{"version": "1.2.3"}'), "1.2.3")

    def test_missing_and_malformed(self) -> None:
        self.assertIsNone(package_json_version('{"name": "x"}'))
        self.assertIsNone(package_json_version("not json"))


class TestWranglerVar(unittest.TestCase):
    TOML = """
[vars]
WORKER_VERSION = "0.1.1"
SCHEMA_VERSION = "6"
# COMMENTED = "nope"
"""

    def test_reads_values(self) -> None:
        self.assertEqual(wrangler_var(self.TOML, "WORKER_VERSION"), "0.1.1")
        self.assertEqual(wrangler_var(self.TOML, "SCHEMA_VERSION"), "6")

    def test_ignores_comments_and_missing(self) -> None:
        self.assertIsNone(wrangler_var(self.TOML, "COMMENTED"))
        self.assertIsNone(wrangler_var(self.TOML, "ABSENT"))


class TestHighestMigration(unittest.TestCase):
    def test_picks_max(self) -> None:
        paths = [
            f"{SCHEMA_DIR}0001_init.sql",
            f"{SCHEMA_DIR}0006_bets.sql",
            f"{SCHEMA_DIR}0002_live_games.sql",
        ]
        self.assertEqual(highest_migration(paths), 6)

    def test_ignores_non_migrations(self) -> None:
        self.assertIsNone(highest_migration(["worker/src/index.ts"]))


class TestRewriters(unittest.TestCase):
    def test_package_json_rewrite_preserves_formatting(self) -> None:
        original = '{\n  "name": "@fc26/web",\n  "version": "0.1.2",\n  "private": true\n}\n'
        out = bump_versions._bump_package_json(original, "0.1.3")
        self.assertIn('"version": "0.1.3"', out)
        # Everything else byte-identical — no json.dumps reformat.
        self.assertEqual(out, original.replace("0.1.2", "0.1.3"))

    def test_package_json_rewrite_only_touches_top_level_version(self) -> None:
        original = '{\n  "version": "0.1.2",\n  "deps": { "version": "9.9.9" }\n}\n'
        out = bump_versions._bump_package_json(original, "0.1.3")
        self.assertIn('"version": "0.1.3"', out)
        self.assertIn('"version": "9.9.9"', out)

    def test_wrangler_rewrite(self) -> None:
        original = 'WORKER_VERSION = "0.1.1"\nSCHEMA_VERSION = "6"\n'
        out = bump_versions._bump_wrangler_worker_version(original, "0.1.2")
        self.assertEqual(wrangler_var(out, "WORKER_VERSION"), "0.1.2")
        # Untouched neighbour.
        self.assertEqual(wrangler_var(out, "SCHEMA_VERSION"), "6")


class TestSchemaVersionSync(unittest.TestCase):
    """Adding a migration must move SCHEMA_VERSION with it.

    The CI gate fails when wrangler.toml's SCHEMA_VERSION disagrees with
    the highest migration, so without this the bumper would hand people a
    red build and a manual wrangler.toml edit every time they added one.
    """

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        self.env = {**os.environ, "GIT_CONFIG_GLOBAL": "/dev/null"}
        self._git("init", "-q", "-b", "main")
        self._git("config", "user.email", "t@example.com")
        self._git("config", "user.name", "Test")

        (self.repo / SCHEMA_DIR).mkdir(parents=True)
        (self.repo / SCHEMA_DIR / "0001_init.sql").write_text("SELECT 1;\n")
        (self.repo / "worker").mkdir(exist_ok=True)
        (self.repo / "worker" / "package.json").write_text(
            '{\n  "name": "@fc26/worker",\n  "version": "0.1.0"\n}\n'
        )
        (self.repo / "worker" / "wrangler.toml").write_text(
            '[vars]\nWORKER_VERSION = "0.1.0"\nSCHEMA_VERSION = "1"\n'
        )
        self._git("add", "-A")
        self._git("commit", "-qm", "init")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _git(self, *args: str) -> str:
        return subprocess.check_output(
            ["git", "-C", str(self.repo), *args], text=True, env=self.env
        )

    def _toml(self) -> str:
        return (self.repo / "worker" / "wrangler.toml").read_text()

    def test_new_migration_syncs_schema_version(self) -> None:
        (self.repo / SCHEMA_DIR / "0002_bets.sql").write_text("CREATE TABLE t(x);\n")
        self._git("add", "-A")

        bumped = bump_versions.run(self.repo)

        self.assertIn("schema", bumped)
        self.assertEqual(wrangler_var(self._toml(), "SCHEMA_VERSION"), "2")

    def test_migration_also_bumps_the_worker(self) -> None:
        # wrangler.toml is worker-tier, so touching SCHEMA_VERSION means
        # the Worker must ship again to report the new schema version.
        (self.repo / SCHEMA_DIR / "0002_bets.sql").write_text("CREATE TABLE t(x);\n")
        self._git("add", "-A")

        bumped = bump_versions.run(self.repo)

        self.assertIn("worker", bumped)
        self.assertEqual(wrangler_var(self._toml(), "WORKER_VERSION"), "0.1.1")
        self.assertEqual(
            package_json_version((self.repo / "worker" / "package.json").read_text()),
            "0.1.1",
        )

    def test_no_migration_leaves_schema_version_alone(self) -> None:
        (self.repo / "worker" / "src.ts").write_text("// code\n")
        self._git("add", "-A")

        bumped = bump_versions.run(self.repo)

        self.assertNotIn("schema", bumped)
        self.assertEqual(wrangler_var(self._toml(), "SCHEMA_VERSION"), "1")

    def test_is_idempotent(self) -> None:
        (self.repo / SCHEMA_DIR / "0002_bets.sql").write_text("CREATE TABLE t(x);\n")
        self._git("add", "-A")

        bump_versions.run(self.repo)
        worker_after_first = wrangler_var(self._toml(), "WORKER_VERSION")

        # Re-running must not double-bump: SCHEMA_VERSION already matches
        # and the staged worker version already differs from HEAD.
        self.assertEqual(bump_versions.run(self.repo), [])
        self.assertEqual(wrangler_var(self._toml(), "SCHEMA_VERSION"), "2")
        self.assertEqual(wrangler_var(self._toml(), "WORKER_VERSION"), worker_after_first)


class TestBumperAgainstRealRepo(unittest.TestCase):
    """Exercise run() end-to-end in a throwaway git repo."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        env = {**os.environ, "GIT_CONFIG_GLOBAL": "/dev/null"}
        self.env = env
        self._git("init", "-q", "-b", "main")
        self._git("config", "user.email", "t@example.com")
        self._git("config", "user.name", "Test")

        (self.repo / "apps" / "web" / "src").mkdir(parents=True)
        (self.repo / "apps" / "web" / "package.json").write_text(
            '{\n  "name": "@fc26/web",\n  "version": "0.1.2"\n}\n'
        )
        (self.repo / "apps" / "web" / "src" / "App.tsx").write_text("// v1\n")
        self._git("add", "-A")
        self._git("commit", "-qm", "init")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _git(self, *args: str) -> str:
        return subprocess.check_output(
            ["git", "-C", str(self.repo), *args], text=True, env=self.env
        )

    def _version(self) -> str | None:
        return package_json_version(
            (self.repo / "apps" / "web" / "package.json").read_text()
        )

    def test_bumps_touched_tier(self) -> None:
        (self.repo / "apps" / "web" / "src" / "App.tsx").write_text("// v2\n")
        self._git("add", "-A")

        self.assertEqual(bump_versions.run(self.repo), ["client"])
        self.assertEqual(self._version(), "0.1.3")
        # The bump is staged, so it rides along in this same commit.
        staged = self._git("diff", "--cached", "--name-only").split()
        self.assertIn("apps/web/package.json", staged)

    def test_is_idempotent_within_one_commit(self) -> None:
        (self.repo / "apps" / "web" / "src" / "App.tsx").write_text("// v2\n")
        self._git("add", "-A")

        bump_versions.run(self.repo)
        first = self._version()
        # Running again must not bump a second time — the staged version
        # already differs from HEAD.
        self.assertEqual(bump_versions.run(self.repo), [])
        self.assertEqual(self._version(), first)

    def test_untouched_tier_is_left_alone(self) -> None:
        (self.repo / "README.md").write_text("docs only\n")
        self._git("add", "-A")

        self.assertEqual(bump_versions.run(self.repo), [])
        self.assertEqual(self._version(), "0.1.2")


if __name__ == "__main__":
    unittest.main()
