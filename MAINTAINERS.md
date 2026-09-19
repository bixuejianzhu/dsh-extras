# dsh-extras —— 插件组

> 面向维护与排障的文档。面向使用者的简介见 [README.md](README.md)。

把这台机器上的自制 DSH 插件收进**同一个 bundle 层**：profile 的 `dsh.profile.bundles`
里只列 `dsh-extras` 一个包，成员由本组的补丁层统一 insert。

**本组是自包含的** —— 三个插件、安装器、说明全在这一个仓库里，换机器只需把它 clone 过来。

```
dsh-extras\
  package.json          组的清单（dsh.bundle + dsh.client 两个声明）
  cordis.patch.yml      组的补丁层：insert 本组自己 + 两个按钮成员
  index.js              空壳宿主半边（存在的意义：让 dsh.client 声明被扫到）
  lib\client.js         组的客户端半边（设置页「通用插件设置」三段）
  install.cmd           双击入口（新机器首次引导）
  smoke-client.mjs      客户端 bundle 的 Node 冒烟测试
  scripts\install.ps1   安装器：生成 preset + 接 profile（幂等；也负责搬迁后重指向）
  scripts\verify.ps1    自检：四层检查 + 路由探测
  scripts\test-installer.ps1  安装器自身的本地回归测试（假 $DSH_HOME，24 项断言）
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
   插件本体一并复制进 preset 目录（插件零依赖，preset 里**不需要** node_modules）。
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

**UI 归组，能力归成员**：三个成员仍然各自发布自己的 HTTP 路由（host 半边没动），
设置页只是它们的客户端门面。所以两个按钮原来的客户端注册点已撤掉 ——
重启键不再挂侧栏（`sidebar.footer.action`），关机键不再单独占一行设置页
（`settings.section`）。它们的客户端半边**已删除**：manifest 里的 `dsh.client` 早已移除，
（manifest 里的 `dsh.client` 已移除），因此不会加载。

那一页原本还有第三段「安装 / 刷新接线」（宿主路由 `/dsh-extras/api/*`），**已按需移除**：
同一职责改由**启动器自愈**承担 —— `dsh-tray.ps1` 与 `launch-dsh-web.cmd` 在起 dsh 之前会先跑一次
`scripts/install.ps1 -SetDefault`（幂等、约 2 秒；失败只记日志、不阻塞启动，输出写进
`$DSH_HOME/dsh-extras-install.log`）。

为什么这样更好：安装器修的是**启动时才组合**的 preset 与 junction，「点按钮立刻修好」本来也躲不过
一次重启；而自愈正好发生在你需要的那次重启之前 —— 不必点按钮、不必开终端、也不必叫 agent。

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

**只搬仓库，不要搬 `$DSH_HOME`。** preset 目录里有指回「本机安装路径」的 junction，
`profiles` 里的清单也是本机路径，拷过去只会指向不存在的位置 —— 它们必须在新机器上**重新生成**。

仓库本身就是需要搬运的全部内容（三个插件、安装器、自检脚本都在里面）。新机器上的顺序：

```powershell
# 1) 先把 dsh 装好并启动一次 —— 安装器要靠 profiles 里的 junction 找到「当前安装」，
#    没启动过就没有那些 junction，脚本会直接报错。
dsh web

# 2) 拿到仓库（把 git 地址给 agent，或自己 clone），然后跑安装器
git clone https://github.com/bixuejianzhu/dsh-extras
powershell -File dsh-extras\scripts\install.ps1 -SetDefault

# 3) 重启 dsh web，验证（见下一节）
```

> 第 2 步也可以直接双击 `install.cmd` —— 它等价于 `install.ps1 -SetDefault`。

### 同一台机器上给仓库换位置

换目录（先 clone 到别处、再删掉旧副本也算）**不需要**手改任何接线：重跑一次安装器，
三处指向都会跟着重建 —— profile 的 junction 与 `link:` 依赖、preset 里的插件副本、
以及启动器里自愈注入的那条路径。最后一条最容易漏：自愈块里写着旧路径时，此后每次开机
都会去跑**旧副本**的安装器，把 junction 又指回去（两个仓库互相覆盖，很难查）。所以安装器
对「已注入」的启动器会比对路径，不一致就只改路径（见坑六第 3 条），`verify.ps1` 也会检查。

```powershell
Move-Item <旧目录>\dsh-extras <新目录>\dsh-extras
powershell -File <新目录>\dsh-extras\scripts\install.ps1
powershell -File <新目录>\dsh-extras\scripts\verify.ps1
```

脚本在新机器上会重新建立这几样东西，都不依赖旧机器：

| 生成物 | 指向 |
|---|---|
| `$DSH_HOME\.agent-presets\standard-extras\agent.cordis.yml` | 从**新机器**的随包 `standard` 重新生成，只改 `tool-ask-user` 一行 |
| 同目录 `plugins\ask-detail\` | 从本组 `plugins\ask-detail\` 复制 |
| 同目录 |（插件零依赖，preset 里**没有** node_modules） |
| `profiles\web\package.json` | 三个成员都补成 `link:` 依赖，`bundles` 只留 `dsh-extras` |
| `profiles\web\node_modules\{dsh-extras,dsh-restart-button,dsh-shutdown-button}` | junction → 本组目录 / 本组 `plugins\` 下的成员 |
| `settings.yaml` 的 `agent-presets.default` | `standard-extras`（`-SetDefault` 时） |
| `$DSH_HOME\dsh-tray.ps1`、`launch-dsh-web.cmd` | 注入「启动前自愈」；已注入但路径是旧的会自动改指回本仓库（幂等；首次改动前备份 `.bak-before-selfheal`，语法检查失败自动回滚） |

成员包缺一个就会**启动失败**（组的补丁层无条件 insert 它们），所以脚本对缺失的成员直接报错，
而不是留个坏掉的 profile 给你。只想少装某个成员时，请同时从 `cordis.patch.yml` 里删掉对应行。

> 注意：成员可以放在本组 `plugins\` 下（当前布局），也可以放回工作区同级目录 —— 安装器两种
> 都能找到，优先组内。

## 验证

```powershell
powershell -File scripts/verify.ps1     # 只读、免提权；打印 PASS/FAIL 汇总，有失败则退出码 1
```

它查四层：agent preset（组合文件那一行 / 插件文件 / 是否零依赖 / 能否真的 import）、
profile 接线（bundles 列表、三个成员的 junction 与 `link:` 依赖、成员入口与客户端半边可达）、
运行中宿主（两个按钮的路由）、启动器自愈（是否已注入，且注入的路径**正是本仓库**），
外加两项守卫：profile 的 JSON/YAML 不带 BOM、所有读取都走 UTF-8 安全 API。

改过 `install.ps1` 的注入 / junction 逻辑后，再跑一次它自带的本地回归测试 —— 它在临时目录里
造一套假 `$DSH_HOME` 与假启动器，不动真东西（24 项断言）：

```powershell
powershell -File scripts/test-installer.ps1
```

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
需要单独装它时，按 `cordis.patch.yml` 里现成的 insert 片段手工加一行即可（该文件已随死代码清理删除，旧内容见 Git 历史）。

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
   写死 `spawn('pwsh')` 会 ENOENT。现在按候选表
   逐个尝试，首选**绝对路径** `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`。
2. **不要用管道 stdio 抓输出**：DSH 沙箱明确禁止（Node `child_process` 默认
   `stdio:'pipe'` 会 EPERM）。宿主进程本身通常不受限，但平台差异不值得赌 ——
   现在把 stdout/stderr 指向临时日志文件（`stdio: ['ignore', fd, fd]`），退出后读回来，
   在沙箱内也实测可用。

这两条现在出现在**启动器自愈**里（`dsh-tray.ps1` 的 `Invoke-ExtrasInstaller`，以及 `launch-dsh-web.cmd`），改那边时别退回老写法。

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
git commit -m "dsh-extras: 插件组（重启 / 关机 / 选项卡显示图片 + 启动器自愈）"
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


另外两个 Node 侧冒烟测试不依赖 harness，任何装了 Node 的机器都能跑（CI 也会跑，见 `.github/workflows/smoke.yml`）：


```powershell

node smoke-client.mjs                        # 设置页客户端 bundle（两段状态机逐分支）

node plugins\ask-detail\smoke-host.mjs       # 图片插件：零依赖 + detail 转发 + 参数校验

```

私有仓库要先给 git 凭据（token 或 SSH key）；公开仓库直接 clone 即可。

### 提交前留意

- `.ps1` 必须保住 UTF-8 **BOM**（`EF BB BF`），否则 PS 5.1 按 ANSI 解析、中文乱码并破坏字面量；
- 文档里有若干 `C:\Users\<用户名>\...` 的**示例路径**：本地用着方便，仓库若要公开，
  建议换成 `<仓库目录>` 之类的占位符；
- `plugins/*/lib/client.js` 那两个**已退役**的客户端半边已删除（UI 已并入组的设置页）；旧实现见 Git 历史，
  （`settings.section`）。它们的客户端半边**已删除**：manifest 里的 `dsh.client` 早已移除，



### 坑四：`File.ReadAllText` 会吃掉 BOM —— 写回时丢了 BOM 就等于把文件改坏

改 `dsh-tray.ps1` 时踩过。`[IO.File]::ReadAllText($p, UTF8Encoding($false))` 会**自动跳过开头的 BOM**，
所以「读进来再检查第一个字符是不是 U+FEFF」永远得到"没有 BOM"；若随后用无 BOM 编码写回，BOM 就被抹掉 ——
而 PS 5.1 读没有 BOM 的 `.ps1` 时按 ANSI 解析，中文立刻乱码、脚本直接解析失败。**这条正是坑一的隐蔽触发方式。**
结论：处理带中文的 `.ps1` 时，读用 `UTF8Encoding($false)`、**写必须显式用 `UTF8Encoding($true)`**；
改完务必核对前三个字节仍是 `EF BB BF`。

### 坑五：`Remove-Item -Recurse` 遇到 junction 可能删掉**目标目录里的真东西**

PS 5.1 的 `Remove-Item -Recurse -Force` 作用在含 junction 的目录上时，有递归进链接目标、把真包内容
一起删掉的风险。清理 preset 里旧 `node_modules` junction 时因此改用 .NET：

```powershell
[System.IO.Directory]::Delete($link, $false)   # 只删链接本身，不递归
```

`install.ps1` 里所有「换 junction」都收口到一个 `Remove-LinkOrDirectory` 里：先看是不是
reparse point，是链接就只摘链接，是真目录才 `Remove-Item -Recurse`。这条尤其要紧 ——
profile 里 `node_modules\dsh-extras` 的链接目标就是**仓库本身**，递归进去等于把仓库删了。
`scripts/test-installer.ps1` 的 case 5 用哨兵文件守这个不变量。


### 坑六：文本手术的两个陷阱（改 `install.ps1` 的注入逻辑时必看）

1. **数组字面量里逗号的优先级高于 `+`**。写成

   ```powershell
   @( 'rem ...', 'if exist "' + $GroupDir + '\scripts\install.ps1" (', ... )
   ```

   会被解析成 `('rem ...','if exist "') + $GroupDir + ('\scripts...', ...)` —— 数组被展平，
   `-join` 再给每段加换行，于是**路径被切成多行**（注入进启动脚本后直接失效）。
   每个拼接都要自己加括号：`('if exist "' + $GroupDir + '...')`。
2. **插入了文本之后，之前算好的字符偏移全部失效**。注入函数改变了长度，再用旧的 `Match.Index`
   去 `Insert` 调用点，就会把调用插进别的行中间（踩过一次）。**在改动后的新文本上重新匹配**再插入。
3. **「已注入就跳过」是错的**。自愈块里存着仓库的绝对路径，仓库一搬走，"跳过"就意味着此后每次
   开机都跑**旧副本**的安装器，把 junction 指回去。正确做法：已注入时**比对路径** ——
   不一致就只改那条路径，一致才跳过。`.ps1` 用下标手术改 `$installer = '...'` 那一行；
   `.cmd` 里同一条路径出现两次，必须**从后往前**替换（否则前面的长度变化会让后面的下标失效）。
   两边都要有"形状不认识就不动手"的兜底。

### 坑七：用工具改带 BOM 的 `.ps1`，BOM 会被悄悄吃掉

坑四说的是「自己读文件时别把 BOM 读没了」，这条是它的另一半：**写回时也要自己保证有 BOM**。
本仓库的 `install.ps1` / `verify.ps1` 是「UTF-8 带 BOM」（PS 5.1 靠它才能正确解析中文），
而很多编辑 / 打补丁的工具按 UTF-8 无 BOM 写回 —— 一保存 BOM 就没了，于是 5.1 按 ANSI 解析，
中文全乱、报一屏语法错（这次是改自愈逻辑时踩到的）。改完 `.ps1` 固定做两步：

```powershell
# 1) 补回 BOM（读用无 BOM 编码、写显式用有 BOM 编码）
$p = 'scripts\install.ps1'
$t = [System.IO.File]::ReadAllText($p, (New-Object System.Text.UTF8Encoding($false)))
[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($true)))

