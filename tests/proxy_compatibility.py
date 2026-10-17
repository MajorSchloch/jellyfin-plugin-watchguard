"""Optional real reverse-proxy matrix inside an owned enforcement fixture.
Caddy terminates test-CA HTTPS; each actual proxy forwards to native HTTP.
No production URL, mutable volume, Docker socket or raw credential logs.
"""
import json, subprocess, urllib.request, urllib.error
NGINX='nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236'
TRAEFIK='traefik:v3.6@sha256:31267173a15b4944e797a76ffd9c419707c8d8b32fe5b610f80cd0cfa05f372d'

def qualify(docker,jellyfin,root,caddy,token,movies,native,preserved,output):
    report=[];original=(root/'Caddyfile').read_text()
    def request(path,method='POST',body=None,headers=None,status=200,timeout=120):
        values={'Authorization':'MediaBrowser Token="'+token+'"','Origin':caddy.base,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json',**(headers or {})}
        req=urllib.request.Request(caddy.base+path,method=method,data=json.dumps(body or {}).encode() if method=='POST' else None,headers={k:v for k,v in values.items() if v is not None})
        try:
            with urllib.request.urlopen(req,context=caddy.ssl,timeout=timeout) as response:code,payload=response.status,response.read()
        except urllib.error.HTTPError as error:code,payload=error.code,error.read()
        assert code==status,(path.split('?')[0],code,status)
        return json.loads(payload) if payload else None
    for profile,title in [('nginx','ProxyNginx'),('traefik','ProxyTraefik'),('tunnel','ProxyTunnel')]:
        name=jellyfin+'-'+profile;target=movies[title];item='/Items/'+target['Id'];api='/WatchGuard/ServerApproval/'
        try:
            if profile=='traefik':
                config=root/'traefik.yml'
                config.write_text('http:\n  routers:\n    fixture:\n      rule: PathPrefix(`/`)\n      service: jellyfin\n  services:\n    jellyfin:\n      loadBalancer:\n        passHostHeader: true\n        servers:\n          - url: http://'+jellyfin+':8096\n')
                docker('run','-d','--name',name,'--network',caddy.network,'-v',str(config)+':/etc/traefik/dynamic.yml:ro',TRAEFIK,'--entrypoints.web.address=:8080','--providers.file.filename=/etc/traefik/dynamic.yml')
            else:
                config=root/(profile+'.conf')
                # Tunnel-style intermediary adds forwarded origin metadata; Jellyfin
                # has no KnownProxies and WatchGuard must not read those headers.
                forwarding='proxy_set_header X-Forwarded-Host ignored.invalid; proxy_set_header X-Forwarded-Proto http;' if profile=='tunnel' else ''
                config.write_text('events {} http { server { listen 8080; location / { proxy_pass http://'+jellyfin+':8096; proxy_set_header Host $http_host; '+forwarding+' } } }')
                docker('run','-d','--name',name,'--network',caddy.network,'-v',str(config)+':/etc/nginx/nginx.conf:ro',NGINX)
            (root/'Caddyfile').write_text(original.replace(jellyfin+':8096',name+':8080'))
            docker('exec',caddy.name,'caddy','reload','--config','/etc/caddy/Caddyfile')
            from fixture_inventory import wait_ready
            wait_ready(lambda timeout:request(api+'Readiness',timeout=timeout))
            ready=request(api+'Readiness');assert ready['ApprovalRequestsReady'] and ready['OriginStatus']=='HttpsProxySameOrigin'
            # Each veto checks both native record and disposable file, and no continuation.
            for bad in [{'Origin':'https://evil.invalid'}, {'Sec-Fetch-Site':'cross-site'}, {'Sec-Fetch-Site':'same-site'}, {'Sec-Fetch-Site':''}, {'Sec-Fetch-Site':None}]:
                before=docker('logs',jellyfin).count('guard outcome=ContinueNative')
                request(item,'DELETE',headers=bad,status=403);preserved([target])
                assert docker('logs',jellyfin).count('guard outcome=ContinueNative')==before
            request(item,'DELETE',status=409);preserved([target])
            created=request(api+'Prepare',body={'Action':'DeleteItem','Targets':[target['Id']]});assert created['State']=='Created';preserved([target])
            challenge=created['ChallengeId']
            for action,expected in [('Present','Presented'),('Approve','Approved')]:
                assert request(api+action,body={'ChallengeId':challenge,'Decision':'Approve'})['State']==expected
                preserved([target])
            before=docker('logs',jellyfin).count('guard outcome=ContinueNative')
            request(item,'DELETE',headers={'X-WatchGuard-Approval':challenge},status=204)
            assert docker('logs',jellyfin).count('guard outcome=ContinueNative')==before+1
            native(item,expected=404);assert not (root/target['Path'].lstrip('/')).exists()
            request(item,'DELETE',headers={'X-WatchGuard-Approval':challenge},status=409)
            assert docker('logs',jellyfin).count('guard outcome=ContinueNative')==before+1
            report.append({'profile':profile,'image':TRAEFIK if profile=='traefik' else NGINX,'knownProxies':False,'readiness':ready,'vetoFilesAndRecordsPreserved':True,'states':['Created','Presented','Approved','Consumed'],'nativeContinuations':1,'replayRejected':True})
        finally:
            (root/'Caddyfile').write_text(original)
            docker('exec',caddy.name,'caddy','reload','--config','/etc/caddy/Caddyfile')
            docker('rm','-f',name)
    (output/'proxy-compatibility.json').write_text(json.dumps(report,indent=2)+'\n')
    return report

def direct_https(docker,jellyfin,root,token,target,native,ready,preserved,base_path):
    import ssl
    certificate=root/'config/fixture.crt';key=root/'config/fixture.key';pfx=root/'config/fixture.pfx'
    subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(certificate),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],check=True,capture_output=True,timeout=30)
    subprocess.run(['openssl','pkcs12','-export','-out',str(pfx),'-inkey',str(key),'-in',str(certificate),'-passout','pass:'],check=True,capture_output=True,timeout=30)
    network=native('/System/Configuration/network');network.update(EnableHttps=True,RequireHttps=False,InternalHttpsPort=8920,CertificatePath='/config/fixture.pfx',CertificatePassword='')
    native('/System/Configuration/network','POST',network,expected=204);docker('restart',jellyfin);ready()
    origin='https://localhost:'+docker('port',jellyfin,'8920/tcp').split(':')[-1];context=ssl.create_default_context(cafile=str(certificate))
    def request(path,method='POST',body=None,status=200,approval=None):
        headers={'Authorization':'MediaBrowser Token="'+token+'"','Origin':origin,'Content-Type':'application/json'}
        if approval:headers['X-WatchGuard-Approval']=approval
        req=urllib.request.Request(origin+base_path+path,method=method,data=json.dumps(body or {}).encode() if method=='POST' else None,headers=headers)
        try:
            with urllib.request.urlopen(req,context=context,timeout=120) as response:code,payload=response.status,response.read()
        except urllib.error.HTTPError as error:code,payload=error.code,error.read()
        assert code==status,(code,status)
        return json.loads(payload) if payload else None
    api='/WatchGuard/ServerApproval/';result=request(api+'Readiness');assert result['ApprovalRequestsReady'] and result['OriginStatus']=='SameOrigin'
    item='/Items/'+target['Id'];request(item,'DELETE',status=409);preserved([target])
    ticket=request(api+'Prepare',body={'Action':'DeleteItem','Targets':[target['Id']]});assert ticket['State']=='Created';preserved([target])
    for action,expected in [('Present','Presented'),('Approve','Approved')]:
        assert request(api+action,body={'ChallengeId':ticket['ChallengeId'],'Decision':'Approve'})['State']==expected
        preserved([target])
    before=docker('logs',jellyfin).count('guard outcome=ContinueNative')
    request(item,'DELETE',status=204,approval=ticket['ChallengeId'])
    assert docker('logs',jellyfin).count('guard outcome=ContinueNative')==before+1
    native(item,expected=404);assert not (root/target['Path'].lstrip('/')).exists()
    return {'result':'PASS','nativeTls':True,'trustedTestCertificate':True,'noFetchMetadataRequired':True,'vetoFilesAndRecordsPreserved':True,'nativeContinuations':1}
