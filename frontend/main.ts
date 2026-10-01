import { overviewView, roadmapView } from './presentation';

type JsonObject = Record<string, unknown>;
type Entity = JsonObject & { id?: string | number; status?: string; uri?: string };
type Project = Entity & {
  address?: string; name?: string; token?: string; receipt?: string; policyVersion?: string | number;
  credits?: string; grossIssued?: string; totalBurned?: string; totalSupply?: string;
  buckets?: JsonObject; rules?: Entity[]; tasks?: Entity[]; contributions?: Entity[]; orders?: Entity[];
};
interface State {
  network?: { chainId?: number | string; scope?: string };
  config?: JsonObject;
  projects?: Project[];
  actors?: { name: string; address: string; kind?: string }[];
  transactions?: Entity[];
  agentRuns?: Entity[];
  agents?: { session?: JsonObject; runs?: Entity[] };
  agent?: { session?: JsonObject; nonce?: string | number; spent?: string; runs?: Entity[] };
  evaluations?: Entity[];
  presentation?: { mode?: string; capturedAt?: string };
}
type Tab = 'projects' | 'contributions' | 'funds';
type Destination = 'overview' | 'projects' | 'project' | 'roadmap' | 'not-found';
type InputSpec = { key: string; label: string; type?: 'text' | 'number' | 'json' | 'role' | 'actorType'; placeholder?: string; optional?: boolean; help?: string };
interface ActionSpec { label: string; help: string; fields: InputSpec[] }

const actionSpecs: Record<string, ActionSpec> = {
  publishRule: { label: 'Publish rule version', help: 'Rules update prospectively. Accepted tasks retain fixed credits and cash rewards. Only the administrator can publish.', fields: [
    { key: 'credits', label: 'Four role credit amounts (JSON, atomic-unit strings)', type: 'json', placeholder: '["…", "…", "…", "…"]' },
    { key: 'schemas', label: 'Four evidence format digests (JSON)', type: 'json', optional: true }, { key: 'uris', label: 'Four rule URIs (JSON)', type: 'json', optional: true },
  ] },
  createTask: { label: 'Create funded task', help: 'Credits and cash are fixed; FT is calculated in finalization order. Sponsors pre-fund LocalCash; bounty principal is separate from service revenue.', fields: [
    { key: 'behaviorKey', label: 'Canonical behavior key', help: 'Changing address, role or version cannot earn issuance again for the same canonical behavior.' }, { key: 'role', label: 'Contribution role', type: 'role' },
    { key: 'reward', label: 'Fixed LocalCash bounty (atomic units)', placeholder: '0' }, { key: 'expiresIn', label: 'Expires in seconds', type: 'number', placeholder: '3600' }, { key: 'uri', label: 'Task description URI' },
  ] },
  acceptTask: { label: 'Accept task', help: 'Accept fixed credits and cash rewards. The current FT estimate is not a locked promise; actual issuance uses cumulative progress immediately before finalization.', fields: [{ key: 'taskId', label: 'Task ID' }] },
  submit: { label: 'Submit evidence', help: 'A digest proves content integrity, not factual truth or quality. Agents must identify their operator, submitting actor and beneficiary.', fields: [
    { key: 'taskId', label: 'Task ID' }, { key: 'actorType', label: 'Actor type', type: 'actorType' }, { key: 'operator', label: 'Operator address' },
    { key: 'beneficiary', label: 'Reward beneficiary address' }, { key: 'digest', label: 'Evidence digest (0x + 64 hexadecimal characters)' }, { key: 'uri', label: 'Evidence URI' },
  ] },
  validate: { label: 'Validate contribution', help: 'The designated reviewer checks the evidence; submitters cannot self-review. The demo review delay does not establish independent review or quality.', fields: [{ key: 'contributionId', label: 'Contribution ID' }] },
  reject: { label: 'Reject contribution', help: 'Rejection is available before finalization. This action cannot rewrite already issued receipts or FT.', fields: [{ key: 'contributionId', label: 'Contribution ID' }] },
  finalize: { label: 'Finalize & issue', help: 'After the review delay, actual FT uses current recognized credits C. A nontransferable receipt is issued once; burning does not roll back cumulative issuance progress.', fields: [{ key: 'contributionId', label: 'Contribution ID' }] },
  expire: { label: 'Expire task', help: 'Uses the onchain task deadline. Browser time does not prove onchain expiry.', fields: [{ key: 'taskId', label: 'Task ID' }] },
  claimBounty: { label: 'Claim earned bounty', help: 'Claim only cash already owed to this actor. Retrying payment does not issue FT again.', fields: [{ key: 'contributionId', label: 'Contribution ID' }] },
  cancelTask: { label: 'Cancel task', help: 'Only eligible task states and authorized actors can cancel. Refunds and service revenue remain separate.', fields: [{ key: 'taskId', label: 'Task ID' }] },
  refundTask: { label: 'Claim task refund', help: 'Claim only task funds that satisfy the refund conditions.', fields: [{ key: 'taskId', label: 'Task ID' }] },
  order: { label: 'Buy local evaluation', help: 'Payment first funds a refundable order. Revenue becomes allocable only after delivery and buyer acceptance. LocalCash is a local test asset.', fields: [
    { key: 'clientKey', label: 'Idempotent order key' }, { key: 'price', label: 'LocalCash price (atomic units)' }, { key: 'expiresIn', label: 'Expires in seconds', type: 'number', placeholder: '3600' }, { key: 'formatDigest', label: 'Agreed format digest', optional: true },
  ] },
  deliver: { label: 'Deliver saved evaluation', help: 'References an actual saved evaluation. Its digest and URI are recorded onchain. Deterministic evaluation does not claim model judgment.', fields: [{ key: 'orderId', label: 'Order ID' }, { key: 'evaluationId', label: 'Saved evaluation ID' }] },
  acceptOrder: { label: 'Accept & settle', help: 'The buyer accepts the delivered result; providers cannot recognize their own revenue. Settlement allocates operations and buyback budgets using the project candidate ratio.', fields: [{ key: 'orderId', label: 'Order ID' }] },
  refundOrder: { label: 'Refund order', help: 'Refunds follow the agreed deadline. Unsettled order funds are separate from service revenue.', fields: [{ key: 'orderId', label: 'Order ID' }] },
  buyback: { label: 'Local buyback & burn', help: 'Uses a local Mock DEX only; it does not satisfy official DEX or public-testnet acceptance. Set a budget, positive minOut and deadline. Failure preserves the budget.', fields: [
    { key: 'amount', label: 'LocalCash buyback budget (atomic units)' }, { key: 'minOut', label: 'Minimum FT received (atomic units, positive)' }, { key: 'expiresIn', label: 'Deadline in seconds (maximum 300)', type: 'number', placeholder: '120' },
  ] },
  transfer: { label: 'Transfer project FT', help: 'Transfer only project FT held by the selected actor. Receipts are nontransferable records.', fields: [{ key: 'to', label: 'Recipient address' }, { key: 'amount', label: 'FT amount (atomic units)' }] },
};

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing application root');
const recordedMode = document.documentElement.dataset.fairflowMode === 'recorded-demo';
let state: State | null = null;
let tab: Tab = 'projects';
let destination: Destination = 'overview';
let selectedProject = '';
let capability = '';
let busy = false;
let loading = false;
let loadError = '';
let lastRefresh = '';
let lastEvaluation: JsonObject | null = null;
let lastAgentResponse: JsonObject | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function esc(value: unknown): string { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char)); }
function text(value: unknown, fallback = '—'): string { return value === undefined || value === null || value === '' ? fallback : String(value); }
function list(value: unknown): Entity[] { return Array.isArray(value) ? value as Entity[] : []; }
function json(value: unknown): string { return JSON.stringify(value, null, 2) ?? 'null'; }
function short(value: unknown): string { const s = text(value); return /^0x[0-9a-fA-F]{40,64}$/.test(s) ? `${s.slice(0, 8)}…${s.slice(-6)}` : s; }
function numeric(value: unknown): bigint { try { return BigInt(typeof value === 'string' || typeof value === 'number' ? value : 0); } catch { return 0n; } }
function quantity(value: unknown, kind: 'credit' | 'cash' | 'token'): string {
  if (value === undefined || value === null) return '—';
  const config = state?.config ?? {};
  const decimals = config[`${kind}Decimals`];
  if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 36 || !/^[0-9]+$/.test(String(value))) return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const amount = String(value).padStart(decimals + 1, '0');
  if (decimals === 0) return amount.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = amount.slice(-decimals).replace(/0+$/, '');
  const displayedFraction = fraction.slice(0, kind === 'token' ? 4 : 6).replace(/0+$/, '');
  const approximate = fraction.length > (kind === 'token' ? 4 : 6);
  return `${approximate ? '≈' : ''}${amount.slice(0, -decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${displayedFraction ? `.${displayedFraction}` : ''}`;
}
function units(kind: 'credit' | 'cash' | 'token'): string { return typeof state?.config?.[`${kind}Decimals`] === 'number' ? ({ credit: 'credits', cash: 'LocalCash', token: 'FT' }[kind]) : ({ credit: 'credit atoms', cash: 'LocalCash atoms', token: 'FT atoms' }[kind]); }
function time(value: unknown): string {
  if (value === undefined || value === null) return '—';
  const raw = String(value);
  const date = /^[0-9]+$/.test(raw) ? new Date(Number(raw) * 1000) : new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleString('en-US', { hour12: false });
}
function role(value: unknown): string { const roles = ['Initiator', 'Builder', 'Promoter', 'User']; return roles[Number(value)] ?? text(value); }
function statusBadge(status: unknown): string {
  const label = text(status);
  const color = ['FINALIZED', 'SETTLED', 'SUCCESS', 'CONFIRMED', 'PASS', 'COMPLETED'].includes(label) ? 'green' : ['VALIDATED', 'DELIVERED', 'FUNDED', 'SUBMITTED', 'ACCEPTED', 'PENDING'].includes(label) ? 'blue' : ['EXPIRED', 'REFUNDED', 'CANCELLED', 'CANCELED'].includes(label) ? 'gold' : ['REJECTED', 'FAIL', 'FAILED', 'ERROR', 'REVERTED'].includes(label) ? 'red' : '';
  const humanLabel: Record<string, string> = { FINALIZED: 'Recognized', VALIDATED: 'Review passed', SUBMITTED: 'In review', FUNDED: 'Paid · refundable', DELIVERED: 'Delivered', SETTLED: 'Settled', OPEN: 'Available', ACCEPTED: 'In progress', COMPLETED: 'Complete', CANCELED: 'Canceled', CONFIRMED: 'Confirmed' };
  return `<span class="badge ${color}" title="${esc(label)}">${esc(humanLabel[label] ?? label.toLowerCase().replace(/^./, (char) => char.toUpperCase()))}</span>`;
}
function empty(message: string): string { return `<div class="empty"><div class="empty-symbol">◇</div>${esc(message)}</div>`; }
function button(action: string, label?: string, defaults: JsonObject = {}, style = 'small', eligible = true): string { return recordedMode ? '' : `<button class="button ${style}" data-action="${esc(action)}" data-defaults="${esc(JSON.stringify(defaults))}" ${busy || !capability || !eligible ? 'disabled' : ''}>${esc(label ?? actionSpecs[action]?.label ?? action)}</button>`; }
function details(value: unknown, title = 'View raw record'): string { return `<details class="detail"><summary>${esc(title)}</summary><pre>${esc(json(value))}</pre></details>`; }
function project(): Project | undefined { return state?.projects?.find((p) => String(p.id) === selectedProject); }

