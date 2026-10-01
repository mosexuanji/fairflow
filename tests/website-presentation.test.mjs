import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildSync } from 'esbuild';

// Runs the actual bundled presentation code with simulated DOM/fetch only.
// This does not establish visual/responsive/browser or public-hosted behavior.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotFile = ['docs/demo-state.json', 'release/submission-sprint01/public-demo/demo-state.json']
  .map((name) => path.join(root, name)).find((name) => fs.existsSync(name));
assert.ok(snapshotFile, 'A disclosed recorded-demo snapshot is required');
const fixture = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
const bundled = buildSync({ entryPoints: [path.join(root, 'frontend/main.ts')], bundle: true,
  write: false, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent' }).outputFiles[0].text;
const plain = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

async function boot({ hash = '', unavailable = false, snapshot = fixture } = {}) {
  const payload = freeze(structuredClone(snapshot));
  const before = JSON.stringify(payload);
  const requests = [];
  const scrollTargets = [];
  const windowEvents = new Map();
  let walletReads = 0;
  let currentHash = hash;
  let elements = [];
  let html = '';
  const emitHash = () => queueMicrotask(() => (windowEvents.get('hashchange') ?? []).forEach((handler) => handler({ type: 'hashchange' })));
  const location = { get hash() { return currentHash; }, set hash(value) {
    const next = String(value).startsWith('#') ? String(value) : '#' + value;
    if (next !== currentHash) { currentHash = next; emitHash(); }
  }, href: 'https://example.invalid/fairflow/', pathname: '/fairflow/' };
  function matches(element, selector) {
    return selector.split(',').some((part) => {
      part = part.trim();
      const tag = part.match(/^[a-z][\w-]*/i)?.[0];
      if (tag && element.tag !== tag.toLowerCase()) return false;
      const id = part.match(/#([\w-]+)/)?.[1];
      // A # inside an attribute value is not an ID selector.
      if (id && !part.includes('[') && element.attrs.id !== id) return false;
      const classes = [...part.matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
      if (classes.some((name) => !String(element.attrs.class ?? '').split(' ').includes(name))) return false;
      return [...part.matchAll(/\[([\w-]+)(?:([\^$*]?=)["']?([^\]"']*)["']?)?\]/g)].every(([, name, op, value]) => {
        const actual = element.attrs[name];
        if (actual === undefined) return false;
        return !op || (op === '=' ? actual === value : op === '^=' ? actual.startsWith(value) : op === '$=' ? actual.endsWith(value) : actual.includes(value));
      });
    });
  }
  class Element {
    constructor(tag = 'div', attrs = {}) {
      this.tag = tag; this.attrs = attrs; this.listeners = new Map(); this.disabled = 'disabled' in attrs;
      this.dataset = Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('data-'))
        .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
      this.value = attrs.value ?? ''; this.style = {};
    }
    addEventListener(name, handler) { const handlers = this.listeners.get(name) ?? []; handlers.push(handler); this.listeners.set(name, handlers); }
    removeEventListener() {}
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    hasAttribute(name) { return name in this.attrs; }
    remove() {}
    focus() {}
    scrollIntoView() { scrollTargets.push(this.attrs.id ?? ''); }
    querySelector(selector) { return elements.find((element) => matches(element, selector)) ?? null; }
    querySelectorAll(selector) { return elements.filter((element) => matches(element, selector)); }
    click() {
      let prevented = false;
      const event = { target: this, currentTarget: this, preventDefault() { prevented = true; } };
      (this.listeners.get('click') ?? []).forEach((handler) => handler(event));
      if (!prevented && this.attrs.href?.startsWith('#')) location.hash = this.attrs.href;
    }
  }
  const app = new Element('div', { id: 'app' });
  Object.defineProperty(app, 'innerHTML', { get: () => html, set: (value) => {
    html = value;
    elements = [...html.matchAll(/<([a-z][\w-]*)\b([^>]*?)>/gi)].map(([, tag, attributes]) => {
      const attrs = Object.fromEntries([...attributes.matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)]
        .map(([, name, double, single, unquoted]) => [name, double ?? single ?? unquoted ?? '']));
      return new Element(tag.toLowerCase(), attrs);
    });
  } });
  const document = { documentElement: { dataset: { fairflowMode: 'recorded-demo' } }, body: { append() {} },
    querySelector: (selector) => selector === '#app' ? app : elements.find((element) => matches(element, selector)) ?? null,
    querySelectorAll: (selector) => elements.filter((element) => matches(element, selector)),
    createElement: (tag) => new Element(tag), addEventListener() {}, removeEventListener() {} };
  const window = { location, addEventListener: (name, handler) => {
    const handlers = windowEvents.get(name) ?? []; handlers.push(handler); windowEvents.set(name, handlers);
  }, removeEventListener() {}, scrollTo() {} };
  Object.defineProperty(window, 'ethereum', { get() { walletReads++; throw new Error('Wallet access is outside presentation scope'); } });
  const history = { replaceState(_state, _title, url) { if (url !== undefined) currentHash = String(url).includes('#') ? '#' + String(url).split('#')[1] : ''; } };
  window.history = history;
  const context = vm.createContext({ document, window, location, history, console, URL, URLSearchParams,
    setTimeout: () => 1, clearTimeout() {}, queueMicrotask, fetch: async (url, options = {}) => {
      requests.push({ url: String(url), method: options.method ?? 'GET' });
      assert.equal(String(url), './demo-state.json', 'Recorded mode must only load the relative snapshot');
      assert.equal(options.method ?? 'GET', 'GET', 'Presentation cannot send a write');
      if (unavailable) throw new Error('Simulated unavailable recorded snapshot');
      return { ok: true, json: async () => payload };
    } });
  vm.runInContext(bundled, context, { timeout: 1000 });
  const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve)); };
  await flush();
  const appTest = { get html() { return html; }, get text() { return plain(html); }, get hash() { return currentHash; }, requests, scrollTargets,
    async navigate(next) { location.hash = next; await flush(); },
    async click(selector) { const element = document.querySelector(selector); assert.ok(element, 'Rendered navigation control: ' + selector); element.click(); await flush(); },
    checkReadOnly() {
      assert.equal(walletReads, 0, 'No wallet provider discovery');
      assert.deepEqual(requests, [{ url: './demo-state.json', method: 'GET' }]);
      assert.equal(JSON.stringify(payload), before, 'Navigation cannot alter the input snapshot');
      assert.doesNotMatch(html, /data-action=|id="(?:evaluation-form|agent-form|action-form)"|class="owner-controls"/, 'Recorded presentation has no execution forms/actions');
    } };
  return appTest;
}

