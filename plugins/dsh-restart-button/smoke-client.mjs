/**
 * Local smoke test for dsh-restart-button's client half.
 *
 * The two things that would silently break this bundle are (a) the loader
 * handshake and (b) the sidebar-slot registration. It asserts both, then renders
 * the component through a stubbed React: no DOM, but every branch that touches an
 * undefined variable or calls a non-function still throws here.
 */

// --- 1. The loader handshake -------------------------------------------------
let registration = null;
let reloadCalls = 0;
globalThis.window = {
  __ModuleLoader__: { load(entry) { registration = entry; } },
  location: { reload() { reloadCalls += 1; } },
  addEventListener() {},
  removeEventListener() {},
};

// 相对本文件解析，而不是写死绝对路径：这个包已经挪过一次位置（进的 dsh-extras/plugins），
// 再挪一次不该让冒烟测试失效。
await import(new URL('./lib/client.js', import.meta.url).href);

if (registration === null) throw new Error('FAIL: bundle did not register itself with __ModuleLoader__');
if (registration.id !== 'dsh-restart-button') throw new Error('FAIL: unexpected loader id ' + registration.id);
console.log('loader id:', registration.id);

// --- 2. The module face, through a stubbed React -----------------------------
/** Element tree nodes produced by the stub, so we can inspect what was built. */
const created = [];
const defaultUseState = (initial) => [typeof initial === 'function' ? initial() : initial, () => {}];
const reactStub = {
  createElement(type, props, ...children) {
    const node = {
      type,
      props: props === null || props === undefined ? {} : props,
      children: children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false && c !== true),
    };
    created.push(node);
    return node;
  },
  useState: defaultUseState,
  useEffect() {},
  useCallback(fn) { return fn; },
  useRef(value) { return { current: value }; },
};

const mod = registration.factory((specifier) => {
  if (specifier === 'react') return reactStub;
  throw new Error('FAIL: unexpected external request ' + specifier);
});

if (typeof mod.apply !== 'function') throw new Error('FAIL: module exports no apply()');
if (!Array.isArray(mod.inject) || !mod.inject.includes('slots')) {
  throw new Error('FAIL: module inject must require slots, got ' + JSON.stringify(mod.inject));
}
console.log('inject:', JSON.stringify(mod.inject));

// --- 3. The sidebar-slot registration ----------------------------------------
const registrations = [];
const injections = [];
const ctx = {
  effect(callback) { callback(); },
  slots: {
    inject(slot, register) { injections.push(slot); register(); },
    register(options, component) { registrations.push({ options, component }); return () => {}; },
  },
  on() { return () => {}; },
};

mod.apply(ctx);

console.log('injected slots:', JSON.stringify(injections));
if (injections.length !== 1) throw new Error('FAIL: expected exactly one slot injection, got ' + JSON.stringify(injections));
if (injections[0] !== 'sidebar.footer.action') {
  throw new Error('FAIL: expected sidebar.footer.action, got ' + injections[0]);
}

const entry = registrations[0];
if (entry === undefined) throw new Error('FAIL: no slot registration happened');
const { options, component } = entry;
console.log('registration:', JSON.stringify({
  name: options.name, id: options.id, order: options.order, label: options.label(),
}));
if (options.name !== 'sidebar.footer.action') throw new Error('FAIL: wrong slot name');
if (typeof options.id !== 'string' || options.id === '') throw new Error('FAIL: action needs an id');
if (typeof options.label !== 'function') throw new Error('FAIL: label must be a function');
if (typeof options.label() !== 'string' || options.label() === '') throw new Error('FAIL: label resolves empty');
if (typeof component !== 'function') throw new Error('FAIL: action component missing');

// --- 4. Render every branch --------------------------------------------------
/** Collect visible strings and button labels from a rendered tree. */
function describe(tree) {
  const text = [];
  const walk = (node) => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string' || typeof node === 'number') { text.push(String(node)); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node !== 'object') return;
    node.children.forEach(walk);
  };
  walk(tree);
  const buttons = created
    .filter(n => n.type === 'button')
    .map(n => n.children.filter(c => typeof c === 'string' || typeof c === 'number').join(''));
  return { text: text.join(' '), buttons, buttonNodes: created.filter(n => n.type === 'button') };
}

