"""Render original animated motion graphics explaining ways to play.

Code-drawn geometry and typography, not gameplay or product UI recordings.
Run before the v5 edit: python trailer/methods-motion.py
"""
from pathlib import Path
import json, math, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'assets/v5';OUT.mkdir(parents=True,exist_ok=True)
W,H,FPS=1920,1080,30
GOLD=(237,194,114);WHITE=(249,242,222);MUTED=(182,173,197)
METHODS=[
    ('server',['HOST YOUR','OWN SERVER'],'Your hardware. Your world.', 'Self-host Open Dungeon Master.',GOLD),
    ('client',['USE THE','CLIENT APP'],'Desktop or Android. Jump into your world.', 'Windows · macOS · Linux · Android',(171,190,255)),
    ('claude',['CONNECT','CLAUDE CODE'],'Bring your agent to the table.', 'Connect through MCP.',(242,157,117)),
    ('codex',['CONNECT','CODEX'],'Bring your agent to the table.', 'Connect through MCP.',(139,229,210)),
    ('local',['USE YOUR','LOCAL LLM'],'Run the narrator on your own hardware.', 'llama.cpp · Ollama · LM Studio · vLLM',(193,154,248)),
]
INTRO,CARD,END=1.0,2.5,2.0
TOTAL=INTRO+len(METHODS)*CARD+END
FONTS={}
def font(n,serif=False):
    key=(n,serif)
    if key not in FONTS:FONTS[key]=ImageFont.truetype(str(ROOT/'assets'/('cinzel.ttf' if serif else 'geist.ttf')),n)
    return FONTS[key]
def text(d,xy,label,size=32,fill=WHITE,serif=False):d.text(xy,label,font=font(size,serif),fill=fill)
def center(d,y,label,size=60,fill=WHITE,serif=False):
    f=font(size,serif);b=d.textbbox((0,0),label,font=f);d.text(((W-b[2])/2,y),label,font=f,fill=fill)
def ease(t):t=max(0,min(1,t));return 1-(1-t)**4
# A stationary dark background; its animated geometry is drawn afresh each frame.
y,x=np.mgrid[0:H,0:W]
purple=np.exp(-(((x-1470)/810)**2+((y-450)/620)**2))
warm=np.exp(-(((x-110)/700)**2+((y-940)/460)**2))
bg=np.stack([10+18*purple+8*warm,8+10*purple+4*warm,19+32*purple+2*warm],axis=-1).astype('uint8')
BASE=Image.fromarray(bg)
rng=np.random.default_rng(155);PARTICLES=rng.uniform(0,1,(86,4))

def diamond(d,cx,cy,r,color,t=0):
    # Rotating icosahedron: the actual geometry of a d20, projected in perspective.
    phi=(1+math.sqrt(5))/2
    pts=np.array([(0,a,b*phi) for a in [-1,1] for b in [-1,1]]+[(a,b*phi,0) for a in [-1,1] for b in [-1,1]]+[(a*phi,0,b) for a in [-1,1] for b in [-1,1]],float)
    a=.28+t*.32;b=.30+math.sin(t*.4)*.12
    ry=np.array([[math.cos(a),0,math.sin(a)],[0,1,0],[-math.sin(a),0,math.cos(a)]])
    rx=np.array([[1,0,0],[0,math.cos(b),-math.sin(b)],[0,math.sin(b),math.cos(b)]])
    p=pts@ry.T@rx.T
    q=np.stack([cx+p[:,0]*r/(3.9+p[:,2]),cy+p[:,1]*r/(3.9+p[:,2])],axis=-1)
    for i in range(12):
        for j in range(i):
            if abs(np.linalg.norm(pts[i]-pts[j])-2)<.01:
                shade=.4 if (p[i,2]+p[j,2])>0 else 1
                d.line([tuple(q[i]),tuple(q[j])],fill=tuple(round(c*shade) for c in color),width=3)

