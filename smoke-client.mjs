/**
 * dsh-extras 客户端 bundle 的冒烟测试（Node 里跑，不需要浏览器）。
 *
 * 手写的 loader bundle 在浏览器里不好调试，所以照 dsh-restart-button 那套做法：
 * 用桩顶掉 window.__ModuleLoader__ 与 react，把 bundle 求值一遍，然后
 *   (a) 断言注册面：注册到 settings.section、label 是「通用插件设置」、order 正确
 *   (b) 逐段强制 useState 序列，把每一段状态机的每个分支都渲染一遍
 *       —— 任何碰到未定义变量或调用非函数的地方都会在这里抛出来
 */
import assert from 'node:assert/strict';

// --- 1. 桩：loader 收下注册 ---------------------------------------------------
let registration = null;
let reloadCalls = 0;
globalThis.window = {
  __ModuleLoader__: { load(entry) { registration = entry; } },
  location: { reload() { reloadCalls += 1; } },
};

await import(new URL('./lib/client.js', import.meta.url).href);

assert.ok(registration !== null, 'FAIL: bundle 没有向 __ModuleLoader__ 注册自己');
assert.equal(registration.id, 'dsh-extras', 'FAIL: loader id 不对');
console.log('loader id:', registration.id);

// --- 2. 桩：react ------------------------------------------------------------
const created = [];
const defaultUseState = (initial) => [typeof initial === 'function' ? initial() : initial, () => {}];
const reactStub = {
  createElement(type, props, ...children) {
    const node = {
      type,
      props: props === null || props === undefined ? {} : props,
      children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true),
    };
    created.push(node);
    return node;
  },
  useState: defaultUseState,
  useEffect() {},
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
};

const mod = registration.factory(() => reactStub);
assert.equal(typeof mod.apply, 'function', 'FAIL: 模块没有导出 apply()');
assert.ok(Array.isArray(mod.inject) && mod.inject.includes('slots'), 'FAIL: inject 必须包含 slots');
console.log('inject:', JSON.stringify(mod.inject));

// --- 3. 注册面：settings.section + 目录名 ------------------------------------
const registrations = [];
const injections = [];
const ctx = {
  effect(callback) { callback(); },
  slots: {
    inject(slot, register) { injections.push(slot); register(); },
    register(options, component) { registrations.push({ options, component }); return () => {}; },
  },
};
mod.apply(ctx);

assert.equal(injections.length, 1, 'FAIL: 应该只注入一个槽位');
assert.equal(injections[0], 'settings.section', 'FAIL: 槽位应是 settings.section');
const entry = registrations[0];
assert.ok(entry !== undefined, 'FAIL: 没有发生注册');
assert.equal(entry.options.name, 'settings.section', 'FAIL: 注册名不对');
assert.equal(entry.options.label(), '通用插件设置', 'FAIL: 目录名不对');
assert.equal(typeof entry.options.order, 'number', 'FAIL: order 应为数字');
console.log('注册:', JSON.stringify({ id: entry.options.id, label: entry.options.label(), order: entry.options.order }));

// --- 4. 渲染工具 -------------------------------------------------------------
/** 从渲染树里取可见文本与按钮文案。
 *
 * 注意：这个桩不会真的调用函数组件（真 React 会），所以 `h(Block, {...})` 在桩里
 * 只是一个 type 为函数的节点。因此除了 node.children，还要看我们自己的可见 props
 * （heading / blurb / children）—— 但**不能**盲walk 全部 props，那会把 style 里的
 * 颜色字符串也算成可见文本。
 */
function describe(tree) {
  const text = [];
  const walk = (node) => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string' || typeof node === 'number') { text.push(String(node)); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node !== 'object') return;
    // 函数组件：照 React 的做法调用它，再看它返回的树（桩里否则会看进不去）。
    if (typeof node.type === 'function') { walk(node.type(node.props ?? {})); return; }
    node.children.forEach(walk);
    const p = node.props;
    if (p !== null && typeof p === 'object') {
      if (p.heading !== undefined) walk(p.heading);
      if (typeof p.blurb === 'string') walk(p.blurb);
      if (p.children !== undefined && p.children !== node.children) walk(p.children);
    }
  };
  walk(tree);
  const buttons = created
    .filter((n) => n.type === 'button')
    .map((n) => n.children.filter((c) => typeof c === 'string').join(''));
  return { text: text.join(' '), buttons };
}

/**
 * 强制 useState 的返回值序列后渲染一次。
 * @param label - 打印用的分支名。
 * @param component - 要渲染的组件。
 * @param states - 按声明顺序给出的状态值。
 */
function renderWith(label, component, states) {
  let index = 0;
  reactStub.useState = (initial) => [
    index < states.length ? states[index++] : (typeof initial === 'function' ? initial() : initial),
    () => {},
  ];
  created.length = 0;
  try {
    const described = describe(component({}));
    console.log(`render(${label}) buttons: ${JSON.stringify(described.buttons)}`);
    return described;
  } finally {
    reactStub.useState = defaultUseState;
  }
}

