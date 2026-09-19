# dsh-extras —— 插件组

把这台机器上的自制 DSH 插件收进**同一个 bundle 层**：profile 的 `dsh.profile.bundles`
里只列 `dsh-extras` 一个包，成员由本组的补丁层统一 insert。

**本组是自包含的** —— 三个插件、安装器、说明全在这一个文件夹里，换机器只需搬这个目录。

```
dsh-extras\
  package.json          组的清单（dsh.bundle + dsh.client 两个声明）
  cordis.patch.yml      组的补丁层：insert 本组自己 + 两个按钮成员
  index.js              组的宿主半边（设置页的 /dsh-extras/api/status 与 /api/install）
  lib\client.js         组的客户端半边（设置页「通用插件设置」三段）
  install.cmd           双击入口（新机器首次引导）
  smoke-client.mjs      客户端 bundle 的 Node 冒烟测试
  scripts\install.ps1   安装器：生成 preset + 接 profile（幂等）
  scripts\verify.ps1    自检：三层检查 + 路由探测
  plugins\
    ask-detail\             选项卡显示图片插件（由 agent preset 挂载）
    dsh-restart-button\     重启按钮（host 能力）
    dsh-shutdown-button\    关机按钮（host 能力）
```

> **本组自己也在 `cordis.patch.yml` 里 insert 了一行**，这不是多余的：bundle 的
> `package.json` 只被用来找补丁层，它的 `index.js` 不会自动运行；而 `dsh.client`
> 又是按「已挂载的 Loader 行」扫描的（`scans the host Loader's entries`）。少了那一行，
> 宿主半边与客户端半边**都不会生效** —— 设置页那一行就不会出现。这个坑踩过一次。

## 成员与各自的作用域

| 成员 | 挂载点 | 为什么在那儿 |
|---|---|---|
| `plugins/dsh-restart-button` | 本组补丁层（profile / host 作用域） | 发布 HTTP 路由、复用宿主的重启通道 |
| `plugins/dsh-shutdown-button` | 本组补丁层（profile / host 作用域） | 同上：注册关机路由，调 `ctx.appExit` |
| `plugins/ask-detail`（选项卡显示图片插件） | agent preset 的 `tool-ask-user` 行 | 它注册的是**模型可见的工具**，工具注册表拒绝同名全局注册，只能在 agent 作用域换实现 |

两个按钮之前是各自独立的 bundle / profile 补丁行，现在统一由 `cordis.patch.yml` 拥有
（成员按**包名** insert，所以目录位置不影响挂载）。第三个不进补丁层，而是由
`scripts/install.ps1` 写进用户 agent preset。

## 安装

```powershell
powershell -File scripts/install.ps1 -SetDefault   # 装 preset + 接 profile，并设为新会话默认
```

脚本做两件事：

1. **agent 作用域**：把随包 `standard` preset 复制到 `$DSH_HOME/.agent-presets/standard-extras`，
   把 `- id: tool-ask-user` 行的 `name` 改成 `'./plugins/ask-detail/index.js'`，并把插件与
   它需要的 `node_modules/@deepseek-ai/dsh-tools` junction 一并放进 preset 目录。
2. **profile 作用域**：给三个成员（组本身 + 重启按钮 + 关机按钮）都建 `node_modules` junction
   并写成 `link:` 依赖 —— 组的补丁层按**包名** insert 成员，解析不到就启动失败；然后把
   `dsh-extras` 写进 `dsh.profile.bundles`（替掉原来的 `dsh-restart-button`），并清空 profile
   补丁层里手写的 `dsh-shutdown-button` insert（原文件备份为 `cordis.patch.yml.bak`）。

因为随包 preset 属于安装目录、升级即被覆盖，而复制品会随上游过时，**升级 dsh 之后重跑一次
这个脚本**即可：它每次都从当前安装里的 `standard` 重新生成，而不是在旧副本上打补丁。

## 设置页「通用插件设置」

本组自己带一个客户端 bundle（`lib/client.js`），在设置面板里注册一页**「通用插件设置」**，
页内自上而下三段：

| 段落 | 能力来自 | 路由 |
|---|---|---|
| 重启 DSH | `dsh-restart-button` | 读 `/dsh-restart-button/api/status`，POST dsh-market 的 `/dsh-market/api/v1/restart` |
| 关闭 DSH | `dsh-shutdown-button` | `/dsh-shutdown-button/api/status` + `/api/shutdown` |
| 安装 / 刷新接线 | `dsh-extras` 自己 | `/dsh-extras/api/status` + `/dsh-extras/api/install` |

