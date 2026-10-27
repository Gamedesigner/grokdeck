[CmdletBinding()]
param(
    [switch]$Unsigned,
    [string]$ReleaseDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows' -or
    $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
    [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'Installer smoke tests may run only on an ephemeral GitHub-hosted Windows runner.'
}
if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP) -or
    (-not $Unsigned -and [string]::IsNullOrWhiteSpace($env:GROKDECK_PUBLISHER_NAME))) {
    throw 'RUNNER_TEMP is required; signed mode also requires GROKDECK_PUBLISHER_NAME.'
}
if ($Unsigned) { . (Join-Path $PSScriptRoot 'verify-windows-unsigned.ps1') -ReleaseDirectory $ReleaseDirectory }

function Invoke-BoundedProcess {
    param([string]$File, [string]$Arguments, [int]$TimeoutSeconds = 120)
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $File
    $start.Arguments = $Arguments
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.WorkingDirectory = $project
    $process = [Diagnostics.Process]::Start($start)
    try {
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            $process.Kill($true)
            $process.WaitForExit(10000) | Out-Null
            throw "Timed out running $([IO.Path]::GetFileName($File))."
        }
        if ($process.ExitCode -ne 0) {
            throw "$([IO.Path]::GetFileName($File)) exited with code $($process.ExitCode)."
        }
    } finally {
        $process.Dispose()
    }
}

function Test-InstalledSignature {
    param([string]$File)
    if ($Unsigned) { return Test-UnsignedGrokDeckFile $File }
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { throw 'Installed executable is missing.' }
    $signature = Get-AuthenticodeSignature -LiteralPath $File
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
        $null -eq $signature.SignerCertificate -or $null -eq $signature.TimeStamperCertificate) {
        throw "Installed $([IO.Path]::GetFileName($File)) lacks a valid timestamped Authenticode signature."
    }
    $publisher = $signature.SignerCertificate.GetNameInfo(
        [System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    if (-not [string]::Equals($publisher, $env:GROKDECK_PUBLISHER_NAME, [StringComparison]::Ordinal)) {
        throw "Installed $([IO.Path]::GetFileName($File)) has an unexpected publisher."
    }
    return [ordered]@{
        file = [IO.Path]::GetFileName($File)
        sha256 = (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()
        authenticode = 'Valid'
        publisher = $publisher
        timestampPresent = $true
    }
}

$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ([string]::IsNullOrWhiteSpace($ReleaseDirectory)) {
    $ReleaseDirectory = Join-Path $project $(if ($Unsigned) { 'release' } else { 'release/windows-signed' })
}
$release = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$package = Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw | ConvertFrom-Json
$installer = Join-Path $release "GrokDeck-$($package.version)-win-x64.exe"
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'NSIS installer is missing.' }
# Verify before executing the installer, even when this script runs independently.
$installerEvidence = Test-InstalledSignature $installer
$runnerTemp = (Resolve-Path -LiteralPath $env:RUNNER_TEMP).Path.TrimEnd('\', '/')
$testRoot = Join-Path $runnerTemp ('grokdeck-installer-' + [Guid]::NewGuid().ToString('N'))
$installDirectory = Join-Path $testRoot 'Install With Spaces'
if ([IO.Path]::GetDirectoryName($testRoot) -ne $runnerTemp -or $testRoot -match '["\r\n]') {
    throw 'Invalid runner temporary directory.'
}
$null = New-Item -ItemType Directory -Path $testRoot
$previousExecutable = $env:GROKDECK_EXECUTABLE
try {
    # NSIS requires /D last and unquoted: the remainder is the complete path,
    # including spaces. /S never passes --force-run, so the app is not auto-started.
    Invoke-BoundedProcess $installer ("/S /currentuser /D=$installDirectory")
    $app = Join-Path $installDirectory 'GrokDeck.exe'
    $uninstaller = Join-Path $installDirectory 'Uninstall GrokDeck.exe'
    $verifiedFiles = @((Test-InstalledSignature $app), (Test-InstalledSignature $uninstaller))
    $bundleEvidence = if ($Unsigned) { Test-UnsignedGrokDeckBundle $installDirectory } else { $null }
    $unexpectedApp = @(Get-Process -Name GrokDeck -ErrorAction SilentlyContinue | Where-Object {
        $_.Path -and [string]::Equals($_.Path, $app, [StringComparison]::OrdinalIgnoreCase)
    })
    if ($unexpectedApp.Count -gt 0) { throw 'Silent installation unexpectedly started the application.' }

    # Existing smoke test creates its own empty source and disposable profile;
    # it disables release checks and never reads a signed-in Grok Bot profile.
    $env:GROKDECK_EXECUTABLE = $app
    $node = (Get-Command node -CommandType Application | Select-Object -First 1).Source
    $smoke = Join-Path $project 'scripts/packaged-security-smoke.mjs'
    Invoke-BoundedProcess $node ('"' + $smoke + '"') 150

    Invoke-BoundedProcess $uninstaller '/S /currentuser'
    # NSIS may relaunch its uninstaller from a temp copy; wait for that child too.
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while ((Test-Path -LiteralPath $installDirectory) -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 250
    }
    if (Test-Path -LiteralPath $installDirectory) { throw 'Silent uninstall did not remove the installation directory.' }

    $report = [ordered]@{
        schemaVersion = 1
        mode = $(if ($Unsigned) { 'unsigned' } else { 'signed' })
        installer = $installerEvidence
        install = 'passed'
        pathWithSpaces = $true
        files = $verifiedFiles
        installedBundle = $bundleEvidence
        installedSecuritySmoke = 'passed'
        uninstall = 'passed'
    }
    $json = $report | ConvertTo-Json -Depth 6
    if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 512KB) { throw 'Installer verification report exceeds its size limit.' }
    $json | Set-Content -LiteralPath (Join-Path $release 'windows-installer-verification.json') -Encoding UTF8
    Write-Host 'Installer smoke passed: install, expected app/uninstaller signing state, security checks, and uninstall.'
} finally {
    $env:GROKDECK_EXECUTABLE = $previousExecutable
    # Cleanup is limited to this newly generated directory. Never clean a path
    # from installer metadata, and never follow a junction out of the fixture.
    if (Test-Path -LiteralPath $testRoot) {
        Get-Process -ErrorAction SilentlyContinue | Where-Object {
            $_.Path -and $_.Path.StartsWith($testRoot + '\', [StringComparison]::OrdinalIgnoreCase)
        } | Stop-Process -Force -ErrorAction SilentlyContinue
        $links = @(Get-Item -LiteralPath $testRoot; Get-ChildItem -LiteralPath $testRoot -Recurse -Force) |
            Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }
        if (@($links).Count -eq 0) {
            Remove-Item -LiteralPath $testRoot -Recurse -Force
        } else {
            Write-Warning 'Fixture contains a reparse point; leaving cleanup to the ephemeral runner.'
        }
    }
}
