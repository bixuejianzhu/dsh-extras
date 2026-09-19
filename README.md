# dsh-extras · DSH 插件组

一组自用的 [DSH](https://github.com/deepseek-ai/deepseek-harness) 插件，打包成一个 bundle，装一次即可就位。
**不需要管理员权限、不需要联网、不改动 DSH 安装目录。**

## 包含什么

|  | 插件 | 作用 |
| --- | --- | --- |
| 🖼 | **选项卡显示图片** | 让提问卡片能显示 markdown 图片（http(s) 图源）。上游 `ask_user_question` 会把 `detail` 字段丢掉，这个插件补上转发。 |
| 🔄 | **重启 DSH** | 一键重启当前进程（复用 dsh-market 的受保护重启通道），重启完成后页面自动刷新 |
| ⏻ | **关闭 DSH** | 优雅关闭：dispose 整棵插件树、会话落盘，然后正常退出 |
| 📦 | **一键重装** | 重跑安装器：重新生成用户 preset、重建 junction、修好接线 |

## 装完之后

设置面板会多出一页 **「通用插件设置」**，页内自上而下三段：**重启 DSH / 关闭 DSH / 安装·刷新接线**。

原来的侧栏重启键、以及设置里单独那一页「关机」，都已并入这一页；侧栏不再有按钮。

## 安装

```
双击 install.cmd
```

装完**重启 dsh web**，然后新开一个会话。

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

原理、排障与设计取舍都写在 [MAINTAINERS.md](MAINTAINERS.md)。

## 文档

- **本文档** —— 面向使用者：有什么、怎么装、怎么换机
- [MAINTAINERS.md](MAINTAINERS.md) —— 面向维护：目录结构、作用域分工、踩过的三个 PowerShell 5.1 坑、验证与回滚

## 许可

MIT