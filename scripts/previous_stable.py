"""Download once: exact previous stable catalog entry, public assets and SHA-256."""
import json
import subprocess
import time
from pathlib import Path
from release_state import GitHub, candidate, public_package, require, digest, assets, Blocked
import catalog


def previous(manifest, version):
    number=lambda v: tuple(map(int,v.split('.')))
    entries=[v for p in manifest for v in p['versions'] if number(v['version']) < number(version+'.0')]
    require(bool(entries), 'No previous stable catalog entry. Define an explicit upgrade baseline before qualification.')
    return max(entries,key=lambda v:number(v['version']))


# One public attempt, then at most three anonymous API attempts per asset.
# public_package supplies one 120-second deadline for BOTH assets and routes.
API_ATTEMPTS = 3


def download_once(url, path, *, deadline, api=False):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError('Previous-stable download budget exhausted.')
    limit = min(catalog.ATTEMPT_TIMEOUT, remaining)
    command = ['curl', '--disable', '--fail', '--silent', '--show-error', '--location',
               '--connect-timeout', str(min(catalog.CONNECT_TIMEOUT, limit)),
               '--max-time', str(limit), '--write-out', '%{http_code}', '--output', str(path)]
    if api:
        command += ['--header', 'Accept: application/octet-stream']
    # No gh/token/cookies or curl configuration, including on redirected requests.
    result = subprocess.run(command + [url], stdout=subprocess.PIPE, text=True,
                            timeout=limit, check=False)
    if result.returncode:
        raise subprocess.CalledProcessError(result.returncode, command + [url], output=result.stdout)


def transient(error):
    if isinstance(error, subprocess.TimeoutExpired):
        return True
    if isinstance(error, subprocess.CalledProcessError):
        return (error.returncode in catalog.RETRY_CURL or
                (error.returncode == 22 and str(error.output).strip() in
                 {str(status) for status in catalog.RETRY_HTTP}))
    return False


def previous_download(api, release, version):
    """Resolve both routes from one verified public release, before any transfer."""
    require(release and release.get('draft') is False and release.get('prerelease') is False
            and release.get('tag_name') == 'v' + version and release.get('published_at')
            and type(release.get('id')) is int and release['id'] > 0,
            'Previous stable release identity is invalid or not public.')
    routes, ids = {}, set()
    for asset in assets(release, version).values():
        asset_id = asset.get('id')
        require(type(asset_id) is int and asset_id > 0 and asset_id not in ids,
                'Previous stable asset ID is missing or duplicated.')
        ids.add(asset_id)
        public_url = f'https://github.com/{api.repo}/releases/download/v{version}/' + asset['name']
        api_url = f'https://api.github.com/repos/{api.repo}/releases/assets/{asset_id}'
        require(asset.get('browser_download_url') == public_url and asset.get('url') == api_url,
                'Previous stable asset repository/identity differs.')
        routes[public_url] = api_url

    def download(url, path, *, deadline):
        require(url in routes, 'Previous stable asset is outside the verified release.')
        try:
            download_once(url, path, deadline=deadline)
            return
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            if not transient(error):
                raise
        print('Previous stable public download unavailable; using anonymous asset API: ' + path.name)
        for attempt in range(API_ATTEMPTS):
            try:
                download_once(routes[url], path, deadline=deadline, api=True)
                return
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
                if not transient(error) or attempt + 1 == API_ATTEMPTS:
                    raise Blocked('Previous stable download failed on public and API routes: ' + path.name) from error
                delay = 2 ** (attempt + 1)
                if deadline - time.monotonic() <= delay:
                    raise TimeoutError('Previous-stable download budget exhausted.') from error
                time.sleep(delay)
    return download


def retrieve(api, manifest, candidate_version, folder):
    catalog.validate(manifest)
    entry = previous(manifest, candidate_version)
    version = entry['version'].removesuffix('.0')
    # Never leave an earlier success record after a failed revalidation.
    (folder / 'identity.json').unlink(missing_ok=True)
    release = api.release(version, public_only=True)
    download = previous_download(api, release, version)
    archive = public_package(api, release, version, folder, download=download)
    expected = catalog.entry(archive, entry['sourceUrl'], release['published_at'], version + '.0')
    require(catalog.installation(entry) == catalog.installation(expected),
            'Previous stable catalog metadata differs from public release.')
    identity = dict(version=version, filename=archive.name, sha256=digest(archive.read_bytes()),
                    releaseId=release['id'], catalog=entry)
    (folder / 'identity.json').write_text(json.dumps(identity, indent=2) + '\n')
    return identity


def main():
    retrieve(GitHub('MajorSchloch/jellyfin-plugin-watchguard'),
             json.loads(Path('manifest.json').read_text()), candidate(), Path('artifacts/previous-stable'))


if __name__ == '__main__':
    main()
