import json,wave,numpy as np
V='/tmp/claude-0/-home-user-careconnect-mk/bbb24e3a-4b8a-53cc-a42c-4dcbe7e661e1/scratchpad/vo'
SR=48000; N=int(round(375.27*SR))
buf=np.zeros(N,np.float32)
for r in json.load(open(V+'/work/clips.json')):
    w=wave.open(f"{V}/work/fit/{r['i']:03d}.wav"); x=np.frombuffer(w.readframes(w.getnframes()),np.int16).astype(np.float32)/32768
    a=int(round(r['final_start']*SR)); b=min(N,a+len(x)); buf[a:b]+=x[:b-a]
w=wave.open(V+'/work/raw_mix.wav','wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
w.writeframes((np.clip(buf,-1,1)*32767).astype(np.int16).tobytes()); w.close()
print(N/SR, np.abs(buf).max())
