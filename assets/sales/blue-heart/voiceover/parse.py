# Parse narration-script.md (incl. lines marked with the warning sign) and attach the real SRT cue start to each line.
import json,re,shutil,os
V='/tmp/claude-0/-home-user-careconnect-mk/bbb24e3a-4b8a-53cc-a42c-4dcbe7e661e1/scratchpad/vo'
md=open(V+'/../video-send/narration-script.md',encoding='utf-8').read().split('## Script',1)[1]
pat=re.compile(r'^\*\*(\d+):(\d\d) – (\d+):(\d\d)\*\*\s*(⚠)?\s*\(([\d.]+) s\)\s*(\*\([^)]*\)\*)?\s*\n(.+?)\s*$',re.M)
lines=[]
for m in pat.finditer(md):
    st=int(m[1])*60+int(m[2]); en=int(m[3])*60+int(m[4])
    lines.append(dict(start=float(st),end=float(en),slot=float(m[6]),note=(m[7] or '')+(' ⚠ tight' if m[5] else ''),text=m[8].strip()))
nhdr=len(re.findall(r'^\*\*\d+:\d\d – ',md,re.M))
assert len(lines)==nhdr,(len(lines),nhdr)
srt=open(V+'/../video-send/AppStackX-Reports-demo-Blue-Heart-Clinics.srt',encoding='utf-8').read()
f=lambda x:int(x[:2])*3600+int(x[3:5])*60+float(x[6:].replace(',','.'))
cues=[(f(a),f(b)) for a,b in re.findall(r'(\d\d:\d\d:\d\d,\d+) --> (\d\d:\d\d:\d\d,\d+)',srt)]
old=json.load(open(V+'/segments.json')) if not os.path.exists(V+'/work/segments47.orig.json') else json.load(open(V+'/work/segments47.orig.json'))
oldby={s['text']:s['i'] for s in old}
for k,l in enumerate(lines):
    c=[a for a,b in cues if l['start']-1e-6<=a<l['start']+1.0]
    assert c,(k,l)
    l['i']=k; l['cue_start']=round(min(c),3); l['old_i']=oldby.get(l['text'])
    l['clip']=f"{l['old_i']:03d}" if l['old_i'] is not None else 'new-226'
print(len(lines),'lines;',sum(l['old_i'] is None for l in lines),'not in old segments.json:',[l['text'] for l in lines if l['old_i'] is None])
if not os.path.exists(V+'/work/segments47.orig.json'): shutil.copy(V+'/segments.json',V+'/work/segments47.orig.json')
json.dump([{k:l[k] for k in ['i','start','end','slot','note','text','cue_start','old_i','clip']} for l in lines],open(V+'/segments.json','w'),indent=1,ensure_ascii=False)
for l in lines: print(l['i'],l['old_i'],l['start'],l['cue_start'],l['slot'],l['note'])
