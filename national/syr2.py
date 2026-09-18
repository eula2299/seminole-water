"""Bounded extraction of EPA SYR2 Access tables; never execute stored queries.

Each reviewed database contains one chemical table. Names/codes come from the
publisher's table, and mdb-count must agree with the parsed export row count.
"""
from __future__ import annotations
import os, pathlib, re, selectors, subprocess, tempfile, time

MAX_EXPORT_BYTES = 2_000_000_000


def chemical(table):
    match = re.fullmatch(r'(.+)_Chem([0-9]{4})', table)
    if not match or len(table) > 180 or any(ord(c) < 32 for c in table):
        raise ValueError('Unrecognized SYR2 chemical table name')
    return {'table': table, 'analyte': match[1], 'code': match[2]}


def command_to_file(args, target, max_bytes, timeout):
    """Drain a child with bounded memory, disk, stderr and wall-clock time."""
    started = time.monotonic()
    with tempfile.TemporaryFile() as errors, pathlib.Path(target).open('wb') as out:
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=errors)
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                size = 0
                while selector.get_map():
                    if time.monotonic() - started > timeout:
                        raise ValueError('Access export time budget exceeded')
                    if os.fstat(errors.fileno()).st_size > 65536:
                        raise ValueError('Access reader returned excessive diagnostics')
                    for key, _ in selector.select(timeout=1):
                        block = os.read(key.fd, min(1024 * 1024, max_bytes - size + 1))
                        if not block:
                            selector.unregister(key.fileobj)
                            continue
                        size += len(block)
                        if size > max_bytes:
                            raise ValueError('Access export byte budget exceeded')
                        out.write(block)
            result = process.wait(timeout=max(.1, timeout - (time.monotonic() - started)))
            if result != 0 or os.fstat(errors.fileno()).st_size:
                raise ValueError('Access reader failed or reported a data warning')
            return size
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()
            process.stdout.close()


def export_mdb(source, destination, max_bytes=MAX_EXPORT_BYTES):
    destination = pathlib.Path(destination)
    metadata = destination.with_suffix('.metadata.txt')
    try:
        command_to_file(['mdb-tables', '-1', str(source)], metadata, 65536, 30)
        tables = metadata.read_text(encoding='utf-8').splitlines()
        if len(tables) != 1:
            raise ValueError('Expected exactly one SYR2 source chemical table')
        info = chemical(tables[0])
        command_to_file(['mdb-count', str(source), info['table']], metadata, 100, 30)
        count = metadata.read_text().strip()
        if not count.isdigit() or int(count) < 1:
            raise ValueError('Invalid SYR2 source table row count')
        info['source_table_rows'] = int(count)
        command_to_file(['mdb-export', '-d', '\t', '-D', '%Y-%m-%d',
                         '-T', '%Y-%m-%d %H:%M:%S', str(source), info['table']],
                        destination, max_bytes, 300)
        return info
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    finally:
        metadata.unlink(missing_ok=True)
