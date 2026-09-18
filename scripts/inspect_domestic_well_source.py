"""Bounded source-contract inspection; no production writes or count claims."""
import json
import pathlib
import tempfile
from national.well_archive import download

SOURCE_ID = '6713ae98d34e761f56fea223'
SOURCE_URL = 'https://www.sciencebase.gov/catalog/item/' + SOURCE_ID


def main():
    target = pathlib.Path('verification/domestic-well-source')
    target.mkdir(parents=True, exist_ok=True)
    meta_path = target / 'metadata.json'
    provenance = download(SOURCE_URL + '?format=json', meta_path, 2_000_000)
    meta = json.loads(meta_path.read_text())
    if meta.get('id') != SOURCE_ID:
        raise ValueError('Source identity mismatch')
    print(json.dumps({'source': SOURCE_URL, 'provenance': provenance, 'metadata': meta}, indent=2))
    for i, record in enumerate(meta.get('files', [])):
        name = record.get('name', '')
        size = record.get('size')
        if (isinstance(size, int) and 0 < size <= 2_000_000
                and name.lower().endswith(('.xml', '.txt', '.json', '.csv'))):
            checksum = record.get('checksum', {})
            if checksum.get('type') != 'MD5':
                continue
            path = target / ('metadata-file-' + str(i) + pathlib.Path(name).suffix)
            evidence = download(record['url'], path, 2_000_000, size, checksum['value'])
            print('DOCUMENT', name, json.dumps(evidence))
            print(path.read_text(encoding='utf-8-sig')[:100_000])


if __name__ == '__main__':
    main()
