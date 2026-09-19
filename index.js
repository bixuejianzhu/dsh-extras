/**
 * dsh-extras —— 插件组（Host / 服务端半边）。
 *
 * 本包对外的主要实体是补丁层 `cordis.patch.yml`（它 insert 本组自己 + 重启/关机两个成员；
 * 注意 bundle 的 index.js 不会自动运行，必须自己 insert 一行，见那个文件的注释）。
 * 这里发布设置页「通用插件设置」需要的两条路由：
 *
 *   GET  /dsh-extras/api/status    安装器是否就绪、本机路径、上一次运行的结果
 *   POST /dsh-extras/api/install   跑一次 scripts/install.ps1 -SetDefault
 *
 * 为什么一键安装要做成宿主路由而不是浏览器直接下载脚本：只有宿主进程能拿着
 * 「自己所在的那个组目录」去执行脚本；浏览器端的路径是不可信的输入。因此这里
 * **不接受任何来自请求的参数** —— 脚本路径由 import.meta.url 推出，参数是写死的，
 * 没有注入面。写操作另加同源校验（挡掉别的网页偷偷触发安装）。
 *
 * 注意鸡生蛋：这条路由属于本插件，而本插件要先被挂载才存在。所以新机器上第一次
 * 仍然要跑一次命令（或双击组目录里的 install.cmd）；这个按钮负责之后的一键刷新
 * （升级 dsh 之后、换过路径之后、装坏了想修）。
 */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Cordis 插件名；必须与 profile 的补丁层里 insert 的 id 一致。 */
export const name = 'dsh-extras';

/** 本插件占用的所有路由都在这个前缀下。 */
const PREFIX = '/dsh-extras/api';

/** 安装器脚本：路径由本模块位置推出，不接受外部输入。 */
const INSTALLER = fileURLToPath(new URL('./scripts/install.ps1', import.meta.url));

/** 一次安装最多等多久（安装器要做复制 + 建 junction，几秒到几十秒）。 */
const TIMEOUT_MS = 180000;

/** 回给浏览器的输出上限：够看错误，不把整个日志灌过去。 */
const MAX_OUTPUT = 12000;

/** 是否已有一次安装在跑：并发跑两次会互相覆盖 junction。 */
let running = false;

/** 上一次运行的结果，供设置页显示。 */
let lastRun = null;

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
 * 跨站请求防护（CSRF）：带 Origin 的请求必须与 Host 同源；无 Origin 的放行
 * （curl 之类非浏览器客户端）。挡的是「某个网页偷偷触发一次安装」。
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
 * 本机监听的端口：优先读启动器写入的 DSH_WEB_URL。
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
 * 可用的 PowerShell 解释器，按可靠性排序，逐个尝试。
 *
 * 踩过的坑：这台机器上 `pwsh` **不在 PATH 里** —— 只有系统自带的
 * `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`（5.1）。
 * 原先写死 spawn('pwsh') 直接 ENOENT，表现成「一键安装报 500、lastRun.spawnError=true」。
 * 脚本本身是 UTF-8 带 BOM，5.1 也能正确解析，所以系统自带这个就够用。
 * @returns 候选列表，元素为 [命令, 参数数组]。
 */
function shellCandidates() {
  if (process.platform !== 'win32') return [['bash', []]];
  const root = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows';
  return [
    [join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), []],
    ['powershell.exe', []],
    ['pwsh', []],
  ];
}

/**
 * 跑一次安装器，收集输出（有上限），带超时；解释器按候选表逐个尝试。
 *
 * 输出**不走管道**：DSH 沙箱下「用管道 stdio 抓子进程输出」是明确被禁的
 * （Node 的 child_process 默认 stdio:'pipe' 会 EPERM，文件沙箱那一节有记载）。
 * 宿主进程本身通常不受限，但这里不赌平台差异 —— 把 stdout/stderr 指向一个临时
 * 日志文件，子进程退出后再读回来，`stdio: ['ignore', fd, fd]` 在任何模式下都可跑。
 * @param onDone - 结束时回调（code 为 null 表示没跑起来或被终止）。
 * @param index - 当前试到第几个候选。
 */
