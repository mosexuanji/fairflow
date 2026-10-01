"use strict";
(() => {
  // frontend/main.ts
  var actionSpecs = {
    publishRule: { label: "Publish rule version", help: "Rules update prospectively. Accepted tasks retain fixed credits and cash rewards. Only the administrator can publish.", fields: [
      { key: "credits", label: "Four role credit amounts (JSON, atomic-unit strings)", type: "json", placeholder: '["\u2026", "\u2026", "\u2026", "\u2026"]' },
      { key: "schemas", label: "Four evidence format digests (JSON)", type: "json", optional: true },
      { key: "uris", label: "Four rule URIs (JSON)", type: "json", optional: true }
    ] },
    createTask: { label: "Create funded task", help: "Credits and cash are fixed; FT is calculated in finalization order. Sponsors pre-fund LocalCash; bounty principal is separate from service revenue.", fields: [
      { key: "behaviorKey", label: "Canonical behavior key", help: "Changing address, role or version cannot earn issuance again for the same canonical behavior." },
      { key: "role", label: "Contribution role", type: "role" },
      { key: "reward", label: "Fixed LocalCash bounty (atomic units)", placeholder: "0" },
      { key: "expiresIn", label: "Expires in seconds", type: "number", placeholder: "3600" },
      { key: "uri", label: "Task description URI" }
    ] },
    acceptTask: { label: "Accept task", help: "Accept fixed credits and cash rewards. The current FT estimate is not a locked promise; actual issuance uses cumulative progress immediately before finalization.", fields: [{ key: "taskId", label: "Task ID" }] },
    submit: { label: "Submit evidence", help: "A digest proves content integrity, not factual truth or quality. Agents must identify their operator, submitting actor and beneficiary.", fields: [
      { key: "taskId", label: "Task ID" },
      { key: "actorType", label: "Actor type", type: "actorType" },
      { key: "operator", label: "Operator address" },
      { key: "beneficiary", label: "Reward beneficiary address" },
      { key: "digest", label: "Evidence digest (0x + 64 hexadecimal characters)" },
      { key: "uri", label: "Evidence URI" }
    ] },
    validate: { label: "Validate contribution", help: "The designated reviewer checks the evidence; submitters cannot self-review. The demo review delay does not establish independent review or quality.", fields: [{ key: "contributionId", label: "Contribution ID" }] },
    reject: { label: "Reject contribution", help: "Rejection is available before finalization. This action cannot rewrite already issued receipts or FT.", fields: [{ key: "contributionId", label: "Contribution ID" }] },
    finalize: { label: "Finalize & issue", help: "After the review delay, actual FT uses current recognized credits C. A nontransferable receipt is issued once; burning does not roll back cumulative issuance progress.", fields: [{ key: "contributionId", label: "Contribution ID" }] },
    expire: { label: "Expire task", help: "Uses the onchain task deadline. Browser time does not prove onchain expiry.", fields: [{ key: "taskId", label: "Task ID" }] },
    claimBounty: { label: "Claim earned bounty", help: "Claim only cash already owed to this actor. Retrying payment does not issue FT again.", fields: [{ key: "contributionId", label: "Contribution ID" }] },
    cancelTask: { label: "Cancel task", help: "Only eligible task states and authorized actors can cancel. Refunds and service revenue remain separate.", fields: [{ key: "taskId", label: "Task ID" }] },
    refundTask: { label: "Claim task refund", help: "Claim only task funds that satisfy the refund conditions.", fields: [{ key: "taskId", label: "Task ID" }] },
    order: { label: "Buy local evaluation", help: "Payment first funds a refundable order. Revenue becomes allocable only after delivery and buyer acceptance. LocalCash is a local test asset.", fields: [
      { key: "clientKey", label: "Idempotent order key" },
      { key: "price", label: "LocalCash price (atomic units)" },
      { key: "expiresIn", label: "Expires in seconds", type: "number", placeholder: "3600" },
      { key: "formatDigest", label: "Agreed format digest", optional: true }
    ] },
    deliver: { label: "Deliver saved evaluation", help: "References an actual saved evaluation. Its digest and URI are recorded onchain. Deterministic evaluation does not claim model judgment.", fields: [{ key: "orderId", label: "Order ID" }, { key: "evaluationId", label: "Saved evaluation ID" }] },
    acceptOrder: { label: "Accept & settle", help: "The buyer accepts the delivered result; providers cannot recognize their own revenue. Settlement allocates operations and buyback budgets using the project candidate ratio.", fields: [{ key: "orderId", label: "Order ID" }] },
    refundOrder: { label: "Refund order", help: "Refunds follow the agreed deadline. Unsettled order funds are separate from service revenue.", fields: [{ key: "orderId", label: "Order ID" }] },
    buyback: { label: "Local buyback & burn", help: "Uses a local Mock DEX only; it does not satisfy official DEX or public-testnet acceptance. Set a budget, positive minOut and deadline. Failure preserves the budget.", fields: [
      { key: "amount", label: "LocalCash buyback budget (atomic units)" },
      { key: "minOut", label: "Minimum FT received (atomic units, positive)" },
      { key: "expiresIn", label: "Deadline in seconds (maximum 300)", type: "number", placeholder: "120" }
    ] },
    transfer: { label: "Transfer project FT", help: "Transfer only project FT held by the selected actor. Receipts are nontransferable records.", fields: [{ key: "to", label: "Recipient address" }, { key: "amount", label: "FT amount (atomic units)" }] }
  };
  var app = document.querySelector("#app");
  if (!app) throw new Error("Missing application root");
  var recordedMode = document.documentElement.dataset.fairflowMode === "recorded-demo";
  var state = null;
  var tab = "projects";
  var selectedProject = "";
  var capability = "";
  var busy = false;
  var loading = false;
  var loadError = "";
  var lastRefresh = "";
  var lastEvaluation = null;
  var lastAgentResponse = null;
  var toastTimer;
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
  }
  function text(value, fallback = "\u2014") {
    return value === void 0 || value === null || value === "" ? fallback : String(value);
  }
  function list(value) {
    return Array.isArray(value) ? value : [];
  }
  function json(value) {
    return JSON.stringify(value, null, 2) ?? "null";
  }
  function short(value) {
    const s = text(value);
    return /^0x[0-9a-fA-F]{40,64}$/.test(s) ? `${s.slice(0, 8)}\u2026${s.slice(-6)}` : s;
  }
  function numeric(value) {
    try {
      return BigInt(typeof value === "string" || typeof value === "number" ? value : 0);
    } catch {
      return 0n;
    }
  }
  function quantity(value, kind) {
    if (value === void 0 || value === null) return "\u2014";
    const config = state?.config ?? {};
    const decimals = config[`${kind}Decimals`];
    if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 36 || !/^[0-9]+$/.test(String(value))) return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const amount = String(value).padStart(decimals + 1, "0");
    if (decimals === 0) return amount.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const fraction = amount.slice(-decimals).replace(/0+$/, "");
    const displayedFraction = fraction.slice(0, kind === "token" ? 4 : 6).replace(/0+$/, "");
    const approximate = fraction.length > (kind === "token" ? 4 : 6);
    return `${approximate ? "\u2248" : ""}${amount.slice(0, -decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${displayedFraction ? `.${displayedFraction}` : ""}`;
  }
  function units(kind) {
    return typeof state?.config?.[`${kind}Decimals`] === "number" ? { credit: "credits", cash: "LocalCash", token: "FT" }[kind] : { credit: "credit atoms", cash: "LocalCash atoms", token: "FT atoms" }[kind];
  }
  function time(value) {
    if (value === void 0 || value === null) return "\u2014";
    const raw = String(value);
    const date = /^[0-9]+$/.test(raw) ? new Date(Number(raw) * 1e3) : new Date(raw);
    return Number.isNaN(date.getTime()) ? raw : date.toLocaleString("en-US", { hour12: false });
  }
  function role(value) {
    const roles = ["Initiator", "Builder", "Promoter", "User"];
    return roles[Number(value)] ?? text(value);
  }
  function statusBadge(status) {
    const label = text(status);
    const color = ["FINALIZED", "SETTLED", "SUCCESS", "CONFIRMED", "PASS", "COMPLETED"].includes(label) ? "green" : ["VALIDATED", "DELIVERED", "FUNDED", "SUBMITTED", "ACCEPTED", "PENDING"].includes(label) ? "blue" : ["EXPIRED", "REFUNDED", "CANCELLED", "CANCELED"].includes(label) ? "gold" : ["REJECTED", "FAIL", "FAILED", "ERROR", "REVERTED"].includes(label) ? "red" : "";
    const humanLabel = { FINALIZED: "Recognized", VALIDATED: "Review passed", SUBMITTED: "In review", FUNDED: "Paid \xB7 refundable", DELIVERED: "Delivered", SETTLED: "Settled", OPEN: "Available", ACCEPTED: "In progress", COMPLETED: "Complete", CANCELED: "Canceled", CONFIRMED: "Confirmed" };
    return `<span class="badge ${color}" title="${esc(label)}">${esc(humanLabel[label] ?? label.toLowerCase().replace(/^./, (char) => char.toUpperCase()))}</span>`;
  }
  function empty(message) {
    return `<div class="empty"><div class="empty-symbol">\u25C7</div>${esc(message)}</div>`;
  }
  function button(action, label, defaults = {}, style = "small", eligible = true) {
    return recordedMode ? "" : `<button class="button ${style}" data-action="${esc(action)}" data-defaults="${esc(JSON.stringify(defaults))}" ${busy || !capability || !eligible ? "disabled" : ""}>${esc(label ?? actionSpecs[action]?.label ?? action)}</button>`;
  }
  function details(value, title = "View raw record") {
    return `<details class="detail"><summary>${esc(title)}</summary><pre>${esc(json(value))}</pre></details>`;
  }
  function project() {
    return state?.projects?.find((p) => String(p.id) === selectedProject) ?? state?.projects?.[0];
  }
  async function request(path, body) {
    if (recordedMode && body !== void 0) throw new Error("This recorded demo is read-only. No transactions can be submitted.");
    const response = await fetch(path, { method: body === void 0 ? "GET" : "POST", credentials: "same-origin", cache: "no-store", headers: { ...body === void 0 ? {} : { "Content-Type": "application/json", "X-FairFlow-Capability": capability } }, ...body === void 0 ? {} : { body: JSON.stringify(body) } });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data === "object" && data !== null && "error" in data ? String(data.error) : `Local service returned ${response.status}`);
    if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error("Invalid local service response");
    return data;
  }
  async function refresh() {
    if (loading) return;
    loading = true;
    loadError = "";
    render();
    try {
      const data = await request(recordedMode ? "./demo-state.json" : "/api/state");
      state = data;
      if (state.agent) state.agents = { session: state.agent.session ? { ...state.agent.session, nonce: state.agent.nonce, spent: state.agent.spent } : void 0, runs: state.agent.runs };
      if (!state.projects?.some((p) => String(p.id) === selectedProject)) selectedProject = String(state.projects?.[0]?.id ?? "");
      lastRefresh = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", { hour12: false });
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
    }
    loading = false;
    render();
  }
  function toast(message, error = false) {
    document.querySelector(".toast")?.remove();
    const element = document.createElement("div");
    element.className = `toast${error ? " error" : ""}`;
    element.setAttribute("role", "status");
    element.textContent = message;
    document.body.append(element);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.remove(), 8500);
  }
  function render() {
    const current = project();
    app.innerHTML = `<div class="shell"><header class="app-header"><a class="brand" href="#" aria-label="FairFlow home" data-home><span class="brand-symbol"><svg viewBox="0 0 28 28" aria-hidden="true"><path d="M5 5h18v5H10v4h10v5H10v5H5z" fill="currentColor"/></svg></span>FairFlow<span class="brand-sub">CONTRIBUTION & SETTLEMENT</span></a><nav class="nav" aria-label="Workspace navigation">${["projects", "contributions", "funds"].map((item, index) => `<button class="nav-button ${tab === item ? "active" : ""}" data-tab="${item}" aria-current="${tab === item ? "page" : "false"}"><span class="nav-number">0${index + 1}</span>${["Define work", "Recognize work", "Settle & burn"][index]}</button>`).join("")}</nav><div class="header-tools">${environmentDisclosure()}<button class="icon-button" id="refresh" aria-label="${recordedMode ? "Reload recorded snapshot" : "Refresh local chain state"}" title="${recordedMode ? "Reload snapshot" : "Refresh chain state"}" ${loading ? "disabled" : ""}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 8a6 6 0 1 0 .2 4M16 3v5h-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></header><main class="main">
    ${loadError ? `<div class="notice error" role="alert"><strong>Unable to read state.</strong> ${esc(loadError)} ${state ? "The last read is retained; current state has not been reverified." : "Please retry when the data source is available."}</div>` : ""}
    ${state && current ? `<div class="workspace-context"><span class="context-label">PROJECT</span><select id="project-select" class="project-select" aria-label="Select project">${(state.projects ?? []).map((p) => `<option value="${esc(p.id)}" ${String(p.id) === String(current.id) ? "selected" : ""}>${esc(p.name ?? `Project ${p.id}`)}</option>`).join("")}</select><span class="context-divider"></span><span class="context-note">${recordedMode ? `Snapshot captured ${esc(time(state.presentation?.capturedAt))}` : "Local ledger \xB7 reads from the chain"}${loading ? " \xB7 refreshing" : ""}</span></div>${tab === "projects" ? projectView(current) : tab === "contributions" ? contributionView(current) : fundsView(current)}` : `<section class="loading-stage"><div class="eyebrow">FAIRFLOW</div><h1>Make contribution count.</h1><p>A shared record of AI project work, rewards and service settlement.</p>${empty(loading ? "Reading project data\u2026" : "No project data is available yet.")}</section>`}
    <footer class="footer"><span>Candidate demo economics. No investment, redemption or return promise.</span><span>${recordedMode ? "Read-only recorded local demo" : `${lastRefresh ? `Last read ${esc(lastRefresh)}` : "Not read yet"} \xB7 Local prototype`}</span></footer></main></div>`;
    bind();
  }
  function environmentDisclosure() {
    return `<details class="environment-detail"><summary><span class="environment-dot"></span>${recordedMode ? "Recorded local demo" : "Local prototype"}<span class="disclosure-chevron">\u2304</span></summary><div class="environment-content"><strong>${recordedMode ? "A captured demonstration, not a live public deployment." : "A disposable local test environment."}</strong><p>${recordedMode ? `Read-only snapshot captured ${esc(time(state?.presentation?.capturedAt))}. No wallet connection, signatures or transactions are available. ` : "Actions use controlled, disposable local accounts on chain 31337. "}LocalCash, contributions, orders and liquidity are test data. Buyback uses a local Mock DEX, not an official public DEX.</p><p>The reviewer is controlled by the demo team. The 60-second review delay is not independent review or decentralized arbitration. A digest proves content integrity, not factual truth.</p><p>No public-network deployment, real liquidity, independent demand, production readiness or returns are implied. The demo issuance curve has no artificial total cap; burn never resets issuance progress.</p>${recordedMode ? "" : `<div class="permission-chip">${capability ? "Local owner controls available" : "Read-only session"}</div>`}</div></details>`;
  }
  function allocationSplit() {
    const bps = state?.config?.buybackBps;
    if (typeof bps !== "number" || !Number.isFinite(bps)) return { operations: "\u2014", buyback: "\u2014" };
    return { operations: String((1e4 - bps) / 100), buyback: String(bps / 100) };
  }
  function roleDescription(value) {
    return ["Starts and defines a project task.", "Delivers execution work.", "Brings external attention or users.", "Uses or validates delivered work."][Number(value)] ?? "Contributes under the adopted project rules.";
  }
  function actorLabel(value) {
    if (value === void 0 || value === null || value === "") return "Controlled test actor";
    const actor = state?.actors?.find((item) => item.address.toLowerCase() === String(value).toLowerCase());
    if (actor) return `${actor.kind === "Agent" ? "Agent" : actor.name.charAt(0).toUpperCase() + actor.name.slice(1)}`;
    return short(value);
  }
  function recordedAgentPolicy() {
    return `<div class="agent-grant"><span class="agent-avatar">A</span><div><strong>Model proposes. The guard decides.</strong><span>Recorded execution evidence, with separate provenance</span></div></div><p class="legend">This snapshot does not carry a session or execution authority. The local demonstration constrained Agents to their own contributions and a bounded purchase flow; independent checks preceded each recorded action.</p><div class="flow"><span>Model proposal</span><i>\u2192</i><span>Policy checks</span><i>\u2192</i><span>Local execution record</span></div><p class="legend">Inspect the run records below. Scripts and unverified proposals are separately labeled; their presence does not prove a real model call.</p>`;
  }
  function projectHero(p) {
    const split = allocationSplit();
    const recognized = list(p.contributions).filter((item) => item.status === "FINALIZED").length;
    const settled = list(p.orders).filter((item) => item.status === "SETTLED").length;
    return `<section class="product-hero"><div class="hero-copy"><div class="eyebrow"><span class="eyebrow-line"></span>WORK HAS VALUE. MAKE IT VISIBLE.</div><h1>Make contribution<br><span>count.</span></h1><p class="hero-description">Recognize the work behind an AI project.<br>Reward contributions. Account for paid services.</p><p class="hero-problem">A shared ledger connects what people deliver with how rewards and revenue are settled.</p><div class="hero-cta"><button class="button primary" data-tab="contributions">Follow the contribution <span>\u2197</span></button><button class="text-button" data-tab="funds">See settlement \u2192</button></div><div class="hero-proof"><span class="proof-dot"></span>${recognized} recognized contribution${recognized === 1 ? "" : "s"}<span class="proof-separator">/</span>${settled} settled service${settled === 1 ? "" : "s"}<span class="proof-label">in this ${recordedMode ? "recorded" : "local"} ledger</span></div></div><div class="mechanism-card"><div class="mechanism-heading"><span>HOW VALUE FLOWS</span><span class="mechanism-scope">DEMO ECONOMICS</span></div><div class="mechanism-work"><div class="mechanism-step"><span class="step-number">01</span><div><strong>Work earns fixed credits</strong><span>Define \u2192 contribute \u2192 review</span></div></div><span class="mechanism-arrow">\u2193</span><div class="mechanism-step"><span class="step-number">02</span><div><strong>Credits unlock project FT</strong><span>Finalization order sets each allocation</span></div></div></div><div class="issuance-illustration"><div><span class="chart-caption">FT per next credit</span><svg viewBox="0 0 290 65" role="img" aria-label="Conceptual illustration: marginal issuance decreases as recognized credits increase"><path d="M0 59H290" stroke="#364153"/><path d="M4 8H62V26H120V40H178V49H236V55H286" fill="none" stroke="#8ca3ff" stroke-width="3" stroke-linejoin="round"/><path d="M4 8H62V26H120V40H178V49H236V55H286V59H4Z" fill="#6d83e9" opacity=".11"/></svg><div class="chart-axis"><span>More recognized work \u2192</span><span>No artificial supply cap</span></div></div><div class="curve-note"><strong>Diminishing<br>issuance</strong><span>${esc(quantity(state?.config?.bandAtoms, "token"))} FT / band<br>Starts at ${esc(quantity(state?.config?.firstStageCreditAtoms, "credit"))} credits</span></div></div><div class="mechanism-settlement"><div><span class="step-number">03</span><strong>Paid service \u2192 buyer acceptance</strong></div><div class="split-flow"><span><b>${esc(split.operations)}%</b> operations</span><span><b>${esc(split.buyback)}%</b> buyback & burn</span></div></div><div class="burn-invariant"><span>\u21B3</span><div><strong>Burn lowers supply. Progress stays.</strong><span>Recognized credits and total FT issued never rewind.</span></div></div></div></section>`;
  }
  function stats(p) {
    const entries = [
      { label: "Recognized contribution credits", value: quantity(p.credits, "credit"), unit: units("credit"), sub: "The permanent issuance progress" },
      { label: "Total FT issued", value: quantity(p.grossIssued, "token"), unit: units("token"), sub: "All finalized contribution rewards" },
      { label: "FT burned", value: quantity(p.totalBurned, "token"), unit: units("token"), sub: "Actual tokens removed from supply" },
      { label: "Active FT supply", value: quantity(p.totalSupply, "token"), unit: units("token"), sub: "Total issued less total burned" }
    ];
    return `<section class="stat-grid" aria-label="${recordedMode ? "Recorded" : "Local"} contribution ledger metrics">${entries.map((entry, index) => `<article class="stat"><div class="stat-label">${entry.label}<span class="stat-order">0${index + 1}</span></div><div class="stat-value">${esc(entry.value)}<span class="stat-unit">${esc(entry.unit)}</span></div><div class="stat-sub">${entry.sub}</div></article>`).join("")}</section>`;
  }
  function projectView(p) {
    const allRules = list(p.rules);
    const rules = allRules.filter((rule) => Number(rule.version) === Number(p.policyVersion));
    const tasks = list(p.tasks);
    return `${projectHero(p)}${stats(p)}<section class="roles-section"><div class="section-head"><div><div class="section-kicker">01 / DEFINE THE WORK</div><h2>Different contributions. A shared set of rules.</h2></div><span class="section-note">Credits are fixed \xB7 FT is estimated until finalization</span></div>${rules.length ? `<div class="rules">${rules.map((rule) => `<article class="rule"><div class="rule-top"><span class="role-symbol">${["\u2311", "\u2318", "\u2197", "\u25C9"][Number(rule.role)] ?? "\u25C7"}</span><span class="version">Rule v${esc(rule.version)}</span></div><h3>${esc(role(rule.role))}</h3><p>${esc(roleDescription(rule.role))}</p><div class="rule-credit">${esc(quantity(rule.credits, "credit"))}<span>fixed ${esc(units("credit"))}</span></div></article>`).join("")}</div>` : `<div class="panel">${empty("No contribution rules have been published for this project.")}</div>`}</section>
    <div class="section-head"><div><div class="section-kicker">PROJECT WORK</div><h2>Tasks ready to become contributions</h2><p>Agree on the credits and cash first. FT depends on progress when the contribution is finalized.</p></div>${button("createTask", "\uFF0B Create task", {}, "primary")}</div><div class="panel">${tasks.length ? `<div class="table-scroll"><table><thead><tr><th>Work</th><th>Fixed reward</th><th>FT at current progress</th><th>Status</th><th></th></tr></thead><tbody>${tasks.map((task) => `<tr><td><div class="cell-main">${esc(role(task.role))} contribution</div><div class="cell-sub">Task ${esc(task.id)} \xB7 Rule v${esc(task.version)}</div></td><td><div class="cell-main">${esc(quantity(task.credits, "credit"))} ${esc(units("credit"))}</div><div class="cell-sub">${numeric(task.reward) > 0n ? `${esc(quantity(task.reward, "cash"))} ${esc(units("cash"))} bounty` : "No cash bounty"}</div></td><td><div class="cell-main">${(task.estimatedFT ?? task.estimatedMint) === void 0 ? "Quote unavailable" : `${esc(quantity(task.estimatedFT ?? task.estimatedMint, "token"))} FT`}</div><div class="cell-sub">Estimate \xB7 finalization order matters</div></td><td>${statusBadge(task.status)}</td><td><div class="inline-actions">${task.status === "OPEN" ? button("acceptTask", "Accept task", { taskId: task.id }) : task.status === "ACCEPTED" ? button("submit", "Submit work", { taskId: task.id }) : ""}</div>${details(task, "Task details")}${!recordedMode && task.status === "OPEN" ? `<div class="secondary-actions">${button("cancelTask", "Cancel", { taskId: task.id }, "text-small")}</div>` : ""}</td></tr>`).join("")}</tbody></table></div>` : empty("Define the first task, its contribution rules and any pre-funded cash reward.")}</div>
    <details class="technical-panel"><summary>Project configuration & technical records <span>\uFF0B</span></summary><div class="technical-content"><div class="info-list"><div class="info-row"><span>Project</span><strong class="mono">${esc(p.address)}</strong></div><div class="info-row"><span>Project FT</span><strong class="mono">${esc(p.token)}</strong></div><div class="info-row"><span>Nontransferable receipt</span><strong class="mono">${esc(p.receipt)}</strong></div></div>${details(allRules, "All rule versions and evidence formats")}${details(state?.config, "Candidate configuration and exact units")}</div></details>${ownerControls(["publishRule", "createTask", "expire", "cancelTask", "refundTask"])}`;
  }
  function contributionView(p) {
    const contributions = list(p.contributions);
    const recognized = contributions.filter((item) => item.status === "FINALIZED");
    return `<section class="page-intro"><div><div class="eyebrow">02 / RECOGNIZE THE WORK</div><h1>From contribution<br>to a lasting record.</h1><p>Evidence connects the work, the review and the reward.<br>Finalized contributions issue FT and a nontransferable receipt, once.</p></div><div class="intro-fact"><span>${recognized.length.toLocaleString("en-US")}</span><strong>contributions recognized</strong><small>Controlled demo review \xB7 ${esc(state?.config?.reviewDelaySeconds ?? "\u2014")} second review window</small></div></section>${stats(p)}
    <div class="review-path"><div><span>01</span><strong>Submit the work</strong><small>Evidence under the adopted rules</small></div><i>\u2192</i><div><span>02</span><strong>Review & wait</strong><small>Controlled reviewer, not independent arbitration</small></div><i>\u2192</i><div><span>03</span><strong>Finalize once</strong><small>FT allocation uses progress at this moment</small></div><i>\u2192</i><div><span>04</span><strong>Keep the receipt</strong><small>Nontransferable evidence relationship</small></div></div>
    <div class="section-head"><div><h2>The contribution ledger</h2><p>A digest protects content integrity. People still review facts and quality.</p></div>${button("submit", "\uFF0B Submit evidence", {}, "primary")}</div><div class="panel">${contributions.length ? `<div class="table-scroll"><table><thead><tr><th>Contribution</th><th>Review</th><th>Recognized reward</th><th>Receipt</th><th></th></tr></thead><tbody>${contributions.map((item) => `<tr><td><div class="cell-main">${esc(role(item.role))} \xB7 task ${esc(item.taskId)}</div><div class="cell-sub">${esc(actorLabel(item.actor))} \xB7 ${esc(["Human", "Agent", "Organization"][Number(item.actorType)] ?? item.actorType)}</div></td><td>${statusBadge(item.status)}<div class="cell-sub">${esc(time(item.finalizedAt && numeric(item.finalizedAt) > 0n ? item.finalizedAt : item.submittedAt))}</div></td><td><div class="cell-main">${esc(quantity(item.credits, "credit"))} ${esc(units("credit"))}</div><div class="cell-sub">${item.status === "FINALIZED" ? `${esc(quantity(item.minted, "token"))} FT actually issued` : "FT is set at finalization"}</div></td><td>${item.status === "FINALIZED" ? `<span class="receipt-marker">\u25C8</span><span class="cell-main"> #${esc(item.receiptId ?? item.id)}</span><div class="cell-sub">Nontransferable</div>` : '<span class="cell-sub">After finalization</span>'}</td><td><div class="inline-actions">${item.status === "SUBMITTED" ? button("validate", "Review", { contributionId: item.id }) + button("reject", "Reject", { contributionId: item.id }, "text-small danger") : item.status === "VALIDATED" ? button("finalize", "Finalize & issue", { contributionId: item.id }) + button("reject", "Reject", { contributionId: item.id }, "text-small danger") : item.status === "FINALIZED" && numeric(item.claimable) > 0n ? button("claimBounty", "Claim cash", { contributionId: item.id }) : ""}</div>${details(item, "Evidence & exact allocation")}</td></tr>`).join("")}</tbody></table></div>` : empty("There are no contributions yet. Complete a task and attach evidence for review.")}</div>
    <div class="explanation-grid"><article class="explanation-card"><span class="explanation-number">01</span><h3>Fixed credits. Variable FT.</h3><p>Credits and cash are locked to the task rules. Diminishing issuance means finalization order can affect each contributor\u2019s FT allocation.</p></article><article class="explanation-card"><span class="explanation-number">02</span><h3>A record, not a share.</h3><p>Receipts are nontransferable. A role does not grant review or administration rights; FT has no redemption or guaranteed return.</p></article><article class="explanation-card"><span class="explanation-number">03</span><h3>One behavior, one issuance.</h3><p>Project and canonical behavior identity prevent repeat issuance. This does not solve every real-world identity or semantic duplicate.</p></article></div><details class="technical-panel"><summary>Transaction evidence <span>\uFF0B</span></summary><div class="technical-content">${transactionTrail()}</div></details>${ownerControls(["validate", "reject", "finalize", "claimBounty"])}`;
  }
  function fundsView(p) {
    const buckets = p.buckets ?? {};
    const orders = list(p.orders);
    const settled = orders.filter((order) => order.status === "SETTLED");
    const settledTotal = settled.reduce((sum, order) => sum + numeric(order.price), 0n);
    const session = state?.agents?.session;
    const evaluations = list(state?.evaluations);
    const split = allocationSplit();
    const operations = Number(split.operations);
    return `<section class="page-intro funds-intro"><div><div class="eyebrow">03 / SETTLE & BURN</div><h1>Paid services.<br>Accounted for.</h1><p>Delivery and buyer acceptance turn payment into settled revenue.<br>Only then can it fund operations and project-token buyback.</p></div><div class="settlement-summary"><span class="summary-label">ACTUAL SETTLED SERVICE RECEIPTS</span><div>${esc(quantity(settledTotal.toString(), "cash"))}<small>${esc(units("cash"))}</small></div><span class="summary-foot">${settled.length} ${recordedMode ? "recorded" : "local"} settled order${settled.length === 1 ? "" : "s"} \xB7 team-controlled test activity</span></div></section>
    <section class="settlement-story"><div class="settlement-origin"><span class="section-kicker">BUYER ACCEPTS DELIVERY</span><h2>Settled service receipts</h2><p>Prepaid orders and bounties stay outside this allocation.</p></div><span class="split-arrow">\u2192</span><div class="allocation-branches"><div class="allocation-branch"><span class="allocation-percent">${esc(split.operations)}<small>%</small></span><div><strong>Run the service</strong><span>Operations budget</span></div></div><div class="allocation-branch"><span class="allocation-percent purple">${esc(split.buyback)}<small>%</small></span><div><strong>Buy back & burn FT</strong><span>Budgeted after settlement</span></div></div></div><div class="settlement-invariant"><span class="invariant-icon">\u21B3</span><strong>Supply goes down.<br>Issuance progress does not.</strong><p>No burn resets recognized credits or total FT issued.</p></div></section>${stats(p)}
    <div class="two-column"><section><div class="section-head"><div><h2>Service orders</h2><p>Pay \u2192 deliver \u2192 accept \u2192 settle. Timeout refunds follow the agreed terms.</p></div>${button("order", "\uFF0B Purchase evaluation", {}, "primary")}</div><div class="panel">${orders.length ? `<div class="table-scroll"><table><thead><tr><th>Order</th><th>Payment</th><th>Progress</th><th></th></tr></thead><tbody>${orders.map((order) => `<tr><td><div class="cell-main">Evaluation service #${esc(order.id)}</div><div class="cell-sub">Buyer: ${esc(actorLabel(order.buyer))}</div></td><td><div class="cell-main">${esc(quantity(order.price, "cash"))}</div><div class="cell-sub">${esc(units("cash"))}</div></td><td>${statusBadge(order.status)}</td><td><div class="inline-actions">${order.status === "FUNDED" ? button("deliver", "Deliver result", { orderId: order.id }, "small", evaluations.length > 0) : order.status === "DELIVERED" ? String(order.buyer).toLowerCase() === String(session?.actor).toLowerCase() ? recordedMode ? "" : `<button class="button small" data-agent-accept="${esc(order.id)}" ${busy || !capability ? "disabled" : ""}>Agent acceptance</button>` : button("acceptOrder", "Accept & settle", { orderId: order.id }) : ""}</div>${details(order, "Order evidence")}</td></tr>`).join("")}</tbody></table></div>` : empty("No orders yet. Buy a local evaluation, deliver its saved result, then accept it.")}</div></section><section><div class="section-head"><div><h2>Funds in their own lanes</h2><p>Separate obligations from settled budgets.</p></div></div><div class="panel panel-pad"><div class="info-list">${[["bountyReserved", "Reserved cash bounties"], ["claimable", "Earned cash claimable"], ["refundable", "Refundable orders"], ["operations", "Operations budget"], ["buyback", "Buyback budget"]].map(([key, label]) => `<div class="info-row"><span>${label}</span><strong>${esc(quantity(buckets[key], "cash"))}<small> ${esc(units("cash"))}</small></strong></div>`).join("")}</div><p class="legend">Balances are not net profit or promised returns. LP funds and wallet top-ups are separate from service receipts.</p>${button("buyback", "Execute local Mock buyback", {}, "small", numeric(buckets.buyback) > 0n)}</div></section></div>
    <div class="two-equal"><section><div class="section-head"><div><h2>An evaluation you can inspect</h2><p>Saved exact-match and JSON-format comparisons, not a truth oracle.</p></div></div><div class="panel panel-pad">${recordedMode ? `<div class="recorded-service"><span class="recorded-icon">\u2261</span><h3>${evaluations.length} saved evaluation${evaluations.length === 1 ? "" : "s"}</h3><p>These recorded results came from the local deterministic service. This preview cannot run new evaluations.</p></div>` : `<form id="evaluation-form" class="evaluation-form"><div class="field"><label for="samples">Evaluation samples</label><textarea id="samples" name="samples" required spellcheck="false" placeholder='[{"id":"your-sample","input":...,"expected":...,"actual":...}]'></textarea><small>Use necessary, non-sensitive data only. Label synthetic inputs; exclude private keys and other project material.</small></div><button class="button primary" ${busy || !capability ? "disabled" : ""}>Run & save evaluation</button></form>`}${lastEvaluation ? `<div class="report-card"><strong>Saved result ${esc(lastEvaluation.id)}</strong><pre>${esc(json(lastEvaluation.report))}</pre></div>` : ""}${evaluations.length ? details(evaluations, `Inspect saved evaluations (${evaluations.length})`) : ""}</div></section><section><div class="section-head"><div><h2>Agents with a bounded mandate</h2><p>Model proposals and execution authority are separate.</p></div></div><div class="panel panel-pad">${session ? `<div class="agent-grant"><span class="agent-avatar">A</span><div><strong>Project-scoped Agent</strong><span>Self-submit \xB7 claim \xB7 read \xB7 order \xB7 accept own delivery</span></div></div><div class="info-list"><div class="info-row"><span>Purchase limits</span><strong>${esc(quantity(session.perAction, "cash"))} / action \xB7 ${esc(quantity(session.limit, "cash"))} / session</strong></div><div class="info-row"><span>Successful spend</span><strong>${esc(quantity(session.spent, "cash"))} ${esc(units("cash"))}</strong></div></div><p class="legend">The independent executor checks the actor, network, target, recipient, method, amount, nonce and expiry. No review, rule changes, arbitrary calls or mint authority.</p>${recordedMode ? "" : `<details class="agent-controls"><summary>Use the local proposal bridge</summary>${agentTemplateControls()}<form id="agent-form" class="evaluation-form"><div class="field"><label for="proposal">Structured proposal JSON</label><textarea id="proposal" name="proposal" required spellcheck="false" placeholder="Paste a proposal with recorded provenance, or fill the session format template"></textarea><small>This bridge alone does not prove a model call. Only trusted run provenance identifies actual model assistance; templates and scripts remain separate.</small></div><button class="button primary" ${busy || !capability ? "disabled" : ""}>Check & execute proposal</button></form></details>`}${lastAgentResponse ? `<div class="report-card"><strong>Executor response</strong><pre>${esc(json(lastAgentResponse))}</pre></div>` : ""}${details(session, "Exact session grants")}` : recordedMode ? recordedAgentPolicy() : empty("No Agent session is recorded.")}</div></section></div>
    <div class="section-head"><div><h2>Agent work, with provenance</h2><p>Actual model-assisted records remain distinct from scripts and unverified proposals.</p></div></div><div class="panel panel-pad">${agentTrail()}</div><div class="risk-note">This is controlled demo activity. It does not establish independent customers or real demand. A buyer may use a delivered result without accepting it; that fulfillment risk remains.</div><details class="technical-panel"><summary>Settlement transactions & exact candidate configuration <span>\uFF0B</span></summary><div class="technical-content">${transactionTrail()}${details(state?.config)}</div></details>${ownerControls(["order", "deliver", "acceptOrder", "refundOrder", "buyback", "transfer"])}`;
  }
  function ownerControls(actions) {
    return recordedMode ? "" : `<details class="owner-controls"><summary>Local owner controls <span>For testing and inspection</span></summary><div><p>Disposable local accounts only. Every action remains subject to onchain authority and state checks; these controls do not grant new powers.</p><div class="inline-actions">${actions.map((action) => button(action)).join("")}</div></div></details>`;
  }
  function transactionTrail() {
    const transactions = list(state?.transactions).slice(-10).reverse();
    return transactions.length ? `<div class="activity">${transactions.map((transaction) => `<div class="activity-item"><span class="activity-dot ${transaction.status === "CONFIRMED" ? "success" : ""}"></span><div class="activity-body"><div class="activity-title"><span>${esc(actionSpecs[String(transaction.action)]?.label ?? transaction.action)}</span>${statusBadge(transaction.status)}</div><div class="activity-meta">${esc(time(transaction.at))}${transaction.error ? ` \xB7 ${esc(transaction.error)}` : ""}<br>${!recordedMode && /^0x[0-9a-fA-F]{64}$/.test(String(transaction.hash)) ? `<a href="/transactions/${esc(transaction.hash)}" target="_blank" rel="noopener" class="mono">${esc(short(transaction.hash))} \u2197 local transaction</a>` : `<span class="mono">${esc(short(transaction.hash))}</span>`}</div></div></div>`).join("")}</div>` : empty(recordedMode ? "Transaction hashes are omitted from this read-only snapshot. Ledger values come from the preserved local run." : "No transactions are recorded yet.");
  }
  function agentTrail() {
    const runs = list(state?.agentRuns ?? state?.agents?.runs).slice(-10).reverse();
    return runs.length ? `<div class="agent-runs">${runs.map((run) => {
      const provenance = typeof run.provenance === "object" && run.provenance !== null ? run.provenance : null;
      const normalized = typeof run.normalizedAction === "object" && run.normalizedAction !== null ? run.normalizedAction : null;
      const method = String(run.method ?? run.action ?? normalized?.method ?? "read");
      const provenanceLabel = provenance ? String(provenance.kind ?? provenance.source ?? provenance.model ?? "Provenance attached") : typeof run.provenance === "string" ? run.provenance.startsWith("LIVE_CODEX_ASSISTED_BRIDGE") ? "Codex-assisted \xB7 owner-mediated execution" : run.provenance.startsWith("LOCAL_SCRIPT_OR_UNVERIFIED_PROPOSAL") ? "Local script or unverified proposal" : run.provenance : String(run.kind ?? run.source ?? "Unverified proposal");
      const titles = { submit: "Submitted contribution evidence", order: "Purchased an evaluation service", accept: "Accepted the delivered evaluation", claim: "Claimed earned cash", read: "Read project state" };
      return `<article class="agent-run"><div class="agent-run-icon">${method === "order" ? "\u2197" : method === "accept" ? "\u2713" : method === "submit" ? "\u25C8" : "\u2261"}</div><div><div class="activity-title"><strong>${esc(titles[method] ?? method)}</strong>${statusBadge(run.status ?? run.outcome)}</div><div class="activity-meta">${esc(time(run.at ?? run.createdAt))} \xB7 ${esc(provenanceLabel)}</div>${details(run, "Inspect proposal, authority & model provenance")}</div></article>`;
    }).join("")}</div>` : empty("No Agent runs are recorded. Fixed scripts are never presented as model calls.");
  }
  function agentTemplateControls() {
    return `<div class="field-row" style="margin:16px 0"><div class="field"><label for="agent-method">Session format template</label><select id="agent-method"><option value="read">Read state</option><option value="submit">Self-submit</option><option value="claim">Self-claim</option><option value="order">Bounded purchase</option><option value="accept">Accept own delivery</option></select></div><button class="button" id="agent-template" type="button" style="align-self:end">Fill template</button></div><p class="legend">Templates provide a fixed format with unverified provenance; they do not count as real model assistance. Acceptance uses only this actor\u2019s delivered orders and the actual digest of a saved evaluation.</p>`;
  }
  function fillAgentTemplate(orderId) {
    const session = state?.agents?.session;
    const input = document.querySelector("#proposal");
    if (!session || !input) return;
    const method = document.querySelector("#agent-method")?.value ?? "read";
    const ownDeliveredOrder = list(project()?.orders).find((order) => order.status === "DELIVERED" && (!orderId || String(order.id) === orderId) && String(order.buyer).toLowerCase() === String(session.actor).toLowerCase() && list(state?.evaluations).some((evaluation) => String(evaluation.digest).toLowerCase() === String(order.resultDigest).toLowerCase()));
    if (method === "accept" && !ownDeliveredOrder) {
      toast("This project has no delivered order owned by this Agent with a matching saved evaluation digest. Refresh state and complete delivery first.", true);
      return;
    }
    const args = {
      read: {},
      submit: { taskId: "", actorType: 1, operator: session.actor, beneficiary: session.recipient, digest: lastEvaluation?.digest ?? "", uri: lastEvaluation?.uri ?? "" },
      claim: { contributionId: "" },
      order: { clientKey: "", deadline: String(Math.floor(Date.now() / 1e3) + 300), formatDigest: lastEvaluation?.digest ?? `0x${"00".repeat(32)}` },
      accept: { orderId: ownDeliveredOrder?.id, resultDigest: ownDeliveredOrder?.resultDigest }
    };
    input.value = json({ sessionId: session.id, chainId: session.chainId, actor: session.actor, target: session.target, token: session.token, recipient: session.recipient, method, amount: method === "order" ? "" : "0", nonce: session.nonce, expiresAt: session.expiresAt, args: args[method] });
    input.focus();
  }
  function bind() {
    document.querySelector("#refresh")?.addEventListener("click", () => {
      void refresh();
    });
    document.querySelectorAll("[data-tab]").forEach((element) => element.addEventListener("click", () => {
      tab = element.dataset.tab;
      render();
    }));
    document.querySelector("#project-select")?.addEventListener("change", (event) => {
      selectedProject = event.target.value;
      render();
    });
    document.querySelector("#agent-template")?.addEventListener("click", () => fillAgentTemplate());
    document.querySelector("[data-home]")?.addEventListener("click", (event) => {
      event.preventDefault();
      tab = "projects";
      render();
    });
    document.querySelectorAll("[data-agent-accept]").forEach((element) => element.addEventListener("click", () => {
      const controls = document.querySelector(".agent-controls");
      if (controls) controls.open = true;
      const method = document.querySelector("#agent-method");
      if (method) method.value = "accept";
      fillAgentTemplate(element.dataset.agentAccept);
      document.querySelector("#proposal")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }));
    document.querySelectorAll("[data-action]").forEach((element) => element.addEventListener("click", () => showAction(element.dataset.action ?? "", JSON.parse(element.dataset.defaults ?? "{}"))));
    document.querySelector("#evaluation-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = document.querySelector("#samples");
      if (!input) return;
      void runWrite(async () => {
        const samples = JSON.parse(input.value);
        lastEvaluation = await request("/api/evaluate", { samples });
        toast(`Evaluation saved: ${text(lastEvaluation.id)}. Results cover only the submitted samples.`);
      });
    });
    document.querySelector("#agent-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = document.querySelector("#proposal");
      if (!input) return;
      void runWrite(async () => {
        const proposal = JSON.parse(input.value);
        lastAgentResponse = await request("/api/agent/propose", { sessionId: state?.agents?.session?.id, proposal });
        toast("The bounded executor returned a result. Details and run provenance are recorded.");
      });
    });
  }
  async function runWrite(operation) {
    if (recordedMode || busy || !capability) return;
    busy = true;
    document.querySelectorAll("button").forEach((element) => {
      element.disabled = true;
    });
    try {
      await operation();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
    busy = false;
    await refresh();
  }
  function showAction(action, defaults) {
    const spec = actionSpecs[action];
    const current = project();
    if (recordedMode || !spec || !current || !capability || busy) return;
    document.querySelector(".modal-shade")?.remove();
    const shade = document.createElement("div");
    shade.className = "modal-shade";
    shade.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="action-title"><div class="modal-head"><div><h2 id="action-title">${esc(spec.label)}</h2><p>${esc(spec.help)}</p></div><button class="close-button" aria-label="Close">\xD7</button></div><form id="action-form"><div class="field"><label for="action-actor">Local actor</label><select id="action-actor" name="actor" required>${(state?.actors ?? []).map((actor) => `<option value="${esc(actor.name)}">${esc(actor.name)} \xB7 ${esc(actor.kind ?? "")} \xB7 ${esc(short(actor.address))}</option>`).join("")}</select><small>Disposable local accounts only. Onchain authority and state checks still apply.</small></div>${spec.fields.map((field) => fieldHtml(field, defaults[field.key])).join("")}<div class="notice warning"><div>This action affects local project #${esc(current.id)}. Enter decimal atomic-unit amounts. Candidate parameters are not public release terms.</div></div><div class="modal-footer"><button type="button" class="button" data-close>Cancel</button><button type="submit" class="button primary">Execute local action</button></div></form></section>`;
    document.body.append(shade);
    const close = () => {
      shade.remove();
      document.removeEventListener("keydown", onEscape);
    };
    const onEscape = (event) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onEscape);
    shade.querySelector(".close-button")?.addEventListener("click", close);
    shade.querySelector("[data-close]")?.addEventListener("click", close);
    shade.addEventListener("click", (event) => {
      if (event.target === shade) close();
    });
    const actorSelect = shade.querySelector("#action-actor");
    const actorDefaults = { publishRule: "admin", validate: "reviewer", reject: "reviewer", deliver: "provider", buyback: "keeper", order: "user", acceptOrder: "user", refundOrder: "user", submit: "builder", acceptTask: "builder", claimBounty: "builder" };
    if (actorSelect && (state?.actors ?? []).some((actor) => actor.name === actorDefaults[action])) actorSelect.value = actorDefaults[action];
    const fillActorAddresses = () => {
      const actor = state?.actors?.find((item) => item.name === actorSelect?.value);
      for (const name of ["operator", "beneficiary"]) {
        const field = shade.querySelector(`[name="${name}"]`);
        if (field && actor) field.value = actor.address;
      }
    };
    fillActorAddresses();
    actorSelect?.addEventListener("change", fillActorAddresses);
    const firstInput = shade.querySelector("input");
    (firstInput ?? actorSelect)?.focus();
    shade.querySelector("#action-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.target;
      const formData = new FormData(form);
      const args = {};
      try {
        for (const field of spec.fields) {
          const raw = String(formData.get(field.key) ?? "").trim();
          if (!raw && field.optional) continue;
          args[field.key] = field.type === "json" ? JSON.parse(raw) : ["number", "role", "actorType"].includes(field.type ?? "") ? Number(raw) : raw;
        }
      } catch {
        toast("Invalid JSON field. Check the format and retry.", true);
        return;
      }
      const actor = String(formData.get("actor"));
      close();
      void runWrite(async () => {
        const result = await request("/api/action", { action, projectId: String(current.id), actor, ...args });
        toast(`${spec.label}\uFF1A${text(result.status)} ${short(result.hash)}`);
      });
    });
  }
  function fieldHtml(field, value) {
    const id = `action-${field.key}`;
    const required = field.optional ? "" : "required";
    const control = field.type === "json" ? `<textarea id="${id}" name="${esc(field.key)}" ${required} placeholder="${esc(field.placeholder)}" spellcheck="false">${value === void 0 ? "" : esc(json(value))}</textarea>` : field.type === "role" || field.type === "actorType" ? `<select id="${id}" name="${esc(field.key)}">${(field.type === "role" ? ["Initiator", "Builder", "Promoter", "User"] : ["Human", "Agent", "Organization"]).map((label, index) => `<option value="${index}" ${String(value) === String(index) ? "selected" : ""}>${label}</option>`).join("")}</select>` : `<input id="${id}" name="${esc(field.key)}" type="${field.type === "number" ? "number" : "text"}" ${field.type === "number" ? 'min="1" step="1"' : ""} ${required} placeholder="${esc(field.placeholder)}" value="${value === void 0 ? "" : esc(value)}" autocomplete="off" />`;
    return `<div class="field"><label for="${id}">${esc(field.label)}${field.optional ? " (optional)" : ""}</label>${control}${field.help ? `<small>${esc(field.help)}</small>` : ""}</div>`;
  }
  async function start() {
    render();
    if (!recordedMode) {
      try {
        const session = await request("/api/local-session");
        capability = typeof session.capability === "string" ? session.capability : "";
      } catch (error) {
        toast(`Local write authorization unavailable: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    }
    await refresh();
  }
  void start();
})();
