/**
 * 【已退役 / RETIRED】这个客户端 bundle 不再被加载。
 *
 * 关机页的 UI 已并入 dsh-extras 设置页「通用插件设置」的第二段（dsh-extras/lib/client.js），
 * 本包 manifest 里的 `dsh.client` 已移除，浏览器不会再拿到这个文件。保留它只为参考。
 *
 * dsh-shutdown-button —— Client（浏览器）半边。
 *
 * 在设置面板里注册一页「关机」（`settings.section`，由
 * @deepseek-ai/dsh-client-ui-settings-general 声明并渲染：导航里出现一行，
 * 选中后内容区只渲染这一页）。
 *
 * 交互：先读 Host 的状态路由确认本机能不能关机 —— 不能就直说原因，而不是给一个
 * 点了没反应的按钮；能则要求二次确认（关机要中断正在进行的一切），确认后 POST
 * 关机路由。
 *
 * 页面自己不去等结果：进程会先一步消失，fetch 报错属于正常现象，所以那种情况下
 * 仍然显示「DSH 正在退出」。要重新用，用启动脚本再起一个 dsh 即可。
 *
 * 除平台自带的 react 之外没有任何外部依赖：图标是内联 SVG，样式是内联对象，
 * 因此加载期不需要解析任何东西。手写在 shell 已经消费的 loader 格式里
 * （`window.__ModuleLoader__.load({ id, factory })`），不经过打包器。
 */
