import json,sys,subprocess,os
V='/tmp/claude-0/-home-user-careconnect-mk/bbb24e3a-4b8a-53cc-a42c-4dcbe7e661e1/scratchpad/vo'
segs=json.load(open(V+'/segments.json'))
bytext={s['text'].strip():s['i'] for s in segs}
gm=V+'/work/gens.json'
gens=json.load(open(gm)) if os.path.exists(gm) else {}
for f in sys.argv[1:]:
    d=json.load(open(f))
    for g in d['generations']:
        p=g['prompt'].strip()
        i=bytext.get(p)
        if i is None:
            print('NO MATCH',p[:60]); continue
        if g['status']!='completed': print('status',i,g['status']); continue
        out=f"{V}/clips/{i:03d}.mp3"
        r=subprocess.run(['curl','-sS','-o',out,g['content_url']])
        gens[str(i)]={'id':g['id'],'duration_secs':g['duration_secs'],'price':g.get('price'),'chars':len(p),'ok':r.returncode==0}
        print(i,g['duration_secs'],r.returncode,os.path.getsize(out))
json.dump(gens,open(gm,'w'),indent=1)
