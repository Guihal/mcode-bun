#requires -Version 5.1
param([string]$ArchivePath, [string]$ReleaseTag)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$installer = Join-Path $repo 'install.ps1'
$scratch = Join-Path $env:TEMP ('mcode-install-' + [Guid]::NewGuid().ToString('N'))
$root = Join-Path $scratch 'Installed MCode проба space'
$oldUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$oldProcessPath = $env:Path
[IO.Directory]::CreateDirectory($scratch) | Out-Null
$external = Join-Path $scratch 'external-sentinel.txt'
[IO.File]::WriteAllText($external, 'preserve-external')
$data = Join-Path $scratch 'user-data'; [IO.Directory]::CreateDirectory($data) | Out-Null
[IO.File]::WriteAllText((Join-Path $data 'sessions-sentinel'), 'preserve-sessions')
$env:MINIMAX_DATA_DIR = $data; $env:MCODE_CONFIG_DIR = $data
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Install([string[]]$Options, [bool]$Fails = $false) {
  $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -InstallRoot $root @Options 2>&1
  if ($Fails) { Assert ($LASTEXITCODE -ne 0) "Expected installer rejection: $output" } else { Assert ($LASTEXITCODE -eq 0) "Installer failed: $output" }
  return $output
}
function Selection { return [IO.File]::ReadAllText((Join-Path $root 'current')).Trim() }
function Check-Preservation([string]$Selected) {
  Assert ((Selection) -ceq $Selected) 'Previous selection changed after failure.'
  Assert (([IO.File]::ReadAllText($external)) -ceq 'preserve-external') 'External sentinel changed.'
  Assert (([IO.File]::ReadAllText((Join-Path $data 'sessions-sentinel'))) -ceq 'preserve-sessions') 'User session data changed.'
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Pack([string]$Directory, [string]$Name) {
  $zip = Join-Path $scratch ($Name + '.zip')
  [IO.Compression.ZipFile]::CreateFromDirectory($Directory, $zip)
  [IO.File]::WriteAllText($zip + '.sha256', (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash + '  ' + [IO.Path]::GetFileName($zip))
  return $zip
}
try {
  if ($ReleaseTag) {
    # This is the documented public installer source, exercised after publication.
    $installer = Join-Path $scratch 'public-install.ps1'
    Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/Guihal/mcode-bun/main/install.ps1 -OutFile $installer
    Install @('-Version', $ReleaseTag) | Write-Output
    $asset = "mcode-$($ReleaseTag.TrimStart('v'))-win32-x64.zip"
    $ArchivePath = Join-Path $scratch $asset
    Invoke-WebRequest -UseBasicParsing "https://github.com/Guihal/mcode-bun/releases/download/$ReleaseTag/$asset" -OutFile $ArchivePath
    Invoke-WebRequest -UseBasicParsing "https://github.com/Guihal/mcode-bun/releases/download/$ReleaseTag/$asset.sha256" -OutFile ($ArchivePath + '.sha256')
  } else { $ArchivePath = [IO.Path]::GetFullPath($ArchivePath); Install @('-ArchivePath', $ArchivePath) | Write-Output }
  $selected = Selection
  $bin = Join-Path $root 'bin'
  $env:Path = $bin + ';' + $env:SystemRoot + '\System32;' + $env:SystemRoot + '\System32\WindowsPowerShell\v1.0'
  $version = & powershell.exe -NoProfile -ExecutionPolicy Restricted -Command 'mcode --version'
  Assert ($LASTEXITCODE -eq 0 -and $version.Trim() -ceq '0.6.12') 'Fresh PowerShell command resolution failed.'
  $version = & cmd.exe /d /c 'mcode --version'
  Assert ($LASTEXITCODE -eq 0 -and $version.Trim() -ceq '0.6.12') 'Fresh cmd command resolution failed.'
  $tools = & powershell.exe -NoProfile -ExecutionPolicy Restricted -Command 'mcode-tools --version'
  Assert ($LASTEXITCODE -eq 0 -and $tools.Trim() -ceq '0.0.6') 'Installed tools command failed.'
  Write-Output 'PASS fresh-install-global-cmd-powershell-and-tools'
  Install @('-ArchivePath', $ArchivePath) | Out-Null
  Assert ((Selection) -ceq $selected) 'Rerun changed identical payload selection.'
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  Assert (@($userPath -split ';' | Where-Object { $_.TrimEnd('\') -ieq $bin }).Count -eq 1) 'User PATH duplicated installation bin.'
  Write-Output 'PASS idempotent-install-and-path-registration'
  $damagedRoot = Join-Path (Join-Path $root 'releases') $selected
  $damagedFile = Join-Path $damagedRoot 'runtime/sqlite.cjs'
  [IO.File]::WriteAllText($damagedFile, 'preserve changed payload')
  Install @('-ArchivePath', $ArchivePath) | Out-Null
  $repaired = Selection
  Assert ($repaired -cne $selected) 'Repair did not select a fresh immutable payload.'
  Assert (([IO.File]::ReadAllText($damagedFile)) -ceq 'preserve changed payload') 'Repair overwrote changed files.'
  $selected = $repaired
  Write-Output 'PASS repair-damaged-installation-without-overwriting-old-files'
  $beforePath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $corrupt = Join-Path $scratch 'corrupt.zip'; [IO.File]::WriteAllText($corrupt, 'corrupt')
  Copy-Item -LiteralPath ($ArchivePath + '.sha256') -Destination ($corrupt + '.sha256')
  Install @('-ArchivePath', $corrupt) $true | Out-Null; Check-Preservation $selected
  Install @('-Version', 'unsupported') $true | Out-Null; Check-Preservation $selected
  Assert ([Environment]::GetEnvironmentVariable('Path', 'User') -ceq $beforePath) 'Rejected install changed persisted PATH.'
  Write-Output 'PASS corrupt-checksum-and-unsupported-release-rollback'
  $unrelated = Join-Path $scratch 'unrelated'; [IO.Directory]::CreateDirectory($unrelated) | Out-Null
  [IO.File]::WriteAllText((Join-Path $unrelated 'sentinel'), 'unrelated')
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -InstallRoot $unrelated -ArchivePath $ArchivePath 2>&1 | Out-Null
  Assert ($LASTEXITCODE -ne 0) 'Unrelated root was accepted.'
  Assert (([IO.File]::ReadAllText((Join-Path $unrelated 'sentinel'))) -ceq 'unrelated') 'Unrelated root was modified.'
  $lock = [IO.File]::Open((Join-Path $root '.install.lock'), [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  try { Install @('-ArchivePath', $ArchivePath) $true | Out-Null } finally { $lock.Dispose() }
  Check-Preservation $selected
  $interrupted = Join-Path $root '.staging-interrupted'; [IO.Directory]::CreateDirectory($interrupted) | Out-Null
  [IO.File]::WriteAllText((Join-Path $interrupted 'sentinel'), 'incomplete')
  Install @('-ArchivePath', $ArchivePath) | Out-Null; Check-Preservation $selected
  Write-Output 'PASS unrelated-root-lock-contention-and-interrupted-staging'
  $traversal = Join-Path $scratch 'traversal.zip'
  $zip = [IO.Compression.ZipFile]::Open($traversal, [IO.Compression.ZipArchiveMode]::Create)
  try { $entry = $zip.CreateEntry('../external-sentinel.txt'); $writer = New-Object IO.StreamWriter($entry.Open()); $writer.Write('overwrite'); $writer.Dispose() } finally { $zip.Dispose() }
  [IO.File]::WriteAllText($traversal + '.sha256', (Get-FileHash $traversal -Algorithm SHA256).Hash)
  Install @('-ArchivePath', $traversal) $true | Out-Null; Check-Preservation $selected
  $missing = Join-Path $scratch 'missing-resource'; [IO.Compression.ZipFile]::ExtractToDirectory($ArchivePath, $missing)
  Remove-Item -LiteralPath (Join-Path $missing 'runtime/sqlite.cjs')
  $missingZip = Pack $missing 'missing-resource'
  Install @('-ArchivePath', $missingZip) $true | Out-Null; Check-Preservation $selected
  Write-Output 'PASS-extraction-traversal-and-missing-resources-rejected'
  $next = Join-Path $scratch 'next-release'; [IO.Compression.ZipFile]::ExtractToDirectory($ArchivePath, $next)
  $manifestFile = Join-Path $next 'manifest.json'; $manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
  $manifest.release = '0.6.12-bun.987654'; [IO.File]::WriteAllText($manifestFile, ($manifest | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
  $nextZip = Pack $next 'next-release'
  Install @('-ArchivePath', $nextZip) | Out-Null
  $newSelection = Selection; Assert ($newSelection -cne $selected) 'New release was not selected.'
  Assert (Test-Path -LiteralPath (Join-Path (Join-Path $root 'releases') $selected)) 'Prior immutable release was removed.'
  Write-Output 'PASS-new-release-selection-retains-prior-payload'
  $selectedRoot = Join-Path (Join-Path $root 'releases') $newSelection
  # Test the actual installed routing with an owned disposable argv executable.
  # Restore the delivered binary before installer validation/uninstall resumes.
  $privateBun = Join-Path $selectedRoot 'runtime/bun.exe'
  & $privateBun (Join-Path $repo 'tests/distribution.mjs') $selectedRoot
  Assert ($LASTEXITCODE -eq 0) 'Installed distribution runtime boundaries failed.'
  $probeSource = Join-Path $scratch 'argv.mjs'; $probeExe = Join-Path $scratch 'argv.exe'
  [IO.File]::WriteAllText($probeSource, 'import fs from "node:fs";fs.writeFileSync(process.env.MCODE_ARGV_OUTPUT,JSON.stringify(process.argv.slice(2)));process.exit(23);')
  & $privateBun build $probeSource --compile --outfile $probeExe | Out-Null; Assert ($LASTEXITCODE -eq 0) 'Argv probe compilation failed.'
  $originalExe = Join-Path $selectedRoot 'mcode.exe'; $savedExe = $originalExe + '.saved'
  [IO.File]::Move($originalExe, $savedExe); [IO.File]::Copy($probeExe, $originalExe)
  $probeManifestPath = Join-Path $selectedRoot 'manifest.json'; $probeManifestOriginal = [IO.File]::ReadAllText($probeManifestPath)
  $probeManifest = $probeManifestOriginal | ConvertFrom-Json
  $probeManifest.files.'mcode.exe'.size = (Get-Item -LiteralPath $originalExe).Length
  $probeManifest.files.'mcode.exe'.sha256 = (Get-FileHash -LiteralPath $originalExe -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText($probeManifestPath, ($probeManifest | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
  $env:MCODE_ARGV_OUTPUT = Join-Path $scratch 'argv.json'
  try {
    $psProbe = Join-Path $scratch 'probe.ps1'
    [IO.File]::WriteAllText($psProbe, ('mcode --% plain "space a" "a\"b" "кириллица" ""' + "`r`nexit `$LASTEXITCODE"), (New-Object Text.UTF8Encoding($true)))
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $psProbe
    Assert ($LASTEXITCODE -eq 23) 'PowerShell shim lost exit code.'
    $argsReceived = Get-Content -LiteralPath $env:MCODE_ARGV_OUTPUT -Raw | ConvertFrom-Json
    Assert (($argsReceived | ConvertTo-Json -Compress) -ceq (@('plain','space a','a"b','кириллица','') | ConvertTo-Json -Compress)) 'PowerShell shim changed argument boundaries.'
    $cmdProbe = Join-Path $scratch 'probe.cmd'
    [IO.File]::WriteAllText($cmdProbe, "@echo off`r`nmcode plain `"space a`" `"a\`"b`" `"кириллица`" `"`"`r`nexit /b %errorlevel%`r`n", (New-Object Text.UTF8Encoding($false)))
    & cmd.exe /d /c "chcp 65001>nul & `"$cmdProbe`""
    Assert ($LASTEXITCODE -eq 23) 'cmd shim lost exit code.'
    $argsReceived = Get-Content -LiteralPath $env:MCODE_ARGV_OUTPUT -Raw | ConvertFrom-Json
    Assert (($argsReceived | ConvertTo-Json -Compress) -ceq (@('plain','space a','a"b','кириллица','') | ConvertTo-Json -Compress)) 'cmd shim changed argument boundaries.'
  } finally { Remove-Item -LiteralPath $originalExe; [IO.File]::Move($savedExe, $originalExe); [IO.File]::WriteAllText($probeManifestPath, $probeManifestOriginal, (New-Object Text.UTF8Encoding($false))) }
  Write-Output 'PASS installed-shim-spaces-quotes-unicode-empty-args-and-exit-status'
  # A hostile uninstall manifest must never reach a file outside its release.
  $manifestFile = Join-Path $selectedRoot 'manifest.json'; $originalManifest = [IO.File]::ReadAllText($manifestFile)
  try {
    $manifest = $originalManifest | ConvertFrom-Json
    $manifest.files | Add-Member -NotePropertyName '../../../external-sentinel.txt' -NotePropertyValue @{ size = 17; sha256 = (Get-FileHash $external -Algorithm SHA256).Hash }
    [IO.File]::WriteAllText($manifestFile, ($manifest | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
    Install @('-Uninstall') $true | Out-Null; Check-Preservation $newSelection
  } finally { [IO.File]::WriteAllText($manifestFile, $originalManifest, (New-Object Text.UTF8Encoding($false))) }
  Install @('-Uninstall') | Write-Output
  Assert (-not (Test-Path -LiteralPath (Join-Path $root 'current'))) 'Uninstall retained command selection.'
  Assert (@([Environment]::GetEnvironmentVariable('Path','User') -split ';' | Where-Object { $_.TrimEnd('\') -ieq $bin }).Count -eq 0) 'Uninstall retained User PATH entry.'
  Assert (([IO.File]::ReadAllText($external)) -ceq 'preserve-external') 'Uninstall changed external data.'
  Assert (([IO.File]::ReadAllText((Join-Path $data 'sessions-sentinel'))) -ceq 'preserve-sessions') 'Uninstall changed sessions.'
  Assert (([IO.File]::ReadAllText($damagedFile)) -ceq 'preserve changed payload') 'Uninstall removed a changed payload file.'
  Write-Output 'PASS hostile-uninstall-manifest-refusal-and-owned-uninstall-preservation'
  Write-Output 'Windows installer: all cases passed'
} finally {
  [Environment]::SetEnvironmentVariable('Path', $oldUserPath, 'User')
  [Environment]::SetEnvironmentVariable('Path', $oldProcessPath, 'Process')
  Remove-Item Env:MCODE_ARGV_OUTPUT -ErrorAction SilentlyContinue
  Write-Output "Installer fixture: $scratch"
}
