"""Bounded source-contract inspection; no production writes or count claims."""
import json
import pathlib
import re
import urllib.parse
import urllib.request
from national.well_archive import download

SOURCE_ID = '6713ae98d34e761f56fea223'
SOURCE_URL = 'https://www.sciencebase.gov/catalog/item/' + SOURCE_ID


def allowed_preview(url):
    u = urllib.parse.urlsplit(url)
    if u.scheme != 'https' or u.username or u.password or u.port not in (None, 443) or u.fragment:
        raise ValueError('Unapproved source URL')
    manager = u.hostname == 'sciencebase.usgs.gov' and u.path == '/manager/download/cmi3tlgef00090to6cscucg4s'
    bucket = bool(re.fullmatch(r'prod-is-usgs-sb-prod-content\.s3(?:\.[a-z0-9-]+)?\.amazonaws\.com', u.hostname or ''))
    object_path = u.path == '/' + SOURCE_ID + '/Table1_National_Domestic_wells.txt'
    if not (manager or bucket and object_path):
        raise ValueError('Unreviewed download destination: ' + (u.hostname or ''))


class PreviewRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        allowed_preview(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


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
            if not checksum or checksum.get('type') != 'MD5':
                continue
            path = target / ('metadata-file-' + str(i) + pathlib.Path(name).suffix)
            evidence = download(record['url'], path, 2_000_000, size, checksum['value'])
            print('DOCUMENT', name, json.dumps(evidence))
    sources = [f for f in meta.get('files', []) if f.get('name') == 'Table1_National_Domestic_wells.txt']
    if len(sources) != 1:
        raise ValueError('Unexpected source file inventory')
    url = sources[0]['downloadUri']
    allowed_preview(url)
    request = urllib.request.Request(url, headers={'Range': 'bytes=0-8191', 'User-Agent': 'IsMyWaterOK-Source-Contract/1', 'Accept-Encoding': 'identity'})
    with urllib.request.build_opener(PreviewRedirect()).open(request, timeout=45) as response:
        preview = response.read(8192)
        result = {'status': response.status, 'host': urllib.parse.urlsplit(response.url).hostname,
                  'content_type': response.headers.get('Content-Type'), 'content_length': response.headers.get('Content-Length'),
                  'content_range': response.headers.get('Content-Range'), 'etag': response.headers.get('ETag'),
                  'preview_only': True, 'bytes_read': len(preview)}
    text = preview.decode('utf-8-sig')
    (target / 'header-preview.txt').write_text(text)
    (target / 'preview-contract.json').write_text(json.dumps(result, indent=2))
    print('PREVIEW', json.dumps(result), text[:6000])


if __name__ == '__main__':
    main()
