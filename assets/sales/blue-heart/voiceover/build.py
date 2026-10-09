import json,re,subprocess,sys,os
S=sys.argv[1]; V=S+'/vo'; F=V+'/fast'
def dur(f): return float(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f],capture_output=True,text=True).stdout)
srt=open(S+'/video-send/AppStackX-Reports-demo-Blue-Heart-Clinics.srt').read()
caps=[]
for b in re.split(r'\n\s*\n',srt.strip()):
    L=b.splitlines(); m=re.match(r'(\d+):(\d+):(\d+),(\d+)',L[1]); caps.append(int(m[1])*3600+int(m[2])*60+int(m[3])+int(m[4])/1000)
segs=json.load(open(V+'/segments.json')); segs.sort(key=lambda s:s['start'])
assert len(segs)==48, len(segs)
for k,s in enumerate(segs):
    c=[x for x in caps if s['start']-0.05<=x<s['start']+1.0]; s['cap']=c[0] if c else s['start']
    s['src']= f"{V}/clips/{k:03d}.mp3" if k<30 else (f"{V}/clips/line30-short.mp3" if k==30 else f"{V}/clips/{k-1:03d}.mp3")
END=375.27; prev_end=0; out=[]
for k,s in enumerate(segs):
    nxt = segs[k+1]['cap'] if k+1<len(segs) else END
    avail = nxt - s['cap'] - (0.12 if k+1<len(segs) else 0.3)
    base=f"{F}/proc/{k:03d}"
    # trim lead/tail silence, cap internal pauses at ~0.3 s
    af="silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06,areverse"
    if True: af+=",silenceremove=stop_periods=-1:stop_duration=0.35:stop_threshold=-45dB:stop_silence=0.28"
    subprocess.run(['ffmpeg','-v','error','-y','-i',s['src'],'-ac','1','-ar','48000','-af',af,base+'-a.wav'],check=True)
    d=dur(base+'-a.wav'); tempo=1.0
    if d>avail: tempo=min(d/avail,1.22)
    if tempo>1.001:
        subprocess.run(['ffmpeg','-v','error','-y','-i',base+'-a.wav','-af',f'atempo={tempo:.4f}',base+'-b.wav'],check=True)
    else: os.replace(base+'-a.wav',base+'-b.wav')
    d2=dur(base+'-b.wav'); start=s['cap']
    if start+d2 > nxt-0.08 and k+1<len(segs): start=max(s["cap"]-0.5, prev_end+0.08, start-(start+d2-(nxt-0.08)))
    if start < prev_end+0.08: start=prev_end+0.08
    end=start+d2; prev_end=end
    out.append({'k':k,'cap':round(s['cap'],2),'start':round(start,2),'dur':round(d2,2),'tempo':round(tempo,3),'avail':round(avail,2),'over_next':round(end-nxt,2),'text':s['text'][:60],'src':os.path.basename(s['src'])})
json.dump(out,open(F+'/placement.json','w'),indent=1)
# mix
args=['ffmpeg','-v','error','-y']
for o in out: args+=['-i',f"{F}/proc/{o['k']:03d}-b.wav"]
fl=';'.join(f"[{i}:a]adelay={int(o['start']*1000)}|{int(o['start']*1000)}[a{i}]" for i,o in enumerate(out))
fl+=';'+''.join(f'[a{i}]' for i in range(len(out)))+f"amix=inputs={len(out)}:normalize=0:dropout_transition=0,apad=whole_dur={END},atrim=0:{END},highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[m]"
args+=['-filter_complex',fl,'-map','[m]','-ac','1',F+'/narration.wav']
subprocess.run(args,check=True)
devs=[round(o['start']-o['cap'],2) for o in out]
print('lines',len(out),'max early',min(devs),'max late',max(devs),'max tempo',max(o['tempo'] for o in out),'overlaps',sum(1 for o in out if o['over_next']>-0.05))
print([ (o['k'],o['cap'],o['start'],o['tempo'],o['src']) for o in out if abs(o['start']-o['cap'])>0.15 or o['tempo']>1.12 or o['k'] in (29,30,31)])