def frame_base(t,col):
    im=BASE.copy();d=ImageDraw.Draw(im)
    # Traveling perspective grid and occasional embers.
    horizon=650
    for k in range(-9,10):
        d.line([(960+k*55,horizon),(960+k*245,1080)],fill=(31,24,43),width=1)
    for k in range(9):
        yy=horizon+((k/9+t*.025)%1)**2*(1080-horizon)
        d.line([(0,yy),(W,yy)],fill=(36,28,47),width=1)
    for a,b,c,v in PARTICLES:
        xx=a*W+math.sin(t*.35+c*8)*14;yy=(b*H-t*(8+v*18))%H
        alpha=.24+.3*(math.sin(t+c*9)+1)/2
        color=tuple(round(z*alpha) for z in col);rr=1+v*1.7
        d.ellipse((xx-rr,yy-rr,xx+rr,yy+rr),fill=color)
    d.line([(128,139),(1792,139)],fill=(77,62,75),width=1)
    text(d,(128,81),'OPEN DUNGEON MASTER',28,GOLD,True)
    text(d,(1506,84),'PLAY YOUR WAY',24,MUTED)
    return im

def ring(d,cx,cy,col,t):
    for r in [228,266]:
        d.ellipse((cx-r,cy-r,cx+r,cy+r),outline=(54,43,69),width=2)
    a=t*36
    d.arc((cx-266,cy-266,cx+266,cy+266),a,a+76,fill=col,width=4)
    d.arc((cx-228,cy-228,cx+228,cy+228),-a+160,-a+215,fill=col,width=2)
    for k in range(8):
        ang=k*math.pi/4+a*.003;r=286
        px=cx+math.cos(ang)*r;py=cy+math.sin(ang)*r
        d.ellipse((px-3,py-3,px+3,py+3),fill=col)

def server(d,cx,cy,col,t):
    yaw=.2+math.sin(t*.6)*.05
    for n in range(3):
        yy=cy-123+n*84+math.sin(t*2+n*.3)*5
        x0=cx-144;x1=cx+126;depth=46+yaw*90
        d.polygon([(x0,yy),(x0+depth,yy-32),(x1+depth,yy-32),(x1,yy)],fill=(42,31,53),outline=col,width=2)
        d.polygon([(x1,yy),(x1+depth,yy-32),(x1+depth,yy+25),(x1,yy+57)],fill=(23,19,35),outline=col,width=2)
        d.rounded_rectangle((x0,yy,x1,yy+57),radius=6,fill=(19,16,29),outline=col,width=3)
        for i in range(6):
            xx=x0+26+i*25;d.line([(xx,yy+19),(xx,yy+38)],fill=(100,82,112),width=3)
        for i in range(2):
            color=col if math.sin(t*6+n+i)>-.4 else (78,62,77)
            xx=x1-42+i*19;d.ellipse((xx-4,yy+25,xx+4,yy+33),fill=color)
    d.line([(cx,cy+130),(cx,cy+174)],fill=col,width=3)
    d.line([(cx-117,cy+174),(cx+117,cy+174)],fill=col,width=3)
    for xx in [cx-117,cx,cx+117]:d.ellipse((xx-7,cy+167,xx+7,cy+181),fill=col)

def client(d,cx,cy,col,t):
    x0=cx-185;y0=cy-115
    d.rounded_rectangle((x0,y0,cx+105,cy+83),radius=13,fill=(17,15,27),outline=col,width=4)
    d.line([(x0,cy+50),(cx+105,cy+50)],fill=col,width=2)
    d.line([(cx-40,cy+83),(cx-40,cy+119)],fill=col,width=5)
    d.line([(cx-103,cy+123),(cx+23,cy+123)],fill=col,width=4)
    diamond(d,cx-40,cy-30,134,col,t)
    xx=cx+73;yy=cy-52+math.sin(t*2)*4
    d.rounded_rectangle((xx,yy,xx+111,yy+210),radius=18,fill=(15,14,24),outline=col,width=4)
    d.line([(xx+40,yy+12),(xx+73,yy+12)],fill=col,width=3)
    diamond(d,xx+56,yy+95,77,col,t)
    for k in range(3):d.line([(xx+17,yy+144+k*12),(xx+94,yy+144+k*12)],fill=(104,106,140),width=2)
    d.line([(xx+40,yy+195),(xx+73,yy+195)],fill=col,width=3)

