/**
 * 【已退役 / RETIRED】这个客户端 bundle 不再被加载。
 *
 * 重启键的 UI 已并入 dsh-extras 设置页「通用插件设置」的第一段（dsh-extras/lib/client.js），
 * 本包 manifest 里的 `dsh.client` 已移除，浏览器不会再拿到这个文件。保留它只为参考：
 * 侧栏那个按钮的原始实现，含展开列与收起轨两种形态。
 *
 * dsh-restart-button -- client half.
 *
 * Registers ONE action at the sidebar foot, beside Settings
 * (`sidebar.footer.action`, which the sidebar shell renders at the bottom-left of
 * the column in both the expanded and the collapsed rail).
 *
 * Clicking it opens a small confirmation panel anchored above the button -- a
 * restart kills this process, so a single stray click must not do it. The panel
 * then drives the whole flow, which lives in `useRestartFlow`: read the host's
 * capability report, POST the guarded restart channel, then poll for the
 * replacement and reload onto it.
 *
 * WHY the page owns the wait: the restart helper relaunches the host with the
 * exact invocation that booted it, so the replacement serves the same origin --
 * but the tab that asked for the restart is looking at a page whose server just
 * died. Nothing on the host can reload it; only the page can.
 *
 * ZERO EXTERNALS beyond the platform's React. The icon is an inline SVG rather
 * than an entry from the shell's icon package, and the styling is inline rather
 * than a CSS file, so this bundle has nothing to resolve at load time and
 * cannot break on a host whose primitives package differs.
 *
 * Hand-written in the loader format the shell already consumes
 * (`window.__ModuleLoader__.load({ id, factory })`), so no bundler is involved.
 */
