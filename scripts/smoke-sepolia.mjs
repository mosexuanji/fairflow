import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, getAddress, getCreateAddress, keccak256 } from 'ethers';
import { CHAIN_ID, EXPLORER, assertSepolia, configPath, loadArtifact, loadConfig, metadataRecord, planHash, policyArgs, preparePlan, readOnlyProvider, validateConfig } from './deploy-sepolia.mjs';

// Check actual chain transactions against reconstructed authorized calldata,
// never merely against a record's self-declared calldata hash.
export async function verifyDeploymentRecord({ provider, config, projectAddress, tokenAddress, receiptAddress, record, block = null }) {
  const plan = await preparePlan(config), checks = [];
  const check = (name, actual, expected) => checks.push({ name, actual, expected, result: actual === expected ? 'PASS' : 'FAIL' });
  const address = getAddress(projectAddress), owner = getAddress(config.addresses.owner);
  check('Record schema', record.schemaVersion, 1);
  check('Record approved plan commitment', record.planSha256, planHash(plan));
  check('Record chainId', record.chainId, CHAIN_ID);
  check('Record final state', record.state, 'DEPLOYMENT_AND_POLICY_CONFIRMED_SMOKE_REQUIRED');
  check('Record project address', getAddress(record.addresses.project), address);
  check('Record token address', getAddress(record.addresses.token), getAddress(tokenAddress));
  check('Record receipt address', getAddress(record.addresses.receipt), getAddress(receiptAddress));
  check('Exactly two authorized tx records', record.transactions.length, 2);
  const seen = new Set();
  for (let i = 0; i < 2; i++) {
    const entry = record.transactions[i], expected = plan.transactions[i];
    check(`Recorded tx${i + 1} exists`, Boolean(entry), true);
    if (!entry) continue;
    const validHash = /^0x[0-9a-fA-F]{64}$/.test(entry.hash ?? '');
    check(`Recorded tx${i + 1} valid distinct hash`, validHash && !seen.has(entry.hash.toLowerCase()), true);
    if (!validHash) continue;
    seen.add(entry.hash.toLowerCase());
    check(`Recorded tx${i + 1} exact action`, entry.kind, expected.kind);
    check(`Recorded tx${i + 1} confirmed record`, entry.status, 'CONFIRMED');
    check(`Recorded tx${i + 1} planned calldata commitment`, entry.calldataKeccak256, keccak256(expected.data));
    const tx = await provider.getTransaction(entry.hash), receipt = await provider.getTransactionReceipt(entry.hash);
    check(`Recorded tx${i + 1} confirmed on chain`, receipt?.status === 1, true);
    check(`Recorded tx${i + 1} receipt hash`, receipt?.hash?.toLowerCase() ?? null, entry.hash.toLowerCase());
    check(`Recorded tx${i + 1} chain`, tx?.chainId?.toString() ?? null, String(CHAIN_ID));
    check(`Recorded tx${i + 1} sender`, tx ? getAddress(tx.from) : null, owner);
    check(`Recorded tx${i + 1} zero value`, tx?.value?.toString() ?? null, '0');
    check(`Recorded tx${i + 1} exact planned calldata`, tx?.data === expected.data, true);
    const recipient = i === 0 ? null : address;
    check(`Recorded tx${i + 1} exact recipient`, tx?.to ? getAddress(tx.to) : null, recipient);
    check(`Recorded tx${i + 1} receipt recipient`, receipt?.to ? getAddress(receipt.to) : null, recipient);
    if (block !== null) check(`Recorded tx${i + 1} included at observed block`, Boolean(receipt && receipt.blockNumber <= block), true);
    if (i === 0) {
      check('Creation receipt points to inspected project', receipt?.contractAddress ? getAddress(receipt.contractAddress) : null, address);
      check('Creation address matches sender/nonce', tx ? getCreateAddress({ from: tx.from, nonce: tx.nonce }) : null, address);
    }
  }
  return checks;
}

