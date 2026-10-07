"""Animated title cards and server/client choices without unrelated game footage.

python trailer/bookends-v8.py --proof
python trailer/bookends-v8.py
CLI/model diagrams and all gameplay chapters are retained from v7.
"""
from pathlib import Path
import importlib.util,json,math,subprocess,sys
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parent;OUT=ROOT/'assets/v8';OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('stage',ROOT/'stage-v6.py');S=importlib.util.module_from_spec(spec);spec.loader.exec_module(S)
T=[s for s in json.loads((ROOT/'timeline-v8.json').read_text()) if s['stage'] in ('intro','deployment','closing')]
W,H,FPS=1920,1080,30

def center(d,y,label,size=40,color=S.CREAM,serif=False,offset=0):
    f=S.font(size,serif);b=d.textbbox((0,0),label,font=f)
    S.text(d,((W-b[2])/2,y+offset),label,size,color,serif)

def brand(s,t):
    im=S.background(dict(s,brand_only=True),t);d=ImageDraw.Draw(im)
    col=S.GOLD;close=s['stage']=='closing'
    # Rotating geometry and orbital accents frame the game's name, not unrelated UI.
    for radius in (350,392):
        box=(960-radius,530-radius,960+radius,530+radius)
        d.ellipse(box,outline=(59,43,63),width=1)
        a=(t+s['at'])*26+radius*.4
        d.arc(box,a,a+55,fill=(138,106,65),width=3)
    emblem=Image.new('RGBA',(W,H));g=ImageDraw.Draw(emblem)
    r=164*S.ease(t/.28)+70*(1-S.ease(t/.28))
    S.M.diamond(g,960,210 if close else 229,r,col,t+.7)
    im.paste(emblem,(0,0),emblem);d=ImageDraw.Draw(im)
    offset=round(24*(1-S.ease(t/.25)))
    if close:
        center(d,303,'YOUR NEXT ADVENTURE STARTS HERE.',29,col,offset=offset)
        center(d,372,'OPEN DUNGEON',118,S.CREAM,True,offset)
        center(d,515,'MASTER',150,col,True,offset)
        center(d,730,'PLAY. CREATE. ADVENTURE.',37,S.CREAM)
        # A clear, readable website call to action gets its own visual emphasis.
        appear=S.ease((t-.2)/.3);dy=round((1-appear)*28)
        d.rounded_rectangle((570,810+dy,1350,898+dy),radius=10,fill=(29,22,38),outline=col,width=2)
        center(d,828+dy,'opendungeonmaster.com',40,col)
        if t>s['duration']-.2:
            im=Image.blend(Image.new('RGB',(W,H)),im,max(0,(s['duration']-t)/.2))
    else:
        center(d,365,'OPEN DUNGEON',118,S.CREAM,True,offset)
        center(d,509,'MASTER',150,col,True,offset)
        length=1080*S.ease(t/.6)
        d.line([(960-length/2,701),(960+length/2,701)],fill=(176,131,77),width=2)
        center(d,739,'YOUR AI. YOUR ADVENTURE.',37,col)
        center(d,813,'An AI Dungeon Master for your party.',31,S.MUTED)
    return im

def deployment(s,t):
    im=S.background(s,t);col=S.GOLD
    geo=Image.new('RGBA',(W,H));d=ImageDraw.Draw(geo)
    x1,x2,y=928,1435,238;blue=(171,190,255)
    off=round(60*(1-S.ease(t/.32)))
    for xx,color,label in [(x1,col,'YOUR SERVER'),(x2,blue,'THE CLIENT APP')]:
        d.rounded_rectangle((xx,y,xx+394,y+527),radius=20,fill=(22,17,32),outline=color,width=3)
        f=S.font(29);b=d.textbbox((0,0),label,font=f)
        S.text(d,(xx+(394-b[2])/2,y+32),label,29,color)
    S.M.server(d,1118,470,col,t)
    S.M.client(d,1622,444,blue,t)
    S.text(d,(1056,690),'SELF-HOSTED',23,col)
    S.text(d,(1501,690),'DESKTOP / ANDROID',23,blue)
    S.text(d,(1350,487),'OR',29,S.CREAM)
    S.text(d,(998,840),'TWO WAYS TO GET STARTED.',27,col)
    im.paste(geo,(off,0),geo)
    im=S.copy(im,s,t)
    if t<.25:
        d=ImageDraw.Draw(im);x=-130+t/.25*(W+500)
        d.polygon([(x,111),(x+10,111),(x-240,1011),(x-250,1011)],fill=(142,116,68))
    return im

def compose(s,t):return deployment(s,t) if s['stage']=='deployment' else brand(s,t)

if __name__=='__main__':
    if '--proof' in sys.argv:
        for s in T:compose(s,1.3).save(OUT/(s['source']+'-proof.png'))
        print('Proof frames written.',flush=True)
    else:
        for s in T:
            dst=ROOT/s['encoded'];n=round(s['duration']*FPS)
            p=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pixel_format','rgb24','-video_size',f'{W}x{H}','-framerate',str(FPS),'-i','pipe:0','-an','-c:v','libopenh264','-b:v','16M','-threads','1','-pix_fmt','yuv420p','-video_track_timescale','15360','-movflags','+faststart',str(dst)],stdin=subprocess.PIPE)
            try:
                for i in range(n):p.stdin.write(compose(s,i/FPS).tobytes())
                p.stdin.close()
                if p.wait():raise RuntimeError('Title/deployment graphics render failed')
            finally:
                if p.poll() is None:p.kill();p.wait()
            print('Rendered '+s['source'],flush=True)
