import { isDeepStrictEqual } from 'node:util';

const CHECKPOINT_EVERY = 6;
const CHECKPOINT_COINS = 3;
const LAP_COINS = 6;
const COLORS = new Set(['#286653','#cf744d','#6976b3','#af5980','#a19036','#448e9e','#795c9b','#6f8746']);
const STEPS = { 'payment-low': 2, 'payment-mid': 3, 'payment-high': 4 };
const integer = (value, min = 0, max = 1000000000) => Number.isSafeInteger(value) && value >= min && value <= max;
const halfStep = value => Number.isFinite(value) && Number.isSafeInteger(value * 2);

function without(object, keys) {
  return Object.fromEntries(Object.entries(object || {}).filter(([key]) => !keys.includes(key)));
}
function activityDayAllowed(key) {
  const match = /^activity-(\d{4}-\d{2}-\d{2})(?:-\d+)?$/.exec(key);
  if (!match) return false;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
  const difference = (Date.parse(today) - Date.parse(match[1])) / 86400000;
  // The browser records its local calendar day; it can be one day ahead of Moscow.
  return Number.isInteger(difference) && difference >= -1 && difference <= 1;
}
function applyReverse(root, ops) {
  if (!Array.isArray(ops) || ops.length > 10000) return false;
  for (const op of ops) {
    if (!op || !Array.isArray(op.path) || !op.path.length || op.path.length > 30 ||
        !['players','ledger'].includes(op.path[0]) ||
        op.path.some(part => ['__proto__','constructor','prototype'].includes(part))) return false;
    let parent = root;
    for (const part of op.path.slice(0, -1)) {
      parent = parent?.[part];
      if (!parent || typeof parent !== 'object') return false;
    }
    const key = op.path.at(-1), target = parent?.[key];
    if (op.kind === 'length') {
      if (!Array.isArray(target) || !integer(op.length, 0, target.length)) return false;
      target.length = op.length;
    } else if (op.kind === 'append') {
      if (!Array.isArray(target) || !Array.isArray(op.items)) return false;
      target.push(...structuredClone(op.items));
    } else if (op.kind === 'set') {
      parent[key] = structuredClone(op.value);
    } else if (op.kind === 'delete') {
      delete parent[key];
    } else return false;
  }
  return true;
}
function singleActionValid(before, after) {
  let actions = after.players.length - before.players.length;
  if (actions > 1) return false;
  for (let i = 0; i < before.players.length; i++) {
    const old = before.players[i], player = after.players[i];
    if (player.pos !== old.pos) actions++;
    if (player.sport !== old.sport || player.avatar !== old.avatar) actions++;
    if (player.cross !== old.cross) {
      if (player.cross - old.cross !== 1) return false;
      actions++;
    }
    if (player.calls !== old.calls) {
      if (player.calls - old.calls !== 3) return false;
      actions++;
    }
    for (const key of new Set([...Object.keys(old.actionCounts || {}), ...Object.keys(player.actionCounts || {})])) {
      const delta = (player.actionCounts?.[key] ?? 0) - (old.actionCounts?.[key] ?? 0);
      if (!delta) continue;
      if (key.startsWith('activity-')) {
        actions++;
      } else if (Object.hasOwn(STEPS, key)) {
        if (delta !== 1) return false;
        actions++;
      } else {
        if (delta > 1000000) return false;
        actions++;
      }
    }
  }
  return actions === 1;
}