**UI 归组，能力归成员**：三个成员仍然各自发布自己的 HTTP 路由（host 半边没动），
设置页只是它们的客户端门面。所以两个按钮原来的客户端注册点已撤掉 ——
重启键不再挂侧栏（`sidebar.footer.action`），关机键不再单独占一行设置页
（`settings.section`），它们的 `lib/client.js` 保留作参考但**已不再被声明为客户端插件**
（manifest 里的 `dsh.client` 已移除），因此不会加载。

一键安装按钮做的是「重跑 `scripts/install.ps1 -SetDefault`」，用宿主路由执行：脚本路径由
`import.meta.url` 推出、参数写死、**不接受任何请求参数**（没有注入面），写操作另加同源校验；
并发跑两次会被拒（409）。**鸡生蛋**：这个按钮本身要靠插件组已挂载才存在，所以新机器上
第一次仍然得用：

```
双击 dsh-extras\install.cmd        （或 powershell -File scripts\install.ps1 -SetDefault）
```

之后升级 dsh、换过路径、想修接线时，用设置里那个按钮就够了。

客户端 bundle 的冒烟测试在 Node 里跑（桩掉 loader 与 react，逐段强制状态、逐分支渲染）：

```powershell
node dsh-extras\smoke-client.mjs
```

## 生效范围（重要，踩过一次）

`settings.yaml` 里的 `agent-presets.default` **只决定新会话**用哪个 preset。已有会话（包括
重启后恢复的会话）沿用创建时记录的 preset —— 而且 agent 一旦产出过内容就**不能再换** preset
（换掉会让已经落盘的工具调用对不上新组合）。

所以验证本插件必须**开一个新会话**：

- 新会话里 `ask_user_question` 的参数 schema 会多出 **`detail`** 字段（本插件注册的）；
  旧会话没有这个字段 —— 一眼就能看出当前用的是哪个实现，不用靠猜。
- 旧会话即使重启也不会切过来，只能重开。

这条不是本组的设计缺陷，是「工具在 agent 作用域、组合在会话开始时定死」的必然结果。
反过来说也提醒一件事：**别用 vendor 补丁去"兜底"旧会话**，否则会出现「图片能显示，
但说不清用的是哪个实现」的状态 —— 本组刻意只留一个来源。

## 换机迁移

**只搬这个文件夹，不要搬 `$DSH_HOME`。** preset 目录里有指回「本机安装路径」的 junction，
`profiles` 里的清单也是本机路径，拷过去只会指向不存在的位置 —— 它们必须在新机器上**重新生成**。

```
要搬的：Documents\work\dsh-extras\      （一个目录，里面装齐三个插件与安装器）
```

（这个目录目前不在 git 仓库里，所以得手动复制。插件已经攒到三个，建议给它建个仓库。）

新机器上的顺序（顺序有讲究）：

```powershell
# 1) 先把 dsh 装好并启动一次 —— 安装器要靠 profiles 里的 junction 找到「当前安装」，
#    没启动过就没有那些 junction，脚本会直接报错。
dsh web

# 2) 复制 dsh-extras 目录过来，然后跑安装器（它会把一切重新生成）
powershell -File dsh-extras\scripts\install.ps1 -SetDefault

# 3) 重启 dsh web，验证（见下一节）
```

脚本在新机器上会重新建立这几样东西，都不依赖旧机器：

