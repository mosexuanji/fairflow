import { getAddress } from 'ethers';
import { canonicalize } from './evaluation.mjs';

const sessionState = new WeakMap();
const METHODS = new Set(['read', 'submit', 'claim', 'order', 'accept']);

function object(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${name} must be a plain object`);
}
function integer(value, name, positive = false) {
  if ((typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value)) && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) throw new TypeError(`${name} must be a nonnegative integer`);
  const normalized = BigInt(value);
  if (positive && normalized === 0n) throw new TypeError(`${name} must be positive`);
  if (normalized > (1n << 256n) - 1n) throw new TypeError(`${name} exceeds uint256`);
  return normalized;
}
function address(value, name) {
  if (typeof value !== 'string') throw new TypeError(`${name} must be an address`);
  try { return getAddress(value); } catch { throw new TypeError(`${name} must be a valid address`); }
}

/** A server-created immutable policy; no proposal can widen its stored grants. */
export function createSession({ id, chainId, actor, target, token, recipient, expiresAt, perAction, limit }) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(id)) throw new TypeError('Session id must be a bounded identifier');
  if (integer(chainId, 'chainId') !== 31337n) throw new TypeError('Only disposable local chain 31337 is permitted');
  const perActionValue = integer(perAction, 'perAction', true);
  const limitValue = integer(limit, 'limit', true);
  if (perActionValue > limitValue) throw new TypeError('perAction cannot exceed session limit');
  const policy = Object.freeze({
    id,
    chainId: 31337,
    actor: address(actor, 'actor'),
    target: address(target, 'target'),
    token: address(token, 'token'),
    recipient: address(recipient, 'recipient'),
    expiresAt: integer(expiresAt, 'expiresAt', true).toString(),
    perAction: perActionValue.toString(),
    limit: limitValue.toString(),
  });
  sessionState.set(policy, { spent: 0n, nonces: new Set(), checked: new Map() });
  return policy;
}

/** Independent allowlist check. Checking is not success and does not consume budget. */
export function checkProposal(session, proposal, now = Math.floor(Date.now() / 1000)) {
  const state = sessionState.get(session);
  if (!state) throw new TypeError('Unknown server-created session');
  object(proposal, 'Proposal');
  canonicalize(proposal);
  const allowedKeys = new Set(['sessionId', 'chainId', 'actor', 'target', 'method', 'token', 'recipient', 'amount', 'nonce', 'expiresAt', 'args']);
  if (Object.keys(proposal).some((key) => !allowedKeys.has(key))) throw new TypeError('Proposal contains an unapproved field');
  if (proposal.sessionId !== session.id) throw new TypeError('Session mismatch');
  if (integer(proposal.chainId, 'chainId') !== BigInt(session.chainId)) throw new TypeError('Network mismatch');
  if (typeof proposal.method !== 'string' || !METHODS.has(proposal.method)) throw new TypeError('Method is not permitted');
  for (const field of ['actor', 'target', 'token', 'recipient']) {
    if (address(proposal[field], field) !== session[field]) throw new TypeError(`${field} mismatch`);
  }
  const expiry = integer(proposal.expiresAt, 'expiresAt', true);
  const timestamp = integer(now, 'now');
  if (timestamp >= BigInt(session.expiresAt) || timestamp >= expiry || expiry > BigInt(session.expiresAt)) throw new TypeError('Proposal or session expired, or expiry exceeds grant');
  const nonce = integer(proposal.nonce, 'nonce').toString();
  if (state.nonces.has(nonce)) throw new TypeError('Nonce already consumed');
  const amount = integer(proposal.amount, 'amount');
  if (proposal.method === 'order') {
    if (amount === 0n || amount > BigInt(session.perAction) || state.spent + amount > BigInt(session.limit)) throw new TypeError('Order exceeds per-action or session budget');
  } else if (amount !== 0n) {
    throw new TypeError('Only order may carry a payment amount');
  }
  const args = proposal.args ?? {};
  object(args, 'Action arguments');
  const permittedArguments = {
    read: new Set(),
    order: new Set(['clientKey', 'formatDigest', 'deadline', 'uri']),
    submit: new Set(['taskId', 'behaviorId', 'role', 'version', 'digest', 'uri', 'operator', 'beneficiary', 'actorType']),
    claim: new Set(['contributionId']),
    accept: new Set(['orderId', 'resultDigest']),
  }[proposal.method];
  if (Object.keys(args).some((key) => !permittedArguments.has(key))) throw new TypeError('Action argument is not permitted');
  if (proposal.method === 'submit') {
    if (args.beneficiary !== undefined && address(args.beneficiary, 'beneficiary') !== session.recipient) throw new TypeError('Beneficiary mismatch');
    if (args.operator !== undefined && address(args.operator, 'operator') !== session.actor) throw new TypeError('Operator must be the granted actor');
    if (args.actorType !== undefined && args.actorType !== 'Agent' && args.actorType !== 1) throw new TypeError('Agent cannot change its actor type');
  }
  let normalizedArgs = args;
  if (proposal.method === 'accept') {
    if (typeof args.resultDigest !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(args.resultDigest)) throw new TypeError('Acceptance requires an exact result digest');
    normalizedArgs = { orderId: integer(args.orderId, 'orderId', true).toString(), resultDigest: args.resultDigest.toLowerCase() };
  }
  canonicalize(normalizedArgs);
  const normalized = Object.freeze({
    sessionId: session.id,
    chainId: session.chainId,
    actor: session.actor,
    target: session.target,
    method: proposal.method,
    token: session.token,
    recipient: session.recipient,
    amount: amount.toString(),
    nonce,
    expiresAt: expiry.toString(),
    args: Object.freeze(JSON.parse(canonicalize(normalizedArgs))),
  });
  const fingerprint = canonicalize(normalized);
  const previouslyChecked = state.checked.get(nonce);
  if (previouslyChecked && previouslyChecked !== fingerprint) throw new TypeError('Nonce belongs to a different checked proposal');
  state.checked.set(nonce, fingerprint);
  return normalized;
}

/** Call only after successful execution; failed transactions retain payment budget. */
export function commitProposal(session, proposal) {
  const state = sessionState.get(session);
  if (!state) throw new TypeError('Unknown server-created session');
  object(proposal, 'Proposal');
  const nonce = integer(proposal.nonce, 'nonce').toString();
  if (state.nonces.has(nonce)) throw new TypeError('Nonce already consumed');
  if (state.checked.get(nonce) !== canonicalize(proposal)) throw new TypeError('Commit requires the exact successfully checked proposal');
  const amount = integer(proposal.amount, 'amount');
  if (state.spent + amount > BigInt(session.limit)) throw new TypeError('Session budget exhausted before commit');
  state.nonces.add(nonce);
  state.checked.delete(nonce);
  state.spent += amount;
  return { spent: state.spent.toString(), remaining: (BigInt(session.limit) - state.spent).toString(), nonce };
}
