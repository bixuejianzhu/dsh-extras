# 选项卡显示图片插件（dsh-ask-detail）

让 `ask_user_question` 的 `detail` 字段真正送达提问卡片 —— 于是 `![图](url)` 这类 markdown
图片能显示出来。

## 它修的是什么

上游 `@deepseek-ai/dsh-tool-ask-user` 的 `execute()` 在把参数转给 seam 时只映射了
`id / question / header / options / multi_select`，**`detail` 被静默丢掉**：

```js
questions: args.questions.map((question) => ({
    id: question.id,
    question: question.question,
    ...question.header  !== void 0 ? { header: question.header } : {},
    ...question.options !== void 0 ? { options: question.options } : {},
    ...question.multi_select !== void 0 ? { multiSelect: question.multi_select } : {}
}))
```

而 UI 侧本来就是支持它的 —— `dsh-client-ui-user-questions` 的 `QuestionComposer` 用
`MarkdownText` 渲染 `question.detail`，`dsh-user-questions` 的类型里也有这个字段。
所以这是纯粹的字段丢失，不是缺功能。

本插件在与上游**同层**（agent 作用域）注册同名工具 `ask_user_question`，只多转发一个
`detail`。工具名、模型可见描述、参数 schema、输出 schema 与上游逐字一致，客户端仍按
工具名渲染，模型端没有任何可感知的变化。

## 为什么必须挂在 agent preset 这一层

- 工具注册表 `ToolLayer` 对同名注册直接抛错（`tool "x" is already registered`），
  **不能在 profile 层再注册一个同名工具**去覆盖。
- `tools/pre-execute` waterfall 只能 allow / deny / ask，不能替换执行结果，堵不上这个洞。
- 上游把这一行放在 **agent preset** 里：`dsh-agent-presets/presets/standard/agent.cordis.yml`
  的 `- id: tool-ask-user` 行。所以「换实现」只能在 preset 这一层改行。

`../scripts/install.ps1` 会把该 preset 复制到 `$DSH_HOME/.agent-presets/standard-extras`，
并把那一行的 `name` 指向本文件。

## 为什么 preset 里有个 node_modules

本插件 `import { defineTool } from '@deepseek-ai/dsh-tools'` —— `defineTool` 负责把简写
参数 schema 转成 JSON Schema 并包上参数校验，不能自己糊一个。而 preset 目录在用户 home
下，Node 向上找 `node_modules` 永远到不了 harness 的依赖，所以安装脚本在 preset 目录里
建了一个指回当前安装的 junction：

```
standard-extras/node_modules/@deepseek-ai/dsh-tools -> <当前安装>/dsh-tools
```

升级换了安装目录后，重跑 `install.ps1` 刷新它即可。

## 已实测：卡片能显示图片，但只认 http(s)

触发方式：在装了 `standard-extras` preset 的**新会话**里说「弹测试卡」，让 agent 用
`ask_user_question` 的 `detail` 塞 markdown 图片，然后看卡片。

同一张图、三种源的观察结果：

| `detail` 里的写法 | 结果 |
| --- | --- |
| `![x](http://127.0.0.1:8791/_tmp_h1.png)`（本机静态服务） | 显示 |
| `![x](https://www.python.org/static/img/python-logo.png)` | 显示 |
| `![x](file:///<你的工作区>/_tmp_h1.png)` | **不显示** |

所以：`detail` 转发确实生效（否则三张都不会有），图片渲染也正常；限制在**图源必须是
http(s) URL** —— 裸绝对路径和 `file://` 都取不到，本地图片得先起个静态服务
（工作区根目录的 `serve.mjs` 就够：`node serve.mjs 8791`）。
产品图那条链路（`<API 根地址>/image?job=...`）能成立的也正是这一点。

## 回滚

把 agent preset 换回随包的 `standard`（GUI 模式选择里选，或把 `settings.yaml` 里的
`agent-presets.default` 改成 `standard`），再删掉 `$DSH_HOME/.agent-presets/standard-extras`。
上游若修好这个字段，本插件可以直接弃用。
