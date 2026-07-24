import importlib.util
import os
import pathlib
import unittest
from unittest import mock

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'scripts' / 'sync_epa_seminole.py'
spec = importlib.util.spec_from_file_location('sync_epa_seminole', SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class SyncEpaDiscoveryTests(unittest.TestCase):
    def test_environment_override_wins(self):
        with mock.patch.dict(os.environ, {'SDWA_DOWNLOAD_URL': 'https://example.test/custom.zip'}):
            self.assertEqual(mod.discover_sdwa_zip(), 'https://example.test/custom.zip')

    def test_official_directory_latest_zip_is_preferred(self):
        pages = {
            mod.ECHO_DOWNLOAD_SUMMARY: b'<html>No static ZIP here</html>',
            mod.ECHO_DOWNLOAD_INDEX: b'<a href="SDWA_downloads.zip">old</a><a href="SDWA_latest_downloads.zip">latest</a>',
        }
        with mock.patch.dict(os.environ, {}, clear=False), mock.patch.object(mod, 'request', side_effect=lambda url, **_: pages[url]):
            os.environ.pop('SDWA_DOWNLOAD_URL', None)
            self.assertEqual(mod.discover_sdwa_zip(), mod.ECHO_SDWA_LATEST_ZIP)

    def test_stable_official_path_is_used_when_pages_are_unavailable(self):
        with mock.patch.dict(os.environ, {}, clear=False), mock.patch.object(mod, 'request', side_effect=RuntimeError('offline')):
            os.environ.pop('SDWA_DOWNLOAD_URL', None)
            self.assertEqual(mod.discover_sdwa_zip(), mod.ECHO_SDWA_LATEST_ZIP)

    def test_casselberry_registry_uses_current_official_page(self):
        import json
        source_file = pathlib.Path(__file__).resolve().parents[1] / 'data' / 'epa' / 'ccr_sources.json'
        rows = json.loads(source_file.read_text())
        row = next(x for x in rows if x['id'] == 'casselberry-water-wastewater')
        self.assertEqual(row['url'], 'https://www.casselberry.org/176/Utilities')


if __name__ == '__main__':
    unittest.main()
