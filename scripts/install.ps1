<#
  dsh-extras 安装器（幂等，可反复运行）

  它做两件事，分别对应插件组的两个作用域：

  【A】agent 作用域 —— 选项卡显示图片插件
    上游把 ask_user_question 挂在 agent preset 里（dsh-agent-presets/presets/standard/
    agent.cordis.yml 的 `tool-ask-user` 行），不是 profile 的补丁层；而工具注册表拒绝
    同名全局注册。所以「换成修好的实现」只能在 preset 这一层改行。
    本脚本把随包发布的 preset 复制到 $DSH_HOME/.agent-presets/<id>，把那一行的 name
    指向本组自带的插件，并让 preset 自带依赖。

  【B】profile 作用域 —— 插件组本身
    把 dsh-extras 作为一个 bundle 接进 profile：依赖 + node_modules junction +
    `dsh.profile.bundles` 里用它替掉原来的 dsh-restart-button，并清掉 profile 补丁层里
    手写的 dsh-shutdown-button insert（现在由组的补丁层统一 insert）。

  为什么是复制 preset 而不是就地改：
    随包 preset 属于安装目录，升级即被覆盖。用户 preset 根是你自己那一层
    （shipped 根优先，所以 id 不能与 standard 撞名）。代价是复制品会随上游升级而过时 ——
    升级后重跑本脚本即可：它每次都从当前安装里的 standard 重新生成。

  为什么 preset 里要有个 node_modules junction：
    本插件 import 了 @deepseek-ai/dsh-tools（defineTool 负责把简写 schema 转成 JSON Schema，
    并包上参数校验，不能自己糊一个）。preset 目录在用户 home 下，Node 向上找 node_modules
    永远到不了 harness 的依赖；所以把 harness 的 dsh-tools junction 到 preset 目录里。
    它指向当前安装，升级换了安装目录时重跑本脚本即可刷新。

  用法（PowerShell 5.1 或 7 都可以；脚本带 UTF-8 BOM，5.1 能正确解析中文）：
    powershell -File install.ps1                    # 装 preset + 接 profile
    powershell -File install.ps1 -SetDefault        # 顺便设为新会话默认 preset
    powershell -File install.ps1 -SkipPreset        # 只接 profile
    powershell -File install.ps1 -SkipProfile       # 只装 preset
#>
[CmdletBinding()]
param(
  # 用户 preset id（同时是目录名）。不要用 standard —— shipped 根优先，会被遮蔽。
  [string]$PresetId = 'standard-extras',

  # 从哪个随包 preset 复制。
  [string]$FromPreset = 'standard',

  # 写入 preset.yml 的显示名。
  [string]$DisplayName = '标准模式（含选项卡显示图片）',

  # profile 名与要接进去的 bundle 包名。
  [string]$Profile = 'web',
  [string]$BundleName = 'dsh-extras',

  # 本组源码目录。默认留空，在**脚本体**里解析（原因见紧随 param 之后那段注释）。
  [string]$GroupDir,

  # 是否把 agent-presets.default 写进 $DSH_HOME/settings.yaml。
  [switch]$SetDefault,
  [switch]$SkipPreset,
  [switch]$SkipProfile
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)

# ── $GroupDir 默认值必须在**脚本体**里解析，不能写在 param 默认值里 ──────────────
# 实测（Windows PowerShell 5.1）：给脚本加 [CmdletBinding()] 之后，用 -File 调用时
# param 默认值里的 $PSScriptRoot 是**空字符串** —— 参数绑定发生在脚本作用域把
# $PSScriptRoot 赋值之前，于是 Join-Path '' '..' 抛 EmptyStringNotAllowed。
# 受影响的正是两条「非交互」路径：双击 install.cmd，以及宿主路由 spawn 出来的安装。
# 用 & 在进程内调用不会踩到，所以这个坑很容易在自测里漏掉。
if ([string]::IsNullOrEmpty($GroupDir)) {
  $scriptDir = $PSScriptRoot
  if ([string]::IsNullOrEmpty($scriptDir)) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
  if ([string]::IsNullOrEmpty($scriptDir)) { throw '无法确定脚本所在目录（$PSScriptRoot 与 $MyInvocation 都为空）' }
  $GroupDir = (Resolve-Path (Join-Path $scriptDir '..')).Path
}

