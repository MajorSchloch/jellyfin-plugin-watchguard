"""Disposable native Caddy HTTPS/root-path proxy. No production configuration access."""
import base64, gzip, hashlib, json, os, socket, ssl, subprocess, time, urllib.request
from urllib.parse import urlparse
from pathlib import Path

IMAGE = 'caddy:2@sha256:f2a1290d0463aad60660d4ec134943f183ee2a5f6c3eb7bf32dd984f2f020772'

class Caddy:
    def __init__(self, docker, jellyfin, root):
        self.docker, self.jellyfin = docker, jellyfin
        self.name = jellyfin + '-caddy'
        self.network = self.name + '-net'
        self.ca = root/'caddy-root.crt'
        (root/'Caddyfile').write_text('https://localhost {\n tls internal\n encode zstd gzip\n reverse_proxy '+jellyfin+':8096\n}\n')
        docker('network','create',self.network)
        try:
            docker('network','connect',self.network,jellyfin)
            docker('run','-d','--name',self.name,'--network',self.network,'-p','127.0.0.1::443',
                   '-v',str(root/'Caddyfile')+':/etc/caddy/Caddyfile:ro',IMAGE)
            self.base='https://localhost:'+docker('port',self.name,'443/tcp').split(':')[-1]
            for attempt in range(30):
                try:
                    docker('cp',self.name+':/data/caddy/pki/authorities/local/root.crt',str(self.ca))
                    self.ssl=ssl.create_default_context(cafile=str(self.ca))
                    self.get('/System/Info/Public');break
                except Exception:
                    if attempt==29:raise
                    time.sleep(1)
            print('Caddy verified: '+docker('exec',self.name,'caddy','version')+' '+IMAGE,flush=True)
        except BaseException:
            self.close();raise
    def get(self,path,headers=None,method='GET'):
        with urllib.request.urlopen(urllib.request.Request(self.base+path,headers=headers or {},method=method),context=self.ssl,timeout=15) as response:
            return response.status,response.headers,response.read()
    def verify(self,token):
        report={'image':IMAGE,'httpsTrustedTestCA':True,'rootPath':True,'compression':[]}
        for encoding in ['identity','gzip','zstd']:
            status,headers,body=self.get('/web/index.html',{'Accept-Encoding':encoding,'If-None-Match':'"stale"','If-Modified-Since':'Wed, 21 Oct 2030 07:28:00 GMT','Range':'bytes=0-10'})
            assert status==200 and headers.get('Cache-Control')=='no-store' and not headers.get('ETag')
            if encoding=='gzip':assert headers.get('Content-Encoding')=='gzip';body=gzip.decompress(body)
            elif encoding=='zstd':
                assert headers.get('Content-Encoding')=='zstd'
                body=subprocess.check_output(['zstd','--decompress','--stdout','--quiet'],input=body)
            else:assert not headers.get('Content-Encoding')
            assert body.count(b'id="watchguard-standalone-loader"')==1
            report['compression'].append(encoding)
        status,headers,body=self.get('/web/index.html',method='HEAD')
        assert status==200 and not body and not headers.get('ETag') and not headers.get('Last-Modified')
        status,headers,body=self.get('/WatchGuard/Standalone/script.js',{'Authorization':'MediaBrowser Token="'+token+'"'})
        assert status==200 and 'no-store' in headers.get('Cache-Control','')
        self.websocket(token)
        report['authenticatedWebSocketUpgradeAndPing'] = True
        report.update(conditionalHtml='200 fresh/no-store',head=True,authenticatedScriptNoStore=True)
        out=Path('artifacts/standalone');out.mkdir(parents=True,exist_ok=True)
        (out/'caddy-http.json').write_text(json.dumps(report,indent=2)+'\n')
        print('Caddy HTTPS: trusted local CA, gzip/zstd/identity, conditional/range HTML, HEAD and private no-store passed.',flush=True)
    def websocket(self, token):
        target=urlparse(self.base)
        key=base64.b64encode(os.urandom(16)).decode()
        # Native header authentication, never credentials in URL/logs. No legacy auth setting changes.
        with socket.create_connection((target.hostname,target.port),timeout=15) as tcp:
            with self.ssl.wrap_socket(tcp,server_hostname=target.hostname) as ws:
                request=('GET /socket HTTP/1.1\r\nHost: '+target.netloc+'\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: '+key+'\r\nAuthorization: MediaBrowser Token="'+token+'"\r\n\r\n')
                ws.sendall(request.encode())
                header=b''
                while not header.endswith(b'\r\n\r\n'):
                    part=ws.recv(1);assert part;header+=part;assert len(header)<8192
                assert header.startswith(b'HTTP/1.1 101 ')
                assert base64.b64encode(hashlib.sha1((key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()) in header
                for _ in range(3):
                    self.get('/web/index.html')
                    mask=os.urandom(4);payload=b'wg';ws.sendall(bytes([0x89,0x82])+mask+bytes(b^mask[i%4] for i,b in enumerate(payload)))
                    def read(count):
                        data=b''
                        while len(data)<count:
                            part=ws.recv(count-len(data));assert part;data+=part
                        return data
                    for frame in range(20):
                        first,second=read(2);length=second&127
                        if length==126:length=int.from_bytes(read(2),'big')
                        if length==127:length=int.from_bytes(read(8),'big')
                        assert length<1024*1024 and not second&128
                        data=read(length)
                        if first&15==10:assert data==payload;break
                        assert first&15!=8
                    else:raise AssertionError('No WebSocket pong')
                ws.sendall(bytes([0x88,0x80])+os.urandom(4))
        print('Caddy WebSocket: authenticated 101, persistent connection and three ping/pong exchanges during HTML requests passed.',flush=True)
    def close(self):
        subprocess.run(['docker','rm','-f',self.name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=False)
        subprocess.run(['docker','network','disconnect',self.network,self.jellyfin],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=False)
        subprocess.run(['docker','network','rm',self.network],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=False)