test('recorded homepage is the narrative entry point and never acquires execution authority', async () => {
  const app = await boot();
  assert.match(app.text, /Make contribution count\./);
  assert.match(app.text, /Building software is getting cheaper\. Organizing value is not\./);
  assert.match(app.html, /href="#overview"/);
  assert.match(app.html, /href="#projects"/);
  assert.match(app.html, /href="#roadmap"/);
  assert.match(app.text, /hackathon prototype/i);
  assert.match(app.text, /recorded|read-only/i);
  await app.click('[data-how-it-works]');
  assert.deepEqual(app.scrollTargets, ['how-fairflow-works']);
  app.checkReadOnly();
});

test('Projects navigation exposes only real independently accounted project instances', async () => {
  const app = await boot();
  await app.click('a[href="#projects"]');
  for (const project of fixture.projects) {
    assert.ok(app.text.includes(project.name), 'Real project name visible');
    assert.ok(app.html.includes('href="#project/' + project.id + '/define"'), 'Real project card route');
  }
  const cardRoutes = [...app.html.matchAll(/href="#project\/([^"/]+)\/define"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(cardRoutes)].sort(), fixture.projects.map((project) => String(project.id)).sort());
  assert.match(app.text, /13\.5/);
  assert.match(app.text, /1,175/);
  assert.match(app.text, /1,174/);
  assert.doesNotMatch(app.text, /Create Project|Invite users|Billing dashboard/);
  app.checkReadOnly();
});

