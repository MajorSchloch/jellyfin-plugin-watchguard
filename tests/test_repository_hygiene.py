"""Fast source-tree housekeeping regressions; no Docker or production access."""
import json
from pathlib import Path
import re
import unittest
import xml.etree.ElementTree as ET
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
CATALOG = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
CURRENT_VERSION = CATALOG[0]["versions"][0]["version"]
RELEASE_VERSION = CURRENT_VERSION.removesuffix(".0")
CURRENT_RELEASE_DOC = ROOT / "docs" / f"release-v{RELEASE_VERSION.replace('.', '')}.md"
BUILD_METADATA = ET.parse(ROOT / "Directory.Build.props")
BUILD_VERSION = BUILD_METADATA.findtext("./PropertyGroup/Version")
CANDIDATE_DOC = ROOT / "docs" / f"release-v{BUILD_VERSION.replace('.', '')}.md"
DOCS = [
    CANDIDATE_DOC,
    ROOT / "README.md",
    ROOT / "docs/README.md",
    CURRENT_RELEASE_DOC,
    ROOT / "docs/validation.md",
]


class RepositoryHygieneTests(unittest.TestCase):
    def test_current_release_metadata_matches_public_catalog(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        match = re.search(r"Current release:\s*\[v(\d+\.\d+\.\d+)\]", readme)
        self.assertIsNotNone(match, "README must state the latest published release")
        self.assertEqual(CURRENT_VERSION, match.group(1) + ".0")
        self.assertTrue(CURRENT_RELEASE_DOC.is_file(), "Current catalog release notes must exist")
        notes = CURRENT_RELEASE_DOC.read_text(encoding="utf-8")
        self.assertTrue(notes.startswith(f"# WatchGuard v{RELEASE_VERSION} —"))
        self.assertIn("**Published ", notes)
        for name in ["docs/README.md", "docs/validation.md"]:
            with self.subTest(document=name):
                source = (ROOT / name).read_text(encoding="utf-8")
                self.assertRegex(source, rf"Current published version:.*\[.*v{re.escape(RELEASE_VERSION)}\]")

    def test_candidate_metadata_and_notes_are_separate_from_published_release(self):
        for field in ["AssemblyVersion", "FileVersion"]:
            self.assertEqual(BUILD_METADATA.findtext("./PropertyGroup/" + field), BUILD_VERSION + ".0")
        self.assertTrue(CANDIDATE_DOC.is_file())
        notes = CANDIDATE_DOC.read_text(encoding="utf-8")
        self.assertTrue(notes.startswith(f"# WatchGuard v{BUILD_VERSION} —"))
        if BUILD_VERSION != RELEASE_VERSION:
            self.assertIn("**Unpublished release candidate.**", notes)
        for workflow in ["build.yaml", "release.yaml"]:
            source = (ROOT / ".github/workflows" / workflow).read_text(encoding="utf-8")
            self.assertIn(f"Jellyfin.Plugin.WatchGuard-v{BUILD_VERSION}.zip", source)
        source = (ROOT / ".github/workflows/release.yaml").read_text(encoding="utf-8")
        self.assertIn(f"--notes-file docs/{CANDIDATE_DOC.name}", source)

    def test_historical_template_artifacts_are_not_tracked(self):
        for name in [
            "Jellyfin.Plugin.Template.slnx",
            "Jellyfin.Plugin.Template.sln.DotSettings.user",
            "build.yaml",
            ".vscode/launch.json",
            ".vscode/settings.json",
        ]:
            with self.subTest(path=name):
                self.assertFalse((ROOT / name).exists(), "Obsolete template file returned")

    def test_workspace_tasks_never_copy_plugin_dll_to_live_jellyfin(self):
        tasks = json.loads((ROOT / ".vscode/tasks.json").read_text(encoding="utf-8"))["tasks"]
        self.assertEqual({t["label"] for t in tasks}, {"build", "test", "package"})
        for task in tasks:
            with self.subTest(task=task["label"]):
                self.assertNotIn(task["command"], {"cp", "copy", "scp", "rsync"})
                self.assertNotIn("copy-dll", json.dumps(task))

    def test_current_documentation_relative_links_exist(self):
        # Historical versioned research isn't linted: its links and original
        # snapshots are deliberately preserved, including pre-release language.
        pattern = re.compile(r"(?<!!)\[[^\]\n]+\]\(([^)\n]+)\)")
        for document in DOCS:
            source = document.read_text(encoding="utf-8")
            for match in pattern.finditer(source):
                target = match.group(1).strip().split(" ", 1)[0]
                if not target or target.startswith("#"):
                    continue
                split = urlsplit(target)
                if split.scheme or split.netloc:
                    continue
                relative = unquote(split.path)
                if not relative:
                    continue
                with self.subTest(document=str(document.relative_to(ROOT)), link=target):
                    resolved = (document.parent / relative).resolve()
                    self.assertTrue(resolved.is_relative_to(ROOT.resolve()))
                    self.assertTrue(resolved.is_file(), f"Broken local documentation link: {target}")


if __name__ == "__main__":
    unittest.main()
