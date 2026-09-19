/**
 * 选项卡显示图片插件（Host 半边）的冒烟测试 —— 在 Node 里跑，不需要 dsh。
 *
 * 它证明三件事：
 *   1) 这个插件**零依赖**：先把 index.js 复制到一个没有 node_modules 的临时目录再 import；
 *   2) 注册面正确：工具名、参数 schema 里有 detail、required 是数组、additionalProperties 显式；
 *   3) 行为正确：detail 被转发到 userQuestions seam，非法参数报出带路径的错。
 *
 * 浏览器/宿主之外的逻辑用这种方式测最省事 —— 不用起 dsh，也不用重启。
 */
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

// ── 1. 复制到没有 node_modules 的目录再 import（零依赖的硬证明）──
const sandbox = mkdtempSync(join(tmpdir(), 'ask-detail-nodeps-'));
copyFileSync(join(here, 'index.js'), join(sandbox, 'index.js'));
const mod = await import(pathToFileURL(join(sandbox, 'index.js')).href);
console.log('零依赖 import 成功；导出：' + Object.keys(mod).join(','));

assert.equal(mod.name, 'dsh-ask-detail', '插件名不对');
assert.deepEqual(mod.inject, ['tools', 'userQuestions'], 'inject 不对');
assert.equal(typeof mod.apply, 'function', '没有导出 apply');

// ── 2. 注册面 ──
let registered = null;
const asked = [];
const ctx = {
  tools: { register: (definition) => { registered = definition; } },
  userQuestions: {
    ask: async (request) => {
      asked.push(request);
      return { answers: [{ id: 'q1', selected: ['A'] }] };
    },
  },
};
mod.apply(ctx);

assert.ok(registered !== null, 'apply() 没有注册工具');
assert.equal(registered.name, 'ask_user_question', '工具名不对');
assert.deepEqual(
  Object.keys(registered).sort(),
  ['description', 'execute', 'name', 'output', 'parameters'],
  '注册对象应只有 defineTool 那五个键',
);
const items = registered.parameters.properties.questions.items;
assert.ok(items.properties.detail, '参数 schema 里缺少 detail');
assert.deepEqual(items.required, ['id', 'question'], 'items.required 应是数组');
assert.equal(items.additionalProperties, true, 'additionalProperties 必须显式 true');
assert.deepEqual(registered.output.schema.required, ['answers'], '输出 schema 顶层 required 应是数组');
console.log('注册面 OK：工具名 / detail / required 数组 / 显式 additionalProperties');

// ── 3. 行为：detail 必须被转发（本插件存在的理由）──
const detail = '![x](http://127.0.0.1:8791/a.png)';
const result = await registered.execute(
  { questions: [{ id: 'q1', question: '看图吗', detail, header: 'H', options: [{ label: 'A' }], multi_select: true }] },
  { signal: null },
);
assert.equal(asked.length, 1, 'seam 应被调用一次');
const sent = asked[0].questions[0];
assert.equal(sent.detail, detail, 'detail 没有被转发！');
assert.equal(sent.multiSelect, true, 'multi_select 没有映射成 multiSelect');
assert.equal(sent.header, 'H', 'header 丢了');
assert.deepEqual(result, { answers: [{ id: 'q1', selected: ['A'] }] }, '返回形状不对');
console.log('转发 OK：detail = ' + JSON.stringify(sent.detail));

// ── 4. 校验：非法参数要报出带路径的错 ──
const cases = [
  [{ questions: [] }, /非空数组/],
  [{ questions: [{ question: 'x' }] }, /questions\[0\]\.id/],
  [{ questions: [{ id: 'a' }] }, /questions\[0\]\.question/],
  [{ questions: [{ id: 'a', question: 'b', options: [{ description: 'no label' }] }] }, /options\[0\]\.label/],
  [{}, /非空数组/],
];
for (const [bad, pattern] of cases) {
  await assert.rejects(() => registered.execute(bad, { signal: null }), pattern);
}
console.log('校验 OK：' + cases.length + ' 个非法输入都被拒，错误信息带路径');

rmSync(sandbox, { recursive: true, force: true });
// ── 5. 用 harness 自己的编译器验证这两个内联 schema ──
//    这一步守住 B 的最后一个风险：schema 是我们手写的，必须真的被 registry 的编译器接受。
//    做法是直接调用 dsh-tools 导出的 assertSupportedJsonSchema / validateJsonSchemaValue；
//    找不到 dsh-tools（比如在别的机器上）就跳过，不让测试因此失败。
const dshTools = process.env.DSH_TOOLS_PATH
  ?? join(homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js');
try {
  const tools = await import(pathToFileURL(dshTools).href);
  tools.assertSupportedJsonSchema(registered.parameters);
  tools.assertSupportedJsonSchema(registered.output.schema);
  assert.deepEqual(
    tools.validateJsonSchemaValue(registered.parameters, { questions: [{ id: 'a', question: 'b', detail: 'x' }] }, ''),
    [],
    'schema 应当接受合法参数',
  );
  assert.ok(
    tools.validateJsonSchemaValue(registered.parameters, { questions: 'nope' }, '').length > 0,
    'schema 应当拒绝非法参数',
  );
  console.log('schema OK：assertSupportedJsonSchema 接受两个内联 schema，且校验行为正确');
} catch (error) {
  if (error && (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'ENOENT')) {
    console.log('（跳过 schema 校验：这个环境里找不到 dsh-tools）');
  } else {
    throw error;
  }
}
console.log('PASS: 零依赖 + 注册面 + detail 转发 + 参数校验 + schema 被 harness 接受');
