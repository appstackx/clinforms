# Fit each line (pause shortening + tempo <=1.12) to its real SRT cue slot, then place all lines with a DP
# that keeps every start within [cue-0.5, cue+0.5] (preferring cue+0.05), with >=0.10 s gap between lines.
# Lines in tight runs (placed >0.2 s off target) are fitted tighter (still <=1.12x) and the DP is re-run.
import json, wave, subprocess, os, numpy as np
V='/tmp/claude-0/-home-user-careconnect-mk/bbb24e3a-4b8a-53cc-a42c-4dcbe7e661e1/scratchpad/vo'
SR=48000; VIDEO=375.27; GAP=0.12; MINGAP=0.10; CAP=1.12; TARGET=0.05; LO=-0.50; HI=0.50; STEP=0.01
FADE_IN=0.005; FADE_OUT=0.020
segs=json.load(open(V+'/segments.json')); gens=json.load(open(V+'/work/gens.json'))
EXTRA_TRIM={'019':0.015}   # line 19 had a 5 ms burst right at its end
os.makedirs(V+'/work/fit',exist_ok=True)
def rd(p):
    w=wave.open(p); return np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float32)/32768
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
        out.append(x[pos:a+h].copy())
        tail=x[b-(k-h):b].copy()
        out[-1][-f:]*=np.linspace(1,0,f); tail[:f]*=np.linspace(0,1,f)
        out.append(tail); pos=b; saved+=L-k
    out.append(x[pos:])
    return np.concatenate(out), saved/SR, len(runs)
N=len(segs); cue=[s['cue_start'] for s in segs]
SRC={k:rd(f"{V}/work/trim/{s['clip']}.wav") for k,s in enumerate(segs)}
for k,s in enumerate(segs):
    if s['clip'] in EXTRA_TRIM: SRC[k]=SRC[k][:-int(EXTRA_TRIM[s['clip']]*SR)]
def plan(k,tight):
    """Return (x, d0, saved, nruns, mode, tempo, final_duration_estimate)."""
    avail=((cue[k+1]-cue[k]-GAP) if k+1<N else (VIDEO-cue[k]-0.3))-tight
    x=SRC[k]; d0=len(x)/SR; comp=0.0; nr=0; mode=''
    if d0>avail:
        x2,saved,nr=compress_pauses(x); mode='0.25'
        if len(x2)/SR/CAP>avail:
            x3,saved3,nr3=compress_pauses(x,minp=0.22,keep=0.18)
            if saved3>saved: x2,saved,nr,mode=x3,saved3,nr3,'0.18'
        if tight>0 and len(x2)/SR/CAP>avail:   # tight runs only: pauses >=0.20 s down to 0.15 s
            x4,saved4,nr4=compress_pauses(x,minp=0.20,keep=0.15)
            if saved4>saved: x2,saved,nr,mode=x4,saved4,nr4,'0.15'
        if saved>0: x=x2; comp=saved
    d1=len(x)/SR; tempo=min(d1/avail,CAP) if d1>avail else 1.0
    key=(k,round(tight,2))
    if key not in CACHE:
        p_in=f"{V}/work/fit/{k:03d}_pre.wav"; p_out=f"{V}/work/fit/{k:03d}_t.wav"
        wr(p_in,x)
        af=f"atempo={tempo:.4f}" if tempo>1.0 else "anull"
        subprocess.run(['ffmpeg','-nostdin','-loglevel','error','-y','-i',p_in,'-af',af,'-ar',str(SR),'-ac','1','-c:a','pcm_s16le',p_out],check=True)
        y=rd(p_out).copy(); os.remove(p_in); os.remove(p_out)
        fi=int(FADE_IN*SR); fo=int(FADE_OUT*SR); y[:fi]*=np.linspace(0,1,fi); y[-fo:]*=np.linspace(1,0,fo)
        CACHE[key]=y
    y=CACHE[key]
    return dict(y=y,d0=d0,comp=comp,nr=nr,mode=mode,tempo=tempo,d=len(y)/SR,avail=avail+tight,tight=tight)
CACHE={}
offs=np.round(np.arange(LO,HI+1e-9,STEP),2)
def cost(o):
    e=o-TARGET
    if o<0: return 12*e*e+0.5*(-o)        # leading the caption is worst
    if o>0.2: return 3*e*e
    return e*e
