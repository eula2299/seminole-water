"""Deterministic, bounded acquisition scheduling (not source-data inference)."""
from __future__ import annotations
import copy
import re

MAX_ATTEMPTS = 3


def retryable_server_error(error: str | None) -> bool:
    """A reviewed WQP 5xx transfer failure may benefit from a smaller interval."""
    return bool(re.fullmatch(r'Source transfer failed after \d+ attempts: HTTP Error 5\d\d: .+', error or ''))


def choose_job(jobs, dispatches: int = 0):
    """Reserve one of four slots for retries instead of starving them for years.

    Retain the original three-attempt ceiling. When only one queue has work,
    use it. Recent pending intervals stay first; exhausted failures stay visible.
    The caller persists dispatches together with the job result atomically.
    """
    eligible = [j for j in jobs if j.get('status') in ('pending', 'failed')
                and 0 <= j.get('attempts', 0) < MAX_ATTEMPTS]
    pending = [j for j in eligible if j['status'] == 'pending']
    retries = [j for j in eligible if j['status'] == 'failed']
    queue = (retries or pending) if dispatches % 4 == 0 else (pending or retries)
    if not queue:
        return None
    def key(job):
        part = job['partition']
        return (job.get('attempts', 0), -int(part['start'][:4]), part['state'], part['start'], part['id'])
    return copy.deepcopy(min(queue, key=key))


def transfer_timeout(job) -> int:
    """Give unsplittable one-day transfers longer, but never unbounded, reads.

    Multi-day intervals still split at the existing 45-second budget. A failed
    one-day transfer can use 90 then 180 seconds on its remaining two attempts.
    Byte, row, memory, disk, publisher, and checksum checks are unchanged.
    """
    part = job['partition']
    error = (job.get('error') or '').lower()
    timed_out = 'timed out' in error or 'time budget' in error
    if part['start'] == part['end'] and timed_out:
        return min(180, 45 * 2 ** min(MAX_ATTEMPTS - 1, max(0, job.get('attempts', 0))))
    return 45