# 2) 语法自检：必须 0
$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$null, [ref]$e); $e.Count
```

`scripts/test-installer.ps1` 是纯 ASCII，故意不带 BOM —— 它没有中文，不踩这个坑。
`verify.ps1` 只守 profile 的 JSON/YAML **不带** BOM（那边相反：带 BOM 会让 dsh 起不来），
`.ps1` 的 BOM 只能靠上面两步自己守。

### 纪律：preset 与 profile 清单都是**生成物**，不要去手改

`$DSH_HOME\.agent-presets\<id>\` 与 `profiles\<profile>\package.json` 都由 `install.ps1` 生成。
自愈生效后**每次冷启动都会重跑一次安装器**，所以手改这两处会被下一次启动悄悄覆盖。
要加行、改配置，请改仓库里的 `cordis.patch.yml` / `plugins\` / `scripts\install.ps1`。

同理：`cordis.patch.yml` 里那句「不要用 [regex]::Replace(text, pattern, scriptblock, 1)」之类的经验，
以及本文档的其它坑，都是为了让「重新生成」这条路靠得住 —— 而不是让人回头去改生成物。

`$DSH_HOME\dsh-tray.ps1` / `launch-dsh-web.cmd` 里那段自愈块同理：**别手改里面的路径**。
仓库换位置后重跑一次安装器，它会自己改指回新位置（见「同一台机器上给仓库换位置」）。

## 信任边界：自愈会在每次启动时执行什么

装上之后，`~/.dsh\dsh-tray.ps1` 与 `launch-dsh-web.cmd` 在**启动 dsh 之前**会执行一次
`<仓库目录>\scripts\install.ps1`。这件事值得写清楚 —— 它决定了「仓库目录」属于**可信区域**：

| 项 | 事实 |
|---|---|
| 以谁的身份跑 | 你自己（当前用户），**不提权**、不弹 UAC |
| 什么时候跑 | 每次冷启动（快捷方式 / 托盘 / `launch-dsh-web.cmd`）；已有实例在跑时不会跑 |
| 会写哪里 | 只写 `$DSH_HOME`（`profiles\` 与 `.agent-presets\`）和它自己的日志；**不写** dsh 安装目录 |
| 会不会联网 / 装东西 | 不会：不下载、不装包、不改 PATH |
| 会不会改默认 preset | 不会（注入的命令**不带** `-SetDefault`，只修接线） |
| 失败怎么办 | 只记日志、不阻塞启动（`~/.dsh/dsh-extras-install.log`） |

**所以：谁能写这个仓库目录，谁就能在你的下一次 dsh 启动时执行代码。**
把它放在只有你能写的位置（例如自己的用户目录下），不要放在共享目录、网络盘或
其他人/进程可写的路径里。仓库被改名或移走时，自愈只会记一条 `not found`，不会执行旧路径上的任何东西。

想核对它到底会跑什么：

```powershell
Get-Content <仓库目录>\scripts\install.ps1
```

想关掉自愈：删掉两个启动脚本里那段以
`# --- 插件组自愈（由 dsh-extras 的安装器注入；删除本段即可移除）` 开头的块，
或直接用同目录的 `*.bak-before-selfheal` 备份还原。注意 `install.ps1 -SkipLauncher` 只保证
**不再注入**，已经注入的那段要按上面的办法删掉。
