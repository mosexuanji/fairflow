import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import {build} from 'esbuild';
export async function compile() {
  const sources={};
  function visit(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())visit(p);else if(p.endsWith('.sol'))sources[p.replaceAll('\\','/')]={content:fs.readFileSync(p,'utf8')};}}
  visit('contracts');
  const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
  const output=JSON.parse(solc.compile(JSON.stringify(input),{import:p=>{try{return{contents:fs.readFileSync(path.join('node_modules',p),'utf8')}}catch{return{error:`missing ${p}`}}}}));
  const errors=(output.errors??[]).filter(e=>e.severity==='error');
  fs.mkdirSync('evidence',{recursive:true});
  fs.writeFileSync('evidence/compile.json',JSON.stringify({at:new Date().toISOString(),compiler:solc.version(),evmVersion:'cancun',viaIR:true,diagnostics:output.errors??[]},null,2));
  if(errors.length)throw Error(errors.map(e=>e.formattedMessage).join('\n'));
  fs.mkdirSync('dist/contracts',{recursive:true});
  const sizes={};
  for(const [source,contracts] of Object.entries(output.contracts))for(const [name,c] of Object.entries(contracts)){
    if(!c.evm.bytecode.object)continue;
    sizes[name]=c.evm.deployedBytecode.object.length/2;
    if(source.startsWith('contracts/'))fs.writeFileSync(`dist/contracts/${name}.json`,JSON.stringify({source,name,abi:c.abi,bytecode:'0x'+c.evm.bytecode.object}));
    if(sizes[name]>24576)throw Error(`EIP170 contract too large: ${name} ${sizes[name]}`);
  }
  fs.writeFileSync('evidence/contract-sizes.json',JSON.stringify(sizes,null,2));
  console.log('Solidity compiled; deployed bytes:',JSON.stringify(sizes));
}
export async function frontend(){
  if(!fs.existsSync('frontend/main.ts'))return;
  fs.mkdirSync('dist/web',{recursive:true});
  await build({entryPoints:['frontend/main.ts'],bundle:true,outfile:'dist/web/app.js',target:'es2022',minify:false});
  fs.copyFileSync('frontend/index.html','dist/web/index.html');
  fs.writeFileSync('dist/web/styles.css',fs.readFileSync('frontend/styles.css','utf8')+'\n'+fs.readFileSync('frontend/presentation.css','utf8'));
  console.log('Frontend bundled');
}
if(process.argv[1]?.endsWith('build.mjs')){await compile();await frontend();}
