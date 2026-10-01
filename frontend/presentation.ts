type OverviewContext = { recorded: boolean; projectNames: string[]; capturedAt?: string };

const SOURCE_URL = 'https://github.com/mosexuanji/fairflow';
const DEPLOYMENT_URL = `${SOURCE_URL}/blob/main/docs/SEPOLIA_DEPLOYMENT.md`;
const DEPLOYED = {
  project: '0xB1822256929b8a60CEf6e7840F63bf8D479AeCb8',
  token: '0xC8fdaB63102303806b49945D4171ca04f3528C60',
  receipt: '0xCc8dED8e01a373D38032887698a5E9A3791F7f0B',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character] ?? character));
}

function externalLink(url: string, label: string, className = ''): string {
  return `<a class="${className}" href="${url}" target="_blank" rel="noopener noreferrer">${label}<span aria-hidden="true"> ↗</span></a>`;
}

function projectModel(projectNames: string[]): string {
  const realNames = projectNames.filter((name) => typeof name === 'string' && name.trim().length > 0);
  const loaded = realNames.length > 0;
  const displayed = loaded ? realNames.slice(0, 3) : ['An individual project'];
  return `<aside class="ffp-project-model" aria-label="${loaded ? 'Projects in the current data' : 'Conceptual project model; project data not loaded'}">
    <div class="ffp-model-caption">${loaded ? 'PROJECTS IN THE CURRENT DATA' : 'CONCEPTUAL MODEL · PROJECT DATA NOT LOADED'}</div>
    <div class="ffp-model-root"><span class="ffp-model-mark" aria-hidden="true">F</span><div><strong>FairFlow</strong><span>Rules · recognition · accounting</span></div></div>
    <div class="ffp-model-connector" aria-hidden="true"></div>
    <div class="ffp-model-projects" data-project-columns="${displayed.length}">${displayed.map((name) => `<article class="ffp-model-project">
      <h2>${escapeHtml(name)}</h2><ol><li>Contribution rules</li><li>Evidence &amp; recognition</li><li>Project FT &amp; receipts</li><li>Services &amp; revenue</li><li>Economic feedback</li></ol>
    </article>`).join('')}</div>
    ${realNames.length > displayed.length ? `<p class="ffp-model-more">${realNames.length - displayed.length} more project instances in the current data.</p>` : ''}
    <div class="ffp-model-participants"><span>Humans <i aria-hidden="true">+</i> Agents</span><small>Participant types · the same project rules</small></div>
    <p class="ffp-model-note">Each project keeps its own contribution history and economic accounting. Templates are a future product direction.</p>
  </aside>`;
}

function deploymentDetails(): string {
  return `<details class="ffp-deployment-details"><summary>Verified deployment contracts</summary><dl>${([
    ['FairFlowProject', DEPLOYED.project], ['Project FT (FFT)', DEPLOYED.token], ['Contribution Receipt', DEPLOYED.receipt],
  ] as const).map(([label, address]) => `<div><dt>${label}</dt><dd>${externalLink(`https://sepolia.arbiscan.io/address/${address}`, `<code>${address}</code>`)}</dd></div>`).join('')}</dl></details>`;
}

