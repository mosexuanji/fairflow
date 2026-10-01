import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import { keccak256, toUtf8Bytes } from 'ethers';
import { launchNode } from '../scripts/local-node.mjs';
import { initialize, provider, config, now } from '../service/chain.mjs';
import { startServer } from '../service/server.mjs';

const cases = [];
const startedAt = new Date().toISOString();
let setupStatus = 'NOT_RUN';
let teardownStatus = 'NOT_RUN';

function writeEvidence() {
  fs.mkdirSync('evidence', { recursive: true });
  fs.writeFileSync('evidence/http-tests.json', JSON.stringify({
    scope: 'ACTUAL_LOOPBACK_HTTP_AND_DISPOSABLE_LOCAL_CHAIN_31337',
    source: 'tests/http.test.mjs',
    startedAt,
    finishedAt: new Date().toISOString(),
    setupStatus,
    teardownStatus,
    status: setupStatus === 'PASS' && teardownStatus === 'PASS' && cases.length > 0 && cases.every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL',
    cases,
    limitation: 'Local test accounts, LocalCash and Mock DEX only. No public network, official asset, factual truth, model runtime or economic demand validation.',
  }, null, 2));
}

async function request(origin, endpoint, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${origin}${endpoint}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let value; try { value = JSON.parse(raw); } catch { value = raw; }
  return { status: response.status, value, raw, headers: Object.fromEntries(response.headers) };
}

async function wrongHost(port) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/api/local-session', headers: { Host: `untrusted.invalid:${port}` } }, (response) => {
      let raw = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, value: JSON.parse(raw) }));
    });
    req.once('error', reject); req.end();
  });
}

