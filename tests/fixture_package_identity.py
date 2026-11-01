"""Bind browser fixture evidence to the ZIP, deployed DLL and active native plugin."""
import hashlib
import json
from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET

PUBLISHED = json.loads(Path(__file__).with_name('published-v031-identity.json').read_text())
GUID = 'a3c6bc84783d4ba8a0db89bfb83ab486'
DLL = 'Jellyfin.Plugin.WatchGuard.dll'
CANDIDATE = ET.parse(Path(__file__).resolve().parents[1]/'Directory.Build.props').findtext('./PropertyGroup/Version')


def verify(archive, deployed_sha256, plugins, reported_version, expected_version):
    assert expected_version in (CANDIDATE, PUBLISHED['version']), 'Unknown package version'
    archive = Path(archive)
    package_sha256 = hashlib.sha256(archive.read_bytes()).hexdigest()
    with zipfile.ZipFile(archive) as package:
        assert package.namelist().count(DLL) == 1, 'Ambiguous packaged runtime'
        dll_sha256 = hashlib.sha256(package.read(DLL)).hexdigest()
    assert deployed_sha256 == dll_sha256, 'Deployed DLL differs from the package'
    active = [p for p in plugins if p['Id'].replace('-', '').lower() == GUID and p['Status'] == 'Active']
    assert len(active) == 1, 'Expected exactly one active WatchGuard plugin'
    assert active[0]['Version'] == expected_version + '.0', 'Active plugin version differs'
    assert reported_version == expected_version, 'Integration status version differs'
    if expected_version == PUBLISHED['version']:
        assert package_sha256 == PUBLISHED['packageSha256'], 'Unknown historical ZIP'
        assert dll_sha256 == PUBLISHED['dllSha256'], 'Unknown historical DLL'
    return {'version': expected_version, 'packageSha256': package_sha256,
            'dllSha256': dll_sha256, 'deployedDllSha256': deployed_sha256,
            'activeVersion': active[0]['Version'], 'reportedVersion': reported_version}
