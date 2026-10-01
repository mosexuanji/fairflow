import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Contract, ContractFactory, Interface, JsonRpcProvider, getAddress, getCreateAddress, keccak256, toUtf8Bytes, formatEther } from 'ethers';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CHAIN_ID = 421614;
export const USDG = getAddress('0xFFC95faa3d63Cde504a05B567C600B78C0b41892');
export const RPC = 'https://sepolia-rollup.arbitrum.io/rpc';
export const EXPLORER = 'https://sepolia.arbiscan.io';
const ACTIONS = ['DEPLOY_FAIRFLOW_PROJECT_WITH_INTERNAL_TOKEN_AND_RECEIPT', 'PUBLISH_POLICY_V1'];
const FORBIDDEN = ['wallet_creation', 'faucet', 'mainnet', 'real_money', 'personal_asset_transfer', 'cash_mint', 'cash_approval', 'cash_transfer', 'initial_ft_mint', 'dex_fixture_deployment', 'adapter_configuration', 'pool_creation', 'liquidity', 'swap', 'buyback', 'public_repository', 'hosting', 'registration', 'submission'];
// Publicly known disposable fixture accounts, never usable for this public plan.
const LOCAL_ACTORS = new Set([
  '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266', '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
  '0x3c44cdddB6a900fa2b585dd299e03d12fa4293bc'.toLowerCase(), '0x90f79bf6eb2c4f870365e785982e1f101e93b906',
  '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65', '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc',
  '0x976ea74026e726554db657fa54763abd0c3a0aa9'
]);
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const planHash = plan => sha256(canonical(plan));
export const loadArtifact = name => JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/contracts', `${name}.json`), 'utf8'));
export function configPath(input = 'config/sepolia-plan.json') {
  const target = path.resolve(ROOT, input);
  if (path.dirname(target) !== path.join(ROOT, 'config') || !/^sepolia[-.a-z0-9]*\.json$/i.test(path.basename(target))) throw Error('Only this project config/sepolia*.json may be read or written as deployment configuration');
  const configRoot = fs.realpathSync(path.join(ROOT, 'config'));
  if (configRoot !== path.join(fs.realpathSync(ROOT), 'config')) throw Error('Configuration directory cannot redirect outside the owned project config directory');
  if (fs.existsSync(target) && path.dirname(fs.realpathSync(target)) !== configRoot) throw Error('Configuration symlinks cannot escape this project config directory');
  return target;
}
export function loadConfig(input) { return JSON.parse(fs.readFileSync(configPath(input), 'utf8')); }
function exact(value, expected, label) { if (canonical(value) !== canonical(expected)) throw Error(`${label} differs from the authorized 0.1.0 demo plan`); }
function publicAddress(value, label) {
  const address = getAddress(value);
  if (address === '0x0000000000000000000000000000000000000000' || LOCAL_ACTORS.has(address.toLowerCase())) throw Error(`${label} must be a new Owner-selected testnet address, never a local fixture account`);
  return address;
}
export function validateConfig(config, { requireAddresses = false } = {}) {
  exact(config.schemaVersion, 1, 'Schema');
  exact(config.product, 'FairFlow', 'Product');
  exact(config.coreVersion, '0.1.0', 'Core version');
  exact(config.state, 'PREPARED_NOT_DEPLOYED', 'Preparation state');
  exact(config.network.chainId, CHAIN_ID, 'Network');
  exact(config.network.rpc, RPC, 'RPC');
  exact(config.network.explorer, EXPLORER, 'Explorer');
  exact(getAddress(config.cash.address), USDG, 'Official cash address');
  exact(config.cash.decimals, 6, 'Cash decimals');
  exact(config.cash.symbol, 'USDG', 'Cash symbol');
  exact(config.transactions, ACTIONS, 'Transaction scope');
  exact(config.excludedActions, FORBIDDEN, 'Excluded actions');
  exact(config.publicActionsEnabled, false, 'Default public-action flag');
  exact(config.deployment, {project:null,token:null,receipt:null,projectExplorer:null,tokenExplorer:null,receiptExplorer:null,deploymentTxHash:null,deploymentTxExplorer:null,policyTxHash:null,policyTxExplorer:null}, 'Unexecuted deployment fields');
  exact(config.economics, {
    status: 'HACKATHON_DEMO_NOT_FINAL_PUBLIC_TOKEN_TERMS', bandFtWei: '1000000000000000000000',
    firstStageCreditsAtoms: '10000000', creditDecimals: 6, reviewDelaySeconds: 60, buybackBps: 3000,
    maxTaskCreditsAtoms: '1000000000', roleCreditsAtoms: ['10000000', '3000000', '200000', '500000']
  }, 'Economics');
  exact(config.metadata.policy.roleCreditsAtoms, config.economics.roleCreditsAtoms, 'Policy role credits');
  if (!config.projectName || config.projectName.length > 80) throw Error('Project name required (max 80 characters)');
  const missing = [];
  for (const key of ['owner', 'reviewer', 'serviceProvider', 'operationsRecipient']) {
    if (config.addresses[key] == null) missing.push(key);
    else publicAddress(config.addresses[key], key);
  }
  if (requireAddresses && missing.length) throw Error(`Owner-selected public addresses required: ${missing.join(', ')}`);
  if (!missing.length) {
    const reviewer = getAddress(config.addresses.reviewer);
    if (['owner', 'serviceProvider', 'operationsRecipient'].some(k => getAddress(config.addresses[k]) === reviewer)) throw Error('Reviewer must use a distinct Owner-controlled address; this does not imply independent review');
  }
  return missing;
}
export function metadataRecord(value) {
  const bytes = canonical(value);
  const digest = keccak256(toUtf8Bytes(bytes));
  return { bytes, digest, uri: `urn:fairflow:keccak256:${digest.slice(2)}` };
}
export function constructorArgs(config) {
  validateConfig(config, { requireAddresses: true });
  const e = config.economics, t = metadataRecord(config.metadata.template);
  return [config.projectName, USDG, getAddress(config.addresses.reviewer), getAddress(config.addresses.serviceProvider),
    getAddress(config.addresses.operationsRecipient), e.bandFtWei, e.firstStageCreditsAtoms, e.reviewDelaySeconds,
    e.buybackBps, e.maxTaskCreditsAtoms, t.uri, t.digest];
}
export function policyArgs(config) {
  const schema = metadataRecord(config.metadata.evidenceSchema), policy = metadataRecord(config.metadata.policy);
  return [config.economics.roleCreditsAtoms, Array(4).fill(schema.digest), Array(4).fill(schema.uri), policy.digest, policy.uri];
}
export async function preparePlan(config) {
  const missing = validateConfig(config);
  const artifactNames = ['FairFlowProject', 'ProjectToken', 'Receipt'];
  const artifacts = artifactNames.map(name => {
    const file = `dist/contracts/${name}.json`, bytes = fs.readFileSync(path.join(ROOT, file));
    const artifact = JSON.parse(bytes);
    if (artifact.name !== name || !artifact.bytecode?.startsWith('0x') || artifact.bytecode.length < 4) throw Error(`Invalid built ${name} artifact`);
    return { name, file, sha256: sha256(bytes), bytecodeKeccak256: keccak256(artifact.bytecode) };
  });
  const args = missing.length ? null : constructorArgs(config);
  const factory = new ContractFactory(loadArtifact('FairFlowProject').abi, loadArtifact('FairFlowProject').bytecode);
  const deployData = args ? (await factory.getDeployTransaction(...args)).data : null;
  const publishData = new Interface(loadArtifact('FairFlowProject').abi).encodeFunctionData('publishPolicy', policyArgs(config));
  return {
    schemaVersion: 1, product: 'FairFlow', coreVersion: '0.1.0', state: 'PREPARED_NOT_DEPLOYED',
    chainId: CHAIN_ID, rpc: RPC, explorer: EXPLORER, configSha256: sha256(canonical(config)),
    ownerAddresses: config.addresses, missingOwnerAddresses: missing, cash: { address: USDG, decimals: 6, symbol: 'USDG', assetsReceived: false },
    artifacts,
    sourceHashes: ['FairFlowProject.sol', 'IssuanceMath.sol', 'ProjectToken.sol', 'Receipt.sol'].map(name => ({file: `contracts/${name}`, sha256: sha256(fs.readFileSync(path.join(ROOT, 'contracts', name)))})),
    metadata: Object.fromEntries(Object.entries(config.metadata).map(([k, v]) => [k, metadataRecord(v)])),
    transactions: [
      { index: 1, kind: ACTIONS[0], signer: config.addresses.owner, to: null, value: '0', artifact: 'FairFlowProject', constructorArgs: args, data: deployData, createsInternally: ['ProjectToken', 'Receipt'] },
      { index: 2, kind: ACTIONS[1], signer: config.addresses.owner, to: 'PROJECT_ADDRESS_AFTER_CONFIRMED_DEPLOYMENT', value: '0', method: 'publishPolicy(uint128[4],bytes32[4],string[4],bytes32,string)', args: policyArgs(config), data: publishData }
    ],
    deployment: config.deployment, excludedActions: FORBIDDEN,
    publicMetadataAvailability: 'Content-addressed URNs commit to inline bytes; public file hosting/publication remains separately gated.'
  };
}
export function readOnlyProvider(config) {
  validateConfig(config);
  const provider = new JsonRpcProvider(config.network.rpc, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 1000;
  return provider;
}
export async function assertSepolia(provider) {
  if (BigInt(await provider.send('eth_chainId', [])) !== BigInt(CHAIN_ID)) throw Error('Arbitrum Sepolia421614 required; no mainnet or fallback network');
}
export async function preflight(config, provider) {
  await assertSepolia(provider);
  const block = await provider.getBlockNumber();
  const code = await provider.getCode(USDG, block);
  if (code === '0x') throw Error('Official USDG has no code at the observed block');
  const cash = new Contract(USDG, ['function decimals() view returns(uint8)', 'function symbol() view returns(string)'], provider);
  const [decimals, symbol, feeData] = await Promise.all([cash.decimals({ blockTag: block }), cash.symbol({ blockTag: block }), provider.getFeeData()]);
  if (decimals !== 6n || symbol !== 'USDG') throw Error('Official USDG decimals/symbol do not match the frozen plan');
  const result = { state: 'PASS_READ_ONLY_PREFLIGHT_NOT_DEPLOYED', observedAt: new Date().toISOString(), chainId: CHAIN_ID, block, cash: { address: USDG, codeBytes: (code.length - 2) / 2, codeKeccak256: keccak256(code), decimals: 6, symbol }, gasPriceWei: feeData.gasPrice?.toString() ?? null, maxFeePerGasWei: feeData.maxFeePerGas?.toString() ?? null, deploymentGasEstimate: null, requiredTestEthEstimate: null, feeEstimateLimitation: 'Latest estimates can change; policy gas is known only after actual project deployment. No real assets or faucet accessed.' };
  if (!validateConfig(config).length) {
    const plan = await preparePlan(config);
    try {
      const gas = await provider.estimateGas({ from: getAddress(config.addresses.owner), data: plan.transactions[0].data, value: 0n });
      result.deploymentGasEstimate = gas.toString();
      const fee = feeData.maxFeePerGas ?? feeData.gasPrice;
      if (fee) result.requiredTestEthEstimate = { deploymentOnlyWithoutSafetyMargin: formatEther(gas * fee), wei: (gas * fee).toString(), includesPolicy: false };
    } catch { result.deploymentGasEstimate = 'NOT_AVAILABLE; address balance/RPC may prevent estimation'; }
  }
  return result;
}
export function verifyApproval(approval, plan, { now = Math.floor(Date.now() / 1000), signerModulePath, signerModuleSha256 } = {}) {
  if (plan.missingOwnerAddresses.length) throw Error('Owner addresses not configured');
  exact(approval.kind, 'FAIRFLOW_SEPOLIA_DEPLOYMENT_OWNER_APPROVAL', 'Approval kind');
  exact(approval.authorized, true, 'Explicit authorization');
  exact(approval.approvedBy, 'OWNER', 'Approval authority');
  exact(approval.chainId, CHAIN_ID, 'Approval network');
  exact(approval.planSha256, planHash(plan), 'Approved plan hash');
  exact(approval.allowedActions, ACTIONS, 'Approval action scope');
  exact(approval.maximumTransactions, 2, 'Approval signature count');
  exact(approval.newDedicatedTestnetWallet, true, 'Dedicated testnet wallet attestation');
  exact(approval.noProductionOrLocalHardhatKeys, true, 'Key separation attestation');
  if (!approval.ownerConsentReference || typeof approval.ownerConsentReference !== 'string') throw Error('Direct Owner consent reference required; software cannot establish consent from a self-written file');
  if (!Number.isSafeInteger(approval.notBeforeUnix) || !Number.isSafeInteger(approval.expiresAtUnix) || now < approval.notBeforeUnix || now >= approval.expiresAtUnix || approval.expiresAtUnix - approval.notBeforeUnix > 86400) throw Error('Approval must be current and limited to at most24hours');
  if (!/^[1-9][0-9]*$/.test(approval.maximumTotalGasFeeWei ?? '')) throw Error('Positive test-ETH gas-fee cap required');
  if (signerModulePath) {
    exact(path.resolve(approval.signerModulePath), path.resolve(signerModulePath), 'Owner-provided signer reference');
    exact(approval.signerModuleSha256, signerModuleSha256, 'Owner-provided signer code hash');
  }
  return BigInt(approval.maximumTotalGasFeeWei);
}
function writeNewRecord(target, record) {
  const descriptor = fs.openSync(target, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, JSON.stringify(record, null, 2) + '\n'); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}
function updateRecord(target, record) {
  const tmp = `${target}.temporary-${process.pid}`;
  writeNewRecord(tmp, record);
  fs.renameSync(tmp, target);
}
// Every caller uses the approved connector boundary. An arbitrary supplied
// signer cannot bypass the same path/code-hash checks enforced by the CLI.
export async function executeDeployment({ config, approval, provider, signerModulePath, signer: suppliedSigner, output }) {
  if (suppliedSigner || typeof signerModulePath !== 'string' || !signerModulePath) throw Error('Execution requires the exact approved signer module; direct signer injection is not permitted');
  config = JSON.parse(canonical(config));
  approval = JSON.parse(canonical(approval));
  const plan = await preparePlan(config);
  const target = configPath(output);
  if (fs.existsSync(target)) throw Error('Deployment record already exists; inspect/reconcile it, never silently redeploy or retry');
  const signerFile = path.resolve(signerModulePath);
  const verifyBoundApproval = () => {
    // Validate consent/scope/time and the explicit file reference BEFORE reading
    // any connector bytes. JavaScript argument evaluation must not skip gates.
    verifyApproval(approval, plan);
    if (typeof approval.signerModulePath !== 'string') throw Error('Owner-provided signer reference required');
    exact(path.resolve(approval.signerModulePath), signerFile, 'Owner-provided signer reference');
    if (!/^[0-9a-f]{64}$/.test(approval.signerModuleSha256 ?? '')) throw Error('Owner-provided signer code hash required');
    return verifyApproval(approval, plan, { signerModulePath: signerFile, signerModuleSha256: sha256(fs.readFileSync(signerFile)) });
  };
  const cap = verifyBoundApproval();
  await assertSepolia(provider);
  const check = await preflight(config, provider);
  const commitment = planHash(plan);
  // Consumption is independent of the caller's output filename and approval
  // expiry. A crash/uncertain attempt cannot be replayed under a new filename.
  const consumption = configPath(`config/sepolia-execution-${commitment}.json`);
  if (fs.existsSync(consumption)) throw Error('This deployment plan already has a reserved attempt; reconcile its original record instead of using a new output');
  verifyBoundApproval();
  writeNewRecord(consumption, { schemaVersion: 1, state: 'PLAN_CONSUMED_REQUIRES_ORIGINAL_RECORD_RECONCILIATION',
    chainId: CHAIN_ID, planSha256: commitment, approvalSha256: sha256(canonical(approval)),
    output: path.relative(ROOT, target), maximumTransactions: 2, maximumTotalGasFeeWei: cap.toString(), at: new Date().toISOString() });
  const record = { schemaVersion: 1, state: 'READY_FOR_OWNER_SIGNATURE', chainId: CHAIN_ID, planSha256: commitment, preflight: check, addresses: { project: null, token: null, receipt: null }, links: { project: null, token: null, receipt: null, deploymentTx: null, policyTx: null }, transactions: [], maximumTotalGasFeeWei: cap.toString(), maximumReservedGasFeeWei: '0', gasFeeWei: '0', excludedActions: FORBIDDEN };
  writeNewRecord(target, record);
  let signer;
  try {
    verifyBoundApproval();
    const moduleUrl = pathToFileURL(signerFile);
    // ESM caches by URL; the verified content hash selects the exact approved
    // version even when a long-lived caller replaces/reapproves the same path.
    moduleUrl.searchParams.set('fairflowSignerSha256', approval.signerModuleSha256);
    const module = await import(moduleUrl.href);
    verifyBoundApproval();
    if (typeof module.createFairFlowSigner !== 'function') throw Error('Explicit Owner signer module must export createFairFlowSigner');
    signer = await module.createFairFlowSigner({ provider, expectedAddress: config.addresses.owner, chainId: CHAIN_ID });
    verifyBoundApproval();
    if (!signer?.provider) throw Error('Signer must be connected to421614');
    await assertSepolia(signer.provider);
    if (getAddress(await signer.getAddress()) !== getAddress(config.addresses.owner)) throw Error('Signer does not match the approved new Owner address');
  } catch (error) { record.state = 'STOPPED_REQUIRES_RECONCILIATION'; updateRecord(target, record); throw error; }
  let cumulativeWorstFee = 0n;
  const send = async (kind, request) => {
    verifyBoundApproval();
    if (record.transactions.length >= 2) throw Error('Approved two-transaction limit reached');
    await assertSepolia(provider);
    await assertSepolia(signer.provider);
    if (getAddress(await signer.getAddress()) !== getAddress(config.addresses.owner)) throw Error('Signer changed from the approved Owner address');
    const fees = await provider.getFeeData();
    const fee = fees.maxFeePerGas ?? fees.gasPrice;
    if (!fee || fee <= 0n) throw Error('Current public testnet fee estimate unavailable');
    const gas = await provider.estimateGas({ ...request, from: config.addresses.owner, value: 0n });
    const gasLimit = (gas * 130n + 99n) / 100n;
    const budget = gasLimit * fee;
    if (cumulativeWorstFee + budget > cap) throw Error('Approved test-ETH gas-fee cap insufficient; this action was not submitted');
    if (await provider.getBalance(config.addresses.owner) < budget) throw Error('New dedicated testnet wallet lacks testETH; no automatic faucet or funding');
    cumulativeWorstFee += budget;
    record.maximumReservedGasFeeWei = cumulativeWorstFee.toString();
    const pending = { kind, status: 'AWAITING_OWNER_SIGNATURE', to: request.to ?? null, calldataKeccak256: keccak256(request.data), value: '0', gasLimit: gasLimit.toString(), maximumFeeWei: budget.toString(), hash: null };
    record.transactions.push(pending); updateRecord(target, record);
    try {
      const signedRequest = { ...request, chainId: CHAIN_ID, value: 0n, gasLimit };
      if (fees.maxFeePerGas) Object.assign(signedRequest, { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n });
      else signedRequest.gasPrice = fee;
      verifyBoundApproval();
      const transaction = await signer.sendTransaction(signedRequest);
      pending.hash = transaction.hash; pending.status = 'PENDING'; updateRecord(target, record);
      const receipt = await transaction.wait(1);
      if (!receipt) throw Error('Receipt outcome is unknown; no retry or second signature');
      if (receipt.status === 0) { pending.status = 'REVERTED'; throw Error('Observed failed deployment/policy receipt'); }
      if (receipt.status !== 1) throw Error('Receipt status is unknown');
      const observed = await provider.getTransaction(transaction.hash);
      const expectedTo = request.to ? getAddress(request.to) : null;
      const observedTo = observed?.to ? getAddress(observed.to) : null;
      if (!observed || observed.chainId !== BigInt(CHAIN_ID) || getAddress(observed.from) !== getAddress(config.addresses.owner) ||
          observedTo !== expectedTo || observed.data !== request.data || observed.value !== 0n || observed.gasLimit !== gasLimit ||
          (observed.maxFeePerGas ?? observed.gasPrice) == null || (observed.maxFeePerGas ?? observed.gasPrice) > fee ||
          receipt.hash?.toLowerCase() !== transaction.hash.toLowerCase() || (receipt.to ? getAddress(receipt.to) : null) !== expectedTo ||
          (!expectedTo && getAddress(receipt.contractAddress) !== getCreateAddress({ from: observed.from, nonce: observed.nonce }))) {
        throw Error('Confirmed transaction does not match the exact authorized request; Owner reconciliation required');
      }
      const actualFee = receipt.gasUsed * receipt.gasPrice;
      if (actualFee > budget || BigInt(record.gasFeeWei) + actualFee > cap) throw Error('Observed fee exceeds the approved bound; Owner reconciliation required');
      pending.status = 'CONFIRMED'; pending.block = receipt.blockNumber;
      pending.gasUsed = receipt.gasUsed.toString(); pending.actualFeeWei = actualFee.toString();
      record.gasFeeWei = (BigInt(record.gasFeeWei) + BigInt(pending.actualFeeWei)).toString(); updateRecord(target, record);
      return receipt;
    } catch (error) {
      if (!['CONFIRMED', 'REVERTED'].includes(pending.status)) pending.status = 'UNKNOWN_REQUIRES_OWNER_RECONCILIATION';
      record.state = 'STOPPED_REQUIRES_RECONCILIATION'; updateRecord(target, record); throw error;
    }
  };
  const deployed = await send(ACTIONS[0], { data: plan.transactions[0].data });
  if (!deployed.contractAddress) throw Error('Confirmed deployment receipt lacks contract address');
  const project = new Contract(deployed.contractAddress, loadArtifact('FairFlowProject').abi, provider);
  record.addresses = { project: deployed.contractAddress, token: await project.token(), receipt: await project.receipt() };
  for (const key of ['project', 'token', 'receipt']) record.links[key] = `${EXPLORER}/address/${record.addresses[key]}`;
  record.links.deploymentTx = `${EXPLORER}/tx/${record.transactions[0].hash}`; record.state = 'PROJECT_CONFIRMED_POLICY_NOT_YET_PUBLISHED'; updateRecord(target, record);
  await send(ACTIONS[1], { to: deployed.contractAddress, data: plan.transactions[1].data });
  record.links.policyTx = `${EXPLORER}/tx/${record.transactions[1].hash}`;
  record.state = 'DEPLOYMENT_AND_POLICY_CONFIRMED_SMOKE_REQUIRED'; updateRecord(target, record);
  return record;
}
export function parseCli(argv) {
  const options = { config: 'config/sepolia-plan.json', offline: false, execute: false };
  const values = new Map([['--config', 'config'], ['--approval-file', 'approval'], ['--signer-module', 'signerModule'], ['--output', 'output']]);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--offline') options.offline = true;
    else if (argv[i] === '--execute') options.execute = true;
    else if (argv[i] === '--preflight') options.offline = false;
    else if (values.has(argv[i]) && argv[i + 1] && !argv[i + 1].startsWith('--')) options[values.get(argv[i])] = argv[++i];
    else throw Error('Unknown/incomplete option; default is read-only preflight, --offline prepares without any RPC');
  }
  if (options.execute && (!options.approval || !options.signerModule || !options.output || options.offline)) throw Error('--execute requires explicit --approval-file, --signer-module and new --output; cannot combine with --offline');
  if (!options.execute && (options.approval || options.signerModule || options.output)) throw Error('Signer/approval/output options are accepted only with the explicit execute gate');
  return options;
}
async function main() {
  const options = parseCli(process.argv.slice(2)), config = loadConfig(options.config), plan = await preparePlan(config);
  if (!options.execute) {
    const provider = options.offline ? null : readOnlyProvider(config);
    try { console.log(JSON.stringify({ planSha256: planHash(plan), plan, preflight: provider ? await preflight(config, provider) : { state: 'NOT_RUN_OFFLINE_PREPARATION' } }, null, 2)); }
    finally { provider?.destroy(); }
    return;
  }
  // This file is never created by preparation. It must reflect direct, specific Owner approval.
  const approval = JSON.parse(fs.readFileSync(path.resolve(options.approval), 'utf8'));
  const signerFile = path.resolve(options.signerModule);
  const provider = readOnlyProvider(config);
  try {
    console.log(JSON.stringify(await executeDeployment({ config, approval, provider, signerModulePath: signerFile, output: options.output }), null, 2));
  } finally { provider.destroy(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Sepolia preparation/deployment stopped. Check network, Owner-address configuration and the exact authorization gates; no fallback or automatic retry. Never paste wallet secrets.'); process.exitCode = 1; });
