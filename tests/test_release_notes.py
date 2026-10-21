import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('release_notes', Path(__file__).parents[1] / 'scripts/check-release-notes.py')
notes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notes)


class PublicationCopyTests(unittest.TestCase):
    def test_public_copy_accepts_absolute_links(self):
        notes.validate('# WatchGuard v0.7.1 — Usability\n[Guide](https://example.org/guide)', '0.7.1')

    def test_preparation_instructions_cannot_be_published(self):
        for text in ['Unpublished release candidate', 'Do not merge, publish or deploy', 'Qualification is running']:
            with self.assertRaises(ValueError):
                notes.validate('# WatchGuard v0.7.1 — Usability\n' + text, '0.7.1')

    def test_relative_links_would_break_on_github_release(self):
        with self.assertRaises(ValueError):
            notes.validate('# WatchGuard v0.7.1 — Usability\n[Guide](guide.md)', '0.7.1')

    def test_wrong_version_is_rejected(self):
        with self.assertRaises(ValueError):
            notes.validate('# WatchGuard v0.7.0 — Previous', '0.7.1')
