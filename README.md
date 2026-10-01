# FairFlow

**Recognize work. Explain rewards. Settle services.**

FairFlow helps project teams connect completed work to contribution rewards and
keep those rewards separate from service income. Projects define contribution
roles, accept work under fixed rules, record recognition and settle delivered
services in one workspace.

## The product flow

1. **Define contribution rules.** Initiators define work, builders deliver it,
   promoters bring attention or users, and users contribute usage feedback or
   corrections. Accepted tasks freeze credits and any prefunded cash bounty.
2. **Recognize completed work.** Evidence is reviewed and finalized. A permanent,
   nontransferable receipt records recognition; FT is issued from the project's
   accumulated contribution progress.
3. **Issue FT at a decreasing rate.** Each award is the difference in cumulative
   issuance before and after recognition. The schedule has no artificial lifetime
   issuance cap. Credits are fixed; an FT estimate is not a guaranteed allocation.
4. **Settle a delivered service.** The evaluation service compares actual JSON
   outputs and their format. Buyer acceptance turns a refundable service payment
   into settled revenue.
5. **Allocate revenue and burn.** The demo allocates 70% to operations and 30% to
   buyback. The protected local swap-and-burn reduces active FT supply while
   leaving recognized credits and total issuance intact.

## What the controlled walkthrough shows

| Result | Observed local value |
| --- | ---: |
| Recognized contribution credits | 13.5 |
| Total FT issued | 1,175 FT |
| FT burned | 1 FT |
| Active FT supply | 1,174 FT |
| Settled service payment | 1 synthetic cash unit |
| Operations allocation | 0.7 synthetic cash units |
| Initial buyback allocation | 0.3 synthetic cash units |
| Buyback spent / remaining | 0.1 / 0.2 synthetic cash units |

Three finalized contributions receive 1,000, 150 and 25 FT. A saved evaluation
includes an intentional wrong-type sample, demonstrating that the service
detects both exact-result and format differences. A fresh Codex-assisted
completion proposed the artifact, self-submission and bounded order; the
integration owner mediated execution through the separate grant checker. Claim
and buyer acceptance are explicitly deterministic scripts.

## Run locally

Use Node.js 22.13 or later and pnpm 11.19 from the project root:

```sh
pnpm install --frozen-lockfile --store-dir .pnpm-store
node scripts/build.mjs
node scripts/start.mjs
```

Open `http://127.0.0.1:18731`. Ctrl+C stops the owned local application. The app
uses a disposable local chain and controlled role accounts; no wallet extension
is needed for this fixture. A fresh source checkout starts a disclosed new
zero-supply chain. The walkthrough values above belong to the preserved original
local demo; private runtime history is excluded from public source preparation.

## Technology

Solidity 0.8.30, OpenZeppelin Contracts 5.6.1, TypeScript 5.9.3, native browser
HTML/CSS/DOM, Node.js, ethers 6.17.0, Hardhat 3.18.0 and esbuild 0.28.2. Exact
dependency versions are locked. The service stores project-local records and a
durable local transaction journal. Local checks cover contribution accounting,
escrow/refunds, permissions, Agent grant limits, burn and cold recovery; they are
engineering tests, not an external audit.

**Arbitrum Sepolia is the submission deployment target.** Public contract
addresses, repository and hosted-demo URLs are pending approved execution and
will be added only after verification. The current local walkthrough is not
public Arbitrum deployment evidence or official USDG/DEX activity.

## Trust and economic limits

Demo settings are H = 1,000 FT per band, Q = 10 credits, a 60-second review delay,
and a 70/30 revenue split. These are provisional hackathon-demo economics.
Finalization order can change an individual contributor's FT allocation.
Reviewers and buyers in the demo are controlled accounts; independent third-party
review and decentralized arbitration are not established. A digest proves
content integrity, not factual truth. Synthetic cash and mock liquidity do not
demonstrate demand, token value or investment returns.

Read [trust and limits](docs/TRUST_AND_LIMITS.md), [AI use](docs/AI_USE.md), and
[source and prior work](docs/PRIOR_WORK.md). This README is prepared for a minimal
FairFlow-only publication bundle; internal inputs, approval records, logs and
runtime history are excluded.

FairFlow-owned code remains **proprietary/unlicensed**: no public reuse license
has been granted. Third-party dependencies retain their licenses and notices.