test('both project routes retain the accepted workflow and their independent recorded metrics', async () => {
  const app = await boot();
  for (const project of fixture.projects) {
    for (const step of ['define', 'recognize', 'settle']) {
      await app.navigate('#project/' + project.id + '/' + step);
      assert.ok(app.text.includes(project.name));
      assert.match(app.text, /All projects/i);
      assert.match(app.text, /Define work/);
      assert.match(app.text, /Recognize work/);
      assert.match(app.text, /Settle &amp; burn|Settle & burn/);
      const metrics = app.html.match(/<section class="stat-grid"[^>]*>([\s\S]*?)<\/section>/)?.[1];
      assert.ok(metrics, 'Selected project ledger metrics are rendered');
      const values = [...metrics.matchAll(/<div class="stat-value">([^<]+)/g)].map((match) => match[1]);
      assert.deepEqual(values, String(project.id) === '1' ? ['13.5', '1,175', '1', '1,174'] : ['0', '0', '0', '0']);
      if (step === 'settle' && String(project.id) === '1') {
        assert.match(app.text, /Operations budget 0\.7/);
        assert.match(app.text, /Buyback budget 0\.2/);
        assert.match(app.text, /1 recorded settled order/);
      }
      app.checkReadOnly();
    }
  }
});

test('project workflow buttons and return link follow the real selected-project hash hierarchy', async () => {
  const app = await boot({ hash: '#project/2/define' });
  await app.click('[data-tab="contributions"]');
  assert.equal(app.hash, '#project/2/recognize');
  await app.click('[data-tab="funds"]');
  assert.equal(app.hash, '#project/2/settle');
  await app.click('[data-tab="projects"]');
  assert.equal(app.hash, '#project/2/define');
  await app.click('a.all-projects');
  assert.equal(app.hash, '#projects');
  assert.ok(app.text.includes('FairFlow Evaluation') && app.text.includes('Isolation Check'));
  app.checkReadOnly();
});

test('dynamic project names and recorded capture labels are escaped in the actual presentation', async () => {
  const snapshot = structuredClone(fixture);
  snapshot.projects[0].name = '<img src=x onerror="ownerPermission()">';
  snapshot.presentation.capturedAt = '<script>ownerPermission()</script>';
  const app = await boot({ snapshot });
  assert.ok(app.html.includes('&lt;img'));
  assert.ok(app.html.includes('&lt;script&gt;'));
  assert.doesNotMatch(app.html, /<img src=x|<script>ownerPermission/);
  await app.navigate('#projects');
  assert.ok(app.html.includes('&lt;img'));
  assert.doesNotMatch(app.html, /<img src=x/);
  app.checkReadOnly();
});

test('roadmap maturity stages keep exploratory protocol/chain options distinct from the prototype', async () => {
  const app = await boot({ hash: '#roadmap' });
  for (const stage of ['NOW', 'NEXT', 'EXPAND', 'SCALE', 'PROTOCOL', 'LONG TERM']) assert.ok(app.text.includes(stage));
  assert.match(app.text, /ONLY IF SCALE JUSTIFIES IT/);
  assert.match(app.text, /design option, not a prerequisite/i);
  assert.match(app.text, /wallet controls|execution permissions/i);
  assert.doesNotMatch(app.text, /Q[1-4]\s+20\d\d|every purchase earns|guaranteed return/i);
  app.checkReadOnly();
});

test('unknown routes and unknown project IDs fail visibly without selecting another project', async () => {
  const app = await boot();
  for (const hash of ['#unknown', '#project/999/define', '#project/1/unknown', '#project/%E0%A4%A/define']) {
    await app.navigate(hash);
    assert.match(app.text, /not found|not available|could not find/i);
    assert.doesNotMatch(app.html, /class="stat-grid"|class="rules"|class="settlement-story"/);
    assert.match(app.html, /href="#projects"/);
    app.checkReadOnly();
  }
});

test('static narrative remains usable if the recorded snapshot is unavailable', async () => {
  const app = await boot({ unavailable: true });
  assert.match(app.text, /Make contribution count\./);
  await app.navigate('#roadmap');
  assert.match(app.text, /ONLY IF SCALE JUSTIFIES IT/);
  await app.navigate('#projects');
  assert.match(app.text, /unavailable|error|could not|Unable|snapshot/i);
  assert.doesNotMatch(app.html, /href="#project\/1\/define"/);
  app.checkReadOnly();
});
