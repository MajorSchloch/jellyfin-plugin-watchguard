"""Disposable native preference restart/downgrade checks against published binaries."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BASELINES = {
    '0.5.0': 'a9ff9255785761aed574e0ac0d14535445461a3de6da5f4d3eb32f5dd300332b',
    '0.4.10': '471d99364db520a0990e4a624d73e26ae4c9f1c50404c2902c9691516667bf3e',
}


def run(call, restart, docker, name, root, plugins, token, installed):
    assert root.name.startswith('watchguard-poc-') and name.startswith('watchguard-poc-')
    assert installed.is_relative_to(root)
    dll = installed / 'Jellyfin.Plugin.WatchGuard.dll'
    candidate = dll.read_bytes()
    data = plugins / 'Jellyfin.Plugin.WatchGuard'
    protected = {p: p.read_bytes() for p in data.glob('watchlist*.json')}
    route = '/WatchGuard/Preferences'
    defaults = {'Owner': 'mine', 'Statuses': ['watchlisted', 'watching', 'playing'], 'Sort': 'title'}
    added = {'Owner': 'all', 'Statuses': ['watched'], 'Sort': 'added'}
    fallback = dict(added, Sort='title')

    def install(content, version):
        docker('stop', name)
        dll.write_bytes(content)
        (installed / 'meta.json').unlink(missing_ok=True)
        restart()
        assert call('/WatchGuard/IntegrationStatus', token=token)['PluginVersion'] == version

    call(route, 'PUT', added, token)
    restart()
    assert call(route, token=token) == added, 'Added default must survive a real server restart'
    for version, digest in BASELINES.items():
        archive = ROOT / 'artifacts' / f'Jellyfin.Plugin.WatchGuard-v{version}.zip'
        assert hashlib.sha256(archive.read_bytes()).hexdigest() == digest, 'Published rollback checksum mismatch'
        with zipfile.ZipFile(archive) as z:
            old = z.read('Jellyfin.Plugin.WatchGuard.dll')
        for operation in ['unchanged', 'save-identical', 'recent', 'reset']:
            call(route, 'PUT', added, token)
            install(old, version)
            assert call(route, token=token) == fallback, 'Published plugin must read strict schema 1'
            if operation == 'save-identical': call(route, 'PUT', fallback, token)
            if operation == 'recent': call(route, 'PUT', dict(fallback, Sort='recent'), token)
            if operation == 'reset': call(route, 'DELETE', token=token)
            install(candidate, '0.7.5')
            expected = added if operation == 'unchanged' else defaults if operation == 'reset' else dict(fallback, Sort='recent') if operation == 'recent' else fallback
            assert call(route, token=token) == expected, f'Unexpected {version} {operation} re-upgrade defaults'
            print(f'Published {version} preference {operation} round-trip passed.', flush=True)
    # A corrupt extension must remain byte-identical on GET, PUT and reset errors.
    sidecar = data / 'preference-sorts.json'
    saved = sidecar.read_bytes()
    before = (data / 'preferences.json').read_bytes()
    docker('stop', name)
    sidecar.write_text('{broken')
    restart()
    for method in ['GET', 'PUT', 'DELETE']:
        call(route, method, added if method == 'PUT' else None, token, expected=503)
        assert sidecar.read_text() == '{broken' and (data / 'preferences.json').read_bytes() == before
    # Follow the documented recovery procedure, not live edits through Docker
    # Desktop's host bind mount followed immediately by a server read.
    docker('stop', name)
    sidecar.write_bytes(saved)
    restart()
    call(route, 'DELETE', token=token)
    assert call(route, token=token) == defaults
    assert all(p.read_bytes() == content for p, content in protected.items()), 'Preference tests changed watchlists/dates'
    report = {'result': 'PASS', 'restart': True, 'publishedBaselines': BASELINES,
              'operations': ['unchanged', 'save-identical', 'recent', 'reset'],
              'corruptDataPreserved': True, 'watchlistsUnchanged': True}
    (ROOT / 'artifacts/preference-roundtrip-v051.json').write_text(json.dumps(report, indent=2) + '\n')
    print('Preference persistence, published downgrade/re-upgrade and corruption checks passed.', flush=True)
