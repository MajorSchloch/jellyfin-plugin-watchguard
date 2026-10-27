"""Immutable released fixtures. Only these explicit versions may be selected."""
import argparse
import os
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile

IMAGES = {
    '12.2': {
        'official': 'jellyfin/jellyfin:12.2@sha256:357724bf0ae27a672c7cbaa899db2d9abeb13dbd8657ccce750258a4c059d037',
        'linuxserver': 'lscr.io/linuxserver/jellyfin:12.2ubu2604-ls53@sha256:1bb4f88d822a0510bb3604b68aacb80d77c1d2a30181e500090c65111b98723b',
    },
    '12.3': {
        'official': 'jellyfin/jellyfin:12.3@sha256:2038fe038ab3876a80f6e7b7e0aef6607b032c7dc0c9b3ad3296d0b2eba3bbb5',
        'linuxserver': 'lscr.io/linuxserver/jellyfin:12.3ubu2604-ls56@sha256:4212ca390fbc6bd5002048d2d2ce2b8a5b1ad278ec4cbabe6519869117404308',
    },
    '12.4': {
        'official': 'jellyfin/jellyfin:12.4@sha256:fea863d0cd9ec445985d9c75fc6ed64e38a1d2766cf0c250a33d553f4fc1b771',
        'linuxserver': 'lscr.io/linuxserver/jellyfin:12.4ubu2604-ls57@sha256:3894d9eae88418d3cf9ac6349392d2c4dad818365a59565d19edc38098897044',
    },
}


def version():
    selected = os.environ.get('WATCHGUARD_JELLYFIN_VERSION', '12.4')
    if selected not in IMAGES:
        raise ValueError('Only pinned Jellyfin 12.2, 12.3 and 12.4 fixtures are supported')
    return selected


def image(linuxserver=False):
    return IMAGES[version()]['linuxserver' if linuxserver else 'official']


def inspect(container, linuxserver, plugin, server_version, output):
    """Read real packaged metadata; apply the production convention to native methods."""
    folder = '/usr/lib/jellyfin/bin' if linuxserver else '/jellyfin'
    project = Path(__file__).parent / 'CompatibilityProbe/CompatibilityProbe.csproj'
    subprocess.run(['dotnet', 'build', str(project), '-c', 'Release', '--nologo'], check=True, stdout=subprocess.DEVNULL)
    with tempfile.TemporaryDirectory(prefix='wg-compat-assemblies-') as temp:
        archive = subprocess.check_output(['docker', 'exec', container, 'sh', '-c', 'cd ' + folder + ' && tar -cf - *.dll'])
        with tarfile.open(fileobj=io.BytesIO(archive)) as source:
            source.extractall(temp, filter='data')
        result = subprocess.check_output(['dotnet', str(project.parent / 'bin/Release/net10.0/CompatibilityProbe.dll'), temp, str(plugin), server_version], text=True)
        report = json.loads(result)
    report['packagedRuntime'] = json.loads(subprocess.check_output(['docker', 'exec', container, 'cat', folder + '/jellyfin.runtimeconfig.json'], text=True))
    frameworks = report['packagedRuntime']['runtimeOptions']['includedFrameworks']
    assert all(f['version'].startswith('10.') for f in frameworks), 'Unexpected packaged runtime family'
    if server_version == '12.4.0':
        assert {f['name']: f['version'] for f in frameworks} == {'Microsoft.NETCore.App':'10.0.14', 'Microsoft.AspNetCore.App':'10.0.14'}, 'Verify the released 12.4 runtime'
    report['image'] = image(linuxserver)
    report['imageIdentity'] = json.loads(subprocess.check_output(['docker', 'image', 'inspect', image(linuxserver), '--format', '{{json .}}'], text=True))
    # Retain immutable provenance, not unrelated daemon configuration.
    report['imageIdentity'] = {key: report['imageIdentity'][key] for key in ('Id', 'RepoDigests', 'Architecture', 'Os')}
    web = '/usr/share/jellyfin/web' if linuxserver else '/jellyfin/jellyfin-web'
    report['webIndexSha256'] = subprocess.check_output(['docker', 'exec', container, 'sha256sum', web + '/index.html'], text=True).split()[0]
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    Path(output).write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('suite')
    args = parser.parse_args()
    print(image(args.suite in ('standalone-caddy', 'migration', 'websocket', 'server-enforcement-linuxserver')))