| 生成物 | 指向 |
|---|---|
| `$DSH_HOME\.agent-presets\standard-extras\agent.cordis.yml` | 从**新机器**的随包 `standard` 重新生成，只改 `tool-ask-user` 一行 |
| 同目录 `plugins\ask-detail\` | 从本组 `plugins\ask-detail\` 复制 |
| 同目录 `node_modules\@deepseek-ai\dsh-tools` | junction → **新机器**的当前安装 |
| `profiles\web\package.json` | 三个成员都补成 `link:` 依赖，`bundles` 只留 `dsh-extras` |
| `profiles\web\node_modules\{dsh-extras,dsh-restart-button,dsh-shutdown-button}` | junction → 本组目录 / 本组 `plugins\` 下的成员 |
| `settings.yaml` 的 `agent-presets.default` | `standard-extras`（`-SetDefault` 时） |

成员包缺一个就会**启动失败**（组的补丁层无条件 insert 它们），所以脚本对缺失的成员直接报错，
而不是留个坏掉的 profile 给你。只想少装某个成员时，请同时从 `cordis.patch.yml` 里删掉对应行。

> 注意：成员可以放在本组 `plugins\` 下（当前布局），也可以放回工作区同级目录 —— 安装器两种
> 都能找到，优先组内。

## 验证

```powershell
powershell -File scripts/verify.ps1     # 只读、免提权；打印 PASS/FAIL 汇总，有失败则退出码 1
```

它查三层：agent preset（组合文件那一行 / 插件文件 / dsh-tools junction / 能否真的 import）、
profile 接线（bundles 列表、三个成员的 junction 与 `link:` 依赖、成员入口与客户端半边可达）、
运行中宿主（两个按钮的路由），外加一项 BOM 守卫。

**重启前跑一次、重启后再跑一次**：静态项两次都应通过，而 `pid`/`bootId` 变了才说明新布局
真的被加载了。组合层还可以单独审计一次（重复 id 会让启动直接失败）：

```powershell
dsh --profile web --dump-config | Select-String 'dsh-extras|dsh-restart-button|dsh-shutdown-button'
# 期望：出现 `# == dsh-extras` 这一层的头，两个成员行各出现一次
```

最后一项只有人能确认：新会话里让模型弹一张带 `detail` 图片的提问卡片，看图片是否显示。

`verify.ps1` 和 `install.ps1` 一样含中文，必须保有 UTF-8 BOM。

## 回滚

```powershell
# 从 bundles 拿掉本组、还原手写 insert 与 restart-button 的 bundle 声明即可；
# agent 侧把 preset 换回 standard：
#   settings.yaml 里 agent-presets.default: standard-extras  ->  standard
Remove-Item -Recurse -Force "$env:USERPROFILE\.dsh\.agent-presets\standard-extras"
```

`plugins/dsh-restart-button/package.json` 里的 `dsh.bundle` 已被移除（否则 `dsh plugin` 的
reconcile 会在下次安装时把它重新加回 bundle 列表，造成同一 id 被两层各 insert 一次）。
它自带的 `cordis.patch.yml` 仍保留，需要单独装时手工 insert 即可。

## 注意（Windows PowerShell 5.1）

脚本含中文，且以 UTF-8 **带 BOM** 保存。本机 `pwsh` 实际是 Windows PowerShell 5.1
（Desktop 版），它读不带 BOM 的 `.ps1` 会按 ANSI 解码，中文变乱码并破坏字符串字面量。
改动这些脚本时请保住 BOM（`EF BB BF`），否则会解析失败。

### 坑一：[CmdletBinding()] + `-File` 时，param 默认值里的 `$PSScriptRoot` 是空的

实测（PS 5.1）：

```powershell
[CmdletBinding()]
param([string]$R = $PSScriptRoot)   # 用 -File 调用时 $R 是空字符串
```

```powershell
param([string]$R = $PSScriptRoot)   # 没有 CmdletBinding 就正常
```

原因是 advanced script 的参数绑定发生在脚本作用域给 `$PSScriptRoot` 赋值之前。
受影响的正是**非交互**的两条路径：双击 `install.cmd`、以及宿主路由 spawn 出来的安装
（两者都用 `-File`）；而用 `&` 在进程内调用不会踩到 —— 所以自测很容易漏掉。
`install.ps1` 因此改为在**脚本体**里解析 `$GroupDir`（并带 `$MyInvocation` 兜底）。

### 坑二：宿主里 spawn 子进程，两个都不能想当然

1. **`pwsh` 不在 PATH 里**（这台机器只有系统自带的 `powershell.exe` 5.1）。
   写死 `spawn('pwsh')` 会 ENOENT，表现出来就是「一键安装报 500」。现在按候选表
   逐个尝试，首选**绝对路径** `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`。
2. **不要用管道 stdio 抓输出**：DSH 沙箱明确禁止（Node `child_process` 默认
   `stdio:'pipe'` 会 EPERM）。宿主进程本身通常不受限，但平台差异不值得赌 ——
   现在把 stdout/stderr 指向临时日志文件（`stdio: ['ignore', fd, fd]`），退出后读回来，
   在沙箱内也实测可用。

这两条都出现在 `/dsh-extras/api/install` 的实现里，改那边时别退回老写法。

### 坑三：别用嵌套数组字面量当「旧文本 → 新文本」查找表

改脚本措辞时踩过，代价是把 `install.ps1` 与 `verify.ps1` 各改坏一次：

```powershell
# ✗ 错
$fixes = @{ 'install.ps1' = @( @('旧文本', '新文本') ) }
foreach ($pair in $fixes['install.ps1']) { $t = $t.Replace($pair[0], $pair[1]) }
```

PowerShell 会把嵌套数组**展平**，`foreach` 拿到的 `$pair` 是**字符串**而不是一对值；
而字符串的 `[0]` / `[1]` 是**取字符**。于是「替换一整句」变成了
「把第 1 个字符全局换成第 2 个字符」：

- `'用法（请用…'[0]` = `用`，`[1]` = `法` → 全文 `用` 变成 `法`（「作用域」→「作法域」、「用户」→「法户」）
- `'（本机…'[0]` = `（`，`[1]` = `本` → 全文 `（` 变成 `本`

更麻烦的是这些字符在文件里本来就有合法用法（`无法确定`、`本机`、`本组`），
所以机械回替只会造成二次损坏 —— 当时只能整篇重写。

```powershell
# ✓ 对：对象数组，不要嵌套
$fixes = @([pscustomobject]@{ File = 'install.ps1'; Old = '旧文本'; New = '新文本' })
foreach ($f in $fixes) { $t = $t.Replace($f.Old, $f.New) }
```

顺带一句：与其用脚本改文本，不如用编辑工具按字面量改（它走 UTF-8 读写，且要求先读后改）。
另外**改完 `.ps1` 一定要确认前三个字节仍是 `EF BB BF`** —— 编辑工具写出来的是无 BOM 的
UTF-8，BOM 被抹掉就回到坑一（PS 5.1 按 ANSI 解析，中文乱码并破坏字符串字面量）。

## 作为 git 仓库使用

本目录自包含（无子模块、无构建产物、脚本里无绝对路径），可以直接作为仓库根。

```powershell
cd <本目录>
git init -b main
git add -A
git commit -m "dsh-extras: 插件组（重启 / 关机 / 选项卡显示图片 + 一键安装）"
```

推到自己的远程（先在 GitHub 建**空**仓库，不要勾 README/.gitignore）：

```powershell
git remote add origin <仓库地址>
git push -u origin main
```

值得做仓库的四条理由（都踩过）：

1. **回滚**：我改脚本措辞时用错的嵌套数组把两个 `.ps1` 各改坏一次，当时没有任何备份，
   只能凭上下文整篇重写；有仓库就是 `git checkout -- scripts/` 一秒复原。
2. **搬机**：`git clone` 取代手动复制目录。
3. **可追溯**：三条 PS 5.1 的坑、preset/bundle 的语义、每次判断都有 diff 与 message。
4. **换机自动化**：见下节 —— 把地址给 agent，它能一路装到验证。

### 换机：把仓库地址给 agent 就行

1. 新机器上 dsh 装好并**启动过一次**（安装器靠 `profiles` 里的 junction 定位当前安装）；
2. 把地址给 agent，它会：

   ```powershell
   git clone <仓库地址> C:\Users\<你>\Documents\work\dsh-extras
   powershell -File dsh-extras\scripts\install.ps1 -SetDefault   # 需一次提权：要写 $DSH_HOME
   ```

3. **你重启 dsh** —— agent 一旦触发重启，它自己那个回合就被掐断，所以这一步必须你来；
4. agent 再跑 `powershell -File dsh-extras\scripts\verify.ps1`（28 项）并弹一张带图卡片确认。

私有仓库要先给 git 凭据（token 或 SSH key）；公开仓库直接 clone 即可。

### 提交前留意

- `.ps1` 必须保住 UTF-8 **BOM**（`EF BB BF`），否则 PS 5.1 按 ANSI 解析、中文乱码并破坏字面量；
- 文档里有若干 `C:\Users\<用户名>\...` 的**示例路径**：本地用着方便，仓库若要公开，
  建议换成 `<仓库目录>` 之类的占位符；
- `plugins/*/lib/client.js` 里有两个**已退役**的客户端半边（UI 已并入组的设置页），
  保留作参考，不要误以为它们还在加载 —— manifest 里的 `dsh.client` 已经移除。