export function publicUpdateValid(before, after, verifyHistory = true) {
  if (!before || !after || typeof after !== 'object' || !Array.isArray(after.players) ||
      !Array.isArray(after.ledger) || !Array.isArray(after.rewards) || !Array.isArray(after.logs)) return false;
  if (!isDeepStrictEqual(before.rewards, after.rewards) ||
      !isDeepStrictEqual(without(before, ['players','ledger','logs','updated','undo']), without(after, ['players','ledger','logs','updated','undo'])) ||
      after.undo !== null || !Number.isFinite(Date.parse(after.updated))) return false;
  const oldLogs = before.logs || [];
  if (after.logs.length < oldLogs.length ||
      !isDeepStrictEqual(after.logs.slice(-oldLogs.length || after.logs.length), oldLogs)) return false;
  const newLogs = after.logs.slice(0, after.logs.length - oldLogs.length);
  if (newLogs.some(log => !log || typeof log.id !== 'string' || typeof log.text !== 'string' ||
      log.text.length > 5000 || !Number.isFinite(Date.parse(log.at)))) return false;
  if (after.players.length < before.players.length || after.players.length > 40 ||
      !isDeepStrictEqual(after.ledger.slice(0, before.ledger.length), before.ledger)) return false;
  const seen = new Set();
  const expectedMilestones = new Map();
  const movedPlayers = new Set();
  let changed = false;
  for (let i = 0; i < after.players.length; i++) {
    const player = after.players[i], old = before.players[i] || {
      id: player?.id, name: player?.name, salesName: player?.salesName, color: player?.color, sport: player?.sport,
      pos: 0, high: 0, bank: 0, cash: 0, cashBase: 0, calls: 0, cross: 0,
      shields: 0, used: [], actionCounts: {}
    };
    if (!player || typeof player.id !== 'string' || !player.id || seen.has(player.id) ||
        typeof player.name !== 'string' || !player.name.trim() || player.name.length > 60 ||
        !COLORS.has(player.color)) return false;
    seen.add(player.id);
    if (i >= before.players.length) {
      if (!integer(player.sport, 0, 9) || player.salesName !== player.name ||
          [...seen].slice(0, -1).some(id => after.players.find(item => item.id === id)?.name.toLowerCase() === player.name.toLowerCase())) return false;
      changed = true;
    } else if (player.id !== old.id || player.name !== old.name || player.color !== old.color) return false;
    if (!isDeepStrictEqual(
      without(player, ['pos','high','bank','calls','cross','actionCounts','sport','avatar']),
      without(old, ['pos','high','bank','calls','cross','actionCounts','sport','avatar'])
    )) return false;
    if ((player.sport !== undefined && !integer(player.sport, 0, 9)) ||
        (player.avatar !== undefined && (typeof player.avatar !== 'string' || player.avatar.length > 300000 ||
          !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(player.avatar)))) return false;
    if (!player.actionCounts || typeof player.actionCounts !== 'object' || Array.isArray(player.actionCounts) ||
        !integer(player.pos, 0, 1000000000000) || !integer(player.high, 0, 1000000000000) ||
        player.pos < old.pos || player.high !== Math.max(old.high, player.pos) ||
        !halfStep(player.bank) || player.bank < 0 || player.bank > 100000000 ||
        !integer(player.cross) || !integer(player.calls) ||
        player.calls !== old.calls ||
        player.cross < old.cross) return false;
    const earned = earnedStepsForPlayer(old, player, before.config?.actions || []);
    if (earned === null || !halfStep(earned) || !Number.isSafeInteger(player.pos - old.pos) ||
        player.bank !== old.bank + earned - (player.pos - old.pos)) return false;
    if (player.pos !== old.pos) movedPlayers.add(player.id);
    if (player.pos !== old.pos || earned || player.sport !== old.sport || player.avatar !== old.avatar) changed = true;
    for (let ref = (Math.floor(old.high / CHECKPOINT_EVERY) + 1) * CHECKPOINT_EVERY; ref <= player.high; ref += CHECKPOINT_EVERY) {
      expectedMilestones.set(player.id + ':' + ref, ref % 60 === 0 ? LAP_COINS : CHECKPOINT_COINS);
      if (expectedMilestones.size > 10000) return false;
    }
  }
  const additions = after.ledger.slice(before.ledger.length);
  const runnerCounts = new Map(), runnerFinishes = new Set();
  if (additions.length < expectedMilestones.size || additions.length > expectedMilestones.size + movedPlayers.size * 4) return false;
  for (const entry of additions) {
    if (entry?.source === 'runner') {
      if (!movedPlayers.has(entry.playerId) || entry.amount !== 1 || typeof entry.id !== 'string' || !entry.id ||
          typeof entry.ref !== 'string' || !/^runner-[A-Za-z0-9-]{1,90}-(?:coin-[1-3]|finish)$/.test(entry.ref) ||
          typeof entry.title !== 'string' || !Number.isFinite(Date.parse(entry.at))) return false;
      const run = entry.ref.replace(/-(?:coin-[1-3]|finish)$/, ''), key = entry.playerId + ':' + run;
      runnerCounts.set(key, (runnerCounts.get(key) || 0) + 1);
      if (runnerCounts.get(key) > 4) return false;
      if (entry.ref.endsWith('-finish')) {
        if (runnerFinishes.has(key)) return false;
        runnerFinishes.add(key);
      }
      continue;
    }
    const key = entry?.playerId + ':' + entry?.ref;
    if (!expectedMilestones.has(key) || entry.source !== 'milestone' ||
        entry.amount !== expectedMilestones.get(key) ||
        typeof entry.id !== 'string' || !entry.id ||
        typeof entry.title !== 'string' || !Number.isFinite(Date.parse(entry.at))) return false;
    expectedMilestones.delete(key);
  }
  if (expectedMilestones.size) return false;
  if ((changed || additions.length > 0) && !newLogs.length) return false;
  if (newLogs.length === 1 && !singleActionValid(before, after)) return false;
  if (verifyHistory) {
    let current = structuredClone(after);
    for (let i = 0; i < newLogs.length; i++) {
      const reverse = current.logs[0]?.reverse;
      if (reverse?.kind !== 'patch') return false;
      const previous = structuredClone(current);
      if (!applyReverse(previous, reverse.ops)) return false;
      previous.logs.shift();
      if (!publicUpdateValid(previous, current, false)) return false;
      current = previous;
    }
    if (!isDeepStrictEqual(without(current, ['updated','undo']), without(before, ['updated','undo']))) return false;
  }
  return true;
}

function earnedStepsForPlayer(oldPlayer, player, actions) {
  const oldCounts = oldPlayer.actionCounts || {}, counts = player.actionCounts || {};
  let earned = 0;
  for (const key of new Set([...Object.keys(oldCounts), ...Object.keys(counts)])) {
    const previous = oldCounts[key] ?? 0, next = counts[key] ?? 0;
    if (!integer(previous) || !integer(next) || next < previous) return null;
    const change = next - previous;
    if (!change) continue;
    if (Object.hasOwn(STEPS, key)) {
      earned += change * STEPS[key];
    } else if (key === 'cross') {
      earned += change * 3;
    } else if (activityDayAllowed(key, player)) {
      if (previous !== 0 || next !== 70) return null;
      earned += 5;
    } else {
      const action = actions.find(item => item.id === key && item.enabled);
      if (!action || change > 1000000) return null;
      earned += (Math.floor(next / action.unit) - Math.floor(previous / action.unit)) * action.steps;
    }
  }
  const crossDelta = player.cross - oldPlayer.cross;
  if (crossDelta < 0 || !integer(crossDelta)) return null;
  // Cross-sales have a dedicated counter; the client does not write an actionCounts key.
  earned += 3 * crossDelta;
  return earned;
}
