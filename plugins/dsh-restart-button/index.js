/**
 * dsh-restart-button -- host (server) half.
 *
 * Publishes ONE read-only route, `/dsh-restart-button/api/status`, answering
 * whether this host can restart itself and what it is currently serving. The
 * sidebar button uses it to decide between offering the restart and explaining
 * why it cannot -- a button that can only 403 is the state this exists to avoid.
 *
 * The restart itself is deliberately NOT reimplemented here. `dsh-market`
 * already owns the guarded channel (`/dsh-market/api/v1/restart`): a detached
 * helper that waits for this process port to go quiet, relaunches the exact
 * DSH invocation that booted the host, verifies the replacement came up, and
 * logs the outcome. A second private copy of that logic would drift from the one
 * this machine actually exercises, so the button POSTs to the existing one and
 * this half only reports state.
 *
 * Dependency direction: no compile-time or runtime dependency on dsh-market. Its
 * capabilities route is probed over HTTP at request time -- the same door the
 * browser uses -- so a profile without the market composes cleanly and simply
 * reports available:false with the reason.
 *
 * The restart POST itself travels from the PAGE (the button fetches the market
 * route directly), so this half stays a status reporter and needs no HTTP client
 * of its own.
 */

/** Cordis plugin name; must match the loader insert id. */
export const name = 'dsh-restart-button';

/** Every route this plugin owns lives under this prefix. */
const PREFIX = '/dsh-restart-button/api';

/** How long to wait for the market capabilities probe before giving up. */
const PROBE_TIMEOUT_MS = 5000;

/** Write one JSON response. no-store because every answer is live state. */
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
 * The port this host is listening on, as the browser reached it.
 *
 * DSH_WEB_URL is set by the launcher; the fallback matches the default web
 * port. The probe is loopback-only either way, so this is a convenience rather
 * than a trust boundary -- the real guard lives in the restart channel itself.
 * @returns the port to probe.
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
 * Read the host restart capability from whichever channel owns it.
 *
 * Answers a normalized object either way -- never throws -- because "the market
 * is not installed" and "the market says no" are both ordinary states the button
 * has to render, not errors. The Origin header must match the Host the probe
 * actually reaches, so it is built from the same port.
 *
 * @returns the normalized capability report.
 */
async function readCapability() {
  const port = currentPort();
  const origin = `http://127.0.0.1:${port}`;
  try {
    const response = await fetch(`${origin}/dsh-market/api/v1/capabilities`, {
      headers: { accept: 'application/json', origin },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        available: false,
        reason: `restart channel answered HTTP ${response.status}`,
        channel: 'dsh-market',
      };
    }
    const body = await response.json();
    const restart = body?.restart ?? {};
    const supported = body?.features?.restart === true || restart.supported === true;
    return {
      available: supported,
      reason: supported ? null : 'self-restart is disabled for this host',
      channel: 'dsh-market',
      bootId: typeof body?.bootId === 'string' ? body.bootId : null,
      runtime: typeof body?.runtime === 'string' ? body.runtime : null,
      marketVersion: typeof body?.marketVersion === 'string' ? body.marketVersion : null,
      supervisor: typeof restart.supervisor === 'string' ? restart.supervisor : null,
      debugger: typeof restart.debugger === 'string' ? restart.debugger : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      reason: `no restart channel on this host (${message})`,
      channel: null,
    };
  }
}

/**
 * Mount the status route once the profile composes a web server.
 * @param ctx - host context that may acquire the webServer service.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (host) => {
    host.effect(() => {
      const disposer = host.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/status`,
        handler: async (request, response) => {
          if (request.method !== 'GET') {
            response.writeHead(405, { allow: 'GET' });
            response.end();
            return;
          }
          sendJson(response, 200, {
            ok: true,
            pid: process.pid,
            port: currentPort(),
            platform: process.platform,
            node: process.version,
            ...(await readCapability()),
          });
        },
      });
      return () => { disposer(); };
    }, 'dsh-restart-button: status route');
  });
}