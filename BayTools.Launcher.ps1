param(
  [switch]$ForceRestart,
  [switch]$Validate,
  [switch]$PackageHash,
  [switch]$Console
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Address = 'http://127.0.0.1:4319'
$ExpectedApiVersion = 17
$LogPath = Join-Path $ProjectRoot 'Doc\logs\baytools.log'
$LauncherLogPath = Join-Path $ProjectRoot 'Doc\logs\baytools-launcher.log'
$StatusPath = Join-Path $ProjectRoot 'Doc\logs\baytools-startup.status'
$DependencyMarkerPath = Join-Path $ProjectRoot 'node_modules\.baytools-dependency-hash'
$BuildMetaPath = Join-Path $ProjectRoot 'dist-server\build-meta.json'

function Write-LauncherTrace([string]$Message) {
  [System.IO.Directory]::CreateDirectory((Split-Path -Parent $LauncherLogPath)) | Out-Null
  Add-Content -LiteralPath $LauncherLogPath -Value "$(Get-Date -Format o) $Message" -Encoding UTF8
}

trap {
  $message = $_.Exception.Message
  Write-LauncherTrace "ERROR $message"
  try {
    $popup = New-Object -ComObject WScript.Shell
    $null = $popup.Popup("BayTools 启动器出错：`n`n$message`n`n请查看 Doc\logs\baytools-launcher.log。", 0, 'BayTools', 16)
  } catch {}
  exit 1
}

function Get-FileSha256([string]$Path) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    return -join ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') })
  } finally {
    $stream.Dispose()
    $sha.Dispose()
  }
}

function Get-StringSha256([string]$Value) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    return -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') })
  } finally {
    $sha.Dispose()
  }
}

function Get-DependencyVersion {
  $lockPath = Join-Path $ProjectRoot 'package-lock.json'
  if (-not (Test-Path -LiteralPath $lockPath)) { throw '缺少 package-lock.json，无法执行可重复的 npm 安装。' }
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($null -eq $nodeCommand) { throw '未找到 Node.js，请安装 Node.js 20.18 或更高版本。' }
  $nodeVersion = (& $nodeCommand.Source --version).Trim()
  $nodeMajorVersion = ($nodeVersion -replace '^v(\d+).*$', '$1')
  return Get-StringSha256 "$(Get-FileSha256 $lockPath)|node-$nodeMajorVersion|$env:OS|$env:PROCESSOR_ARCHITECTURE"
}

if ($PackageHash) {
  Get-DependencyVersion
  exit 0
}

function Get-SourceVersion {
  $files = @()
  foreach ($directory in @('public', 'scripts', 'server', 'shared', 'src')) {
    $path = Join-Path $ProjectRoot $directory
    if (Test-Path -LiteralPath $path) {
      $files += Get-ChildItem -LiteralPath $path -Recurse -File
    }
  }
  foreach ($name in @('package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.server.json', 'vite.config.ts', 'BayTools.cmd', 'BayTools.vbs', 'BayTools.Launcher.ps1')) {
    $path = Join-Path $ProjectRoot $name
    if (Test-Path -LiteralPath $path) { $files += Get-Item -LiteralPath $path }
  }
  $parts = foreach ($file in ($files | Sort-Object -Property FullName -Unique)) {
    $relativePath = $file.FullName.Substring($ProjectRoot.Length).TrimStart('\').Replace('\', '/')
    $hash = Get-FileSha256 $file.FullName
    "$relativePath=$hash"
  }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($parts -join "`n"))
    return -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') })
  } finally {
    $sha.Dispose()
  }
}

function Get-ServiceSession {
  try {
    return Invoke-RestMethod -Uri "$Address/api/session" -Method Get -TimeoutSec 1
  } catch {
    return $null
  }
}

function Test-CompatibleSession($Session, [string]$SourceVersion) {
  if ($null -eq $Session) { return $false }
  $hasSourceVersion = $Session.PSObject.Properties.Name -contains 'sourceVersion'
  return $Session.apiVersion -eq $ExpectedApiVersion -and $hasSourceVersion -and $Session.sourceVersion -eq $SourceVersion
}

function Test-DependencyInstallRequired {
  $vite = Join-Path $ProjectRoot 'node_modules\.bin\vite.cmd'
  $pnpmLayout = Join-Path $ProjectRoot 'node_modules\.modules.yaml'
  if (-not (Test-Path -LiteralPath $vite)) { return $true }
  if (Test-Path -LiteralPath $pnpmLayout) { return $true }
  if (-not (Test-Path -LiteralPath $DependencyMarkerPath)) { return $true }
  $installed = (Get-Content -LiteralPath $DependencyMarkerPath -Raw).Trim()
  return $installed -ne $dependencyVersion
}

