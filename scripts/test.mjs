import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {compile} from './build.mjs';
import {launchNode} from './local-node.mjs';
import {initialize,attach,deploy,provider,signer,tx,now,hash,json} from '../service/chain.mjs';
import {parseEther} from 'ethers';
await compile();
const node=await launchNode();
const results=[];
const test=async(name,ids,fn)=>{try{await fn();results.push({name,ids,result:'PASS',scope:'LOCAL_CHAIN',at:new Date().toISOString()});console.log('PASS',name)}catch(e){results.push({name,ids,result:'FAIL',error:String(e),at:new Date().toISOString()});throw e}};
async function fails(fn){await assert.rejects(async()=>{const value=await fn();if(value?.wait)await value.wait();});}
try{
 const d=await initialize({persist:false});
 const p=attach('FairFlowProject',d.projects[0].address,await signer('admin'));
 const p2=attach('FairFlowProject',d.projects[1].address,await signer('admin'));
 const cash=attach('LocalCash',d.cash,await signer('admin'));
 const token=attach('ProjectToken',d.projects[0].token,await signer('builder'));
 const receipt=attach('Receipt',d.projects[0].receipt,await signer('builder'));
 const dex=attach('LocalDexMock',d.projects[0].dex,await signer('admin'));
 const addr=n=>d.actors.find(a=>a.name===n).address;
 const jump=async seconds=>{await provider.send('evm_increaseTime',[seconds]);await provider.send('evm_mine',[])};
 const conservation=async()=>assert((await p.accountedCash())<=await cash.balanceOf(p.target));
 const addTask=async(role,key,reward=0n,expires=3600)=>{await tx(p.createTask(hash(key),role,reward,await now()+expires,'/artifacts/task.json'));return await p.taskCount();};
 const submit=async(taskId,actor='builder',kind=0,beneficiary=addr(actor))=>{const a=p.connect(await signer(actor));await tx(a.acceptTask(taskId));await tx(a.submit(taskId,kind,addr(actor),beneficiary,hash(`new-evidence-${taskId}`),'/artifacts/delivery.json'));return await p.contributionCount();};
 const review=async(id)=>tx(p.connect(await signer('reviewer')).validate(id));
 const finish=async(id)=>{await review(id);await jump(60);await tx(p.finalize(id));};
 await test('zero supply and two project isolation',['A04'],async()=>{assert.equal(await token.totalSupply(),0n);assert.equal(await p2.grossIssued(),0n);assert.notEqual(await p.token(),await p2.token());assert.notEqual(await p.receipt(),await p2.receipt());assert.equal(await p2.bountyReserved(),0n);});
 await test('Solidity differential Python oracle, uint bounds, stage and dust',['A43','A44','A45','A47','A50'],async()=>{
   const vectors=JSON.parse(fs.readFileSync('evidence/reference-vectors.json','utf8'));const math=await deploy('MathHarness');
   for(const v of vectors.cumulativeVectors)assert.equal(await math.cumulative(v.credits,v.band,v.qFirst),BigInt(v.expected),v.id);
   for(const v of vectors.deltaVectors){const f0=await math.cumulative(v.previousCredits,v.band,v.qFirst);const f1=await math.cumulative(BigInt(v.previousCredits)+BigInt(v.addedCredits),v.band,v.qFirst);assert.equal(f1-f0,BigInt(v.expectedDelta),v.id);}
   for(const [c,h,q] of [[2n**128n,1n,1n],[0n,0n,1n],[0n,2n**96n,1n],[0n,1n,0n],[0n,1n,2n**64n]])await fails(async()=>math.cumulative(c,h,q));
 });
 let spec,adapterId;
 await test('roles do not confer permission; self review prohibited',['A06','A07','A13'],async()=>{
   spec=await submit(1,'builder');await fails(async()=>p.connect(await signer('builder')).validate(spec));await fails(async()=>token.mint(addr('builder'),1));await fails(async()=>p.connect(await signer('user')).publishPolicy([1,1,1,1],Array(4).fill(hash('x')),Array(4).fill('x'),hash('x'),'x'));
   const selfTask=await addTask(2,'self-review');const selfId=await submit(selfTask,'reviewer');await fails(async()=>p.connect(await signer('reviewer')).validate(selfId));
 });
 await test('review delay, immutable finalization and single receipt',['A08','A09','A15','A12'],async()=>{
   await fails(async()=>p.finalize(spec));await review(spec);await fails(async()=>p.finalize(spec));await jump(60);await tx(p.finalize(spec));
   assert.equal(await token.totalSupply(),parseEther('1000'));assert.equal(await receipt.ownerOf(spec),addr('builder'));await fails(async()=>p.finalize(spec));await fails(async()=>p.connect(await signer('reviewer')).reject(spec));
 });
 await test('rule version freezes accepted credit, cash and evidence; no reset',['A05','A49'],async()=>{
   adapterId=await submit(2,'agent',1);
   const prior=await p.tasks(2);await tx(p.publishPolicy([20_000_000,9_000_000,300_000,1_000_000],Array(4).fill(hash('schema-v2')),Array(4).fill('/v2'),hash('v2'),'/v2'));
   const after=await p.tasks(2);assert.equal(after.credits,prior.credits);assert.equal(after.reward,prior.reward);assert.equal(after.evidenceSchema,prior.evidenceSchema);assert.equal(await p.cumulativeRecognizedUnits(),10_000_000n);
 });
 await test('cash failure keeps claimable; does not reissue FT',['A17','A18','A19','A20'],async()=>{
   await fails(async()=>p.refundTask(2));await finish(adapterId);const issued=await p.grossIssued();assert.equal(await p.claimable(adapterId),10_000_000n);
   await tx(cash.setFail(true));await fails(async()=>p.connect(await signer('agent')).claimBounty(adapterId));assert.equal(await p.claimable(adapterId),10_000_000n);assert.equal(await p.grossIssued(),issued);
   await tx(cash.setFail(false));await tx(p.connect(await signer('agent')).claimBounty(adapterId));await fails(async()=>p.connect(await signer('agent')).claimBounty(adapterId));assert.equal(await p.grossIssued(),issued);await conservation();
   await fails(async()=>p.createTask(hash('unfunded'),0,1_000_000_000n,await now()+300,'/unfunded'));
 });
 await test('canonical identity dedup cross-address role version; pending squatter no global lock',['A10','A48'],async()=>{
   const duplicate=await addTask(3,'new-spec-v1');const id=await submit(duplicate,'user');await review(id);await jump(60);const before=await p.grossIssued();await fails(async()=>p.finalize(id));assert.equal(await p.grossIssued(),before);await tx(p.connect(await signer('reviewer')).reject(id));
   const attack=await addTask(2,'shared-canonical');const honest=await addTask(3,'shared-canonical');const bad=await submit(attack,'agent',1);const good=await submit(honest,'user');await finish(good);await tx(p.connect(await signer('reviewer')).reject(bad));
 });
 await test('canceled/rejected/expired sponsor refund and slot exclusivity',['A09','A19'],async()=>{
   const task=await addTask(1,'refund-slot',1_000_000n,120);const id=await submit(task,'builder');await fails(async()=>p.connect(await signer('user')).acceptTask(task));await fails(async()=>p.cancelTask(task));await fails(async()=>p.refundTask(task));await jump(121);await tx(p.expire(task));await tx(p.refundTask(task));await fails(async()=>p.refundTask(task));await fails(async()=>p.finalize(id));await conservation();
   const canceled=await addTask(1,'cancel-open',1_000_000n);await tx(p.cancelTask(canceled));await tx(p.refundTask(canceled));
 });
 await test('receipt nontransferable; FT transferable; burns leave progress monotone',['A14','A16','A46'],async()=>{
   await fails(async()=>receipt.transferFrom(addr('builder'),addr('user'),spec));await fails(async()=>receipt.approve(addr('user'),spec));await fails(async()=>receipt.setApprovalForAll(addr('user'),true));
   const c=await p.cumulativeRecognizedUnits();const g=await p.grossIssued();const quote=await p.quote(1_000_000);
   await tx(token.transfer(addr('user'),parseEther('25')));await tx(token.burn(parseEther('800')));
   assert.equal(await p.cumulativeRecognizedUnits(),c);assert.equal(await p.grossIssued(),g);assert.equal(await p.quote(1_000_000),quote);assert.equal(await token.totalSupply(),g-await token.totalBurned());
   await fails(async()=>token.burnFrom(addr('user'),parseEther('1')));
 });
 await test('service delivery buyer acceptance only; refund/revenue partition and rounding',['A22','A23','A24','A25','A20'],async()=>{
   const buyer=p.connect(await signer('agent'));await tx(buyer.placeOrder(hash('service-order-1'),1_000_001n,await now()+300,hash('format-v1')));const id=await p.orderCount();assert.equal(await p.buybackBudget(),0n);await fails(async()=>buyer.placeOrder(hash('service-order-1'),1n,await now()+300,hash('format')));
   await fails(async()=>buyer.acceptOrder(id,hash('report')));await fails(async()=>p.deliver(id,hash('report'),'/result'));
   await tx(p.connect(await signer('provider')).deliver(id,hash('report'),'/result'));
   await fails(async()=>p.connect(await signer('provider')).acceptOrder(id,hash('report')));await fails(async()=>buyer.acceptOrder(id,hash('wrong')));await tx(buyer.acceptOrder(id,hash('report')));await fails(async()=>buyer.acceptOrder(id,hash('report')));
   assert.equal(await p.buybackBudget(),300_000n);assert.equal(await p.operationsBudget(),700_001n);assert.equal(await p.refundableServices(),0n);
   await tx(cash.transfer(p.target,123));assert.equal(await p.buybackBudget(),300_000n);assert.equal(await p.settledRevenue(),1_000_001n);
   await tx(buyer.placeOrder(hash('refund-undelivered'),500_000n,await now()+5,hash('format')));const refundId=await p.orderCount();await fails(async()=>buyer.refundOrder(refundId));await jump(6);await tx(buyer.refundOrder(refundId));await fails(async()=>buyer.refundOrder(refundId));
   await tx(buyer.placeOrder(hash('refund-delivered'),500_000n,await now()+5,hash('format')));const accepted=await p.orderCount();await tx(p.connect(await signer('provider')).deliver(accepted,hash('result'),'/result'));await jump(6);await tx(buyer.refundOrder(accepted));await conservation();
 });
 await test('protected atomic mock swap/burn: missing pool/slippage/reentrancy rollback',['A32','A33','A34','A35'],async()=>{
   await tx(token.transfer(dex.target,parseEther('100')));await tx(cash.transfer(d.projects[0].adapter,1));
   const keeper=p.connect(await signer('keeper'));const budget=await p.buybackBudget();const credit=await p.cumulativeRecognizedUnits();const gross=await p.grossIssued();const burned=await token.totalBurned();
   await fails(async()=>keeper.buyback(100_000n,0,await now()+60));await fails(async()=>keeper.buyback(100_000n,1n,await now()+60));await fails(async()=>p.buyback(100_000n,parseEther('1'),await now()+60));await fails(async()=>keeper.buyback(100_000n,parseEther('1'),await now()+600));
   for(const mode of [[true,false,false],[false,true,false],[false,false,true]]){await tx(dex.setMode(...mode));await fails(async()=>keeper.buyback(100_000n,parseEther('1'),await now()+60));assert.equal(await p.buybackBudget(),budget);assert.equal(await token.totalBurned(),burned);}
   await tx(dex.setMode(false,false,false));await fails(async()=>keeper.buyback(100_000n,parseEther('2'),await now()+60));await tx(keeper.buyback(100_000n,parseEther('1'),await now()+60));
   assert.equal(await token.totalBurned(),burned+parseEther('1'));assert.equal(await p.buybackBudget(),budget-100_000n);assert.equal(await p.cumulativeRecognizedUnits(),credit);assert.equal(await p.grossIssued(),gross);
   assert.equal(await cash.allowance(p.target,d.projects[0].adapter),0n);assert.equal(await cash.allowance(d.projects[0].adapter,dex.target),0n);await conservation();
 });
 const model=spawnSync(process.execPath,['--test','tests/service.test.mjs'],{encoding:'utf8',windowsHide:true});
 fs.writeFileSync('evidence/service-tests.txt',model.stdout+model.stderr);if(model.status!==0)throw Error('Service/guard tests failed');
 results.push({name:'deterministic evaluation and independent agent guard',ids:['A11','A21','A27','A28','A29','A30'],result:'PASS',scope:'LOCAL_SERVICE',at:new Date().toISOString()});
 const {readState}=await import('../service/chain.mjs');fs.writeFileSync('evidence/local-chain-final-state.json',json(await readState(d)));
 fs.writeFileSync('evidence/local-deployments-test.json',json(d));
}finally{
 fs.writeFileSync('evidence/local-chain-tests.json',JSON.stringify({at:new Date().toISOString(),results},null,2));
 await provider.destroy();node.kill();
}
