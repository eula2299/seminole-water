#!/usr/bin/env python3
"""Restartable WQP WQX3 environmental backfill, separate from drinking-water evidence.

Create an explicit plan, then run bounded batches on a persistent volume. Completed
partitions are immutable and never counted twice when the same plan is resumed.
No observation here establishes a household's water quality or utility connection.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import fcntl
import hashlib
import json
import os
import pathlib
import shutil
import sqlite3
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

try:
    from .ingest import sha, streams
except ImportError:
    from ingest import sha, streams

ENDPOINT = 'https://www.waterqualitydata.us/wqx3/Result/search'
PROFILES = ('fullPhysChem', 'basicPhysChem', 'narrow')
PROVIDERS = ('STORET', 'NWIS')
STATES = dict(zip(
    'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI'.split(),
    '01 02 04 05 06 08 09 10 11 12 13 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 44 45 46 47 48 49 50 51 53 54 55 56 60 66 69 72 78'.split()))
SCHEMA = 'wqp-environmental-backfill/1'
PARSER_PROFILE = 'wqx3-explicit-incomplete-footer-v2'
# WQP can return HTTP 200 and a CSV prefix followed by this error instead of
# a complete download. The prefix must never be published as a complete result.
INCOMPLETE_FOOTER = ('ERROR: INCOMPLETE DATA - THE RESULTS FOR THIS REQUEST ARE NOT COMPLETE '
                     'AND MORE DATA IS LIKELY AVAILABLE.  PLEASE RETRY THE REQUEST.')
FIELDS = {
    'organization_id': 'Org_Identifier', 'site_id': 'Location_Identifier',
    'site_type': 'Location_Type', 'activity_id': 'Activity_ActivityIdentifier',
    'activity_type': 'Activity_TypeCode', 'measure_type': 'Result_MeasureType',
    'sample_date': 'Activity_StartDate', 'sample_time': 'Activity_StartTime',
    'sample_timezone': 'Activity_StartTimeZone', 'sample_media': 'Activity_Media',
    'characteristic': 'Result_Characteristic', 'cas_number': 'Result_CASNumber',
    'source_result_id': 'Result_MeasureIdentifier', 'value_text': 'Result_Measure',
    'unit_text': 'Result_MeasureUnit', 'qualifier': 'Result_MeasureQualifierCode',
    'detection_condition': 'Result_ResultDetectionCondition',
    'result_status': 'Result_MeasureStatusIdentifier', 'sample_fraction': 'Result_SampleFraction',
    'method_id': 'ResultAnalyticalMethod_Identifier', 'latitude_text': 'Location_Latitude',
    'longitude_text': 'Location_Longitude', 'coordinate_datum': 'Location_HorzCoordReferenceSystemDatum',
    'standardized_latitude_text': 'Location_LatitudeStandardized',
    'standardized_longitude_text': 'Location_LongitudeStandardized',
    'standardized_coordinate_datum': 'Location_HorzCoordStandardizedDatum',
    'detection_limit_type': 'DetectionLimit_TypeA',
    'detection_limit_value_text': 'DetectionLimit_MeasureA',
    'detection_limit_unit_text': 'DetectionLimit_MeasureUnitA',
}
REQUIRED = {'Org_Identifier', 'Location_Identifier', 'Activity_ActivityIdentifier', 'Activity_Media',
            'Activity_StartDate', 'Result_Characteristic', 'Result_Measure', 'Result_MeasureUnit'}


class BudgetExceeded(ValueError):
    """A partition must be subdivided; never publish a truncated response."""


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def save_json(path, value):
    path = pathlib.Path(path)
    temporary = path.with_name(path.name + '.tmp')
    with temporary.open('w', encoding='utf8') as handle:
        json.dump(value, handle, indent=2, ensure_ascii=False)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def partition(state, start, end, profile, site_id=None, provider=None):
    if state not in STATES or profile not in PROFILES or provider not in (None, *PROVIDERS):
        raise ValueError('Unsupported state, WQX3 profile, or provider.')
    lo, hi = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    if lo > hi or lo.year < 1800 or hi > dt.date.today():
        raise ValueError('Use a valid historic date range, from 1800 through today.')
    part = {'state': state, 'start': start, 'end': end, 'profile': profile}
    if site_id:
        if not isinstance(site_id, str) or not 1 <= len(site_id) <= 200:
            raise ValueError('Invalid monitoring location identifier.')
        part['site_id'] = site_id
    if provider:
        part['provider'] = provider
    part['id'] = digest(part)
    return part


def make_plan(states, start, end, profile='fullPhysChem', site_id=None):
    states = sorted(set(states))
    if not states or site_id and len(states) != 1:
        raise ValueError('A site-specific request requires exactly one state.')
    lo, hi = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    # Validate the entire interval even if the loop would otherwise be empty.
    partition(states[0], start, end, profile, site_id)
    partitions = []
    for year in range(lo.year, hi.year + 1):
        for state in states:
            partitions.append(partition(state, str(max(lo, dt.date(year, 1, 1))),
                                        str(min(hi, dt.date(year, 12, 31))), profile, site_id))
    body = {'schema_version': SCHEMA, 'endpoint': ENDPOINT,
            'source_schema': 'WQX3.0', 'sample_media': 'Water',
            'partitions': partitions}
    return {**body, 'plan_id': digest(body), 'created_at': now(),
            'record_count': None, 'coverage_complete': False,
            'limitations': [
                'Only source rows within the listed state and activity-date filters are requested.',
                'Records with missing or incorrect state/date metadata may not be returned.',
                'Result rows are not independent samples or household tap measurements.',
                'The source may revise historic records; use a new output root for a refreshed snapshot.',
                'Physical/chemical profiles do not include every biological or supplemental metadata profile.'
            ],
            'documentation': [
                'https://www.waterqualitydata.us/webservices_documentation/',
                'https://doi-usgs.github.io/dataRetrieval/reference/readWQPdata.html',
                'https://waterdata.usgs.gov/blog/wqx3/'
            ]}


def validate_plan(plan):
    if plan.get('schema_version') != SCHEMA or plan.get('endpoint') != ENDPOINT:
        raise ValueError('Unsupported plan schema or source endpoint.')
    expected = {key: plan[key] for key in ('schema_version', 'endpoint', 'source_schema', 'sample_media', 'partitions')}
    if plan.get('plan_id') != digest(expected) or plan['source_schema'] != 'WQX3.0' or plan['sample_media'] != 'Water':
        raise ValueError('Plan checksum or source contract is invalid.')
    seen = set()
    for part in plan['partitions']:
        check = partition(part['state'], part['start'], part['end'], part['profile'], part.get('site_id'), part.get('provider'))
        if part != check or part['id'] in seen:
            raise ValueError('Invalid or duplicate partition.')
        seen.add(part['id'])
    # Manual plan edits cannot create overlapping date intervals and inflate counts.
    groups = {}
    for part in plan['partitions']:
        key = (part['state'], part.get('site_id'), part.get('provider'))
        groups.setdefault(key, []).append((part['start'], part['end']))
    for ranges in groups.values():
        ranges.sort()
        if any(a[1] >= b[0] for a, b in zip(ranges, ranges[1:])):
            raise ValueError('Overlapping partition dates are not allowed.')


def query_url(part):
    params = [('statecode', 'US:' + STATES[part['state']]),
              ('startDateLo', dt.date.fromisoformat(part['start']).strftime('%m-%d-%Y')),
              ('startDateHi', dt.date.fromisoformat(part['end']).strftime('%m-%d-%Y')),
              ('sampleMedia', 'Water'), ('mimeType', 'csv'), ('zip', 'yes'),
              ('sorted', 'no'), ('dataProfile', part['profile'])]
    if part.get('site_id'):
        params.append(('siteid', part['site_id']))
    if part.get('provider'):
        params.append(('providers', part['provider']))
    return ENDPOINT + '?' + urllib.parse.urlencode(params)


class OfficialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urllib.parse.urlsplit(newurl)
        if (target.scheme != 'https' or target.hostname not in ('waterqualitydata.us', 'www.waterqualitydata.us')
                or target.username or target.password or target.port not in (None, 443)):
            raise ValueError('Refusing a redirect outside the official WQP HTTPS host.')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url, target, max_bytes, timeout=45, retries=3, opener=None, sleeper=time.sleep):
    """Bounded streaming transfer. A failed transfer never leaves a published blob."""
    opener = opener or urllib.request.build_opener(OfficialRedirect()).open
    last = None
    for attempt in range(retries + 1):
        try:
            started=time.monotonic()
            request = urllib.request.Request(url, headers={
                'Accept': 'application/zip,text/csv,text/plain', 'Accept-Encoding': 'identity',
                'User-Agent': 'IsMyWaterOK-WQP-Backfill/1.0 (+https://www.ismywaterok.com)'})
            with opener(request, timeout=timeout) as response:
                headers = {key.lower(): value for key, value in response.headers.items()}
                if headers.get('warning'):
                    raise ValueError('WQP returned a warning; response needs review: ' + headers['warning'])
                content_type = headers.get('content-type', '').lower()
                if not any(x in content_type for x in ('csv', 'zip', 'octet-stream', 'text/plain')):
                    raise ValueError('Source returned an unsupported content type: ' + content_type)
                if int(headers.get('content-length', '0')) > max_bytes:
                    raise BudgetExceeded('Response content-length exceeds the download budget.')
                received = 0
                with target.open('wb') as output:
                    while True:
                        if time.monotonic()-started>180:raise TimeoutError('WQP transfer exceeded the total time budget.')
                        block = response.read(min(1024 * 1024, max_bytes - received + 1))
                        if not block:
                            break
                        received += len(block)
                        if received > max_bytes:
                            raise BudgetExceeded('Streaming response exceeds the download budget.')
                        output.write(block)
                    output.flush()
                    os.fsync(output.fileno())
                if headers.get('content-length') and received != int(headers['content-length']):
                    raise OSError('Response ended before content-length bytes were received.')
                if received == 0:
                    raise ValueError('Empty response is not proof of zero matching records.')
                return {'url': url, 'retrieved_at': now(), 'bytes': received, 'sha256': sha(target),
                        'http_headers': headers, 'attempts': attempt + 1}
        except (urllib.error.URLError, OSError) as error:
            last = error
            target.unlink(missing_ok=True)
            if isinstance(error, urllib.error.HTTPError) and error.code not in (408, 429, 500, 502, 503, 504):
                raise
            if attempt < retries:
                sleeper(min(30, 2 ** attempt))
        except BaseException:
            target.unlink(missing_ok=True)
            raise
    reason = getattr(last, 'reason', last)
    if isinstance(reason, TimeoutError) or isinstance(last, urllib.error.HTTPError) and last.code in (408, 504):
        raise BudgetExceeded(f'WQP transfer time budget exceeded after {retries + 1} attempts; split the date interval.') from last
    raise RuntimeError(f'Source transfer failed after {retries + 1} attempts: {last}')


def normalize(raw_path, staging, part, source, max_decoded_bytes, max_rows, batch_rows=10000):
    """Preserve original qualifiers, units and coordinates; no inference or unit coercion."""
    if zipfile.is_zipfile(raw_path):
        with zipfile.ZipFile(raw_path) as archive:
            if sum(member.file_size for member in archive.infolist()) > max_decoded_bytes:
                raise BudgetExceeded('Archive exceeds decoded-byte budget; split the partition.')
    elif raw_path.stat().st_size > max_decoded_bytes:
        raise BudgetExceeded('CSV exceeds decoded-byte budget; split the partition.')
    count, decoded, parts, out = 0, 0, [], None
    try:
        for table, handle in streams(raw_path, max_decoded_bytes):
            reader = csv.DictReader(handle, strict=True)
            headers = reader.fieldnames
            if (not headers or len(set(headers)) != len(headers) or not all(headers)
                    or not REQUIRED.issubset(headers)):
                raise ValueError('Missing/duplicate WQX3 result columns; source contract changed or error body returned.')
            for line, raw in enumerate(reader, 2):
                if (raw.get(headers[0], '').strip() == INCOMPLETE_FOOTER
                        and all(raw.get(key) is None for key in headers[1:]) and None not in raw):
                    raise BudgetExceeded('WQP explicitly marked the response incomplete; split the date interval.')
                if None in raw or any(value is None for value in raw.values()):
                    raise ValueError(f'Malformed WQX3 CSV row {line}.')
                text = canonical(raw)
                decoded += len(text.encode())
                count += 1
                if count > max_rows or decoded > max_decoded_bytes:
                    raise BudgetExceeded('Decoded row/byte budget exceeded; split the partition.')
                date = raw['Activity_StartDate']
                try:dt.date.fromisoformat(date)
                except (ValueError,TypeError):raise ValueError('Result activity date is not a valid ISO calendar date.')
                if not date or not part['start'] <= date[:10] <= part['end']:
                    raise ValueError('Result activity date is outside the requested partition.')
                if not raw['Org_Identifier'] or not raw['Location_Identifier'] or not raw['Activity_ActivityIdentifier']:
                    raise ValueError('Result is missing required source identifiers.')
                if raw['Activity_Media'] != 'Water':
                    raise ValueError('Result sample medium does not match the requested Water filter.')
                if out is None or (count - 1) % batch_rows == 0:
                    if out:
                        out.close()
                    filename = f'part-{len(parts):08d}.jsonl'
                    out = (staging / filename).open('w', encoding='utf8')
                    parts.append({'file': filename, 'rows': 0})
                row = {key: raw.get(value, '') for key, value in FIELDS.items()}
                row.update({'schema_version': 'environmental-observation/1',
                            'evidence_scope': 'environmental-monitoring',
                            'household_sample_verified': False, 'pwsid': None,
                            'source': 'WQP-WQX3', 'source_profile': part['profile'],
                            'source_url': source['url'], 'retrieved_at': source['retrieved_at'],
                            'raw_file_sha256': source['sha256'], 'raw_table': table,
                            'raw_row_number': line, 'raw_row_sha256': hashlib.sha256(text.encode()).hexdigest()})
                out.write(canonical(row) + '\n')
                parts[-1]['rows'] += 1
        if out:
            out.close()
            out = None
        declared = source.get('http_headers', {}).get('total-result-count')
        if declared is not None and int(declared) != count:
            raise ValueError(f'Source declared {declared} rows but downloaded {count}; not publishing.')
        for info in parts:
            path = staging / info['file']
            info.update({'bytes': path.stat().st_size, 'sha256': sha(path)})
        return {'raw_result_rows': count, 'normalized_result_rows': count,
                'independent_samples': None, 'unique_observations': None,
                'household_samples_verified': 0, 'source_declared_result_rows': declared,
                'parts': parts}
    finally:
        if out:
            out.close()


def split_partition(part):
    lo, hi = dt.date.fromisoformat(part['start']), dt.date.fromisoformat(part['end'])
    if lo == hi:
        # WQP documents NWIS and STORET as disjoint provider filters. When date
        # splitting reaches one day, split once more by provider instead of
        # permanently parking an oversized combined-provider request.
        if not part.get('provider'):
            return [partition(part['state'], part['start'], part['end'], part['profile'],
                              part.get('site_id'), provider)
                    for provider in PROVIDERS]
        return []
    middle = lo + (hi - lo) // 2
    return [partition(part['state'], str(a), str(b), part['profile'], part.get('site_id'), part.get('provider'))
            for a, b in [(lo, middle), (middle + dt.timedelta(days=1), hi)]]


def verify_completed(root, part_id):
    directory = root / 'environmental' / part_id
    manifest = json.loads((directory / 'manifest.json').read_text())
    raw = root / 'raw' / (manifest['source']['sha256'] + '.bin')
    if sha(raw) != manifest['source']['sha256']:
        raise ValueError('Previously completed raw artifact checksum mismatch.')
    for item in manifest['counts']['parts']:
        if sha(directory / item['file']) != item['sha256']:
            raise ValueError('Previously completed normalized artifact checksum mismatch.')
    return manifest


def run(plan, output, max_partitions=1, max_response_bytes=256*1024*1024,
        max_decoded_bytes=1024*1024*1024, max_rows=1_000_000, timeout=45,
        retries=3, fetcher=download):
    validate_plan(plan)
    if (max_partitions < 1 or max_response_bytes < 1 or max_decoded_bytes < 1 or max_rows < 1
            or not 1 <= timeout <= 300 or not 0 <= retries <= 10):
        raise ValueError('Invalid positive resource budgets or timeout/retry bounds.')
    root = pathlib.Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    for directory in ('raw', 'environmental', 'staging'):
        (root / directory).mkdir(exist_ok=True)
    with (root / 'worker.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError('Another backfill process owns this output root.') from exc
        plan_path = root / 'plan.json'
        if plan_path.exists():
            if json.loads(plan_path.read_text())['plan_id'] != plan['plan_id']:
                raise ValueError('Output root belongs to a different plan; use a new root.')
        else:
            save_json(plan_path, plan)
        # Exclusive lock makes abandoned staging safe to remove after a killed worker.
        for directory in (root / 'staging').iterdir():
            if directory.is_dir():
                shutil.rmtree(directory)
        with sqlite3.connect(root / 'checkpoint.sqlite') as db:
            db.execute('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, partition TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, rows INTEGER NOT NULL DEFAULT 0)')
            db.executemany('INSERT OR IGNORE INTO jobs(id,partition,status) VALUES (?,?,\'pending\')',
                           [(p['id'], canonical(p)) for p in plan['partitions']])
            db.execute("UPDATE jobs SET status='pending' WHERE status='processing'")
            db.commit()
            attempted = []
            for _ in range(max_partitions):
                pending = db.execute("SELECT id,partition FROM jobs WHERE status IN ('pending','failed') ORDER BY attempts,id LIMIT 1").fetchone()
                if not pending:
                    break
                ident, text = pending
                part = json.loads(text)
                db.execute("UPDATE jobs SET status='processing',attempts=attempts+1,error=NULL WHERE id=?", (ident,))
                db.commit()
                staging = pathlib.Path(tempfile.mkdtemp(prefix=ident[:12] + '-', dir=root / 'staging'))
                try:
                    target = root / 'environmental' / ident
                    if target.exists():
                        manifest = verify_completed(root, ident)
                    else:
                        downloaded = staging / 'response.bin'
                        source = fetcher(query_url(part), downloaded, max_response_bytes, timeout, retries)
                        raw = root / 'raw' / (source['sha256'] + '.bin')
                        if raw.exists():
                            if sha(raw) != source['sha256']:
                                raise ValueError('Existing content-addressed raw artifact is corrupt.')
                            downloaded.unlink()
                        else:
                            os.replace(downloaded, raw)
                        counts = normalize(raw, staging, part, source, max_decoded_bytes, max_rows)
                        manifest = {'schema_version': SCHEMA, 'partition': part, 'source': source,
                                    'counts': counts, 'completed_at': now(),
                                    'status': 'environmental-observations-acquired',
                                    'household_safety_assessed': False,
                                    'completeness_certified': False}
                        save_json(staging / 'manifest.json', manifest)
                        os.replace(staging, target)
                    db.execute("UPDATE jobs SET status='complete',rows=?,error=NULL WHERE id=?",
                               (manifest['counts']['raw_result_rows'], ident))
                    attempted.append({'id': ident, 'status': 'complete', 'rows': manifest['counts']['raw_result_rows']})
                except BudgetExceeded as exc:
                    children = split_partition(part)
                    status = 'split' if children else 'failed'
                    db.execute('UPDATE jobs SET status=?,error=? WHERE id=?', (status, str(exc), ident))
                    db.executemany("INSERT OR IGNORE INTO jobs(id,partition,status) VALUES (?,?,'pending')",
                                   [(child['id'], canonical(child)) for child in children])
                    attempted.append({'id': ident, 'status': status, 'error': str(exc)})
                except Exception as exc:
                    db.execute("UPDATE jobs SET status='failed',error=? WHERE id=?", (str(exc)[:2000], ident))
                    attempted.append({'id': ident, 'status': 'failed', 'error': str(exc)[:2000]})
                finally:
                    db.commit()
                    shutil.rmtree(staging, ignore_errors=True)
            statuses = dict(db.execute('SELECT status,count(*) FROM jobs GROUP BY status'))
            rows = db.execute("SELECT COALESCE(SUM(rows),0) FROM jobs WHERE status='complete'").fetchone()[0]
            summary = {'schema_version': SCHEMA, 'plan_id': plan['plan_id'], 'updated_at': now(),
                       'partition_status_counts': statuses, 'actual_raw_result_rows': rows,
                       'actual_normalized_result_rows': rows, 'unique_observations': None,
                       'independent_samples': None, 'household_samples_verified': 0,
                       'all_planned_partitions_acquired': not any(statuses.get(s, 0) for s in ('pending', 'failed', 'processing')),
                       'nationwide_household_coverage_complete': False,
                       'maximum_response_bytes_per_attempt': max_response_bytes,
                       'maximum_attempts_this_invocation': max_partitions * (retries + 1),
                       'attempted_this_invocation': attempted}
            save_json(root / 'status.json', summary)
            return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest='command', required=True)
    plan_parser = actions.add_parser('plan', help='Write state/year partitions without downloading records.')
    plan_parser.add_argument('--output', required=True)
    plan_parser.add_argument('--states', default=','.join(STATES))
    plan_parser.add_argument('--start', required=True, help='First activity date, YYYY-MM-DD.')
    plan_parser.add_argument('--end', required=True, help='Last activity date, inclusive, YYYY-MM-DD.')
    plan_parser.add_argument('--profile', choices=PROFILES, default='fullPhysChem')
    plan_parser.add_argument('--site-id', help='Optional restriction for a source contract check.')
    runner = actions.add_parser('run', help='Acquire a bounded batch and save checkpoints.')
    runner.add_argument('--plan', required=True)
    runner.add_argument('--output', required=True, help='Persistent volume directory; never web-service memory.')
    runner.add_argument('--max-partitions', type=int, default=1)
    runner.add_argument('--max-response-bytes', type=int, default=256*1024*1024)
    runner.add_argument('--max-decoded-bytes', type=int, default=1024*1024*1024)
    runner.add_argument('--max-rows', type=int, default=1_000_000)
    runner.add_argument('--timeout', type=int, default=45)
    runner.add_argument('--retries', type=int, default=3)
    args = parser.parse_args(argv)
    try:
        if args.command == 'plan':
            result = make_plan(args.states.upper().split(','), args.start, args.end, args.profile, args.site_id)
            path = pathlib.Path(args.output)
            path.parent.mkdir(parents=True, exist_ok=True)
            if path.exists():
                raise ValueError('Plan file already exists; use a new filename.')
            save_json(path, result)
            print(json.dumps({'plan_id': result['plan_id'], 'partitions': len(result['partitions']), 'record_count': None}))
        else:
            result = run(json.loads(pathlib.Path(args.plan).read_text()), args.output,
                         args.max_partitions, args.max_response_bytes, args.max_decoded_bytes,
                         args.max_rows, args.timeout, args.retries)
            print(json.dumps(result, indent=2))
            if any(item['status'] == 'failed' for item in result['attempted_this_invocation']):
                return 1
        return 0
    except Exception as exc:
        print(json.dumps({'status': 'failed', 'error': str(exc)}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