window.__ModuleLoader__.load({
	id: 'dsh-shutdown-button',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		const react = require('react');
		const h = react.createElement;

		/** 本插件在 loader 里的 id。 */
		const ID = 'dsh-shutdown-button';
		/** Host 半边的只读状态路由。 */
		const STATUS_API = '/dsh-shutdown-button/api/status';
		/** Host 半边的关机路由。 */
		const SHUTDOWN_API = '/dsh-shutdown-button/api/shutdown';

		/** 激活前需要的服务：slots 是注册面，别的都不碰。 */
		const inject = ['slots'];

		/** 内联样式：不走 CSS 管线，颜色优先用 shell 的主题变量。 */
		const S = {
			root: { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 },
			title: {
				margin: 0, fontSize: 15, fontWeight: 600,
				color: 'var(--dsw-alias-label-primary, inherit)',
			},
			desc: {
				margin: 0, fontSize: 13, lineHeight: 1.7,
				color: 'var(--dsw-alias-label-secondary, inherit)',
			},
			card: {
				display: 'flex', flexDirection: 'column', gap: 10, padding: 14,
				border: '1px solid var(--dsw-alias-border-l1, #3a3a42)', borderRadius: 10,
				background: 'var(--dsw-alias-bg-layer-1, transparent)',
			},
			row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
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
			btnConfirm: {
				padding: '7px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
				border: '1px solid #f87171', background: '#f87171',
				color: '#ffffff', fontWeight: 600, fontFamily: 'inherit',
			},
			busy: { opacity: 0.5, cursor: 'default' },
			muted: { margin: 0, fontSize: 12, lineHeight: 1.6, opacity: 0.65 },
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
		};

		/** 关机图标：内联 SVG，不需要任何图标包。 */
		function Glyph(size) {
			return h('svg', {
				width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
				'aria-hidden': 'true', focusable: 'false', style: { display: 'block' },
			}, h('path', {
				d: 'M8 2v6M4.2 4.4a5 5 0 1 0 7.6 0',
				stroke: 'currentColor', strokeWidth: 1.4,
				strokeLinecap: 'round', strokeLinejoin: 'round',
			}));
		}

		/** 解析 JSON 响应，容忍根本不是 JSON 的响应体。 */
		async function readJson(response) {
			try {
				return await response.json();
			} catch {
				return null;
			}
		}

		/**
		 * 设置里的「关机」页。
		 * @returns 这一段设置内容。
		 */
		function ShutdownSection() {
			// checking -> idle -> confirm -> closing（或 error）
			const [phase, setPhase] = react.useState('checking');
			const [status, setStatus] = react.useState(null);
			const [detail, setDetail] = react.useState('');
			/** 「重新检测」把它 +1，effect 才会重新跑一次状态检查。 */
			const [attempt, setAttempt] = react.useState(0);

			react.useEffect(() => {
				let alive = true;
				fetch(STATUS_API, { headers: { accept: 'application/json' } })
					.then(async (response) => {
						const body = await readJson(response);
						if (!alive) return;
						setStatus(body === null
							? { canShutdown: false, reason: `状态路由返回 HTTP ${response.status}` }
							: body);
						setPhase('idle');
					})
					.catch((error) => {
						if (!alive) return;
						const message = error !== null && error !== undefined && error.message
							? error.message
							: String(error);
						setStatus({ canShutdown: false, reason: `读不到本机状态：${message}` });
						setPhase('idle');
					});
				return () => { alive = false; };
			}, [attempt]);

			const shutdown = async () => {
				setPhase('closing');
				setDetail('已发送关机请求，正在关闭 DSH 进程…');
				try {
					const response = await fetch(SHUTDOWN_API, {
						method: 'POST',
						headers: { accept: 'application/json' },
					});
					const body = await readJson(response);
					if (body !== null && body.ok !== true) {
						setPhase('error');
						setDetail(String(body.reason ?? `HTTP ${response.status}`));
						return;
					}
					setDetail('DSH 正在退出，本页随时会断开…');
				} catch {
					// 进程先于响应退出时 fetch 会失败，这属于正常现象。
					setDetail('DSH 正在退出，本页随时会断开…');
				}
			};

			const unavailable = status !== null && status.canShutdown !== true;
			const children = [
				h('h2', { key: 'title', style: S.title }, '关机'),
				h('p', { key: 'desc', style: S.desc },
					'关闭正在运行 DSH 的进程：Web 服务、所有会话和本页面都会随之停止。'
					+ '关机后需要重新启动 DSH 才能继续使用。'),
			];

			if (phase === 'checking') {
				children.push(h('p', { key: 'checking', style: S.muted }, '正在检测本机是否支持关机…'));
			} else if (unavailable) {
				children.push(h('div', { key: 'unavailable', style: S.error },
					`本机无法关机：${status.reason ?? '未知原因'}`));
				children.push(h('div', { key: 'recheck', style: S.row },
					h('button', {
						type: 'button', style: S.btn,
						onClick: () => {
							setStatus(null);
							setDetail('');
							setPhase('checking');
							setAttempt((n) => n + 1);
						},
					}, '重新检测')));
			}

			const card = [];
			if (phase === 'idle' && !unavailable) {
				card.push(h('div', { key: 'idle', style: S.row },
					h('button', {
						type: 'button', style: S.btnDanger,
						onClick: () => setPhase('confirm'),
					}, [h('span', { key: 'icon', style: { display: 'inline-flex', marginRight: 6 } }, Glyph(14)), '关闭 DSH 进程'])));
			} else if (phase === 'confirm') {
				card.push(h('p', { key: 'ask', style: S.desc },
					'确定要关机吗？正在进行的任务会被中断，此操作不可撤销。'));
				card.push(h('div', { key: 'confirm', style: S.row }, [
					h('button', {
						key: 'go', type: 'button', style: S.btnConfirm,
						onClick: () => { void shutdown(); },
					}, '确认关机'),
					h('button', {
						key: 'cancel', type: 'button', style: S.btn,
						onClick: () => setPhase('idle'),
					}, '取消'),
				]));
			} else if (phase === 'closing') {
				card.push(h('div', { key: 'closing', style: S.row },
					h('button', {
						type: 'button', disabled: true,
						style: Object.assign({}, S.btnDanger, S.busy),
					}, '正在关机…')));
			} else if (phase === 'error') {
				card.push(h('div', { key: 'error', style: S.error }, `关机失败：${detail}`));
				card.push(h('div', { key: 'back', style: S.row },
					h('button', {
						type: 'button', style: S.btn,
						onClick: () => { setPhase('idle'); setDetail(''); },
					}, '返回')));
			}

			if (card.length > 0) children.push(h('div', { key: 'card', style: S.card }, card));
			if (detail !== '' && phase !== 'error') {
				children.push(h('p', { key: 'detail', style: S.muted }, detail));
			}

			return h('div', { style: S.root }, children);
		}

		/**
		 * 客户端插件主体：把「关机」页贡献给设置面板。
		 * 注册属于当前 fiber，卸载即移除。
		 * @param ctx - 带 slots 服务的客户端根上下文。
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
				name: 'settings.section',
				id: ID,
				order: 90,
				label: () => '关机',
			}, ShutdownSection)), 'dsh-shutdown-button: 设置页');
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
