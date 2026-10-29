"""Independent chronology examples for the native qualification oracle."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('activity_native', Path(__file__).with_name('activity-browser-native.py'))
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


def item(id, date=None, name='Same title', field='LastPlayedDate', others=None):
    return {'ItemId': id, 'Name': name, 'Users': {
        'owner': {field: date, 'Reasons': ['Watchlisted', 'Watched']}, **(others or {})}}


class NativeOrderTests(unittest.TestCase):
    def order(self, rows, sort='recent', statuses='watched'):
        return [i['ItemId'] for i in native.select(rows, statuses, '', sort)]

    def test_fractional_precision_and_whole_seconds(self):
        dates = ['2026-10-29T01:02:03Z', '2026-10-29T01:02:03.1Z',
                 '2026-10-29T01:02:03.11Z', '2026-10-29T01:02:03.1100001Z',
                 '2026-10-29T01:02:04Z']
        self.assertEqual(self.order([item(str(n), d) for n, d in enumerate(dates)]), ['4', '3', '2', '1', '0'])
        self.assertEqual(native.utc_ticks(dates[3]) - native.utc_ticks(dates[2]), 1)
        # The prior string oracle reverses .11Z/.1Z, even with valid native order.
        self.assertGreater(dates[1], dates[2])
        self.assertLess(native.utc_ticks(dates[1]), native.utc_ticks(dates[2]))

    def test_known_epoch_and_fraction_without_float_rounding(self):
        self.assertEqual(native.utc_ticks('0001-01-01T00:00:00Z'), 0)
        self.assertEqual(native.utc_ticks('1970-01-01T00:00:00.1234567Z'), 621355968001234567)
        self.assertEqual(native.utc_ticks('9999-12-31T23:59:59.9999999Z'), 3155378975999999999)

    def test_equivalent_offsets_and_precision_use_title_id_ties(self):
        dates = ['2026-10-29T00:00:00.1Z', '2026-10-29T01:30:00.1000000+01:30',
                 '2026-10-28T19:00:00.100-05:00']
        self.assertEqual(len({native.utc_ticks(d) for d in dates}), 1)
        self.assertEqual(self.order([item('3', dates[0], 'alpha'), item('2', dates[1], 'Alpha'),
                                    item('1', dates[2], 'Alpha')]), ['1', '2', '3'])

    def test_offsets_are_compared_as_instants_across_days(self):
        rows = [item('older', '2026-10-29T00:10:00+01:00'), item('newer', '2026-10-28T23:20:00Z')]
        self.assertEqual(self.order(rows), ['newer', 'older'])

    def test_null_missing_and_zero_dates(self):
        rows = [item('null', None), item('known', '0001-01-01T00:00:00Z'),
                {'ItemId': 'missing', 'Name': 'Same title', 'Users': {'owner': {'Reasons': ['Watched']}}}]
        self.assertIsNone(native.utc_ticks(None))
        self.assertEqual(self.order(rows), ['known', 'missing', 'null'])

    def test_multi_owner_max_for_playback_and_membership(self):
        for field, sort in [('LastPlayedDate', 'recent'), ('AddedAtUtc', 'added')]:
            with self.subTest(field=field):
                rows = [item('multi', '2026-10-29T00:00:00.1Z', field=field, others={
                    'second': {field: '2026-10-29T00:00:00.11Z', 'Reasons': ['Watchlisted', 'Watched']},
                    'unknown': {field: None, 'Reasons': ['Watchlisted', 'Watched']}}),
                        item('middle', '2026-10-29T00:00:00.105Z', field=field)]
                self.assertEqual(self.order(rows, sort), ['multi', 'middle'])

    def test_max_uses_only_status_matching_owners(self):
        rows = [item('older', '2026-10-29T00:00:00Z', others={
            'excluded': {'LastPlayedDate': '2026-10-30T00:00:00Z', 'Reasons': ['Watchlisted']}}),
                item('newer', '2026-10-29T01:00:00Z')]
        self.assertEqual(self.order(rows), ['newer', 'older'])
        self.assertEqual(self.order(rows, statuses='watched,watchlisted'), ['older', 'newer'])

    def test_title_sort_ignores_dates(self):
        self.assertEqual(self.order([item('b', '2026-10-30T00:00:00Z', 'Bravo'),
                                     item('a', None, 'Alpha')], 'title'), ['a', 'b'])

    def test_ambiguous_or_invalid_dates_fail_explicitly(self):
        for value in ['', '2026-10-29T00:00:00', '2026-10-29T00:00:00.12345678Z',
                      '2026-02-30T00:00:00Z', '2026-10-29T00:00:00+14:01',
                      '2026-10-29T00:00:00-01:60', '0001-01-01T00:00:00+01:00']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                native.utc_ticks(value)

    def test_native_order_passes_and_incorrect_order_fails_with_safe_evidence(self):
        rows = [item('newer', '2026-10-29T00:00:00.11Z'), item('older', '2026-10-29T00:00:00.1Z')]
        # Simulate unexpected fields; diagnostics must not blindly copy API rows.
        rows[0]['Continuation'] = 'secret-cursor'
        rows[0]['Users']['owner']['AccessToken'] = 'secret-token'
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            native.assert_global_order(rows, 'watched', '', 'recent', output, 'single-recent', 0, 'candidate', 'owner')
            with self.assertRaisesRegex(AssertionError, 'global ordering'):
                native.assert_global_order(rows[::-1], 'watched', '', 'recent', output, 'single-recent', 1, 'candidate', 'owner')
            report = json.loads((output / 'order-candidate-single-recent-1.json').read_text())
            self.assertEqual(report['actualOrder'], ['older', 'newer'])
            self.assertEqual(report['expectedOrder'], ['newer', 'older'])
            self.assertEqual(report['result'], 'FAIL')
            self.assertEqual(report['sample'], 1)
            self.assertEqual(report['rows'][0]['owners'][0]['LastPlayedDate']['raw'], rows[1]['Users']['owner']['LastPlayedDate'])
            self.assertGreater(report['rows'][1]['maxUtcTicks'], report['rows'][0]['maxUtcTicks'])
            self.assertNotIn('secret-', json.dumps(report))
