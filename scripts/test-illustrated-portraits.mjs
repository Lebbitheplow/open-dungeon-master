// Asset coverage catches missing files, incorrect gender routing and catalog drift.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { placeholderJobs } from './placeholder-set.mjs';
register('./lib/register-alias.mjs', import.meta.url);
const { illustratedPortrait, ILLUSTRATED_RACES, ILLUSTRATED_CLASSES } = await import('../src/lib/illustrated-portraits.ts');
const { lineageArt, classArt } = await import('../src/app/characters/builder/lineage.ts');
const root=path.resolve(import.meta.dirname,'..');
const prompts=JSON.parse(fs.readFileSync(path.join(root,'docs/art/illustrated-portrait-prompts.json'),'utf8')).prompts;
assert.equal(new Set(prompts.map(p=>p.id)).size,prompts.length,'unique provenance entries');
for(const [kind,ids] of [['race',ILLUSTRATED_RACES],['class',ILLUSTRATED_CLASSES]]){
 const existing=[...new Set(placeholderJobs().filter(j=>j.group===`character-${kind}`).map(j=>j.id.replace(/-(masculine|feminine|neutral)$/,'')))];
 assert.deepEqual([...ids].sort(),existing.sort(),`${kind} covers the entire shipped catalog`);
 for(const id of ids){
  const outputs=new Set();
  for(const [input,gender] of [['male','masculine'],['female','feminine'],['non-binary','neutral'],['they/them','neutral'],['agender','neutral'],['','neutral'],[null,'neutral']]){
   const url=illustratedPortrait(kind,id,input);
   assert.equal(url,`/assets/portraits/illustrated-v1/character-${kind}/${id}-${gender}.webp`);
   const file=path.join(root,'public',url),bytes=fs.readFileSync(file);
   assert.equal(bytes.toString('ascii',0,4),'RIFF');
   assert.equal(bytes.toString('ascii',8,12),'WEBP');
   assert.ok(bytes.length>1000 && bytes.length<150000,`reasonable thumbnail payload: ${url}`);
   assert.equal(prompts.filter(p=>p.web==='public'+url).length,1,'exactly one prompt per asset');
   outputs.add(url);
   if(kind==='class')assert.equal(classArt(id,input),url);
  }
  assert.equal(outputs.size,3,`${id}: three distinct variants`);
 }
}
assert.equal(classArt(' Street-Samurai ','nonbinary'),illustratedPortrait('class','street_samurai','neutral'));
assert.equal(lineageArt('odm-high-elf','','they/them'),illustratedPortrait('race','elf','neutral'));
assert.equal(lineageArt('dwarf-chassis','','female'),illustratedPortrait('race','warforged','female'));
assert.equal(lineageArt('reskinned','Hill Dwarf','non-binary'),illustratedPortrait('race','dwarf','neutral'));
assert.equal(illustratedPortrait('class','unpainted-homebrew','female'),null);
assert.equal(classArt('unpainted-homebrew','female'),'/assets/placeholders/character/feminine.webp');
assert.equal(lineageArt('mushroomfolk','Mushroomfolk',''),'/assets/placeholders/character/neutral.webp');
console.log(`test-illustrated-portraits: ${prompts.length} portraits; all catalog, gender, alias and fallback checks passed`);
