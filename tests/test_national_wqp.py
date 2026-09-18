import csv
import io
import json
import pathlib
import sys
import tempfile
import unittest
import urllib.error
import zipfile
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).parents[1] / 'national'))
import wqp_backfill as wqp


def fixture(rows=1, **values):
    base = {key: '' for key in wqp.REQUIRED}
    base.update({'Org_Identifier': 'USGS-MN', 'Location_Identifier': 'USGS-05288705',
                 'Activity_ActivityIdentifier': '000123', 'Activity_StartDate': '2020-01-06',
                 'Result_Characteristic': 'Arsenic', 'Result_Measure': '<0.005',
                 'Result_MeasureUnit': 'mg/l', 'Result_ResultDetectionCondition': 'Not Detected',
                 'Result_MeasureQualifierCode': 'U', 'Activity_Media': 'Water',
                 'Location_Latitude': '44.5', 'Location_Longitude': '-93.5',
                 'Location_HorzCoordReferenceSystemDatum': 'NAD83'})
    base.update(values)
    output = io.StringIO(newline='')
    writer = csv.DictWriter(output, fieldnames=sorted(base))
    writer.writeheader()
    for _ in range(rows):
        writer.writerow(base)
    return output.getvalue().encode()


class WqpBackfillTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temporary.name)
        self.plan = wqp.make_plan(['MN'], '2020-01-01', '2020-01-31')
        self.calls = 0

    def tearDown(self):
        self.temporary.cleanup()

    def fetcher(self, data=None, count=None):
        data = fixture() if data is None else data
        def fetch(url, target, *args):
            self.calls += 1
            target.write_bytes(data)
            return {'url': url, 'retrieved_at': '2026-09-17T00:00:00Z',
                    'bytes': len(data), 'sha256': wqp.sha(target),
                    'http_headers': {} if count is None else {'total-result-count': str(count)}}
        return fetch

    def test_national_plan_includes_all_states_dc_and_five_territories(self):
        plan = wqp.make_plan(wqp.STATES, '2020-01-01', '2021-12-31')
        self.assertEqual(len(plan['partitions']), 112)
        self.assertEqual(len({p['state'] for p in plan['partitions']}), 56)
        self.assertIsNone(plan['record_count'])
        wqp.validate_plan(plan)

    def test_query_uses_current_wqx3_contract_and_water_filter(self):
        url = wqp.query_url(self.plan['partitions'][0])
        self.assertIn('/wqx3/Result/search?', url)
        self.assertIn('statecode=US%3A27', url)
        self.assertIn('dataProfile=fullPhysChem', url)
        self.assertIn('sampleMedia=Water', url)

    def test_nondetect_units_identifiers_and_datum_preserved(self):
        result = wqp.run(self.plan, self.root, fetcher=self.fetcher(count=1))
        self.assertEqual(result['actual_raw_result_rows'], 1)
        path = next((self.root / 'environmental').glob('*/part-*.jsonl'))
        row = json.loads(path.read_text())
        self.assertEqual(row['value_text'], '<0.005')
        self.assertEqual(row['detection_condition'], 'Not Detected')
        self.assertEqual(row['activity_id'], '000123')
        self.assertEqual(row['coordinate_datum'], 'NAD83')
        self.assertEqual(row['evidence_scope'], 'environmental-monitoring')
        self.assertFalse(row['household_sample_verified'])
        self.assertIsNone(row['pwsid'])
        self.assertIsNone(result['independent_samples'])
        wqp.verify_completed(self.root, self.plan['partitions'][0]['id'])

    def test_resume_skips_completed_partition_without_count_inflation(self):
        a = wqp.run(self.plan, self.root, fetcher=self.fetcher())
        b = wqp.run(self.plan, self.root, fetcher=self.fetcher())
        self.assertEqual(self.calls, 1)
        self.assertEqual(a['actual_raw_result_rows'], b['actual_raw_result_rows'])
        self.assertEqual(b['attempted_this_invocation'], [])

    def test_missing_checkpoint_commit_recovers_published_partition(self):
        import sqlite3
        wqp.run(self.plan, self.root, fetcher=self.fetcher())
        with sqlite3.connect(self.root / 'checkpoint.sqlite') as db:
            db.execute("UPDATE jobs SET status='processing',rows=0")
        result = wqp.run(self.plan, self.root, fetcher=self.fetcher())
        self.assertEqual(self.calls, 1)
        self.assertEqual(result['actual_raw_result_rows'], 1)

    def test_header_only_response_is_zero_results_not_a_measurement(self):
        result = wqp.run(self.plan, self.root, fetcher=self.fetcher(fixture(0), count=0))
        self.assertEqual(result['partition_status_counts'], {'complete': 1})
        self.assertEqual(result['actual_raw_result_rows'], 0)
        self.assertFalse(result['nationwide_household_coverage_complete'])

    def test_failed_count_check_does_not_publish(self):
        result = wqp.run(self.plan, self.root, fetcher=self.fetcher(count=2))
        self.assertEqual(result['partition_status_counts'], {'failed': 1})
        self.assertEqual(result['actual_raw_result_rows'], 0)
        self.assertEqual(list((self.root / 'environmental').iterdir()), [])

    def test_bad_dates_and_html_do_not_publish(self):
        for data in (fixture(Activity_StartDate='2019-01-01'), b'<html>Gateway failed</html>'):
            with tempfile.TemporaryDirectory() as output:
                result = wqp.run(self.plan, output, fetcher=self.fetcher(data))
                self.assertEqual(result['partition_status_counts'], {'failed': 1})

    def test_excessive_rows_split_nonoverlapping_dates_and_do_not_publish(self):
        result = wqp.run(self.plan, self.root, max_rows=1, fetcher=self.fetcher(fixture(2)))
        self.assertEqual(result['partition_status_counts'], {'pending': 2, 'split': 1})
        self.assertEqual(result['actual_raw_result_rows'], 0)
        children = wqp.split_partition(self.plan['partitions'][0])
        self.assertEqual(children[0]['start'], '2020-01-01')
        self.assertEqual(children[-1]['end'], '2020-01-31')
        self.assertEqual(children[0]['end'], '2020-01-16')
        self.assertEqual(children[1]['start'], '2020-01-17')

    def test_single_day_oversize_is_failed_and_visible(self):
        plan = wqp.make_plan(['MN'], '2020-01-06', '2020-01-06')
        result = wqp.run(plan, self.root, max_rows=1, fetcher=self.fetcher(fixture(2)))
        self.assertEqual(result['partition_status_counts'], {'failed': 1})

    def test_http_success_with_explicit_incomplete_footer_never_publishes_prefix(self):
        data = fixture() + (wqp.INCOMPLETE_FOOTER + '\n').encode()
        result = wqp.run(self.plan, self.root, fetcher=self.fetcher(data))
        self.assertEqual(result['partition_status_counts'], {'pending': 2, 'split': 1})
        self.assertEqual(result['actual_raw_result_rows'], 0)
        self.assertEqual(list((self.root / 'environmental').iterdir()), [])
        self.assertIn('explicitly marked', result['attempted_this_invocation'][0]['error'])

    def test_incomplete_footer_on_one_day_remains_failed_and_unrelated_bad_rows_are_rejected(self):
        for suffix in (wqp.INCOMPLETE_FOOTER, 'unexpected missing fields'):
            with self.subTest(suffix=suffix), tempfile.TemporaryDirectory() as output:
                plan = wqp.make_plan(['MN'], '2020-01-06', '2020-01-06')
                result = wqp.run(plan, output, fetcher=self.fetcher(fixture() + (suffix + '\n').encode()))
                self.assertEqual(result['partition_status_counts'], {'failed': 1})
                self.assertEqual(result['actual_raw_result_rows'], 0)

    def test_plan_identity_cannot_change_in_place(self):
        wqp.run(self.plan, self.root, fetcher=self.fetcher())
        other = wqp.make_plan(['FL'], '2020-01-01', '2020-01-31')
        with self.assertRaisesRegex(ValueError, 'different plan'):
            wqp.run(other, self.root, fetcher=self.fetcher())

    def test_changed_plan_checksums_and_duplicate_partitions_rejected(self):
        self.plan['partitions'][0]['state'] = 'FL'
        with self.assertRaisesRegex(ValueError, 'checksum'):
            wqp.validate_plan(self.plan)

    def test_realistic_zip_and_traversal_names_never_extract(self):
        binary = io.BytesIO()
        with zipfile.ZipFile(binary, 'w') as archive:
            archive.writestr('../../escape.csv', fixture())
        result = wqp.run(self.plan, self.root, fetcher=self.fetcher(binary.getvalue()))
        self.assertEqual(result['actual_raw_result_rows'], 1)
        self.assertFalse((self.root.parent / 'escape.csv').exists())

    def test_default_partition_bound_is_one(self):
        plan = wqp.make_plan(['MN', 'FL'], '2020-01-01', '2020-01-31')
        result = wqp.run(plan, self.root, fetcher=self.fetcher())
        self.assertEqual(len(result['attempted_this_invocation']), 1)
        self.assertFalse(result['all_planned_partitions_acquired'])

    def test_download_retries_transient_failure_and_stream_limits(self):
        class Response(io.BytesIO):
            headers = {'Content-Type': 'text/csv'}
        calls = []
        def opener(*args, **kwargs):
            calls.append(1)
            if len(calls) == 1:
                raise urllib.error.URLError('transient connection failure')
            return Response(fixture())
        target = self.root / 'download.bin'
        result = wqp.download(wqp.ENDPOINT, target, 100000, retries=1, opener=opener, sleeper=lambda _: None)
        self.assertEqual(result['attempts'], 2)
        with self.assertRaises(wqp.BudgetExceeded):
            wqp.download(wqp.ENDPOINT, target, 4, opener=opener)
        self.assertFalse(target.exists())

    def test_unofficial_redirects_rejected(self):
        handler = wqp.OfficialRedirect()
        with self.assertRaises(ValueError):
            handler.redirect_request(None, None, 302, '', {}, 'https://example.com/data')

    def test_exhausted_timeouts_split_instead_of_publishing_or_parking_large_query(self):
        target = self.root / 'partial.bin'
        for error in (TimeoutError('The read operation timed out'), urllib.error.URLError(TimeoutError('timed out')), urllib.error.HTTPError(wqp.ENDPOINT, 504, 'Gateway timeout', {}, None)):
            calls = []
            def opener(*args, **kwargs):
                calls.append(1); target.write_bytes(b'partial'); raise error
            with self.assertRaises(wqp.BudgetExceeded):
                wqp.download(wqp.ENDPOINT, target, 1000, retries=1, opener=opener, sleeper=lambda _: None)
            self.assertEqual(len(calls), 2)
            self.assertFalse(target.exists())
        def unavailable(*args, **kwargs):raise urllib.error.URLError('DNS lookup failed')
        with self.assertRaises(RuntimeError):
            wqp.download(wqp.ENDPOINT, target, 1000, retries=0, opener=unavailable)


if __name__ == '__main__':
    unittest.main()
