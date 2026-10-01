import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transaction } from 'ethers';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const RUNTIME_ROOT = join(PROJECT_ROOT, 'runtime');
const TX_METHODS = new Set(['eth_sendTransaction', 'eth_sendRawTransaction']);
export const CONTROL_METHODS = new Set([
  'evm_mine', 'hardhat_mine', 'evm_increaseTime', 'evm_setNextBlockTimestamp',
  'evm_setAutomine', 'evm_setIntervalMining', 'hardhat_setBalance',
  'hardhat_setNonce', 'hardhat_setCode', 'hardhat_setStorageAt',
  'hardhat_impersonateAccount', 'hardhat_stopImpersonatingAccount',
  'hardhat_setCoinbase', 'hardhat_setNextBlockBaseFeePerGas',
  'hardhat_setPrevRandao', 'hardhat_setLoggingEnabled',
]);
const READ_METHODS = new Set(['eth_call', 'eth_getBalance', 'eth_getTransactionCount', 'eth_getCode', 'eth_getStorageAt']);
const SAFE_DEV_READS = new Set(['hardhat_metadata', 'hardhat_getAutomine']);
const digest = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? `0x${item.toString(16)}` : item);
const clone = value => JSON.parse(json(value));

export function assertLoopback(url) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.username || parsed.password) {
    throw new Error('Journal requires a credential-free loopback RPC URL.');
  }
  return parsed.href;
}