export function overviewView(context: OverviewContext): string {
  const mode = context.recorded ? 'Recorded, read-only demo' : 'Local prototype workflow';
  const captured = context.recorded && context.capturedAt ? `<span>Captured ${escapeHtml(context.capturedAt)}</span>` : '';
  return `<div class="overview-page">
    <section class="ffp-overview-hero" aria-labelledby="overview-title">
      <div class="ffp-hero-copy"><p class="ffp-kicker">THE PROJECT ECONOMIC LAYER</p>
        <h1 id="overview-title">Make contribution<br><span>count.</span></h1>
        <p class="ffp-positioning">An economic operating layer for projects where humans and agents create, validate, use and pay for work together.</p>
        <p class="ffp-hero-support">Define contribution rules before work begins. Recognize completed work under versioned rules. Settle services and connect contribution to project-level economic outcomes.</p>
        <div class="ffp-actions"><a class="ffp-primary-link" href="#projects">Explore projects <span aria-hidden="true">→</span></a><button class="ffp-secondary-button" type="button" data-how-it-works aria-controls="how-fairflow-works">How FairFlow works <span aria-hidden="true">↓</span></button></div>
        <p class="ffp-hero-footnote">AI-first. Open to human and agent contribution.</p>
      </div>
      ${projectModel(context.projectNames)}
    </section>

    <div class="ffp-proof-strip" aria-label="Current demonstration and deployment">
      <div><span class="ffp-proof-label">THE WORKFLOW YOU CAN EXPLORE</span><strong>${mode} <span class="ffp-proof-chain">· local chain 31337</span></strong>${captured}</div>
      <div><span class="ffp-proof-label">PUBLIC-CHAIN DEPLOYMENT EVIDENCE</span><strong>${externalLink(DEPLOYMENT_URL, 'Deployed on Arbitrum Sepolia', 'ffp-proof-link')}</strong><span>Two confirmed transactions · policy v1 · 91 read-only checks</span></div>
    </div>

    <section class="ffp-section" id="why-now" aria-labelledby="why-now-title">
      <div class="ffp-section-heading"><p class="ffp-kicker">WHY NOW</p><h2 id="why-now-title">Building software is getting cheaper.<br>Organizing value is not.</h2><p>AI lowers the cost of creating applications, agents and workflows. The questions around contribution, authority and payment remain.</p></div>
      <div class="ffp-three-columns">
        <article class="ffp-light-card"><span class="ffp-card-index">01 / CONTRIBUTION</span><h3>What counts as work?</h3><p>Who contributed what? What evidence counts? How can users contribute value beyond a purchase?</p></article>
        <article class="ffp-light-card"><span class="ffp-card-index">02 / COORDINATION</span><h3>Who can recognize it?</h3><p>Who may accept or reject work? How are humans and agents attributed, authorized and paid?</p></article>
        <article class="ffp-light-card"><span class="ffp-card-index">03 / ECONOMICS</span><h3>Where does value flow?</h3><p>How does service revenue relate to contributors, operating budgets and the project's economic outcomes?</p></article>
      </div>
      <p class="ffp-section-conclusion">FairFlow focuses on what begins after an application can be built: organizing a project that people and agents can contribute to, evaluate, pay for and sustain.</p>
    </section>

    <section class="ffp-section ffp-how-section" id="how-fairflow-works" aria-labelledby="how-title">
      <div class="ffp-section-heading"><p class="ffp-kicker">HOW FAIRFLOW WORKS</p><h2 id="how-title">A shared path from work to value.</h2><p>Contribution recognition and service settlement have distinct rules, connected within each project.</p></div>
      <ol class="ffp-four-steps">
        <li><span class="ffp-step-number">01</span><h3>Define</h3><p>Publish contribution roles, evidence requirements and economic rules before work begins.</p></li>
        <li><span class="ffp-step-number">02</span><h3>Contribute</h3><p>Humans and agents build, promote, use, evaluate or otherwise contribute under those rules.</p></li>
        <li><span class="ffp-step-number">03</span><h3>Recognize</h3><p>Review and finalize evidence under versioned rules. Recognized work can create permanent receipts and project-specific FT.</p></li>
        <li><span class="ffp-step-number">04</span><h3>Settle</h3><p>Stable-value payments handle bounties and services. Settled revenue can support operations and economic feedback, including buyback and burn.</p></li>
      </ol>
      <div class="ffp-principle-note"><strong>Payment and usage alone do not earn contribution rewards.</strong><span>Work must meet the project's evidence and recognition rules. The local settlement demonstration uses synthetic LocalCash and mock liquidity.</span></div>
    </section>

    <section class="ffp-section" aria-labelledby="built-title">
      <div class="ffp-section-heading ffp-heading-with-link"><div><p class="ffp-kicker">WHAT EXISTS TODAY</p><h2 id="built-title">Built for Open House Singapore.</h2><p>Implemented capabilities, with a controlled local workflow and separate public-chain deployment proof.</p></div>${externalLink(SOURCE_URL, 'View public source', 'ffp-inline-link')}</div>
      <div class="ffp-capability-grid">
        <article class="ffp-light-card"><span class="ffp-capability-icon" aria-hidden="true">01</span><h3>Rules before rewards</h3><p>Project-level contribution rules and versioned policy.</p><div class="ffp-role-tags"><span>Initiator</span><span>Builder</span><span>Promoter</span><span>User</span></div></article>
        <article class="ffp-light-card"><span class="ffp-capability-icon" aria-hidden="true">02</span><h3>A permanent contribution record</h3><p>Evidence review and finalization, non-transferable receipts and project-specific FT.</p><small>Receipt integrity records recognized work; it does not establish factual truth by itself.</small></article>
        <article class="ffp-light-card"><span class="ffp-capability-icon" aria-hidden="true">03</span><h3>Issuance follows contribution</h3><p>Diminishing marginal FT issuance, with no artificial lifetime issuance cap.</p><small>Burn reduces active supply without rolling back recognized contribution or issuance progress.</small></article>
        <article class="ffp-light-card"><span class="ffp-capability-icon" aria-hidden="true">04</span><h3>Services have a settlement path</h3><p>Service settlement, revenue routing and separate operations / buyback accounting.</p><small>The demonstrated payment and burn loop is local. No live Sepolia service settlement or public DEX operation is claimed.</small></article>
        <article class="ffp-light-card"><span class="ffp-capability-icon" aria-hidden="true">05</span><h3>Distinct project economies</h3><p>Isolated project ledgers, recognition history and token / cash accounting.</p><small>Contribution and financial records stay with their project.</small></article>
        <article class="ffp-light-card"><span class="ffp-capability-icon" aria-hidden="true">06</span><h3>Bounded agent-assisted actions</h3><p>A fresh model-assisted proposal is checked by a separate executor against its permitted actions and budget.</p><small>Claim and buyer acceptance are deterministic scripts. Wallet controls and execution permissions stay separate from model judgment.</small></article>
      </div>
      <div class="ffp-release-evidence"><div><span class="ffp-status-dot" aria-hidden="true"></span><strong>Arbitrum Sepolia deployment verified</strong><p>FairFlowProject, its internally created FFT and Receipt, and policy v1 are confirmed on chain 421614. The public source and recorded demo are available.</p>${deploymentDetails()}</div>${externalLink(DEPLOYMENT_URL, 'Inspect deployment evidence', 'ffp-inline-link')}</div>
      <p class="ffp-release-limit">The current release is a hackathon prototype, not a production economic network. Controlled demo roles do not establish independent review, external demand or real revenue. No external audit is claimed.</p>
    </section>

    <section class="ffp-section ffp-two-columns" aria-label="Who FairFlow is for">
      <article class="ffp-audience-card"><p class="ffp-kicker">USERS CAN CONTRIBUTE</p><h2>Use can lead to useful work.</h2><p>Accepted feedback, corrections, evaluation, permitted data, useful usage evidence and discovery of real use cases can qualify under a project's rules.</p><p class="ffp-audience-footnote">A purchase or a visit alone does not become recognized contribution.</p></article>
      <article class="ffp-audience-card"><p class="ffp-kicker">AI-FIRST, OPEN PARTICIPATION</p><h2>Build cheaply. Coordinate carefully.</h2><p>The strongest initial fit is projects with independent contributors, evidence or acceptance requirements, cross-party payments and meaningful contribution records.</p><p class="ffp-audience-footnote">Humans and agents use the same economic rules. Blockchain and project tokens are design choices for that fit, not requirements for every AI application.</p></article>
    </section>
    <div class="ffp-page-end"><p>Start with a project. Follow its rules, recognition and settlement.</p><a class="ffp-primary-link" href="#projects">Explore projects <span aria-hidden="true">→</span></a></div>
  </div>`;
}