async function request(path: string, body?: unknown): Promise<JsonObject> {
  if (recordedMode && body !== undefined) throw new Error('This recorded demo is read-only. No transactions can be submitted.');
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-FairFlow-Capability': capability }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data: unknown = await response.json();
  if (!response.ok) throw new Error(typeof data === 'object' && data !== null && 'error' in data ? String((data as JsonObject).error) : `Local service returned ${response.status}`);
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('Invalid local service response');
  return data as JsonObject;
}
async function refresh(): Promise<void> {
  if (loading) return;
  loading = true; loadError = ''; render();
  try {
    const data = await request(recordedMode ? './demo-state.json' : '/api/state');
    state = data as State;
    if (state.agent) state.agents = { session: state.agent.session ? { ...state.agent.session, nonce: state.agent.nonce, spent: state.agent.spent } : undefined, runs: state.agent.runs };
    if (destination !== 'project' && !state.projects?.some((p) => String(p.id) === selectedProject)) selectedProject = String(state.projects?.[0]?.id ?? '');
    lastRefresh = new Date().toLocaleTimeString('en-US', { hour12: false });
  } catch (error) { loadError = error instanceof Error ? error.message : String(error); }
  loading = false; render();
}
function toast(message: string, error = false): void {
  document.querySelector('.toast')?.remove();
  const element = document.createElement('div'); element.className = `toast${error ? ' error' : ''}`; element.setAttribute('role', 'status'); element.textContent = message; document.body.append(element);
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.remove(), 8500);
}

