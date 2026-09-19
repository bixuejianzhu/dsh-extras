/**
 * 选项卡显示图片插件 —— Host（服务端）半边。
 *
 * 复刻 @deepseek-ai/dsh-tool-ask-user 的 `ask_user_question` 工具，只差一处：
 * 把问题的 `detail` 字段转发给 UI。
 *
 * 上游实现把它丢在 execute() 的字段映射里（只转发 id / question / header /
 * options / multi_select），而 UI 侧 QuestionComposer 本来就会用 MarkdownText
 * 渲染 `question.detail` —— 于是 `![图](url)` 这类 markdown 图片永远显示不出来。
 * 这里补上转发；工具名、模型可见的描述、参数 schema、输出 schema 与上游逐字一致，
 * 所以模型看到的工具没有任何变化，客户端也仍然按工具名 ask_user_question 渲染。
 *
 * 挂载方式：由 agent preset 的 `tool-ask-user` 行指向本文件（preset 行的 name
 * 支持相对 preset 目录的路径，见 @deepseek-ai/dsh-agent-presets/specifier）。
 * 因此本插件运行在 **agent 作用域**，与上游工具同层 —— 工具注册表拒绝同名全局注册，
 * 所以「替换」只能在 preset 这一层做，而不是在 profile 层再注册一个同名工具。
 *
 * 生成/刷新 preset 请运行 dsh-extras/scripts/install-preset.ps1。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';

/** Cordis 插件名。 */
export const name = 'dsh-ask-detail';

/** 与上游同层的注入：工具注册表 + 提问能力 seam。 */
export const inject = ['tools', 'userQuestions'];

/** 模型可见的工具描述，与上游逐字一致。 */
const description = 'Ask the user a concise question when you need confirmation, a choice, or missing information before proceeding. Send one or more questions, each with a stable id that will be echoed in the answer.';

/**
 * 注册工具。与上游 dsh-tool-ask-user 的唯一差异是 execute() 里多转发一个 detail。
 * @param ctx - agent 作用域上下文。
 */
export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'ask_user_question',
    description,
    parameters: {
      questions: {
        type: 'array',
        required: true,
        description: 'Questions to ask the user before continuing.',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: {
              type: 'string',
              required: true,
              description: 'Stable id for this question; echoed in the answer.',
            },
            question: {
              type: 'string',
              required: true,
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
                    required: true,
                    description: 'Short user-facing option label.',
                  },
                  description: {
                    type: 'string',
                    description: 'One sentence explaining the tradeoff or impact.',
                  },
                },
              },
            },
            multi_select: {
              type: 'boolean',
              description: 'Whether the user may select more than one option. Defaults to false.',
            },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          answers: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: {
                  type: 'string',
                  required: true,
                },
                selected: {
                  type: 'array',
                  required: true,
                  items: { type: 'string' },
                },
                custom: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: JSON.stringify(value),
      }],
    },
    /**
     * 把参数整形成 seam 认识的形状。上游在这里漏掉 detail，本插件补上。
     * @param args - 模型给出的参数。
     * @param exec - 执行上下文（signal / agent）。
     * @returns 工具结果。
     */
    async execute(args, exec) {
      const questions = args.questions.map((question) => ({
        id: question.id,
        question: question.question,
        ...question.header !== undefined ? { header: question.header } : {},
        ...question.options !== undefined ? { options: question.options } : {},
        ...question.detail !== undefined ? { detail: question.detail } : {},
        ...question.multi_select !== undefined ? { multiSelect: question.multi_select } : {},
      }));
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
    },
  }));
}
