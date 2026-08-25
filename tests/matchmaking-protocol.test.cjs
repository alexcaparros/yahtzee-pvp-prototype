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

function createClient(label, firebase) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, new MockElement(id));
    return elements.get(id);
  };
  const lobby = element('lobby');
  const storage = new Map([['yahtzee_name_custom', label]]);
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
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  const context = vm.createContext({
    window,
    document,
    localStorage,
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
  vm.runInContext(`
    enterGame = function enterGameForProtocolTest() {
      matchmakingQueued = false;
      document.getElementById('lobby').classList.add('hidden');
      window.__enteredGame = true;
      if (myRole === 'p1') setTimeout(() => persistState(), 0);
    };
  `, context);
  return { context, lobby };
}

async function run() {
  const firebase = createRealtimeDatabase();
  const host = createClient('Host', firebase);
  const guest = createClient('Guest', firebase);

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

  console.log(`matchmakingProtocol=ok room=${roomCode} hostEntered=true guestEntered=true`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
