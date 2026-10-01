# Arbitrum Sepolia deployment preparation

**PREPARED_NOT_DEPLOYED — operational snapshot 2026-10-01 06:40 UTC. No Owner deployment transaction has been signed or broadcast, and no deployed contract address exists.** A distinct controlled reviewer has been configured privately and a free official-platform faucet delivered 0.00151 test ETH. Owner authorized exactly project deployment and policy-v1 publication on chain421614, each with value0 and cumulative gas fees at most0.02 test ETH. This plan preserves the FairFlow0.1.0 core; official USDG acquisition, tasks/orders, pools, liquidity and swaps are outside this execution scope. The public default configuration deliberately keeps account fields null; private wallet, approval and runtime records are excluded from the release.

## Network and wallet

| Field | Exact expected value |
|---|---|
| Network | Arbitrum Sepolia testnet |
| Chain ID | `421614` (`0x66eee`) |
| Read-only RPC | `https://sepolia-rollup.arbitrum.io/rpc` |
| Explorer | `https://sepolia.arbiscan.io` |
| Gas asset | Test ETH / SepoliaETH, never purchased real ETH |
| Deployer | A new dedicated Owner-selected public-testnet account; address currently `null` |
| Reviewer | A distinct Owner-selected controlled testnet address; currently `null` |
| Service provider | Owner-selected controlled testnet address; currently `null` |
| Operations recipient | Owner-selected testnet address; can equal deployer; currently `null` |

