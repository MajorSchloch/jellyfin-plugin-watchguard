"""Same-version CI must still exercise native install and every revision exactly once."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('listing_fixture',ROOT/'tests/catalog-listing-fixture.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)

class ListingFixtureTests(unittest.TestCase):
    def test_published_and_unpublished_candidate_preserve_revision_history(self):
        published=json.loads((ROOT/'manifest.json').read_text())
        candidate=copy.deepcopy(published[0]['versions'][0])
        candidate['sourceUrl']='http://host.docker.internal:8080/candidate.zip'
        for already_published in [True,False]:
            source=copy.deepcopy(published)
            if not already_published: source[0]['versions'].pop(0)
            before=copy.deepcopy(source)
            actual=fixture.fixture_catalog(source,candidate)
            self.assertEqual(source,before)
            self.assertEqual(actual[0]['versions'][0],candidate)
            self.assertEqual(actual[0]['versions'][1:],published[0]['versions'][1:])
            self.assertEqual(len(actual[0]['versions']),len(published[0]['versions']))

    def test_invalid_public_history_is_not_hidden_by_replacement(self):
        source=json.loads((ROOT/'manifest.json').read_text())
        source[0]['versions'].append(copy.deepcopy(source[0]['versions'][0]))
        with self.assertRaises(ValueError):fixture.fixture_catalog(source,source[0]['versions'][0])
