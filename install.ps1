#requires -Version 5.1
[CmdletBinding()]
param(
  [string]$Version = 'latest',
  [string]$ArchivePath,
  [string]$ChecksumPath,
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'MCodeBun'),
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ([Environment]::OSVersion.Platform -ne 'Win32NT' -or -not [Environment]::Is64BitOperatingSystem) { throw 'MCode Bun requires Windows x64 (Windows 10 1809 or later).' }
if ([Environment]::OSVersion.Version.Build -lt 17763) { throw 'MCode Bun requires Windows 10 version 1809 or later.' }
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
if ($InstallRoot -eq [IO.Path]::GetPathRoot($InstallRoot) -or $InstallRoot -eq $env:USERPROFILE -or $InstallRoot -eq $env:LOCALAPPDATA) { throw 'Refusing an unsafe installation root.' }
$ancestor = $InstallRoot
while ($ancestor) {
  if (Test-Path -LiteralPath $ancestor) {
    if ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Installation ancestry must not be redirected.' }
  }
  $parent = [IO.Directory]::GetParent($ancestor)
  $ancestor = if ($parent) { $parent.FullName } else { $null }
}
$ownerPath = Join-Path $InstallRoot '.mcode-bun-owner'
$ownerValue = 'Guihal/mcode-bun;schema=1'
if (Test-Path -LiteralPath $InstallRoot) {
  if ((Get-Item -LiteralPath $InstallRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Installation root must not be redirected.' }
  if (-not (Test-Path -LiteralPath $ownerPath)) {
    if (@(Get-ChildItem -LiteralPath $InstallRoot -Force).Count) { throw 'Refusing an unrelated installation root.' }
  } elseif (([IO.File]::ReadAllText($ownerPath)).Trim() -ne $ownerValue) { throw 'Unrecognized installation owner.' }
} elseif ($Uninstall) { Write-Output 'MCode Bun is not installed.'; return }
[IO.Directory]::CreateDirectory($InstallRoot) | Out-Null
$lockPath = Join-Path $InstallRoot '.install.lock'
if ((Test-Path -LiteralPath $lockPath) -and ((Get-Item -LiteralPath $lockPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Installation lock must not be redirected.' }
try { $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) } catch { throw 'Another MCode Bun installation is in progress.' }
$staging = $null
$download = $null
function Write-Utf8([string]$Path, [string]$Text) { [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false))) }
function Update-Path([bool]$Remove) {
  $bin = Join-Path $InstallRoot 'bin'
  foreach ($target in @('User', 'Process')) {
    $old = [Environment]::GetEnvironmentVariable('Path', $target)
    $entries = @($old -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ine $bin.TrimEnd('\') })
    if (-not $Remove) { $entries = @($bin) + $entries }
    [Environment]::SetEnvironmentVariable('Path', ($entries -join ';'), $target)
  }
}
function Verify-File([string]$Root, [string]$Relative) {
  if (-not $Relative -or $Relative.Contains('\') -or $Relative.Contains(':') -or $Relative.StartsWith('/') -or @($Relative.Split('/') | Where-Object { -not $_ -or $_ -eq '.' -or $_ -eq '..' }).Count) { throw 'Invalid archive manifest path.' }
  $full = [IO.Path]::GetFullPath((Join-Path $Root $Relative))
  if (-not $full.StartsWith($Root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive path escapes installation.' }
  $item = Get-Item -LiteralPath $full -Force
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Archive file is redirected: $Relative" }
  $parent = $item.Directory
  while ($parent) {
    if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Archive ancestor is redirected: $Relative" }
    $parent = $parent.Parent
  }
  return $full
}
function Verify-Archive([string]$Root) {
  $manifest = Get-Content -LiteralPath (Join-Path $Root 'manifest.json') -Raw | ConvertFrom-Json
  if ($manifest.schemaVersion -ne 1 -or $manifest.distribution -ne 'mcode-bun' -or $manifest.target -ne 'win32-x64' -or $manifest.upstreamVersion -ne '0.6.12' -or $manifest.bunVersion -ne '1.4.3' -or $manifest.release -notmatch '^0\.6\.12-bun\.[0-9]+$') { throw 'Unsupported distribution manifest.' }
  $expected = @('manifest.json')
  foreach ($entry in $manifest.files.PSObject.Properties) {
    $file = Verify-File $Root $entry.Name
    if ((Get-Item -LiteralPath $file).Length -ne $entry.Value.size -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ine $entry.Value.sha256) { throw "Archive integrity failed: $($entry.Name)" }
    $expected += $entry.Name
  }
  foreach ($file in Get-ChildItem -LiteralPath $Root -Recurse -Force -File) {
    $relative = $file.FullName.Substring($Root.Length + 1).Replace('\', '/')
    if ($expected -cnotcontains $relative) { throw "Unlisted archive file: $relative" }
  }
  foreach ($relative in @('mcode.exe','runtime/bun.exe','runtime/sqlite.cjs','runtime/installation.cjs','package/cli.js','package/package.json','package/image-preview-worker.js','package/photon_rs_bg.wasm','package/embedded/mcode-tools/cli.mjs')) { Verify-File $Root $relative | Out-Null }
  $pkg = Get-Content -LiteralPath (Join-Path $Root 'package/package.json') -Raw | ConvertFrom-Json
  if ($pkg.name -ne '@minimax-ai/code' -or $pkg.version -ne $manifest.upstreamVersion) { throw 'Archive package identity mismatch.' }
  $data = Join-Path $Root '.smoke-data'
  $oldData = $env:MINIMAX_DATA_DIR; $oldConfig = $env:MCODE_CONFIG_DIR
  try {
    $env:MINIMAX_DATA_DIR = $data; $env:MCODE_CONFIG_DIR = $data
    $reported = & (Join-Path $Root 'mcode.exe') --version
    if ($LASTEXITCODE -ne 0 -or $reported.Trim() -ne '0.6.12') { throw 'Compiled command smoke check failed.' }
    $reported = & (Join-Path $Root 'runtime/bun.exe') (Join-Path $Root 'package/mcode-tools.js') --version
    if ($LASTEXITCODE -ne 0 -or $reported.Trim() -ne '0.0.6') { throw 'Tools command smoke check failed.' }
  } finally { $env:MINIMAX_DATA_DIR = $oldData; $env:MCODE_CONFIG_DIR = $oldConfig; if (Test-Path -LiteralPath $data) { Remove-Item -LiteralPath $data -Recurse -Force } }
  return $manifest
}
try {
  Write-Utf8 $ownerPath $ownerValue
  $bin = Join-Path $InstallRoot 'bin'
  if ($Uninstall) {
    # Only recorded payload paths and installer-authored routing are removed.
    # Unknown files are retained, including anything a user placed in this root.
    # Validate the whole uninstall set before changing routing or deleting files.
    $ownedPayloads = @(); $shimHashes = @(); $ownedCommands = @()
    foreach ($release in @(Get-ChildItem -LiteralPath (Join-Path $InstallRoot 'releases') -Directory -ErrorAction SilentlyContinue)) {
      $manifestPath = Join-Path $release.FullName 'manifest.json'
      if (-not (Test-Path -LiteralPath $manifestPath)) { continue }
      $manifestPath = Verify-File $release.FullName 'manifest.json'
      $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
      if ($manifest.distribution -ne 'mcode-bun') { continue }
      $shimHashes += $manifest.files.'runtime/command-shim.exe'.sha256
      foreach ($entry in $manifest.files.PSObject.Properties) {
        $file = Verify-File $release.FullName $entry.Name
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ieq $entry.Value.sha256) { $ownedPayloads += $file }
      }
    }
    foreach ($name in @('mcode.exe','mcode-tools.exe')) {
      $file = Join-Path $bin $name
      if (Test-Path -LiteralPath $file) {
        $file = Verify-File $InstallRoot ('bin/' + $name)
        if ($shimHashes -notcontains (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()) { throw "Refusing unrelated command: $file" }
        $ownedCommands += $file
      }
    }
    Update-Path $true
    foreach ($file in $ownedCommands) { Remove-Item -LiteralPath $file }
    foreach ($release in @(Get-ChildItem -LiteralPath (Join-Path $InstallRoot 'releases') -Directory -ErrorAction SilentlyContinue)) {
      $manifestPath = Join-Path $release.FullName 'manifest.json'
      if (-not (Test-Path -LiteralPath $manifestPath)) { continue }
      $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
      if ($manifest.distribution -ne 'mcode-bun') { continue }
      foreach ($entry in $manifest.files.PSObject.Properties) {
        $file = Verify-File $release.FullName $entry.Name
        if ($ownedPayloads -contains $file) { Remove-Item -LiteralPath $file }
      }
      Remove-Item -LiteralPath $manifestPath
      Get-ChildItem -LiteralPath $release.FullName -Recurse -Directory | Sort-Object { $_.FullName.Length } -Descending | ForEach-Object { if (-not @(Get-ChildItem -LiteralPath $_.FullName -Force).Count) { [IO.Directory]::Delete($_.FullName) } }
      if (-not @(Get-ChildItem -LiteralPath $release.FullName -Force).Count) { [IO.Directory]::Delete($release.FullName) }
    }
    $current = Join-Path $InstallRoot 'current'
    if (Test-Path -LiteralPath $current) { Remove-Item -LiteralPath $current }
    Write-Output 'MCode Bun commands removed. Configuration and sessions were preserved.'
    return
  }
  if (-not $ArchivePath) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $api = if ($Version -eq 'latest') { 'https://api.github.com/repos/Guihal/mcode-bun/releases/latest' } else { if ($Version -notmatch '^v0\.6\.12-bun\.[0-9]+$') { throw 'Unsupported release tag.' }; "https://api.github.com/repos/Guihal/mcode-bun/releases/tags/$Version" }
    $release = Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'mcode-bun-installer' }
    $assetName = "mcode-$($release.tag_name.TrimStart('v'))-win32-x64.zip"
    $asset = @($release.assets | Where-Object { $_.name -ceq $assetName })
    $checksum = @($release.assets | Where-Object { $_.name -ceq ($assetName + '.sha256') })
    if ($asset.Count -ne 1 -or $checksum.Count -ne 1) { throw 'Release is missing the complete Windows distribution or checksum.' }
    $download = Join-Path $InstallRoot ('.download-' + [Guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($download) | Out-Null
    $ArchivePath = Join-Path $download $assetName; $ChecksumPath = $ArchivePath + '.sha256'
    Invoke-WebRequest -UseBasicParsing -Uri $asset[0].browser_download_url -OutFile $ArchivePath
    Invoke-WebRequest -UseBasicParsing -Uri $checksum[0].browser_download_url -OutFile $ChecksumPath
  }
  $ArchivePath = [IO.Path]::GetFullPath($ArchivePath)
  if (-not $ChecksumPath) { $ChecksumPath = $ArchivePath + '.sha256' }
  $expectedHash = ([IO.File]::ReadAllText([IO.Path]::GetFullPath($ChecksumPath))).Trim()
  if ($expectedHash -notmatch '^([0-9a-fA-F]{64})(?:\s+[^\r\n]+)?$') { throw 'Invalid SHA-256 checksum file.' }
  if ((Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash -ine $Matches[1]) { throw 'Archive checksum mismatch; previous installation remains selected.' }
  $staging = Join-Path $InstallRoot ('.staging-' + [Guid]::NewGuid().ToString('N'))
  [IO.Directory]::CreateDirectory($staging) | Out-Null
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    $seen = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    [long]$total = 0
    foreach ($entry in $zip.Entries) {
      $name = $entry.FullName
      if ($name.Contains('\') -or $name.Contains(':') -or $name.StartsWith('/') -or @($name.TrimEnd('/').Split('/') | Where-Object { -not $_ -or $_ -eq '..' -or $_ -eq '.' }).Count -or -not $seen.Add($name.TrimEnd('/')) -or (($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960) { throw 'Unsafe or duplicate ZIP entry.' }
      $total += $entry.Length
      if ($total -gt 2147483648) { throw 'Distribution archive is too large.' }
    }
  } finally { $zip.Dispose() }
  [IO.Compression.ZipFile]::ExtractToDirectory($ArchivePath, $staging)
  $manifest = Verify-Archive $staging
  $key = $manifest.release + '-' + (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.Substring(0, 16).ToLowerInvariant()
  $releaseRoot = Join-Path $InstallRoot 'releases'
  [IO.Directory]::CreateDirectory($releaseRoot) | Out-Null
  $target = Join-Path $releaseRoot $key
  if (Test-Path -LiteralPath $target) { Verify-Archive $target | Out-Null } else { [IO.Directory]::Move($staging, $target); $staging = $null }
  [IO.Directory]::CreateDirectory($bin) | Out-Null
  $shim = Join-Path $target 'runtime/command-shim.exe'
  $shimHash = (Get-FileHash -LiteralPath $shim -Algorithm SHA256).Hash
  foreach ($command in @('mcode', 'mcode-tools')) {
    foreach ($extension in @('.cmd', '.ps1', '.bat')) {
      if (Test-Path -LiteralPath (Join-Path $bin ($command + $extension))) { throw 'Refusing an unrelated script that could shadow the native command.' }
    }
    $file = Join-Path $bin ($command + '.exe')
    if (Test-Path -LiteralPath $file) {
      Verify-File $InstallRoot ('bin/' + $command + '.exe') | Out-Null
      if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ine $shimHash) { throw "Refusing a changed or unrelated native command: $file" }
    } else { [IO.File]::Copy($shim, $file) }
  }
  # Atomic routing change is last; existing payloads and processes are retained.
  $selection = Join-Path $InstallRoot 'current'; $next = Join-Path $InstallRoot ('.current-' + [Guid]::NewGuid().ToString('N'))
  Write-Utf8 $next ($key + "`n")
  $oldUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $oldProcessPath = [Environment]::GetEnvironmentVariable('Path', 'Process')
  try {
    Update-Path $false
    if (Test-Path -LiteralPath $selection) { [IO.File]::Replace($next, $selection, $null) } else { [IO.File]::Move($next, $selection) }
  } catch {
    [Environment]::SetEnvironmentVariable('Path', $oldUserPath, 'User')
    [Environment]::SetEnvironmentVariable('Path', $oldProcessPath, 'Process')
    if (Test-Path -LiteralPath $next) { Remove-Item -LiteralPath $next }
    throw
  }
  Write-Output "Installed MCode $($manifest.upstreamVersion) ($($manifest.release)). Run mcode or mcode-tools. Reopen already-open terminals to refresh PATH."
} finally {
  if ($staging -and (Test-Path -LiteralPath $staging)) { Remove-Item -LiteralPath $staging -Recurse -Force }
  if ($download -and (Test-Path -LiteralPath $download)) { Remove-Item -LiteralPath $download -Recurse -Force }
  $lock.Dispose()
}