function Read-Utf8([string]$Path) { return [System.IO.File]::ReadAllText($Path, $utf8) }
function Write-Utf8([string]$Path, [string]$Text) { [System.IO.File]::WriteAllText($Path, $Text, $utf8) }

function New-Junction([string]$Path, [string]$Target) {
  if (Test-Path $Path) { Remove-Item -LiteralPath $Path -Recurse -Force }
  $parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  New-Item -ItemType Junction -Path $Path -Target $Target | Out-Null
}

if ($PSVersionTable.PSVersion.Major -lt 7) {
  Write-Warning '提示：本机为 Windows PowerShell 5.1（Desktop 版）。脚本以 UTF-8 带 BOM 保存，5.1 能正确解析中文，无需 pwsh。'
}

# ── 0. 定位 harness home / 当前安装 ───────────────────────────────────────────
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
if (-not (Test-Path $dshHome)) { throw "找不到 harness home: $dshHome" }
$profilesDir = Join-Path $dshHome 'profiles'
if (-not (Test-Path $profilesDir)) { throw "找不到 profiles 目录: $profilesDir（先启动一次 dsh）" }

# profiles 里的 @deepseek-ai 包都是指回安装目录的 junction —— 顺着它找当前真正在跑的安装，
# 这样升级换了安装目录也不用改脚本。
$agentPresetsLink = Join-Path $profilesDir "node_modules\@deepseek-ai\dsh-agent-presets"
$installedPkgsDir = $null
if (Test-Path $agentPresetsLink) { $installedPkgsDir = Split-Path -Parent (Get-Item $agentPresetsLink).Target }
if (-not $installedPkgsDir -or -not (Test-Path $installedPkgsDir)) {
  throw "无法从 $agentPresetsLink 解析当前安装在用的 @deepseek-ai 目录；先启动一次 dsh 让 junction 生成"
}
Write-Host "harness home : $dshHome"
Write-Host "当前安装     : $installedPkgsDir"

# ── 预检：profile 那一半要用的成员包先全部确认存在 ───────────────────────────
# 组的补丁层是按**包名** insert 成员的，profile 里解析不到就会启动失败。
# 放在这里是为了 fail fast：成员缺失时宁可什么都不做，也不要留下
# 「preset 装好了、profile 没接上」的半成品状态。
$members = @('dsh-restart-button', 'dsh-shutdown-button')
$sources = [ordered]@{}
if (-not $SkipProfile) {
  $workspace = Split-Path -Parent $GroupDir
  $sources[$BundleName] = $GroupDir
  foreach ($m in $members) {
    # 成员优先在组内找（组是自包含的：一个文件夹装齐所有插件）；
    # 找不到再回退到组目录的同级 —— 兼容成员还散落在工作区里的旧布局。
    $candidates = @((Join-Path $GroupDir "plugins\$m"), (Join-Path $workspace $m))
    $found = $null
    foreach ($candidate in $candidates) {
      if (Test-Path (Join-Path $candidate 'package.json')) { $found = $candidate; break }
    }
    if ($found) {
      $sources[$m] = $found
    } else {
      throw "找不到成员包 '$m'（找过：$($candidates -join '  /  ')）。组的补丁层会无条件 insert 它，缺了 dsh 会启动失败；请把该插件目录一并复制过来，或从 cordis.patch.yml 里删掉对应行"
    }
  }
}

