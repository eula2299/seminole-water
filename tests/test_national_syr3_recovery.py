"""Regression tests execute the parser and publication functions, not imitations."""
import copy
import csv
import json
import pathlib
import sqlite3
import tempfile
import unittest
from unittest import mock

import duckdb
from national import warehouse as w


def source_row(**changes):
    row = {
        'PWSID': 'FL1234567', 'System Name': 'Example system',
        'Analyte ID': '3014', 'Analyte Name': 'E. coli',
        'Sample Collection Date': '2010-02-03', 'Value': '', 'Unit': '',
        'Detect': '', 'Detection Limit Value': '', 'Detection Limit Unit': '',
        'Presence Indicator Code': 'P', 'Six Year ID': 'sample-1',
        'Sampling Point Type': 'DS', 'Source Type Code': 'FN',
    }
    row.update(changes)
    return row


def parse(rows, family='syr3'):
    columns = list(rows[0])
    con = duckdb.connect()
    try:
        con.execute('CREATE TABLE raw_input (' + ','.join(w.quote(c) + ' VARCHAR' for c in columns) + ')')
        con.executemany('INSERT INTO raw_input VALUES (' + ','.join('?' for _ in columns) + ')',
                        [tuple(row[c] for c in columns) for row in rows])
        result = con.execute(w.canonical_sql(columns, family))
        names = [column[0] for column in result.description]
        return [dict(zip(names, record)) for record in result.fetchall()]
    finally:
        con.close()


class MicrobialParserTests(unittest.TestCase):
    def test_all_documented_codes_and_both_presence_values(self):
        for code in ('3100', '3014', '3013'):
            for presence in ('P', 'A'):
                with self.subTest(code=code, presence=presence):
                    row = source_row(**{'Analyte ID': code, 'Presence Indicator Code': presence})
                    result = parse([row])[0]
                    self.assertTrue(result['summary_eligible'])
                    self.assertEqual(result['result_kind'], 'presence-absence')
                    self.assertEqual(result['result_unit'], 'presence/absence')
                    self.assertIsNone(result['detected_value'])
                    self.assertEqual(result['presence'], presence)
                    self.assertEqual(result['evidence_scope'], 'system-monitoring')
                    self.assertEqual(json.loads(result['original_record']), row)

    def test_invalid_metadata_does_not_become_qualitative_evidence(self):
        invalid = [
            {'Analyte ID': '9999'}, {'Presence Indicator Code': 'Q'},
            {'Presence Indicator Code': ''}, {'Presence Indicator Code': 'present'},
            {'PWSID': 'invalid'}, {'Sample Collection Date': '2099-01-01'},
            {'Sample Collection Date': '2010-02-30'},
            {'Sample Collection Date': '2010-02-03 garbage'}, {'Analyte Name': ''},
        ]
        for changes in invalid:
            with self.subTest(changes=changes):
                result = parse([source_row(**changes)])[0]
                self.assertFalse(result['summary_eligible'])
                self.assertIsNone(result['detected_value'])

    def test_presence_cannot_become_numeric_zero_or_concentration(self):
        for presence in ('P', 'A'):
            row = source_row(**{'Presence Indicator Code': presence, 'Value': '0',
                                'Unit': 'mg/L', 'Detect': '1'})
            result = parse([row])[0]
            self.assertTrue(result['summary_eligible'])
            self.assertEqual(result['result_kind'], 'presence-absence')
            self.assertIsNone(result['detected_value'])

    def test_existing_numeric_and_source_water_behavior(self):
        rows = [source_row(**{'Analyte ID': '1005', 'Analyte Name': 'Arsenic',
                             'Presence Indicator Code': '', 'Value': '4.2',
                             'Unit': 'ug/L', 'Detect': '1'}),
                source_row(**{'Presence Indicator Code': 'A', 'Source Type Code': 'RW'})]
        numeric, raw = parse(rows)
        self.assertTrue(numeric['summary_eligible'])
        self.assertEqual(numeric['result_kind'], 'numeric')
        self.assertEqual(numeric['detected_value'], 4.2)
        self.assertEqual(raw['evidence_scope'], 'source-water')

    def test_summary_statistics_and_exact_duplicate_retention(self):
        rows = [source_row(), source_row(**{'Presence Indicator Code': 'A', 'Six Year ID': 'sample-2'})]
        rows.append(dict(rows[0]))
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)
            source = root / 'input.tsv'
            with source.open('w', newline='') as stream:
                writer = csv.DictWriter(stream, fieldnames=list(rows[0]), delimiter='\t', lineterminator='\n')
                writer.writeheader()
                writer.writerows(rows)
            result = w.process_member(str(source), root / 'output.parquet', root / 'summary.sqlite', 'syr3', 'EColi.txt')
            self.assertEqual(result['raw_rows'], 3)
            self.assertEqual(result['distinct_source_rows'], 2)
            self.assertEqual(result['eligible_source_rows'], 2)
            self.assertEqual(result['parser_profile'], 'syr3-date-microbial-v3')
            with sqlite3.connect(root / 'summary.sqlite') as db:
                row = db.execute('SELECT n,detects,nondetects,min_detect,max_detect,present_results,absent_results,result_kind FROM summaries').fetchone()
            self.assertEqual(row, (2, 0, 0, None, None, 1, 1, 'presence-absence'))

    def test_syr4_qualitative_results_still_supported(self):
        self.assertEqual(w.PARSER_PROFILES['syr4'], 'syr4-quoted-microbial-v3')
        result = parse([source_row()], 'syr4')[0]
        self.assertTrue(result['summary_eligible'])
        self.assertIsNone(result['detected_value'])


