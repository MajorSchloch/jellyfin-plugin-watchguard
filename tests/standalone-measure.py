"""Public index delivery timings; small local fixture measurements, not a production benchmark."""
import urllib.request,time,statistics,json
from pathlib import Path

def run(base,standalone):
    timings=[];lengths=[]
    for _ in range(10):
        start=time.perf_counter()
        with urllib.request.urlopen(base+'/web/index.html') as response:body=response.read()
        timings.append((time.perf_counter()-start)*1000);lengths.append(len(body))
    result={'mode':'standalone' if standalone else 'injector','samples':10,'medianIndexMs':round(statistics.median(timings),3),'maxIndexMs':round(max(timings),3),'indexBytes':lengths[-1]}
    output=Path('artifacts/standalone');output.mkdir(exist_ok=True)
    (output/('index-'+result['mode']+'.json')).write_text(json.dumps(result,indent=2)+'\n')
    print('Index measurement: '+json.dumps(result),flush=True)
