const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const indexPath = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
const appScript = scripts.find((match) => !/module/i.test(match[1]) && match[2].includes('function startMatchmaking'));
assert.ok(appScript, 'Main prototype script was not found');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function getAt(root, key) {
  return key.split('/').filter(Boolean).reduce((value, part) => value && value[part], root);
}

function setAt(root, key, value) {
  const parts = key.split('/').filter(Boolean);
  let target = root;
  for (const part of parts.slice(0, -1)) target = target[part] || (target[part] = {});
  target[parts.at(-1)] = clone(value);
}

function removeAt(root, key) {
  const parts = key.split('/').filter(Boolean);
  let target = root;
  for (const part of parts.slice(0, -1)) {
    target = target && target[part];
    if (!target) return;
  }
  delete target[parts.at(-1)];
}

function createRealtimeDatabase() {
  const data = {};
  const listeners = new Map();

  function snapshot(key) {
    return { val: () => clone(getAt(data, key) ?? null) };
  }

  function notify(changedKey) {
    for (const [listenKey, handlers] of listeners) {
      if (changedKey !== listenKey && !changedKey.startsWith(`${listenKey}/`) && !listenKey.startsWith(`${changedKey}/`)) continue;
      for (const handler of [...handlers]) handler(snapshot(listenKey));
    }
  }

  return {
    data,
    api: {
      db: {},
      ref(_db, key) { return { key }; },
      async set(ref, value) {
        setAt(data, ref.key, value);
        notify(ref.key);
      },
      onValue(ref, handler) {
        const handlers = listeners.get(ref.key) || new Set();
        handlers.add(handler);
        listeners.set(ref.key, handlers);
        handler(snapshot(ref.key));
      },
      off(ref, _event, handler) {
        const handlers = listeners.get(ref.key);
        if (handlers) handlers.delete(handler);
      },
      async get(ref) { return snapshot(ref.key); },
      async remove(ref) {
        removeAt(data, ref.key);
        notify(ref.key);
      },
      onDisconnect() { return { remove: async () => {} }; },
      async runTransaction(ref, updater) {
        const next = updater(clone(getAt(data, ref.key) ?? null));
        setAt(data, ref.key, next);
        notify(ref.key);
        return { committed: true, snapshot: snapshot(ref.key) };
      },
    },
  };
}

class MockElement {
  constructor(id = '') {
    this.id = id;
    this.hidden = false;
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.dataset = {};
    this.style = { width: '', setProperty() {} };
    this.children = [];
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        const enabled = force === undefined ? !classes.has(name) : force;
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      },
    };
  }

  addEventListener() {}
  setAttribute() {}
  appendChild(child) { this.children.push(child); return child; }
  querySelector() { return new MockElement(); }
  querySelectorAll() { return []; }
  remove() {}
  focus() {}
}

function storageFacade(storage) {
  return {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
}

function createClient(label, firebase, sharedLocalStorage, playerSessionStorage = new Map()) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, new MockElement(id));
    return elements.get(id);
  };
  const lobby = element('lobby');
  const document = {
    activeElement: null,
    getElementById: element,
    querySelector: () => new MockElement(),
    querySelectorAll: () => [],
    createElement: (tag) => new MockElement(tag),
    addEventListener() {},
  };
  const window = {
    FB: firebase.api,
    document,
    addEventListener() {},
    dispatchEvent() {},
    requestAnimationFrame(callback) { callback(); },
  };
  window.window = window;
  const localStorage = storageFacade(sharedLocalStorage);
  const sessionStorage = storageFacade(playerSessionStorage);
  const context = vm.createContext({
    window,
    document,
    localStorage,
    sessionStorage,
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {},
    Event: function Event(type) { this.type = type; },
    Math,
    Date,
    JSON,
    performance: { now: () => 0 },
  });
  vm.runInContext(appScript[2], context, { timeout: 5000 });
  vm.runInContext(`_sessionName = ${JSON.stringify(label)};`, context);
  vm.runInContext(`
    enterGame = function enterGameForProtocolTest() {
      matchmakingQueued = false;
      document.getElementById('lobby').classList.add('hidden');
      window.__enteredGame = true;
      syncPlayerWalletFromStorage();
      ensureMatchEntryCharged();
      setTimeout(() => persistState(), 0);
    };
  `, context);
  return { context, lobby, playerSessionStorage, element };
}