The network fields follow the [official Arbitrum network table](https://docs.arbitrum.io/arbitrum-bridge/quickstart). No mainnet or automatic fallback is available. The scripts reject this project's seven known disposable fixture accounts; Owner must also attest that the chosen account uses a new dedicated testnet wallet and no production/Hardhat keys. A public address cannot prove that a key is new, so that attestation remains an explicit Owner responsibility. Do not reuse any local development key, paste a seed/private key into commands, read another wallet file, or transfer personal assets.

The CLI requires an explicitly reviewed external signer connector, loaded only after the exact approval gates pass. It has no default signer, private-key argument, environment-key lookup, browser-wallet discovery or clipboard access. This public source does not contain a MetaMask signing UI. A separate private browser bridge has been implemented and reviewed, with12 simulated safety checks passing; those checks do not prove an actual injected wallet or public signatures. Public execution still requires verification of the approved connected account and network, fresh balance/fee checks and the two actual wallet confirmations.

## Cash asset and exact contracts

The project constructor references the official Arbitrum Sepolia USDG at **`0xFFC95faa3d63Cde504a05B567C600B78C0b41892`**, with **6 decimals**. Its source is [Paxos testnet documentation](https://docs.paxos.com/guides/stablecoin/usdg/testnet). The prior independent dependency evidence includes its verified ABI/code and implementation; the new script rechecks chain/code/decimals/symbol using only public reads before any future transaction.

Fresh read-only preflight at **2026-10-01T05:13:44.230Z**, block **314532473**, returned chain421614, USDG symbol, decimals6, 170-byte proxy code, and code keccak256 `0x864cc9ad53b338b82da1f7cab85ab0b3d5c8861acb422b6fec63cf36234f36a6`. These are observations, not asset acquisition or transfer/freeze/pausing tests. Recheck before signing because USDG is an upgradeable issuer-controlled asset. No USDG balance is required to deploy and publish this initial zero-cash project.

| Order | Artifact / method | Creates or changes |
|---|---|---|
| Owner signature 1 | `dist/contracts/FairFlowProject.json` constructor | Deploys one FairFlow project; its constructor internally deploys `ProjectToken` (FFT, 18 decimals) and soulbound `Receipt` |
| Owner signature 2 | `FairFlowProject.publishPolicy(uint128[4],bytes32[4],string[4],bytes32,string)` | Publishes policy v1 for four roles |

`ProjectToken.json` and `Receipt.json` are used to check internally created contracts; they are not extra deployment transactions. Neither `LocalCash` nor any DEX fixture, adapter, MathHarness or liquidity pool is publicly deployed. A new DemoCash token is deliberately unnecessary for this plan. Public contribution/settlement demos needing cash would require a later specifically authorized official-asset/faucet/transaction branch.

Constructor order is:

```text
projectName,
cashToken,
reviewAddress,
provider,
opsRecipient,
h,
q,
delaySeconds,
splitBps,
taskLimit,
template,
templateHash
```

The committed values are `FairFlow Evaluation`, official USDG, Owner-selected addresses, `h=1000000000000000000000`, `q=10000000`, `delaySeconds=60`, `splitBps=3000`, and `taskLimit=1000000000` credit atoms. Role credit atoms are **Initiator10000000 / Builder3000000 / Promoter200000 / User500000**, with6 credit decimals. The task limit is a per-task validation bound, not an issuance cap. The curve has diminishing marginal issuance and no artificial total cap; burn never rolls back contribution progress. Finalization order can affect an individual contributor's FT allocation. All values are hackathon-demo settings, not final public token economics.

Metadata bytes are stored in `config/sepolia-plan.json`, canonicalized and hashed; template/schema/policy URNs contain their keccak256 commitments. URNs do not mean a public server is hosting the metadata. Any later public URLs/files and source-verification upload require their separate publication permission. The preparation output contains the exact bytes, constructor arguments, publishPolicy arguments, calldata and artifact/source hashes for review.

## Exact commands

Run from the independent FairFlow root with the existing locked Node dependencies and already-built `dist/contracts` artifacts:

```powershell
node scripts/deploy-sepolia.mjs --offline
node scripts/deploy-sepolia.mjs --preflight
node --test tests/deployment.test.mjs
```

The first command is offline preparation. The default invocation, or `--preflight`, performs public **read-only** network/USDG checks. Neither opens a signer, requests accounts, creates an approval file nor writes a deployment record. Null Owner addresses are reported explicitly; no invented contract addresses are substituted.

After Owner chooses the new public addresses, copy the plan to `config/sepolia.owner.json` and fill only the address fields. Re-run:

```powershell
node scripts/deploy-sepolia.mjs --offline --config config/sepolia.owner.json
node scripts/deploy-sepolia.mjs --preflight --config config/sepolia.owner.json
```

The output contains `planSha256`. Constructor and policy calldata, asset/address choices, economics and all artifact/source hashes are bound to that hash. A later exact Owner approval is needed before any signing. The permission record must be private, reflect actual direct Owner authorization and include:

```text
kind: FAIRFLOW_SEPOLIA_DEPLOYMENT_OWNER_APPROVAL
authorized: true
approvedBy: OWNER
chainId: 421614
planSha256: <exact reviewed plan hash>
allowedActions: [DEPLOY_FAIRFLOW_PROJECT_WITH_INTERNAL_TOKEN_AND_RECEIPT, PUBLISH_POLICY_V1]
maximumTransactions: 2
newDedicatedTestnetWallet: true
noProductionOrLocalHardhatKeys: true
ownerConsentReference: <direct specific Owner decision>
notBeforeUnix: <Unix seconds>
expiresAtUnix: <Unix seconds, at most24hours later>
maximumTotalGasFeeWei: <approved maximum test-ETH gas fee as decimal string>
signerModulePath: <explicit Owner-provided signer connector reference>
signerModuleSha256: <reviewed connector file hash>
```

This document is **not an approval record**. None was created during preparation. Software validation binds a file to the plan; it cannot establish that a human actually consented. The integration owner must verify that the record corresponds to the direct Owner decision. Keep consent records and signer references out of the public repository/bundle.

Only after that decision and a reviewed signer connector are available, the exact deployment command is:

```powershell
node scripts/deploy-sepolia.mjs --config config/sepolia.owner.json --execute --approval-file "<Owner-approved private approval file>" --signer-module "<Owner-approved signer connector .mjs>" --output config/sepolia-deployment.json
```

The module must export `createFairFlowSigner({ provider, expectedAddress, chainId })` and return an ethers6 signer for that approved account. The execution export uses the same boundary as the CLI:

```text
executeDeployment({ config, approval, provider, signerModulePath, output })
```

Direct signer injection is rejected. Plan/scope/time and the explicit file reference are validated before any connector file read. The connector's exact path and current file hash are checked at the execution boundary and before dispatch; its import URL includes that verified hash so a long-lived process cannot silently reuse earlier code at a replaced path. It is imported only after plan/scope/expiry/fee checks, read-only421614 preflight, and durable one-attempt consumption. The dispatcher requests at most the two listed transaction signatures, in order; no message, permit or allowance signature is required. A reviewed connector must perform no extra signing/broadcast at import or creation. Entry-module hashing does not attest every imported dependency or hardware/browser component; those remain part of the Owner-reviewed connector prerequisite. Owner's signer display remains the final place to review each actual transaction.

Before importing a connector, the script exclusively creates private `config/sepolia-execution-<planSha256>.json` and the chosen deployment record, flushing file contents. The consumption marker is independent of the output filename and approval interval. A stopped, crashed, successful or uncertain attempt cannot be repeated by choosing a different output or reusing the same plan. Do not delete the marker or original record to retry; inspect/reconcile the original transaction and obtain a separate bounded decision when needed. These records are private preparation/execution state and are excluded from minimal publication.

Gas is bounded by the sum of both requests' reserved `gasLimit × maxFeePerGas` (or legacy gas price), not a fresh cap for the second transaction. Network/Owner are rechecked before dispatch. After each receipt the script independently checks the actual transaction's chain, sender, zero value, target, exact calldata, gas bound, receipt hash and creation address before permitting the next step. The observed fee must fit the reservation and overall cap. PENDING, CONFIRMED, mined REVERTED and UNKNOWN remain distinct; a null receipt is UNKNOWN, not a proven revert. Preparation provides no automatic crash recovery/retry for public transactions and does not claim an actual OS-shutdown test.

## Expected test ETH

The actual separate31337 constructor simulation used **5,256,966 gas**; policy publication used **600,779 gas**; total **5,857,745 gas**. The saved local record is `config/sepolia-local-validation.json`. This optional private preparation record is omitted from the minimal public source; `node --test tests/deployment.test.mjs` regenerates a new local record. This used the exact0.1.0 built project and role/metadata argument shape, with LocalCash substituted solely on the disposable local chain. It deployed no public contract and touched no main application runtime.

For a planning example, 5,857,745 gas × **hypothetical1gwei** × **2× margin** equals **0.01171549 test ETH**. An Owner-provided balance around **0.02 test ETH** is a cautious planning target for these two transactions, **not a guarantee or a faucet request**. Actual Arbitrum estimation includes changing parent-chain poster and execution costs, so local EVM gas and a hypothetical price are not a public fee quote. [Arbitrum gas documentation](https://docs.arbitrum.io/how-arbitrum-works/deep-dives/gas-and-fees) describes those components.

The historical read-only record `config/sepolia-preflight.json` observed gasPrice31572000wei and maxFeePerGas66604000wei before private account configuration. This optional private record is omitted from the minimal public source; `node scripts/deploy-sepolia.mjs --preflight` prints a new public-read observation. The public default addresses remain null; historical readings do not set a permanent fee. The script obtains a new actual constructor estimate for the filled private configuration, then a new policy estimate after deployment, adds30% gas headroom, and refuses a transaction exceeding the approved cumulative test-ETH fee cap. Insufficient balance stops the branch; the executor does not automate funding/faucets. Real-money spending remains0.

## Address and explorer template

`config/sepolia-plan.json` retains the following fields as `null` until actual confirmed deployment; known USDG is only a pre-existing official asset reference:

| New deployment field | Current value |
|---|---|
| FairFlowProject address / explorer | `null` / `null` |
| FFT token address / explorer | `null` / `null` |
| Receipt address / explorer | `null` / `null` |
| Deployment tx / explorer | `null` / `null` |
| Policy tx / explorer | `null` / `null` |

The execution record fills actual new addresses and `https://sepolia.arbiscan.io/address/<address>` / `https://sepolia.arbiscan.io/tx/<hash>` only after confirmed receipts. An explorer link does not prove source verification; no source upload/API-key workflow has run.

## Post-deployment read-only smoke

After the two actual confirmations, run:

```powershell
node scripts/smoke-sepolia.mjs --config config/sepolia.owner.json --deployment config/sepolia-deployment.json
```

This reads the public chain and prints checks. It sends no transaction. The exact initial smoke checks include:

1. Chain421614; project, FFT and Receipt have code. The record's plan hash matches the reconstructed exact configuration/artifacts. Two distinct confirmed zero-value transactions must match the selected Owner, creation calldata/receipt/address, and exact policy calldata addressed to that same project; self-declared calldata hashes alone are insufficient.
2. Owner/reviewer/provider/opsRecipient, official USDG address, symbol/decimals, name, h/q/delay/split/task limit, immutable template digest/URI match the reviewed configuration.
3. Policy version1 and all four role credits/schema digest/URIs match the committed bytes.
4. Recognized credits, gross issuance, totalSupply, totalBurned, task/contribution/order counts, revenue and every accounting bucket start at0; token/Receipt immutable issuers equal project.
5. Adapter, keeper and buyback price/budget configuration remain zero; no DEX or pool is implied. Actual cash balance is reported independently, because anyone can donate tokens and that is not service revenue.

This initial-state smoke must precede any later demo transactions. It will correctly fail initial-zero checks after activity; use separate later-flow evidence rather than weakening those checks. The local run presently proves constructor/argument shape and the read checks only. It does not prove official-asset transfer behavior, faucet availability, public service settlement, live liquidity, autonomous hosted Agent operation, independent review or production readiness.

## Ready and remaining

Ready: unchanged deployable core artifacts; exact two-transaction plan and committed arguments; default offline/read-only behavior; execution-bound connector checks; one-attempt plan consumption; controlled-role configuration; zero-address/explorer template; separate local gas simulation and smoke; **5/5 deployment tests PASS**. The added offline test contains ten scoped regressions for connector binding/loading, exact scope, cumulative cap, duplicate/uncertain/reverted outcomes, and mandatory smoke-record evidence. Its durable result is `docs/submission/DEPLOYMENT_SAFETY_TESTS.json`; the provider and unsigned method stubs simulate421614 without connecting to that network or creating a wallet/signature. The separate31337 constructor/policy test is actual disposable local-chain evidence. Neither proves a real hardware/browser connector or public deployment.

Remaining deployment actions: verify the actual injected approved wallet on421614, check fresh balance and fees, obtain exactly the two reviewed transaction confirmations, resolve their original receipts and run the read-only smoke checks. Authorization and free test gas are already recorded privately; actual deployment is still pending. Public source/Pages publication and external access verification are separate authorized work. Official USDG acquisition and public settlement are outside this scope; final HackQuest Submit and factual funding/eligibility confirmation remain Owner actions.
