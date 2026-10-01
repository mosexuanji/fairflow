import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcProvider, Transaction } from 'ethers';
import { acquireJournalLock, assertCompleteJournal, assertLocalChain, assertLoopback, CONTROL_METHODS, getHead, journalPaths, readJournal, verifyCheckpoint, verifyReceipt, writeManifest } from '../service/journal.mjs';

function sameHead(actual, expected) {
  return actual.number === expected.number && actual.timestamp === expected.timestamp;
}

// Explicit recovery only. This never resets a running node and never deploys a
// replacement application. It replays the owned local ledger or fails closed.
export async function replayJournal({ provider, runtimeDir, rpcUrl } = {}) {
  const paths = journalPaths(runtimeDir);
  if (!existsSync(paths.manifest)) throw new Error('Owned local chain manifest is missing.');
  const manifest = JSON.parse(readFileSync(paths.manifest, 'utf8'));
  if (manifest.version !== 1 || manifest.project !== 'FairFlow' || manifest.chainId !== 31337) throw new Error('Invalid FairFlow local chain manifest.');
  const providerUrl = provider?._getConnection?.().url;
  if (providerUrl) assertLoopback(providerUrl);
  const targetUrl = assertLoopback(rpcUrl ?? providerUrl ?? manifest.rpcUrl);
  if (providerUrl && new URL(providerUrl).href !== targetUrl) throw new Error('Replay RPC URL differs from the provider connection.');
  const ownsProvider = !provider;
  const active = provider ?? new JsonRpcProvider(targetUrl, 31337, { staticNetwork: true });
  const send = active.send.bind(active);
  let releaseLock;
  try {
    releaseLock = acquireJournalLock(paths);
    await assertLocalChain(send, manifest.genesisTimestamp);
    const records = readJournal(paths.journal);
    assertCompleteJournal(records);
    const last = records.at(-1);
    if (manifest.lastSequence !== (last?.sequence ?? 0) || manifest.lastHash !== (last?.hash ?? null) || manifest.checkpoint?.journalSequence !== manifest.lastSequence || manifest.checkpoint?.journalHash !== manifest.lastHash) throw new Error('Journal does not have a matching final durable checkpoint.');
    if ((await getHead(send)).number !== 0) throw new Error('Replay requires an explicitly started empty local node; refusing to reset or overwrite an existing chain.');
    const transactions = records.filter(entry => entry.payload.event === 'transaction').map(entry => entry.payload);
    const senders = new Set();
    for (const event of transactions) {
      const parsed = Transaction.from(event.raw);
      if (parsed.chainId !== 31337n || parsed.hash?.toLowerCase() !== event.hash?.toLowerCase()) throw new Error('Journal contains an invalid or non-local signed transaction.');
      senders.add(parsed.from);
    }
    for (const address of senders) {
      if (await send('eth_getTransactionCount', [address, 'pending']) !== await send('eth_getTransactionCount', [address, 'latest'])) throw new Error('Target local node has pending transactions; refusing replay.');
    }
    let replayedTransactions = 0;
    for (const { payload: event } of records) {
      if (event.event === 'intent') continue;
      if (event.event === 'rpc_error') {
        if (!sameHead(await getHead(send), event.before) || !sameHead(event.before, event.after)) throw new Error('Rejected RPC had unexpected chain effects.');
        continue;
      }
      if (event.event === 'receipt') { await verifyReceipt(send, event.receipt); continue; }
      const head = await getHead(send);
      if (!sameHead(head, event.before)) throw new Error('Replay diverged before a recorded operation.');
      if (event.event === 'transaction') {
        if (event.receipt && event.after.number === event.before.number + 1) await send('evm_setNextBlockTimestamp', [event.receipt.blockTimestamp]);
        let hash;
        try { hash = await send('eth_sendRawTransaction', [event.raw]); }
        catch (error) {
          // Hardhat may return an RPC error for a mined reverted transaction.
          // Only the recorded failed-receipt case can be reconciled here.
          if (!event.rpcReturnedError || event.receipt?.status !== 0 || !await send('eth_getTransactionReceipt', [event.hash])) throw new Error('Replayed transaction was rejected by the local node.');
          hash = event.hash;
        }
        if (hash.toLowerCase() !== event.hash.toLowerCase()) throw new Error('Replayed local transaction hash changed.');
        if (event.receipt) await verifyReceipt(send, event.receipt);
        replayedTransactions++;
      } else if (event.event === 'control') {
        if (!CONTROL_METHODS.has(event.method)) throw new Error('Unsupported control event in local journal.');
        if (event.method === 'evm_setIntervalMining' && BigInt(event.params[0]) !== 0n) throw new Error('Cannot replay unjournalled background mining.');
        let params = event.params;
        if (event.method === 'evm_mine') params = [event.after.timestamp];
        else if (event.method === 'hardhat_mine') {
          const count = Number(BigInt(params[0] ?? '0x1'));
          const interval = Number(BigInt(params[1] ?? '0x1'));
          if (!Number.isSafeInteger(count) || count < 1 || count > 100000 || !Number.isSafeInteger(interval)) throw new Error('Invalid bounded local mining event.');
          await send('evm_setNextBlockTimestamp', [event.after.timestamp - (count - 1) * interval]);
        } else if (event.after.number > event.before.number) {
          if (event.after.number !== event.before.number + 1) throw new Error('Unexpected multi-block control effect.');
          await send('evm_setNextBlockTimestamp', [event.after.timestamp]);
        }
        await send(event.method, params);
      } else throw new Error('Unknown local replay event.');
      if (!sameHead(await getHead(send), event.after)) throw new Error('Replay block number or timestamp differs from its original local record.');
    }
    for (const event of transactions) if (event.receipt) await verifyReceipt(send, event.receipt);
    const recoveredHead = await verifyCheckpoint(send, manifest.checkpoint);
    // Block hashes are not asserted identical after reconstructing an EDR node.
    // Original receipt/hash evidence remains in the immutable journal.
    manifest.lastRecovery = { completedAtUtc: new Date().toISOString(), replayedTransactions, recoveredHead, transactionHashesPreserved: true, checkpointVerified: true, identicalBlockHashesClaimed: false };
    manifest.rpcUrl = targetUrl;
    manifest.checkpoint.head = recoveredHead;
    writeManifest(paths.manifest, manifest);
    return { state: 'PASS_LOCAL_REPLAY', replayedTransactions, checkpointReadsVerified: manifest.checkpoint.values.length, recoveredBlockNumber: recoveredHead.number };
  } finally { releaseLock?.(); if (ownsProvider) active.destroy(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = {};
  let invalid = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--runtime' && args[i + 1]) options.runtimeDir = args[++i];
    else if (args[i] === '--rpc' && args[i + 1]) options.rpcUrl = args[++i];
    else invalid = true;
  }
  try {
    if (invalid) throw new Error('Usage: node scripts/replay.mjs [--runtime PROJECT_RUNTIME_DIR] [--rpc LOOPBACK_URL]');
    const result = await replayJournal(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    // Do not print RPC error objects; they may include signed raw transactions.
    const safeMessage = (error.message?.split('\n')[0] ?? 'unknown error').replace(/0x[0-9a-f]{128,}/gi, '[local transaction omitted]').slice(0, 300);
    process.stderr.write(`Local replay failed closed: ${safeMessage}\n`);
    process.exitCode = 1;
  }
}
