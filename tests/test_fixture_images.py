import os
import unittest
from unittest.mock import patch
import fixture_images


class PinnedFixtureTests(unittest.TestCase):
    def test_three_supported_versions_are_immutable_and_distinct(self):
        selected = set()
        for version in ('12.2', '12.3', '12.4'):
            with patch.dict(os.environ, {'WATCHGUARD_JELLYFIN_VERSION': version}):
                for linuxserver in (False, True):
                    image = fixture_images.image(linuxserver)
                    self.assertRegex(image, r'@sha256:[0-9a-f]{64}$')
                    selected.add(image)
        self.assertEqual(len(selected), 6)

    def test_unknown_version_cannot_fall_back_to_another_fixture(self):
        for version in ('12.5', 'latest', '', '12.3.1'):
            with patch.dict(os.environ, {'WATCHGUARD_JELLYFIN_VERSION': version}):
                with self.assertRaises(ValueError):
                    fixture_images.image()
