"""Render the editable 64-second trailer using real captured gameplay.

Run from repository root: python trailer/edit.py
Requires FFmpeg, Pillow, numpy. Fonts are copied/converted from the app.
Negative source starts count backward from the end of a recording.
"""
from pathlib import Path
import json, subprocess, math, shutil, os
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
ASSETS, OUT = ROOT/'assets', ROOT/'output'
ASSETS.mkdir(exist_ok=True); OUT.mkdir(exist_ok=True)
SHOTS = OUT/'shots'; SHOTS.mkdir(exist_ok=True)
FF = os.environ.get('FFMPEG','ffmpeg')
W,H,FPS = 1920,1080,30
timeline = json.loads((ROOT/'timeline.json').read_text())
assert sum(s['duration'] for s in timeline)==64

def run(args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL)

def duration(path):
    return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(path)]))

def font(size, serif=False):
    p=ASSETS/('cinzel.ttf' if serif else 'geist.ttf')
    if not p.exists():
        from fontTools.ttLib import TTFont
        original=ROOT.parent/'src'/'app'/'fonts'/('cinzel.woff2' if serif else 'geist.woff2')
        f=TTFont(str(original));f.flavor=None;f.save(str(p))
    return ImageFont.truetype(str(p),size)

def tracked(draw,text,x,y,size,spacing=5,fill='#d5b369'):
    f=font(size)
    for c in text:
        draw.text((x,y),c,font=f,fill=fill);x+=draw.textlength(c,font=f)+spacing

def overlay(i,s):
    im=Image.new('RGBA',(W,H));a=np.zeros((H,W,4),np.uint8)
    for y in range(720,H):
        alpha=int(235*((y-720)/(H-720))**.7)
        a[y,:,:]=[9,7,18,alpha]
    im=Image.fromarray(a);d=ImageDraw.Draw(im)
    d.line((75,910,155,910),fill='#dfbd75',width=3)
    d.text((73,923),s.get('title',''),font=font(49,True),fill='#fff2d0',stroke_width=0)
    if s.get('sub'):d.text((76,994),s['sub'],font=font(23),fill='#ddd7e4')
    d.rounded_rectangle((72,45,325,86),radius=5,fill=(9,7,18,210),outline=(209,173,92,130))
    tracked(d,'CAPTURED IN GAME',89,56,14,2)
    p=ASSETS/f'overlay-{i:02}.png';im.save(p);return p

def card(i,s):
    # A quiet topographic orbit motif, matching the animated d20 sequences.
    yy,xx=np.mgrid[0:H,0:W];r=np.sqrt(((xx-W*.52)/W)**2+((yy-H*.48)/H)**2)
    a=np.zeros((H,W,3),np.uint8);a[:,:,0]=np.clip(20-r*14,7,20);a[:,:,1]=np.clip(15-r*11,6,15);a[:,:,2]=np.clip(34-r*20,15,34)
    im=Image.fromarray(a);d=ImageDraw.Draw(im)
    for n in range(6):
        radius=270+n*65;d.ellipse((W/2-radius,H/2-radius,W/2+radius,H/2+radius),outline=(42,34,42),width=1)
    rng=np.random.default_rng(i+41)
    for x,y in rng.uniform((0,0),(W,H),(140,2)):
        d.ellipse((x,y,x+2,y+2),fill=(112,91,55))
    f=font(94,True);text=s['card'];box=d.textbbox((0,0),text,font=f);x=(W-(box[2]-box[0]))/2
    d.text((x,444),text,font=f,fill='#fff0cf')
    ef=font(19);text=s.get('eyebrow','');width=sum(d.textlength(c,font=ef)+5 for c in text)
    tracked(d,text,(W-width)/2,383,19,5)
    d.line((W/2-60,601,W/2+60,601),fill='#d5b369',width=2)
    tracked(d,'OPEN DUNGEON MASTER',74,59,14,4)
    p=ASSETS/f'card-{i:02}.png';im.save(p);return p

def render(i,s):
    target=SHOTS/f'{i:02}.mp4';sec=s['duration'];n=round(sec*FPS)
    args=[FF,'-hide_banner','-loglevel','error','-y','-threads','2']
    iscard='card' in s
    if iscard:
        p=card(i,s);args+=['-loop','1','-framerate',str(FPS),'-i',str(p)]
        filters="scale=2016:1134,crop=1920:1080:x='48+8*sin(t*.7)':y='27+5*cos(t*.7)',fade=t=in:st=0:d=0.18"
    else:
        p=ROOT/s['source'];start=s.get('start',0)
        if start<0:start=duration(p)+start
        if start<0 or start+sec>duration(p)+.1:raise ValueError(f'Shot {i} exceeds source: {p}')
        args+=['-ss',str(start),'-i',str(p)]
        crop=s.get('crop',[1920,1080,0,0]);cw,ch,cx,cy=crop
        # A gentle moving crop keeps the footage alive without changing the UI.
        filters=f'crop={cw}:{ch}:{cx}:{cy},fps={FPS},scale=1958:1102:flags=lanczos,crop=1920:1080:x=19+8*sin(t*.6):y=11+4*cos(t*.6),setsar=1'
        if 'title' in s:
            plate=overlay(i,s);args+=['-loop','1','-framerate',str(FPS),'-i',str(plate)]
            graph=f"[0:v]{filters}[picture];[1:v]format=rgba,fade=t=in:st=0:d=0.22:alpha=1[words];[picture][words]overlay=x=0:y='18*(1-min(t/0.3,1))':shortest=1[out]"
            args+=['-filter_complex',graph,'-map','[out]'];filters=None
    if filters:args+=['-vf',filters]
    args+=['-an','-frames:v',str(n),'-c:v','libopenh264','-b:v','14M','-pix_fmt','yuv420p','-r',str(FPS),'-video_track_timescale','15360',str(target)]
    run(args);print(f'{i+1}/{len(timeline)}: {s.get("title",s.get("card",s.get("source")))}',flush=True)
    return target

# Convert bundled fonts once before the workers start.
font(20,False);font(20,True)
with ThreadPoolExecutor(max_workers=3) as pool:
    files=list(pool.map(lambda p:render(*p),enumerate(timeline)))
concat=SHOTS/'concat.txt';concat.write_text(''.join(f"file '{p.name}'\n" for p in files))
run([FF,'-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(concat),'-i',str(ASSETS/'score.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','256k','-af','loudnorm=I=-16:TP=-1.5:LRA=9','-ar','48000','-t','64','-metadata','title=Open Dungeon Master — The Adventure Is Yours','-movflags','+faststart',str(OUT/'open-dungeon-master-trailer.mp4')])
shutil.copyfile(ASSETS/'outro.png',OUT/'poster.png')
print(f'Finished: {OUT/"open-dungeon-master-trailer.mp4"}')
