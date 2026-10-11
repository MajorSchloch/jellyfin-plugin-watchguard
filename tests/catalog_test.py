import importlib.util
import json
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
        path=Path('artifacts/Jellyfin.Plugin.WatchGuard-v0.3.1.zip')
        _,sha=catalog.inspect_zip(path)
        self.assertEqual(path.with_suffix('.zip.sha256').read_text().split(),[sha,path.name])

if __name__=='__main__':unittest.main()
