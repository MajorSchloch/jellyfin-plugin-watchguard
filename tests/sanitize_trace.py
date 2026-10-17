"""Retain Playwright actions/screenshots without network bodies or action parameters.
Raw traces stay outside artifact trees and must be removed by the caller.
"""
import json
import sys
import zipfile


def sanitize(source, target):
    with zipfile.ZipFile(source) as src, zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as dest:
        for name in src.namelist():
            if name.endswith('.trace'):
                lines=[]
                for line in src.read(name).splitlines():
                    event=json.loads(line)
                    # Network, console, log and DOM events may contain credentials.
                    if event.get('type') not in ('context-options','before','after','screencast-frame'):
                        continue
                    if event.get('type')=='before':
                        event={k:v for k,v in event.items() if k in ('type','callId','startTime','class','method','apiName','pageId','stepId','parentId')}
                        event['params']={}
                    if event.get('type')=='after':
                        event={k:v for k,v in event.items() if k in ('type','callId','endTime')}
                    if event.get('type')=='context-options':
                        event={k:v for k,v in event.items() if k in ('type','version','origin','browserName','platform','wallTime','monotonicTime')}
                    lines.append(json.dumps(event))
                dest.writestr(name,'\n'.join(lines)+'\n')
            elif name.startswith('resources/') and name.endswith(('.jpeg','.png')):
                dest.writestr(name,src.read(name))

if __name__=='__main__': sanitize(*sys.argv[1:])
