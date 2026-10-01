import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
export async function launchNode({genesisTimestamp}={}){
  const rpc=JSON.parse(fs.readFileSync('config/candidate.json','utf8')).rpc;
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(rpc))throw Error('Loopback local RPC required');
  const port=Number(new URL(rpc).port);
  // Never attaches to or resets an existing unknown chain.
  const busy=await new Promise(resolve=>{const s=net.connect(port,'127.0.0.1');s.once('connect',()=>{s.destroy();resolve(true)});s.once('error',()=>resolve(false));});
  if(busy)throw Error('FairFlow local port occupied; stop this project explicitly or choose reviewed ports. Existing node was not touched.');
  fs.mkdirSync('runtime',{recursive:true});
  if(genesisTimestamp!==undefined)fs.writeFileSync('runtime/chain-genesis.json',JSON.stringify({timestamp:genesisTimestamp}));
  const logs=fs.openSync('runtime/local-chain.log','a');
  const child=spawn(process.execPath,[path.resolve('node_modules/hardhat/dist/src/cli.js'),'node','--network','node','--hostname','127.0.0.1','--port',String(port)],{cwd:process.cwd(),stdio:['ignore',logs,logs],windowsHide:true});
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)throw Error('Local node failed; inspect project runtime/local-chain.log');
    try{const r=await fetch(rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]})});const j=await r.json();if(j.result==='0x7a69')return child;}catch{}
    await delay(100);
  }
  child.kill();throw Error('Local node startup timed out');
}
