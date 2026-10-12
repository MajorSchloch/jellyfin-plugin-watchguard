"""Disposable loopback reverse proxy; preserves the Jellyfin BaseUrl and gzips HTML downstream."""
import gzip,http.client,http.server,threading
from urllib.parse import urlsplit

def start(target):
    parsed=urlsplit(target)
    assert parsed.hostname=='127.0.0.1'
    counts={'htmlGzip':0}
    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version='HTTP/1.1'
        def log_message(self,*args):pass
        def forward(self):
            connection=http.client.HTTPConnection(parsed.hostname,parsed.port,timeout=30)
            body=self.rfile.read(int(self.headers.get('Content-Length','0')))
            headers={k:v for k,v in self.headers.items() if k.lower() not in ['connection','host','transfer-encoding']}
            headers['Host']=self.headers.get('Host');headers['X-Forwarded-Proto']='http'
            connection.request(self.command,self.path,body or None,headers)
            response=connection.getresponse();data=response.read();result=dict(response.getheaders())
            if self.command=='GET' and 'text/html' in response.getheader('Content-Type','') and 'gzip' in self.headers.get('Accept-Encoding','') and not response.getheader('Content-Encoding'):
                data=gzip.compress(data);result['Content-Encoding']='gzip';counts['htmlGzip']+=1
            self.send_response(response.status)
            for k,v in result.items():
                if k.lower() not in ['content-length','connection','transfer-encoding']:self.send_header(k,v)
            self.send_header('Content-Length',str(len(data)));self.end_headers()
            if self.command!='HEAD':self.wfile.write(data)
            connection.close()
        do_GET=do_POST=do_PUT=do_DELETE=do_HEAD=do_OPTIONS=forward
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    return server,thread,'http://127.0.0.1:'+str(server.server_port),counts
