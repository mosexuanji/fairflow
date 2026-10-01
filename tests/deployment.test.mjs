import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { ContractFactory, Interface, JsonRpcProvider, formatEther, getAddress, getCreateAddress, keccak256 } from 'ethers';
import { ROOT, USDG, assertSepolia, configPath, constructorArgs, executeDeployment, loadArtifact, loadConfig, metadataRecord, parseCli, planHash, policyArgs, preparePlan, sha256, validateConfig, verifyApproval } from '../scripts/deploy-sepolia.mjs';
import { smokeProject, verifyDeploymentRecord } from '../scripts/smoke-sepolia.mjs';

const ownerConfig = () => {
  const c = loadConfig();
  c.addresses = { owner: '0x1111111111111111111111111111111111111111', reviewer: '0x2222222222222222222222222222222222222222', serviceProvider: '0x3333333333333333333333333333333333333333', operationsRecipient: '0x1111111111111111111111111111111111111111' };
  return c;
};
test('preparation defaults have no signer, no deployment address and only two zero-value transactions', async () => {
  const c = loadConfig(), plan = await preparePlan(c);
  assert.equal(parseCli([]).execute, false);
  assert.equal(parseCli([]).offline, false);
  assert.equal(parseCli(['--offline']).offline, true);
  assert.equal(plan.transactions.length, 2);
  assert.equal(plan.transactions[0].data, null);
  assert.equal(plan.missingOwnerAddresses.length, 4);
  assert.equal(plan.deployment.project, null);
  assert(plan.transactions.every(t => t.value === '0'));
  assert(plan.excludedActions.includes('pool_creation'));
  assert(plan.excludedActions.includes('cash_approval'));
  const ready = await preparePlan(ownerConfig());
  assert(ready.transactions[0].data.startsWith(loadArtifact('FairFlowProject').bytecode));
  assert.equal(ready.transactions[1].method, 'publishPolicy(uint128[4],bytes32[4],string[4],bytes32,string)');
});
test('network, economics, default local accounts and incomplete execute gate fail closed', async () => {
  for (const id of [1, 42161, 31337]) { const c = ownerConfig(); c.network.chainId = id; assert.throws(() => validateConfig(c), /Network/); }
  const local = ownerConfig(); local.addresses.owner = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; assert.throws(() => validateConfig(local), /local fixture/);
  const self = ownerConfig(); self.addresses.reviewer = self.addresses.owner; assert.throws(() => validateConfig(self), /distinct/);
  const changed = ownerConfig(); changed.economics.buybackBps = 4000; assert.throws(() => validateConfig(changed), /Economics/);
  const invented = ownerConfig(); invented.deployment.project=invented.addresses.owner; assert.throws(() => validateConfig(invented), /Unexecuted/);
  assert.throws(() => constructorArgs(loadConfig()), /addresses required/);
  assert.throws(() => parseCli(['--execute']), /requires/);
  assert.throws(() => parseCli(['--private-key', 'not-a-key']), /Unknown/);
  assert.throws(() => parseCli(['--signer-module', 'owner.mjs']), /only with/);
  assert.throws(() => configPath('../wallet.json'), /config/);
  assert.throws(() => configPath('config/candidate.json'), /config/);
  await assert.rejects(assertSepolia({ send: async () => '0xa4b1' }), /421614/);
});
test('approval binds exact plan, network, action scope, fresh-wallet attestation, fee cap and live interval', async () => {
  const plan = await preparePlan(ownerConfig());
  const a = { kind: 'FAIRFLOW_SEPOLIA_DEPLOYMENT_OWNER_APPROVAL', authorized: true, approvedBy: 'OWNER', chainId: 421614,
    planSha256: planHash(plan), allowedActions: plan.transactions.map(t => t.kind), maximumTransactions: 2,
    newDedicatedTestnetWallet: true, noProductionOrLocalHardhatKeys: true, ownerConsentReference: 'TEST_FIXTURE_NOT_ACTUAL_OWNER_APPROVAL',
    notBeforeUnix: 1000, expiresAtUnix: 2000, maximumTotalGasFeeWei: '20000000000000000' };
  assert.equal(verifyApproval(a, plan, {now: 1500}), 20000000000000000n);
  for (const patch of [{authorized:false},{chainId:1},{planSha256:'0'.repeat(64)},{maximumTransactions:3},{allowedActions:[...a.allowedActions,'swap']},{newDedicatedTestnetWallet:false},{noProductionOrLocalHardhatKeys:false},{maximumTotalGasFeeWei:'0'},{ownerConsentReference:''}]) assert.throws(() => verifyApproval({...a,...patch},plan,{now:1500}));
  assert.throws(() => verifyApproval(a, plan, {now:2000}), /current/);
  const modified = structuredClone(plan); modified.transactions[1].data += '00'; assert.throws(() => verifyApproval(a,modified,{now:1500}),/plan hash/);
  assert.notEqual(planHash(plan), planHash(modified));
  assert.equal(metadataRecord({b:2,a:1}).digest, metadataRecord({a:1,b:2}).digest);
  const referenced={...a,signerModulePath:path.join(ROOT,'tests','future-owner-signer.mjs'),signerModuleSha256:'1'.repeat(64)};
  assert.throws(()=>verifyApproval(referenced,plan,{now:1500,signerModulePath:path.join(ROOT,'tests','different-signer.mjs'),signerModuleSha256:'1'.repeat(64)}),/signer reference/);
  assert.throws(()=>verifyApproval(referenced,plan,{now:1500,signerModulePath:referenced.signerModulePath,signerModuleSha256:'2'.repeat(64)}),/code hash/);
});

