/**
 * 选项卡显示图片插件 —— Host（服务端）半边。
 *
 * 复刻 @deepseek-ai/dsh-tool-ask-user 的 `ask_user_question` 工具，只差一处：
 * 把问题的 `detail` 字段转发给 UI。
 *
 * 上游实现把它丢在 execute() 的字段映射里（只转发 id / question / header / options /
 * multi_select），而 UI 侧 QuestionComposer 本来就会用 MarkdownText 渲染
 * `question.detail` —— 于是 `![图](url)` 这类 markdown 图片永远显示不出来。
 * 这里补上转发；工具名、模型可见的描述、参数 schema、输出 schema 都与上游一致，
 * 因此模型看到的工具没有变化，客户端也仍然按工具名 ask_user_question 渲染。
 *
 * ── 本文件刻意不 import 任何东西 ──────────────────────────────────────────────
 * 上游用 `defineTool` 只做两件事：(1) 把简写参数 schema 转成 JSON Schema，
 * (2) 给 execute 包一层参数校验。第一件事的结果已由 defineTool **实测导出、逐字内联**
 * 在下面的 `parameters` / `outputSchema` 里；第二件事改由 execute 内部的显式检查承担。
 *
 * 好处：这个插件在 preset 里**不需要 node_modules**，于是「dsh 升级换了 node 版本槽 →
 * preset 里指向安装路径的那个 junction 断裂 → 插件 import 失败」这一类故障直接不存在。
 *
 * ⚠️ 改动这两个 schema 前，请用 defineTool 复算一次再贴回来，不要手改。
 *   注意转换后的形态：`required` 是数组，且 `additionalProperties` 必须显式写出
 *   true/false —— harness 的 schema 编译器很严格，缺了会直接抛 UNSUPPORTED_SCHEMA。
 *
 * ── 挂载方式 ─────────────────────────────────────────────────────────────────
 * 由 agent preset 的 `tool-ask-user` 行指向本文件（相对 preset 目录的路径，见
 * @deepseek-ai/dsh-agent-presets/specifier）。因此它运行在 **agent 作用域**，与上游
 * 工具同层 —— 工具注册表拒绝同名全局注册，「换实现」只能在 preset 这一层做。
 *
 * 生成/刷新 preset 请运行 dsh-extras/scripts/install.ps1。
 */

/** Cordis 插件名。 */
export const name = 'dsh-ask-detail';

/** 与上游同层的注入：工具注册表 + 提问能力 seam。 */
export const inject = ['tools', 'userQuestions'];

/** 模型可见的工具描述，与上游逐字一致。 */
const description = 'Ask the user a concise question when you need confirmation, a choice, or missing information before proceeding. Send one or more questions, each with a stable id that will be echoed in the answer.';

/** 参数 schema —— `defineTool(spec).parameters` 的输出，逐字内联（含 description）。 */
const parameters = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      description: 'Questions to ask the user before continuing.',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          id: {
            type: 'string',
            description: 'Stable id for this question; echoed in the answer.',
          },
          question: {
            type: 'string',
            description: 'The specific question to ask the user.',
          },
          header: {
            type: 'string',
            description: 'Optional short heading for the question, such as "Confirm" or "Choose Mode".',
          },
          // ── 本插件存在的全部理由：上游 schema 里没有这一项 ──
          detail: {
            type: 'string',
            description: 'Optional markdown shown under the question title (images and links render). Use it to attach context the options alone cannot carry.',
          },
          options: {
            type: 'array',
            description: 'Optional choices to show the user. If you recommend one, put it first and append " (Recommended)" to that label.',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                label: {
                  type: 'string',
                  description: 'Short user-facing option label.',
                },
                description: {
                  type: 'string',
                  description: 'One sentence explaining the tradeoff or impact.',
                },
              },
              required: ['label'],
            },
          },
          multi_select: {
            type: 'boolean',
            description: 'Whether the user may select more than one option. Defaults to false.',
          },
        },
        required: ['id', 'question'],
      },
    },
  },
  required: ['questions'],
};

/** 输出 schema —— `defineTool(spec).output.schema` 的输出，逐字内联。 */
const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          selected: { type: 'array', items: { type: 'string' } },
          custom: { type: 'string' },
        },
        required: ['id', 'selected'],
      },
    },
  },
  required: ['answers'],
};

/**
 * 把参数整形成 seam 认识的形状。上游在这里漏掉 detail，本插件补上；
 * 同时把上游 defineTool 那层参数校验接手过来（显式检查，报错带路径）。
 * @param ctx - 插件上下文（拿 userQuestions seam）。
 * @param args - 模型给出的参数。
 * @param exec - 执行上下文（signal / agent）。
 * @returns 工具结果。
 */
async function executeAsk(ctx, args, exec) {
  const raw = args !== null && typeof args === 'object' ? args.questions : undefined;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('ask_user_question: "questions" 必须是非空数组');
  }

  const questions = raw.map((question, index) => {
    const where = `questions[${index}]`;
    if (question === null || typeof question !== 'object') {
      throw new Error(`ask_user_question: ${where} 必须是对象`);
    }
    if (typeof question.id !== 'string' || question.id === '') {
      throw new Error(`ask_user_question: ${where}.id 必须是非空字符串`);
    }
    if (typeof question.question !== 'string' || question.question === '') {
      throw new Error(`ask_user_question: ${where}.question 必须是非空字符串`);
    }
    if (question.options !== undefined) {
      if (!Array.isArray(question.options)) {
        throw new Error(`ask_user_question: ${where}.options 必须是数组`);
      }
      question.options.forEach((option, optionIndex) => {
        if (option === null || typeof option !== 'object' || typeof option.label !== 'string' || option.label === '') {
          throw new Error(`ask_user_question: ${where}.options[${optionIndex}].label 必须是非空字符串`);
        }
      });
    }
    return {
      id: question.id,
      question: question.question,
      ...question.header !== undefined ? { header: question.header } : {},
      ...question.options !== undefined ? { options: question.options } : {},
      ...question.detail !== undefined ? { detail: question.detail } : {},
      ...question.multi_select !== undefined ? { multiSelect: question.multi_select } : {},
    };
  });

  const result = await ctx.userQuestions.ask({
    questions,
    ...exec.agent !== undefined ? { agent: exec.agent } : {},
    signal: exec.signal,
  });

  return {
    answers: result.answers.map((answer) => ({
      id: answer.id,
      selected: [...answer.selected],
      ...answer.custom !== undefined ? { custom: answer.custom } : {},
    })),
  };
}

/**
 * 注册工具。与上游 dsh-tool-ask-user 的唯一行为差异是 execute() 里多转发一个 detail。
 * @param ctx - agent 作用域上下文。
 */
export function apply(ctx) {
  ctx.tools.register({
    name: 'ask_user_question',
    description,
    parameters,
    output: {
      schema: outputSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: (args, exec) => executeAsk(ctx, args, exec),
  });
}
