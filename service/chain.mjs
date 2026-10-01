import fs from 'node:fs';
import {Contract,ContractFactory,JsonRpcProvider,keccak256,toUtf8Bytes,parseEther} from 'ethers';
export const config=JSON.parse(fs.readFileSync('config/candidate.json','utf8'));
export const provider=new JsonRpcProvider(config.rpc,31337,{staticNetwork:true,cacheTimeout:-1});
provider.pollingInterval=100;
export const names=['admin','reviewer','builder','user','agent','provider','keeper'];
export const hash=s=>keccak256(toUtf8Bytes(s));
export const artifact=name=>JSON.parse(fs.readFileSync(`dist/contracts/${name}.json`,'utf8'));
export const attach=(name,address,signer=provider)=>new Contract(address,artifact(name).abi,signer);
export async function actors(){return Promise.all(names.map(async(name,i)=>({name,address:await(await provider.getSigner(i)).getAddress(),kind:name==='agent'?'Agent':'Human'})));}
export async function signer(name){const i=names.indexOf(name);if(i<0)throw Error('Unknown local actor');return provider.getSigner(i);}
export async function deploy(name,args=[],who='admin'){
  const a=artifact(name);const c=await new ContractFactory(a.abi,a.bytecode,await signer(who)).deploy(...args);await c.waitForDeployment();return c;
}
export async function tx(p){const t=await p;const r=await t.wait();if(r.status!==1)throw Error('Transaction reverted');return r;}
export async function now(){return Number((await provider.getBlock('latest')).timestamp);}
export async function assertLocal(){const id=Number(BigInt(await provider.send('eth_chainId',[])));if(id!==31337 || config.chainId!==31337 || !/^http:\/\/127\.0\.0\.1:\d+$/.test(config.rpc))throw Error('Local-only chain required; public writes not authorized');}
export function seedMetadata(){
  fs.mkdirSync('runtime/artifacts',{recursive:true});
  const files={
    'template-v1.json':'FairFlow exact-match evaluation template v1; synthetic samples',
    'rules-v1.json':'schema-evaluation-v1',
    'policy-v1.json':'policy-v1',
    'spec-task.json':JSON.stringify({kind:'new specification implementation',credits:'10000000',reward:'0',version:1}),
    'adapter-task.json':JSON.stringify({kind:'fresh inspectable evaluation artifact',credits:'3000000',reward:'10000000',version:1,requiredFields:['id','input','expected','actual']}),
    'correction-task.json':JSON.stringify({kind:'reproducible correction',credits:'500000',reward:'0',version:1}),
    'promotion-task.json':JSON.stringify({kind:'nonduplicate promotion attribution',credits:'200000',reward:'0',version:1})
  };
  for(const [name,bytes] of Object.entries(files)){const file=`runtime/artifacts/${name}`;if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')!==bytes)throw Error('Immutable metadata mismatch');if(!fs.existsSync(file))fs.writeFileSync(file,bytes);}
}
export async function initialize({persist=true}={}){
  await assertLocal();
  if(persist)seedMetadata();
  const people=await actors();
  const address=n=>people.find(a=>a.name===n).address;
  const cash=await deploy('LocalCash');
  for(const a of people)await tx(cash.faucet(a.address,100_000_000n));
  const template=hash('FairFlow exact-match evaluation template v1; synthetic samples');
  const projects=[];
  for(let i=1;i<=2;i++){
    const project=await deploy('FairFlowProject',[i===1?'FairFlow Evaluation':'Isolation Check',cash.target,address('reviewer'),address('provider'),address('admin'),BigInt(config.bandAtoms),BigInt(config.firstStageCreditAtoms),config.reviewDelaySeconds,config.buybackBps,1_000_000_000n,'/artifacts/template-v1.json',template]);
    for(const a of people)await tx(cash.connect(await signer(a.name)).approve(project.target,100_000_000n));
    await tx(project.publishPolicy([10_000_000,3_000_000,200_000,500_000],Array(4).fill(hash('schema-evaluation-v1')),Array(4).fill('/artifacts/rules-v1.json'),hash('policy-v1'),'/artifacts/policy-v1.json'));
    const dex=await deploy('LocalDexMock',[cash.target,await project.token(),10n**13n]);
    const adapter=await deploy('FixedDexAdapter',[project.target,cash.target,await project.token(),dex.target,dex.target,dex.target]);
    await tx(project.configureBuyback(adapter.target,address('keeper'),1_000_000n,200_000n));
    projects.push({id:String(i),address:project.target,name:i===1?'FairFlow Evaluation':'Isolation Check',token:await project.token(),receipt:await project.receipt(),dex:dex.target,adapter:adapter.target,deployHash:project.deploymentTransaction().hash});
  }
  const project=attach('FairFlowProject',projects[0].address,await signer('admin'));
  const deadline=await now()+86400;
  for(const [key,role,reward,uri] of [['new-spec-v1',0,0,'/artifacts/spec-task.json'],['evaluation-adapter-v1',1,10_000_000,'/artifacts/adapter-task.json'],['correction-sample-v1',3,0,'/artifacts/correction-task.json'],['promotion-attribution-v1',2,0,'/artifacts/promotion-task.json']])await tx(project.createTask(hash(key),role,reward,deadline,uri));
  const state={schemaVersion:1,scope:'DISPOSABLE_LOCAL_CHAIN_ONLY',chainId:31337,at:new Date().toISOString(),cash:cash.target,actors:people,projects};
  if(persist){fs.mkdirSync('runtime',{recursive:true});fs.writeFileSync('runtime/deployment.json',JSON.stringify(state,null,2));}
  return state;
}
export async function readState(deployment){
  await assertLocal();
  const state={network:{chainId:31337,scope:'DISPOSABLE_LOCAL_CHAIN_ONLY'},config,actors:deployment.actors,projects:[]};
  const taskStates=['OPEN','ACCEPTED','SUBMITTED','COMPLETED','CANCELED'];const conStates=['SUBMITTED','VALIDATED','FINALIZED','REJECTED','EXPIRED'];const orderStates=['FUNDED','DELIVERED','SETTLED','REFUNDED'];
  for(const d of deployment.projects){
    const p=attach('FairFlowProject',d.address);const token=attach('ProjectToken',d.token);
    const policyVersion=Number(await p.policyVersion());
    const out={...d,policyVersion,credits:await p.cumulativeRecognizedUnits(),grossIssued:await p.grossIssued(),totalBurned:await token.totalBurned(),totalSupply:await token.totalSupply(),buckets:{bountyReserved:await p.bountyReserved(),claimable:await p.bountyClaimable(),refundable:await p.refundableServices(),operations:await p.operationsBudget(),buyback:await p.buybackBudget()},cashBalance:await attach('LocalCash',deployment.cash).balanceOf(p.target),rules:[],tasks:[],contributions:[],orders:[],balances:[]};
    for(const a of deployment.actors)out.balances.push({actor:a.name,address:a.address,token:await token.balanceOf(a.address),cash:await attach('LocalCash',deployment.cash).balanceOf(a.address)});
    for(let v=1;v<=policyVersion;v++)for(let role=0;role<4;role++){const r=await p.rules(v,role);out.rules.push({version:v,role,credits:r.credits,evidenceDigest:r.evidenceSchema,uri:r.uri});}
    for(let i=1;i<=Number(await p.taskCount());i++){const t=await p.tasks(i);out.tasks.push({id:String(i),behaviorId:t.behaviorId,role:Number(t.role),version:Number(t.version),credits:t.credits,reward:t.reward,expiresAt:Number(t.expiresAt),sponsor:t.sponsor,assignee:t.assignee,status:taskStates[Number(t.status)],evidenceDigest:t.evidenceSchema,uri:t.uri,estimatedFT:await p.quote(t.credits)});}
    for(let i=1;i<=Number(await p.contributionCount());i++){const c=await p.contributions(i);out.contributions.push({id:String(i),taskId:c.taskId,actor:c.actor,operator:c.operator,beneficiary:c.beneficiary,actorType:Number(c.actorType),role:Number(c.role),status:conStates[Number(c.status)],submittedAt:Number(c.submittedAt),validatedAt:Number(c.validatedAt),finalizedAt:Number(c.finalizedAt),credits:c.credits,minted:c.minted,progressBefore:c.progressBefore,digest:c.digest,uri:c.uri,claimable:await p.claimable(i)});}
    for(let i=1;i<=Number(await p.orderCount());i++){const o=await p.orders(i);out.orders.push({id:String(i),buyer:o.buyer,price:o.price,status:orderStates[Number(o.status)],deadline:Number(o.deadline),formatDigest:o.formatDigest,resultDigest:o.resultDigest,uri:o.uri});}
    state.projects.push(out);
  }
  return state;
}
export const json=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2);