window.__ModuleLoader__.load({
	id: 'dsh-restart-button',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		const react = require('react');
		const h = react.createElement;

		/** This plugin's id, as the loader knows it. */
		const ID = 'dsh-restart-button';
		/** Our host half's read-only status route. */
		const STATUS_API = '/dsh-restart-button/api/status';
		/** The guarded restart channel, owned by dsh-market. */
		const RESTART_API = '/dsh-market/api/v1/restart';
		/** The capabilities route, used to tell the new host from the old one. */
		const CAPABILITIES_API = '/dsh-market/api/v1/capabilities';
		/** How often the watcher asks whether the replacement is up. */
		const POLL_MS = 1000;
		/** Give up watching after this long and tell the user what to do. */
		const GIVE_UP_MS = 120000;

		/**
		 * Services this client plugin needs before it may activate. `slots` is
		 * the registration surface; nothing else is touched, so the button keeps
		 * working on a host without the locale or theme services.
		 */
		const inject = ['slots'];

		/** The refresh glyph, drawn inline so no icon package has to resolve. */
		function Glyph(size) {
			return h('svg', {
				width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
				'aria-hidden': 'true', focusable: 'false', style: { display: 'block' },
			}, h('path', {
				d: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3.2h-3.2',
				stroke: 'currentColor', strokeWidth: 1.4,
				strokeLinecap: 'round', strokeLinejoin: 'round',
			}));
		}

		/** Inline styles: no CSS pipeline, and the shell's variables when present. */
		const S = {
			// Geometry copied from the shell's own Settings trigger so the two
			// controls in the foot line up exactly.
			row: {
				boxSizing: 'border-box', cursor: 'pointer', height: 42, width: '100%',
				minWidth: 0, margin: '4px -2px', padding: '0 10px 0 8px',
				display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden',
				flex: '0 0 auto', border: 'none', borderRadius: 12,
				background: 'transparent', color: 'var(--dsw-alias-label-primary)',
				fontFamily: 'inherit', fontSize: 14, lineHeight: '22px', textAlign: 'left',
			},
			rail: {
				boxSizing: 'border-box', cursor: 'pointer', width: 36, height: 36,
				margin: 0, padding: 0, flex: 'none',
				display: 'flex', alignItems: 'center', justifyContent: 'center',
				border: 'none', borderRadius: '50%',
				background: 'transparent', color: 'var(--dsw-alias-label-primary)',
				fontFamily: 'inherit', fontSize: 14,
			},
			label: { whiteSpace: 'nowrap', overflow: 'hidden' },
			busy: { opacity: 0.5, cursor: 'default' },
			panel: {
				position: 'fixed', left: 16, bottom: 64, zIndex: 1100, width: 330,
				boxSizing: 'border-box', padding: '14px 16px',
				display: 'flex', flexDirection: 'column', gap: 10,
				borderRadius: 16, border: '1px solid var(--dsw-alias-border-l2, #3a3a42)',
				background: 'var(--dsw-alias-bg-layer-2, #1b1b20)',
				boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
				color: 'var(--dsw-alias-label-primary, inherit)', fontSize: 13, lineHeight: 1.6,
			},
			panelTitle: { fontSize: 14, fontWeight: 600, margin: 0 },
			warn: {
				padding: '8px 10px', borderRadius: 8, fontSize: 12, lineHeight: 1.55,
				color: '#fbbf24', background: 'rgba(251,191,36,0.12)',
				border: '1px solid rgba(251,191,36,0.35)',
			},
			error: {
				padding: '8px 10px', borderRadius: 8, fontSize: 12, lineHeight: 1.55,
				color: '#f87171', background: 'rgba(248,113,113,0.12)',
				border: '1px solid rgba(248,113,113,0.35)',
			},
			muted: { fontSize: 12, opacity: 0.65, margin: 0 },
			actions: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
			btn: {
				padding: '7px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
				border: '1px solid var(--dsw-alias-border-l2, #3a3a42)',
				background: 'transparent', color: 'inherit', fontFamily: 'inherit',
			},
			btnDanger: {
				padding: '7px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
				border: '1px solid #f87171', background: 'rgba(248,113,113,0.16)',
				color: '#f87171', fontWeight: 600, fontFamily: 'inherit',
			},
		};

		/** Sleep helper; the caller checks liveness around each await. */
		const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

		/** Parse a JSON response, tolerating a body that is not JSON at all. */
		const readJson = async (response) => {
			try {
				return await response.json();
			} catch {
				return null;
			}
		};

		/**
		 * The restart sequence, shared by both entry points.
		 *
		 * Owns the whole state machine: `phase` is one of
		 * '' (closed) | 'checking' | 'confirm' | 'restarting' | 'timed-out', and
		 * `detail` carries the sentence the current phase wants to say (a refusal
		 * reason, progress, or the recovery advice). `status` is the host's
		 * last capability report, and is only meaningful once it is non-null.
		 *
		 * A confirmation is REQUIRED before the POST: a restart kills this
		 * process, so a single stray click must not do it. `open()` performs the
		 * capability check first, because a button that can only 403 is the state
		 * this exists to avoid.
		 *
		 * @returns the flow's state and its four actions.
		 */
		function useRestartFlow() {
			/** null | { available, reason, ... } -- the host's status report. */
			const [status, setStatus] = react.useState(null);
			/** '' | 'checking' | 'confirm' | 'restarting' | 'timed-out' */
			const [phase, setPhase] = react.useState('');
			const [detail, setDetail] = react.useState('');
			/** Boot id the host answered with before we asked it to restart. */
			const bootRef = react.useRef(null);
			/** Set on unmount so a pending watcher stops touching state. */
			const aliveRef = react.useRef(true);

			react.useEffect(() => {
				aliveRef.current = true;
				return () => { aliveRef.current = false; };
			}, []);

			/** Read the host's restart capability; returns the parsed report. */
			const loadStatus = react.useCallback(async () => {
				try {
					const response = await fetch(STATUS_API, { headers: { accept: 'application/json' } });
					const body = await readJson(response);
					if (!aliveRef.current) return null;
					if (body === null || body.ok !== true) {
						setStatus({ available: false, reason: 'status route did not answer' });
						return null;
					}
					setStatus(body);
					if (typeof body.bootId === 'string') bootRef.current = body.bootId;
					return body;
				} catch (thrown) {
					if (!aliveRef.current) return null;
					setStatus({ available: false, reason: String((thrown && thrown.message) || thrown) });
					return null;
				}
			}, []);

			/**
			 * Watch for the replacement host: poll the capability route and reload
			 * once a DIFFERENT boot id answers. An equal boot id means the restart
			 * has not happened yet, so polling continues.
			 */
			const watch = react.useCallback(async () => {
				const previous = bootRef.current;
				const deadline = Date.now() + GIVE_UP_MS;
				while (aliveRef.current && Date.now() < deadline) {
					await sleep(POLL_MS);
					if (!aliveRef.current) return;
					try {
						const response = await fetch(CAPABILITIES_API, { headers: { accept: 'application/json' } });
						if (!response.ok) continue;
						const body = await readJson(response);
						const boot = body === null ? null : body.bootId;
						if (typeof boot !== 'string') continue;
						// A boot id we never managed to read still counts: something is
						// answering, and it is a fresh process.
						if (previous === null || boot !== previous) {
							if (!aliveRef.current) return;
							setDetail('新进程已就绪，正在刷新页面…');
							window.location.reload();
							return;
						}
					} catch { /* the host is mid-restart; the port is simply closed */ }
				}
				if (!aliveRef.current) return;
				setPhase('timed-out');
			}, []);

			/** POST the restart, then wait for the replacement. */
			const restart = react.useCallback(async () => {
				setPhase('restarting');
				setDetail('已发出重启请求，等待旧进程退出…');
				try {
					const response = await fetch(RESTART_API, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: '{}',
					});
					const body = await readJson(response);
					if (!aliveRef.current) return;
					// The v1 route wraps the legacy payload in `result`; accept both.
					const payload = body !== null && body.result !== undefined ? body.result : body;
					if (!response.ok) {
						const message = payload !== null && payload !== undefined && payload.error
							? String(payload.error)
							: `HTTP ${response.status}`;
						setPhase('confirm');
						setDetail(`重启被拒绝：${message}`);
						return;
					}
					setDetail('已排定重启，等待新进程…');
					await watch();
				} catch (thrown) {
					if (!aliveRef.current) return;
					// A dropped connection is EXPECTED: the host may die before the
					// response is fully read. Treat it as accepted and watch.
					setDetail('重启请求已发出（连接被旧进程中断属正常），等待新进程…');
					await watch();
				}
			}, [watch]);

			/** First click: check the channel, then arm the confirmation. */
			const open = react.useCallback(async () => {
				setPhase('checking');
				setDetail('');
				const report = await loadStatus();
				if (!aliveRef.current) return;
				if (report !== null && report.available !== true) {
					setPhase('confirm');
					setDetail(report.reason === null || report.reason === undefined
						? '本机没有可用的重启通道。'
						: `本机没有可用的重启通道：${report.reason}`);
					return;
				}
				setPhase('confirm');
			}, [loadStatus]);

			/** Close, unless a restart is already in flight. */
			const close = react.useCallback(() => {
				if (phase === 'restarting') return;
				setPhase('');
				setDetail('');
			}, [phase]);

			/** Escape dismisses, but never mid-restart. */
			react.useEffect(() => {
				if (phase === '' || phase === 'restarting') return undefined;
				const onKey = (event) => { if (event.key === 'Escape') close(); };
				window.addEventListener('keydown', onKey);
				return () => window.removeEventListener('keydown', onKey);
			}, [phase, close]);

			return { status, phase, detail, open, close, restart };
		}

		/**
		 * Whether the confirmation may fire: the channel said yes, and the
		 * capability check left no refusal sentence behind.
		 * @param flow - the state returned by {@link useRestartFlow}.
		 * @returns true when restarting is the right thing to offer.
		 */
		function canConfirm(flow) {
			return flow.phase === 'confirm'
				&& flow.status !== null && flow.status.available === true
				&& flow.detail === '';
		}

		/**
		 * The sidebar-foot action: a restart button plus its confirmation panel.
		 * @param props - owner share from the sidebar, carrying the column state.
		 * @returns the rendered button (and panel, while open).
		 */
		function RestartAction(props) {
			const wide = props !== null && props !== undefined && props.wide === true;
			const flow = useRestartFlow();
			const { status, phase, detail } = flow;

			const busy = phase === 'checking' || phase === 'restarting';
			const isOpen = phase !== '';

			const button = h('button', {
				type: 'button',
				title: wide ? undefined : '重启 DSH',
				'aria-label': '重启 DSH',
				'aria-haspopup': 'dialog',
				'aria-expanded': isOpen,
				style: wide
					? Object.assign({}, S.row, busy ? S.busy : null)
					: Object.assign({}, S.rail, busy ? S.busy : null),
				disabled: phase === 'restarting',
				onClick: () => { if (isOpen) { flow.close(); return; } void flow.open(); },
				onMouseEnter: (event) => {
					if (!busy) event.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.07))';
				},
				onMouseLeave: (event) => { event.currentTarget.style.background = 'transparent'; },
			}, [
				h('span', { key: 'icon', style: { flex: 'none', display: 'inline-flex' } }, Glyph(wide ? 16 : 18)),
				wide ? h('span', { key: 'label', style: S.label }, '重启 DSH') : null,
			]);

			if (!isOpen) return button;

			const ready = canConfirm(flow);
			const unavailable = status !== null && status.available !== true;

			const panel = h('div', {
				key: 'panel', role: 'dialog', 'aria-label': '重启 DSH', style: S.panel,
			}, [
				h('p', { key: 'title', style: S.panelTitle }, '重启 DeepSeek Harness'),
				status === null
					? h('p', { key: 'checking', style: S.muted }, '正在检测本机重启通道…')
					: unavailable
						? h('div', { key: 'unavail', style: S.error },
							detail !== '' ? detail : `本机没有可用的重启通道${status.reason ? '：' + status.reason : ''}`)
						: null,
				ready ? h('div', { key: 'warn', style: S.warn },
					'重启会终止当前进程：正在进行的对话轮次、后台任务与子代理都会中断。') : null,
				phase === 'restarting' ? h('div', { key: 'progress', style: S.warn },
					detail === '' ? '正在重启…' : detail) : null,
				phase === 'timed-out' ? h('div', { key: 'timeout', style: S.error },
					'等待新进程超时。请手动刷新本页；若打不开，请用启动脚本重新启动 dsh。') : null,
				h('div', { key: 'actions', style: S.actions }, [
					ready ? h('button', {
						key: 'go', type: 'button', style: S.btnDanger, onClick: () => { void flow.restart(); },
					}, '确认重启') : null,
					unavailable ? h('button', {
						key: 'recheck', type: 'button', style: S.btn,
						onClick: () => { void flow.open(); },
					}, '重新检测') : null,
					phase !== 'restarting' ? h('button', {
						key: 'cancel', type: 'button', style: S.btn, onClick: flow.close,
					}, '取消') : null,
				]),
			]);

			return h('div', { style: { display: 'contents' } }, [button, panel]);
		}

		/**
		 * Client plugin body: contribute the restart action to the sidebar foot.
		 * The registration belongs to this fiber, so unloading removes it.
		 * @param ctx - client root context carrying the slots service.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
				name: 'sidebar.footer.action',
				id: ID,
				order: 10,
				label: () => '重启 DSH',
			}, RestartAction)), 'dsh-restart-button: sidebar foot action');
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