function projectHref(p: Project, step = 'define'): string { return `#project/${encodeURIComponent(String(p.id))}/${step}`; }
function readRoute(): void {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash || hash === 'overview') { destination = 'overview'; return; }
  if (hash === 'projects' || hash === 'roadmap') { destination = hash; return; }
  const match = /^project\/([^/]+)\/(define|recognize|settle)$/.exec(hash);
  if (match) {
    try { selectedProject = decodeURIComponent(match[1]!); } catch { destination = 'not-found'; return; }
    destination = 'project'; tab = ({ define: 'projects', recognize: 'contributions', settle: 'funds' } as const)[match[2] as 'define' | 'recognize' | 'settle']; return;
  }
  destination = 'not-found';
}
function openWorkflow(next: Tab): void {
  const current = project(); if (!current) return;
  const step = ({ projects: 'define', contributions: 'recognize', funds: 'settle' } as const)[next];
  window.location.hash = projectHref(current, step);
}
function projectHierarchy(p: Project): string {
  return `<div class="project-hierarchy"><div class="breadcrumb"><a href="#projects">Projects</a><span>/</span><strong>${esc(p.name ?? `Project ${p.id}`)}</strong></div><a class="all-projects" href="#projects">← All projects</a></div><div class="project-toolbar"><div class="workspace-context"><label for="project-select" class="context-label">PROJECT</label><select id="project-select" class="project-select" aria-label="Select project">${(state?.projects ?? []).map((item) => `<option value="${esc(item.id)}" ${String(item.id) === String(p.id) ? 'selected' : ''}>${esc(item.name ?? `Project ${item.id}`)}</option>`).join('')}</select><span class="context-note">${recordedMode ? 'Recorded local ledger' : 'Local ledger'}</span></div><nav class="workflow-nav" aria-label="Selected project workflow">${(['projects', 'contributions', 'funds'] as Tab[]).map((item, index) => `<button class="nav-button ${tab === item ? 'active' : ''}" data-tab="${item}" aria-current="${tab === item ? 'step' : 'false'}"><span class="nav-number">0${index + 1}</span>${['Define work', 'Recognize work', 'Settle & burn'][index]}</button>`).join('')}</nav></div>`;
}
function projectsView(): string {
  const projects = state?.projects ?? [];
  return `<section class="projects-page"><div class="projects-intro"><div><div class="eyebrow">FAIRFLOW / PROJECTS</div><h1>A shared layer.<br><span>Independent projects.</span></h1><p>Each FairFlow project has its own contribution rules, recognition history, token accounting and service economics.</p></div><div class="projects-count"><strong>${projects.length}</strong><span>${recordedMode ? 'recorded' : 'local'} project instances</span></div></div><p class="projects-disclosure">${recordedMode ? `Recorded local state · captured ${esc(time(state?.presentation?.capturedAt))}. These figures are not live Arbitrum Sepolia activity.` : 'Current disposable local state on chain 31337. Public-chain deployment evidence is separate.'}</p><div class="project-cards">${projects.map((p, index) => {
    const contributions = list(p.contributions); const recognized = contributions.filter((item) => item.status === 'FINALIZED').length;
    const orders = list(p.orders); const settled = orders.filter((item) => item.status === 'SETTLED');
    const serviceTotal = settled.reduce((sum, order) => sum + numeric(order.price), 0n);
    return `<article class="project-card"><div class="project-card-top"><span class="project-card-number">0${index + 1}</span><span class="badge ${recognized > 0 ? 'green' : ''}">${recognized > 0 ? 'Work recognized' : 'No recognized work'}</span></div><h2>${esc(p.name ?? `Project ${p.id}`)}</h2><p class="project-card-description">${recognized > 0 ? 'Contribution recognition and paid evaluation, in one project economy.' : 'An isolated instance with its own rules and unchanged zero balances.'}</p><dl class="project-card-metrics"><div><dt>Recognized credits</dt><dd>${esc(quantity(p.credits, 'credit'))}</dd></div><div><dt>Total FT issued</dt><dd>${esc(quantity(p.grossIssued, 'token'))}</dd></div><div><dt>Active FT supply</dt><dd>${esc(quantity(p.totalSupply, 'token'))}</dd></div><div><dt>Recognized contributions</dt><dd>${recognized}<small> / ${contributions.length} recorded</small></dd></div></dl><div class="project-card-service"><span>Service settlement</span><strong>${settled.length} settled ${settled.length === 1 ? 'order' : 'orders'} · ${esc(quantity(serviceTotal.toString(), 'cash'))} ${esc(units('cash'))}</strong><small>${orders.length === 0 ? 'No service orders in this ledger.' : `${orders.length} order${orders.length === 1 ? '' : 's'} in this ledger; refundable funds are separate from settled revenue.`}</small></div><div class="project-card-footer"><span>Project-specific FT · Rule v${esc(p.policyVersion)}</span><a class="button primary" href="${esc(projectHref(p))}">Open project <span>→</span></a></div></article>`;
  }).join('')}</div>${projects.length === 0 ? empty(loading ? 'Reading project instances…' : 'No project records are available.') : ''}<div class="projects-principle"><span>ONE PLATFORM · SEPARATE ECONOMIES</span><p>Credits, issuance, receipts and service funds stay with their project. Activity in one ledger does not create progress in another.</p></div></section>`;
}
function render(): void {
  const current = project();
  const activeTop = destination === 'project' ? 'projects' : destination;
  let content: string;
  if (destination === 'overview') content = overviewView({ recorded: recordedMode, projectNames: (state?.projects ?? []).map((p) => text(p.name, `Project ${p.id}`)), capturedAt: state?.presentation?.capturedAt });
  else if (destination === 'roadmap') content = roadmapView();
  else if (destination === 'projects') content = state ? projectsView() : `<section class="loading-stage"><h1>Projects</h1>${empty(loading ? 'Reading project instances…' : 'Project data is unavailable. Please reload the snapshot.')}<a href="#overview">← Overview</a></section>`;
  else if (destination === 'project' && state && current) content = `${projectHierarchy(current)}${tab === 'projects' ? projectView(current) : tab === 'contributions' ? contributionView(current) : fundsView(current)}`;
  else if (destination === 'project' && !state) content = `<section class="loading-stage"><h1>Project workflow</h1>${empty(loading ? 'Reading project data…' : 'Project data is unavailable. Please reload the snapshot.')}<a href="#projects">← All projects</a></section>`;
  else content = `<section class="loading-stage"><div class="eyebrow">FAIRFLOW</div><h1>${destination === 'project' ? 'Project not found.' : 'Page not found.'}</h1><p>This address does not identify an available page or project.</p><a class="button primary" href="#projects">Explore projects →</a></section>`;
  document.title = `${destination === 'project' && current ? text(current.name) : destination === 'overview' ? 'Overview' : destination === 'roadmap' ? 'Roadmap' : destination === 'projects' ? 'Projects' : 'Page not found'} · FairFlow`;
  app!.innerHTML = `<div class="shell"><header class="app-header site-header"><a class="brand" href="#overview" aria-label="FairFlow home"><span class="brand-symbol"><svg viewBox="0 0 28 28" aria-hidden="true"><path d="M5 5h18v5H10v4h10v5H10v5H5z" fill="currentColor"/></svg></span>FairFlow<span class="brand-sub">CONTRIBUTION & SETTLEMENT</span></a><nav class="site-nav" aria-label="FairFlow navigation">${(['overview', 'projects', 'roadmap'] as const).map((item) => `<a class="site-nav-button ${activeTop === item ? 'active' : ''}" href="#${item}" aria-current="${activeTop === item ? 'page' : 'false'}">${item.charAt(0).toUpperCase() + item.slice(1)}</a>`).join('')}</nav><div class="header-tools">${environmentDisclosure()}<button class="icon-button" id="refresh" aria-label="${recordedMode ? 'Reload recorded snapshot' : 'Refresh local chain state'}" title="${recordedMode ? 'Reload snapshot' : 'Refresh chain state'}" ${loading ? 'disabled' : ''}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 8a6 6 0 1 0 .2 4M16 3v5h-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></header><main class="main">
    ${loadError ? `<div class="notice error" role="alert"><strong>Unable to read state.</strong> ${esc(loadError)} ${state ? 'The last read is retained; current state has not been reverified.' : 'Please retry when the data source is available.'}</div>` : ''}
    ${content}<footer class="footer"><span>Hackathon prototype · Candidate economics. No investment, redemption or return promise.</span><span>${recordedMode ? `Read-only recorded local demo · ${esc(time(state?.presentation?.capturedAt))}` : `${lastRefresh ? `Last read ${esc(lastRefresh)}` : 'Not read yet'} · Local prototype`}</span></footer></main></div>`;
  bind();
}
function environmentDisclosure(): string {
  return `<details class="environment-detail"><summary><span class="environment-dot"></span>${recordedMode ? 'Recorded demo' : 'Local prototype'}<span class="disclosure-chevron">⌄</span></summary><div class="environment-content"><strong>${recordedMode ? 'A recorded local workflow; public deployment evidence is separate.' : 'A disposable local test environment.'}</strong><p>${recordedMode ? `Read-only snapshot captured ${esc(time(state?.presentation?.capturedAt))}. No wallet connection, signatures or transactions are available. ` : 'Actions use controlled, disposable local accounts on chain 31337. '}LocalCash, contributions, orders and liquidity are test data. Buyback uses a local Mock DEX, not an official public DEX.</p><p>The reviewer is controlled by the demo team. The 60-second review delay is not independent review or decentralized arbitration. A digest proves content integrity, not factual truth.</p><p>Arbitrum Sepolia contracts are deployed separately from this local workflow. No real liquidity, independent demand, production readiness or returns are implied. The demo issuance curve has no artificial total cap; burn never resets issuance progress.</p>${recordedMode ? '' : `<div class="permission-chip">${capability ? 'Local owner controls available' : 'Read-only session'}</div>`}</div></details>`;
}
function allocationSplit(): { operations: string; buyback: string } {
  const bps = state?.config?.buybackBps;
  if (typeof bps !== 'number' || !Number.isFinite(bps)) return { operations: '—', buyback: '—' };
  return { operations: String((10_000 - bps) / 100), buyback: String(bps / 100) };
}
function roleDescription(value: unknown): string {
  return ['Starts and defines a project task.', 'Delivers execution work.', 'Brings external attention or users.', 'Uses or validates delivered work.'][Number(value)] ?? 'Contributes under the adopted project rules.';
}
function actorLabel(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Controlled test actor';
  const actor = state?.actors?.find((item) => item.address.toLowerCase() === String(value).toLowerCase());
  if (actor) return `${actor.kind === 'Agent' ? 'Agent' : actor.name.charAt(0).toUpperCase() + actor.name.slice(1)}`;
  return short(value);
}
function recordedAgentPolicy(): string {
  return `<div class="agent-grant"><span class="agent-avatar">A</span><div><strong>Model proposes. The guard decides.</strong><span>Recorded execution evidence, with separate provenance</span></div></div><p class="legend">This snapshot does not carry a session or execution authority. The local demonstration constrained Agents to their own contributions and a bounded purchase flow; independent checks preceded each recorded action.</p><div class="flow"><span>Model proposal</span><i>→</i><span>Policy checks</span><i>→</i><span>Local execution record</span></div><p class="legend">Inspect the run records below. Scripts and unverified proposals are separately labeled; their presence does not prove a real model call.</p>`;
}
function projectHero(p: Project): string {
  const split = allocationSplit();
  const recognized = list(p.contributions).filter((item) => item.status === 'FINALIZED').length;
  const settled = list(p.orders).filter((item) => item.status === 'SETTLED').length;
  return `<section class="product-hero"><div class="hero-copy"><div class="eyebrow"><span class="eyebrow-line"></span>WORK HAS VALUE. MAKE IT VISIBLE.</div><h1>Make contribution<br><span>count.</span></h1><p class="hero-description">Recognize the work behind an AI project.<br>Reward contributions. Account for paid services.</p><p class="hero-problem">A shared ledger connects what people deliver with how rewards and revenue are settled.</p><div class="hero-cta"><button class="button primary" data-tab="contributions">Follow the contribution <span>↗</span></button><button class="text-button" data-tab="funds">See settlement →</button></div><div class="hero-proof"><span class="proof-dot"></span>${recognized} recognized contribution${recognized === 1 ? '' : 's'}<span class="proof-separator">/</span>${settled} settled service${settled === 1 ? '' : 's'}<span class="proof-label">in this ${recordedMode ? 'recorded' : 'local'} ledger</span></div></div><div class="mechanism-card"><div class="mechanism-heading"><span>HOW VALUE FLOWS</span><span class="mechanism-scope">DEMO ECONOMICS</span></div><div class="mechanism-work"><div class="mechanism-step"><span class="step-number">01</span><div><strong>Work earns fixed credits</strong><span>Define → contribute → review</span></div></div><span class="mechanism-arrow">↓</span><div class="mechanism-step"><span class="step-number">02</span><div><strong>Credits unlock project FT</strong><span>Finalization order sets each allocation</span></div></div></div><div class="issuance-illustration"><div><span class="chart-caption">FT per next credit</span><svg viewBox="0 0 290 65" role="img" aria-label="Conceptual illustration: marginal issuance decreases as recognized credits increase"><path d="M0 59H290" stroke="#364153"/><path d="M4 8H62V26H120V40H178V49H236V55H286" fill="none" stroke="#8ca3ff" stroke-width="3" stroke-linejoin="round"/><path d="M4 8H62V26H120V40H178V49H236V55H286V59H4Z" fill="#6d83e9" opacity=".11"/></svg><div class="chart-axis"><span>More recognized work →</span><span>No artificial supply cap</span></div></div><div class="curve-note"><strong>Diminishing<br>issuance</strong><span>${esc(quantity(state?.config?.bandAtoms, 'token'))} FT / band<br>Starts at ${esc(quantity(state?.config?.firstStageCreditAtoms, 'credit'))} credits</span></div></div><div class="mechanism-settlement"><div><span class="step-number">03</span><strong>Paid service → buyer acceptance</strong></div><div class="split-flow"><span><b>${esc(split.operations)}%</b> operations</span><span><b>${esc(split.buyback)}%</b> buyback & burn</span></div></div><div class="burn-invariant"><span>↳</span><div><strong>Burn lowers supply. Progress stays.</strong><span>Recognized credits and total FT issued never rewind.</span></div></div></div></section>`;
}
function stats(p: Project): string {
  const entries = [
    { label: 'Recognized contribution credits', value: quantity(p.credits, 'credit'), unit: units('credit'), sub: 'The permanent issuance progress' },
    { label: 'Total FT issued', value: quantity(p.grossIssued, 'token'), unit: units('token'), sub: 'All finalized contribution rewards' },
    { label: 'FT burned', value: quantity(p.totalBurned, 'token'), unit: units('token'), sub: 'Actual tokens removed from supply' },
    { label: 'Active FT supply', value: quantity(p.totalSupply, 'token'), unit: units('token'), sub: 'Total issued less total burned' },
  ];
  return `<section class="stat-grid" aria-label="${recordedMode ? 'Recorded' : 'Local'} contribution ledger metrics">${entries.map((entry, index) => `<article class="stat"><div class="stat-label">${entry.label}<span class="stat-order">0${index + 1}</span></div><div class="stat-value">${esc(entry.value)}<span class="stat-unit">${esc(entry.unit)}</span></div><div class="stat-sub">${entry.sub}</div></article>`).join('')}</section>`;
}
function projectView(p: Project): string {
  const allRules = list(p.rules);
  const rules = allRules.filter((rule) => Number(rule.version) === Number(p.policyVersion));
  const tasks = list(p.tasks);
  return `${projectHero(p)}${stats(p)}<section class="roles-section"><div class="section-head"><div><div class="section-kicker">01 / DEFINE THE WORK</div><h2>Different contributions. A shared set of rules.</h2></div><span class="section-note">Credits are fixed · FT is estimated until finalization</span></div>${rules.length ? `<div class="rules">${rules.map((rule) => `<article class="rule"><div class="rule-top"><span class="role-symbol">${['⌑', '⌘', '↗', '◉'][Number(rule.role)] ?? '◇'}</span><span class="version">Rule v${esc(rule.version)}</span></div><h3>${esc(role(rule.role))}</h3><p>${esc(roleDescription(rule.role))}</p><div class="rule-credit">${esc(quantity(rule.credits, 'credit'))}<span>fixed ${esc(units('credit'))}</span></div></article>`).join('')}</div>` : `<div class="panel">${empty('No contribution rules have been published for this project.')}</div>`}</section>
    <div class="section-head"><div><div class="section-kicker">PROJECT WORK</div><h2>Tasks ready to become contributions</h2><p>Agree on the credits and cash first. FT depends on progress when the contribution is finalized.</p></div>${button('createTask', '＋ Create task', {}, 'primary')}</div><div class="panel">${tasks.length ? `<div class="table-scroll"><table><thead><tr><th>Work</th><th>Fixed reward</th><th>FT at current progress</th><th>Status</th><th></th></tr></thead><tbody>${tasks.map((task) => `<tr><td><div class="cell-main">${esc(role(task.role))} contribution</div><div class="cell-sub">Task ${esc(task.id)} · Rule v${esc(task.version)}</div></td><td><div class="cell-main">${esc(quantity(task.credits, 'credit'))} ${esc(units('credit'))}</div><div class="cell-sub">${numeric(task.reward) > 0n ? `${esc(quantity(task.reward, 'cash'))} ${esc(units('cash'))} bounty` : 'No cash bounty'}</div></td><td><div class="cell-main">${(task.estimatedFT ?? task.estimatedMint) === undefined ? 'Quote unavailable' : `${esc(quantity(task.estimatedFT ?? task.estimatedMint, 'token'))} FT`}</div><div class="cell-sub">Estimate · finalization order matters</div></td><td>${statusBadge(task.status)}</td><td><div class="inline-actions">${task.status === 'OPEN' ? button('acceptTask', 'Accept task', { taskId: task.id }) : task.status === 'ACCEPTED' ? button('submit', 'Submit work', { taskId: task.id }) : ''}</div>${details(task, 'Task details')}${!recordedMode && task.status === 'OPEN' ? `<div class="secondary-actions">${button('cancelTask', 'Cancel', { taskId: task.id }, 'text-small')}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('Define the first task, its contribution rules and any pre-funded cash reward.')}</div>
    <details class="technical-panel"><summary>Project configuration & technical records <span>＋</span></summary><div class="technical-content"><div class="info-list"><div class="info-row"><span>Project</span><strong class="mono">${esc(p.address)}</strong></div><div class="info-row"><span>Project FT</span><strong class="mono">${esc(p.token)}</strong></div><div class="info-row"><span>Nontransferable receipt</span><strong class="mono">${esc(p.receipt)}</strong></div></div>${details(allRules, 'All rule versions and evidence formats')}${details(state?.config, 'Candidate configuration and exact units')}</div></details>${ownerControls(['publishRule', 'createTask', 'expire', 'cancelTask', 'refundTask'])}`;
}
function contributionView(p: Project): string {
  const contributions = list(p.contributions);
  const recognized = contributions.filter((item) => item.status === 'FINALIZED');
  return `<section class="page-intro"><div><div class="eyebrow">02 / RECOGNIZE THE WORK</div><h1>From contribution<br>to a lasting record.</h1><p>Evidence connects the work, the review and the reward.<br>Finalized contributions issue FT and a nontransferable receipt, once.</p></div><div class="intro-fact"><span>${recognized.length.toLocaleString('en-US')}</span><strong>contributions recognized</strong><small>Controlled demo review · ${esc(state?.config?.reviewDelaySeconds ?? '—')} second review window</small></div></section>${stats(p)}
    <div class="review-path"><div><span>01</span><strong>Submit the work</strong><small>Evidence under the adopted rules</small></div><i>→</i><div><span>02</span><strong>Review & wait</strong><small>Controlled reviewer, not independent arbitration</small></div><i>→</i><div><span>03</span><strong>Finalize once</strong><small>FT allocation uses progress at this moment</small></div><i>→</i><div><span>04</span><strong>Keep the receipt</strong><small>Nontransferable evidence relationship</small></div></div>
    <div class="section-head"><div><h2>The contribution ledger</h2><p>A digest protects content integrity. People still review facts and quality.</p></div>${button('submit', '＋ Submit evidence', {}, 'primary')}</div><div class="panel">${contributions.length ? `<div class="table-scroll"><table><thead><tr><th>Contribution</th><th>Review</th><th>Recognized reward</th><th>Receipt</th><th></th></tr></thead><tbody>${contributions.map((item) => `<tr><td><div class="cell-main">${esc(role(item.role))} · task ${esc(item.taskId)}</div><div class="cell-sub">${esc(actorLabel(item.actor))} · ${esc(['Human', 'Agent', 'Organization'][Number(item.actorType)] ?? item.actorType)}</div></td><td>${statusBadge(item.status)}<div class="cell-sub">${esc(time(item.finalizedAt && numeric(item.finalizedAt) > 0n ? item.finalizedAt : item.submittedAt))}</div></td><td><div class="cell-main">${esc(quantity(item.credits, 'credit'))} ${esc(units('credit'))}</div><div class="cell-sub">${item.status === 'FINALIZED' ? `${esc(quantity(item.minted, 'token'))} FT actually issued` : 'FT is set at finalization'}</div></td><td>${item.status === 'FINALIZED' ? `<span class="receipt-marker">◈</span><span class="cell-main"> #${esc(item.receiptId ?? item.id)}</span><div class="cell-sub">Nontransferable</div>` : '<span class="cell-sub">After finalization</span>'}</td><td><div class="inline-actions">${item.status === 'SUBMITTED' ? button('validate', 'Review', { contributionId: item.id }) + button('reject', 'Reject', { contributionId: item.id }, 'text-small danger') : item.status === 'VALIDATED' ? button('finalize', 'Finalize & issue', { contributionId: item.id }) + button('reject', 'Reject', { contributionId: item.id }, 'text-small danger') : item.status === 'FINALIZED' && numeric(item.claimable) > 0n ? button('claimBounty', 'Claim cash', { contributionId: item.id }) : ''}</div>${details(item, 'Evidence & exact allocation')}</td></tr>`).join('')}</tbody></table></div>` : empty('There are no contributions yet. Complete a task and attach evidence for review.')}</div>
    <div class="explanation-grid"><article class="explanation-card"><span class="explanation-number">01</span><h3>Fixed credits. Variable FT.</h3><p>Credits and cash are locked to the task rules. Diminishing issuance means finalization order can affect each contributor’s FT allocation.</p></article><article class="explanation-card"><span class="explanation-number">02</span><h3>A record, not a share.</h3><p>Receipts are nontransferable. A role does not grant review or administration rights; FT has no redemption or guaranteed return.</p></article><article class="explanation-card"><span class="explanation-number">03</span><h3>One behavior, one issuance.</h3><p>Project and canonical behavior identity prevent repeat issuance. This does not solve every real-world identity or semantic duplicate.</p></article></div><details class="technical-panel"><summary>Transaction evidence <span>＋</span></summary><div class="technical-content">${transactionTrail()}</div></details>${ownerControls(['validate', 'reject', 'finalize', 'claimBounty'])}`;
}
function fundsView(p: Project): string {
  const buckets = p.buckets ?? {};
  const orders = list(p.orders);
  const settled = orders.filter((order) => order.status === 'SETTLED');
  const settledTotal = settled.reduce((sum, order) => sum + numeric(order.price), 0n);
  const session = state?.agents?.session;
  const evaluations = list(state?.evaluations);
  const split = allocationSplit();
  const operations = Number(split.operations);
  return `<section class="page-intro funds-intro"><div><div class="eyebrow">03 / SETTLE & BURN</div><h1>Paid services.<br>Accounted for.</h1><p>Delivery and buyer acceptance turn payment into settled revenue.<br>Only then can it fund operations and project-token buyback.</p></div><div class="settlement-summary"><span class="summary-label">ACTUAL SETTLED SERVICE RECEIPTS</span><div>${esc(quantity(settledTotal.toString(), 'cash'))}<small>${esc(units('cash'))}</small></div><span class="summary-foot">${settled.length} ${recordedMode ? 'recorded' : 'local'} settled order${settled.length === 1 ? '' : 's'} · team-controlled test activity</span></div></section>
    <section class="settlement-story"><div class="settlement-origin"><span class="section-kicker">BUYER ACCEPTS DELIVERY</span><h2>Settled service receipts</h2><p>Prepaid orders and bounties stay outside this allocation.</p></div><span class="split-arrow">→</span><div class="allocation-branches"><div class="allocation-branch"><span class="allocation-percent">${esc(split.operations)}<small>%</small></span><div><strong>Run the service</strong><span>Operations budget</span></div></div><div class="allocation-branch"><span class="allocation-percent purple">${esc(split.buyback)}<small>%</small></span><div><strong>Buy back & burn FT</strong><span>Budgeted after settlement</span></div></div></div><div class="settlement-invariant"><span class="invariant-icon">↳</span><strong>Supply goes down.<br>Issuance progress does not.</strong><p>No burn resets recognized credits or total FT issued.</p></div></section>${stats(p)}
    <div class="two-column"><section><div class="section-head"><div><h2>Service orders</h2><p>Pay → deliver → accept → settle. Timeout refunds follow the agreed terms.</p></div>${button('order', '＋ Purchase evaluation', {}, 'primary')}</div><div class="panel">${orders.length ? `<div class="table-scroll"><table><thead><tr><th>Order</th><th>Payment</th><th>Progress</th><th></th></tr></thead><tbody>${orders.map((order) => `<tr><td><div class="cell-main">Evaluation service #${esc(order.id)}</div><div class="cell-sub">Buyer: ${esc(actorLabel(order.buyer))}</div></td><td><div class="cell-main">${esc(quantity(order.price, 'cash'))}</div><div class="cell-sub">${esc(units('cash'))}</div></td><td>${statusBadge(order.status)}</td><td><div class="inline-actions">${order.status === 'FUNDED' ? button('deliver', 'Deliver result', { orderId: order.id }, 'small', evaluations.length > 0) : order.status === 'DELIVERED' ? (String(order.buyer).toLowerCase() === String(session?.actor).toLowerCase() ? recordedMode ? '' : `<button class="button small" data-agent-accept="${esc(order.id)}" ${busy || !capability ? 'disabled' : ''}>Agent acceptance</button>` : button('acceptOrder', 'Accept & settle', { orderId: order.id })) : ''}</div>${details(order, 'Order evidence')}</td></tr>`).join('')}</tbody></table></div>` : empty('No orders yet. Buy a local evaluation, deliver its saved result, then accept it.')}</div></section><section><div class="section-head"><div><h2>Funds in their own lanes</h2><p>Separate obligations from settled budgets.</p></div></div><div class="panel panel-pad"><div class="info-list">${[['bountyReserved', 'Reserved cash bounties'], ['claimable', 'Earned cash claimable'], ['refundable', 'Refundable orders'], ['operations', 'Operations budget'], ['buyback', 'Buyback budget']].map(([key, label]) => `<div class="info-row"><span>${label}</span><strong>${esc(quantity(buckets[key!], 'cash'))}<small> ${esc(units('cash'))}</small></strong></div>`).join('')}</div><p class="legend">Balances are not net profit or promised returns. LP funds and wallet top-ups are separate from service receipts.</p>${button('buyback', 'Execute local Mock buyback', {}, 'small', numeric(buckets.buyback) > 0n)}</div></section></div>
    <div class="two-equal"><section><div class="section-head"><div><h2>An evaluation you can inspect</h2><p>Saved exact-match and JSON-format comparisons, not a truth oracle.</p></div></div><div class="panel panel-pad">${recordedMode ? `<div class="recorded-service"><span class="recorded-icon">≡</span><h3>${evaluations.length} saved evaluation${evaluations.length === 1 ? '' : 's'}</h3><p>These recorded results came from the local deterministic service. This preview cannot run new evaluations.</p></div>` : `<form id="evaluation-form" class="evaluation-form"><div class="field"><label for="samples">Evaluation samples</label><textarea id="samples" name="samples" required spellcheck="false" placeholder='[{"id":"your-sample","input":...,"expected":...,"actual":...}]'></textarea><small>Use necessary, non-sensitive data only. Label synthetic inputs; exclude private keys and other project material.</small></div><button class="button primary" ${busy || !capability ? 'disabled' : ''}>Run & save evaluation</button></form>`}${lastEvaluation ? `<div class="report-card"><strong>Saved result ${esc(lastEvaluation.id)}</strong><pre>${esc(json(lastEvaluation.report))}</pre></div>` : ''}${evaluations.length ? details(evaluations, `Inspect saved evaluations (${evaluations.length})`) : ''}</div></section><section><div class="section-head"><div><h2>Agents with a bounded mandate</h2><p>Model proposals and execution authority are separate.</p></div></div><div class="panel panel-pad">${session ? `<div class="agent-grant"><span class="agent-avatar">A</span><div><strong>Project-scoped Agent</strong><span>Self-submit · claim · read · order · accept own delivery</span></div></div><div class="info-list"><div class="info-row"><span>Purchase limits</span><strong>${esc(quantity(session.perAction, 'cash'))} / action · ${esc(quantity(session.limit, 'cash'))} / session</strong></div><div class="info-row"><span>Successful spend</span><strong>${esc(quantity(session.spent, 'cash'))} ${esc(units('cash'))}</strong></div></div><p class="legend">The independent executor checks the actor, network, target, recipient, method, amount, nonce and expiry. No review, rule changes, arbitrary calls or mint authority.</p>${recordedMode ? '' : `<details class="agent-controls"><summary>Use the local proposal bridge</summary>${agentTemplateControls()}<form id="agent-form" class="evaluation-form"><div class="field"><label for="proposal">Structured proposal JSON</label><textarea id="proposal" name="proposal" required spellcheck="false" placeholder="Paste a proposal with recorded provenance, or fill the session format template"></textarea><small>This bridge alone does not prove a model call. Only trusted run provenance identifies actual model assistance; templates and scripts remain separate.</small></div><button class="button primary" ${busy || !capability ? 'disabled' : ''}>Check & execute proposal</button></form></details>`}${lastAgentResponse ? `<div class="report-card"><strong>Executor response</strong><pre>${esc(json(lastAgentResponse))}</pre></div>` : ''}${details(session, 'Exact session grants')}` : recordedMode ? recordedAgentPolicy() : empty('No Agent session is recorded.')}</div></section></div>
    <div class="section-head"><div><h2>Agent work, with provenance</h2><p>Actual model-assisted records remain distinct from scripts and unverified proposals.</p></div></div><div class="panel panel-pad">${agentTrail()}</div><div class="risk-note">This is controlled demo activity. It does not establish independent customers or real demand. A buyer may use a delivered result without accepting it; that fulfillment risk remains.</div><details class="technical-panel"><summary>Settlement transactions & exact candidate configuration <span>＋</span></summary><div class="technical-content">${transactionTrail()}${details(state?.config)}</div></details>${ownerControls(['order', 'deliver', 'acceptOrder', 'refundOrder', 'buyback', 'transfer'])}`;
}
function ownerControls(actions: string[]): string {
  return recordedMode ? '' : `<details class="owner-controls"><summary>Local owner controls <span>For testing and inspection</span></summary><div><p>Disposable local accounts only. Every action remains subject to onchain authority and state checks; these controls do not grant new powers.</p><div class="inline-actions">${actions.map((action) => button(action)).join('')}</div></div></details>`;
}
function transactionTrail(): string {
  const transactions = list(state?.transactions).slice(-10).reverse();
  return transactions.length ? `<div class="activity">${transactions.map((transaction) => `<div class="activity-item"><span class="activity-dot ${transaction.status === 'CONFIRMED' ? 'success' : ''}"></span><div class="activity-body"><div class="activity-title"><span>${esc(actionSpecs[String(transaction.action)]?.label ?? transaction.action)}</span>${statusBadge(transaction.status)}</div><div class="activity-meta">${esc(time(transaction.at))}${transaction.error ? ` · ${esc(transaction.error)}` : ''}<br>${!recordedMode && /^0x[0-9a-fA-F]{64}$/.test(String(transaction.hash)) ? `<a href="/transactions/${esc(transaction.hash)}" target="_blank" rel="noopener" class="mono">${esc(short(transaction.hash))} ↗ local transaction</a>` : `<span class="mono">${esc(short(transaction.hash))}</span>`}</div></div></div>`).join('')}</div>` : empty(recordedMode ? 'Transaction hashes are omitted from this read-only snapshot. Ledger values come from the preserved local run.' : 'No transactions are recorded yet.');
}
function agentTrail(): string {
  const runs = list(state?.agentRuns ?? state?.agents?.runs).slice(-10).reverse();
  return runs.length ? `<div class="agent-runs">${runs.map((run) => {
    const provenance = typeof run.provenance === 'object' && run.provenance !== null ? run.provenance as JsonObject : null;
    const normalized = typeof run.normalizedAction === 'object' && run.normalizedAction !== null ? run.normalizedAction as JsonObject : null;
    const method = String(run.method ?? run.action ?? normalized?.method ?? 'read');
    const provenanceLabel = provenance ? String(provenance.kind ?? provenance.source ?? provenance.model ?? 'Provenance attached') : typeof run.provenance === 'string' ? (run.provenance.startsWith('LIVE_CODEX_ASSISTED_BRIDGE') ? 'Codex-assisted · owner-mediated execution' : run.provenance.startsWith('LOCAL_SCRIPT_OR_UNVERIFIED_PROPOSAL') ? 'Local script or unverified proposal' : run.provenance) : String(run.kind ?? run.source ?? 'Unverified proposal');
    const titles: Record<string, string> = { submit: 'Submitted contribution evidence', order: 'Purchased an evaluation service', accept: 'Accepted the delivered evaluation', claim: 'Claimed earned cash', read: 'Read project state' };
    return `<article class="agent-run"><div class="agent-run-icon">${method === 'order' ? '↗' : method === 'accept' ? '✓' : method === 'submit' ? '◈' : '≡'}</div><div><div class="activity-title"><strong>${esc(titles[method] ?? method)}</strong>${statusBadge(run.status ?? run.outcome)}</div><div class="activity-meta">${esc(time(run.at ?? run.createdAt))} · ${esc(provenanceLabel)}</div>${details(run, 'Inspect proposal, authority & model provenance')}</div></article>`;
  }).join('')}</div>` : empty('No Agent runs are recorded. Fixed scripts are never presented as model calls.');
}
function agentTemplateControls(): string {
  return `<div class="field-row" style="margin:16px 0"><div class="field"><label for="agent-method">Session format template</label><select id="agent-method"><option value="read">Read state</option><option value="submit">Self-submit</option><option value="claim">Self-claim</option><option value="order">Bounded purchase</option><option value="accept">Accept own delivery</option></select></div><button class="button" id="agent-template" type="button" style="align-self:end">Fill template</button></div><p class="legend">Templates provide a fixed format with unverified provenance; they do not count as real model assistance. Acceptance uses only this actor’s delivered orders and the actual digest of a saved evaluation.</p>`;
}
function fillAgentTemplate(orderId?: string): void {
  const session = state?.agents?.session;
  const input = document.querySelector<HTMLTextAreaElement>('#proposal');
  if (!session || !input) return;
  const method = document.querySelector<HTMLSelectElement>('#agent-method')?.value ?? 'read';
  const ownDeliveredOrder = list(project()?.orders).find((order) => order.status === 'DELIVERED' && (!orderId || String(order.id) === orderId)
    && String(order.buyer).toLowerCase() === String(session.actor).toLowerCase()
    && list(state?.evaluations).some((evaluation) => String(evaluation.digest).toLowerCase() === String(order.resultDigest).toLowerCase()));
  if (method === 'accept' && !ownDeliveredOrder) {
    toast('This project has no delivered order owned by this Agent with a matching saved evaluation digest. Refresh state and complete delivery first.', true);
    return;
  }
  const args: Record<string, JsonObject> = {
    read: {},
    submit: { taskId: '', actorType: 1, operator: session.actor, beneficiary: session.recipient, digest: lastEvaluation?.digest ?? '', uri: lastEvaluation?.uri ?? '' },
    claim: { contributionId: '' },
    order: { clientKey: '', deadline: String(Math.floor(Date.now() / 1000) + 300), formatDigest: lastEvaluation?.digest ?? `0x${'00'.repeat(32)}` },
    accept: { orderId: ownDeliveredOrder?.id, resultDigest: ownDeliveredOrder?.resultDigest },
  };
  input.value = json({ sessionId: session.id, chainId: session.chainId, actor: session.actor, target: session.target, token: session.token, recipient: session.recipient, method, amount: method === 'order' ? '' : '0', nonce: session.nonce, expiresAt: session.expiresAt, args: args[method] });
  input.focus();
}

function bind(): void {
  document.querySelector<HTMLButtonElement>('#refresh')?.addEventListener('click', () => { void refresh(); });
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((element) => element.addEventListener('click', () => { openWorkflow(element.dataset.tab as Tab); }));
  document.querySelector<HTMLSelectElement>('#project-select')?.addEventListener('change', (event) => { const id = (event.target as HTMLSelectElement).value; const next = state?.projects?.find((p) => String(p.id) === id); if (next) window.location.hash = projectHref(next, ({ projects: 'define', contributions: 'recognize', funds: 'settle' } as const)[tab]); });
  document.querySelector<HTMLButtonElement>('#agent-template')?.addEventListener('click', () => fillAgentTemplate());
  document.querySelector('[data-how-it-works]')?.addEventListener('click', () => document.querySelector('#how-fairflow-works')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  document.querySelectorAll<HTMLButtonElement>('[data-agent-accept]').forEach((element) => element.addEventListener('click', () => {
    const controls = document.querySelector<HTMLDetailsElement>('.agent-controls'); if (controls) controls.open = true;
    const method = document.querySelector<HTMLSelectElement>('#agent-method'); if (method) method.value = 'accept';
    fillAgentTemplate(element.dataset.agentAccept); document.querySelector('#proposal')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((element) => element.addEventListener('click', () => showAction(element.dataset.action ?? '', JSON.parse(element.dataset.defaults ?? '{}') as JsonObject)));
  document.querySelector<HTMLFormElement>('#evaluation-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLTextAreaElement>('#samples');
    if (!input) return;
    void runWrite(async () => { const samples: unknown = JSON.parse(input.value); lastEvaluation = await request('/api/evaluate', { samples }); toast(`Evaluation saved: ${text(lastEvaluation.id)}. Results cover only the submitted samples.`); });
  });
  document.querySelector<HTMLFormElement>('#agent-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLTextAreaElement>('#proposal');
    if (!input) return;
    void runWrite(async () => { const proposal: unknown = JSON.parse(input.value); lastAgentResponse = await request('/api/agent/propose', { sessionId: state?.agents?.session?.id, proposal }); toast('The bounded executor returned a result. Details and run provenance are recorded.'); });
  });
}
async function runWrite(operation: () => Promise<void>): Promise<void> {
  if (recordedMode || busy || !capability) return;
  busy = true;
  document.querySelectorAll<HTMLButtonElement>('button').forEach((element) => { element.disabled = true; });
  try { await operation(); } catch (error) { toast(error instanceof Error ? error.message : String(error), true); }
  busy = false; await refresh();
}
function showAction(action: string, defaults: JsonObject): void {
  const spec = actionSpecs[action]; const current = project();
  if (recordedMode || !spec || !current || !capability || busy) return;
  document.querySelector('.modal-shade')?.remove();
  const shade = document.createElement('div'); shade.className = 'modal-shade';
  shade.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="action-title"><div class="modal-head"><div><h2 id="action-title">${esc(spec.label)}</h2><p>${esc(spec.help)}</p></div><button class="close-button" aria-label="Close">×</button></div><form id="action-form"><div class="field"><label for="action-actor">Local actor</label><select id="action-actor" name="actor" required>${(state?.actors ?? []).map((actor) => `<option value="${esc(actor.name)}">${esc(actor.name)} · ${esc(actor.kind ?? '')} · ${esc(short(actor.address))}</option>`).join('')}</select><small>Disposable local accounts only. Onchain authority and state checks still apply.</small></div>${spec.fields.map((field) => fieldHtml(field, defaults[field.key])).join('')}<div class="notice warning"><div>This action affects local project #${esc(current.id)}. Enter decimal atomic-unit amounts. Candidate parameters are not public release terms.</div></div><div class="modal-footer"><button type="button" class="button" data-close>Cancel</button><button type="submit" class="button primary">Execute local action</button></div></form></section>`;
  document.body.append(shade);
  const close = (): void => { shade.remove(); document.removeEventListener('keydown', onEscape); };
  const onEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', onEscape);
  shade.querySelector('.close-button')?.addEventListener('click', close);
  shade.querySelector('[data-close]')?.addEventListener('click', close);
  shade.addEventListener('click', (event) => { if (event.target === shade) close(); });
  const actorSelect = shade.querySelector<HTMLSelectElement>('#action-actor');
  const actorDefaults: Record<string, string> = { publishRule: 'admin', validate: 'reviewer', reject: 'reviewer', deliver: 'provider', buyback: 'keeper', order: 'user', acceptOrder: 'user', refundOrder: 'user', submit: 'builder', acceptTask: 'builder', claimBounty: 'builder' };
  if (actorSelect && (state?.actors ?? []).some((actor) => actor.name === actorDefaults[action])) actorSelect.value = actorDefaults[action]!;
  const fillActorAddresses = (): void => {
    const actor = state?.actors?.find((item) => item.name === actorSelect?.value);
    for (const name of ['operator', 'beneficiary']) { const field = shade.querySelector<HTMLInputElement>(`[name="${name}"]`); if (field && actor) field.value = actor.address; }
  };
  fillActorAddresses(); actorSelect?.addEventListener('change', fillActorAddresses);
  const firstInput = shade.querySelector<HTMLInputElement>('input'); (firstInput ?? actorSelect)?.focus();
  shade.querySelector<HTMLFormElement>('#action-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const args: JsonObject = {};
    try {
      for (const field of spec.fields) {
        const raw = String(formData.get(field.key) ?? '').trim();
        if (!raw && field.optional) continue;
        args[field.key] = field.type === 'json' ? JSON.parse(raw) as unknown : ['number', 'role', 'actorType'].includes(field.type ?? '') ? Number(raw) : raw;
      }
    } catch { toast('Invalid JSON field. Check the format and retry.', true); return; }
    const actor = String(formData.get('actor')); close();
    void runWrite(async () => { const result = await request('/api/action', { action, projectId: String(current.id), actor, ...args }); toast(`${spec.label}：${text(result.status)} ${short(result.hash)}`); });
  });
}
function fieldHtml(field: InputSpec, value: unknown): string {
  const id = `action-${field.key}`; const required = field.optional ? '' : 'required';
  const control = field.type === 'json' ? `<textarea id="${id}" name="${esc(field.key)}" ${required} placeholder="${esc(field.placeholder)}" spellcheck="false">${value === undefined ? '' : esc(json(value))}</textarea>` : field.type === 'role' || field.type === 'actorType' ? `<select id="${id}" name="${esc(field.key)}">${(field.type === 'role' ? ['Initiator', 'Builder', 'Promoter', 'User'] : ['Human', 'Agent', 'Organization']).map((label, index) => `<option value="${index}" ${String(value) === String(index) ? 'selected' : ''}>${label}</option>`).join('')}</select>` : `<input id="${id}" name="${esc(field.key)}" type="${field.type === 'number' ? 'number' : 'text'}" ${field.type === 'number' ? 'min="1" step="1"' : ''} ${required} placeholder="${esc(field.placeholder)}" value="${value === undefined ? '' : esc(value)}" autocomplete="off" />`;
  return `<div class="field"><label for="${id}">${esc(field.label)}${field.optional ? ' (optional)' : ''}</label>${control}${field.help ? `<small>${esc(field.help)}</small>` : ''}</div>`;
}

window.addEventListener('hashchange', () => { readRoute(); render(); window.scrollTo({ top: 0, behavior: 'instant' }); });

async function start(): Promise<void> {
  readRoute(); render();
  if (!recordedMode) {
    try { const session = await request('/api/local-session'); capability = typeof session.capability === 'string' ? session.capability : ''; }
    catch (error) { toast(`Local write authorization unavailable: ${error instanceof Error ? error.message : String(error)}`, true); }
  }
  await refresh();
}
void start();