/**
 * Render with the component hook states forced, in declaration order:
 * status, phase, detail.
 */
function renderWith(label, props, states) {
  let index = 0;
  reactStub.useState = (initial) => [
    index < states.length ? states[index++] : (typeof initial === 'function' ? initial() : initial),
    () => {},
  ];
  created.length = 0;
  try {
    const tree = component(props);
    const described = describe(tree);
    console.log('render(' + label + ') buttons: ' + JSON.stringify(described.buttons));
    return described;
  } finally {
    reactStub.useState = defaultUseState;
  }
}

const RESTART = '重启';
const liveStatus = {
  ok: true, pid: 8341, port: 3080, available: true, reason: null,
  channel: 'dsh-market', bootId: '8341-1', marketVersion: '1.46.1',
};

// Closed, expanded column: one labelled button, no panel.
const closedWide = renderWith('closed/wide', { wide: true }, [null, '', '']);
if (closedWide.buttons.length !== 1) throw new Error('FAIL: expected exactly one button, got ' + JSON.stringify(closedWide.buttons));
if (!closedWide.text.includes(RESTART)) throw new Error('FAIL: the expanded button must carry a visible label');

// Closed, collapsed rail: same single button, no visible label (the accessible
// name carries it instead).
const closedRail = renderWith('closed/rail', { wide: false }, [null, '', '']);
if (closedRail.buttons.length !== 1) throw new Error('FAIL: rail must still render exactly one button');
if (closedRail.text.includes(RESTART)) throw new Error('FAIL: the rail must not render the text label');
if (typeof closedRail.buttonNodes[0].props['aria-label'] !== 'string') {
  throw new Error('FAIL: the rail button needs an accessible name');
}

// Checking: the panel opens and says what it is doing.
const checking = renderWith('checking', { wide: true }, [null, 'checking', '']);
if (!checking.text.includes('正在检测本机重启通道')) throw new Error('FAIL: the checking state must explain itself');

// Confirm: the destructive warning and the confirm action appear.
const confirm = renderWith('confirm', { wide: true }, [liveStatus, 'confirm', '']);
if (!confirm.buttons.includes('确认重启')) throw new Error('FAIL: unexpected buttons ' + JSON.stringify(confirm.buttons));
if (!confirm.buttons.includes('取消')) throw new Error('FAIL: a cancel path must exist');
if (!confirm.text.includes('正在进行的对话轮次')) throw new Error('FAIL: the confirm state must warn about termination');

// Unavailable channel: the reason replaces the confirm action, and there is no
// way to fire a restart that can only fail.
const off = renderWith('unavailable', { wide: true }, [
  { ...liveStatus, available: false, reason: 'self-restart is disabled for this host' }, 'confirm',
  '本机没有可用的重启通道：self-restart is disabled for this host',
]);
if (off.buttons.some(b => b.includes('确认重启'))) throw new Error('FAIL: the confirm action must not exist while unavailable');
if (!off.buttons.some(b => b.includes('重新检测'))) throw new Error('FAIL: an unavailable channel should offer a re-check');

// Restarting: progress, and no cancel (the process is already going down).
const restarting = renderWith('restarting', { wide: true }, [liveStatus, 'restarting', '已排定重启']);
if (!restarting.text.includes('已排定重启')) throw new Error('FAIL: the in-flight state must show progress');
if (restarting.buttons.some(b => b.includes('取消'))) throw new Error('FAIL: cancel must not be offered mid-restart');

// Timed out: manual recovery advice.
const timedOut = renderWith('timed-out', { wide: true }, [liveStatus, 'timed-out', '']);
if (!timedOut.text.includes('等待新进程超时')) throw new Error('FAIL: the timeout state must give recovery advice');

console.log('PASS: loader handshake, slot registration and every render branch are valid');
