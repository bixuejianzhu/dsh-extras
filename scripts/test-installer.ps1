# Local regression test for the installer's launcher self-heal and junction handling.
# ASCII-only on purpose: PS 5.1 parses a BOM-less script as ANSI, so Chinese here would break it.
#
#   powershell -File scripts/test-installer.ps1
#
# It copies this repo into a temp dir, builds a fake $DSH_HOME, and runs the installer against
# that fake home -- nothing real is touched (no profile, no preset, no launcher outside the temp
# dir). Exit code 0 = all green, 1 = a check failed.
#
# Path assertions compare FILES BY CONTENT, not by spelling. The installer derives its paths with
# Resolve-Path while this test builds them with Join-Path, and on a given machine the same location
# can have more than one spelling (8.3 short names -- GitHub's windows runner reaches TEMP through
# one -- plus case and trailing separators). Raw string comparison failed 5 checks on that runner
# for no real reason. A spelling difference is now reported as a note, never as a FAIL.

$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
function Read-T([string]$p) { return [System.IO.File]::ReadAllText($p, $utf8NoBom) }
function Has-Bom([string]$p) {
  $b = [System.IO.File]::ReadAllBytes($p)
  return ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)
}
function Hash([string]$p) { return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash }
function Leaf([string]$p) { return (Split-Path -Leaf $p) }

$pass = 0
$fail = 0
# Any unexpected exception counts as FAIL and continues (a silent stop is the worst outcome for CI).
trap {
  $script:fail++
  $msg = "unexpected: $($_.Exception.Message) (line $($_.InvocationInfo.ScriptLineNumber))"
  Write-Host "  [FAIL] $msg"
  Write-Host "::error::$msg"
  continue
}
function Ok([string]$m) { $script:pass++; Write-Host "  [PASS] $m" }
function Bad([string]$m) { $script:fail++; Write-Host "  [FAIL] $m" }
function Check($c, [string]$m) { if ($c) { Ok $m } else { Bad $m } }

