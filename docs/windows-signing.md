# Signed Windows releases

Windows releases use Authenticode code signing and an RFC 3161 timestamp. Apple
notarization applies to the Mac release. A valid Windows signature identifies the
publisher and detects changes; new downloads can still show SmartScreen warnings
while reputation builds. See [Microsoft's signing guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options).

The signed workflow is separate from unsigned CI previews. It runs manually from
`main`, creates downloadable workflow artifacts, and does not publish a GitHub
release. A green signing run proves its checks passed; it does not prove a real
Windows install or upgrade, or guarantee the absence of SmartScreen prompts.

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
   `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`,
   and subject `repo:Gamedesigner/grokdeck:environment:windows-signing`.
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
identity; review its subject before release. Leave optional street-address and
postal-code disclosure disabled unless you intend to publish those fields.

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

On an authenticated Windows x64 development machine with the four `GROKDECK_*`
variables set, the equivalent command is:

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
- Keep the publisher identity consistent across updates; publisher changes need
  a planned transition for signature checks in existing installations.
