"""Fast source-tree housekeeping regressions; no Docker or production access."""
import json
from pathlib import Path
import re
import unittest
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
DOCS = [
    ROOT / "README.md",
    ROOT / "docs/README.md",
    ROOT / "docs/release-v0410.md",
    ROOT / "docs/validation.md",
]


class RepositoryHygieneTests(unittest.TestCase):
    def test_current_release_metadata_matches_public_catalog(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        match = re.search(r"Current release:\s*\[v(\d+\.\d+\.\d+)\]", readme)
        self.assertIsNotNone(match, "README must state the latest published release")
        catalog = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(catalog[0]["versions"][0]["version"], match.group(1) + ".0")
        self.assertIn("v" + match.group(1), (ROOT / "docs/release-v0410.md").read_text(encoding="utf-8"))

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