function offlineProvider(config, { outcome = 'confirmed', unexpectedScope = false } = {}) {
  const owner = getAddress(config.addresses.owner), project = getCreateAddress({ from: owner, nonce: 7 });
  const token = getAddress('0x4444444444444444444444444444444444444444'), receiptToken = getAddress('0x5555555555555555555555555555555555555555');
  const cashAbi = new Interface(['function decimals() view returns(uint8)', 'function symbol() view returns(string)']);
  const projectAbi = new Interface(loadArtifact('FairFlowProject').abi);
  const transactions = new Map(), receipts = new Map(), requests = [];
  const provider = {
    __fairflowOfflineTestOnly: true,
    send: async method => { assert.equal(method, 'eth_chainId'); return '0x66eee'; },
    getBlockNumber: async () => 42,
    getCode: async () => '0x6000',
    getFeeData: async () => ({ gasPrice: 1n, maxFeePerGas: 1n, maxPriorityFeePerGas: 0n }),
    estimateGas: async () => 100n,
    getBalance: async () => 1000000n,
    getTransaction: async hash => transactions.get(hash) ?? null,
    getTransactionReceipt: async hash => receipts.get(hash) ?? null,
    call: async request => {
      if (getAddress(request.to) === USDG) {
        const parsed = cashAbi.parseTransaction(request);
        return cashAbi.encodeFunctionResult(parsed.name, parsed.name === 'decimals' ? [6n] : ['USDG']);
      }
      assert.equal(getAddress(request.to), project);
      const parsed = projectAbi.parseTransaction(request);
      assert(['token', 'receipt'].includes(parsed.name));
      return projectAbi.encodeFunctionResult(parsed.name, [parsed.name === 'token' ? token : receiptToken]);
    }
  };
  provider.__fairflowOfflineTestSigner = {
    provider, getAddress: async () => owner,
    sendTransaction: async request => {
      // This is a method stub, not a cryptographic signer or a network send.
      requests.push(request);
      const index = requests.length - 1, hash = '0x' + String(index + 1).padStart(64, '0');
      const tx = { hash, chainId: 421614n, from: owner, to: request.to ?? null, nonce: 7 + index,
        data: unexpectedScope ? '0x1234' : request.data, value: request.value, gasLimit: request.gasLimit,
        maxFeePerGas: request.maxFeePerGas, gasPrice: request.gasPrice ?? 1n };
      const receipt = { hash, status: outcome === 'reverted' ? 0 : 1, blockNumber: 40 + index,
        to: request.to ?? null, from: owner, contractAddress: index === 0 ? project : null, gasUsed: 100n, gasPrice: 1n };
      transactions.set(hash, tx); receipts.set(hash, receipt);
      if (outcome === 'response-loss') throw Error('OFFLINE_FIXTURE_ACCEPTED_THEN_RESPONSE_LOST');
      return { hash, wait: async () => outcome === 'null-receipt' ? null : receipt };
    }
  };
  return { provider, transactions, receipts, requests, project, token, receiptToken };
}

