import hashlib
import io
import pathlib
import tempfile
import unittest
import urllib.request
import zipfile
from unittest import mock

from national import catalog


class Response(io.BytesIO):
    def __init__(self, data, url='https://www.epa.gov/source.zip', headers=None, short_reads=None):
        super().__init__(data)
        self.url = url
        self.headers = headers or {}
        self.read_sizes = []
        self.bytes_read = 0
        self.short_reads = short_reads

    def read(self, size=-1):
        self.read_sizes.append(size)
        data = super().read(min(size, self.short_reads) if self.short_reads else size)
        self.bytes_read += len(data)
        return data


class CatalogTests(unittest.TestCase):
    def test_redirect_targets_are_rejected_before_another_request(self):
        for destination in ('http://www.epa.gov/a', 'https://example.com/a',
                            'https://www.epa.gov.evil.example/a', 'https://@www.epa.gov/a',
                            'https://user:pass@www.epa.gov/a', 'https://www.epa.gov:443/a'):
            with self.subTest(destination=destination):
                handler = catalog.EPARedirectHandler()
                handler.parent = mock.Mock()
                request = urllib.request.Request('https://www.epa.gov/original')
                with self.assertRaisesRegex(ValueError, 'unapproved EPA source'):
                    handler.http_error_302(request, io.BytesIO(), 302, 'Found', {'location': destination})
                handler.parent.open.assert_not_called()

    def test_approved_relative_redirect_is_followed(self):
        handler = catalog.EPARedirectHandler()
        handler.parent = mock.Mock()
        request = urllib.request.Request('https://www.epa.gov/original')
        request.timeout = 30
        handler.http_error_302(request, io.BytesIO(), 302, 'Found', {'location': '/new.zip'})
        self.assertEqual(handler.parent.open.call_args.args[0].full_url, 'https://www.epa.gov/new.zip')

    def test_open_installs_redirect_guard_and_validates_initial_url(self):
        with mock.patch.object(catalog.urllib.request, 'build_opener') as opener:
            with self.assertRaisesRegex(ValueError, 'unapproved EPA source'):
                catalog._open_epa('https://example.com/a', 30)
            opener.assert_not_called()
            catalog._open_epa('https://www.epa.gov/a', 30)
            self.assertIsInstance(opener.call_args.args[0], catalog.EPARedirectHandler)
            self.assertEqual(opener.return_value.open.call_args.kwargs['timeout'], 30)

    def test_discovery_preserves_families_and_ignores_missing_links(self):
        ucmr = '<a href><a href=""><a>empty</a>' + ''.join(
            f'<a href="/files/ucmr{i}-occurrence-data.zip">UCMR</a>' for i in range(1, 7))
        ucmr += '<a href="/files/ucmr5-occurrence-data.zip">duplicate</a>'
        responses = [Response(ucmr.encode()),
                     Response(b'<a href="/syr4_rads.zip">data</a><a href="/syr4_paired.zip">excluded</a>'),
                     Response(b'<a href="/syr3_rads.zip">data</a><a href="/syr3_treatment.zip">excluded</a>'), Response(b'')]
        with mock.patch.object(catalog, '_open_epa', side_effect=responses):
            rows = catalog.discover()
        self.assertEqual([row['id'] for row in rows], ['ucmr5', 'ucmr4', 'ucmr3', 'ucmr2', 'ucmr1', 'syr4_rads', 'syr3_rads'])
        self.assertTrue(all(row['count_state'] == 'not-downloaded' for row in rows))
        self.assertEqual([row['family'] for row in rows], ['ucmr'] * 5 + ['syr4', 'syr3'])

    def test_discovery_accepts_leading_underscore_syr_archives_and_preserves_exclusions(self):
        filenames = ['_syr4_phase_chem_1.zip', '_syr4_rads.zip'] + [
            f'_syr4_{excluded}.zip' for excluded in
            ('paired', 'treatment', 'corrective', 'cryptobinning', 'adwr', 'microbes_dr', 'microbes_gw')]
        page = ''.join(f'<a href="/files/{name}">data</a>' for name in filenames)
        with mock.patch.object(catalog, '_open_epa', side_effect=[Response(b''), Response(page.encode()), Response(b''), Response(b'')]):
            rows = catalog.discover()
        self.assertEqual([row['id'] for row in rows], ['syr4_phase_chem_1', 'syr4_rads'])
        self.assertEqual([row['url'] for row in rows], [f'https://www.epa.gov/files/{name}' for name in filenames[:2]])
        self.assertTrue(all(row['family'] == 'syr4' for row in rows))

    def test_syr2_uses_only_reviewed_archives_including_corrected_nitrate(self):
        page=''.join(f'<a href="/files/{name}">data</a>' for name in list(catalog.SYR2_ARCHIVES)+['nitrate-old.zip','unreviewed.mdb.zip'])
        with mock.patch.object(catalog, '_open_epa', side_effect=[Response(b'') for _ in range(3)]+[Response(page.encode())]):
            rows=catalog.discover()
        self.assertEqual(len(rows),6)
        self.assertEqual({row['id'] for row in rows},set(catalog.SYR2_ARCHIVES.values()))
        self.assertTrue(all(row['family']=='syr2' for row in rows))

    def test_discovery_rejects_oversize_page_instead_of_truncating(self):
        response = Response(b' ' * 40, short_reads=3)
        with mock.patch.object(catalog, 'MAX_PAGE_BYTES', 20), mock.patch.object(catalog, '_open_epa', return_value=response):
            with self.assertRaisesRegex(ValueError, 'catalogue page byte budget exceeded'):
                catalog.discover()
        self.assertEqual(response.bytes_read, 21)
        self.assertTrue(all(0 < size <= 21 for size in response.read_sizes))

    def test_bounded_read_accepts_exact_limit_and_rejects_header_without_reading(self):
        response = Response(b'12345', short_reads=2)
        self.assertEqual(b''.join(catalog._bounded_chunks(response, 5, 'too large')), b'12345')
        response = Response(b'12345', headers={'content-length': '6'})
        with self.assertRaisesRegex(ValueError, 'too large'):
            list(catalog._bounded_chunks(response, 5, 'too large'))
        self.assertEqual(response.read_sizes, [])

    def test_download_retains_bytes_and_receipt_shape(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('data.csv', 'PWSID,value\n0000123,0\n')
        data = buffer.getvalue()
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(catalog, '_open_epa', return_value=Response(data)):
            target = pathlib.Path(tmp) / 'source.zip'
            receipt = catalog.download('https://www.epa.gov/source.zip', target, len(data))
            self.assertEqual(target.read_bytes(), data)
        self.assertEqual(receipt, {'sha256': hashlib.sha256(data).hexdigest(), 'archive_bytes': len(data)})

    def test_download_rejects_oversize_without_reading_a_full_extra_chunk(self):
        response = Response(b'0123456789')
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(catalog, '_open_epa', return_value=response):
            with self.assertRaisesRegex(ValueError, 'source archive byte budget exceeded'):
                catalog.download('https://www.epa.gov/source.zip', pathlib.Path(tmp) / 'source.zip', 4)
        self.assertEqual(response.bytes_read, 5)
        self.assertEqual(response.read_sizes, [5])

    def test_invalid_budget_cannot_trigger_unbounded_download(self):
        with mock.patch.object(catalog, '_open_epa') as opener:
            for limit in (-1, 1.5, True):
                with self.subTest(limit=limit), self.assertRaisesRegex(ValueError, 'byte budget'):
                    catalog.download('https://www.epa.gov/source.zip', 'unused.zip', limit)
            opener.assert_not_called()


if __name__ == '__main__':
    unittest.main()
