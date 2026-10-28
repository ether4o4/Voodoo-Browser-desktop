'use strict';
const path=require('node:path');
async function main(){
  const {packager}=await import('@electron/packager');
  const outputs=await packager({dir:path.join(__dirname,'..'),out:path.join(__dirname,'../dist'),name:'Voodoo Browser',executableName:'Voodoo',platform:'win32',arch:'x64',overwrite:true,asar:true,prune:true,
    ignore:[/^\/(\.git|\.github|test|test-output|artifacts|docs|scripts)(\/|$)/,/^\/AGENTS\.md$/],
    win32metadata:{CompanyName:'Voodoo Browser',FileDescription:'Voodoo Browser desktop preview',ProductName:'Voodoo Browser',InternalName:'Voodoo'}});
  for(const result of outputs)process.stdout.write(result+'\n');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
