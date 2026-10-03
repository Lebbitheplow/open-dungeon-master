"""Gameplay montage. Every picture comes from continuous dark-theme recordings.

Static reframing and speed changes only. No stills, zoompan, or music.
Run: python trailer/edit-v2.py [--v3 | --v4]
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json, subprocess, os, sys
from PIL import Image, ImageDraw, ImageFont
import numpy as np
from scipy.io.wavfile import write

ROOT=Path(__file__).resolve().parent
VERSION='v4' if '--v4' in sys.argv else 'v3' if '--v3' in sys.argv else 'v2'
RAW=ROOT/'captures/v2';ASSETS=ROOT/'assets'/VERSION;OUT=ROOT/'output'/VERSION;SHOTS=OUT/'shots'
for p in (ASSETS,OUT,SHOTS):p.mkdir(parents=True,exist_ok=True)
T=json.loads((ROOT/f'timeline-{VERSION}.json').read_text());FPS=30;W,H=1920,1080
FF=os.environ.get('FFMPEG','ffmpeg')
TOTAL=sum(round(s['duration']*FPS)/FPS for s in T)
def run(args):subprocess.run(args,check=True,stdout=subprocess.DEVNULL)
def font(size,serif=False):return ImageFont.truetype(str(ROOT/'assets'/('cinzel.ttf' if serif else 'geist.ttf')),size)
def plate(i,s):
    im=Image.new('RGBA',(W,H));d=ImageDraw.Draw(im)
    if s.get('closing'):
        d.rectangle((0,0,W,H),fill=(7,5,15,165))
        d.rounded_rectangle((340,300,1580,766),radius=18,fill=(10,8,22,205),outline=(218,184,107,180),width=2)
        f=font(91,True)
        for label,y in [('OPEN DUNGEON',384),('MASTER',505)]:
            box=d.textbbox((0,0),label,font=f);d.text(((W-box[2])/2,y),label,font=f,fill='#f2d69b')
        f=font(28);label='PLAY. CREATE. ADVENTURE.';b=d.textbbox((0,0),label,font=f);d.text(((W-b[2])/2,657),label,font=f,fill='#efe8dc')
    else:
        label=s['label'];f=font(47,True);b=d.textbbox((0,0),label,font=f);width=b[2]+82
        d.rounded_rectangle((54,946,54+width,1027),radius=4,fill=(7,5,15,236))
        d.rectangle((54,946,60,1027),fill='#e2bb65')
        d.text((79,957),label,font=f,fill='#fff0cd')
    p=ASSETS/f'caption-{i:02}.png';im.save(p);return p

def render(item):
    i,s=item;sec=round(s['duration']*FPS)/FPS;speed=s.get('speed',1);src=RAW/(s['source']+'.webm');dst=SHOTS/f'{i:02}.mp4'
    crop=s.get('crop',[1600,900,0,0]);cw,ch,cx,cy=crop
    vf=f'crop={cw}:{ch}:{cx}:{cy},setpts=(PTS-STARTPTS)/{speed},fps={FPS},scale={W}:{H}:flags=lanczos,setsar=1'
    args=[FF,'-hide_banner','-loglevel','error','-y','-ss',str(s['start']),'-i',str(src)]
    if s.get('label') or s.get('closing'):
        p=plate(i,s);args+=['-loop','1','-framerate',str(FPS),'-i',str(p)]
        # Caption arrives quickly. The gameplay camera remains fixed.
        fade=.14 if s.get('closing') else .08
        graph=f'[0:v]{vf}[game];[1:v]format=rgba,fade=t=in:st=0:d={fade}:alpha=1[text];[game][text]overlay=0:0:shortest=1[out]'
        args+=['-filter_complex',graph,'-map','[out]']
    else:args+=['-vf',vf]
    args+=['-an','-t',str(sec),'-frames:v',str(round(sec*FPS)),'-c:v','libopenh264','-b:v','16M','-pix_fmt','yuv420p','-r',str(FPS),'-video_track_timescale','15360',str(dst)]
    run(args);print(f'{i+1}/{len(T)} {s["source"]}',flush=True);return dst

# Foley and game assets only. No generated score or tonal bed.
RATE=48000;mix=np.zeros((round((TOTAL+1)*RATE),2),np.float32)
cache={}
def sample(path):
    path=str(path)
    if path not in cache:
        data=subprocess.check_output([FF,'-v','error','-i',path,'-f','f32le','-ar',str(RATE),'-ac','2','pipe:1'])
        cache[path]=np.frombuffer(data,dtype=np.float32).reshape(-1,2)
    return cache[path]
def sound(path,at,gain=.6,pan=0):
    a=sample(path).copy()*gain;a[:,0]*=1-max(0,pan)*.4;a[:,1]*=1+min(0,pan)*.4
    start=round(at*RATE);n=min(len(a),len(mix)-start)
    if start>=0 and n>0:mix[start:start+n]+=a[:n]
SFX=ROOT/'assets/v2/sfx';RPG=SFX/'rpg-audio/Audio';UI=SFX/'interface-sounds/Audio';HIT=SFX/'impact-sounds/Audio'
dice=ROOT.parent/'public/dice-box/sounds/surfaces'
# Deterministic clacks from the game's own wooden tray samples, thinning as dice settle.
def tumble(at,span=2.2):
    rng=np.random.default_rng(round(at*1000));times=np.array([0,.12,.25,.39,.56,.78,1.02,1.28,1.56,1.9])
    for j,offset in enumerate(times[times<span]):
        sound(dice/f'surface_wood_tray{1+j%7}.mp3',at+float(offset),.34*(1-offset/span)+.1,float(rng.uniform(-.8,.8)))
starts=[];cursor=0
for s in T:starts.append(cursor);cursor+=round(s['duration']*FPS)/FPS
# Each cue is timed to the visible interaction in the new edit.
if VERSION in ('v3','v4'):
    packs={'rpg':RPG,'ui':UI,'hit':HIT}
    for at,s in zip(starts,T):
        for cue in s.get('sounds',[]):
            if cue.get('kind')=='dice':tumble(at+cue['at'],cue['span'])
            else:sound(packs[cue['pack']]/cue['file'],at+cue['at'],cue.get('gain',.4))
else:
    # Each effect is tied to an action in the cut, rather than a looping soundtrack.
    sound(RPG/'knifeSlice2.ogg',0,.9);sound(HIT/'impactMetal_medium_002.ogg',.32,.55)
    tumble(starts[1]+.05,2.0)
    sound(RPG/'cloth2.ogg',starts[2]+.08,.85);sound(UI/'click_003.ogg',starts[2]+.62,.45);sound(UI/'confirmation_001.ogg',starts[2]+1.08,.28)
    sound(RPG/'knifeSlice.ogg',starts[3]+.14,.75);sound(HIT/'impactPunch_heavy_000.ogg',starts[3]+.64,.6)
    for t in [starts[4]+.12,starts[4]+.43,starts[4]+.85,starts[4]+1.1]:sound(RPG/'footstep03.ogg',t,.48)
    sound(RPG/'bookOpen.ogg',starts[5],.72);sound(UI/'switch_003.ogg',starts[5]+.74,.38)
    sound(RPG/'bookFlip2.ogg',starts[6],.62);sound(UI/'confirmation_001.ogg',starts[6]+.35,.25)
    tumble(starts[7]+.09,2.05);sound(UI/'click_001.ogg',starts[8]+.28,.38)
    # Drawing uses quiet paper movement and actual UI clicks, keeping the mix restrained.
    sound(RPG/'bookFlip1.ogg',starts[9],.65);sound(RPG/'cloth1.ogg',starts[9]+.75,.55);sound(RPG/'cloth3.ogg',starts[9]+1.55,.55);sound(RPG/'cloth4.ogg',starts[9]+2.25,.5)
    sound(UI/'click_003.ogg',starts[10]+.1,.4);tumble(starts[10]+.35,1.0)
    for i in [11,12,13,14,15]:sound(RPG/f'bookFlip{1+i%3}.ogg',starts[i],.5)
    sound(UI/'click_001.ogg',starts[16]+.6,.4);sound(UI/'confirmation_001.ogg',starts[16]+1.1,.22)
    sound(RPG/'bookOpen.ogg',starts[17],.68);sound(UI/'switch_002.ogg',starts[17]+.6,.33);sound(UI/'switch_004.ogg',starts[17]+1.25,.33)
    sound(RPG/'drawKnife2.ogg',starts[18],.8);sound(HIT/'impactMetal_medium_002.ogg',starts[18]+.4,.68);sound(RPG/'knifeSlice.ogg',starts[18]+1.1,.65)
    sound(RPG/'knifeSlice2.ogg',starts[19],.85);sound(HIT/'impactMetal_heavy_001.ogg',starts[19]+.28,.63)
    for i in [20,21,22]:sound(RPG/'cloth2.ogg',starts[i],.5)
    tumble(starts[21],.5);sound(HIT/'impactPunch_medium_000.ogg',starts[22]+.25,.4)
    tumble(starts[23]+.05,2.6);sound(RPG/'bookClose.ogg',TOTAL-.8,.6)
# A safety limiter only; no generated oscillator or noise sounds.
peak=float(np.max(np.abs(mix)));mix*=min(1,.82/max(peak,1e-8))
fade=round(.22*RATE);end=round(TOTAL*RATE);mix[end-fade:end]*=np.linspace(1,0,fade)[:,None]
write(str(ASSETS/'effects.wav'),RATE,(np.clip(mix[:end],-1,1)*32767).astype(np.int16))
with ThreadPoolExecutor(max_workers=3) as pool:files=list(pool.map(render,enumerate(T)))
concat=SHOTS/'concat.txt';concat.write_text(''.join(f"file '{p.name}'\n" for p in files))
run([FF,'-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(concat),'-i',str(ASSETS/'effects.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','256k','-af','loudnorm=I=-18:TP=-2:LRA=12','-ar',str(RATE),'-t',str(TOTAL),'-metadata','title=Open Dungeon Master — Gameplay Montage','-movflags','+faststart',str(OUT/f'open-dungeon-master-trailer-{VERSION}.mp4')])
(OUT/'chapters.json').write_text(json.dumps([dict(at=at,**s) for at,s in zip(starts,T)],indent=2))
print(f'FINISHED {TOTAL:.3f}s {OUT/f"open-dungeon-master-trailer-{VERSION}.mp4"}',flush=True)
