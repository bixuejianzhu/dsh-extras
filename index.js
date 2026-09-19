/**
 * dsh-extras —— 插件组（Host / 服务端半边）。
 *
 * 本包对外只有两样东西：
 *   1) 补丁层 `cordis.patch.yml` —— insert 本组自己与两个按钮成员；
 *   2) 客户端半边 `lib/client.js` —— 设置页「通用插件设置」。
 *
 * 这个文件本身**不注册任何东西**，但它不能删：bundle 的 package.json 只被用来找补丁层，
 * 而 `dsh.client` 是按「已挂载的 Loader 行」扫描的（scans the host Loader's entries）。
 * 少了 `cordis.patch.yml` 里 `id: dsh-extras` 那一行，设置页那一页就不会出现。
 *
 * 历史上这里还有两条路由（`/dsh-extras/api/status` 与 `/api/install`），服务于设置页里的
 * 「一键安装」按钮。那个按钮已按需移除 —— 改由**启动器自愈**承担同一职责：
 * `dsh-tray.ps1` 与 `launch-dsh-web.cmd` 在起 dsh 之前会先跑一次 `scripts/install.ps1`
 * （幂等、失败不阻塞启动）。于是 dsh 升级换了 node 版本槽、仓库被挪过位置、junction
 * 断裂、bundles 被 reconcile 弄乱，都在启动时自动修好 —— 不依赖任何界面按钮。
 */

/** Cordis 插件名；必须与 profile 的补丁层里 insert 的 id 一致。 */
export const name = 'dsh-extras';

/** 无行为：本包的实体是补丁层与客户端半边。 */
export function apply() {}
