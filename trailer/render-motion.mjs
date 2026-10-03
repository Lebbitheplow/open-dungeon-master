// Run from the repository root. Install Playwright outside the app if needed.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
const require=createRequire(import.meta.url);
const { chromium }=require(process.env.PLAYWRIGHT_MODULE || '/tmp/odm-trailer-tools/node_modules/playwright');
fs.mkdirSync('trailer/assets',{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader']});
const page=await browser.newPage({viewport:{width:1920,height:1080}});
await page.goto('http://127.0.0.1:3017/trailer/motion.html');
await page.waitForFunction(()=>window.ready);
const cdp=await page.context().newCDPSession(page);
for(const [mode,seconds] of [['intro',4],['outro',6]]){
  const ff=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate','30','-i','pipe:0','-an','-c:v','libopenh264','-b:v','16M','-pix_fmt','yuv420p',`trailer/assets/${mode}.mp4`],{stdio:['pipe','inherit','inherit']});
  for(let f=0;f<seconds*30;f++){
    await page.evaluate(([t,m])=>window.renderFrame(t,m),[f/30,mode]);
    const r=await cdp.send('Page.captureScreenshot',{format:'png'});
    if(!ff.stdin.write(Buffer.from(r.data,'base64')))await once(ff.stdin,'drain');
    if(f===60)fs.writeFileSync(`trailer/assets/${mode}.png`,Buffer.from(r.data,'base64'));
    if(f%30===0)console.log(`${mode}: ${f/30}/${seconds}s`);
  }
  ff.stdin.end();const [exit]=await once(ff,'exit');if(exit!==0)throw new Error(`ffmpeg exit ${exit}`);
}
await browser.close();