def agent(d,cx,cy,col,t,name):
    xx=cx-205;yy=cy-116
    d.rounded_rectangle((xx,yy,xx+286,yy+214),radius=14,fill=(16,14,26),outline=col,width=3)
    d.line([(xx,yy+40),(xx+286,yy+40)],fill=col,width=2)
    for k in range(3):d.ellipse((xx+17+k*17,yy+15,xx+23+k*17,yy+21),fill=col)
    text(d,(xx+19,yy+66),'> connect',31,col)
    text(d,(xx+19,yy+116),'ODM / MCP',26,MUTED)
    if int(t*3)%2:d.rectangle((xx+20,yy+164,xx+35,yy+169),fill=col)
    endx=cx+157;endy=cy+2
    d.line([(xx+286,endy),(endx-53,endy)],fill=(90,82,105),width=3)
    for k in range(3):
        pos=(t*.85+k/3)%1;px=xx+287+pos*(endx-53-xx-287)
        d.ellipse((px-5,endy-5,px+5,endy+5),fill=col)
    diamond(d,endx,endy,123,col,t)
    text(d,(cx-164,cy+135),'AGENT / YOUR TABLE',20,col)

def chip(d,cx,cy,col,t):
    half=125
    d.rounded_rectangle((cx-half,cy-half,cx+half,cy+half),radius=18,fill=(22,17,36),outline=col,width=4)
    d.rounded_rectangle((cx-97,cy-97,cx+97,cy+97),radius=12,outline=(108,80,142),width=2)
    for k in range(7):
        z=-90+k*30;length=23+9*(1+math.sin(t*4+k))
        for sign in [-1,1]:
            d.line([(cx+sign*half,cy+z),(cx+sign*(half+length),cy+z)],fill=col,width=4)
            d.line([(cx+z,cy+sign*half),(cx+z,cy+sign*(half+length))],fill=col,width=4)
    diamond(d,cx,cy-15,148,col,t)
    text(d,(cx-49,cy+56),'LOCAL',25,col)
    for i in range(4):
        ang=t*.8+i*math.pi/2;r=209
        xx=cx+math.cos(ang)*r;yy=cy+math.sin(ang)*r
        d.ellipse((xx-5,yy-5,xx+5,yy+5),fill=col)

def rail(d,i,p,col):
    labels=['YOUR SERVER','CLIENT APP','CLAUDE CODE','CODEX','LOCAL LLM']
    for n,name in enumerate(labels):
        x0=128+n*339
        d.line([(x0,937),(x0+309,937)],fill=(69,53,78),width=3)
        if n<i:d.line([(x0,937),(x0+309,937)],fill=GOLD,width=3)
        elif n==i:d.line([(x0,937),(x0+309*p,937)],fill=col,width=5)
        text(d,(x0,963),name,23,col if n==i else MUTED)