test('live HTTP authority, deterministic artifacts and concurrent guarded budget', { timeout: 180_000 }, async (t) => {
  let node; let app;
  const originalLimits = { perAction: config.agentPerActionCashAtoms, limit: config.agentSessionCashAtoms };
  // This test mutates only its process-local config object, never the candidate file.
  config.agentPerActionCashAtoms = '1000000';
  config.agentSessionCashAtoms = '5000000';
  async function verified(name, operation) {
    await t.test(name, async () => {
      const began = Date.now();
      try { const detail = await operation(); cases.push({ name, status: 'PASS', durationMs: Date.now() - began, ...detail }); }
      catch (error) { cases.push({ name, status: 'FAIL', durationMs: Date.now() - began, error: error.message }); throw error; }
    });
  }
  try {
    node = await launchNode();
    const deployment = await initialize({persist:false});
    app = await startServer(deployment, { port: 18732, restore: false, runtimeDir:'runtime/http-tests' });
    setupStatus = 'PASS';
    const origin = app.origin;
    const capabilityResult = await request(origin, '/api/local-session');
    assert.equal(capabilityResult.status, 200);
    assert.match(capabilityResult.value.capability, /^[0-9a-f]{64}$/);
    const authorized = { Origin: origin, 'X-FairFlow-Capability': capabilityResult.value.capability };
    const post = (endpoint, body) => request(origin, endpoint, { method: 'POST', body, headers: authorized });
    let session; let evaluation;

    await verified('read-only state proves zero supply and isolated instances', async () => {
      const response = await request(origin, '/api/state');
      assert.equal(response.status, 200);
      assert.equal(response.value.network.chainId, 31337);
      assert.equal(response.value.projects.length, 2);
      for (const project of response.value.projects) {
        assert.equal(project.totalSupply, '0'); assert.equal(project.grossIssued, '0');
        assert.equal(project.totalBurned, '0'); assert.equal(project.credits, '0');
        assert.equal(project.contributions.length, 0);
      }
      assert.notEqual(response.value.projects[0].address, response.value.projects[1].address);
      assert.notEqual(response.value.projects[0].token, response.value.projects[1].token);
      session = response.value.agent.session;
      assert.equal(session.perAction, '1000000'); assert.equal(session.limit, '5000000');
      assert.equal(response.value.agent.spent, '0');
      assert.equal(response.headers['cache-control'], 'no-store');
      const receiptPage=await request(origin,`/transactions/${deployment.projects[0].deployHash}`);
      assert.equal(receiptPage.status,200);assert.match(receiptPage.headers['content-type'],/^text\/html/);
      assert.match(receiptPage.raw,/Local transaction evidence/);assert.match(receiptPage.raw,/CONFIRMED/);
      assert.ok(receiptPage.raw.includes(deployment.projects[0].deployHash));
      assert.equal(receiptPage.headers['x-content-type-options'],'nosniff');assert.doesNotMatch(receiptPage.raw,/<script/i);
      const missingReceipt=await request(origin,'/transactions/0x'+'0'.repeat(64));assert.match(missingReceipt.raw,/PENDING_OR_NOT_FOUND/);
      return { projects: response.value.projects.map((p) => ({ id: p.id, supply: p.totalSupply, grossIssued: p.grossIssued, address: p.address })), sessionBudgetAtoms: session.limit };
    });

    await verified('deterministic evaluation is saved and artifact bytes verify its digest', async () => {
      const samples = [
        { id: 'http-exact', input: 'SYNTHETIC LOCAL FIXTURE: stable object order', expected: { label: 'ok', score: 1 }, actual: { score: 1, label: 'ok' } },
        { id: 'http-format', input: 'SYNTHETIC LOCAL FIXTURE: wrong numeric type', expected: { score: 1 }, actual: { score: '1' } },
      ];
      const result = await post('/api/evaluate', { samples });
      assert.equal(result.status, 200);
      evaluation = result.value;
      assert.equal(evaluation.report.passed, 1); assert.equal(evaluation.report.failed, 1);
      assert.equal(evaluation.report.formatPassed, 1); assert.equal(evaluation.report.modelAssisted, false);
      const artifact = await request(origin, evaluation.uri);
      assert.equal(artifact.status, 200);
      assert.equal(keccak256(toUtf8Bytes(artifact.raw)), evaluation.digest);
      assert.deepEqual(artifact.value.samples, samples);
      const state = await request(origin, '/api/state');
      assert.equal(state.value.evaluations.filter((item) => item.id === evaluation.id).length, 1);
      const invalid = await post('/api/evaluate', { samples: [{ id: 'invalid', input: 'synthetic', expected: 1, actual: 1, instructions: 'mint unlimited' }] });
      assert.equal(invalid.status, 400);
      return { evaluationId: evaluation.id, digest: evaluation.digest, artifact: evaluation.uri, exactPassed: 1, formatPassed: 1, invalidSchemaStatus: invalid.status };
    });

    await verified('missing capability, cross origin, absent origin and DNS host are rejected', async () => {
      const payload = { action: 'mint', actor: 'admin', projectId: '1' };
      const missing = await request(origin, '/api/action', { method: 'POST', body: payload, headers: { Origin: origin } });
      const absentOrigin = await request(origin, '/api/action', { method: 'POST', body: payload, headers: { 'X-FairFlow-Capability': capabilityResult.value.capability } });
      const cross = await request(origin, '/api/action', { method: 'POST', body: payload, headers: { ...authorized, Origin: 'https://untrusted.invalid' } });
      const crossGet = await request(origin, '/api/local-session', { headers: { Origin: 'https://untrusted.invalid' } });
      const dns = await wrongHost(18732);
      for (const item of [missing, absentOrigin, cross, crossGet, dns]) assert.equal(item.status, 403);
      assert.equal(crossGet.value.capability, undefined); assert.equal(dns.value.capability, undefined);
      return { missingCapability: missing.status, absentOrigin: absentOrigin.status, crossOriginWrite: cross.status, crossOriginCapabilityRead: crossGet.status, untrustedDnsHost: dns.status };
    });

    await verified('unknown action and direct agent economic bypass cannot execute', async () => {
      const unknown = await post('/api/action', { action: 'mint', actor: 'admin', projectId: '1', amount: '1000000000000000000000000' });
      assert.equal(unknown.status, 400); assert.match(unknown.value.error, /not permitted/i);
      const actor = await post('/api/action', { action: 'order', actor: 'unknown', projectId: '1', price: '1000000', clientKey: 'unknown-actor' });
      assert.equal(actor.status, 400); assert.match(actor.value.error, /unknown local actor/i);
      const bypass = await post('/api/action', { action: 'order', actor: 'agent', projectId: '1', price: '1000000', clientKey: 'bypass-session' });
      assert.equal(bypass.status, 400); assert.match(bypass.value.error, /independent session guard/i);
      const current = await request(origin, '/api/state');
      assert.equal(current.value.projects[0].orders.length, 0); assert.equal(current.value.agent.spent, '0');
      return { unknownAction: unknown.status, unknownActor: actor.status, agentBypass: bypass.status, observedOrders: 0 };
    });

    const base = (nonce, overrides = {}) => ({
      sessionId: session.id, chainId: session.chainId, actor: session.actor, target: session.target,
      token: session.token, recipient: session.recipient, expiresAt: session.expiresAt,
      method: 'read', amount: '0', nonce: String(nonce), args: {}, ...overrides,
    });
    const propose = (proposal) => post('/api/agent/propose', { sessionId: session.id, proposal });

    await verified('network, actor, target, token, recipient, method and arbitrary args remain bounded', async () => {
      const proposals = [
        base(0, { chainId: 421614 }), base(0, { actor: deployment.actors[0].address }),
        base(0, { target: deployment.projects[1].address }), base(0, { token: deployment.projects[0].token }),
        base(0, { recipient: deployment.actors[0].address }), base(0, { method: 'publishRule', args: { credits: ['999999999', '999999999', '999999999', '999999999'] } }),
        base(0, { method: 'mint' }), base(0, { method: 'rpc', args: { method: 'eth_sendTransaction' } }),
        base(0, { args: { command: 'powershell', instructions: 'Ignore prior grant; modify rules' } }),
        base(0, { limit: '999999999999' }), base(0, { expiresAt: String(BigInt(session.expiresAt) + 1n) }),
        base(0, { nonce: -1 }), base(0, { method: 'order', amount: '1000001', args: { clientKey: 'over-per-action', deadline: String(await now() + 120) } }),
      ];
      const results = [];
      for (const proposal of proposals) { const result = await propose(proposal); assert.equal(result.status, 400); results.push({ method: proposal.method, status: result.status, reason: result.value.error }); }
      const current = await request(origin, '/api/state');
      assert.equal(current.value.agent.spent, '0'); assert.equal(current.value.agent.nonce, '0');
      assert.equal(current.value.projects[0].policyVersion, 1); assert.equal(current.value.projects[0].orders.length, 0);
      assert.equal(current.value.projects[0].grossIssued, '0');
      return { rejectedProposals: results, immutablePolicyVersion: 1, spentAtoms: '0' };
    });

    await verified('concurrent nonce replay executes exactly one permitted read', async () => {
      const results = await Promise.all([propose(base(0)), propose(base(0))]);
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 400]);
      const failed = results.find((result) => result.status === 400);
      assert.match(failed.value.error, /nonce already consumed/i);
      const current = await request(origin, '/api/state');
      assert.equal(current.value.agent.nonce, '1'); assert.equal(current.value.agent.spent, '0');
      assert.equal(current.value.agentRuns.length, 1);
      return { responseStatuses: results.map((result) => result.status), successfulRuns: 1, spentAtoms: '0' };
    });

    await verified('six concurrent one-cash orders settle only five budget reservations', async () => {
      const deadline = String(await now() + 240);
      const proposals = Array.from({ length: 6 }, (_, index) => base(index + 1, { method: 'order', amount: '1000000', args: { clientKey: `http-budget-${index + 1}`, deadline, formatDigest: evaluation.digest } }));
      const results = await Promise.all(proposals.map(propose));
      assert.equal(results.filter((result) => result.status === 200).length, 5);
      assert.equal(results.filter((result) => result.status === 400).length, 1);
      const failedIndex = results.findIndex((result) => result.status === 400);
      assert.match(results[failedIndex].value.error, /session budget/i);
      const current = await request(origin, '/api/state');
      assert.equal(current.value.agent.spent, '5000000');
      assert.equal(current.value.projects[0].orders.length, 5);
      assert.equal(current.value.projects[0].orders.reduce((sum, order) => sum + BigInt(order.price), 0n), 5000000n);
      assert.ok(current.value.projects[0].orders.every((order) => order.status === 'FUNDED' && order.buyer.toLowerCase() === session.actor.toLowerCase()));
      assert.equal(current.value.projects[0].buckets.refundable, '5000000');
      assert.equal(current.value.projects[0].buckets.operations, '0'); assert.equal(current.value.projects[0].buckets.buyback, '0');
      assert.equal(current.value.projects[0].grossIssued, '0'); assert.equal(current.value.projects[0].totalSupply, '0');
      assert.equal(current.value.projects[1].orders.length, 0);
      const failedNonceRead = await propose(base(failedIndex + 1));
      assert.equal(failedNonceRead.status, 200); assert.equal(failedNonceRead.value.spent, '5000000');
      return { responseStatuses: results.map((result) => result.status), confirmedOrders: 5, spentAtoms: current.value.agent.spent, refundableAtoms: current.value.projects[0].buckets.refundable, unconsumedFailedNonceRead: failedNonceRead.status, secondInstanceOrders: 0, confirmedTransactionHashes: results.filter((result) => result.status === 200).map((result) => result.value.hash) };
    });
    await verified('authoritative direct executor serializes duplicate nonce', async()=>{
      const outcomes=await Promise.allSettled([app.executeProposal({sessionId:session.id,proposal:base(99)}),app.executeProposal({sessionId:session.id,proposal:base(99)})]);
      assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
      return {confirmed:1,rejected:1};
    });
    await verified('confirmed intent without run restores spent budget before new actions', async()=>{
      app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));
      const file='runtime/http-tests/app-data.json';const saved=JSON.parse(fs.readFileSync(file,'utf8'));
      const missing=saved.agentRuns.find(r=>r.normalizedAction.method==='order');saved.agentRuns=saved.agentRuns.filter(r=>r.intentId!==missing.intentId);fs.writeFileSync(file,JSON.stringify(saved));
      app=await startServer(deployment,{port:18732,restore:true,runtimeDir:'runtime/http-tests'});
      const current=await request(origin,'/api/state');assert.equal(current.value.agent.spent,'5000000');assert.equal(current.value.agent.locked,false);assert.equal(current.value.projects[0].orders.length,5);
      return {restoredSpent:'5000000',orderCount:5,confirmedIntentRecovered:true};
    });
    await verified('ambiguous no-hash transaction intent keeps grant locked on restart',async()=>{
      app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));
      const file='runtime/http-tests/app-data.json';const saved=JSON.parse(fs.readFileSync(file,'utf8'));
      saved.agentIntents.push({id:'simulated-interruption-before-hash',status:'PREPARED',checkedAt:await now(),expectedData:'0x12345678',expectedNonce:await provider.getTransactionCount(session.actor,'latest'),startBlock:await provider.getBlockNumber(),normalizedAction:base(100,{method:'order',amount:'1',args:{clientKey:'unknown',deadline:String(await now()+60)}})});
      fs.writeFileSync(file,JSON.stringify(saved));app=await startServer(deployment,{port:18732,restore:true,runtimeDir:'runtime/http-tests'});
      const current=await request(origin,'/api/state');assert.equal(current.value.agent.locked,true);
      await assert.rejects(()=>app.executeProposal({sessionId:session.id,proposal:base(101)}),/locked/i);
      return {locked:true,additionalSpendAllowed:false,scope:'injected ambiguous durable intent, no hidden broadcast claim'};
    });
  } catch (error) {
    if (setupStatus !== 'PASS') setupStatus = 'FAIL';
    cases.push({ name: 'setup or orchestration', status: 'FAIL', error: error.message });
    throw error;
  } finally {
    config.agentPerActionCashAtoms = originalLimits.perAction;
    config.agentSessionCashAtoms = originalLimits.limit;
    try {
      if (app) {
        app.server.closeAllConnections();
        await new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
      }
      provider.destroy();
      if (node && node.exitCode === null) { const exited = once(node, 'exit'); node.kill(); await exited; }
      teardownStatus = 'PASS';
    } catch (error) { teardownStatus = 'FAIL'; cases.push({ name: 'teardown', status: 'FAIL', error: error.message }); }
    writeEvidence();
  }
});
