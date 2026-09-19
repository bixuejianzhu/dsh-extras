/**
 * dsh-extras —— 插件组（Client / 浏览器半边）。
 *
 * 在设置面板里注册一页「通用插件设置」（`settings.section`，由
 * @deepseek-ai/dsh-client-ui-settings-general 声明并渲染：导航里出现一行，选中后
 * 内容区只渲染这一页）。页内自上而下三段：
 *
 *   1. 重启 DSH   —— 读 /dsh-restart-button/api/status，确认后 POST dsh-market 的重启通道，
 *                    然后轮询 status 等 bootId 变化，变了就自动刷新本页
 *   2. 关闭 DSH   —— 读 /dsh-shutdown-button/api/status，确认后 POST 关机路由
 *   3. 一键安装   —— POST /dsh-extras/api/install，按输出回报结果
 *
 * 为什么三段都写在这一个 bundle 里：设置页里要「一页三段」，而手写的 loader bundle
 * 只能可靠地 require 'react'（harness 的客户端包是被编进 shell 的，不是可 require 的
 * 外部模块；子槽位渲染器 @deepseek-ai/dsh-client-ui-slots 也拿不到）。所以 UI 归本组，
 * 能力仍归各成员：路由都在成员插件里，本文件只是它们的客户端门面。
 *
 * 交互约定与成员插件一致：先读状态确认这件事**本机能不能做**，不能就直说原因，
 * 而不是给一个点了没反应的按钮；不可撤销的动作一律二次确认。
 *
 * 除平台自带的 react 之外没有任何外部依赖：图标是内联 SVG，样式是内联对象，
 * 加载期不需要解析任何东西。手写在 shell 已经消费的 loader 格式里
 * （`window.__ModuleLoader__.load({ id, factory })`），不经过打包器。
 */