def receipt(**changes):
    row = {'id': 'syr3_ec-fc-dr', 'family': 'syr3', 'schema': w.VERSION,
           'sha256': 'a' * 64, 'raw_rows': 12, 'distinct_source_rows': 10,
           'eligible_source_records': 8, 'stored_bytes': 100,
           'summary_key': 'summary.sqlite', 'summary_sha256': 'b' * 64,
           'count_state': 'not-downloaded', 'parser_profile': w.PARSER_PROFILES['syr3']}
    row.update(changes)
    return row


class PublicationStatusTests(unittest.TestCase):
    def setUp(self):
        self.state = copy.deepcopy(w.STATE)
        self.state['sources'] = {}
        self.state['errors'] = {}
        for name, value in (('STATE', self.state), ('ENVIRONMENTAL_ARCHIVE', None), ('WELL_ARCHIVE', None)):
            patcher = mock.patch.object(w, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_activated_receipt_is_published_without_mutating_original(self):
        original = receipt()
        snapshot = copy.deepcopy(original)
        store = mock.Mock()
        w.activate(store, original)
        store.get.assert_called_once()
        result = w.status()
        self.assertEqual(result['sources'][original['id']]['count_state'], 'published')
        self.assertTrue(result['sources'][original['id']]['parser_current'])
        self.assertEqual(result['eligible_source_records'], 8)
        self.assertEqual(original, snapshot)

    def test_previous_parser_stays_available_but_is_not_current(self):
        original = receipt(parser_profile='syr3-date-bound-v2')
        w.activate(mock.Mock(), original)
        result = w.status()['sources'][original['id']]
        self.assertEqual(result['count_state'], 'published')
        self.assertFalse(result['parser_current'])
        self.assertEqual(w.status()['eligible_source_records'], 8)

    def test_legacy_retained_records_are_not_qualified(self):
        original = receipt(schema='occurrence-warehouse/1')
        store = mock.Mock()
        w.activate(store, original)
        store.get.assert_not_called()
        result = w.status()
        self.assertEqual(result['sources'][original['id']]['count_state'], 'retained-raw-only')
        self.assertFalse(result['sources'][original['id']]['parser_current'])
        self.assertEqual(result['eligible_source_records'], 0)
        self.assertEqual(result['retained_source_records'], 10)

    def test_catalogue_discovery_cannot_inflate_import_counts(self):
        with self.assertRaises(ValueError):
            w.activate(mock.Mock(), {'id': 'ucmr1', 'family': 'ucmr', 'count_state': 'not-downloaded'})
        self.assertEqual(w.status()['published_archives'], 0)
        self.assertEqual(w.status()['retained_source_records'], 0)

    def test_failed_summary_download_preserves_previous_active_receipt(self):
        original = receipt()
        w.activate(mock.Mock(), original)
        snapshot = copy.deepcopy(self.state['sources'])
        store = mock.Mock()
        store.get.side_effect = ValueError('Object checksum mismatch')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            w.activate(store, receipt(sha256='c' * 64, distinct_source_rows=100))
        self.assertEqual(self.state['sources'], snapshot)
        self.assertEqual(w.status()['retained_source_records'], 10)

    def test_duplicate_archive_hashes_are_counted_once(self):
        w.activate(mock.Mock(), receipt())
        w.activate(mock.Mock(), receipt(id='same-source-alias'))
        self.assertEqual(w.status()['retained_source_records'], 10)
        self.assertEqual(w.status()['eligible_source_records'], 8)
        self.assertEqual(w.status()['published_archives'], 1)


if __name__ == '__main__':
    unittest.main()
