import json, wave, subprocess, numpy as np, os
V='/tmp/claude-0/-home-user-careconnect-mk/bbb24e3a-4b8a-53cc-a42c-4dcbe7e661e1/scratchpad/vo'
SR=48000; VIDEO=375.27; GAP=0.12; CAP=1.12
segs=json.load(open(V+'/segments.json'))
gens=json.load(open(V+'/work/gens.json'))
os.makedirs(V+'/work/fit',exist_ok=True)
def rd(p):
    w=wave.open(p); x=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float32)/32768; return x
def wr(p,x):
    w=wave.open(p,'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.clip(x,-1,1)*32767).astype(np.int16).tobytes()); w.close()
def compress_pauses(x, thr_db=-40, minp=0.30, keep=0.25):
    hop=int(0.01*SR); n=len(x)//hop
    rms=np.sqrt(np.mean(x[:n*hop].reshape(n,hop)**2,axis=1)+1e-12)
    sil=20*np.log10(rms)<thr_db
    runs=[];i=0
    while i<n:
        if sil[i]:
            j=i
            while j<n and sil[j]: j+=1
            if (j-i)*0.01>=minp and i>0 and j<n: runs.append((i*hop,j*hop))
            i=j
        else: i+=1
    out=[];pos=0;saved=0;f=int(0.005*SR)
    for a,b in runs:
        L=b-a; k=int(keep*SR); h=k//2
        out.append(x[pos:a+h].copy()); 
        tail=x[b-(k-h):b].copy()
        out[-1][-f:]*=np.linspace(1,0,f); tail[:f]*=np.linspace(0,1,f)
        out.append(tail); pos=b; saved+=L-k
    out.append(x[pos:])
    return np.concatenate(out), saved/SR, len(runs)
rows=[]; prev_end=-1.0
for idx,s in enumerate(segs):
    i=s['i']; st=float(s['start'])
    nxt=float(segs[idx+1]['start']) if idx+1<len(segs) else None
    avail=(nxt-st-GAP) if nxt is not None else (VIDEO-st-0.3)
    x=rd(f"{V}/work/trim/{i:03d}.wav"); d0=len(x)/SR
    flags=[]; comp=0.0
    if d0>avail:
        x2,saved,nr=compress_pauses(x)
        if len(x2)/SR/CAP>avail:
            x3,saved3,nr3=compress_pauses(x,minp=0.22,keep=0.18)
            if saved3>saved: x2,saved,nr=x3,saved3,nr3
        if saved>0: x=x2; comp=saved; flags.append(f"pauses-shortened({nr},-{saved:.2f}s)")
    d1=len(x)/SR
    tempo=1.0
    if d1>avail: tempo=min(d1/avail,CAP)
    p_in=f"{V}/work/fit/{i:03d}_pre.wav"; p_out=f"{V}/work/fit/{i:03d}.wav"
    wr(p_in,x)
    af=f"atempo={tempo:.4f}" if tempo>1.0 else "anull"
    subprocess.run(['ffmpeg','-nostdin','-loglevel','error','-y','-i',p_in,'-af',af,'-ar',str(SR),'-ac','1','-c:a','pcm_s16le',p_out],check=True)
    os.remove(p_in)
    d2=len(rd(p_out))/SR
    fs=max(st, prev_end+0.10)  # never overlap previous line
    if fs>st+1e-6: flags.append(f"delayed+{fs-st:.2f}s(prev ran over)")
    limit=(nxt-GAP) if nxt is not None else VIDEO-0.3
    if fs+d2>limit:
        early=max(st-0.4, prev_end+0.10)
        if early<fs: 
            fs=early; flags.append(f"started {st-fs:.2f}s early")
    if fs+d2>limit+1e-6:
        flags.append(f"OVERRUN {fs+d2-limit:.2f}s into next slot")
    end=fs+d2; prev_end=end
    rows.append(dict(i=i,start=st,slot=s['slot'],available=round(avail,3),raw_duration=round(gens.get(str(i),{}).get('duration_secs',4.28),2),
        trimmed=round(d0,3),pause_saved=round(comp,3),tempo=round(tempo,4),duration=round(d2,3),final_start=round(fs,3),end=round(end,3),
        regenerated=False,flags=flags,text=s['text']))
json.dump(rows,open(V+'/work/clips.json','w'),indent=1,ensure_ascii=False)
for r in rows: print(r['i'],r['start'],r['available'],r['trimmed'],r['tempo'],r['duration'],r['final_start'],r['end'],r['flags'])
