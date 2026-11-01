"""Download once: exact previous stable catalog entry, public assets and SHA-256."""
import json
from pathlib import Path
from release_state import GitHub, candidate, public_package, require, digest
import catalog


def previous(manifest, version):
    number=lambda v: tuple(map(int,v.split('.')))
    entries=[v for p in manifest for v in p['versions'] if number(v['version']) < number(version+'.0')]
    require(bool(entries), 'No previous stable catalog entry. Define an explicit upgrade baseline before qualification.')
    return max(entries,key=lambda v:number(v['version']))


def main():
    manifest=json.loads(Path('manifest.json').read_text());catalog.validate(manifest)
    entry=previous(manifest,candidate());version=entry['version'].removesuffix('.0')
    api=GitHub('MajorSchloch/jellyfin-plugin-watchguard')
    release=api.release(version,public_only=True)
    require(release and not release['draft'], 'Previous stable release is unavailable.')
    folder=Path('artifacts/previous-stable');archive=public_package(api,release,version,folder)
    expected=catalog.entry(archive,entry['sourceUrl'],release['published_at'],version+'.0')
    require(catalog.installation(entry)==catalog.installation(expected), 'Previous stable catalog metadata differs from public release.')
    (folder/'identity.json').write_text(json.dumps(dict(version=version,filename=archive.name,sha256=digest(archive.read_bytes()),releaseId=release['id'],catalog=entry),indent=2)+'\n')
if __name__=='__main__': main()