test('offline execution and exact smoke enforce module, one plan attempt, total cap and uncertain outcomes', async () => {
  const suffix = `${process.pid}-${Date.now()}`, cleanup = new Set(), results = [];
  const signerModule = path.join(ROOT, 'tests', `deployment-offline-signer-${suffix}.mjs`);
  assert.equal(fs.existsSync(signerModule), false);
  fs.writeFileSync(signerModule, "export function createFairFlowSigner({provider}) { if (!provider.__fairflowOfflineTestOnly) throw Error('OFFLINE_TEST_ONLY_NO_REAL_SIGNING'); return provider.__fairflowOfflineTestSigner; }\n", { flag: 'wx' });
  cleanup.add(signerModule);
  const scenario = async (name, cap = '1000', behavior) => {
    const config = ownerConfig(); config.projectName = `FairFlow Offline Safety ${suffix} ${name}`;
    const plan = await preparePlan(config), now = Math.floor(Date.now() / 1000);
    const approval = { kind: 'FAIRFLOW_SEPOLIA_DEPLOYMENT_OWNER_APPROVAL', authorized: true, approvedBy: 'OWNER', chainId: 421614,
      planSha256: planHash(plan), allowedActions: plan.transactions.map(t => t.kind), maximumTransactions: 2,
      newDedicatedTestnetWallet: true, noProductionOrLocalHardhatKeys: true, ownerConsentReference: 'OFFLINE_TEST_FIXTURE_NOT_ACTUAL_OWNER_APPROVAL',
      notBeforeUnix: now - 1, expiresAtUnix: now + 600, maximumTotalGasFeeWei: cap,
      signerModulePath: signerModule, signerModuleSha256: sha256(fs.readFileSync(signerModule)) };
    const output = `config/sepolia-review-${suffix}-${name}.json`, secondOutput = `config/sepolia-review-${suffix}-${name}-second.json`;
    for (const file of [configPath(output), configPath(secondOutput), configPath(`config/sepolia-execution-${planHash(plan)}.json`)]) {
      assert.equal(fs.existsSync(file), false, 'Never overwrite an existing deployment/preparation record'); cleanup.add(file);
      cleanup.add(`${file}.temporary-${process.pid}`);
    }
    return { config, plan, approval, output, secondOutput, ...offlineProvider(config, behavior) };
  };
  const run = fixture => executeDeployment({ config: fixture.config, approval: fixture.approval, provider: fixture.provider, signerModulePath: signerModule, output: fixture.output });
  try {
    const binding = await scenario('binding');
    await assert.rejects(executeDeployment({ config: binding.config, approval: binding.approval, provider: binding.provider, signer: binding.provider.__fairflowOfflineTestSigner, output: binding.output }), /direct signer injection/);
    await assert.rejects(executeDeployment({ config: binding.config, approval: { ...binding.approval, signerModuleSha256: '0'.repeat(64) }, provider: binding.provider, signerModulePath: signerModule, output: binding.output }), /code hash/);
    const absentModule = path.join(ROOT, 'tests', `deployment-never-read-${suffix}.mjs`);
    assert.equal(fs.existsSync(absentModule), false);
    await assert.rejects(executeDeployment({ config: binding.config, approval: { ...binding.approval, authorized: false, signerModulePath: absentModule }, provider: binding.provider, signerModulePath: absentModule, output: binding.output }), /Explicit authorization/);
    await assert.rejects(executeDeployment({ config: binding.config, approval: binding.approval, provider: binding.provider, signerModulePath: absentModule, output: binding.output }), /signer reference/);
    assert.equal(binding.requests.length, 0); assert.equal(fs.existsSync(configPath(binding.output)), false);
    results.push({ case: 'Export rejects direct signer injection and mismatched connector hash before use', result: 'PASS', stubCalls: 0 });

    const complete = await scenario('complete'), record = await run(complete);
    assert.equal(complete.requests.length, 2); assert.equal(record.state, 'DEPLOYMENT_AND_POLICY_CONFIRMED_SMOKE_REQUIRED');
    assert.equal(record.gasFeeWei, '200'); assert.equal(record.maximumReservedGasFeeWei, '260');
    assert(complete.requests.every(r => r.chainId === 421614 && r.value === 0n));
    assert.equal(complete.requests[0].data, complete.plan.transactions[0].data);
    assert.equal(complete.requests[1].to, complete.project); assert.equal(complete.requests[1].data, complete.plan.transactions[1].data);
    await assert.rejects(executeDeployment({ config: complete.config, approval: complete.approval, provider: complete.provider, signerModulePath: signerModule, output: complete.secondOutput }), /reserved attempt/);
    assert.equal(complete.requests.length, 2); assert.equal(fs.existsSync(configPath(complete.secondOutput)), false);
    results.push({ case: 'Exact two zero-value calls; same plan cannot repeat under another output', result: 'PASS', stubCalls: 2, cumulativeReservedWei: '260' });

    const budget = await scenario('budget', '200'); await assert.rejects(run(budget), /cap insufficient/); assert.equal(budget.requests.length, 1);
    await assert.rejects(executeDeployment({ config: budget.config, approval: budget.approval, provider: budget.provider, signerModulePath: signerModule, output: budget.secondOutput }), /reserved attempt/);
    results.push({ case: 'Cumulative worst-case cap stops second call even when each fits individually', result: 'PASS', stubCalls: 1 });

    for (const outcome of ['response-loss', 'null-receipt', 'reverted']) {
      const uncertain = await scenario(outcome, '1000', { outcome }); await assert.rejects(run(uncertain));
      const stopped = JSON.parse(fs.readFileSync(configPath(uncertain.output), 'utf8'));
      assert.equal(uncertain.requests.length, 1); assert.equal(stopped.state, 'STOPPED_REQUIRES_RECONCILIATION');
      assert.equal(stopped.transactions[0].status, outcome === 'reverted' ? 'REVERTED' : 'UNKNOWN_REQUIRES_OWNER_RECONCILIATION');
      await assert.rejects(executeDeployment({ config: uncertain.config, approval: uncertain.approval, provider: uncertain.provider, signerModulePath: signerModule, output: uncertain.secondOutput }), /reserved attempt/);
      assert.equal(uncertain.requests.length, 1);
      results.push({ case: `${outcome} is distinct and stops any second/new-output call`, result: 'PASS', stubCalls: 1 });
    }
    const mismatch = await scenario('wrongscope', '1000', { unexpectedScope: true }); await assert.rejects(run(mismatch), /exact authorized request/);
    assert.equal(mismatch.requests.length, 1);
    results.push({ case: 'Unexpected confirmed calldata stops before policy call', result: 'PASS', stubCalls: 1 });

    const verify = rec => verifyDeploymentRecord({ provider: complete.provider, config: complete.config, projectAddress: complete.project,
      tokenAddress: complete.token, receiptAddress: complete.receiptToken, record: rec, block: 42 });
    assert((await verify(record)).every(c => c.result === 'PASS'));
    const duplicate = structuredClone(record); duplicate.transactions[1] = structuredClone(duplicate.transactions[0]);
    assert((await verify(duplicate)).some(c => c.result === 'FAIL'));
    const modified = structuredClone(record); modified.planSha256 = '0'.repeat(64); assert((await verify(modified)).some(c => c.result === 'FAIL'));
    const policyTx = complete.transactions.get(record.transactions[1].hash), original = { ...policyTx };
    policyTx.to = complete.config.addresses.operationsRecipient;
    assert((await verify(record)).some(c => c.result === 'FAIL')); Object.assign(policyTx, original);
    policyTx.data = '0x1234'; const selfDeclared = structuredClone(record); selfDeclared.transactions[1].calldataKeccak256 = keccak256(policyTx.data);
    assert((await verify(selfDeclared)).some(c => c.result === 'FAIL')); Object.assign(policyTx, original);
    const deployReceipt = complete.receipts.get(record.transactions[0].hash), originalAddress = deployReceipt.contractAddress;
    deployReceipt.contractAddress = complete.token; assert((await verify(record)).some(c => c.result === 'FAIL')); deployReceipt.contractAddress = originalAddress;
    results.push({ case: 'Read-only smoke rejects duplicate hashes, changed plan, wrong target, self-declared altered calldata and wrong creation address', result: 'PASS' });
    await assert.rejects(smokeProject({ provider: complete.provider, config: complete.config, projectAddress: complete.project }), /Actual deployment record required/);
    results.push({ case: 'Public smoke export cannot omit exact transaction evidence', result: 'PASS' });

    fs.writeFileSync(signerModule, "export function createFairFlowSigner({provider}) { if (!provider.__fairflowOfflineTestOnly) throw Error('OFFLINE_TEST_ONLY_NO_REAL_SIGNING'); provider.__approvedSecondModuleVersionUsed = true; return provider.__fairflowOfflineTestSigner; }\n");
    const secondVersion = await scenario('modulev2'); await run(secondVersion);
    assert.equal(secondVersion.provider.__approvedSecondModuleVersionUsed, true);
    results.push({ case: 'Same connector path with newly approved code loads its hash-bound ESM version', result: 'PASS', stubCalls: 2 });

    // Minimal public source omits private preparation assets; tests create only
    // their generated evidence directory instead of requiring those assets.
    fs.mkdirSync(path.join(ROOT, 'docs/submission'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'docs/submission/DEPLOYMENT_SAFETY_TESTS.json'), JSON.stringify({ schemaVersion: 1, atUtc: new Date().toISOString(),
      state: 'PASS_OFFLINE_EXECUTION_STUB_REGRESSIONS', scope: 'In-memory fake provider and unsigned method stubs only. Chain421614 is a synthetic return value, not a network connection; no cryptographic signing, wallet, actual approval file or public broadcast.',
      sourceSha256: Object.fromEntries(['scripts/deploy-sepolia.mjs', 'scripts/smoke-sepolia.mjs', 'tests/deployment.test.mjs'].map(file => [file, sha256(fs.readFileSync(path.join(ROOT, file)))])), results,
      limitations: ['Does not prove actual hardware/browser signing connector behavior.', 'No public gas fee, USDG transfer, deployment or smoke success claimed.', 'Consumption/output fixtures and temporary offline module are removed; main runtime untouched.'] }, null, 2) + '\n');
  } finally { for (const file of cleanup) if (fs.existsSync(file)) fs.unlinkSync(file); }
});

