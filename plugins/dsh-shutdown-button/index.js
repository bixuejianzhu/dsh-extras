/**
 * dsh-shutdown-button —— Host（服务端）半边。
 *
 * 只做一件事：注册两条本机 HTTP 路由，供设置里的「关机」页使用。
 *
 *   GET  /dsh-shutdown-button/api/status    报告本机能否关机（附带 pid / 端口）
 *   POST /dsh-shutdown-button/api/shutdown  优雅关闭当前 DSH 进程
 *
 * 关机方式不是杀进程，而是调用 dsh 启动器 provide 在根上下文上的 `appExit(0)`
 * （见 @deepseek-ai/dsh-cmdline 的 provideCmdline）：它会 dispose 整棵插件树 ——
 * 关闭 Web 服务、把会话落盘 —— 然后让进程按正常路径退出。
 * `taskkill /F` 这类强杀会跳过落盘，所以这里不用，也不用去猜进程号。
 *
 * 因此本插件不在 Host 侧持有任何状态：按钮只是「问一句 + 发一条请求」。
 */

/** Cordis 插件名；必须与 profile 的 cordis.patch.yml 里 insert 的 id 一致。 */
export const name = 'dsh-shutdown-button';

/** 本插件占用的所有路由都在这个前缀下。 */
const PREFIX = '/dsh-shutdown-button/api';

/** 先把 HTTP 响应写回浏览器，再让进程退出；否则按钮永远等不到回复。 */
const EXIT_DELAY_MS = 400;

/**
 * 写一个 JSON 响应。no-store：每一次回答都是实时状态。
 * @param response - Node 响应对象。
 * @param status - HTTP 状态码。
 * @param payload - 任意可 JSON 化的值。
 */
function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

/**
 * 本机监听的端口：优先读启动器写入的 DSH_WEB_URL，取不到就用默认端口。
 * @returns 端口号。
 */
function currentPort() {
  const fromEnv = process.env.DSH_WEB_URL ?? '';
  const match = /:(\d{1,5})(?:\/|$)/u.exec(fromEnv);
  if (match !== null) {
    const port = Number(match[1]);
    if (Number.isInteger(port) && port > 0 && port < 65536) return port;
  }
  return 3080;
}

/**
 * 跨站请求防护（CSRF）。
 *
 * 浏览器发起的请求一定带 Origin，且同源请求的 Origin 与 Host 一致；
 * 于是「带 Origin 但不同源」直接拒绝，而「没有 Origin」只可能来自 curl
 * 之类的非浏览器客户端，放行。这条规则挡的是「某个网页偷偷 POST 关掉你的 dsh」。
 *
 * @param request - Node 请求对象。
 * @returns 是否允许处理该请求。
 */
function originAllowed(request) {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || origin === '') return true;
  const host = request.headers.host;
  if (typeof host !== 'string' || host === '') return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * 挂上两条路由，等 profile 组合出 webServer 之后。
 * @param ctx - host 上下文，可能取得 webServer 服务。
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (host) => {
    // appExit 由启动器 provide 在根上下文上；拿不到就说明这个宿主不支持优雅关机。
    const exit = host.get('appExit');
    const canShutdown = typeof exit === 'function';
    const whyNot = '这个宿主没有提供 ctx.appExit，无法优雅关机';

    host.effect(() => {
      const offStatus = host.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/status`,
        handler: (request, response) => {
          if (request.method !== 'GET') {
            response.writeHead(405, { allow: 'GET' });
            response.end();
            return;
          }
          sendJson(response, 200, {
            ok: true,
            canShutdown,
            reason: canShutdown ? null : whyNot,
            pid: process.pid,
            port: currentPort(),
            platform: process.platform,
            node: process.version,
          });
        },
      });

      const offShutdown = host.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/shutdown`,
        handler: (request, response) => {
          if (request.method !== 'POST') {
            response.writeHead(405, { allow: 'POST' });
            response.end();
            return;
          }
          if (!originAllowed(request)) {
            sendJson(response, 403, { ok: false, reason: '跨站请求被拒绝' });
            return;
          }
          if (!canShutdown) {
            sendJson(response, 503, { ok: false, reason: whyNot });
            return;
          }
          sendJson(response, 200, { ok: true, pid: process.pid, delayMs: EXIT_DELAY_MS });
          // 响应已经写出去，再请求退出；留一点时间让浏览器收到它。
          setTimeout(() => {
            try {
              exit(0);
            } catch (error) {
              console.error(`[dsh-shutdown-button] 关机请求失败: ${String(error)}`);
            }
          }, EXIT_DELAY_MS);
        },
      });

      return () => {
        offStatus();
        offShutdown();
      };
    }, 'dsh-shutdown-button: 关机路由');
  });
}
