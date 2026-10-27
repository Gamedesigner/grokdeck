[CmdletBinding()]
param(
    [string]$ReleaseDirectory = (Join-Path $PSScriptRoot '../release')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'Unsigned package verification requires Windows.'
}

function Test-UnsignedGrokDeckFile {
    param([string]$File, [string]$Name = [IO.Path]::GetFileName($File))
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { throw 'Expected GrokDeck executable is missing.' }
    $signature = Get-AuthenticodeSignature -LiteralPath $File
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::NotSigned -or
        $null -ne $signature.SignerCertificate -or $null -ne $signature.TimeStamperCertificate) {
        throw "Expected an unsigned executable: $Name. Certificate details are intentionally omitted."
    }
    $company = [Diagnostics.FileVersionInfo]::GetVersionInfo($File).CompanyName
    if (-not [string]::Equals($company, 'ronmillar.com', [StringComparison]::Ordinal)) {
        throw "Unexpected company branding in $Name."
    }
    return [ordered]@{
        file = $Name
        sha256 = (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()
        authenticode = 'NotSigned'
        signerCertificatePresent = $false
        timestampPresent = $false
        companyName = $company
    }
}

function Test-UnsignedGrokDeckBundle {
    param([string]$Directory)
    $root = (Resolve-Path -LiteralPath $Directory).Path.TrimEnd('\', '/')
    $entries = @(Get-Item -LiteralPath $root; Get-ChildItem -LiteralPath $root -Recurse -Force)
    if ($entries.Count -gt 10000 -or @($entries | Where-Object {
        $_.Attributes -band [IO.FileAttributes]::ReparsePoint
    }).Count -ne 0) { throw 'Bundle is unexpectedly large or contains a reparse point.' }
    $files = @($entries | Where-Object { -not $_.PSIsContainer -and $_.Extension -in @('.exe', '.dll', '.node') })
    if ($files.Count -eq 0 -or $files.Count -gt 1000) { throw 'Unexpected bundled executable count.' }
    $updaterFile = Join-Path $root 'resources/app-update.yml'
    if (-not (Test-Path -LiteralPath $updaterFile -PathType Leaf) -or
        (Get-Item -LiteralPath $updaterFile).Length -gt 64KB) { throw 'Updater metadata is missing or oversized.' }
    # Parse YAML, rather than checking text, so quoted keys cannot evade review.
    # Resolve the existing parser from this checkout even when called elsewhere.
    $updaterCheck = @'
const fs = require('node:fs');
const {createRequire} = require('node:module');
try {
  const yaml = createRequire(process.argv[1])('js-yaml');
  const config = yaml.load(fs.readFileSync(process.argv[2], 'utf8'));
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      ['publisherName', 'token', 'requestHeaders'].some(key => Object.hasOwn(config, key)) ||
      config.provider !== 'github' || config.owner !== 'Gamedesigner' || config.repo !== 'grokdeck') {
    throw new Error('Invalid updater metadata');
  }
} catch {
  process.stderr.write('Unsigned updater metadata failed verification.\n');
  process.exit(1);
}
'@
    $node = (Get-Command node -CommandType Application | Select-Object -First 1).Source
    & $node --input-type=commonjs -e $updaterCheck (Join-Path $PSScriptRoot '../package.json') $updaterFile
    if ($LASTEXITCODE -ne 0) { throw 'Unsigned updater metadata failed verification.' }
    $evidence = foreach ($file in $files) {
        $name = $file.FullName.Substring($root.Length + 1).Replace('\', '/')
        $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
        $publisher = $null
        if ($signature.Status -eq [System.Management.Automation.SignatureStatus]::NotSigned -and
            $null -eq $signature.SignerCertificate -and $null -eq $signature.TimeStamperCertificate) {
            $status = 'NotSigned'
        } elseif ($signature.Status -eq [System.Management.Automation.SignatureStatus]::Valid -and
            $null -ne $signature.SignerCertificate) {
            $publisher = $signature.SignerCertificate.GetNameInfo(
                [System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
            # Only preserve known upstream Microsoft signatures on dependencies.
            # Never print or serialize an unexpected certificate's subject.
            if ($publisher -cnotin @('Microsoft Corporation', 'Microsoft Windows')) {
                throw "Unexpected bundled signing identity in $name. Certificate details are intentionally omitted."
            }
            $status = 'Valid'
        } else {
            throw "Unexpected bundled signature status in $name. Certificate details are intentionally omitted."
        }
        [ordered]@{
            file = $name
            sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            authenticode = $status
            upstreamPublisher = $publisher
        }
    }
    return [ordered]@{ checkedFiles = $files.Count; updaterMetadata = 'passed'; files = @($evidence) }
}

# The installer fixture imports these same checks for the installed payload.
if ($MyInvocation.InvocationName -eq '.') { return }

$release = (Resolve-Path -LiteralPath $ReleaseDirectory).Path.TrimEnd('\', '/')
$package = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../package.json') -Raw | ConvertFrom-Json
$appDirectory = Join-Path $release 'win-unpacked'
$files = @(
    (Test-UnsignedGrokDeckFile (Join-Path $appDirectory 'GrokDeck.exe') 'win-unpacked/GrokDeck.exe'),
    (Test-UnsignedGrokDeckFile (Join-Path $release "GrokDeck-$($package.version)-win-x64.exe") "GrokDeck-$($package.version)-win-x64.exe")
)
$report = [ordered]@{
    schemaVersion = 1
    mode = 'unsigned'
    files = $files
    bundle = Test-UnsignedGrokDeckBundle $appDirectory
}
$json = $report | ConvertTo-Json -Depth 6
if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 512KB) { throw 'Unsigned verification report exceeds its size limit.' }
$json | Set-Content -LiteralPath (Join-Path $release 'windows-unsigned-verification.json') -Encoding UTF8
Write-Host 'Verified unsigned app and installer, website branding, and bundled executable signing identities.'