export async function smokeProject({ provider, config, projectAddress, record = null, localValidation = false }) {
  if (!localValidation) {
    if (!record) throw Error('Actual deployment record required for public smoke; initial getters alone are not two-transaction evidence');
    validateConfig(config, { requireAddresses: true });
    await assertSepolia(provider);
  } else if (BigInt(await provider.send('eth_chainId', [])) !== 31337n) throw Error('Explicit local validation requires disposable31337; not public testnet');
  const chainId = localValidation ? 31337 : CHAIN_ID;
  const address = getAddress(projectAddress);
  const p = new Contract(address, loadArtifact('FairFlowProject').abi, provider);
  const block = await provider.getBlockNumber();
  const checks = [];
  const check = (name, value, expected) => {
    const actual = typeof value === 'bigint' ? value.toString() : value;
    const wanted = typeof expected === 'bigint' ? expected.toString() : expected;
    checks.push({ name, actual, expected: wanted, result: actual === wanted ? 'PASS' : 'FAIL' });
  };
  const code = await provider.getCode(address, block);
  check('Project has runtime code', code !== '0x', true);
  const options = { blockTag: block };
  for (const key of ['owner', 'reviewer', 'serviceProvider', 'operationsRecipient']) check(key, getAddress(await p[key](options)), getAddress(config.addresses[key]));
  check('Official cash reference / local fixture override', getAddress(await p.cash(options)), getAddress(config.cash.address));
  check('Project name', await p.name(options), config.projectName);
  check('Band FT wei', await p.band(options), config.economics.bandFtWei);
  check('First-stage credit atoms', await p.qFirst(options), config.economics.firstStageCreditsAtoms);
  check('Review delay seconds', await p.reviewDelay(options), BigInt(config.economics.reviewDelaySeconds));
  check('Buyback split bps', await p.buybackBps(options), BigInt(config.economics.buybackBps));
  check('Task credit limit atoms', await p.maxTaskCredits(options), config.economics.maxTaskCreditsAtoms);
  check('Template digest', await p.templateDigest(options), metadataRecord(config.metadata.template).digest);
  check('Template URI', await p.templateURI(options), metadataRecord(config.metadata.template).uri);
  for (const key of ['cumulativeRecognizedUnits', 'grossIssued', 'taskCount', 'contributionCount', 'orderCount', 'bountyReserved', 'bountyClaimable', 'refundableServices', 'operationsBudget', 'buybackBudget', 'settledRevenue', 'accountedCash', 'maxCashPerBuy', 'maxCashAtomsPerToken']) check(`Initial ${key}`, await p[key](options), 0n);
  check('No adapter configured', await p.adapter(options), '0x0000000000000000000000000000000000000000');
  check('No keeper configured', await p.keeper(options), '0x0000000000000000000000000000000000000000');
  check('Initial policy v1', await p.policyVersion(options), 1n);
  const policy = policyArgs(config);
  for (let i = 0; i < 4; i++) {
    const rule = await p.rules(1, i, options);
    check(`Role${i} credits`, rule.credits, config.economics.roleCreditsAtoms[i]);
    check(`Role${i} evidence digest`, rule.evidenceSchema, policy[1][i]);
    check(`Role${i} URI`, rule.uri, policy[2][i]);
  }
  const tokenAddress = getAddress(await p.token(options)), receiptAddress = getAddress(await p.receipt(options));
  const token = new Contract(tokenAddress, loadArtifact('ProjectToken').abi, provider);
  const receipt = new Contract(receiptAddress, loadArtifact('Receipt').abi, provider);
  for (const [label, addr] of [['Token', tokenAddress], ['Receipt', receiptAddress]]) check(`${label} runtime code`, await provider.getCode(addr, block) !== '0x', true);
  check('Token immutable issuer', getAddress(await token.issuer(options)), address);
  check('Token decimals', await token.decimals(options), 18n);
  check('Token symbol', await token.symbol(options), 'FFT');
  check('Initial totalSupply', await token.totalSupply(options), 0n);
  check('Initial totalBurned', await token.totalBurned(options), 0n);
  check('Receipt immutable issuer', getAddress(await receipt.issuer(options)), address);
  const cash = new Contract(config.cash.address, ['function decimals() view returns(uint8)', 'function symbol() view returns(string)', 'function balanceOf(address) view returns(uint256)'], provider);
  check('Cash decimals', await cash.decimals(options), 6n);
  check('Cash symbol', await cash.symbol(options), config.cash.symbol);
  // A donation can arrive permissionlessly; record it without claiming it is service revenue.
  const cashBalance = await cash.balanceOf(address, options);
  if (record) {
    checks.push(...await verifyDeploymentRecord({ provider, config, projectAddress: address, tokenAddress, receiptAddress, record, block }));
  }
  return {
    state: checks.every(c => c.result === 'PASS') ? (localValidation ? 'PASS_LOCAL_CONSTRUCTOR_AND_POLICY_SMOKE' : 'PASS_SEPOLIA_DEPLOYMENT_READ_SMOKE') : 'FAIL',
    observedAt: new Date().toISOString(), chainId, block, project: address, token: tokenAddress, receipt: receiptAddress,
    links: localValidation ? null : {project: `${EXPLORER}/address/${address}`, token: `${EXPLORER}/address/${tokenAddress}`, receipt: `${EXPLORER}/address/${receiptAddress}`},
    cashBalanceAtoms: cashBalance.toString(), checks,
    limitations: ['Read-only initial deployment/policy smoke; no contribution/service/cash transfer/DEX/pool/swap performed.', 'Policy URNs commit to inline configuration bytes; public metadata availability is separate.', 'Controlled distinct role addresses do not establish independent review or decentralized arbitration.', 'Runtime code presence/getters are not explorer source verification or external security audit.']
  };
}
async function main() {
  const argv = process.argv.slice(2), options = { config: 'config/sepolia-plan.json' };
  for (let i = 0; i < argv.length; i++) {
    const key = { '--config': 'config', '--deployment': 'deployment' }[argv[i]];
    if (!key || !argv[i + 1] || argv[i + 1].startsWith('--')) throw Error('Usage: node scripts/smoke-sepolia.mjs --config config/sepolia.owner.json --deployment config/sepolia-deployment.json');
    options[key] = argv[++i];
  }
  if (!options.deployment) throw Error('Actual deployment record required; null template is not evidence');
  const config = loadConfig(options.config);
  const record = JSON.parse(fs.readFileSync(configPath(options.deployment), 'utf8'));
  if (record.chainId !== CHAIN_ID || record.state !== 'DEPLOYMENT_AND_POLICY_CONFIRMED_SMOKE_REQUIRED') throw Error('Confirmed actual421614 deployment+policy required; no fallback');
  const provider = readOnlyProvider(config);
  try {
    const result = await smokeProject({provider, config, projectAddress: record.addresses.project, record});
    console.log(JSON.stringify(result, null, 2));
    if (result.state === 'FAIL') process.exitCode = 1;
  } finally { provider.destroy(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Read-only Sepolia smoke stopped: actual421614 deployment, configured Owner addresses and matching records are required. No write, signing or fallback performed.'); process.exitCode = 1; });