window.__ModuleLoader__.load({
	id: 'dsh-extras',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		const react = require('react');
		const h = react.createElement;

		/** 本插件在 loader 里的 id。 */
		const ID = 'dsh-extras';

		/** 三个成员各自的 Host 路由（能力在成员里，这里只当门面）。 */
		const RESTART_STATUS = '/dsh-restart-button/api/status';
		const RESTART_GO = '/dsh-market/api/v1/restart';
		const SHUTDOWN_STATUS = '/dsh-shutdown-button/api/status';
		const SHUTDOWN_GO = '/dsh-shutdown-button/api/shutdown';

		/** 重启后等新进程出现的上限。 */
		const RESTART_WAIT_MS = 90000;
		/** 轮询间隔。 */
		const POLL_MS = 2000;

		/** 激活前需要的服务：slots 是注册面，别的都不碰。 */
		const inject = ['slots'];

		/** 内联样式：不走 CSS 管线，颜色优先用 shell 的主题变量。 */
		const S = {
			root: { display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 560 },
			title: {
				margin: 0, fontSize: 15, fontWeight: 600,
				color: 'var(--dsw-alias-label-primary, inherit)',
			},
			desc: {
				margin: 0, fontSize: 13, lineHeight: 1.7,
				color: 'var(--dsw-alias-label-secondary, inherit)',
			},
			block: {
				display: 'flex', flexDirection: 'column', gap: 10, padding: 14,
				border: '1px solid var(--dsw-alias-border-l1, #3a3a42)', borderRadius: 10,
				background: 'var(--dsw-alias-bg-layer-1, transparent)',
			},
			h3: { margin: 0, fontSize: 14, fontWeight: 600 },
			row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
			btn: {
				padding: '7px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
				border: '1px solid var(--dsw-alias-border-l2, #3a3a42)',
				background: 'transparent', color: 'inherit', fontFamily: 'inherit',
			},
			btnPrimary: {
				padding: '7px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
				border: '1px solid var(--dsw-alias-border-l2, #3a3a42)',
				background: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.14))',
				color: 'inherit', fontWeight: 600, fontFamily: 'inherit',
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

		/** 各段共用的图标：内联 SVG，不依赖图标包。 */
		function Glyph(kind, size) {
			const path = kind === 'restart'
				? 'M13.5 8a5.5 5.5 0 1 1-1.9-4.2M13.5 2.5V6H10'
				: kind === 'power'
					? 'M8 2v6M4.2 4.4a5 5 0 1 0 7.6 0'
					: 'M8 2.5v6.2M5 5 8 8.2 11 5M3 10.5v1.8a1.2 1.2 0 0 0 1.2 1.2h7.6a1.2 1.2 0 0 0 1.2-1.2v-1.8';
			return h('svg', {
				width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
				'aria-hidden': 'true', focusable: 'false', style: { display: 'block' },
			}, h('path', {
				d: path,
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
		 * 读一个状态路由。
		 * @param url - 路由地址。
		 * @returns 解析后的对象；失败时给一个带 reason 的降级对象。
		 */
		async function readStatus(url) {
			try {
				const response = await fetch(url, { headers: { accept: 'application/json' } });
				const body = await readJson(response);
				if (body === null) return { failed: `状态路由返回 HTTP ${response.status}` };
				return body;
			} catch (error) {
				const message = error !== null && error !== undefined && error.message
					? error.message
					: String(error);
				return { failed: `读不到本机状态：${message}` };
			}
		}

		/** 一段的外壳：标题 + 说明 + 正文。 */
		function Block(props) {
			return h('section', { style: S.block }, [
				h('h3', { key: 'h', style: S.h3 }, props.heading),
				h('p', { key: 'p', style: S.desc }, props.blurb),
				props.children,
			]);
		}

		/** 一段的按钮。key 要透传，否则同排两个按钮在 React 里会报缺少 key。 */
		function Button(props) {
			return h('button', {
				key: props.key,
				type: 'button',
				disabled: props.disabled === true,
				style: props.disabled === true ? Object.assign({}, props.style, S.busy) : props.style,
				onClick: props.onClick,
			}, props.label);
		}

		/**
		 * 第一段：重启 DSH。
		 * 状态机：checking -> idle -> confirm -> restarting -> reload（或 timed-out / error）
		 */
		function RestartBlock() {
			const [phase, setPhase] = react.useState('checking');
			const [status, setStatus] = react.useState(null);
			const [detail, setDetail] = react.useState('');
			const [attempt, setAttempt] = react.useState(0);

			react.useEffect(() => {
				let alive = true;
				readStatus(RESTART_STATUS).then((body) => {
					if (!alive) return;
					setStatus(body);
					setPhase('idle');
				});
				return () => { alive = false; };
			}, [attempt]);

			const restart = async () => {
				const bootId = status !== null && status.bootId !== undefined ? status.bootId : null;
				setPhase('restarting');
				setDetail('已发送重启请求，等待新进程接管…');
				try {
					const response = await fetch(RESTART_GO, {
						method: 'POST',
						headers: { accept: 'application/json' },
					});
					const body = await readJson(response);
					if (body !== null && body.ok === false) {
						setPhase('error');
						setDetail(String(body.reason ?? `HTTP ${response.status}`));
						return;
					}
				} catch {
					// 进程可能先于响应退出，这属于正常现象，继续等新进程。
				}
				const deadline = Date.now() + RESTART_WAIT_MS;
				const poll = async () => {
					if (Date.now() > deadline) {
						setPhase('timed-out');
						setDetail('等待新进程超时。可以在托盘/启动脚本里手动重启 dsh，然后刷新本页。');
						return;
					}
					const next = await readStatus(RESTART_STATUS);
					if (next.failed === undefined && (bootId === null || next.bootId !== bootId)) {
						setDetail('新进程已接管，正在刷新页面…');
						window.location.reload();
						return;
					}
					setTimeout(() => { void poll(); }, POLL_MS);
				};
				setTimeout(() => { void poll(); }, POLL_MS);
			};

			const unavailable = status !== null && (status.failed !== undefined || status.available !== true);
			const children = [];

			if (phase === 'checking') {
				children.push(h('p', { key: 'checking', style: S.muted }, '正在检测本机重启通道…'));
			} else if (unavailable) {
				children.push(h('div', { key: 'unavailable', style: S.error },
					`本机没有可用的重启通道：${status.failed ?? status.reason ?? '未知原因'}`));
				children.push(h('div', { key: 'row', style: S.row },
					Button({
						style: S.btn, label: '重新检测',
						onClick: () => { setStatus(null); setDetail(''); setPhase('checking'); setAttempt((n) => n + 1); },
					})));
			} else if (phase === 'idle') {
				children.push(h('div', { key: 'row', style: S.row },
					Button({
						style: S.btnPrimary, label: '重启 DSH',
						onClick: () => setPhase('confirm'),
					})));
			} else if (phase === 'confirm') {
				children.push(h('p', { key: 'ask', style: S.desc },
					'确定要重启吗？正在进行的对话轮次会被中断，重启完成后本页会自动刷新。'));
				children.push(h('div', { key: 'row', style: S.row }, [
					Button({ key: 'go', style: S.btnConfirm, label: '确认重启', onClick: () => { void restart(); } }),
					Button({ key: 'no', style: S.btn, label: '取消', onClick: () => setPhase('idle') }),
				]));
			} else if (phase === 'restarting') {
				children.push(h('div', { key: 'row', style: S.row },
					Button({ style: S.btnPrimary, label: '正在重启…', disabled: true, onClick: () => {} })));
			} else if (phase === 'timed-out') {
				children.push(h('div', { key: 'warn', style: S.warn }, detail));
				children.push(h('div', { key: 'row', style: S.row },
					Button({ style: S.btn, label: '重新检测', onClick: () => { setPhase('checking'); setAttempt((n) => n + 1); } })));
			} else if (phase === 'error') {
				children.push(h('div', { key: 'error', style: S.error }, `重启失败：${detail}`));
				children.push(h('div', { key: 'row', style: S.row },
					Button({ style: S.btn, label: '返回', onClick: () => { setPhase('idle'); setDetail(''); } })));
			}

			if (detail !== '' && phase === 'restarting') {
				children.push(h('p', { key: 'detail', style: S.muted }, detail));
			}
			return h(Block, {
				heading: [h('span', { key: 'i', style: { display: 'inline-flex', marginRight: 6, verticalAlign: '-2px' } }, Glyph('restart', 14)), '重启 DSH'],
				blurb: '重启当前 DSH 进程，重启完成后本页会自动刷新。',
				children,
			});
		}

		/**
		 * 第二段：关闭 DSH。
		 * 状态机：checking -> idle -> confirm -> closing（或 error）
		 */
		function ShutdownBlock() {
			const [phase, setPhase] = react.useState('checking');
			const [status, setStatus] = react.useState(null);
			const [detail, setDetail] = react.useState('');
			const [attempt, setAttempt] = react.useState(0);

			react.useEffect(() => {
				let alive = true;
				readStatus(SHUTDOWN_STATUS).then((body) => {
					if (!alive) return;
					setStatus(body);
					setPhase('idle');
				});
				return () => { alive = false; };
			}, [attempt]);

			const shutdown = async () => {
				setPhase('closing');
				setDetail('已发送关机请求，正在关闭 DSH 进程…');
				try {
					const response = await fetch(SHUTDOWN_GO, {
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

			const unavailable = status !== null && (status.failed !== undefined || status.canShutdown !== true);
			const children = [];

			if (phase === 'checking') {
				children.push(h('p', { key: 'checking', style: S.muted }, '正在检测本机是否支持关机…'));
			} else if (unavailable) {
				children.push(h('div', { key: 'unavailable', style: S.error },
					`本机无法关机：${status.failed ?? status.reason ?? '未知原因'}`));
				children.push(h('div', { key: 'row', style: S.row },
					Button({
						style: S.btn, label: '重新检测',
						onClick: () => { setStatus(null); setDetail(''); setPhase('checking'); setAttempt((n) => n + 1); },
					})));
			} else if (phase === 'idle') {
				children.push(h('div', { key: 'row', style: S.row },
					Button({ style: S.btnDanger, label: '关闭 DSH 进程', onClick: () => setPhase('confirm') })));
			} else if (phase === 'confirm') {
				children.push(h('p', { key: 'ask', style: S.desc },
					'确定要关机吗？正在进行的一切会被中断，此操作不可撤销，之后需要手动重新启动 DSH。'));
				children.push(h('div', { key: 'row', style: S.row }, [
					Button({ key: 'go', style: S.btnConfirm, label: '确认关机', onClick: () => { void shutdown(); } }),
					Button({ key: 'no', style: S.btn, label: '取消', onClick: () => setPhase('idle') }),
				]));
			} else if (phase === 'closing') {
				children.push(h('div', { key: 'row', style: S.row },
					Button({ style: S.btnDanger, label: '正在关机…', disabled: true, onClick: () => {} })));
			} else if (phase === 'error') {
				children.push(h('div', { key: 'error', style: S.error }, `关机失败：${detail}`));
				children.push(h('div', { key: 'row', style: S.row },
					Button({ style: S.btn, label: '返回', onClick: () => { setPhase('idle'); setDetail(''); } })));
			}

			if (detail !== '' && phase === 'closing') {
				children.push(h('p', { key: 'detail', style: S.muted }, detail));
			}
			return h(Block, {
				heading: [h('span', { key: 'i', style: { display: 'inline-flex', marginRight: 6, verticalAlign: '-2px' } }, Glyph('power', 14)), '关闭 DSH'],
				blurb: '优雅关闭正在运行 DSH 的进程：dispose 整棵插件树、把会话落盘，然后正常退出。',
				children,
			});
		}


		/**
		 * 设置里的「通用插件设置」页：三段自上而下。
		 * @returns 这一段设置内容。
		 */
		function ExtrasSection() {
			return h('div', { style: S.root }, [
				h('h2', { key: 'title', style: S.title }, '通用插件设置'),
				h('p', { key: 'desc', style: S.desc },
					'本机自制插件组的统一入口：重启、关机，以及一键重跑安装器。'
					+ '三项的能力分别来自 dsh-restart-button、dsh-shutdown-button 与 dsh-extras 自己。'),
				h(RestartBlock, { key: 'restart' }),
				h(ShutdownBlock, { key: 'shutdown' }),
			]);
		}

		/**
		 * 客户端插件主体：把「通用插件设置」页贡献给设置面板。
		 * 注册属于当前 fiber，卸载即移除。
		 * @param ctx - 带 slots 服务的客户端根上下文。
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
				name: 'settings.section',
				id: ID,
				order: 90,
				label: () => '通用插件设置',
			}, ExtrasSection)), 'dsh-extras: 通用插件设置页');
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.ExtrasSection = ExtrasSection;
		// 三段各自导出，方便冒烟测试逐段跑状态机（浏览器里不好调试）。
		exports.RestartBlock = RestartBlock;
		exports.ShutdownBlock = ShutdownBlock;
		return module.exports;
	},
});
