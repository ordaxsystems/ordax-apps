import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const failures=[];
for(const root of ['desktop','src','supervisor','scripts','test']){
 if(!fs.existsSync(root))continue;
 const stack=[root];
 while(stack.length){
  const dir=stack.pop();
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
   const file=path.join(dir,ent.name);
   if(ent.isDirectory())stack.push(file);
   else if(ent.isFile() && /\.(?:mjs|cjs|js)$/.test(ent.name)){
    const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
    if(r.status!==0) failures.push({file,error:(r.stderr||'').slice(0,400)});
   }
  }
 }
}
if(failures.length){console.error(JSON.stringify(failures,null,2));process.exitCode=1;}
else console.log('Lab-owned source syntax OK');
