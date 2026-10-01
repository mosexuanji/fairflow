import fs from 'node:fs';
import {launchNode} from './local-node.mjs';
import {initialize,provider,config,attach,json,seedMetadata} from '../service/chain.mjs';
import {startServer} from '../service/server.mjs';
import {attachJournal} from '../service/journal.mjs';
import {replayJournal} from './replay.mjs';
const hasLedger=fs.existsSync('runtime/chain-journal-manifest.json');
const manifest=hasLedger?JSON.parse(fs.readFileSync('runtime/chain-journal-manifest.json','utf8')):null;
const genesis=manifest?.genesisTimestamp??Math.floor(Date.now()/1000);
let node,recorder,app;
try{
 let alive=false;try{alive=Number(BigInt(await provider.send('eth_chainId',[])))===31337}catch{}
 if(alive&&!hasLedger)throw Error('Existing unowned chain was not touched. Stop only its known owner or choose reviewed ports.');
 if(!alive)node=await launchNode({genesisTimestamp:genesis});
 if(hasLedger && Number(BigInt(await provider.send('eth_blockNumber',[])))===0){const result=await replayJournal({provider,runtimeDir:'runtime',rpcUrl:config.rpc});fs.writeFileSync('evidence/latest-recovery.json',json(result));}
 recorder=await attachJournal(provider,{runtimeDir:'runtime',rpcUrl:config.rpc,genesisTimestamp:genesis});
 let deployment;
 if(hasLedger){if(!fs.existsSync('runtime/deployment.json'))throw Error('Recorded deployment missing; refusing rebuild');deployment=JSON.parse(fs.readFileSync('runtime/deployment.json','utf8'));}
 else{
   if(fs.existsSync('runtime/app-data.json')){fs.mkdirSync('runtime/archive',{recursive:true});fs.renameSync('runtime/app-data.json',`runtime/archive/pre-application-${Date.now()}.json`);}
   deployment=await initialize();
 }
 const reads=[];
 for(const d of deployment.projects){
   const p=attach('FairFlowProject',d.address);const t=attach('ProjectToken',d.token);
   for(const method of ['cumulativeRecognizedUnits','grossIssued','bountyReserved','bountyClaimable','refundableServices','operationsBudget','buybackBudget','policyVersion','taskCount','contributionCount','orderCount'])reads.push({label:`${d.id}.${method}`,method:'eth_call',params:[{to:d.address,data:p.interface.encodeFunctionData(method)},'latest']});
   for(const method of ['totalSupply','totalBurned'])reads.push({label:`${d.id}.${method}`,method:'eth_call',params:[{to:d.token,data:t.interface.encodeFunctionData(method)},'latest']});
   for(const target of [d.address,d.token,d.receipt,d.adapter,d.dex])reads.push({label:`code.${target}`,method:'eth_getCode',params:[target,'latest']});
 }
 for(const a of deployment.actors)for(const tag of ['latest','pending'])reads.push({label:`${a.name}.nonce.${tag}`,method:'eth_getTransactionCount',params:[a.address,tag]});
 await recorder.checkpoint(reads);
 seedMetadata();
 app=await startServer(deployment);
 fs.writeFileSync('runtime/processes.json',json({server:process.pid,node:node?.pid??null,origin:app.origin,root:process.cwd(),scope:'FairFlow local-only',at:new Date().toISOString()}));
 console.log(`FairFlow running at ${app.origin}. Local synthetic assets; existing ledger ${hasLedger?'restored and verified':'created'}. Ctrl+C stops this application.`);
 const stop=async()=>{app.server.closeAllConnections();app.server.close();await recorder.flush();await recorder.close();node?.kill();await provider.destroy();process.exit(0)};
 process.once('SIGINT',()=>{stop().catch(()=>process.exit(1))});process.once('SIGTERM',()=>{stop().catch(()=>process.exit(1))});
 node?.once('exit',()=>{app.server.close();process.exit(0)});
}catch(e){node?.kill();console.error((e.message??'startup failed').split('\n')[0].slice(0,200));process.exit(1);}
