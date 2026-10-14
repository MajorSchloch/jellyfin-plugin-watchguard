import importlib.util
import json
from unittest.mock import patch
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('catalog', Path(__file__).resolve().parents[1]/'scripts/catalog.py')
catalog = importlib.util.module_from_spec(spec); spec.loader.exec_module(catalog)

class CatalogTests(unittest.TestCase):
    def test_identity_checksum_abi_and_timestamp(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'test.zip'
            with zipfile.ZipFile(path,'w') as z:
                z.writestr(catalog.DLL,b'fixture');z.writestr('LICENSE','fixture')
            item=catalog.entry(path,'http://host.docker.internal:8080/test.zip','2026-10-11T00:00:00Z')
            data=[catalog.package([item])];catalog.validate(data,True)
            self.assertEqual(len(item['checksum']),32)
            for key,value in [('targetAbi','10.11.0.0'),('checksum','a'*64),('timestamp','2026-10-11')]:
                broken=json.loads(json.dumps(data));broken[0]['versions'][0][key]=value
                with self.assertRaises(ValueError):catalog.validate(broken,True)
            with self.assertRaises(ValueError):catalog.validate(data)
            data[0]['guid']='wrong'
            with self.assertRaises(ValueError):catalog.validate(data,True)
    def test_no_speculative_release_and_runtime_allowlist(self):
        catalog.validate(json.loads(Path('manifest.json').read_text()))
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'bad.zip'
            with zipfile.ZipFile(path,'w') as z:z.writestr('OtherPlugin.dll','not allowed')
            with self.assertRaises(ValueError):catalog.inspect_zip(path)
    def test_release_archive(self):
        path=Path('artifacts/Jellyfin.Plugin.WatchGuard-v0.4.4.zip')
        _,sha=catalog.inspect_zip(path)
        self.assertEqual(path.with_suffix('.zip.sha256').read_text().split(),[sha,path.name])

    def test_published_history_is_preserved_and_versions_are_immutable(self):
        archive=Path('artifacts/Jellyfin.Plugin.WatchGuard-v0.4.4.zip')
        published=json.loads(Path('manifest.json').read_text())
        self.assertTrue(any(v['version']=='0.4.1.0' for v in published[0]['versions']))
        # Preparation must preserve every published entry, including v0.4.1.
        # Only the synthetic v0.4.4 release is added to the temporary manifest.
        original=json.loads(json.dumps(published))
        original[0]['versions']=[v for v in original[0]['versions'] if v['version']!='0.4.4.0']
        self.assertTrue(any(v['version']=='0.3.1.0' for v in original[0]['versions']))
        self.assertTrue(any(v['version']=='0.4.0.0' for v in original[0]['versions']))
        base='https://github.com/Fixture/WatchGuard/releases/download/v0.4.4/'
        release={'draft':False,'prerelease':False,'published_at':'2026-10-12T00:00:00Z','assets':[
            {'name':archive.name,'browser_download_url':base+archive.name},
            {'name':archive.name+'.sha256','browser_download_url':base+archive.name+'.sha256'}]}
        def download(url,destination):
            if '/releases/tags/' in url: content=json.dumps(release).encode()
            elif url.endswith('.sha256'): content=archive.with_suffix('.zip.sha256').read_bytes()
            else: content=archive.read_bytes()
            Path(destination).write_bytes(content)
        with tempfile.TemporaryDirectory() as temp, patch.object(catalog,'download',download):
            manifest=Path(temp)/'manifest.json';manifest.write_text(json.dumps(original))
            catalog.add_release(manifest,'Fixture/WatchGuard','v0.4.4',archive)
            updated=json.loads(manifest.read_text())
            for old in original[0]['versions']:
                self.assertEqual(next(v for v in updated[0]['versions'] if v['version']==old['version']),old)
            self.assertEqual(updated[0]['versions'][0]['version'],'0.4.4.0')
            saved=manifest.read_bytes();release['published_at']='2026-10-13T00:00:00Z'
            with self.assertRaises(ValueError):catalog.add_release(manifest,'Fixture/WatchGuard','v0.4.4',archive)
            self.assertEqual(manifest.read_bytes(),saved)

if __name__=='__main__':unittest.main()
