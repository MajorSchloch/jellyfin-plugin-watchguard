"""HTTP contract against a disposable fixture only."""
import urllib.request,urllib.error,json

def run(base,token):
    assert base.startswith('http://127.0.0.1:')
    def get(path,method='GET',headers=None):
        try:
            with urllib.request.urlopen(urllib.request.Request(base+path,method=method,headers=headers or {})) as r:return r.status,r.headers,r.read()
        except urllib.error.HTTPError as r:return r.code,r.headers,r.read()
    status,headers,html=get('/web/index.html',headers={'Accept-Encoding':'gzip, br','If-None-Match':'"old"','If-Modified-Since':'Wed, 21 Oct 2030 07:28:00 GMT','Range':'bytes=0-10'})
    assert status==200 and html.count(b'id="watchguard-standalone-loader"')==1
    assert headers.get('Content-Encoding') is None and headers.get('ETag') is None and headers.get('Cache-Control')=='no-store'
    assert int(headers['Content-Length'])==len(html)
    assert token.encode() not in html
    status,headers,body=get('/web/index.html','HEAD');assert status==200 and not body and headers.get('ETag') is None
    status,headers,body=get('/WatchGuard/Standalone/script.js');assert status==401 and 'no-store' in headers.get('Cache-Control','')
    auth={'Authorization':'MediaBrowser Token="'+token+'"'}
    status,headers,body=get('/WatchGuard/Standalone/script.js',headers=auth)
    assert status==200 and b'WatchGuard: This item may still be in use.' in body and token.encode() not in body
    assert 'no-store' in headers.get('Cache-Control','') and 'Authorization' in headers.get('Vary','')
    assert get('/WatchGuard/Standalone/script.js',headers={'Authorization':'MediaBrowser Token="invalid"'})[0]==401
    assert b'watchguard-standalone-loader' not in get('/System/Info/Public')[2]
    assert get('/web/does-not-exist.html')[0]==404
    assert get('/WatchGuard/Standalone/bootstrap.js')[0]==200
    status,headers,asset=get('/web/config.json')
    assert status==200 and headers.get('ETag')
    assert get('/web/config.json',headers={'If-None-Match':headers['ETag']})[0]==304
    status,headers,partial=get('/web/config.json',headers={'Range':'bytes=0-3'})
    assert status==206 and partial==asset[:4] and headers.get('Content-Range','').startswith('bytes 0-3/')
    print('Standalone HTTP: index, HEAD, compression negotiation, validators, ranges, authentication and no-store passed.',flush=True)
