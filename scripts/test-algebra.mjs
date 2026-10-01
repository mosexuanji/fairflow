import fs from 'node:fs';
import assert from 'node:assert/strict';
import {parseEther} from 'ethers';
import {compile} from './build.mjs';
import {launchNode} from './local-node.mjs';
import {initialize,deploy,signer,attach,provider,tx,now,hash,json} from '../service/chain.mjs';
await compile();const node=await launchNode();let result;
try{
const d=await initialize({persist:false});const addr=n=>d.actors.find(a=>a.name===n).address;
const cash=attach('LocalCash',d.cash,await signer('admin'));
const p=await deploy('FairFlowProject',['Algebra ABI local check',d.cash,addr('reviewer'),addr('provider'),addr('admin'),parseEther('1000'),10_000_000n,60,3000,1_000_000_000n,'/template',hash('template')]);
const token=attach('ProjectToken',await p.token(),await signer('builder'));
await tx(cash.connect(await signer('agent')).approve(p.target,5_000_000n));
await tx(p.publishPolicy([10_000_000,20_000_000,200_000,1_000_000],Array(4).fill(hash('schema')),Array(4).fill('/schema'),hash('policy'),'/policy'));
const dex=await deploy('LocalAlgebraMock',[cash.target,token.target]);const adapter=await deploy('FixedAlgebraAdapter',[p.target,cash.target,token.target,dex.target,dex.target,dex.target,0]);
await tx(p.configureBuyback(adapter.target,addr('keeper'),1_000_000n,200_000n));
for(const [role,key] of [[0,'first-stage'],[1,'second-stage']]){await tx(p.createTask(hash(key),role,0,await now()+3600,'/task'));const id=await p.taskCount();const builder=p.connect(await signer('builder'));await tx(builder.acceptTask(id));await tx(builder.submit(id,0,addr('builder'),addr('builder'),hash(key+'-new-artifact'),'/new'));await tx(p.connect(await signer('reviewer')).validate(id));await provider.send('evm_increaseTime',[60]);await provider.send('evm_mine',[]);await tx(p.finalize(id));}
assert.equal(await p.grossIssued(),parseEther('2000'));await tx(token.burn(parseEther('800')));assert.equal(await p.quote(1_000_000),parseEther('100')/3n);assert.equal(await p.cumulativeRecognizedUnits(),30_000_000n);assert.equal(await token.totalSupply(),parseEther('1200'));
await tx(token.transfer(dex.target,parseEther('100')));await tx(cash.transfer(adapter.target,1));
const buyer=p.connect(await signer('agent'));await tx(buyer.placeOrder(hash('actual-test-order'),1_000_000,await now()+300,hash('format')));await tx(p.connect(await signer('provider')).deliver(1,hash('result'),'/result'));await tx(buyer.acceptOrder(1,hash('result')));
const keeper=p.connect(await signer('keeper'));await tx(dex.setMode(false,true));await assert.rejects(async()=>{await tx(keeper.buyback(100_000n,parseEther('1'),await now()+60))});assert.equal(await p.buybackBudget(),300_000n);
await tx(dex.setMode(false,false));await tx(keeper.buyback(100_000n,parseEther('1'),await now()+60));assert.equal(await token.totalBurned(),parseEther('801'));assert.equal(await p.grossIssued(),parseEther('2000'));assert.equal(await p.cumulativeRecognizedUnits(),30_000_000n);assert.equal(await cash.allowance(adapter.target,dex.target),0n);
result={at:new Date().toISOString(),status:'PASS_LOCAL_ABI_FIXTURE',officialDexVerified:false,checks:['exact 2000 issuance / 800 burn / stage3 next quote','Algebra tuple ABI locally exercised','missing pool budget preserved','adapter donation safe','atomic delta burn','minimal approvals cleared'],deployment:p.target};
}catch(e){result={status:'FAIL',error:e.message};throw e}finally{fs.writeFileSync('evidence/algebra-tests.json',json(result));await provider.destroy();node.kill();}
