import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {hash,attach,signer,now,readState,json,config,provider,assertLocal} from './chain.mjs';
import {evaluate,canonicalize} from './evaluation.mjs';
import {createSession,checkProposal,commitProposal} from './agent-guard.mjs';
import {ownedRuntime} from './journal.mjs';

export async function startServer(deployment,{port=config.port,restore=true,runtimeDir='runtime'}={}){
 await assertLocal();
 const appDir=ownedRuntime(runtimeDir);
 const dataFile=path.join(appDir,'app-data.json');
 const capability=randomBytes(32).toString('hex');
 const address=n=>deployment.actors.find(a=>a.name===n)?.address;
 let data=restore&&fs.existsSync(dataFile)?JSON.parse(fs.readFileSync(dataFile,'utf8')):{transactions:[],evaluations:[],agentRuns:[],agentIntents:[],session:null};
 data.agentIntents??=[];
 // Deployment identity prevents attaching archived data to a silently reset chain.
 if(data.deploymentHash && data.deploymentHash!==deployment.projects[0].deployHash)throw Error('Deployment/data mismatch: preserve archive and restore explicitly');
 data.deploymentHash=deployment.projects[0].deployHash;
 if(!data.session)data.session={id:'local-agent-1',chainId:31337,actor:address('agent'),target:deployment.projects[0].address,token:deployment.cash,recipient:address('agent'),expiresAt:String(await now()+86400),perAction:config.agentPerActionCashAtoms,limit:config.agentSessionCashAtoms};
 const session=createSession(data.session);
 // Reconcile durable intents before rebuilding the grant. Unknown outcomes keep it locked.
 for(const intent of data.agentIntents.filter(i=>['PREPARED','PENDING','UNCERTAIN','CONFIRMED'].includes(i.status)&&!data.agentRuns.some(r=>r.intentId===i.id))){
   if(!intent.hash && intent.expectedData){
     const head=await provider.getBlockNumber();
     if(head-Number(intent.startBlock)<=256)for(let b=Number(intent.startBlock);b<=head;b++){
       const block=await provider.getBlock(b,true);
       for(const transaction of block?.prefetchedTransactions??[])if(transaction.from.toLowerCase()===session.actor.toLowerCase() && transaction.to?.toLowerCase()===session.target.toLowerCase() && transaction.data===intent.expectedData && transaction.nonce===intent.expectedNonce)intent.hash=transaction.hash;
     }
   }
   const receipt=intent.hash?await provider.getTransactionReceipt(intent.hash):null;
   if(intent.status==='CONFIRMED'&&!intent.expectedData){} // zero-cost read, no broadcast
   else if(receipt){intent.status=receipt.status===1?'CONFIRMED':'REVERTED';}
   else if(!intent.hash && !intent.expectedData)intent.status='UNSENT'; // interrupted read has no economic action
   else intent.status='UNCERTAIN';
   if(intent.status==='CONFIRMED'&&!data.agentRuns.some(r=>r.intentId===intent.id))data.agentRuns.push({id:`agent-run-${data.agentRuns.length+1}`,intentId:intent.id,kind:'UNVERIFIED_PROPOSAL',checkedAt:intent.checkedAt,status:'CONFIRMED',normalizedAction:intent.normalizedAction,hash:intent.hash,at:new Date().toISOString(),recovered:true});
 }
 let spent='0',nextNonce=0n;
 for(const run of data.agentRuns.filter(r=>r.status==='CONFIRMED')){
   const checked=checkProposal(session,run.normalizedAction,Number(run.checkedAt));
   const result=commitProposal(session,checked);spent=result.spent;const successor=BigInt(checked.nonce)+1n;if(successor>nextNonce)nextNonce=successor;
 }
 const persist=()=>{const temp=path.join(appDir,'app-data.tmp');fs.writeFileSync(temp,json(data));fs.renameSync(temp,dataFile);};
 persist();
 let queue=Promise.resolve();
 const serialized=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
 const project=id=>{const d=deployment.projects.find(p=>p.id===String(id));if(!d)throw Error('Unknown project');return d;};
 const uint=(v,name)=>{if(typeof v!=='string'&&typeof v!=='number')throw Error(`${name} integer required`);if(typeof v==='number'&&!Number.isSafeInteger(v))throw Error(`${name} unsafe integer; use decimal string`);if(!/^(0|[1-9][0-9]*)$/.test(String(v)))throw Error(`${name} integer required`);return BigInt(v);};
 const number=(v,name,max=2**32-1)=>{const n=uint(v,name);if(n>BigInt(max))throw Error(`${name} range`);return Number(n)};
 const logTx=async(action,promise,intent)=>{
   let item={action,status:'PENDING',at:new Date().toISOString()};data.transactions.push(item);persist();
   try{const tx=await promise;item.hash=tx.hash;if(intent){intent.hash=tx.hash;intent.status='PENDING';}persist();const receipt=await tx.wait();if(receipt.status!==1){item.status='REVERTED';if(intent)intent.status='REVERTED';throw Error('Observed reverted receipt');}item.status='CONFIRMED';item.block=receipt.blockNumber;if(intent)intent.status='CONFIRMED';persist();return{hash:tx.hash,status:'CONFIRMED'};}
   catch(e){if(item.status!=='REVERTED')item.status=e.receipt?.status===0?'REVERTED':(!item.hash&&e.action==='estimateGas'?'REJECTED_BEFORE_SEND':'UNKNOWN');if(intent)intent.status=item.status==='UNKNOWN'?'UNCERTAIN':item.status;item.error=e.shortMessage??e.message;persist();throw e;}
 };
 async function action(body,guarded=false,intent){
   const {action:method,actor,projectId}=body;
   if(typeof method!=='string'||typeof actor!=='string')throw Error('Action and actor required');
   if(actor==='agent'&&!guarded&&['submit','order','claimBounty','acceptOrder'].includes(method))throw Error('Agent economic actions require independent session guard');
   const p=attach('FairFlowProject',project(projectId).address,await signer(actor));
   const secs=()=>number(body.expiresIn??3600,'expiresIn',86400);
   const id=key=>uint(body[key],key);
   let call;
   switch(method){
     case'publishRule':{
       if(!Array.isArray(body.credits)||body.credits.length!==4)throw Error('Four credit amounts required');
       const schemas=body.schemas??Array(4).fill(hash('schema-evaluation-v1'));
       const version=Number(await p.policyVersion())+1;
       const uris=body.uris??body.credits.map((credits,role)=>{const bytes=canonicalize({credits,role,version,evidenceSchema:schemas[role]});const name=`rule-${hash(bytes).slice(2)}.json`;fs.mkdirSync(path.join(appDir,'artifacts'),{recursive:true});fs.writeFileSync(path.join(appDir,'artifacts',name),bytes);return `/artifacts/${name}`});
       const bytes=canonicalize({credits:body.credits,schemas,uris,version});const digest=hash(bytes);const name=`policy-${digest.slice(2)}.json`;fs.mkdirSync(path.join(appDir,'artifacts'),{recursive:true});fs.writeFileSync(path.join(appDir,'artifacts',name),bytes);
       call=p.publishPolicy(body.credits.map(v=>uint(v,'credits')),schemas,uris,digest,`/artifacts/${name}`);break;
     }
     case'createTask':if(typeof body.behaviorKey!=='string'||!body.behaviorKey.trim())throw Error('Predefined behavior key required');call=p.createTask(hash(body.behaviorKey),number(body.role,'role',3),uint(body.reward??'0','reward'),await now()+secs(),body.uri);break;
     case'acceptTask':call=p.acceptTask(id('taskId'));break;
     case'submit':call=p.submit(id('taskId'),number(body.actorType??0,'actorType',2),body.operator,body.beneficiary,body.digest,body.uri);break;
     case'validate':call=p.validate(id('contributionId'));break;
     case'reject':call=p.reject(id('contributionId'));break;
     case'finalize':call=p.finalize(id('contributionId'));break;
     case'claimBounty':call=p.claimBounty(id('contributionId'));break;
     case'expire':call=p.expire(id('taskId'));break;
     case'cancelTask':call=p.cancelTask(id('taskId'));break;
     case'refundTask':call=p.refundTask(id('taskId'));break;
     case'order':call=p.placeOrder(hash(String(body.clientKey)),uint(body.price,'price'),body.deadline??await now()+secs(),body.formatDigest??hash('exact-json-format-v1'));break;
     case'deliver':{const e=data.evaluations.find(e=>e.id===body.evaluationId);if(!e)throw Error('Actual saved evaluation required');call=p.deliver(id('orderId'),e.digest,e.uri);break;}
     case'acceptOrder':{const o=await p.orders(id('orderId'));call=p.acceptOrder(id('orderId'),o.resultDigest);break;}
     case'refundOrder':call=p.refundOrder(id('orderId'));break;
     case'buyback':call=p.buyback(uint(body.amount,'amount'),uint(body.minOut,'minOut'),await now()+number(body.expiresIn??60,'expiresIn',300));break;
     case'transfer':call=attach('ProjectToken',project(projectId).token,await signer(actor)).transfer(body.to,uint(body.amount,'amount'));break;
     default:throw Error('Method is not permitted');
   }
   return logTx(method,call,intent);
 }
 async function executeProposalInternal(body){
   if(data.agentIntents.some(i=>['PREPARED','PENDING','UNCERTAIN'].includes(i.status)))throw Error('Agent grant locked pending transaction reconciliation');
   const checkedAt=await now();
   if(body.sessionId!==session.id)throw Error('Session mismatch');
   const checked=checkProposal(session,body.proposal,checkedAt);
   const pid=deployment.projects.find(p=>p.address.toLowerCase()===checked.target.toLowerCase())?.id;
   if(!pid)throw Error('Target mismatch');
   const args=checked.args;
   const contract=attach('FairFlowProject',checked.target,await signer('agent'));
   let expectedData=null,expectedNonce=await provider.getTransactionCount(session.actor,'latest');
   if(checked.method==='order')expectedData=contract.interface.encodeFunctionData('placeOrder',[hash(String(args.clientKey)),checked.amount,args.deadline,args.formatDigest??hash('exact-json-format-v1')]);
   if(checked.method==='claim')expectedData=contract.interface.encodeFunctionData('claimBounty',[args.contributionId]);
   if(checked.method==='accept')expectedData=contract.interface.encodeFunctionData('acceptOrder',[args.orderId,args.resultDigest]);
   if(checked.method==='submit'){
     const task=await contract.tasks(uint(args.taskId,'taskId'));if(Number(task.status)===0)expectedNonce++;
     expectedData=contract.interface.encodeFunctionData('submit',[args.taskId,1,session.actor,session.recipient,args.digest,args.uri]);
   }
   const intent={id:`intent-${data.agentIntents.length+1}`,status:'PREPARED',checkedAt,normalizedAction:checked,expectedData,expectedNonce,startBlock:await provider.getBlockNumber()};data.agentIntents.push(intent);persist();
   try{
   let result={status:'CONFIRMED'};
   if(checked.method==='submit'){
     const p=attach('FairFlowProject',checked.target,await signer('agent'));
     const task=await p.tasks(uint(args.taskId,'taskId'));
     if(args.behaviorId!==undefined&&args.behaviorId!==task.behaviorId)throw Error('Frozen behavior identity mismatch');
     if(args.role!==undefined&&number(args.role,'role',3)!==Number(task.role))throw Error('Frozen role mismatch');
     if(args.version!==undefined&&number(args.version,'version')!==Number(task.version))throw Error('Frozen policy version mismatch');
     if(Number(task.status)===0)await logTx('agent.acceptTask',p.acceptTask(args.taskId));
     result=await action({action:'submit',actor:'agent',projectId:pid,taskId:args.taskId,actorType:1,operator:session.actor,beneficiary:session.recipient,digest:args.digest,uri:args.uri},true,intent);
   }else if(checked.method==='order'){
     const deadline=number(args.deadline,'deadline',Number.MAX_SAFE_INTEGER);
     if(deadline<=checkedAt||deadline>Number(checked.expiresAt))throw Error('Order expiry exceeds grant');
     if(typeof args.clientKey!=='string'||!args.clientKey)throw Error('Client order key required');
     result=await action({action:'order',actor:'agent',projectId:pid,price:checked.amount,deadline,clientKey:args.clientKey,formatDigest:args.formatDigest},true,intent);
   }else if(checked.method==='claim')result=await action({action:'claimBounty',actor:'agent',projectId:pid,contributionId:args.contributionId},true,intent);
   else if(checked.method==='accept'){
     const order=await contract.orders(uint(args.orderId,'orderId'));
     if(order.buyer.toLowerCase()!==session.actor.toLowerCase() || order.resultDigest!==args.resultDigest || !data.evaluations.some(e=>e.digest===args.resultDigest))throw Error('Own delivered order and saved matching result required');
     result=await action({action:'acceptOrder',actor:'agent',projectId:pid,orderId:args.orderId},true,intent);
   }
   const committed=commitProposal(session,checked);spent=committed.spent;const successor=BigInt(checked.nonce)+1n;if(successor>nextNonce)nextNonce=successor;intent.status='CONFIRMED';
   const run={id:`agent-run-${data.agentRuns.length+1}`,intentId:intent.id,kind:'UNVERIFIED_PROPOSAL',checkedAt,status:result.status,normalizedAction:checked,hash:result.hash,spent:committed.spent,at:new Date().toISOString()};
   // Trusted provenance is separately attached by the launch integration owner, never from model output.
   data.agentRuns.push(run);persist();return{...result,normalizedAction:checked,...committed};
   }catch(e){if(intent.status==='PREPARED')intent.status='REJECTED_BEFORE_SEND';persist();throw e;}
 }
 const executeProposal=body=>serialized(()=>executeProposalInternal(body));
 const decoratedRuns=()=>{
   let record=null;try{const candidate=JSON.parse(fs.readFileSync('evidence/live-model-bridge.json','utf8'));if(createHash('sha256').update(fs.readFileSync('evidence/model-proposal.json')).digest('hex')===candidate.proposalSha256)record=candidate;}catch{}
   return data.agentRuns.map(run=>({...run,provenance:record?.normalizedActionFingerprints?.includes(hash(canonicalize(run.normalizedAction)))?'LIVE_CODEX_ASSISTED_BRIDGE (fresh model, integration-owner mediated)':'LOCAL_SCRIPT_OR_UNVERIFIED_PROPOSAL'}));
 };
 const origin=`http://127.0.0.1:${port}`;
 const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(json(value))};
 async function body(req){
   if(!String(req.headers['content-type']).startsWith('application/json'))throw Error('JSON required');
   const chunks=[];let bytes=0;for await(const c of req){bytes+=c.length;if(bytes>1_048_576)throw Error('Body too large');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }
 const server=http.createServer(async(req,res)=>{
   res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
   try{
     if(req.headers.host!==`127.0.0.1:${port}`)return send(res,403,{error:'Host rejected'});
     if(req.headers.origin&&req.headers.origin!==origin)return send(res,403,{error:'Origin rejected'});
     const url=new URL(req.url,origin);
     if(req.method==='GET'&&url.pathname==='/api/local-session')return send(res,200,{capability,scope:'LOCAL_OWNER_CONTROL_ONLY'});
     if(req.method==='GET'&&url.pathname==='/api/state')return send(res,200,{...await readState(deployment),cash:deployment.cash,transactions:data.transactions,evaluations:data.evaluations,agentRuns:decoratedRuns(),agent:{session,nonce:nextNonce.toString(),spent,runs:decoratedRuns(),locked:data.agentIntents.some(i=>['PREPARED','PENDING','UNCERTAIN'].includes(i.status))}});
     if(req.method==='GET'&&/^\/api\/tx\/0x[0-9a-fA-F]{64}$/.test(url.pathname)){const hash=url.pathname.split('/').at(-1);return send(res,200,await provider.getTransactionReceipt(hash));}
     if(req.method==='GET'&&/^\/transactions\/0x[0-9a-fA-F]{64}$/.test(url.pathname)){
       const txHash=url.pathname.split('/').at(-1);const receipt=await provider.getTransactionReceipt(txHash);
       const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
       const status=receipt?(receipt.status===1?'CONFIRMED':'REVERTED'):'PENDING_OR_NOT_FOUND';
       res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
       return res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FairFlow · Local transaction</title><link rel="stylesheet" href="/styles.css"></head><body><main class="main transaction-page"><a href="/">← FairFlow workspace</a><h1>Local transaction evidence</h1><p>Chain 31337 · disposable local fixture. This is not a public explorer or official-asset transaction.</p><h2>${status}</h2><p class="mono">${escape(txHash)}</p><pre>${escape(json(receipt))}</pre></main></body></html>`);
     }
     if(req.method==='POST'){
       if(req.headers.origin!==origin||req.headers['x-fairflow-capability']!==capability)return send(res,403,{error:'Local capability and same origin required'});
       const input=await body(req);
       if(url.pathname==='/api/action')return send(res,200,await serialized(()=>action(input)));
       if(url.pathname==='/api/evaluate'){
         const evaluation=evaluate(input.samples);const id=`evaluation-${evaluation.digest.slice(2,18)}`;const uri=`/artifacts/${id}.json`;
         const record={id,...evaluation,uri,at:new Date().toISOString()};fs.mkdirSync(path.join(appDir,'artifacts'),{recursive:true});fs.writeFileSync(path.join(appDir,'artifacts',`${id}.json`),canonicalize({samples:input.samples,report:evaluation.report}));
         if(!data.evaluations.some(e=>e.id===id))data.evaluations.push(record);persist();return send(res,200,record);
       }
       if(url.pathname==='/api/agent/propose')return send(res,200,await executeProposal(input));
       return send(res,404,{error:'No such endpoint'});
     }
     if(req.method!=='GET')return send(res,405,{error:'Method rejected'});
     if(/^\/artifacts\/[a-zA-Z0-9._-]+\.json$/.test(url.pathname)){
       const filename=path.join(appDir,url.pathname);if(fs.existsSync(filename)){const bytes=fs.readFileSync(filename);let contentType='application/json';try{JSON.parse(bytes.toString('utf8'))}catch{contentType='text/plain; charset=utf-8'}res.writeHead(200,{'Content-Type':contentType});return res.end(bytes);}
     }
     const files={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css'};
     const filename=files[url.pathname];if(!filename)return send(res,404,{error:'Not found'});
     res.writeHead(200,{'Content-Type':filename.endsWith('.html')?'text/html':filename.endsWith('.css')?'text/css':'application/javascript'});res.end(fs.readFileSync(`dist/web/${filename}`));
   }catch(e){send(res,400,{error:e.shortMessage??e.message});}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
 return{server,origin,data,session,action,executeProposal,persist};
}