# ══ A. agent 作用域：用户 preset ═════════════════════════════════════════════
if (-not $SkipPreset) {
  $shippedRoot = Join-Path $installedPkgsDir "dsh-agent-presets\presets\$FromPreset"
  if (-not (Test-Path (Join-Path $shippedRoot 'agent.cordis.yml'))) { throw "找不到随包 preset: $shippedRoot" }
  if ($PresetId -eq $FromPreset) { throw "PresetId 不能与随包 preset 同名（'$FromPreset'）：shipped 根优先，你的副本会被静默遮蔽" }

  $userRoot = Join-Path $dshHome '.agent-presets'
  $presetDir = Join-Path $userRoot $PresetId
  New-Item -ItemType Directory -Force -Path $presetDir | Out-Null

  # 复制随包 preset，但保留本地 plugins / node_modules（重跑时不被自我嵌套覆盖）
  $keepNames = @('plugins', 'node_modules')
  $stash = Join-Path $env:TEMP ("dsh-extras-stash-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $stash | Out-Null
  foreach ($n in $keepNames) {
    $p = Join-Path $presetDir $n
    if (Test-Path $p) { Move-Item -LiteralPath $p -Destination (Join-Path $stash $n) }
  }
  Get-ChildItem -Path $shippedRoot -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $presetDir -Recurse -Force
  }
  foreach ($n in $keepNames) {
    $from = Join-Path $stash $n
    if (Test-Path $from) {
      $to = Join-Path $presetDir $n
      if (Test-Path $to) { Remove-Item -LiteralPath $to -Recurse -Force }
      Move-Item -LiteralPath $from -Destination $to
    }
  }
  Remove-Item -LiteralPath $stash -Recurse -Force -ErrorAction SilentlyContinue

  # 插件本体：从组目录复制进 preset（插件已零依赖，preset 里不需要任何 node_modules）
  $pluginSrc = Join-Path $GroupDir 'plugins\ask-detail'
  $pluginDst = Join-Path $presetDir 'plugins\ask-detail'
  New-Item -ItemType Directory -Force -Path $pluginDst | Out-Null
  foreach ($f in @('index.js', 'package.json', 'README.md')) {
    $from = Join-Path $pluginSrc $f
    if (Test-Path $from) { Copy-Item -LiteralPath $from -Destination $pluginDst -Force }
  }

  # 清掉旧版本留下的 node_modules/junction（那时插件还 import @deepseek-ai/dsh-tools）。
  # 插件现在零依赖，而那种 junction 指向带 node 版本槽的安装路径、升级后本来就会断。
  # ⚠️ 必须用 .NET 删链接本身：PS 5.1 的 Remove-Item -Recurse 遇到 junction 有递归进目标
  #    目录、把真包内容一起删掉的风险。
  $legacyLink = Join-Path $presetDir 'node_modules\@deepseek-ai\dsh-tools'
  if (Test-Path $legacyLink) {
    [System.IO.Directory]::Delete($legacyLink, $false)
    Write-Host '已清理 preset 里旧的 dsh-tools junction（插件现已零依赖）'
    foreach ($dir in @((Join-Path $presetDir 'node_modules\@deepseek-ai'), (Join-Path $presetDir 'node_modules'))) {
      if (Test-Path $dir) { try { [System.IO.Directory]::Delete($dir, $false) } catch { } }
    }
  }

  # 改行：tool-ask-user 的 name → 相对 preset 目录的路径（classifyRowSpecifier: '.' 前缀按 preset 基解析）
  $composition = Join-Path $presetDir 'agent.cordis.yml'
  $text = Read-Utf8 $composition
  # 注意：不要用 [regex]::Replace(text, pattern, scriptblock, 1) —— 没有那个重载，
  # 第四参会当成 RegexOptions。用 Regex 实例的 (string, string, int) 重载。
  $rowPattern = "(?m)^(?<head>- id: tool-ask-user\r?\n[ \t]+name:[ \t]*).*$"
  $rowRegex = [regex]$rowPattern
  if (-not $rowRegex.IsMatch($text)) {
    throw "在 $composition 里找不到 '- id: tool-ask-user' 行（上游可能改了 preset 结构）；本脚本按行改写，形状变了要先看一眼"
  }
  $rowReplacement = '${head}' + "'./plugins/ask-detail/index.js'"
  $text = $rowRegex.Replace($text, $rowReplacement, 1)
  Write-Utf8 $composition $text

  # preset.yml 只承载给人看的文本；id 就是目录名
  $meta = "name: $DisplayName`ndescription: 随包 $FromPreset preset 的副本，唯一差异是把 tool-ask-user 行指向本组自带的选项卡显示图片插件（转发 detail，让 markdown 图片显示在提问卡片里）。`norder: 50`n"
  Write-Utf8 (Join-Path $presetDir 'preset.yml') $meta

  Write-Host "preset 已就绪: $presetDir"
}

