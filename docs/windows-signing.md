# Signed Windows releases

**Signed distribution paused:** the 0.3.0-rc.3 signed Windows installer and its
downloadable signed CI artifacts were withdrawn because the certificate exposed
personal publisher information. The GitHub signing workflow remains disabled.
The owner chose the unsigned [0.3.0-rc.4 Windows preview](https://github.com/Gamedesigner/grokdeck/releases/tag/v0.3.0-rc.4);
existing signed and notarized Mac downloads remain unchanged.

Microsoft Artifact Signing is optional. A different trusted certificate authority
or an approved open-source signing program can be used instead. An unsigned EXE
does not embed our personal signing certificate, but Windows shows an unknown
publisher and may warn or block installation. Changing package branding to
`ronmillar.com` does not change a certificate's verified publisher.

Windows releases use Authenticode code signing and an RFC 3161 timestamp. Apple
notarization applies to the Mac release. A valid Windows signature identifies the
publisher and detects changes; new downloads can still show SmartScreen warnings
while reputation builds. See [Microsoft's signing guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options).

The signed workflow is separate from unsigned CI previews. It runs manually from
`main`, creates downloadable workflow artifacts, and does not publish a GitHub
release. A green signing run proves its checks passed; it does not prove a real
Windows install or upgrade, or guarantee the absence of SmartScreen prompts.

## Unsigned Windows previews

The normal `npm run package:win` path explicitly sets `signExecutable: false`
and leaves resource editing enabled. Package company and copyright metadata use
`ronmillar.com`; Windows still identifies the executable as an unknown publisher.
The preview contains no personal publisher certificate. From 0.3.0-rc.5, its
in-app updater can download and verify a newer GitHub installer, then open the
normal installation wizard after an explicit click. Older previews require one
manual update to receive this feature. See [update behavior](app-updates.md).

The desktop workflow runs `verify-windows-unsigned.ps1`, then
`windows-installer-smoke.ps1 -Unsigned` on a disposable Windows runner. These checks
require the app, installer, and installed uninstaller to have no signature and the
expected company metadata. Bundled executable certificates are checked separately;
only valid upstream Microsoft signatures are allowed on dependencies. Updater
metadata must have no publisher name, token, or request headers. Reports record
artifact hashes and installation/security/uninstallation results. Unexpected
certificate subjects are omitted from logs and reports.

## One-time owner setup

1. Use an approved Azure Artifact Signing **Public Trust** certificate profile.
   New accounts need a paid Azure subscription and identity verification; an
   existing approved profile can be reused. Microsoft manages the signing key.
   See the [setup guide](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
   and [current pricing](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-change-sku).
2. Create a dedicated Microsoft Entra application/service principal for GrokDeck
   CI. Grant only **Artifact Signing Certificate Profile Signer**, scoped to the
   selected certificate profile. Do not grant subscription Contributor or Owner.
3. Add a GitHub OIDC federated credential with issuer
   `https://token.actions.githubusercontent.com` and audience `api://AzureADTokenExchange`.
   Use the repository's **actual** subject prefix from
   `gh api repos/Gamedesigner/grokdeck/actions/oidc/customization/sub`, followed by
   `:environment:windows-signing`. GitHub may include immutable owner and repository
   IDs in that prefix; do not assume the older `repo:OWNER/REPO` format. Match the
   subject shown by Azure Login exactly, without printing or saving the OIDC token.
4. Create the GitHub environment `windows-signing`. Restrict deployment branches
   to `main`; configure required reviewers when supported by the repository plan.
   The environment restriction is important because this OIDC subject binds the
   environment, not a branch. Protect changes to the workflow and signing scripts.
5. Configure these values on the GitHub environment, not in source code or
   downloadable files. Store resource identifiers as **environment secrets** so
   GitHub masks them in public build logs. Only the certificate publisher is an
   **environment variable**, since it is already part of the public signature:

   | Name | Kind | Value |
   | --- | --- | --- |
   | `AZURE_CLIENT_ID` | Secret | Dedicated GrokDeck CI application ID |
   | `AZURE_TENANT_ID` | Secret | Microsoft Entra tenant ID |
   | `AZURE_SUBSCRIPTION_ID` | Secret | Subscription containing the signing profile |
   | `GROKDECK_SIGNING_ENDPOINT` | Secret | Account region's HTTPS `codesigning.azure.net` endpoint |
   | `GROKDECK_SIGNING_ACCOUNT` | Secret | Signing account name |
   | `GROKDECK_SIGNING_PROFILE` | Secret | Approved Public Trust profile name |
   | `GROKDECK_PUBLISHER_NAME` | Variable | Exact verified certificate common name, including punctuation |

No PFX, private key, password, client secret, access token, or identity document
belongs in GitHub or the application. OIDC uses a short-lived identity scoped to
the signing environment. The public certificate includes the verified publisher
identity. Review the **entire leaf certificate subject**, including common name,
organization, locality, state, country, address, postal code, and email, before
building any distributable artifacts. Confirm the approved identity for the app,
installer, uninstaller, and bundled signed binaries. A valid signature and matching
common name do not establish publisher privacy. Disabling street/postal disclosure
does not remove city/state/country from an Azure Public Trust certificate. Azure's
custom common-name/organization values are [not supported](https://learn.microsoft.com/en-us/azure/artifact-signing/faq#can-i-use-a-custom-cn-or-a-custom-o-with-artifact-signing).

## Build and verify

In GitHub Actions, select **Build signed Windows installer**, choose **Run
workflow**, and select `main`. Dependencies, tests, and the app build run before
Azure login. The workflow then uses electron-builder's native `win.azureSignOptions`
integration to sign the app, generated NSIS uninstaller, installer, and elevation
helper. DLL and native Node libraries are also included in builder's signing pass.
It requires signing, SHA256 file/timestamp digests, and Microsoft's timestamp
service. A missing configuration or signing failure stops the build.

The package script creates a fresh `release/windows-signed` directory, leaving
ordinary preview output separate. It verifies that the app and installer have
`Valid` Windows Authenticode status, the exact expected publisher, and timestamps.
It also checks that `resources/app-update.yml` contains only that publisher and
the GrokDeck feed, with no embedded authentication material. The packaged security
smoke test checks Electron fuses, renderer isolation, and preference persistence
before upload. The artifact includes a signature/hash verification report.

On an authenticated Windows x64 development machine with PowerShell 7 (`pwsh.exe`)
and the four `GROKDECK_*` variables set, the equivalent command is:

```powershell
node scripts/package-win-signed.mjs
```

`--check-config` validates the four values without signing or accessing Azure.
`--skip-build` is intended for CI immediately after `npm run build`; it still
requires `dist/index.html` and performs every packaging and verification check.
Use the PowerShell verifier to recheck an existing output directory:

```powershell
./scripts/verify-windows-signatures.ps1
```

The pinned electron-builder release calls the PowerShell module `TrustedSigning`
(the earlier product name) internally. Azure login supplies its Azure CLI
credential; no long-lived secret is needed. See the [official integration guide](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations)
and [OIDC guidance](https://github.com/Azure/artifact-signing-action/blob/main/docs/OIDC.md).

## Release checklist

- Download the verified signed artifact from the successful run for the intended
  commit. Inspect the signature report and compare downloaded hashes.
- Install it on a Windows PC, confirm the expected publisher, and test live
  connection and computer access with that user's own Grok Bot account.
- Test a real signed update with saved preferences and drafts. Existing unsigned
  previews still need a manual installer download to enter the signed update path.
- Publish only the intended installer, ZIP, blockmap, and matching updater channel
  metadata. Do not promote prereleases into the stable channel accidentally.
  Manual previews can publish only installers and checksums; keep their metadata
  out of the stable update feed.
- Keep the publisher identity consistent across updates; publisher changes need
  a planned transition for signature checks in existing installations.
