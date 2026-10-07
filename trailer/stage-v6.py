"""An animated editorial stage, with continuous real game video in large windows.

python trailer/stage-v6.py --proof  # inspect representative composited frames
python trailer/stage-v6.py          # render the silent staged shots
The existing editor mixes the timed foley and exports the final video.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import importlib.util, json, math, subprocess, sys, functools
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parent;OUT=ROOT/'assets/v6';OUT.mkdir(parents=True,exist_ok=True)
RAW=ROOT/'captures/v2';T=json.loads((ROOT/'timeline-v6.json').read_text())
W,H,FPS=1920,1080,30
GOLD=(237,194,114);CREAM=(247,237,216);MUTED=(179,165,193)
COLORS={'setup':GOLD,'combat':(235,148,117),'hero':(181,186,255),'maps':(151,213,170),'workshop':(213,169,244),'closing':GOLD}
spec=importlib.util.spec_from_file_location('motion',ROOT/'methods-motion.py');M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M)
@functools.lru_cache(maxsize=40)
def font(n,serif=False):return ImageFont.truetype(str(ROOT/'assets'/('cinzel.ttf' if serif else 'geist.ttf')),n)
def text(d,xy,label,size=28,color=CREAM,serif=False):d.text(xy,label,font=font(size,serif),fill=color)
def ease(t):t=max(0,min(t,1));return 1-(1-t)**4

y,x=np.mgrid[:H,:W]
p=np.exp(-(((x-1660)/940)**2+((y-340)/610)**2));q=np.exp(-(((x-220)/800)**2+((y-910)/520)**2))
BASE=Image.fromarray(np.stack([10+13*p+8*q,8+8*p+3*q,18+28*p+12*q],axis=-1).astype('uint8'))
PART=np.random.default_rng(63).uniform(0,1,(65,4))

def dims(s):
    if s['stage'] in ('intro','deployment','agents','model','closing'):return 918,266,912,513
    if s['stage'] in ('maps','combat'):return 408,193,1440,810
    return 574,247,1264,711

def accent(s):return {'agents':(139,229,210),'model':(193,154,248)}.get(s['stage'],COLORS[s['group']])

def background(s,t):
    im=BASE.copy();d=ImageDraw.Draw(im);col=accent(s);time=s['at']+t
    # Arc geometry, traveling points, a fine floor grid, and drifting embers.
    for rr in (404,447,492):
        box=(1220-rr,437-rr,1220+rr,437+rr);d.ellipse(box,outline=(40,30,53),width=2)
        a=time*12+rr*.4;d.arc(box,a,a+38,fill=tuple(round(v*.38) for v in col),width=2)
    for i in range(12):
        z=726+((i/12+time*.014)%1)**2*354
        d.line([(0,z),(W,z)],fill=(30,24,41),width=1)
    for i in range(-7,10):d.line([(960+i*46,726),(960+i*260,H)],fill=(28,23,39),width=1)
    for a,b,c,v in PART:
        px=a*W+math.sin(time*.28+c*11)*16;py=(b*H-time*(6+v*11))%H
        cc=tuple(round(z*(.2+.18*(math.sin(time+c*9)+1))) for z in col);r=1+v
        d.ellipse((px-r,py-r,px+r,py+r),fill=cc)
    if s.get('brand_only'):return im
    # One stable brand header and a chapter rail unify the complete film.
    text(d,(94,53),'OPEN DUNGEON MASTER',27,GOLD,True)
    names={'setup':'PLAY YOUR WAY','combat':'TACTICAL COMBAT','hero':'CHARACTER CREATOR','maps':'YOUR WORLD','workshop':'THE WORKSHOP','closing':'YOUR NEXT ADVENTURE'}
    f=font(23);label=names[s['group']];bb=d.textbbox((0,0),label,font=f)
    text(d,(1826-bb[2],57),label,23,col)
    d.line([(94,104),(1826,104)],fill=(73,54,80),width=1)
    rail=['setup','combat','hero','maps','workshop'];xx=94
    for g in rail:
        label={'setup':'YOUR SETUP','combat':'COMBAT','hero':'YOUR HERO','maps':'YOUR WORLD','workshop':'YOUR CREATIONS'}[g]
        f=font(20);b=d.textbbox((0,0),label,font=f);width=b[2]+50
        text(d,(xx,1036),label,20,col if g==s['group'] else (116,102,132))
        if g==s['group']:d.line([(xx,1024),(xx+width-50,1024)],fill=col,width=3)
        xx+=width+26
    return im

def pill(d,xy,label,width=278,active=True,col=GOLD,size=25):
    xx,yy=xy
    d.rounded_rectangle((xx,yy,xx+width,yy+49),radius=7,fill=(37,27,47) if active else (21,17,31),outline=col if active else (70,53,83),width=2 if active else 1)
    text(d,(xx+17,yy+9),label,size,col if active else MUTED)

def copy(im,s,t):
    d=ImageDraw.Draw(im);stage=s['stage'];col=accent(s)
    animated=s.get('entrance',True) if stage in ('hero','maps','combat','workshop') else True
    dx=round(-32*(1-ease(t/.3))) if animated else 0
    left=96+dx
    if stage=='intro':
        text(d,(left,256),'YOUR AI. YOUR ADVENTURE.',31,GOLD)
        text(d,(left,338),'OPEN DUNGEON',70,CREAM,True);text(d,(left,430),'MASTER',107,GOLD,True)
        text(d,(left,598),'An AI Dungeon Master.',30)
        text(d,(left,642),'A world for your party.',30)
    elif stage=='deployment':
        for i,line in enumerate(['HOST IT.','OR OPEN','THE APP.']):text(d,(left,218+94*i),line,77,CREAM if i<2 else GOLD,True)
        text(d,(left,554),'Your server. Or a world inside the app.',29)
        pill(d,(left,626),'YOUR OWN SERVER',319,col=GOLD,size=26)
        pill(d,(left+340,626),'THE CLIENT APP',300,col=(171,190,255),size=26)
        text(d,(left,710),'Windows · macOS · Linux · Android',28,MUTED)
    elif stage=='agents':
        for i,line in enumerate(['BRING YOUR','OWN AGENT.']):text(d,(left,252+110*i),line,77,CREAM if i==0 else (147,224,203),True)
        text(d,(left,518),'Connect the CLI tools you already use.',29)
        names=['Claude Code','Codex','opencode','Grok Build'];colors=[(242,157,117),(139,229,210),GOLD,(193,154,248)]
        for i,name in enumerate(names):
            off=round((1-ease((t-.12-i*.1)/.22))*25)
            pill(d,(left+i%2*322,582+i//2*66+off),name,299,col=colors[i],size=28)
        text(d,(left,750),'And other MCP clients.',27,MUTED)
    elif stage=='model':
        for i,line in enumerate(['YOUR MODEL.','YOUR MACHINE.']):text(d,(left,248+107*i),line,72,CREAM if i==0 else (193,154,248),True)
        text(d,(left,514),'Use a local LLM or connect an API provider.',28)
        pill(d,(left,582),'LOCAL MODELS',286,col=(193,154,248),size=27)
        pill(d,(left+308,582),'API PROVIDERS',287,col=(139,229,210),size=27)
        text(d,(left,666),'llama.cpp · Ollama · LM Studio · vLLM',27,MUTED)
    elif stage in ('hero','maps','combat','workshop'):
        if stage=='combat':
            lines=['EVERY','MOVE','MATTERS.'];size=58;yy=265
            body=['Solo or with friends.','Your turn. Your choice.','Let the dice decide.'];options=['SPELLS','POSITION','DICE']
        elif stage=='maps':
            lines=['BUILD','YOUR','WORLD.'];size=69;yy=254
            body=['Generate maps.','Paint the terrain.','Explore your world.'];options=['GENERATE','PAINT','EXPLORE']
        elif stage=='hero':
            lines=['MAKE','YOUR','HERO.'];size=91;yy=245
            body=['Start with a spark.','Make it your character.'];options=['ANCESTRY','CLASS','ABILITY SCORES']
        else:
            lines=['MAKE IT','YOUR','OWN.'];size=78;yy=245
            body=['Your monsters.','Your settings.','Your next campaign.'];options=['WORKSHOP','MONSTERS','CAMPAIGN']
        spacing=95 if stage in ('maps','combat') else 112
        for i,line in enumerate(lines):text(d,(left,yy+i*spacing),line,size,CREAM if i<len(lines)-1 else col,True)
        by=yy+len(lines)*spacing+34
        for i,line in enumerate(body):text(d,(left+3,by+i*37),line,24 if stage in ('maps','combat') else 28,MUTED)
        py=790 if stage in ('maps','combat') else 783
        for i,label in enumerate(options):
            pill(d,(left+3,py+i*56),label,269 if stage in ('maps','combat') else 339,i==s.get('step',0),col,23)
    else:
        text(d,(left,224),'YOUR NEXT ADVENTURE STARTS HERE.',26,GOLD)
        text(d,(left,328),'OPEN DUNGEON',70,CREAM,True);text(d,(left,422),'MASTER',105,GOLD,True)
        text(d,(left,608),'PLAY. CREATE. ADVENTURE.',30)
        text(d,(left,704),'opendungeonmaster.com',37,GOLD)
    return im

def compose(s,t,game):
    im=background(s,t);col=accent(s);stage=s['stage']
    wx,wy,gw,gh=dims(s)
    enter=stage in ('intro','deployment','agents','model','closing') or s.get('entrance',False)
    off=round(90*(1-ease(t/.32))) if enter else 0;wx+=off
    # Keep the camera stable after the entrance so the actual UI is readable.
    d=ImageDraw.Draw(im)
    d.rounded_rectangle((wx-16,wy-46,wx+gw+16,wy+gh+15),radius=16,fill=(6,5,12))
    d.rounded_rectangle((wx-7,wy-39,wx+gw+7,wy+gh+7),radius=10,fill=(25,19,35),outline=tuple(round(c*.53) for c in col),width=2)
    headers={'intro':'LIVE OPEN DUNGEON MASTER','deployment':'YOUR WORLD, YOUR CHOICE','agents':'YOUR AGENT, YOUR TABLE','model':'YOUR AI, YOUR CHOICE','closing':'CREATE YOUR NEXT WORLD'}
    label=headers.get(stage,s['label'])
    text(d,(wx+17,wy-30),label,19,col)
    for k in range(3):d.ellipse((wx+gw-69+k*18,wy-24,wx+gw-63+k*18,wy-18),fill=col if k==0 else (93,72,107))
    im.paste(game,(wx,wy))
    d=ImageDraw.Draw(im)
    # Thin corner tracers move while the gameplay plays continuously.
    length=45+8*math.sin((s['at']+t)*1.7)
    for xx,yy,sx,sy in [(wx-8,wy-39,1,1),(wx+gw+7,wy+gh+7,-1,-1)]:
        d.line([(xx,yy+sy*length),(xx,yy),(xx+sx*length,yy)],fill=col,width=3)
    # The actual Fire Bolt impact gets a short border accent timed to the cast.
    if stage=='combat' and s.get('step')==0 and 2.5<t<3.15:
        pulse=1-(t-2.5)/.65;color=tuple(round(c*(.6+.4*pulse)) for c in col)
        d.rectangle((wx-2,wy-2,wx+gw+2,wy+gh+2),outline=color,width=3)
    if stage in ('intro','deployment','agents','model','closing'):
        # A living emblem beneath the footage adds a visual cue to each setup.
        geo=Image.new('RGBA',(420,330));g=ImageDraw.Draw(geo)
        if stage=='deployment':M.server(g,210,150,col,t)
        elif stage=='agents':M.agent(g,210,145,col,t,'all')
        elif stage=='model':M.chip(g,210,145,col,t)
        else:M.diamond(g,210,155,260,col,t)
        geo=geo.resize((210,165),Image.Resampling.LANCZOS)
        im.paste(geo,(1608,817),geo)
        d=ImageDraw.Draw(im)
        small={'intro':'A WORLD YOU MAKE YOUR OWN','deployment':'HOST. CONNECT. PLAY.','agents':'YOUR AGENT / YOUR TABLE','model':'YOUR HARDWARE / YOUR AI','closing':'PLAY YOUR WAY'}[stage]
        text(d,(wx+17,875),small,22,col)
        # An animated link connects the choice badges to the live game window.
        if stage in ('agents','model','deployment'):
            path=[(744,638),(835,638),(835,551),(906,551)]
            d.line(path,fill=(76,58,90),width=2)
            lengths=[math.hypot(b[0]-a[0],b[1]-a[1]) for a,b in zip(path,path[1:])]
            travel=(t*.8%1)*sum(lengths)
            for a,b,dist in zip(path,path[1:],lengths):
                if travel<=dist:
                    f=travel/dist;px=a[0]+(b[0]-a[0])*f;py=a[1]+(b[1]-a[1])*f
                    d.ellipse((px-4,py-4,px+4,py+4),fill=col);break
                travel-=dist
    im=copy(im,s,t)
    if enter and t<.25:
        # A quick portal-like sweep at chapter changes; all text then holds still.
        dd=ImageDraw.Draw(im);xx=-130+t/.25*(W+500)
        cc=tuple(round(c*.6) for c in col)
        dd.polygon([(xx,111),(xx+10,111),(xx-240,1011),(xx-250,1011)],fill=cc)
    if stage=='closing' and t>s['duration']-.2:
        alpha=max(0,min(1,(s['duration']-t)/.2));im=Image.blend(Image.new('RGB',(W,H)),im,alpha)
    return im

def decode_args(s,proof=None):
    _,_,gw,gh=dims(s);crop=s.get('crop',[1600,900,0,0]);cw,ch,cx,cy=crop;speed=s.get('speed',1)
    start=s['start']+(proof*speed if proof is not None else 0)
    args=['ffmpeg','-hide_banner','-loglevel','error','-threads','2','-ss',str(start),'-i',str(RAW/(s['source']+'.webm'))]
    vf=f'crop={cw}:{ch}:{cx}:{cy},setpts=(PTS-STARTPTS)/{speed},fps={FPS},scale={gw}:{gh}:flags=lanczos'
    return args+['-vf',vf,'-frames:v',str(1 if proof is not None else round(s['duration']*FPS)),'-an','-pix_fmt','rgb24','-threads','1','-filter_threads','1','-f','rawvideo','pipe:1']

def render(item):
    i,s=item;wx,wy,gw,gh=dims(s);n=round(s['duration']*FPS)
    decoder=subprocess.Popen(decode_args(s),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    dst=ROOT/s['encoded']
    enc=['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','rgb24','-video_size',f'{W}x{H}','-framerate',str(FPS),'-i','pipe:0','-an','-c:v','libopenh264','-b:v','16M','-threads','1','-pix_fmt','yuv420p','-video_track_timescale','15360','-movflags','+faststart',str(dst)]
    encoder=subprocess.Popen(enc,stdin=subprocess.PIPE,stderr=subprocess.PIPE)
    try:
        for k in range(n):
            raw=decoder.stdout.read(gw*gh*3)
            if len(raw)!=gw*gh*3:raise RuntimeError(f'{s["source"]}: source ended at frame {k}/{n}: {decoder.stderr.read().decode()}')
            game=Image.frombytes('RGB',(gw,gh),raw)
            im=compose(s,k/FPS,game);encoder.stdin.write(im.tobytes())
        encoder.stdin.close()
        if encoder.wait():raise RuntimeError(encoder.stderr.read().decode())
        if decoder.wait():raise RuntimeError(decoder.stderr.read().decode())
    finally:
        for p in (decoder,encoder):
            if p.poll() is None:p.kill();p.wait()
    print(f'{i+1}/{len(T)} staged: {s["stage"]} / {s["source"]}',flush=True)
    return dst

if __name__=='__main__':
    if '--proof' in sys.argv:
        indices=[0,1,2,3,4,7,10,13,16]
        sheet=Image.new('RGB',(1536,3*310),'#100b18');d=ImageDraw.Draw(sheet)
        for j,i in enumerate(indices):
            s=T[i];t=min(s['duration']/2,1.5);_,_,gw,gh=dims(s)
            raw=subprocess.check_output(decode_args(s,proof=t))
            im=compose(s,t,Image.frombytes('RGB',(gw,gh),raw));im.save(OUT/f'proof-{i:02}.png')
            xx=j%3*512;yy=j//3*310;sheet.paste(im.resize((512,288)),(xx,yy));d.text((xx+8,yy+291),s['stage']+' / '+s['label'],fill=GOLD)
        sheet.save(OUT/'layout-review.jpg',quality=95)
        print('Proof frames written:',OUT/'layout-review.jpg',flush=True)
    else:
        with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(render,enumerate(T)))
        print('All staged scenes finished.',flush=True)