def render_frame(t):
    if t<INTRO:
        im=frame_base(t,GOLD);d=ImageDraw.Draw(im)
        ring(d,960,533,GOLD,t*3)
        e=ease(t/.22);offset=round((1-e)*70)
        center(d,343+offset,'PLAY',147,WHITE,True)
        center(d,513+offset,'YOUR WAY',147,GOLD,True)
        return im
    index=int((t-INTRO)/CARD)
    if index>=len(METHODS):
        q=t-INTRO-len(METHODS)*CARD
        im=frame_base(t,GOLD);d=ImageDraw.Draw(im)
        center(d,294,'YOUR WORLD.',111,WHITE,True)
        center(d,434,'YOUR CHOICE.',111,GOLD,True)
        names=['SERVER','CLIENT APP','CLAUDE CODE','CODEX','LOCAL LLM']
        widths=[218,285,316,223,270];total=sum(widths)+20*4;xx=(W-total)/2
        for i,(name,width) in enumerate(zip(names,widths)):
            appear=ease((q-i*.09)/.2);dy=round((1-appear)*35)
            d.rounded_rectangle((xx,641+dy,xx+width,713+dy),radius=8,fill=(28,22,40),outline=METHODS[i][4],width=2)
            bb=d.textbbox((0,0),name,font=font(27));text(d,(xx+(width-bb[2])/2,657+dy),name,27,METHODS[i][4]);xx+=width+20
        center(d,782,'Also: API providers · opencode · other MCP clients',30,MUTED)
        return im
    local=t-INTRO-index*CARD;kind,lines,desc,extra,col=METHODS[index]
    im=frame_base(t,col);d=ImageDraw.Draw(im)
    text(d,(134,244),f'0{index+1} / CHOOSE YOUR SETUP',25,col)
    shift=round((1-ease(local/.23))*105)
    for i,line in enumerate(lines):text(d,(132+shift,324+i*120),line,91,WHITE if i==0 else col,True)
    text(d,(137,606),desc,34,WHITE)
    text(d,(137,669),extra,28,MUTED)
    # Icon geometry stays alive while the headline has time to be read.
    geo=Image.new('RGBA',(W,H));g=ImageDraw.Draw(geo)
    cy=474+round(math.sin(t*1.7)*6);cx=1470+round((1-ease(local/.32))*150)
    ring(g,cx,cy,col,t)
    if kind=='server':server(g,cx,cy,col,t)
    elif kind=='client':client(g,cx,cy,col,t)
    elif kind in ('claude','codex'):agent(g,cx,cy,col,t,kind)
    else:chip(g,cx,cy,col,t)
    # Restrained neon halo, with crisp original line work on top.
    glow=geo.resize((W//4,H//4)).filter(ImageFilter.GaussianBlur(3)).resize((W,H))
    glow.putalpha(glow.getchannel('A').point(lambda a:round(a*.55)))
    im=Image.alpha_composite(im.convert('RGBA'),glow)
    im=Image.alpha_composite(im,geo)
    d=ImageDraw.Draw(im);rail(d,index,min(local/CARD,1),col)
    # One quick diagonal sweep at each transition, never a repeating strobe.
    if local<.18:
        x=-280+local/.18*(W+500)
        d.polygon([(x,0),(x+45,0),(x-280,H),(x-325,H)],fill=(*col,65))
    return im.convert('RGB')

if __name__=='__main__':
    target=OUT/'methods-motion.mp4'
    args=['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','rgb24','-video_size',f'{W}x{H}','-framerate',str(FPS),'-i','pipe:0','-an','-c:v','libopenh264','-b:v','16M','-pix_fmt','yuv420p','-video_track_timescale','15360','-movflags','+faststart',str(target)]
    proc=subprocess.Popen(args,stdin=subprocess.PIPE)
    sections=[dict(at=0,duration=INTRO,label='PLAY YOUR WAY')]+[dict(at=INTRO+i*CARD,duration=CARD,label=' '.join(m[1])) for i,m in enumerate(METHODS)]+[dict(at=INTRO+len(METHODS)*CARD,duration=END,label='YOUR WORLD. YOUR CHOICE.')]
    (OUT/'methods-chapters.json').write_text(json.dumps(sections,indent=2)+'\n')
    for i in range(round(TOTAL*FPS)):
        im=render_frame(i/FPS)
        proc.stdin.write(im.convert('RGB').tobytes())
        if i in [15,67,142,217,292,367,435]:im.save(OUT/f'method-preview-{i:03}.png')
        if i%75==0:print(f'Motion graphics: {i/FPS:.1f}/{TOTAL:.1f}s',flush=True)
    proc.stdin.close()
    if proc.wait():raise SystemExit('Motion render failed')
    print(f'Finished {target}: {TOTAL:.1f}s',flush=True)