function Test-BuildRequired {
  if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'dist\index.html'))) { return $true }
  if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'dist-server\server\index.js'))) { return $true }
  if (-not (Test-Path -LiteralPath $BuildMetaPath)) { return $true }
  try {
    $metadata = Get-Content -LiteralPath $BuildMetaPath -Raw | ConvertFrom-Json
    return $metadata.schemaVersion -ne 1 -or
      $metadata.sourceVersion -ne $sourceVersion -or
      $metadata.dependencyVersion -ne $dependencyVersion -or
      $metadata.apiVersion -ne $ExpectedApiVersion
  } catch {
    return $true
  }
}

$sourceVersion = Get-SourceVersion
$dependencyVersion = Get-DependencyVersion
$installRequired = Test-DependencyInstallRequired
$buildRequired = Test-BuildRequired
Write-LauncherTrace "source=$sourceVersion dependency=$dependencyVersion installRequired=$installRequired buildRequired=$buildRequired"
if ($Validate) {
  [pscustomobject]@{ apiVersion = $ExpectedApiVersion; sourceVersion = $sourceVersion; dependencyVersion = $dependencyVersion; installRequired = $installRequired; buildRequired = $buildRequired } | ConvertTo-Json -Compress
  exit 0
}

$session = Get-ServiceSession
Write-LauncherTrace "currentApi=$(if ($null -eq $session) { 'none' } else { $session.apiVersion }) forceRestart=$ForceRestart"
if (-not $ForceRestart -and (Test-CompatibleSession $session $sourceVersion)) {
  Start-Process $Address
  exit 0
}

[System.IO.Directory]::CreateDirectory((Split-Path -Parent $StatusPath)) | Out-Null
Remove-Item -LiteralPath $StatusPath -Force -ErrorAction SilentlyContinue

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = 'BayTools 启动器'
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.ClientSize = New-Object System.Drawing.Size(460, 176)
$form.MaximizeBox = $false
$form.MinimizeBox = $true
$form.ControlBox = $false
$form.ShowInTaskbar = $true
$iconPath = Join-Path $ProjectRoot 'public\baytools-shortcut-v2.ico'
if (Test-Path -LiteralPath $iconPath) { $form.Icon = New-Object System.Drawing.Icon($iconPath) }

$title = New-Object System.Windows.Forms.Label
$title.Location = New-Object System.Drawing.Point(22, 20)
$title.Size = New-Object System.Drawing.Size(416, 28)
$title.Font = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
$title.Text = if ($installRequired) { '正在准备 BayTools 依赖' } elseif ($buildRequired) { '正在构建新版 BayTools' } elseif ($null -ne $session) { '正在更新 BayTools 后台服务' } else { '正在启动 BayTools' }
$form.Controls.Add($title)

$detail = New-Object System.Windows.Forms.Label
$detail.Location = New-Object System.Drawing.Point(24, 56)
$detail.Size = New-Object System.Drawing.Size(412, 38)
$detail.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$detail.Text = if ($installRequired) { '需要下载或更新依赖。已有旧服务会继续运行，准备完成后才切换。' } elseif ($buildRequired) { '正在生成新版文件；构建失败时仍保留现有可用版本。' } else { '正在检查并启动本地服务，完成后会自动打开浏览器。' }
$form.Controls.Add($detail)

$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Location = New-Object System.Drawing.Point(25, 101)
$progress.Size = New-Object System.Drawing.Size(410, 9)
$progress.Style = 'Marquee'
$progress.MarqueeAnimationSpeed = 28
$form.Controls.Add($progress)

$hint = New-Object System.Windows.Forms.Label
$hint.Location = New-Object System.Drawing.Point(24, 124)
$hint.Size = New-Object System.Drawing.Size(300, 30)
$hint.ForeColor = [System.Drawing.Color]::DimGray
$hint.Text = '关闭浏览器页签不会停止服务；再次启动会自动检查并修复。'
$form.Controls.Add($hint)

$logButton = New-Object System.Windows.Forms.Button
$logButton.Location = New-Object System.Drawing.Point(342, 123)
$logButton.Size = New-Object System.Drawing.Size(93, 28)
$logButton.Text = '打开日志'
$logButton.Add_Click({
  if (Test-Path -LiteralPath $LogPath) { Start-Process -FilePath 'explorer.exe' -ArgumentList @('/select,', $LogPath) }
})
$form.Controls.Add($logButton)

