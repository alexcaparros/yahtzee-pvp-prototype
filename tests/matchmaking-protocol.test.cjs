const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const indexPath = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
const appScript = scripts.find((match) => !/module/i.test(match[1]) && match[2].includes('function startMatchmaking'));
assert.ok(appScript, 'Main prototype script was not found');
for (const reason of ['win_reward', 'daily_reward', 'bonus_purchase', 'admin_adjustment', 'match_entry', 'extra_roll', 'turn_restart']) {
  assert.ok(appScript[2].includes(`'${reason}'`), `BR ledger should map ${reason}`);
}
for (const fieldId of ['dailyPotBaseInput', 'dailyPotWinProgressInput', 'dailyPotGoalProgressInput', 'tier1PotInput', 'tier2PotInput', 'tier3PotInput']) {
  assert.ok(html.includes(`id="${fieldId}"`), `Admin should expose ${fieldId}`);
}
assert.ok(html.includes("setCreatorConfig('dailyRewardMode', 'fixed')"), 'Admin should retain the fixed reward model');
assert.ok(html.includes("setCreatorConfig('dailyRewardMode', 'pot')"), 'Admin should expose the growing pot model');

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
  replaceChildren(...children) { this.children = [...children]; }
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

  await host.context.recordBrFlow('source', 'win_reward', 8, { eventId: 'test_host_win' });
  await host.context.recordBrFlow('sink', 'extra_roll', 3, { eventId: 'test_host_roll' });
  await guest.context.recordBrFlow('source', 'daily_reward', 5, { eventId: 'test_guest_daily' });
  const ledger = firebase.data.analytics.brEconomyV1;
  assert.equal(ledger.totals.sourceBr, 13, 'Global ledger should aggregate sources from every player session');
  assert.equal(ledger.totals.sinkBr, 3, 'Global ledger should aggregate sinks from every player session');
  assert.equal(Object.keys(ledger.players).length, 2, 'Global ledger should retain per-player aggregates');
  await host.context.recordBrFlow('source', 'win_reward', 8, { eventId: 'test_host_win' });
  assert.equal(ledger.totals.sourceBr, 13, 'Stable event IDs should prevent duplicated BR flow');
  host.context.openBrAnalytics();
  assert.equal(host.element('economyPanel').hidden, false, 'Analytics shortcut should open a full-screen panel');
  assert.equal(host.element('economySourceTotal').textContent, '+13');
  assert.equal(host.element('economySinkTotal').textContent, '−3');
  assert.equal(host.element('economyNetTotal').textContent, '+10');
  assert.equal(host.element('economyStatus').textContent, '2 players · 3 events');
  assert.equal(host.element('economyPlayerList').children.length, 2, 'Analytics should render every tracked player session');
  host.context.closeBrAnalytics();
  assert.equal(host.element('economyPanel').hidden, true, 'Analytics back action should return to the lobby');

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
  assert.equal(host.element('roomToolsTierCost').textContent, 'Entry: 2 BRs', 'Room tools should show the private-room entry cost');
  assert.equal(host.element('roomToolsTierMeta').textContent, 'Win +2 daily · 250 +1 daily', 'Room tools should preview private-room daily rewards');
  assert.equal(host.element('roomTierTier1').classList.contains('active'), true, 'Room tools should mark the selected tier');

  const potFirebase = createRealtimeDatabase();
  const potClient = createClient('PotPlayer', potFirebase, new Map());
  vm.runInContext(`
    setCreatorConfig('dailyRewardMode', 'pot');
    selectedTierId = 'tier3';
    writeDailyState({
      date: todayKey(),
      walletBr: 50,
      dailyProgress: 17,
      dailyPotEarnedBr: 4,
      dailyRewardClaimed: false,
      awardedGameIds: [],
      chargedEntryGameIds: [],
    });
    renderLobbyHome();
  `, potClient.context);
  const tierProgress = vm.runInContext(`TIER_IDS.map(id => dailyProgressRewardsFromConfig(creatorConfig, id))`, potClient.context);
  for (const reward of tierProgress) {
    assert.equal(reward.winProgress, 2, 'Every pot tier should grant +2 progress for a win');
    assert.equal(reward.goalProgress, 1, 'Every pot tier should grant +1 progress for reaching 250');
  }
  assert.equal(potClient.element('lobbyDailyFill').style.width, '85%', 'Growing pot should retain earned progress');
  assert.equal(potClient.element('lobbyDailyWinPreview').style.width, '10%', 'Every pot tier should preview the same +2 win progress');
  assert.equal(potClient.element('lobbyDailyGoalPreview').style.width, '5%', 'Every pot tier should preview the same +1 250 progress');
  assert.equal(potClient.element('lobbyDailyPotentialLabel').textContent, 'All tiers progress');
  assert.equal(potClient.element('lobbyDailyRewardLabel').textContent, 'Current pot');
  assert.equal(potClient.element('lobbyDailyReward').textContent, '9 BRs', 'Current pot should include the 5 BR base plus earned value');
  assert.equal(potClient.element('matchReward').textContent, '+18 BRs', 'Tier 3 should retain its instant win reward');
  assert.equal(potClient.element('matchPotRewardGroup').hidden, false, 'Growing pot should reveal the pot component');
  assert.equal(potClient.element('matchPotReward').textContent, '+10 BRs', 'Tier 3 should grow the pot faster');
  assert.equal(potClient.element('roomToolsTierMeta').textContent, 'Win +2 daily · 250 +1 daily', 'Private pot matches should use tier-independent progress');
  assert.equal(potClient.element('roomToolsTierReward').textContent, 'Winner +18 BRs now · +10 BRs to pot');

  const potAward = vm.runInContext(`
    state = freshState({
      ...creatorConfig,
      matchMode: 'matchmaking',
      matchTier: 'tier3',
      matchId: 'pot-test',
    });
    myRole = 'p1';
    awardDailyProgressForGameOver('p1', {
      winner: 'p1',
      reason: 'complete',
      stars: { p1: true, p2: false },
      metaId: 'pot-award-1',
      tier: 'tier3',
      matchMode: 'matchmaking',
    }, { p1: 260, p2: 180 });
  `, potClient.context);
  assert.equal(potAward.progressAwarded, 3, 'Tier 3 pot matches should award the same 2+1 progress as Tier 1');
  assert.equal(potAward.potAddedBr, 10, 'Tier 3 win should add 10 BRs to the pot');
  assert.equal(potAward.potBr, 19, 'Pot should include base and all accumulated contributions');
  assert.equal(potAward.dailyRewardBr, 19, 'Completing the goal should pay the full accumulated pot');
  assert.equal(potAward.brAwarded, 18, 'The instant Tier 3 reward should remain separate');
  assert.equal(potAward.walletBr, 87, 'Wallet should receive both 18 instant BRs and the 19 BR pot');
  const duplicatePotAward = vm.runInContext(`awardDailyProgressForGameOver('p1', {
    winner: 'p1', reason: 'complete', stars: { p1: true, p2: false }, metaId: 'pot-award-1', tier: 'tier3', matchMode: 'matchmaking'
  }, { p1: 260, p2: 180 })`, potClient.context);
  assert.equal(duplicatePotAward.duplicate, true, 'Pot rewards should remain idempotent');
  assert.equal(duplicatePotAward.walletBr, 87, 'A duplicate game-over event must not pay the pot twice');

  const privateFirebase = createRealtimeDatabase();
  const privateStorage = new Map();
  const privateHost = createClient('PrivateHost', privateFirebase, privateStorage);
  const privateGuest = createClient('PrivateGuest', privateFirebase, privateStorage);
  privateHost.context.writeDailyState({
    date: privateHost.context.todayKey(),
    walletBr: 40,
    dailyProgress: 0,
    dailyRewardClaimed: false,
    awardedGameIds: [],
    chargedEntryGameIds: [],
  });
  privateGuest.context.writeDailyState({
    date: privateGuest.context.todayKey(),
    walletBr: 30,
    dailyProgress: 0,
    dailyRewardClaimed: false,
    awardedGameIds: [],
    chargedEntryGameIds: [],
  });
  vm.runInContext(`selectedTierId = 'tier2'; renderLobbyHome();`, privateHost.context);
  await privateHost.context.createRoom();
  const privateCode = Object.keys(privateFirebase.data.lobbies || {})[0];
  assert.ok(privateCode, 'Creating a private room should publish a lobby listing');
  assert.equal(privateFirebase.data.lobbies[privateCode].mode, 'private', 'Private rooms should advertise a paid private mode');
  assert.equal(privateFirebase.data.lobbies[privateCode].tier, 'tier2', 'Private rooms should advertise the selected tier');
  assert.equal(privateFirebase.data.lobbies[privateCode].tierConfig.entryCostBr, 5, 'Private room listings should carry the selected tier cost');
  await privateGuest.context.joinRoomByCode(privateCode);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(privateHost.context.window.__enteredGame, true, 'Private room host should enter when the guest joins');
  assert.equal(privateGuest.context.window.__enteredGame, true, 'Private room guest should enter after joining');
  assert.equal(privateHost.context.playerWalletBr(), 35, 'Private room host should pay the selected tier entry');
  assert.equal(privateGuest.context.playerWalletBr(), 25, 'Private room guest should pay the selected tier entry');
  assert.equal(privateFirebase.data.analytics.brEconomyV1.sinks.match_entry, 10, 'Private room entry fees should be tracked as BR sinks');
  assert.equal(privateFirebase.data.rooms[privateCode].state.config.matchMode, 'private', 'Private room state should retain paid private mode');
  assert.equal(privateFirebase.data.rooms[privateCode].state.players.p1.bonusRolls, 35, 'Private host in-game wallet should match charged wallet');
  assert.equal(privateFirebase.data.rooms[privateCode].state.players.p2.bonusRolls, 25, 'Private guest in-game wallet should match charged wallet');

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
  assert.equal(firebase.data.analytics.brEconomyV1.sinks.match_entry, 4, 'Both player entry fees should be tracked as BR sinks');
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

  console.log(`matchmakingProtocol=ok room=${roomCode} hostWallet=66 guestWallet=28 animations=ok analytics=ok dailyPot=19 isolatedSessions=true`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
