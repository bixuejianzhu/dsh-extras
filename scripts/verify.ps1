<#
  dsh-extras 自检脚本（只读、免提权、可反复运行）

  它检查三层，任何一层断了都能看出是哪一层：

    1) agent 作用域：用户 preset 里的插件行 / 插件文件 / dsh-tools junction / 能否真的 import
    2) profile 作用域：bundles 列表、三个成员的 junction 与 link 依赖、成员入口可达、
       以及「客户端半边是否已经归组」（成员不再声明 dsh.client，组声明了）
    3) 运行中的宿主：三条路由是否响应（两个按钮 + 组的安装路由，附带 pid / bootId）

  另有两项守卫性检查：
    - profile 的 JSON/YAML 不能带 UTF-8 BOM（带 BOM 会让 dsh 起不来）
    - 所有读取都走 UTF-8 安全 API（本机的 PowerShell 是 5.1，Get-Content 会按 ANSI 解码而误报）

  用法：
    powershell -File verify.ps1
    powershell -File verify.ps1 -Profile web -PresetId standard-extras
#>
[CmdletBinding()]
param(
  [string]$Profile = 'web',
  [string]$PresetId = 'standard-extras',
  [string]$Port = '3080'
)

$ErrorActionPreference = 'Stop'
# 任何未预期异常都计成 FAIL 并继续（而不是静默跳过 —— 那正是「假绿」的来源）。
trap {
  $script:fail++
  Write-Host "  [FAIL] 未预期异常，该检查未完成：$($_.Exception.Message)" -ForegroundColor Red
  continue
}

$utf8 = New-Object System.Text.UTF8Encoding($false)
function Read-Text([string]$Path) { return [System.IO.File]::ReadAllText($Path, $utf8) }
function Read-Json([string]$Path) { return (Read-Text $Path | ConvertFrom-Json) }

$pass = 0
$fail = 0
function Ok([string]$Message) { $script:pass++; Write-Host "  [PASS] $Message" }
function Bad([string]$Message) { $script:fail++; Write-Host "  [FAIL] $Message" -ForegroundColor Red }
<#
  条件判定必须自己收口，不能让 PowerShell 的参数绑定去做 Bool 转换：
  PS 5.1 里 junction 的 (Get-Item x).Target 是**数组**，而 `$array -like '*x*'` 返回的是
  过滤后的数组而不是布尔 —— 交给 [bool] 参数会抛异常；配合 $ErrorActionPreference='Continue'
  就会「静默跳过一条检查却仍然报全部通过」。所以这里显式归一化，并且脚本末尾用
  trap 把任何未预期异常也计成 FAIL。
#>
function Check($Condition, [string]$Message) {
  $truthy = $false
  if ($null -eq $Condition) { $truthy = $false }
  elseif ($Condition -is [bool]) { $truthy = $Condition }
  elseif ($Condition -is [array]) { $truthy = ($Condition.Count -gt 0) }
  else { $truthy = [bool]$Condition }
  if ($truthy) { Ok $Message } else { Bad $Message }
}
function Section([string]$Title) { Write-Host ''; Write-Host "== $Title ==" }

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path $dshHome "profiles\$Profile"
$profileNm = Join-Path $profileDir 'node_modules'
$presetDir = Join-Path $dshHome ".agent-presets\$PresetId"
$pluginDir = Join-Path $presetDir 'plugins\ask-detail'

# ── 1. agent 作用域 ──────────────────────────────────────────────────────────
Section "agent 作用域（preset $PresetId）"

