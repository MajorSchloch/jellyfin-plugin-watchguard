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
        path=Path('artifacts/Jellyfin.Plugin.WatchGuard-v0.7.7.zip')
        _,sha=catalog.inspect_zip(path)
        self.assertEqual(path.with_suffix('.zip.sha256').read_text().split(),[sha,path.name])

    def test_published_history_is_preserved_and_versions_are_immutable(self):
        archive=Path('artifacts/Jellyfin.Plugin.WatchGuard-v0.7.7.zip')
        published=json.loads(Path('manifest.json').read_text())
        self.assertTrue(any(v['version']=='0.4.1.0' for v in published[0]['versions']))
        # Exercise a synthetic future release so publication of the current
        # version never invalidates this check. Preserve the entire real history.
        original=json.loads(json.dumps(published))
        self.assertTrue(any(v['version']=='0.4.10.0' for v in original[0]['versions']))
        latest=max(tuple(map(int,v['version'].split('.'))) for v in original[0]['versions'])
        version=f'{latest[0]}.{latest[1]}.{latest[2]+1}.0'
        tag='v'+version.removesuffix('.0')
        asset_name=f'Jellyfin.Plugin.WatchGuard-{tag}.zip'
        self.assertFalse(any(v['version']==version for v in original[0]['versions']))
        self.assertTrue(any(v['version']=='0.3.1.0' for v in original[0]['versions']))
        self.assertTrue(any(v['version']=='0.4.0.0' for v in original[0]['versions']))
        base=f'https://github.com/Fixture/WatchGuard/releases/download/{tag}/'
        release={'draft':False,'prerelease':False,'published_at':'2026-10-12T00:00:00Z','assets':[
            {'name':asset_name,'browser_download_url':base+asset_name},
            {'name':asset_name+'.sha256','browser_download_url':base+asset_name+'.sha256'}]}
        def download(url,destination):
            if '/releases/tags/' in url: content=json.dumps(release).encode()
            elif url.endswith('.sha256'): content=f'{catalog.inspect_zip(archive)[1]}  {asset_name}\n'.encode()
            else: content=archive.read_bytes()
            Path(destination).write_bytes(content)
        content=catalog.editorial()
        content['versions'][version]={'summary':['Synthetic next-release test summary.'], 'documentation':'https://github.com/MajorSchloch/jellyfin-plugin-watchguard/blob/master/README.md'}
        with tempfile.TemporaryDirectory() as temp, patch.object(catalog,'download',download), patch.object(catalog,'editorial',return_value=content):
            manifest=Path(temp)/'manifest.json';manifest.write_text(json.dumps(original))
            catalog.add_release(manifest,'Fixture/WatchGuard',tag,archive)
            updated=json.loads(manifest.read_text())
            for old in original[0]['versions']:
                self.assertEqual(next(v for v in updated[0]['versions'] if v['version']==old['version']),old)
            self.assertEqual(updated[0]['versions'][0]['version'],version)
            saved=manifest.read_bytes();release['published_at']='2026-10-13T00:00:00Z'
            with self.assertRaises(ValueError):catalog.add_release(manifest,'Fixture/WatchGuard',tag,archive)
            self.assertEqual(manifest.read_bytes(),saved)

    def test_editorial_corrections_preserve_every_installation_field(self):
        original=json.loads(Path('manifest.json').read_text())
        edited=json.loads(json.dumps(original))
        edited[0]['description']='Clearer description'
        edited[0]['versions'][0]['changelog']='- Corrected release summary.'
        catalog.preserve_history(original,edited)
        for key,value in [('version','99.0.0.0'),('sourceUrl','https://example.com/other.zip'),
                          ('checksum','0'*32),('timestamp','2026-01-01T00:00:00Z'),('targetAbi','99.0.0.0')]:
            with self.subTest(field=key):
                changed=json.loads(json.dumps(edited));changed[0]['versions'][0][key]=value
                with self.assertRaises(ValueError):catalog.preserve_history(original,changed)
        removed=json.loads(json.dumps(edited));removed[0]['versions'].pop()
        with self.assertRaises(ValueError):catalog.preserve_history(original,removed)
        changed=json.loads(json.dumps(edited));changed[0]['versions'][0]['futureInstallField']='new'
        with self.assertRaises(ValueError):catalog.preserve_history(original,changed)
        duplicate=json.loads(json.dumps(edited));duplicate[0]['versions'].append(duplicate[0]['versions'][0])
        with self.assertRaises(ValueError):catalog.preserve_history(original,duplicate)

    def test_missing_and_placeholder_future_release_notes_are_rejected(self):
        with self.assertRaises(ValueError):catalog.changelog('99.0.0.0')
        for value in ['',None,'See the matching release notes.','- See the matching release notes.', '- TODO']:
            with self.subTest(value=value), self.assertRaises(ValueError):catalog.check_changelog(value)
        catalog.check_changelog('- Show readable viewing progress.\n- Improve keyboard navigation.')

    def test_catalog_generation_is_idempotent_and_runtime_description_matches(self):
        original=json.loads(Path('manifest.json').read_text())
        refreshed=catalog.refresh_editorial(original)
        self.assertEqual(original,refreshed)
        self.assertEqual(refreshed,catalog.refresh_editorial(refreshed))
        catalog.preserve_history(original,refreshed)
        description=catalog.editorial()['description']
        self.assertIn('public override string Description => "'+description+'";',Path('Jellyfin.Plugin.WatchGuard/Plugin.cs').read_text())
        for notes in catalog.editorial()['versions'].values():
            path=notes['documentation'].split('/blob/master/',1)[1]
            self.assertTrue(Path(path).is_file(),path)

    def test_image_is_public_immutable_and_small(self):
        url=catalog.editorial()['imageUrl']
        self.assertRegex(url,r'/[a-f0-9]{40}/assets/watchguard-v1\.webp$')
        image=Path('assets/watchguard-v1.webp').read_bytes()
        self.assertEqual(image[:4],b'RIFF');self.assertEqual(image[8:12],b'WEBP')
        self.assertLess(len(image),50000)

if __name__=='__main__':unittest.main()
