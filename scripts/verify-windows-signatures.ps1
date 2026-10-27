[CmdletBinding()]
param(
    [string]$ReleaseDirectory = (Join-Path $PSScriptRoot '../release/windows-signed'),
    [string]$PublisherName = $env:GROKDECK_PUBLISHER_NAME
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'Authenticode verification requires Windows.'
}
if ([string]::IsNullOrWhiteSpace($PublisherName) -or $PublisherName -ne $PublisherName.Trim()) {
    throw 'Set GROKDECK_PUBLISHER_NAME to the exact certificate common name.'
}
$release = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$package = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../package.json') -Raw | ConvertFrom-Json
$files = @(
    (Join-Path $release 'win-unpacked/GrokDeck.exe'),
    (Join-Path $release "GrokDeck-$($package.version)-win-x64.exe")
)
$evidence = foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing signed artifact: $file" }
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
        throw "Invalid Authenticode signature on $file ($($signature.Status))."
    }
    if ($null -eq $signature.SignerCertificate) { throw "Missing publisher certificate on $file" }
    $actualPublisher = $signature.SignerCertificate.GetNameInfo(
        [System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    if (-not [string]::Equals($actualPublisher, $PublisherName, [StringComparison]::Ordinal)) {
        throw "Unexpected signing publisher on $file"
    }
    if ($null -eq $signature.TimeStamperCertificate) { throw "Missing trusted timestamp on $file" }
    [ordered]@{
        file = $file.Substring($release.Length + 1).Replace('\', '/')
        sha256 = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
        authenticode = 'Valid'
        publisher = $actualPublisher
        timestampPresent = $true
    }
}
$report = [ordered]@{ schemaVersion = 1; files = @($evidence) }
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $release 'windows-signature-verification.json') -Encoding UTF8
Write-Host 'Verified the app and installer: trusted Authenticode signatures, expected publisher, and timestamps.'
