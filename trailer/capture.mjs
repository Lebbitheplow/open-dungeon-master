// Record a fresh gameplay shot. Run against a separate demo instance.
// TRAILER_SESSION_FILE contains {"token":"..."}; never commit that file.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const { chromium }=require(process.env.PLAYWRIGHT_MODULE || '/tmp/odm-trailer-tools/node_modules/playwright');
const base=process.env.TRAILER_URL || 'http://127.0.0.1:3015';
const sessionFile=process.env.TRAILER_SESSION_FILE;
if(!sessionFile)throw new Error('Set TRAILER_SESSION_FILE to a local demo session JSON file.');
const token=JSON.parse(fs.readFileSync(sessionFile,'utf8')).token;
if(!token)throw new Error('Session file must contain a token.');
const [route='/',name='new-shot',actionsFile]=process.argv.slice(2);
if(!/^[a-z0-9-]+$/.test(name))throw new Error('Use a simple lowercase shot name.');
const dir=path.join(import.meta.dirname,'captures');fs.mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  const context=await browser.newContext({viewport:{width:1920,height:1080},colorScheme:'dark',recordVideo:{dir,size:{width:1920,height:1080}}});
  const url=new URL(base);
  await context.addCookies([{name:'odm_session',value:token,domain:url.hostname,path:'/'}]);
  await context.addInitScript(()=>{
    const systems=['maps','storyboard','party','bestiary','encounters','homebrew','cast','region','lore','factions','tables','rules','plugin','share'];
    for(const id of ['battle-hand-intro','table-player','table-dm','workshop-shelf','workshop-hub',...systems.map(s=>'workshop-'+s)])localStorage.setItem('odm:tour:'+id,'done');
    localStorage.setItem('odm.theme','dark');
    localStorage.setItem('odm:dice3d','on');
  });
  const page=await context.newPage();page.setDefaultTimeout(5000);
  const started=Date.now(),marks=[];
  await page.goto(new URL(route,base).href);await page.waitForTimeout(2000);
  const actions=actionsFile ? JSON.parse(fs.readFileSync(actionsFile,'utf8')) : [{action:'wait',ms:8000}];
  for(const step of actions){
    marks.push({at:(Date.now()-started)/1000,...step});
    const el=step.role ? page.getByRole(step.role,{name:step.name,exact:true}) : step.selector ? page.locator(step.selector) : null;
    if(step.action==='click')await el.click();
    else if(step.action==='fill')await el.fill(step.value);
    else if(step.action==='type')await el.pressSequentially(step.value,{delay:step.delay??35});
    else if(step.action==='hover')await el.hover();
    else if(step.action==='key')await page.keyboard.press(step.key);
    else if(step.action==='move')await page.mouse.move(step.x,step.y,{steps:step.steps??15});
    else if(step.action==='down')await page.mouse.down();
    else if(step.action==='up')await page.mouse.up();
    else if(step.action==='wait')await page.waitForTimeout(step.ms);
    else throw new Error(`Unknown action: ${step.action}`);
  }
  await page.waitForTimeout(800);
  const cdp=await context.newCDPSession(page);
  const frame=await cdp.send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(dir,name+'.png'),Buffer.from(frame.data,'base64'));
  const video=page.video();await context.close();await video.saveAs(path.join(dir,name+'.webm'));
  fs.writeFileSync(path.join(dir,name+'.markers.json'),JSON.stringify(marks,null,2));
  console.log(`Saved ${name}.webm and action timings.`);
}finally{await browser.close();}