function stageHeading(number: string, stage: string, status: string, title: string, id: string): string {
  return `<div class="ffp-stage-heading"><div class="ffp-stage-marker"><span>${number}</span><strong>${stage}</strong></div><div><span class="ffp-stage-status">${status}</span><h2 id="${id}">${title}</h2></div></div>`;
}

export function roadmapView(): string {
  return `<div class="roadmap-page">
    <header class="ffp-roadmap-intro"><p class="ffp-kicker">FAIRFLOW / ROADMAP</p><h1>From project economies<br>to shared infrastructure.</h1><p>Capability stages, with implemented proof separated from planned product direction and exploratory protocol options. No dated delivery commitments.</p></header>
    <ol class="ffp-stage-ribbon" aria-label="Capability stages">${([
      ['NOW', 'Project economies'], ['NEXT', 'Factory & templates'], ['EXPAND', 'Humans + agents'],
      ['SCALE', 'Shared validation'], ['PROTOCOL', 'Protocol layer'], ['LONG TERM', 'FairFlow Chain'],
    ] as const).map(([stage, title], index) => `<li><span>0${index + 1}</span><strong>${stage}</strong><small>${escapeHtml(title)}</small></li>`).join('')}</ol>

    <section class="ffp-roadmap-stage ffp-stage-current" aria-labelledby="roadmap-now-title">
      ${stageHeading('01', 'NOW', 'CURRENT PROTOTYPE', 'Project Economies', 'roadmap-now-title')}
      <p class="ffp-stage-intro">Each project defines what counts as contribution, recognizes work and connects project-specific FT to its service economics.</p>
      <ul class="ffp-feature-list"><li>Project-specific contribution rules, evidence and recognition</li><li>Project-specific FT and permanent receipts</li><li>Stable-value bounty / service-payment architecture</li><li>Revenue routing and operations / buyback accounting</li><li>Buyback / burn accounting without resetting contribution progress</li><li>Isolated project ledgers and token / cash accounting</li><li>Human and agent-compatible participation under bounded permissions</li></ul>
      <ol class="ffp-economic-loop" aria-label="Core project economy loop"><li>Contribution</li><li>Recognition</li><li>Project FT</li><li>Service Revenue</li><li>Economic Feedback</li></ol>
      <div class="ffp-stage-scope"><p><strong>Demonstrated locally:</strong> the recorded contribution, settlement and mock buyback / burn workflow on chain 31337.</p><p><strong>Public-chain proof:</strong> two authorized Arbitrum Sepolia deployment / policy transactions and 91 read-only checks. This does not establish live public service settlement.</p></div>
    </section>

    <section class="ffp-roadmap-stage" aria-labelledby="roadmap-next-title">
      ${stageHeading('02', 'NEXT', 'PLANNED PRODUCT DIRECTION', 'Project Factory &amp; Reusable Templates', 'roadmap-next-title')}
      <p class="ffp-stage-intro">Make the organization of an AI project reusable, alongside the software that powers it.</p>
      <div class="ffp-three-columns">
        <article class="ffp-template-family"><span>PRODUCTION</span><h3>How the service works</h3><p>How agents, models, data, tools and workflows combine into a service.</p></article>
        <article class="ffp-template-family"><span>CONTRIBUTION &amp; VALIDATION</span><h3>How work is recognized</h3><p>Contribution criteria, evidence, review, attribution and protection from duplicate recognition.</p></article>
        <article class="ffp-template-family"><span>ECONOMICS &amp; OPERATIONS</span><h3>How value is organized</h3><p>Rewards, project tokens, bounties, settlement, budgets, revenue routing and permissions.</p></article>
      </div>
      <p class="ffp-stage-followup">Potential later capabilities: reusable project templates, versioned schemas, a template library and project creation from tested configurations. The factory, library and template marketplace are not built today.</p>
    </section>

    <section class="ffp-roadmap-stage" aria-labelledby="roadmap-expand-title">
      ${stageHeading('03', 'EXPAND', 'PLANNED PARTICIPATION &amp; ADAPTERS', 'Human + Agent Economy', 'roadmap-expand-title')}
      <p class="ffp-stage-intro">Humans and agents use the same economic rules. <strong>Human and Agent are participant types, not contribution roles.</strong></p>
      <div class="ffp-participation-model"><div class="ffp-participant-types"><span>Human</span><i aria-hidden="true">+</i><span>Agent</span></div><span class="ffp-participation-label">Either participant type can contribute as</span><div class="ffp-role-tags"><span>Initiator</span><span>Builder</span><span>Promoter</span><span>User</span></div></div>
      <div class="ffp-two-columns ffp-expand-columns"><div><h3>Future agent capabilities</h3><ul class="ffp-plain-list"><li>Read rules and tasks; submit work and evidence</li><li>Query recognition state and receive authorized rewards</li><li>Purchase services and make programmable stablecoin payments under bounded permissions</li></ul></div><div><h3>Possible payment adapters</h3><div class="ffp-adapter-tags"><span>x402</span><span>MPP</span><span>Agent-wallet integrations</span></div><p>Future integration options, not current FairFlow functionality. Wallet controls and execution permissions remain separate from model judgment.</p></div></div>
      <p class="ffp-stage-followup">User-side feedback, corrections, evaluation, permitted data and useful usage evidence can contribute value. Payment or usage alone does not trigger recognition or token rewards.</p>
    </section>

    <section class="ffp-roadmap-stage" aria-labelledby="roadmap-scale-title">
      ${stageHeading('04', 'SCALE', 'FUTURE VALIDATION INFRASTRUCTURE', 'Shared Validation Network', 'roadmap-scale-title')}
      <p class="ffp-stage-intro">A potential evolution beyond project-owner-designated review. A shared validator network does not exist in the current release.</p>
      <ul class="ffp-feature-list"><li>Shared validator pool and specialized validators</li><li>Evidence standards and validator reputation</li><li>Cross-project attestations and a validation marketplace</li><li>Potential staking / slashing mechanisms</li><li>Threshold or consensus-based finalization where appropriate</li></ul>
      <div class="ffp-issuance-principle"><span>THE ISSUANCE PRINCIPLE STAYS</span><p>Contribution happens <i aria-hidden="true">→</i> validated <i aria-hidden="true">→</i> finalized <i aria-hidden="true">→</i> issuance</p><small>Issuance follows finalized contribution, rather than fixed epoch emissions.</small></div>
    </section>

    <section class="ffp-roadmap-stage" aria-labelledby="roadmap-protocol-title">
      ${stageHeading('05', 'PROTOCOL', 'EXPLORATORY SHARED INFRASTRUCTURE', 'FairFlow Protocol Layer', 'roadmap-protocol-title')}
      <p class="ffp-stage-intro">Reusable contribution infrastructure + shared validation + independent project economies.</p>
      <ul class="ffp-feature-list"><li>Contribution standards and shared validators</li><li>Shared security and common infrastructure</li><li>Protocol governance and treasury / fees</li><li>Ecosystem incentives and shared protocol economics</li></ul>
      <div class="ffp-protocol-model"><span class="ffp-model-caption">CONCEPTUAL FUTURE MODEL</span><strong>FairFlow Protocol</strong><div class="ffp-protocol-projects"><div><b>AFT</b><span>Project A economy</span></div><div><b>BFT</b><span>Project B economy</span></div><div><b>CFT</b><span>Project C economy</span></div></div><p>Project tokens remain project-specific. These generic projects illustrate a future model, not additional current instances.</p></div>
      <aside class="ffp-token-option"><span class="ffp-stage-status">DESIGN OPTION · NOT A LAUNCH PLAN</span><h3>A protocol token must earn its place.</h3><p>A protocol token is a design option, not a prerequisite. Its role must be justified by real shared utility.</p><p class="ffp-token-utilities">Potential utility to assess: validator staking, slashing collateral, shared governance, shared-security incentives and protocol economics.</p><small>No token decision, launch schedule, investment opportunity or expected token value is implied.</small></aside>
    </section>

    <section class="ffp-long-term" aria-labelledby="roadmap-chain-title"><p class="ffp-kicker">06 / LONG TERM</p><span class="ffp-long-term-condition">ONLY IF SCALE JUSTIFIES IT</span><h2 id="roadmap-chain-title">FairFlow Chain<br><span>built with Arbitrum</span></h2><p class="ffp-long-term-intro">A possible dedicated chain, only if substantial project count, contribution-event volume, validator activity, protocol execution requirements and protocol economics justify it.</p>
      <div class="ffp-two-columns"><div><h3>Potential reasons for a dedicated chain</h3><ul class="ffp-plain-list"><li>Dedicated execution rules and a custom gas model</li><li>Validator economics and protocol-native settlement</li><li>High-frequency contribution / validation activity</li><li>Custom governance and data-availability choices</li></ul></div><div class="ffp-chain-options"><h3>Implementation choices come later</h3><p>Stylus or heavier compute could be assessed for complex scoring, cryptographic validation or heavier data checks.</p><p>Additional-chain adapters may be possible. The core direction is FairFlow's own product and protocol evolution.</p></div></div>
      <p class="ffp-long-term-footnote">Exploratory direction only. No new chain, protocol token or validation network is deployed by this prototype.</p>
    </section>
    <div class="ffp-page-end"><div><p>Start with what is built today.</p>${externalLink(DEPLOYMENT_URL, 'Deployed on Arbitrum Sepolia', 'ffp-inline-link')}</div><a class="ffp-primary-link" href="#projects">Explore projects <span aria-hidden="true">→</span></a></div>
  </div>`;
}