$statusText = @{
  checking = @('正在检查运行环境', '检查 Node.js、npm 与已安装依赖。')
  installing = @('正在下载或更新依赖', '此步骤可能需要几分钟，完成后会继续构建。')
  building = @('正在构建 BayTools', '正在临时目录生成最新文件；旧服务仍可继续使用。')
  stopping = @('正在停止旧版服务', '检测到旧版本或源码变化，正在安全重启。')
  starting = @('正在启动本地服务', '服务就绪后会自动打开浏览器。')
}
$failureText = @{
  'missing-node' = '未找到 Node.js，请安装 Node.js 20.18 或更高版本。'
  'missing-npm' = '未找到 npm，请重新安装并启用 npm。'
  'install-failed' = '依赖安装失败。请检查网络和日志。'
  'build-failed' = 'BayTools 构建失败。请查看日志。'
  'service-failed' = 'BayTools 服务启动失败。请查看日志。'
  rollback = '新版本启动失败，已经恢复之前的可用版本。'
  stopped = 'BayTools 服务已停止。'
}

$runId = [Guid]::NewGuid().ToString('N')
$workerArguments = @(
  'scripts\baytools-worker.mjs',
  '--run-id', $runId,
  '--source-version', $sourceVersion,
  '--dependency-version', $dependencyVersion,
  '--api-version', [string]$ExpectedApiVersion
)
if ($null -ne $session -or $ForceRestart) { $workerArguments += '--restart' }
$nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
Write-LauncherTrace "starting worker runId=$runId"
if ($Console) {
  & $nodeCommand @workerArguments
  exit $LASTEXITCODE
}
$workerProcess = Start-Process -FilePath $nodeCommand -ArgumentList $workerArguments -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru
Write-LauncherTrace "background worker started pid=$($workerProcess.Id)"

$form.Show()
Write-LauncherTrace 'progress window shown'
$deadline = [DateTime]::UtcNow.AddMinutes(30)
$lastStage = ''
$failed = $false
while ($form.Visible) {
  [System.Windows.Forms.Application]::DoEvents()
  if (-not $failed -and (Test-Path -LiteralPath $StatusPath)) {
    $statusLine = (Get-Content -LiteralPath $StatusPath -Raw -ErrorAction SilentlyContinue).Trim()
    $statusParts = $statusLine -split '\|', 3
    $statusRunId = if ($statusParts.Count -ge 2) { $statusParts[0] } else { '' }
    $stage = if ($statusParts.Count -ge 2) { $statusParts[1] } else { $statusLine }
    $statusDetail = if ($statusParts.Count -eq 3) { $statusParts[2] } else { '' }
    if ($statusRunId -eq $runId -and $stage -and $stage -ne $lastStage) {
      $lastStage = $stage
      if ($statusText.ContainsKey($stage)) {
        $title.Text = $statusText[$stage][0]
        $detail.Text = $statusText[$stage][1]
      } elseif ($failureText.ContainsKey($stage)) {
        $failed = $true
        $title.Text = 'BayTools 启动失败'
        $detail.Text = $failureText[$stage] + $(if ($statusDetail) { "`n$statusDetail" } else { '' })
        $progress.Style = 'Blocks'
        $progress.Value = 0
        $form.ControlBox = $true
        if ($null -ne (Get-ServiceSession)) { Start-Process $Address }
      }
    }
  }
  if (-not $failed) {
    $currentSession = Get-ServiceSession
    if (Test-CompatibleSession $currentSession $sourceVersion) {
      $title.Text = 'BayTools 已就绪'
      $detail.Text = '正在打开浏览器。'
      [System.Windows.Forms.Application]::DoEvents()
      Start-Sleep -Milliseconds 300
      $form.Close()
      Start-Process $Address
      Write-LauncherTrace 'service ready and browser opened'
      break
    }
    if ([DateTime]::UtcNow -gt $deadline) {
      $failed = $true
      $title.Text = 'BayTools 启动超时'
      $detail.Text = '任务运行超过 30 分钟，请打开日志检查。'
      $progress.Style = 'Blocks'
      $progress.Value = 0
      $form.ControlBox = $true
    }
    if ($workerProcess.HasExited -and $null -eq (Get-ServiceSession)) {
      $failed = $true
      $title.Text = 'BayTools 启动失败'
      $detail.Text = '后台启动任务已经退出，请打开日志检查。'
      $progress.Style = 'Blocks'
      $progress.Value = 0
      $form.ControlBox = $true
    }
  }
  Start-Sleep -Milliseconds 250
}