def place(P):
    INF=1e18; best=[np.full(len(offs),INF) for _ in range(N)]; back=[np.zeros(len(offs),int) for _ in range(N)]
    for j,o in enumerate(offs):
        if cue[0]+o>=0: best[0][j]=cost(o)
    for k in range(1,N):
        prev_end=cue[k-1]+offs+P[k-1]['d']+MINGAP
        for j,o in enumerate(offs):
            ok=(prev_end<=cue[k]+o+1e-9)&(best[k-1]<INF)
            if ok.any():
                i=int(np.argmin(np.where(ok,best[k-1],INF))); best[k][j]=best[k-1][i]+cost(o); back[k][j]=i
    last=[j for j,o in enumerate(offs) if best[N-1][j]<INF and cue[N-1]+o+P[N-1]['d']<=VIDEO-0.05]
    if not last: return None
    j=min(last,key=lambda j:best[N-1][j]); pos=[0.0]*N
    for k in range(N-1,-1,-1): pos[k]=float(offs[j]); j=back[k][j]
    return pos
TIGHT={}
for it in range(8):
    P=[plan(k,TIGHT.get(k,0.0)) for k in range(N)]
    pos=place(P)
    assert pos is not None,'infeasible'
    bad=[k for k in range(N) if abs(pos[k]-TARGET)>0.15]
    changed=False
    for k in bad:
        for m in (k-1,k):   # tighten the line itself and the one before it (the one pushing it)
            if m>=0 and TIGHT.get(m,0)<0.6 and (P[m]['tempo']<CAP-1e-4 or P[m]['mode']!='0.15') and P[m]['d']>P[m]['avail']-0.6:
                TIGHT[m]=TIGHT.get(m,0.0)+0.15; changed=True
    print('iter',it,'off-target lines',[(k,pos[k]) for k in bad],'tight',TIGHT)
    if not changed: break
# with the final fits, narrow the allowed window as far as it stays feasible
for w in (0.45,0.40,0.35,0.30):
    offs=np.round(np.arange(-w,w+1e-9,STEP),2); p2=place(P)
    if p2 is None: break
    pos=p2; print('window +/-',w,'feasible')
rows=[]
for k,s in enumerate(segs):
    f=P[k]; y=f['y']; wr(f"{V}/work/fit/{k:03d}.wav",y)
    d=len(y)/SR; fs=round(cue[k]+pos[k],3); end=fs+d
    flags=[]
    if f['comp']>0: flags.append(f"pauses-shortened({f['nr']} to {f['mode']}s,-{f['comp']:.2f}s)")
    if f['tempo']>1: flags.append(f"tempo {f['tempo']:.3f}"+(" (cap)" if f['tempo']>=CAP-1e-4 else ''))
    if f['tight']>0: flags.append(f"fitted {f['tight']:.2f}s tighter (tight run)")
    if pos[k]<0: flags.append(f"starts {-pos[k]:.2f}s before caption")
    if pos[k]>0.2: flags.append(f"starts {pos[k]:.2f}s after caption")
    if k+1<N and end>cue[k+1]: flags.append(f"runs {end-cue[k+1]:.2f}s into next caption")
    g=gens.get(str(s['old_i']) if s['old_i'] is not None else 'new-226') or {}
    rows.append(dict(i=k,old_i=s['old_i'],clip=s['clip'],script_start=s['start'],cue_start=cue[k],slot=s['slot'],available=round(f['avail'],3),
        raw_duration=g.get('duration_secs',4.28),trimmed=round(f['d0'],3),pause_saved=round(f['comp'],3),tempo=round(f['tempo'],4),
        duration=round(d,3),final_start=fs,end=round(end,3),offset_vs_cue=round(pos[k],2),regenerated=False,
        new_in_fix=s['old_i'] is None,flags=flags,text=s['text']))
for k in range(N-1): assert rows[k]['end']+MINGAP-1e-3<=rows[k+1]['final_start'],k
json.dump(rows,open(V+'/work/clips.json','w'),indent=1,ensure_ascii=False)
for r in rows: print(r['i'],r['old_i'],r['cue_start'],r['trimmed'],r['pause_saved'],r['tempo'],r['duration'],r['final_start'],r['end'],r['offset_vs_cue'],r['flags'])