// --- 5. 页面本体：三段都要在 -------------------------------------------------
const page = renderWith('section', mod.ExtrasSection, []);
assert.ok(page.text.includes('通用插件设置'), 'FAIL: 页面标题缺失');
assert.ok(page.text.includes('重启 DSH'), 'FAIL: 缺第一段（重启）');
assert.ok(page.text.includes('关闭 DSH'), 'FAIL: 缺第二段（关机）');
assert.ok(!page.text.includes('安装 / 刷新接线'), 'FAIL: 一键安装那一段应当已被移除');

// --- 6. 第一段：重启 ---------------------------------------------------------
const restartOk = { ok: true, available: true, reason: null, bootId: '1-1' };
let r = renderWith('restart/checking', mod.RestartBlock, ['checking', null, '', 0]);
assert.ok(r.text.includes('正在检测本机重启通道'), 'FAIL: checking 态应说明在做什么');

r = renderWith('restart/unavailable', mod.RestartBlock, ['idle', { ok: true, available: false, reason: 'self-restart is disabled' }, '', 0]);
assert.ok(r.text.includes('本机没有可用的重启通道'), 'FAIL: 不可用时应直说');
assert.ok(r.text.includes('self-restart is disabled'), 'FAIL: 应带上原因');
assert.ok(r.buttons.includes('重新检测'), 'FAIL: 不可用时应给重新检测');

r = renderWith('restart/idle', mod.RestartBlock, ['idle', restartOk, '', 0]);
assert.ok(r.buttons.includes('重启 DSH'), 'FAIL: 可用时应给重启按钮');

r = renderWith('restart/confirm', mod.RestartBlock, ['confirm', restartOk, '', 0]);
assert.ok(r.buttons.includes('确认重启'), 'FAIL: 确认态缺确认按钮');
assert.ok(r.buttons.includes('取消'), 'FAIL: 确认态缺取消');

r = renderWith('restart/restarting', mod.RestartBlock, ['restarting', restartOk, '已发送重启请求', 0]);
assert.ok(r.buttons.includes('正在重启…'), 'FAIL: 进行中应禁用按钮');
assert.ok(!r.buttons.includes('取消'), 'FAIL: 重启进行中不应还提供取消');

r = renderWith('restart/timed-out', mod.RestartBlock, ['timed-out', restartOk, '等待新进程超时。', 0]);
assert.ok(r.text.includes('等待新进程超时'), 'FAIL: 超时应给出手动恢复提示');

r = renderWith('restart/error', mod.RestartBlock, ['error', restartOk, 'boom', 0]);
assert.ok(r.text.includes('重启失败：boom'), 'FAIL: 错误态应显示原因');

// --- 7. 第二段：关机 ---------------------------------------------------------
const shutdownOk = { ok: true, canShutdown: true, reason: null };
r = renderWith('shutdown/checking', mod.ShutdownBlock, ['checking', null, '', 0]);
assert.ok(r.text.includes('正在检测本机是否支持关机'), 'FAIL: checking 态应说明在做什么');

r = renderWith('shutdown/unavailable', mod.ShutdownBlock, ['idle', { ok: true, canShutdown: false, reason: '这个宿主没有提供 ctx.appExit' }, '', 0]);
assert.ok(r.text.includes('本机无法关机'), 'FAIL: 不可用时应直说');
assert.ok(r.text.includes('ctx.appExit'), 'FAIL: 应带上原因');

r = renderWith('shutdown/idle', mod.ShutdownBlock, ['idle', shutdownOk, '', 0]);
assert.ok(r.buttons.includes('关闭 DSH 进程'), 'FAIL: 可用时应给关机按钮');

r = renderWith('shutdown/confirm', mod.ShutdownBlock, ['confirm', shutdownOk, '', 0]);
assert.ok(r.buttons.includes('确认关机'), 'FAIL: 确认态缺确认按钮');
assert.ok(r.buttons.includes('取消'), 'FAIL: 确认态缺取消');

r = renderWith('shutdown/closing', mod.ShutdownBlock, ['closing', shutdownOk, 'DSH 正在退出', 0]);
assert.ok(r.buttons.includes('正在关机…'), 'FAIL: 进行中应显示进度');

r = renderWith('shutdown/error', mod.ShutdownBlock, ['error', shutdownOk, '跨站请求被拒绝', 0]);
assert.ok(r.text.includes('关机失败：跨站请求被拒绝'), 'FAIL: 错误态应显示原因');

// 重启后的自动刷新路径：window.location.reload 必须存在且可调用
assert.equal(reloadCalls, 0, 'FAIL: 渲染阶段不应触发页面刷新');
assert.equal(typeof globalThis.window.location.reload, 'function', 'FAIL: 需要 location.reload 才能在新进程接管后自动刷新');

console.log('PASS: 注册面、两段状态机的每个分支、以及页面标题与两个入口都成立');
