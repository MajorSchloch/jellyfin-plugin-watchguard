#!/usr/bin/env python3
"""Build a deterministic, allowlisted deployment ZIP. Does not publish or deploy."""
import hashlib
from pathlib import Path
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = ET.parse(ROOT / 'Directory.Build.props').findtext('./PropertyGroup/Version')
PROJECT = 'Jellyfin.Plugin.WatchGuard/Jellyfin.Plugin.WatchGuard.csproj'
DLL = 'Jellyfin.Plugin.WatchGuard.dll'
ARTIFACTS = ROOT / 'artifacts'


def run(*args):
    subprocess.run(args, cwd=ROOT, check=True)


def main():
    sdk = subprocess.check_output(['dotnet', '--version'], cwd=ROOT, text=True).strip()
    if sdk != '10.0.302':
        raise SystemExit('Release packaging requires .NET SDK 10.0.302 for reproducibility.')
    if VERSION != '0.4.8':
        raise SystemExit('Review release metadata before packaging a different version.')
    flags = ['-c', 'Release', '--no-restore', '-p:ContinuousIntegrationBuild=true',
             '-p:DebugType=None', '-p:DebugSymbols=false', f'-p:PathMap={ROOT}=/_/src']
    run('dotnet', 'restore', 'Jellyfin.Plugin.WatchGuard.slnx', '--locked-mode')
    # Force compilation: repeat runs verify determinism, not just copied incremental outputs.
    run('dotnet', 'build', PROJECT, '--no-incremental', *flags)
    ARTIFACTS.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='watchguard-release-') as temp:
        run('dotnet', 'publish', PROJECT, '--no-build', *flags, '-o', temp)
        runtime = Path(temp) / DLL
        extra_dlls = [p.name for p in Path(temp).glob('*.dll') if p.name != DLL]
        if not runtime.is_file() or extra_dlls:
            raise RuntimeError(f'Unexpected runtime layout: {extra_dlls}')
        archive = ARTIFACTS / f'Jellyfin.Plugin.WatchGuard-v{VERSION}.zip'
        # Stored entries, fixed metadata and ordered names avoid timestamp/zlib variability.
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_STORED) as package:
            for name, content in [(DLL, runtime.read_bytes()), ('LICENSE', (ROOT / 'LICENSE').read_bytes())]:
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                package.writestr(info, content)
        # Integration tests load the exact packaged DLL, not another build output.
        output = ARTIFACTS / 'WatchGuard'
        if output.exists():
            shutil.rmtree(output)
        output.mkdir()
        with zipfile.ZipFile(archive) as package:
            assert package.namelist() == [DLL, 'LICENSE']
            (output / DLL).write_bytes(package.read(DLL))
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        archive.with_suffix('.zip.sha256').write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
        print(f'{digest}  {archive.name}')
        print('Runtime payload: one DLL; Web script embedded. LICENSE is non-runtime documentation.')


if __name__ == '__main__':
    main()