export function ownedRuntime(runtimeDir = RUNTIME_ROOT) {
  const target = resolve(runtimeDir);
  function contained(base, candidate) {
    const remainder = relative(base, candidate);
    return remainder === '' || (!isAbsolute(remainder) && remainder !== '..' && !remainder.startsWith(`..${sep}`));
  }
  function lexicalExists(path) {
    try { lstatSync(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  function projectedCanonical(path) {
    let ancestor = path;
    const missing = [];
    while (!lexicalExists(ancestor)) {
      const parent = dirname(ancestor);
      if (parent === ancestor) throw new Error('No existing runtime ancestor is available.');
      missing.unshift(basename(ancestor));
      ancestor = parent;
    }
    // realpath rejects dangling links instead of treating them as safe missing
    // directories. Resolve the existing ancestor before ANY directory creation.
    const canonicalAncestor = realpathSync(ancestor);
    if (!statSync(canonicalAncestor).isDirectory()) throw new Error('Runtime ancestor is not a directory.');
    return resolve(canonicalAncestor, ...missing);
  }
  const lexicalRoot = resolve(RUNTIME_ROOT);
  if (!contained(lexicalRoot, target)) throw new Error('Journal files must stay within this project runtime directory.');
  const canonicalProject = realpathSync(PROJECT_ROOT);
  if (!statSync(canonicalProject).isDirectory()) throw new Error('Project root is not a directory.');
  const canonicalRuntime = join(canonicalProject, 'runtime');
  if (!contained(canonicalRuntime, projectedCanonical(lexicalRoot))) throw new Error('Runtime root symlink leaves the owned runtime directory.');
  if (!contained(canonicalRuntime, projectedCanonical(target))) throw new Error('Runtime symlink leaves the owned runtime directory.');
  const remainder = relative(lexicalRoot, target);
  const steps = [lexicalRoot];
  let cursor = lexicalRoot;
  for (const component of remainder.split(sep).filter(Boolean)) { cursor = join(cursor, component); steps.push(cursor); }
  for (const step of steps) {
    if (!contained(canonicalRuntime, projectedCanonical(step))) throw new Error('Runtime path changed to an unowned directory.');
    if (!lexicalExists(step)) mkdirSync(step);
    const actualStep = realpathSync(step);
    if (!contained(canonicalRuntime, actualStep) || !statSync(actualStep).isDirectory()) throw new Error('Created runtime directory is outside the owned runtime boundary.');
  }
  return realpathSync(target);
}

export function journalPaths(runtimeDir) {
  const root = ownedRuntime(runtimeDir);
  return { root, journal: join(root, 'chain-journal.jsonl'), manifest: join(root, 'chain-journal-manifest.json'), lock: join(root, 'chain-journal.lock') };
}

export function acquireJournalLock(paths) {
  const token = randomUUID();
  const owner = { pid: process.pid, token, startedAtUtc: new Date().toISOString() };
  if (existsSync(paths.lock)) {
    let prior;
    try { prior = JSON.parse(readFileSync(paths.lock, 'utf8')); } catch { throw new Error('Journal lock is unreadable; refusing concurrent access.'); }
    if (!Number.isSafeInteger(prior.pid) || prior.pid < 1) throw new Error('Journal lock has an invalid owner.');
    let alive = true;
    try { process.kill(prior.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
    if (alive) throw new Error('Another live process owns this local chain journal.');
    unlinkSync(paths.lock);
  }
  let descriptor;
  try { descriptor = openSync(paths.lock, 'wx', 0o600); } catch { throw new Error('Local chain journal is already locked.'); }
  try { appendFileSync(descriptor, `${json(owner)}\n`); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  return () => {
    if (!existsSync(paths.lock)) return;
    const current = JSON.parse(readFileSync(paths.lock, 'utf8'));
    if (current.token !== token) throw new Error('Journal lock owner changed; refusing to remove another owner lock.');
    unlinkSync(paths.lock);
  };
}

export function writeManifest(path, manifest) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${json(manifest)}\n`, { mode: 0o600 });
  const descriptor = openSync(temporary, 'r+');
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
  renameSync(temporary, path);
}

export function readJournal(path) {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf8');
  if (content && !content.endsWith('\n')) throw new Error('Journal has an incomplete trailing record; refusing recovery.');
  const records = [];
  let previousHash = null;
  for (const line of content.split('\n').filter(Boolean)) {
    let entry;
    try { entry = JSON.parse(line); } catch { throw new Error('Journal contains invalid JSON; refusing recovery.'); }
    const { hash, ...body } = entry;
    if (body.version !== 1 || body.sequence !== records.length + 1 || body.previousHash !== previousHash || hash !== digest(json(body))) {
      throw new Error('Journal integrity or sequence mismatch; refusing recovery.');
    }
    previousHash = hash;
    records.push(entry);
  }
  return records;
}

export function assertCompleteJournal(records) {
  const outstanding = new Set();
  for (const { payload } of records) {
    if (payload.event === 'intent') outstanding.add(payload.operationId);
    else if (['transaction', 'control'].includes(payload.event)) outstanding.delete(payload.operationId);
    else if (payload.event === 'rpc_error') throw new Error('Legacy mutating RPC error lacks a proven outcome; automatic recovery is disabled.');
    else if (payload.event === 'uncertain') throw new Error('A recorded operation has uncertain chain effects; automatic replay is disabled.');
    else if (payload.event !== 'receipt') throw new Error('Unknown journal event; refusing recovery.');
  }
  if (outstanding.size) throw new Error('An RPC intent was interrupted before its outcome was durable; recovery requires explicit investigation.');
}

export function rawFromRpcTransaction(tx) {
  const type = Number(BigInt(tx.type ?? '0x0'));
  if (type > 2) throw new Error('Recovery currently supports local legacy, access-list and EIP-1559 transactions only.');
  if (BigInt(tx.chainId ?? '0x0') !== 31337n) throw new Error('Refusing to journal a transaction outside local chain 31337.');
  if (!tx.r || !tx.s || tx.v === undefined) throw new Error('RPC did not return a signed transaction; refusing to invent its signature.');
  const fields = {
    type, chainId: 31337n, nonce: Number(BigInt(tx.nonce)),
    gasLimit: BigInt(tx.gas), to: tx.to, value: BigInt(tx.value), data: tx.input ?? tx.data ?? '0x',
    signature: { r: tx.r, s: tx.s, v: Number(BigInt(tx.v)) },
  };
  if (type === 0 || type === 1) fields.gasPrice = BigInt(tx.gasPrice);
  if (type === 1 || type === 2) fields.accessList = tx.accessList ?? [];
  if (type === 2) {
    fields.maxFeePerGas = BigInt(tx.maxFeePerGas);
    fields.maxPriorityFeePerGas = BigInt(tx.maxPriorityFeePerGas);
  }
  const transaction = Transaction.from(fields);
  if (transaction.hash?.toLowerCase() !== tx.hash?.toLowerCase()) throw new Error('Serialized transaction hash does not match the RPC transaction.');
  return transaction.serialized;
}

export async function getHead(send) {
  const block = await send('eth_getBlockByNumber', ['latest', false]);
  if (!block) throw new Error('Local chain head unavailable.');
  return { number: Number(BigInt(block.number)), timestamp: Number(BigInt(block.timestamp)), hash: block.hash };
}

export async function assertLocalChain(send, genesisTimestamp) {
  if (BigInt(await send('eth_chainId', [])) !== 31337n) throw new Error('Journal/replay requires local chain ID 31337.');
  const genesis = await send('eth_getBlockByNumber', ['0x0', false]);
  if (!genesis) throw new Error('Local genesis block unavailable.');
  const observed = Number(BigInt(genesis.timestamp));
  if (genesisTimestamp !== undefined && observed !== Number(genesisTimestamp)) throw new Error('Genesis timestamp differs from the owned manifest; refusing a silent reset.');
  return observed;
}

export function validateCheckpointReads(reads) {
  if (!Array.isArray(reads)) throw new Error('checkpointReads must be an array.');
  const labels = new Set();
  for (const read of reads) {
    if (!read || typeof read.label !== 'string' || labels.has(read.label) || !READ_METHODS.has(read.method) || !Array.isArray(read.params)) {
      throw new Error('Checkpoint reads need unique labels and supported read-only RPC methods.');
    }
    labels.add(read.label);
  }
  return clone(reads);
}

export async function receiptEvidence(send, hash) {
  const receipt = await send('eth_getTransactionReceipt', [hash]);
  if (!receipt) return null;
  const block = await send('eth_getBlockByNumber', [receipt.blockNumber, false]);
  if (!block) throw new Error('Mined transaction block unavailable.');
  return {
    transactionHash: receipt.transactionHash,
    status: Number(BigInt(receipt.status)),
    blockNumber: Number(BigInt(receipt.blockNumber)),
    blockTimestamp: Number(BigInt(block.timestamp)),
    blockHash: receipt.blockHash,
    contractAddress: receipt.contractAddress,
    gasUsed: receipt.gasUsed,
  };
}

export async function verifyReceipt(send, expected) {
  const actual = await receiptEvidence(send, expected.transactionHash);
  if (!actual || actual.transactionHash.toLowerCase() !== expected.transactionHash.toLowerCase() || actual.status !== expected.status || actual.blockNumber !== expected.blockNumber || actual.blockTimestamp !== expected.blockTimestamp || actual.contractAddress?.toLowerCase() !== expected.contractAddress?.toLowerCase()) {
    throw new Error('Recovered transaction receipt differs from the recorded local receipt.');
  }
  return actual;
}

export async function verifyCheckpoint(send, checkpoint) {
  if (!checkpoint) throw new Error('No durable checkpoint exists.');
  validateCheckpointReads(checkpoint.values);
  const head = await getHead(send);
  if (head.number !== checkpoint.head.number || head.timestamp !== checkpoint.head.timestamp) throw new Error('Local chain tip differs from the durable checkpoint.');
  for (const read of checkpoint.values) {
    const actual = await send(read.method, read.params);
    if (json(actual) !== json(read.result)) throw new Error(`Checkpoint mismatch: ${read.label}`);
  }
  return head;
}

// Raw signed LOCAL transactions are deliberately confined to runtime, excluded
// from release archives, and never written to stdout. They are not wallet keys.
export async function attachJournal(provider, options = {}) {
  const providerUrl = provider._getConnection?.().url;
  if (providerUrl) assertLoopback(providerUrl);
  const rpcUrl = assertLoopback(options.rpcUrl ?? providerUrl);
  if (providerUrl && new URL(providerUrl).href !== rpcUrl) throw new Error('Recorder RPC URL differs from the provider connection.');
  const paths = journalPaths(options.runtimeDir);
  const originalMethod = provider.send;
  const send = originalMethod.bind(provider);
  const records = readJournal(paths.journal);
  assertCompleteJournal(records);
  const genesisTimestamp = await assertLocalChain(send, options.genesisTimestamp);
  let manifest;
  if (existsSync(paths.manifest)) {
    manifest = JSON.parse(readFileSync(paths.manifest, 'utf8'));
    if (manifest.version !== 1 || manifest.project !== 'FairFlow' || manifest.chainId !== 31337 || manifest.genesisTimestamp !== genesisTimestamp) throw new Error('Owned chain manifest does not match this local node.');
    const last = records.at(-1);
    if (manifest.lastSequence !== (last?.sequence ?? 0) || manifest.lastHash !== (last?.hash ?? null)) throw new Error('Manifest and journal do not share a durable stop point.');
    await verifyCheckpoint(send, manifest.checkpoint);
    for (const { payload } of records) {
      if (payload.event === 'transaction' && payload.receipt) await verifyReceipt(send, payload.receipt);
      if (payload.event === 'receipt') await verifyReceipt(send, payload.receipt);
    }
  } else {
    if (records.length || (await getHead(send)).number !== 0) throw new Error('Cannot start a journal on an existing unrecorded chain. Use a distinct explicit fresh local chain.');
    manifest = {
      version: 1, project: 'FairFlow', chainId: 31337, rpcUrl,
      genesisTimestamp, initialDate: new Date(genesisTimestamp * 1000).toISOString(),
      lastSequence: 0, lastHash: null, checkpointReads: [], checkpoint: null,
      rawTransactionsAreLocalOnly: true, releaseExcluded: true,
    };
  }
  if (options.checkpointReads !== undefined) manifest.checkpointReads = validateCheckpointReads(options.checkpointReads);
  else manifest.checkpointReads = validateCheckpointReads(manifest.checkpointReads);
  let last = records.at(-1);
  let queue = Promise.resolve();
  let closed = false;
  let failed = false;
  const pending = new Set(records.filter(entry => entry.payload.event === 'transaction' && !entry.payload.receipt).map(entry => entry.payload.hash));
  for (const entry of records) if (entry.payload.event === 'receipt') pending.delete(entry.payload.receipt.transactionHash);

  function append(payload) {
    const body = { version: 1, sequence: (last?.sequence ?? 0) + 1, previousHash: last?.hash ?? null, payload: { recordedAtUtc: new Date().toISOString(), ...payload } };
    const entry = { ...body, hash: digest(json(body)) };
    const descriptor = openSync(paths.journal, 'a', 0o600);
    try { appendFileSync(descriptor, `${json(entry)}\n`); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    last = entry;
    return entry;
  }

  async function checkpointInternal(reads) {
    if (reads !== undefined) manifest.checkpointReads = validateCheckpointReads(reads);
    for (const hash of pending) {
      const receipt = await receiptEvidence(send, hash);
      if (receipt) { append({ event: 'receipt', receipt }); pending.delete(hash); }
    }
    const head = await getHead(send);
    const values = [];
    for (const read of manifest.checkpointReads) values.push({ ...read, result: clone(await send(read.method, read.params)) });
    manifest.lastSequence = last?.sequence ?? 0;
    manifest.lastHash = last?.hash ?? null;
    manifest.rpcUrl = rpcUrl;
    manifest.checkpoint = { recordedAtUtc: new Date().toISOString(), head, journalSequence: manifest.lastSequence, journalHash: manifest.lastHash, values };
    writeManifest(paths.manifest, manifest);
    return clone(manifest.checkpoint);
  }

  function enqueue(operation) {
    const next = queue.then(async () => {
      if (closed || failed) throw new Error('Chain journal is closed or failed; writes are disabled.');
      return operation();
    });
    queue = next.catch(() => {});
    return next;
  }

  async function captureTransaction(hash, operationId, before, rpcReturnedError = false) {
    const transaction = await send('eth_getTransactionByHash', [hash]);
    if (!transaction) throw new Error('Submitted local transaction could not be fetched for durable serialization.');
    const raw = rawFromRpcTransaction(transaction);
    const receipt = await receiptEvidence(send, hash);
    append({ event: 'transaction', operationId, hash, raw, receipt, before, after: await getHead(send), rpcReturnedError });
    if (!receipt) pending.add(hash);
  }

  async function mutation(method, params) {
    const normalized = clone(params);
    await assertLocalChain(send, manifest.genesisTimestamp);
    await verifyCheckpoint(send, manifest.checkpoint);
    if (method === 'evm_setIntervalMining' && BigInt(normalized[0]) !== 0n) throw new Error('Background interval mining cannot be durably journalled; use explicit mining.');
    if (method === 'eth_sendRawTransaction' && Transaction.from(normalized[0]).chainId !== 31337n) throw new Error('Refusing a non-local signed transaction.');
    const before = await getHead(send);
    const operationId = randomUUID();
    append({ event: 'intent', operationId, method, params: normalized, before });
    let result;
    try { result = await send(method, params); }
    catch (error) {
      try {
        const after = await getHead(send);
        let recoverableHash = method === 'eth_sendRawTransaction' ? Transaction.from(normalized[0]).hash : null;
        if (!recoverableHash && TX_METHODS.has(method) && after.number === before.number + 1) {
          const block = await send('eth_getBlockByNumber', ['latest', true]);
          const requested = normalized[0];
          const candidates = block.transactions.filter(tx => {
            if (typeof tx !== 'object' || tx.from?.toLowerCase() !== requested?.from?.toLowerCase()) return false;
            if ((tx.to ?? null)?.toLowerCase() !== (requested.to ?? null)?.toLowerCase()) return false;
            if ((tx.input ?? tx.data ?? '0x').toLowerCase() !== (requested.data ?? requested.input ?? '0x').toLowerCase()) return false;
            if (requested.value !== undefined && BigInt(tx.value) !== BigInt(requested.value)) return false;
            if (requested.gas !== undefined && BigInt(tx.gas) !== BigInt(requested.gas)) return false;
            if (requested.nonce !== undefined && BigInt(tx.nonce) !== BigInt(requested.nonce)) return false;
            return true;
          });
          if (candidates.length === 1) recoverableHash = candidates[0].hash;
        }
        // An unchanged head does not prove no effect: a transaction may be in
        // the mempool, or a time/control RPC may have changed hidden state.
        // Only a fetchable signed transaction with a known hash can reconcile
        // a lost response; every other mutating RPC error fails closed.
        if (!recoverableHash || !await send('eth_getTransactionByHash', [recoverableHash])) throw new Error('Mutating RPC outcome is uncertain.');
        await captureTransaction(recoverableHash, operationId, before, true);
        await checkpointInternal();
      } catch {
        failed = true;
        append({ event: 'uncertain', operationId, reason: 'RPC failed and its chain effects could not be durably captured.' });
      }
      throw error;
    }
    try {
      if (TX_METHODS.has(method)) await captureTransaction(result, operationId, before);
      else append({ event: 'control', operationId, method, params: normalized, result: clone(result), before, after: await getHead(send) });
      await checkpointInternal();
    } catch (error) {
      failed = true;
      append({ event: 'uncertain', operationId, reason: 'RPC succeeded but durable journal/checkpoint capture failed.' });
      throw new Error(`Local transaction outcome requires recovery investigation: ${error.message}`);
    }
    return result;
  }

  const releaseLock = acquireJournalLock(paths);
  try { await checkpointInternal(); } catch (error) { releaseLock(); throw error; }
  provider.send = function journalledSend(method, params = []) {
    if (TX_METHODS.has(method) || CONTROL_METHODS.has(method)) return enqueue(() => mutation(method, params));
    if (/^(?:evm_|hardhat_|anvil_|personal_|miner_)/.test(method) && !SAFE_DEV_READS.has(method)) return Promise.reject(new Error('Unsupported mutable development RPC is disabled on the journalled application chain.'));
    return send(method, params);
  };
  return {
    paths, genesisTimestamp,
    checkpoint: reads => enqueue(() => checkpointInternal(reads)),
    flush: async () => { await queue; if (failed) throw new Error('Journal capture failed; writes remain disabled.'); },
    close: async () => { await queue; closed = true; provider.send = originalMethod; releaseLock(); },
  };
}