# ══ B. profile 作用域：把插件组接成 bundle ═══════════════════════════════════
if (-not $SkipProfile) {
  $profileDir = Join-Path $profilesDir $Profile
  if (-not (Test-Path (Join-Path $profileDir 'package.json'))) { throw "profile '$Profile' 不存在: $profileDir" }

  # 1) 组成员的 node_modules junction + 依赖（成员清单已在开头的预检里确认过）
  foreach ($name in $sources.Keys) {
    New-Junction (Join-Path $profileDir "node_modules\$name") $sources[$name]
    Write-Host "junction: node_modules\$name -> $($sources[$name])"
  }

  # 2) 依赖 + bundles 列表
  $manifestPath = Join-Path $profileDir 'package.json'
  $manifest = Read-Utf8 $manifestPath | ConvertFrom-Json
  foreach ($name in $sources.Keys) {
    $linkSpec = 'link:' + ($sources[$name] -replace '\\', '/')
    if (-not $manifest.dependencies.PSObject.Properties[$name]) {
      $manifest.dependencies | Add-Member -NotePropertyName $name -NotePropertyValue $linkSpec
    } else {
      $manifest.dependencies.$name = $linkSpec
    }
  }
  $bundles = @($manifest.dsh.profile.bundles)
  # 组的成员已被组统一 insert，逐个列的成员行让位给组本身
  $bundles = @($bundles | Where-Object { $members -notcontains $_ })
  if ($bundles -notcontains $BundleName) { $bundles += $BundleName }
  $manifest.dsh.profile.bundles = $bundles
  Write-Utf8 $manifestPath ($manifest | ConvertTo-Json -Depth 10)
  Write-Host "bundles 已更新: $($bundles -join ', ')"

  # 3) profile 补丁层：关机按钮的 insert 归组所有，清掉手写那份（避免同一 id 插两次）
  $patchPath = Join-Path $profileDir 'cordis.patch.yml'
  if (Test-Path $patchPath) {
    $patch = Read-Utf8 $patchPath
    if ($patch -match "dsh-shutdown-button") {
      $header = "# Your patch layer for this dsh profile, applied after every bundle layer:`n# a top-level YAML array of loader patch entries (id-targeted config`n# overrides, disables, and insert lists; ``!!js`` expressions allowed).`n[]`n"
      Copy-Item -LiteralPath $patchPath -Destination "$patchPath.bak" -Force
      Write-Utf8 $patchPath $header
      Write-Host "profile 补丁层已清空（原文件备份为 cordis.patch.yml.bak）"
    } else {
      Write-Host "profile 补丁层无需改动"
    }
  }
}

# ══ C. 可选：设为新会话默认 preset ═══════════════════════════════════════════
if ($SetDefault) {
  $settingsPath = Join-Path $dshHome 'settings.yaml'
  $settings = if (Test-Path $settingsPath) { Read-Utf8 $settingsPath } else { '' }
  if ($settings -match '(?m)^agent-presets:') {
    if ($settings -match '(?m)^agent-presets:\r?\n(?:[ \t]+.*\r?\n?)*?[ \t]+default:') {
      $settings = [regex]::Replace($settings, '(?m)^([ \t]+default:).*$', "`$1 $PresetId")
    } else {
      $settings = [regex]::Replace($settings, '(?m)^agent-presets:\s*$', "agent-presets:`n  default: $PresetId")
    }
  } else {
    $sep = if ($settings.Length -gt 0 -and -not $settings.EndsWith("`n")) { "`n" } else { '' }
    $settings = $settings + $sep + "agent-presets:`n  default: $PresetId`n"
  }
  Write-Utf8 $settingsPath $settings
  Write-Host "已把 agent-presets.default 设为 $PresetId（改回：把 settings.yaml 里这一项换成 standard）"
}

Write-Host ''
Write-Host '完成。下一步：重启 dsh web。'
Write-Host "  新会话默认 preset: $(if ($SetDefault) { $PresetId } else { '未改动（在 GUI 模式选择里挑，或重跑加 -SetDefault）' })"
if (-not $SkipPreset) {
  $probe = Join-Path $dshHome ".agent-presets\$PresetId\plugins\ask-detail\index.js"
  $probeUrl = 'file:///' + ($probe -replace '\\', '/')
  Write-Host "  自检（应打印 plugin ok）：node --input-type=module -e `"await import('$probeUrl').then(m => console.log('plugin ok'))`""
}
