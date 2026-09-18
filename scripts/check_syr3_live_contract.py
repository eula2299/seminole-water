"""Verify full official microbial archives; never writes to production storage.

Run from the repository root with warehouse requirements installed:
python -m scripts.check_syr3_live_contract --output verification/syr3-ec-fc.json
"""
from __future__ import annotations
import argparse
import collections
import csv
import datetime as dt
import functools
import hashlib
import io
import json
import os
import pathlib
import re
import shutil
import sqlite3
import tempfile
import zipfile

from national.catalog import download
from national.warehouse import PARSER_PROFILES, process_member

SOURCES = {
    'syr3_ec-fc-dr': 'https://www.epa.gov/sites/default/files/2016-12/syr3_ec-fc-dr.zip',
    'syr3_tc-dr-06-08': 'https://www.epa.gov/sites/default/files/2016-12/syr3_tc-dr-06-08.zip',
    'syr3_tc-dr-09-11': 'https://www.epa.gov/sites/default/files/2016-12/syr3_tc-dr-09-11.zip',
}
GUIDE = 'https://www.epa.gov/sites/default/files/2016-12/documents/user_guide_to_obtaining_and_using_syr3_data.pdf'


@functools.lru_cache(maxsize=20000)
def valid_date(value: str) -> bool:
    for fmt in ('%m/%d/%Y', '%m/%d/%Y %H:%M:%S', '%Y-%m-%d',
                '%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M:%S.%f'):
        try:
            return dt.datetime.strptime(value, fmt).date() <= dt.date.today()
        except ValueError:
            continue
    return False


def independent_count(path: pathlib.Path) -> dict:
    """Use Python's CSV/date readers, not the warehouse's SQL predicates."""
    raw = 0
    seen = set()
    expected = collections.Counter()
    with path.open(encoding='utf-8', newline='') as stream:
        reader = csv.DictReader(stream, delimiter='\t', quoting=csv.QUOTE_NONE)
        needed = {'PWSID', 'Analyte ID', 'Analyte Name', 'Sample Collection Date', 'Presence Indicator Code'}
        if not needed.issubset(reader.fieldnames or []):
            raise ValueError('Unexpected microbial source field contract')
        for row in reader:
            if None in row or any(value is None for value in row.values()):
                raise ValueError('Malformed source row')
            raw += 1
            fingerprint = hashlib.sha256(json.dumps(row, sort_keys=True, ensure_ascii=False).encode()).digest()
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            values = {key: value.strip() for key, value in row.items()}
            present = values['Presence Indicator Code']
            if (re.fullmatch('[A-Z0-9]{9}', values['PWSID'].upper())
                    and values['Analyte Name'] and valid_date(values['Sample Collection Date'])
                    and values['Analyte ID'] in ('3100', '3014', '3013') and present in ('P', 'A')):
                expected[present] += 1
    return {'raw_rows': raw, 'distinct_source_rows': len(seen),
            'expected_present': expected['P'], 'expected_absent': expected['A']}


def check(source: str) -> dict:
    output = {'source_id': source, 'source_url': SOURCES[source], 'guide_url': GUIDE,
              'parser_profile': PARSER_PROFILES['syr3'],
              'checked_at': dt.datetime.now(dt.timezone.utc).isoformat(),
              'commit': os.environ.get('GITHUB_SHA'), 'members': [],
              'check_scope': 'full downloaded archive, no row sampling',
              'production_storage_modified': False, 'household_safety_assessed': False}
    with tempfile.TemporaryDirectory(prefix='syr3-contract-') as td:
        root = pathlib.Path(td)
        archive = root / 'source.zip'
        output.update(download(SOURCES[source], archive, 150_000_000))
        with zipfile.ZipFile(archive) as zipped:
            members = [m for m in zipped.infolist() if not m.is_dir() and m.filename.lower().endswith('.txt')]
            if not members or len(members) > 12 or sum(m.file_size for m in members) > 3_000_000_000:
                raise ValueError('Unexpected archive size or member inventory')
            for number, member in enumerate(members):
                raw = root / 'member.raw'
                text = root / 'member.tsv'
                with zipped.open(member) as src, raw.open('wb') as dst:
                    shutil.copyfileobj(src, dst, 1_048_576)
                for encoding in ('utf-8-sig', 'cp1252'):
                    try:
                        with raw.open(encoding=encoding) as src, text.open('w', encoding='utf-8', newline='') as dst:
                            shutil.copyfileobj(src, dst, 1_048_576)
                        break
                    except UnicodeDecodeError:
                        if encoding == 'cp1252':
                            raise
                expected = independent_count(text)
                summary = root / f'summary-{number}.sqlite'
                parquet = root / f'part-{number}.parquet'
                parsed = process_member(str(text), parquet, summary, 'syr3', member.filename)
                with sqlite3.connect(summary) as db:
                    observed = db.execute('SELECT COALESCE(SUM(present_results),0), COALESCE(SUM(absent_results),0), COALESCE(SUM(detects),0), COALESCE(SUM(nondetects),0), COUNT(min_detect), COUNT(max_detect) FROM summaries WHERE result_kind=?', ('presence-absence',)).fetchone()
                assert parsed['raw_rows'] == expected['raw_rows'], 'Raw row count differs'
                assert parsed['distinct_source_rows'] == expected['distinct_source_rows'], 'Duplicate handling differs'
                assert observed[:2] == (expected['expected_present'], expected['expected_absent']), 'Independent presence/absence counts differ'
                assert observed[2:] == (0, 0, 0, 0), 'Qualitative results leaked into numeric statistics'
                output['members'].append({**expected, **parsed, 'verified_present': observed[0], 'verified_absent': observed[1], 'checks_passed': True})
                raw.unlink()
                text.unlink()
                parquet.unlink()
                summary.unlink()
        output['raw_rows'] = sum(m['raw_rows'] for m in output['members'])
        output['distinct_source_rows'] = sum(m['distinct_source_rows'] for m in output['members'])
        output['eligible_source_rows'] = sum(m['eligible_source_rows'] for m in output['members'])
        output['verified_qualitative_rows'] = sum(m['verified_present'] + m['verified_absent'] for m in output['members'])
        output['checks_passed'] = True
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', choices=tuple(SOURCES), default='syr3_ec-fc-dr')
    parser.add_argument('--output', required=True, type=pathlib.Path)
    args = parser.parse_args()
    report = check(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    print(json.dumps({key: value for key, value in report.items() if key != 'members'}, indent=2))


if __name__ == '__main__':
    main()
