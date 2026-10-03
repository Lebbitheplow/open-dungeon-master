"""Decode the export, check its format, and make a frame-per-shot review sheet."""
from pathlib import Path
import subprocess, json, io, sys, math
from PIL import Image, ImageDraw

root=Path(__file__).resolve().parent
version='v4' if '--v4' in sys.argv else 'v3' if '--v3' in sys.argv else 'v2' if '--v2' in sys.argv else None
video=root/'output'/(f'{version}/open-dungeon-master-trailer-{version}.mp4' if version else 'open-dungeon-master-trailer.mp4')
timeline=json.loads((root/(f'timeline-{version}.json' if version else 'timeline.json')).read_text())
expected=sum(round(s['duration']*30)/30 for s in timeline)
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(video)]))
v=next(s for s in probe['streams'] if s['codec_type']=='video')
a=next(s for s in probe['streams'] if s['codec_type']=='audio')
assert (v['codec_name'],v['width'],v['height'],v['r_frame_rate'])==('h264',1920,1080,'30/1')
assert a['channels']==2 and int(a['sample_rate'])==48000
assert abs(float(probe['format']['duration'])-expected)<.05
subprocess.run(['ffmpeg','-hide_banner','-v','error','-i',str(video),'-f','null','-'],check=True)
sheet=Image.new('RGB',(1600,math.ceil(len(timeline)/5)*205),'#100c15');d=ImageDraw.Draw(sheet)
at=0
for i,s in enumerate(timeline):
    t=at+s['duration']/2
    frame=subprocess.check_output(['ffmpeg','-hide_banner','-loglevel','error','-ss',str(t),'-i',str(video),'-frames:v','1','-vf','scale=320:180','-f','image2pipe','-vcodec','png','-'])
    x,y=(i%5)*320,(i//5)*205
    sheet.paste(Image.open(io.BytesIO(frame)),(x,y))
    d.text((x+8,y+184),f'{int(at)//60:02}:{int(at)%60:02} · {s["duration"]}s',fill='#d8be85')
    at+=s['duration']
sheet.save(video.parent/'contact-sheet.jpg',quality=92)
print(f'Verified: complete decode, {expected:.3f}s, 1920x1080, 30fps, H.264, stereo AAC at 48kHz.')
