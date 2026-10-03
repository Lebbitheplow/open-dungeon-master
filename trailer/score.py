"""Original, deterministic 120 BPM fantasy-adventure score and editorial effects.

All instruments are synthesized here; no downloaded music or samples.
python trailer/score.py
"""
from pathlib import Path
import numpy as np
from scipy.signal import butter, sosfilt
from scipy.io.wavfile import write

SR = 48000
DURATION = 64
rng = np.random.default_rng(20261002)
mix = np.zeros((SR * DURATION, 2), np.float32)

def add(sound, at, gain=1, pan=0):
    start = round(at * SR)
    end = min(len(mix), start + len(sound))
    if end <= start: return
    sound = sound[:end-start] * gain
    mix[start:end,0] += sound * np.sqrt((1-pan)/2)
    mix[start:end,1] += sound * np.sqrt((1+pan)/2)

def note(midi, duration, kind='pluck'):
    t = np.arange(round(duration*SR)) / SR
    f = 440 * 2 ** ((midi-69)/12)
    if kind == 'pluck':
        s = sum(np.sin(2*np.pi*f*k*t) * np.exp(-t*(3+k*1.6))/(k*k) for k in range(1,7))
        env = np.minimum(t/.008,1) * np.minimum((duration-t)/.08,1)
    elif kind == 'strings':
        s = sum(np.sin(2*np.pi*(f*k*t + .002*np.sin(t*2*np.pi*4.5)))/k for k in range(1,9))
        env = np.minimum(t/.22,1) * np.minimum((duration-t)/.35,1) * .2
    else:
        s = np.sin(2*np.pi*f*t) + .22*np.sin(4*np.pi*f*t)
        env = np.minimum(t/.02,1) * np.exp(-t*2) * np.minimum((duration-t)/.05,1)
    return (s * np.maximum(env,0)).astype(np.float32)

def drum(kind):
    duration = {'kick':.7,'snare':.3,'hat':.12,'crash':1.7,'tom':.5}[kind]
    t = np.arange(round(duration*SR))/SR
    noise = rng.normal(0,1,len(t))
    if kind == 'kick':
        s = np.sin(2*np.pi*(48*t + 50*.035*(1-np.exp(-t/.035)))) * np.exp(-t*8)
        s += .18*noise*np.exp(-t*70)
    elif kind == 'tom':
        s = np.sin(2*np.pi*(85*t + 100*.02*(1-np.exp(-t/.02))))*np.exp(-t*10)
        s += .1*noise*np.exp(-t*20)
    else:
        filtered = sosfilt(butter(2, 1700 if kind=='snare' else 6500, 'highpass', fs=SR, output='sos'),noise)
        s = filtered * np.exp(-t*(17 if kind=='snare' else 35 if kind=='hat' else 3.5))
        if kind=='snare': s += .3*np.sin(2*np.pi*190*t)*np.exp(-t*18)
    return (s*np.minimum(t/.002,1)).astype(np.float32)

# D minor -> Bb -> F -> C. A lifted, recurring motif holds the edit together.
chords = [(50,53,57),(46,50,53),(48,53,57),(48,52,55)]
melody = [74,77,81,79,77,74,72,69,74,77,81,84,81,79,77,76]
drums = {k:drum(k) for k in ['kick','snare','hat','crash','tom']}
for bar in range(32):
    at = bar*2
    chord = chords[(bar//2)%4]
    strength = .46 if bar<2 else .72 if bar<8 else 1
    for n in chord: add(note(n+12,2.15,'strings'),at,.055*strength, -.35 if n==chord[0] else .35)
    add(note(chord[0]-12,1.85,'bass'),at,.12*strength)
    if bar>=2:
        for step in range(8):
            n = chord[step%3]+12+(12 if step%4==3 else 0)
            pos = at+step*.25
            add(note(n,.7),pos,.065*strength,(-.4 if step%2 else .4))
            add(note(n,.5),pos+.1875,.018*strength,.5 if step%2 else -.5)
        add(drums['kick'],at,.4*strength)
        add(drums['kick'],at+1,.27*strength)
        add(drums['snare'],at+.5,.1*strength)
        add(drums['snare'],at+1.5,.13*strength)
        for s in range(8):add(drums['hat'],at+s*.25,.026*strength,.25)
    if 8<=bar<28:
        for beat in range(4):add(note(melody[(bar*4+beat)%len(melody)],.8),at+beat*.5,.07,-.08)
    if bar in [2,8,16,24,29]:add(drums['crash'],at,.11)
    if bar%4==3 and bar>3:
        for j in range(4):add(drums['tom'],at+1.5+j*.125,.09)

# Transitions: original low impacts and stereo air sweeps, tied to picture cuts.
for at in [0,4,12,18,30,34,46,54,58]:
    add(drums['kick'],at,.32)
    t=np.arange(round(.9*SR))/SR
    air=sosfilt(butter(2,2200,'lowpass',fs=SR,output='sos'),rng.normal(0,1,len(t)))
    air*=np.sin(np.pi*t/.9)**2
    add(air,max(0,at-.55),.045,-.2)

# Small hall tail and restrained dynamics; leave headroom for the finished mux.
dry = mix.copy()
for delay,gain in [(.067,.13),(.113,.1),(.173,.08),(.241,.06),(.347,.035)]:
    d=round(delay*SR);mix[d:]+=dry[:-d,::-1]*gain
mix=np.tanh(mix*1.7)
mix*=.87/max(np.max(np.abs(mix)),.001)
fade=np.minimum(np.arange(len(mix))/(SR*.08),1)*np.minimum((len(mix)-np.arange(len(mix)))/(SR*2.2),1)
mix*=fade[:,None]
Path('trailer/assets').mkdir(exist_ok=True,parents=True)
write('trailer/assets/score.wav',SR,(mix*32767).astype(np.int16))
print('Original stereo score: 64 seconds, 120 BPM, 48 kHz.')
