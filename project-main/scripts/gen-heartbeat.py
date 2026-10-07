# Membuat public/sfx/heartbeat.wav (lub-dub pelan, prosedural, tanpa dependency). Jalankan: python3 scripts/gen-heartbeat.py
import wave, struct, math, os
SR = 22050
def thump(n, f0, dec):
    return [math.sin(2*math.pi*(f0*(1-0.35*i/n))*i/SR)*math.exp(-i/(SR*dec)) for i in range(n)]
total = int(SR*0.7); buf = [0.0]*total
for start, amp in ((0, 1.0), (int(SR*0.26), 0.7)):
    t = thump(int(SR*0.22), 58, 0.05)
    for i, v in enumerate(t): buf[start+i] += v*amp
m = max(abs(x) for x in buf) or 1
out = os.path.join(os.path.dirname(__file__), '..', 'public', 'sfx', 'heartbeat.wav')
with wave.open(out, 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(b''.join(struct.pack('<h', int(x/m*0.8*32767)) for x in buf))