test('actual isolated local constructor + four-role policy smoke validates artifact plan and records local gas', { timeout: 90000 }, async () => {
  const port = 18562;
  const busy = await new Promise(resolve => { const s = net.connect(port,'127.0.0.1'); s.once('connect',()=>{s.destroy();resolve(true)}); s.once('error',()=>resolve(false)); });
  assert.equal(busy, false, 'Owned validation port occupied; existing services are never attached or reset');
  const child = spawn(process.execPath, [path.join(ROOT,'node_modules/hardhat/dist/src/cli.js'),'node','--config',path.join(ROOT,'tests/deployment.config.mjs'),'--network','deploymentValidation','--hostname','127.0.0.1','--port',String(port)], {cwd:ROOT,stdio:'ignore',windowsHide:true});
  const provider = new JsonRpcProvider(`http://127.0.0.1:${port}`,31337,{cacheTimeout:-1}); provider.pollingInterval=50;
  try {
    let started=false;
    for(let i=0;i<100;i++) { if(child.exitCode!==null) throw Error('Owned local validation node exited'); try { if(await provider.send('eth_chainId',[])==='0x7a69'){started=true;break;} } catch {} await delay(100); }
    assert(started, 'Validation node did not start');
    const signer=await provider.getSigner(0);
    const cashArtifact=loadArtifact('LocalCash');
    const cash=await new ContractFactory(cashArtifact.abi,cashArtifact.bytecode,signer).deploy(); await cash.waitForDeployment();
    const config=ownerConfig(), args=constructorArgs(config), originalCash=args[1];
    assert.equal(originalCash,USDG);
    args[1]=await cash.getAddress(); // Explicit test override; public script cannot deploy LocalCash or substitute cash.
    const artifact=loadArtifact('FairFlowProject'), project=await new ContractFactory(artifact.abi,artifact.bytecode,signer).deploy(...args);
    const deployReceipt=await project.deploymentTransaction().wait(); await project.waitForDeployment();
    const published=await project.publishPolicy(...policyArgs(config)); const policyReceipt=await published.wait();
    const localConfig=structuredClone(config); localConfig.addresses.owner=await signer.getAddress(); localConfig.cash.address=await cash.getAddress(); localConfig.cash.symbol=await cash.symbol();
    const smoke=await smokeProject({provider,config:localConfig,projectAddress:await project.getAddress(),localValidation:true});
    assert.equal(smoke.state,'PASS_LOCAL_CONSTRUCTOR_AND_POLICY_SMOKE');
    assert(smoke.checks.every(c=>c.result==='PASS'));
    const combined=deployReceipt.gasUsed+policyReceipt.gasUsed;
    const report={ state:'PASS_DISPOSABLE_LOCAL_DEPLOYMENT_PREPARATION', at:new Date().toISOString(), chainId:31337,
      publicDeployed:false, network421614Transactions:0, ownerApprovalCreated:false,
      deployGasUsed:deployReceipt.gasUsed.toString(), policyGasUsed:policyReceipt.gasUsed.toString(), combinedGasUsed:combined.toString(),
      feePlanningExample:{ hypotheticalWeiPerGas:'1000000000', safetyMultiplier:2, expectedTestEth:formatEther(combined*1000000000n*2n),
        limitation:'Derived from actual local EVM gas only, assuming1gwei and2x margin. Arbitrum poster fees, gas estimates and network prices vary; not a public-chain fee guarantee or faucet request.' },
      smoke, publicExpectedCash:{address:USDG,decimals:6,symbol:'USDG'}, testCashOverride:'LocalCash on31337 only, never part of public deployment',
      mainRuntimeTouched:false, localNodePort:port };
    report.artifacts=(await preparePlan(config)).artifacts;
    fs.writeFileSync(configPath('config/sepolia-local-validation.json'),JSON.stringify(report,null,2)+'\n');
  } finally { provider.destroy(); child.kill(); }
});
