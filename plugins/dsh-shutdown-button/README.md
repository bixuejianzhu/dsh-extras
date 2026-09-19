# dsh-shutdown-button

在 DSH Web GUI 的**设置**面板左侧导航里新增一页「**关机**」，二次确认后优雅关闭当前 DSH 进程。

## 它是怎么关机的

不是杀进程，而是调用 dsh 启动器 provide 在根上下文上的 `ctx.appExit(0)`
（见 `@deepseek-ai/dsh-cmdline` 的 `provideCmdline`）。它会 dispose 整棵插件树 ——
关闭 Web 服务、把会话落盘 —— 然后让进程按正常路径退出。

`taskkill /F` 这类强杀会跳过落盘，所以这里既不用强杀，也不用去猜进程号。

## 结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半边：注册 `GET /dsh-shutdown-button/api/status` 与 `POST /dsh-shutdown-button/api/shutdown` 两条本机路由 |
| `lib/client.js` | Client 半边：向 `settings.section` 注册「关机」页（手写 loader 格式，不走打包器） |
| `package.json` | 声明 `dsh.client.platform = web` 与要注入的客户端包 |

安全上：`POST /shutdown` 要求「带 Origin 的请求必须与 Host 同源」，挡掉别的网页偷偷
POST 关掉你的 dsh；没有 Origin 的客户端（curl 等）放行。

## 安装

**正常路径**：本包已是 `dsh-extras` 插件组的成员，挂载由组统一负责，跑一次组安装器即可：

```powershell
powershell -File <仓库目录>\scripts\install.ps1
```

安装器会为本包在 `profiles\web\node_modules` 建 junction、在 profile 清单里写 `link:` 依赖；
真正的 insert 在 `dsh-extras/cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-shutdown-button
      name: 'dsh-shutdown-button'
```

注意：本包**不是** bundle（manifest 里没有 `dsh.bundle`），不要把它加进 `dsh.profile.bundles`；
也不要再往 profile 的 `cordis.patch.yml` 里重复插一行 —— 同一个 id 插两次是配置错误。

<details>
<summary>脱离插件组单独安装（手工步骤，仅备查）</summary>

1. 本包位于 `<仓库目录>\plugins\dsh-shutdown-button`。
2. profile 的 `...\profiles\web\package.json` 里加一条依赖，然后二选一让 `node_modules`
   里出现软链接（`link:` 依赖在 pnpm 下生成的本来就是 junction，两种做法等价）：
   - 在 profile 目录执行一次 `pnpm install`；或
   - 直接建 junction：

     ```powershell
     New-Item -ItemType Junction `
       -Path   "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-shutdown-button" `
       -Target '<仓库目录>\plugins\dsh-shutdown-button'
     ```

   ```json
   "dsh-shutdown-button": "link:<仓库目录>/plugins/dsh-shutdown-button"
   ```
3. 在需要它的那一层 insert 上面那段 `insert`（profile 的 `cordis.patch.yml`，或某个 bundle
   的补丁层）。profile 补丁层受 `patchReload: live` 监听，改完即时生效、不用重启。

</details>

## ⚠️ 改 profile 下的 JSON/YAML 必须写「无 BOM 的 UTF-8」

这条是踩过的坑，务必先看：

profile 配置一旦带上 UTF-8 BOM，**dsh 会直接起不来**（双击桌面快捷方式毫无反应），
而且报错信息非常隐晦 —— 表面现象是「启动不了」，根因却是 `package.json` 头部多了 3 个字节。

**本 harness 的 `pwsh` 工具实际是 Windows PowerShell 5.1**（`$PSVersionTable.PSVersion` 为
5.1.x，进程名是 `powershell`），在这一版里：

| 写法 | 结果 |
| --- | --- |
| `Set-Content -Encoding utf8` | ❌ 写 BOM |
| `Out-File -Encoding utf8` | ❌ 写 BOM |
| `[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))` | ✅ 无 BOM |
| `node` 脚本、编辑器/`write` 工具写入 | ✅ 无 BOM |

（`-Encoding utf8` 只在 PowerShell 7 才默认不写 BOM。）

自查某个文件有没有 BOM：

```powershell
$b = [System.IO.File]::ReadAllBytes("$env:USERPROFILE\.dsh\profiles\web\package.json")
if ($b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { '有 BOM，要修' } else { '无 BOM' }
```

## 安装后自检

```powershell
# Host 半边是否在跑
Invoke-WebRequest 'http://127.0.0.1:3080/dsh-shutdown-button/api/status' -UseBasicParsing |
  Select-Object -Expand Content
# 期望：{"ok":true,"canShutdown":true,"reason":null,"pid":...,"port":3080,...}

# 两个 profile 文件能否解析
Get-Content "$env:USERPROFILE\.dsh\profiles\web\package.json" -Raw | ConvertFrom-Json | Out-Null
'package.json 解析正常'
```

客户端半边要**刷新页面（F5）**才会加载：`__DSH_BOOT__` 是页面加载时注入的，
新装的客户端模块不刷新页面不会被浏览器拿到。

## 卸载

删掉 `cordis.patch.yml` 里那一行即可（即时生效）；依赖行可以留着，也可以一并删掉。
