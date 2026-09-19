# dsh-extras · DSH 插件组

一组自用的 [DSH](https://github.com/deepseek-ai/deepseek-harness) 插件，打包成一个 bundle，装一次即可就位。
**不需要管理员权限、不需要联网、不改动 DSH 安装目录。**

## 包含什么

|  | 插件 | 作用 |
| --- | --- | --- |
| 🖼 | **选项卡显示图片** | 让提问卡片能显示 markdown 图片（http(s) 图源）。 |
| 🔄 | **重启 DSH** | 一键重启当前进程，重启完成后页面自动刷新 |
| ⏻ | **关闭 DSH** | 优雅关闭当前 DSH 进程，之后需要手动重新启动。 |

## 装完之后

设置面板会多出一页 **「通用插件设置」**，页内两段：**重启 DSH / 关闭 DSH**。

原来的侧栏重启键、以及设置里单独那一页「关机」，都已并入这一页；侧栏不再有按钮。

## 安装

```
双击 install.cmd
```

装完**重启 dsh web**，然后新开一个会话。

此后**每次启动 dsh 之前都会自动跑一次安装器**（幂等、约 2 秒、失败不阻塞启动）：dsh 升级换了 node 版本槽、仓库被挪过位置、接线损坏，都会在启动时自动修好 —— 不需要任何按钮或终端命令。

想确认插件组生效：新会话里 `ask_user_question` 的参数会多出一个 `detail` 字段 —— 有它，就是这个组在工作。

也可以手动跑：

```powershell
powershell -File scripts\install.ps1 -SetDefault
```

## 前置条件

- Windows + 已安装并**启动过一次**的 DSH（安装器要顺着 `profiles` 里的 junction 定位当前安装）
- PowerShell 5.1 或 7 均可（脚本以 UTF-8 带 BOM 保存）
- 无需 git、无需管理员、无需联网

## 换机

把仓库地址交给 agent：它会 clone（机器上没有 git 时，用 GitHub 上的 **Download ZIP** 代替），
再跑一次安装器；**你只需要点一次重启**。
安装器还会把「启动前自愈」注入启动脚本（幂等、首次改动前自动备份），所以新机器上的自动修复能力也一并就位。

原理、排障与设计取舍都写在 [MAINTAINERS.md](MAINTAINERS.md)。

## 文档

- **本文档** —— 面向使用者：有什么、怎么装、怎么换机
- [MAINTAINERS.md](MAINTAINERS.md) —— 面向维护：目录结构、作用域分工、踩过的三个 PowerShell 5.1 坑、验证与回滚

## 许可

MIT