$composition = Join-Path $presetDir 'agent.cordis.yml'
Check (Test-Path $composition) "preset 组合文件存在：$composition"
if (Test-Path $composition) {
  $text = Read-Text $composition
  $m = [regex]::Match($text, "(?m)^- id: tool-ask-user\r?\n[ \t]+name:[ \t]*(?<name>.*)$")
  if ($m.Success) {
    Check ($m.Groups['name'].Value.Trim() -eq "'./plugins/ask-detail/index.js'") `
      "tool-ask-user 行指向本组插件（实际：$($m.Groups['name'].Value.Trim())）"
  } else {
    Bad "组合文件里找不到 '- id: tool-ask-user' 行"
  }
}
Check (Test-Path (Join-Path $pluginDir 'index.js')) "插件文件存在：plugins\ask-detail\index.js"
# 插件已改为**零依赖**：preset 里不该再有 node_modules（旧版本留下的 junction 由安装器清掉）。
# 这一条同时守住 B 方案：插件不 import，就不会因 dsh 升级换 node 版本槽而断链。
$legacyLink = Join-Path $presetDir 'node_modules\@deepseek-ai\dsh-tools'
Check (-not (Test-Path $legacyLink)) "preset 里没有残留的 dsh-tools junction（插件已零依赖）"
$pluginText = Read-Text (Join-Path $pluginDir 'index.js')
Check (([regex]::Matches($pluginText, '(?m)^\s*import\s')).Count -eq 0) "插件源码零 import（不依赖 node_modules）"

if (Test-Path (Join-Path $pluginDir 'index.js')) {
  $url = 'file:///' + ((Join-Path $pluginDir 'index.js') -replace '\\', '/')
  $out = & node --input-type=module -e "await import('$url').then(m => console.log('plugin ok ' + Object.keys(m).join(',')))" 2>&1
  Check ($LASTEXITCODE -eq 0 -and ($out -join ' ') -like '*plugin ok*') "插件可 import（零依赖，无需 node_modules）：$($out -join ' ')"
}

# ── 2. profile 作用域 ────────────────────────────────────────────────────────
Section "profile 作用域（profile $Profile）"

$manifestPath = Join-Path $profileDir 'package.json'
$bytes = [System.IO.File]::ReadAllBytes($manifestPath)
$hasBom = ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
Check (-not $hasBom) "profile package.json 无 UTF-8 BOM"
$patchPath = Join-Path $profileDir 'cordis.patch.yml'
if (Test-Path $patchPath) {
  $pb = [System.IO.File]::ReadAllBytes($patchPath)
  Check (-not ($pb[0] -eq 0xEF -and $pb[1] -eq 0xBB -and $pb[2] -eq 0xBF)) "profile cordis.patch.yml 无 UTF-8 BOM"
}

$manifest = Read-Json $manifestPath
$bundles = @($manifest.dsh.profile.bundles)
Check ($bundles -contains 'dsh-extras') "bundles 里有 dsh-extras"
foreach ($m in @('dsh-restart-button', 'dsh-shutdown-button')) {
  Check ($bundles -notcontains $m) "bundles 里没有成员 $m（成员由组统一 insert，重复列会重复插入）"
}

$members = @('dsh-extras', 'dsh-restart-button', 'dsh-shutdown-button')
foreach ($name in $members) {
  $link = Join-Path $profileNm $name
  if (-not (Test-Path $link)) { Bad "缺少 junction：node_modules\$name"; continue }
  # .Target 在 PS 5.1 里是数组（哪怕是单目标），必须取标量，否则 -like 的结果不是布尔
  $target = @((Get-Item $link).Target)[0]
  $expected = if ($name -eq 'dsh-extras') { 'dsh-extras' } else { "dsh-extras\plugins\$name" }
  Check ([bool]($target -like "*$expected")) "junction $name -> $target"
  $dep = $manifest.dependencies.$name
  Check ($null -ne $dep -and $dep -like '*dsh-extras*') "依赖 $name = $dep"
}

foreach ($name in @('dsh-restart-button', 'dsh-shutdown-button')) {
  $pkgPath = Join-Path $profileNm "$name\package.json"
  if (-not (Test-Path $pkgPath)) { Bad "$name 的 package.json 通过 profile 不可达"; continue }
  $pkg = Read-Json $pkgPath
  Check ($pkg.name -eq $name) "$name 的包名与补丁层 insert 的名字一致（包名：$($pkg.name)）"
  Check (Test-Path (Join-Path $profileNm "$name\$($pkg.main)")) "$name 入口可达：$($pkg.main)"
  # 成员的客户端注册点已撤：UI 并入组的设置页，这一项为空才对
  Check ($null -eq $pkg.dsh.client) "$name 不再声明 dsh.client（UI 已并入组）"
}

# 组自己带客户端半边（设置页「通用插件设置」）与安装器（一键安装按钮）
$groupNm = Join-Path $profileNm 'dsh-extras'
if (Test-Path (Join-Path $groupNm 'package.json')) {
  $groupPkg = Read-Json (Join-Path $groupNm 'package.json')
  Check ($null -ne $groupPkg.dsh.client -and $groupPkg.dsh.client.platform -eq 'web') "组声明了 dsh.client.platform = web（设置页客户端半边）"
  Check (Test-Path (Join-Path $groupNm 'lib\client.js')) "组的客户端 bundle 存在：lib\client.js"
  Check (Test-Path (Join-Path $groupNm 'scripts\install.ps1')) "组的安装器存在：scripts\install.ps1（启动器自愈与 install.cmd 要用）"
} else {
  Bad '组的 package.json 通过 profile 不可达'
}

# ── 3. 运行中的宿主 ──────────────────────────────────────────────────────────
Section "运行中的宿主（127.0.0.1:$Port）"

foreach ($route in @('dsh-shutdown-button', 'dsh-restart-button')) {
  $url = "http://127.0.0.1:$Port/$route/api/status"
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
    $body = $r.Content | ConvertFrom-Json
    Ok "$route/api/status -> $($r.StatusCode) pid=$($body.pid)$(if ($body.bootId) { " bootId=$($body.bootId)" })"
  } catch {
    Bad "$route/api/status 无响应：$($_.Exception.Message)"
  }
}

# ── 4. 启动器自愈 ────────────────────────────────────────────────────────────
Section '启动器自愈（~/.dsh 的启动脚本）'
# 本脚本自己所在的仓库根：自愈注入的路径必须指回这里。只查"已注入"是不够的 ——
# 仓库被搬走后旧路径还在文件里，那样每次开机跑的都是旧副本的安装器（假绿过一次）。
$selfRoot = $PSScriptRoot
if ([string]::IsNullOrEmpty($selfRoot)) { $selfRoot = Split-Path -Parent $MyInvocation.MyCommand.Path }
$selfInstaller = Join-Path (Resolve-Path (Join-Path $selfRoot '..')).Path 'scripts\install.ps1'
Write-Host "  [info] 本仓库的安装器：$selfInstaller"
$trayPath = Join-Path $dshHome 'dsh-tray.ps1'
$cmdPath  = Join-Path $dshHome 'launch-dsh-web.cmd'
if (Test-Path $trayPath) {
  $trayText = Read-Text $trayPath
  Check ($trayText.Contains('function Invoke-ExtrasInstaller')) 'dsh-tray.ps1 已注入启动前自愈'
  # 必须用单引号串：双引号里的 \$installer 会被 PowerShell 当变量展开成空串，正则就永远不匹配（踩过一次）
  $trayIns = [regex]::Match($trayText, '(?m)^[ \t]*\$installer = ''(?<path>[^'']*)''')
  Check ($trayIns.Success -and $trayIns.Groups['path'].Value -eq $selfInstaller) 'dsh-tray.ps1 的自愈路径指向本仓库'
} else {
  Write-Host '  [skip] 没有 dsh-tray.ps1（这台机器的启动方式不同）'
}
if (Test-Path $cmdPath) {
  $cmdText = Read-Text $cmdPath
  Check ($cmdText.Contains('dsh-extras self-heal')) 'launch-dsh-web.cmd 已注入启动前自愈'
  $cmdMarkerIdx = $cmdText.IndexOf('dsh-extras self-heal')
  $cmdPaths = @([regex]::Matches($cmdText, '"(?<path>[^"\r\n]*\\scripts\\install\.ps1)"') | Where-Object { $_.Index -gt $cmdMarkerIdx })
  $cmdStale = @($cmdPaths | Where-Object { $_.Groups['path'].Value -ne $selfInstaller })
  Check ($cmdPaths.Count -ge 1 -and $cmdStale.Count -eq 0) "launch-dsh-web.cmd 的自愈路径指向本仓库（$($cmdPaths.Count) 处）"
} else {
  Write-Host '  [skip] 没有 launch-dsh-web.cmd'
}
$extrasLog = Join-Path $dshHome 'dsh-extras-install.log'
if (Test-Path $extrasLog) {
  $li = Get-Item $extrasLog
  Write-Host ('  [info] 自愈日志：{0} 字节，最后写入 {1}' -f $li.Length, $li.LastWriteTime)
} else {
  Write-Host '  [info] 自愈日志尚未生成（用快捷方式/托盘冷启动一次就会出现）'
}

Section '结论'
Write-Host "PASS=$pass  FAIL=$fail"
if ($fail -eq 0) {
  Write-Host '全部通过。' -ForegroundColor Green
  Write-Host '注意：这一轮的 pid/bootId 是当前进程的 —— 重启后再跑一次，pid 变了才说明新布局真的被加载。'
  exit 0
} else {
  Write-Host '有失败项，见上面 [FAIL]。' -ForegroundColor Red
  exit 1
}
