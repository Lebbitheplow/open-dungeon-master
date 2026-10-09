// Build an offline review file: node scripts/portrait-gallery.mjs [output.html]
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/art/illustrated-portrait-prompts.json'),'utf8'));
const embed=file=>fs.existsSync(file)?'data:image/webp;base64,'+fs.readFileSync(file).toString('base64'):null;
const rows=manifest.prompts.map(p=>{
 const src=embed(path.join(root,p.web));
 if(!src)throw Error('Missing portrait: '+p.web);
 return {kind:p.kind,subject:p.subject,gender:p.gender,src,old:embed(path.join(root,'public/assets/placeholders',`character-${p.kind}`,`${p.subject}-${p.gender}.webp`))};
});
const template=fs.readFileSync(path.join(import.meta.dirname,'lib/portrait-gallery.html'),'utf8');
const html=template.replace('/*PORTRAITS*/[]',()=>JSON.stringify(rows).replaceAll('<','\\u003c'));
const output=path.resolve(process.argv[2]??path.join(root,'data/illustrated-portraits-v1/gallery.html'));
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,html);
console.log(`${rows.length} portraits embedded in ${output}`);
