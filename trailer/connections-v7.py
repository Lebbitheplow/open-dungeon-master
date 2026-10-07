"""Render two animated connection diagrams, replacing unrelated gameplay previews.

python trailer/connections-v7.py --proof
python trailer/connections-v7.py
The rest of the v6 edit is retained exactly.
"""
from pathlib import Path
import importlib.util,json,math,subprocess,sys
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parent;OUT=ROOT/'assets/v7';OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('stage',ROOT/'stage-v6.py');S=importlib.util.module_from_spec(spec);spec.loader.exec_module(S)
T=[s for s in json.loads((ROOT/'timeline-v7.json').read_text()) if s['stage'] in ('agents','model')]
FPS,W,H=30,1920,1080

def path(d,points,col,t,phase=0):
    d.line(points,fill=tuple(round(c*.36) for c in col),width=3)
    lens=[math.dist(a,b) for a,b in zip(points,points[1:])];total=sum(lens)
    for k in range(2):
        travel=((t*.48+phase+k*.5)%1)*total
        for a,b,length in zip(points,points[1:],lens):
            if travel<=length:
                f=travel/length;x=a[0]+(b[0]-a[0])*f;y=a[1]+(b[1]-a[1])*f
                d.ellipse((x-5,y-5,x+5,y+5),fill=col);break
            travel-=length

def game(d,col,t,x=1454,y=311):
    d.rounded_rectangle((x,y,x+364,y+401),radius=20,fill=(23,18,34),outline=col,width=3)
    S.text(d,(x+80,y+28),'YOUR TABLE',30,S.CREAM)
    S.M.diamond(d,x+182,y+194,274,col,t)
    f=S.font(20,True);label='OPEN DUNGEON MASTER';b=d.textbbox((0,0),label,font=f)
    S.text(d,(x+(364-b[2])/2,y+348),label,20,col,True)

def model_copy(im,s,t):
    d=ImageDraw.Draw(im);left=96+round(-32*(1-S.ease(t/.3)));col=S.accent(s)
    for i,line in enumerate(['YOUR MODEL.','YOUR CHOICE.']):S.text(d,(left,248+107*i),line,72,S.CREAM if i==0 else col,True)
    S.text(d,(left,514),'Run a local LLM. Or connect an API.',28)
    S.pill(d,(left,582),'LOCAL MODELS',286,col=col,size=27)
    S.pill(d,(left+308,582),'API PROVIDERS',287,col=(139,229,210),size=27)
    S.text(d,(left,666),'llama.cpp · Ollama · LM Studio · vLLM',27,S.MUTED)
    return im

def compose(s,t):
    im=S.background(s,t);d=ImageDraw.Draw(im);col=S.accent(s)
    # Connection diagrams are illustrations, with no game/video window.
    shift=round(60*(1-S.ease(t/.32)))
    geo=Image.new('RGBA',(W,H));g=ImageDraw.Draw(geo)
    if s['stage']=='agents':
        xx=944;yy=310
        g.rounded_rectangle((xx,yy,xx+322,yy+349),radius=18,fill=(18,15,28),outline=col,width=3)
        g.line([(xx,yy+58),(xx+322,yy+58)],fill=(77,90,96),width=2)
        S.text(g,(xx+34,yy+17),'YOUR CLI AGENT',25,col)
        for k in range(3):g.ellipse((xx+27+k*18,yy+85,xx+33+k*18,yy+91),fill=col)
        S.text(g,(xx+30,yy+127),'> connect',39,S.CREAM)
        S.text(g,(xx+30,yy+203),'MCP',58,col)
        if int(t*3)%2:g.rectangle((xx+32,yy+295,xx+50,yy+301),fill=col)
        path(g,[(1266,486),(1454,486)],col,t)
        S.text(g,(1300,440),'MCP',23,col)
        game(g,col,t)
        S.text(g,(987,803),'YOUR AGENT. CONNECTED TO YOUR TABLE.',25,col)
    else:
        # The on-device model and a remote API are visibly separate alternatives.
        xx=932;yy=206
        g.rounded_rectangle((xx,yy,xx+423,yy+365),radius=18,fill=(19,15,30),outline=col,width=2)
        S.text(g,(xx+89,yy+19),'YOUR COMPUTER',24,col)
        S.M.chip(g,xx+211,yy+211,col,t)
        path(g,[(1355,411),(1405,411),(1405,471),(1454,471)],col,t)
        api=(139,229,210);ax=979;ay=674
        g.rounded_rectangle((ax,ay,ax+376,ay+140),radius=18,fill=(18,25,30),outline=api,width=2)
        # A cloud silhouette marks the remote API, rather than local hardware.
        for box in [(ax+23,ay+49,ax+79,ay+101),(ax+42,ay+28,ax+105,ay+93),(ax+79,ay+50,ax+129,ay+100)]:g.ellipse(box,fill=(35,64,64),outline=api,width=2)
        g.rounded_rectangle((ax+34,ay+75,ax+118,ay+104),radius=7,fill=(35,64,64))
        S.text(g,(ax+147,ay+46),'API PROVIDER',26,api)
        S.text(g,(1113,602),'OR',29,S.CREAM)
        path(g,[(1355,744),(1405,744),(1405,574),(1454,574)],api,t,phase=.3)
        game(g,col,t)
        S.text(g,(965,870),'LOCAL OR API. YOUR CHOICE.',27,col)
    im.paste(geo,(shift,0),geo)
    im=S.copy(im,s,t) if s['stage']=='agents' else model_copy(im,s,t)
    if t<.25:
        d=ImageDraw.Draw(im);x=-130+t/.25*(W+500)
        d.polygon([(x,111),(x+10,111),(x-240,1011),(x-250,1011)],fill=tuple(round(c*.6) for c in col))
    return im

if __name__=='__main__':
    if '--proof' in sys.argv:
        for s in T:compose(s,1.5).save(OUT/(s['source']+'-proof.png'))
        print('Proof frames written.',flush=True)
    else:
        for s in T:
            dst=ROOT/s['encoded'];n=round(s['duration']*FPS)
            proc=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pixel_format','rgb24','-video_size',f'{W}x{H}','-framerate',str(FPS),'-i','pipe:0','-an','-c:v','libopenh264','-b:v','16M','-threads','1','-pix_fmt','yuv420p','-video_track_timescale','15360','-movflags','+faststart',str(dst)],stdin=subprocess.PIPE)
            try:
                for i in range(n):proc.stdin.write(compose(s,i/FPS).tobytes())
                proc.stdin.close()
                if proc.wait():raise RuntimeError('Connection graphics render failed')
            finally:
                if proc.poll() is None:proc.kill();proc.wait()
            print('Rendered '+s['source'],flush=True)