async function run() {
  const firebase = createRealtimeDatabase();
  const sharedLocalStorage = new Map();
  const host = createClient('Host', firebase, sharedLocalStorage);
  const guest = createClient('Guest', firebase, sharedLocalStorage);

  host.context.setCreatorBonusRolls(70);
  guest.context.setCreatorBonusRolls(30);
  assert.equal(host.context.playerWalletBr(), 70, 'Host should retain its own Admin wallet value');
  assert.equal(guest.context.playerWalletBr(), 30, 'Guest should retain its own Admin wallet value');
  const reloadedHost = createClient('HostReload', firebase, sharedLocalStorage, host.playerSessionStorage);
  assert.equal(reloadedHost.context.playerWalletBr(), 70, 'Host wallet should survive a refresh in the same tab session');

  host.context.writeDailyState({
    date: host.context.todayKey(),
    walletBr: 70,
    dailyProgress: 4,
    dailyRewardClaimed: false,
    awardedGameIds: [],
    chargedEntryGameIds: [],
  });
  vm.runInContext(`selectedTierId = 'tier3'; renderLobbyHome();`, host.context);
  assert.equal(host.element('lobbyDailyFill').style.width, '20%', 'Earned daily progress should remain solid');
  assert.equal(host.element('lobbyDailyWinPreview').style.left, '20%', 'Win preview should begin after earned progress');
  assert.equal(host.element('lobbyDailyWinPreview').style.width, '60%', 'Tier 3 win should preview twelve daily points');
  assert.equal(host.element('lobbyDailyGoalPreview').style.left, '80%', '250 preview should begin after the win reward');
  assert.equal(host.element('lobbyDailyGoalPreview').style.width, '20%', 'Tier 3 250 reward should preview four daily points');
  assert.equal(host.element('lobbyDailyPotentialLabel').textContent, 'Tier 3 preview');
  assert.equal(host.element('lobbyDailyPotentialTotal').textContent, 'Up to +16');
  assert.equal(host.element('tierIncreaseBtn').disabled, true, 'Increase should disable at Tier 3');
  assert.equal(host.element('tierDecreaseBtn').disabled, false, 'Decrease should remain available at Tier 3');
  host.context.changeMatchTier(-1);
  assert.equal(host.element('matchCard').classList.contains('tier-change-down'), true, 'Tier changes should animate the reward card');
  vm.runInContext(`selectedTierId = 'tier1'; renderLobbyHome();`, host.context);
  assert.equal(host.element('tierDecreaseBtn').disabled, true, 'Decrease should disable at Tier 1');
  assert.equal(host.element('tierIncreaseBtn').disabled, false, 'Increase should remain available at Tier 1');

  await host.context.createQueuedMatchmakingRoom();
  const waitingRooms = Object.keys(firebase.data.lobbies || {});
  assert.equal(waitingRooms.length, 1, 'Host should create one waiting matchmaking room');
  const roomCode = waitingRooms[0];

  await guest.context.startMatchmaking();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(host.context.window.__enteredGame, true, 'Host should enter the match');
  assert.equal(guest.context.window.__enteredGame, true, 'Guest should enter the match');
  assert.equal(host.lobby.classList.contains('hidden'), true, 'Host lobby should close');
  assert.equal(guest.lobby.classList.contains('hidden'), true, 'Guest lobby should close');
  assert.ok(firebase.data.rooms[roomCode].p2ClaimId, 'Host persistence must retain the guest claim ID');
  assert.equal(vm.runInContext('matchmakingQueued', guest.context), false, 'Guest should leave the queue');
  assert.equal(vm.runInContext('roomCode', guest.context), roomCode, 'Both clients should use the same room');
  assert.equal(host.context.playerWalletBr(), 68, 'Host wallet should pay only the host entry cost');
  assert.equal(guest.context.playerWalletBr(), 28, 'Guest wallet should pay only the guest entry cost');
  assert.equal(firebase.data.rooms[roomCode].state.players.p1.bonusRolls, 68, 'Host in-game wallet should match host meta');
  assert.equal(firebase.data.rooms[roomCode].state.players.p2.bonusRolls, 28, 'Guest in-game wallet should match guest meta');
  assert.notEqual(
    host.playerSessionStorage.get('yahtzee_pvp_player_meta_v2'),
    guest.playerSessionStorage.get('yahtzee_pvp_player_meta_v2'),
    'Each player tab should own a separate meta record',
  );

  const spent = vm.runInContext('spendBonusRolls(state.players.p1, 2)', host.context);
  assert.equal(spent, true, 'A valid BR spend should succeed');
  assert.equal(host.element('walletButton').classList.contains('is-spending'), true, 'Wallet spend pulse should start');
  assert.equal(host.element('brSpendFeedback').classList.contains('show'), true, 'BR spend label should show');
  assert.equal(host.element('brSpendFeedback').textContent, '-2 BR', 'BR spend label should show the deducted amount');

  host.element('yahtzeeRollFeedback').hidden = true;
  const nonYahtzeeAnimated = vm.runInContext('animateYahtzeeRoll([1,2,3,4,5])', host.context);
  assert.equal(nonYahtzeeAnimated, false, 'A normal roll should not trigger Yahtzee feedback');
  const yahtzeeAnimated = vm.runInContext('animateYahtzeeRoll([6,6,6,6,6])', host.context);
  assert.equal(yahtzeeAnimated, true, 'A Yahtzee roll should trigger feedback');
  assert.equal(host.element('diceRow').classList.contains('yahtzee-roll'), true, 'Yahtzee dice glow should start');
  assert.equal(host.element('yahtzeeRollFeedback').classList.contains('show'), true, 'Yahtzee label should show');
  assert.equal(host.element('yahtzeeRollFeedback').hidden, false, 'Yahtzee label should be visible');

  console.log(`matchmakingProtocol=ok room=${roomCode} hostWallet=66 guestWallet=28 animations=ok isolatedSessions=true`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