# Canonical spelling of a path: let the filesystem name it, then fold case and separators.
function Canon([string]$p) {
  if ([string]::IsNullOrEmpty($p)) { return '' }
  $q = $p
  try { $q = (Resolve-Path -LiteralPath $p -ErrorAction Stop).Path } catch { }
  return (($q -replace '/', '\').TrimEnd('\')).ToLowerInvariant()
}
function Same-Path([string]$a, [string]$b) {
  if ([string]::IsNullOrEmpty($a) -or [string]::IsNullOrEmpty($b)) { return $false }
  return ((Canon $a) -eq (Canon $b))
}
# What we actually care about is that the self-heal calls THIS repo's installer. Prove it by
# content: the same file reached through two different spellings hashes the same.
function Test-IsInstaller([string]$Path, [string]$Expected) {
  if ([string]::IsNullOrEmpty($Path)) { return $false }
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  try { return ((Hash $Path) -eq (Hash $Expected)) } catch { return $false }
}
function Check-InstallerPaths([string[]]$Actual, [string]$Expected, [string]$m) {
  $bad = @($Actual | Where-Object { -not (Test-IsInstaller $_ $Expected) })
  if ($Actual.Count -ge 1 -and $bad.Count -eq 0) {
    Ok $m
    $odd = @($Actual | Where-Object { -not (Same-Path $_ $Expected) })
    if ($odd.Count -gt 0) { Write-Host "         note: same installer, spelled differently: $($odd -join ' | ')" }
  } else {
    Bad $m
    Write-Host "         expected: $Expected"
    Write-Host "         actual  : $($Actual -join ' | ')"
  }
}
# The self-heal block writes the installer path in two shapes; pull them back out to compare.
function Get-TrayPath([string]$text) {
  $m = [regex]::Match($text, '(?m)^[ \t]*\$installer = ''(?<p>[^'']*)''')
  if ($m.Success) { return $m.Groups['p'].Value }
  return ''
}
function Get-CmdPaths([string]$text) {
  return @([regex]::Matches($text, '"(?<p>[^"\r\n]*\\scripts\\install\.ps1)"') | ForEach-Object { $_.Groups['p'].Value })
}

$selfDir = $PSScriptRoot
if ([string]::IsNullOrEmpty($selfDir)) { $selfDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
$srcRepo = (Resolve-Path -LiteralPath (Join-Path $selfDir '..')).Path
$root = Join-Path $env:TEMP ('extras-repoint-' + [guid]::NewGuid().ToString('N'))
$oldDir = 'C:\OldPlace\dsh-extras'
$fakeHome = Join-Path $root 'home'
$tray = Join-Path $fakeHome 'dsh-tray.ps1'
$cmd = Join-Path $fakeHome 'launch-dsh-web.cmd'
$copyRoot = Join-Path $root 'newplace'

New-Item -ItemType Directory -Force -Path $copyRoot | Out-Null
Copy-Item -LiteralPath $srcRepo -Destination $copyRoot -Recurse -Force
# Ask the filesystem how it spells the copy instead of trusting our own concatenation: the
# installer's paths come out of Resolve-Path, so ours has to as well (see the header note).
$newRepo = (Resolve-Path -LiteralPath (Join-Path $copyRoot (Leaf $srcRepo))).Path
$newInstaller = Join-Path $newRepo 'scripts\install.ps1'
Write-Host "[info] repo under test : $newRepo"
Write-Host "[info] TEMP            : $env:TEMP"

# install.ps1 step 0 resolves the live install through this junction; point it at the real one,
# or at a stand-in when this machine has never started dsh (keeps the test runnable in CI).
$realDshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$realLink = Join-Path $realDshHome 'profiles\node_modules\@deepseek-ai\dsh-agent-presets'
if (Test-Path $realLink) {
  $linkTarget = @((Get-Item -LiteralPath $realLink).Target)[0]
} else {
  Write-Host "[info] no live install at $realLink - using a stand-in @deepseek-ai dir"
  $linkTarget = Join-Path $root 'standin-pkgs\@deepseek-ai'
  New-Item -ItemType Directory -Force -Path (Join-Path $linkTarget 'dsh-agent-presets') | Out-Null
}
New-Item -ItemType Directory -Force -Path (Join-Path $fakeHome 'profiles\node_modules\@deepseek-ai') | Out-Null
New-Item -ItemType Junction -Path (Join-Path $fakeHome 'profiles\node_modules\@deepseek-ai\dsh-agent-presets') -Target $linkTarget | Out-Null

function New-FakeTray([string]$dir) {
  $t = @'
$ErrorActionPreference = 'Stop'
# --- extras self-heal (injected by the dsh-extras installer) ---
$ExtrasLog = Join-Path $DshHome 'dsh-extras-install.log'
function Invoke-ExtrasInstaller {
    $installer = '__DIR__\scripts\install.ps1'
    if (-not (Test-Path $installer)) {
        Write-Log ('extras installer not found, skipped: ' + $installer)
        return
    }
    try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
    } catch {
        Write-Log ('extras installer failed: ' + $_.Exception.Message)
    }
}
function Start-DshWeb { Write-Host 'fake' }
Invoke-ExtrasInstaller
[void](Start-DshWeb)
'@
  [System.IO.File]::WriteAllText($tray, $t.Replace('__DIR__', $dir), $utf8Bom)
}
function New-FakeCmd([string]$dir) {
  $c = @"
@echo off
rem -- dsh-extras self-heal: sync the plugin group before starting dsh (idempotent, ~2s) --
if exist "$dir\scripts\install.ps1" (
  echo Syncing dsh-extras plugin group...
  powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$dir\scripts\install.ps1" >> "%USERPROFILE%\.dsh\dsh-extras-install.log" 2>&1
)
node "C:\fake\bin.js" web
"@
  [System.IO.File]::WriteAllText($cmd, $c, $utf8NoBom)
}
function Run-Installer([string[]]$Switches = @('-SkipPreset', '-SkipProfile')) {
  $env:DSH_HOME = $fakeHome
  $argv = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $newInstaller) + $Switches
  $out = & powershell.exe @argv 2>&1
  $script:lastOut = ($out | Out-String)
}

Write-Host "== case 1: fresh injection (clean launchers) =="
[System.IO.File]::WriteAllText($tray, "`$ErrorActionPreference = 'Stop'`nfunction Start-DshWeb { Write-Host 'fake' }`n[void](Start-DshWeb)`n", $utf8Bom)
[System.IO.File]::WriteAllText($cmd, "@echo off`nnode `"C:\fake\bin.js`" web`n", $utf8NoBom)
Run-Installer
Check-InstallerPaths @(Get-TrayPath (Read-T $tray)) $newInstaller 'tray: fresh injection points at the new repo'
Check-InstallerPaths (Get-CmdPaths (Read-T $cmd)) $newInstaller 'cmd: fresh injection points at the new repo'
Check (Has-Bom $tray) 'tray: BOM preserved'
$pe = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($tray, [ref]$null, [ref]$pe)
Check (@($pe).Count -eq 0) 'tray: injected file still parses'

Write-Host "== case 2: stale path -> re-point (the relocation case) =="
New-FakeTray $oldDir
New-FakeCmd $oldDir
$cmdBefore = Read-T $cmd
Check ((Read-T $tray).Contains($oldDir)) 'tray: setup has the OLD path'
Run-Installer
$trayNow = Read-T $tray
$cmdNow = Read-T $cmd
Check (-not $trayNow.Contains($oldDir)) 'tray: old path gone'
Check-InstallerPaths @(Get-TrayPath $trayNow) $newInstaller 'tray: re-pointed to the new repo'
Check (Has-Bom $tray) 'tray: BOM preserved through re-point'
$pe = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($tray, [ref]$null, [ref]$pe)
Check (@($pe).Count -eq 0) 'tray: still parses after re-point'
Check ($trayNow.Contains('Invoke-ExtrasInstaller')) 'tray: call line still present'
Check ($trayNow.Contains('[void](Start-DshWeb)')) 'tray: start line still present'
Check (-not $cmdNow.Contains($oldDir)) 'cmd: old path gone'
Check-InstallerPaths (Get-CmdPaths $cmdNow) $newInstaller 'cmd: both occurrences re-pointed'
Check ((($cmdNow -split "`n").Count) -eq (($cmdBefore -split "`n").Count)) 'cmd: line count unchanged'
Check ($cmdNow.TrimEnd().EndsWith('web')) 'cmd: file still ends with the dsh start line'

Write-Host "== case 3: already correct -> skip, file untouched =="
$h1 = Hash $tray; $h2 = Hash $cmd
Run-Installer
Check ((Hash $tray) -eq $h1) 'tray: byte-identical when path already correct'
Check ((Hash $cmd) -eq $h2) 'cmd: byte-identical when path already correct'
Check ($script:lastOut.Trim().Length -gt 0) 'installer produced output on the skip path'

Write-Host "== case 4: unrecognised shape -> do not touch =="
[System.IO.File]::WriteAllText($tray, ("`$ErrorActionPreference = 'Stop'`nfunction Invoke-ExtrasInstaller { }`n[void](Start-DshWeb)`n"), $utf8Bom)
$h3 = Hash $tray
Run-Installer
Check ((Hash $tray) -eq $h3) 'tray: untouched when the $installer line cannot be found'

Write-Host "== case 5: junction swap must not recurse into the target =="
# Fake profile so that step B really creates/swaps junctions, then check a pre-existing
# junction (pointing at a sentinel dir) is unlinked without its target being touched.
$profDir = Join-Path $fakeHome 'profiles\web'
New-Item -ItemType Directory -Force -Path (Join-Path $profDir 'node_modules') | Out-Null
[System.IO.File]::WriteAllText((Join-Path $profDir 'package.json'), '{"dependencies":{},"dsh":{"profile":{"bundles":[]}}}', $utf8NoBom)
$sentinel = Join-Path $root 'sentinel-target'
New-Item -ItemType Directory -Force -Path $sentinel | Out-Null
[System.IO.File]::WriteAllText((Join-Path $sentinel 'keep.txt'), 'keep', $utf8NoBom)
$repoLink = Join-Path $profDir 'node_modules\dsh-extras'
New-Item -ItemType Junction -Path $repoLink -Target $sentinel | Out-Null
Run-Installer -Switches @('-SkipPreset', '-SkipLauncher')
Check ($script:lastOut.Contains('junction: node_modules\dsh-extras')) 'installer replaced the junction'
Check (Test-Path (Join-Path $sentinel 'keep.txt')) 'sentinel FILE survived the junction swap'
$link = Get-Item -LiteralPath $repoLink -Force
$linkTarget = @($link.Target)[0]
Check (Test-IsInstaller (Join-Path $linkTarget 'scripts\install.ps1') $newInstaller) 'junction now points at the repo'
if (-not (Same-Path $linkTarget $newRepo)) { Write-Host "         note: same repo, spelled differently: $linkTarget" }
Check (Test-Path (Join-Path $newRepo 'README.md')) 'the repo itself is intact'
Check (Test-Path (Join-Path $profDir 'node_modules\dsh-restart-button')) 'members were junctioned too'

Write-Host "== case 6: repo source encoding (BOM guard) =="
# PS 5.1 parses a BOM-less .ps1 as ANSI, so any non-ASCII byte in one becomes mojibake that can
# swallow a quote and break the whole file. Every .ps1 in the SOURCE repo that holds a non-ASCII
# byte must therefore carry the UTF-8 BOM. Learned the hard way: a tool that rewrites files
# dropped the BOM on verify.ps1 and it stopped parsing. ASCII-only scripts need no BOM -- this
# file is one of them on purpose, so keep this block ASCII.
$guarded = 0
foreach ($ps1File in @(Get-ChildItem -LiteralPath $srcRepo -Recurse -File -Filter *.ps1 | Where-Object { $_.FullName -notlike '*\.git\*' })) {
  $bytes = [System.IO.File]::ReadAllBytes($ps1File.FullName)
  $nonAscii = $false
  for ($i = 0; $i -lt $bytes.Length; $i++) { if ($bytes[$i] -gt 0x7F) { $nonAscii = $true; break } }
  if ($nonAscii) {
    $guarded++
    Check (Has-Bom $ps1File.FullName) "BOM: $(Leaf $ps1File.FullName) holds non-ASCII -> UTF-8 BOM present"
  } else {
    Write-Host "  [info] BOM: $(Leaf $ps1File.FullName) is ASCII-only -> no BOM required"
  }
}
# Keep the guard from passing vacuously: if a rename or a filter change makes the scan find
# nothing, zero files get checked and every assertion above silently disappears.
Check ($guarded -ge 1) "BOM: scan is non-vacuous ($guarded script(s) with non-ASCII were checked)"

Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "PASS=$pass FAIL=$fail"
if ($fail -gt 0) {
  Write-Host "::error::test-installer: $fail check(s) failed (see the log above for expected/actual)"
  exit 1
}