function runInstaller(onDone, index = 0) {
  const candidates = shellCandidates();
  if (index >= candidates.length) {
    onDone({
      code: null,
      output: `找不到可用的 PowerShell 解释器（试过：${candidates.map((c) => c[0]).join('、')}）`,
      spawnError: true,
    });
    return;
  }
  const shell = candidates[index][0];
  const args = process.platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', INSTALLER, '-SetDefault']
    : [INSTALLER, '-SetDefault'];

  const logPath = join(tmpdir(), `dsh-extras-install-${process.pid}-${Date.now()}-${index}.log`);
  let logFd = null;
  try {
    logFd = openSync(logPath, 'w');
  } catch {
    logFd = null;
  }

  const readLog = () => {
    try {
      const text = readFileSync(logPath, 'utf8');
      return text.length > MAX_OUTPUT ? text.slice(text.length - MAX_OUTPUT) : text;
    } catch {
      return '';
    }
  };
  const cleanup = () => {
    if (logFd !== null) {
      try {
        closeSync(logFd);
      } catch {
        /* 已关 */
      }
      logFd = null;
    }
    try {
      unlinkSync(logPath);
    } catch {
      /* 已删 */
    }
  };

  let child;
  try {
    child = spawn(shell, args, logFd === null
      ? { windowsHide: true, stdio: 'ignore' }
      : { windowsHide: true, stdio: ['ignore', logFd, logFd] });
  } catch {
    // spawn 同步抛出（参数非法等）：换下一个候选。
    cleanup();
    runInstaller(onDone, index + 1);
    return;
  }

  let settled = false;
  let timer = null;
  const finish = (result) => {
    if (settled) return;
    settled = true;
    if (timer !== null) clearTimeout(timer);
    cleanup();
    onDone({ shell, ...result });
  };
  timer = setTimeout(() => {
    try {
      child.kill();
    } catch {
      /* 已经退出 */
    }
    finish({ code: null, output: `${readLog()}\n[超时 ${TIMEOUT_MS}ms，已终止]` });
  }, TIMEOUT_MS);

  child.on('error', (error) => {
    const output = readLog();
    // ENOENT：这个解释器不存在 —— 换下一个候选，而不是把整个操作判死。
    if (!settled && error.code === 'ENOENT' && index + 1 < candidates.length) {
      settled = true;
      clearTimeout(timer);
      cleanup();
      runInstaller(onDone, index + 1);
      return;
    }
    finish({ code: null, output: `${output}\n启动失败（${shell}）：${String(error)}`, spawnError: true });
  });
  child.on('close', (code) => {
    finish({ code: code ?? 1, output: readLog() });
  });
}

/**
 * 挂上两条路由，等 profile 组合出 webServer 之后。
 * @param ctx - host 上下文。
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (host) => {
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
            installer: INSTALLER,
            installerExists: existsSync(INSTALLER),
            running,
            lastRun,
            shells: shellCandidates().map((candidate) => candidate[0]),
            pid: process.pid,
            port: currentPort(),
            node: process.version,
            platform: process.platform,
          });
        },
      });

      const offInstall = host.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/install`,
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
          if (!existsSync(INSTALLER)) {
            sendJson(response, 503, {
              ok: false,
              reason: `找不到安装器：${INSTALLER}（本组目录可能被移动过）`,
            });
            return;
          }
          if (running) {
            sendJson(response, 409, { ok: false, reason: '已经有一次安装在进行中，请等它结束' });
            return;
          }
          running = true;
          runInstaller((result) => {
            running = false;
            lastRun = {
              at: new Date().toISOString(),
              ok: result.code === 0,
              code: result.code,
              shell: result.shell ?? null,
              spawnError: result.spawnError === true,
            };
            sendJson(response, result.code === 0 ? 200 : 500, {
              ok: result.code === 0,
              code: result.code,
              shell: result.shell ?? null,
              spawnError: result.spawnError === true,
              output: result.output,
              hint: result.code === 0
                ? '安装器已跑完 —— 重启 dsh 后新配置才生效。'
                : result.spawnError === true
                  ? '安装器没能启动，看上面的启动失败信息。'
                  : '安装器返回非零退出码，请看上面的输出。',
            });
          });
        },
      });

      return () => {
        offStatus();
        offInstall();
      };
    }, 'dsh-extras: 设置页路由');
  });
}
