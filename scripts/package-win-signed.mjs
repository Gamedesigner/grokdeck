import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {load as loadYaml} from 'js-yaml';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const signedOutput = path.join(projectDir, 'release', 'windows-signed');

function required(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`Set ${name} to a nonempty value without surrounding whitespace or control characters.`);
  }
  return value;
}

// These are public resource names and a certificate CN, never signing keys.
export function createSigningConfiguration(env = process.env) {
  const endpoint = required(env, 'GROKDECK_SIGNING_ENDPOINT');
  const account = required(env, 'GROKDECK_SIGNING_ACCOUNT');
  const profile = required(env, 'GROKDECK_SIGNING_PROFILE');
  const publisher = required(env, 'GROKDECK_PUBLISHER_NAME');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || !/^[a-z0-9]+\.codesigning\.azure\.net$/.test(url.hostname) ||
      url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') {
    throw new Error('GROKDECK_SIGNING_ENDPOINT must be a regional HTTPS codesigning.azure.net origin.');
  }
  if (!/^[a-zA-Z][a-zA-Z0-9-]{1,22}[a-zA-Z0-9]$/.test(account) || account.includes('--')) {
    throw new Error('GROKDECK_SIGNING_ACCOUNT is not a valid signing account name.');
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{3,98}[a-zA-Z0-9]$/.test(profile) || profile.includes('--')) {
    throw new Error('GROKDECK_SIGNING_PROFILE is not a valid certificate profile name.');
  }
  if (publisher.length > 200) throw new Error('GROKDECK_PUBLISHER_NAME is too long.');
  return {
    forceCodeSigning: true,
    directories: {output: signedOutput},
    win: {
      forceCodeSigning: true,
      signAndEditExecutable: true,
      signExecutable: true,
      signExts: ['.exe', '.dll', '.node'],
      verifyUpdateCodeSignature: true,
      signtoolOptions: null,
      azureSignOptions: {
        publisherName: publisher,
        endpoint: url.origin,
        codeSigningAccountName: account,
        certificateProfileName: profile,
        fileDigest: 'SHA256',
        timestampRfc3161: 'http://timestamp.acs.microsoft.com',
        timestampDigest: 'SHA256',
      },
    },
    // A custom NSIS script bypasses builder's generated uninstaller signing.
    nsis: {script: null},
  };
}

export async function verifyUpdaterPublisher(output, expectedPublisher) {
  const configPath = path.join(output, 'win-unpacked', 'resources', 'app-update.yml');
  const config = loadYaml(await fs.readFile(configPath, 'utf8'));
  const names = Array.isArray(config?.publisherName) ? config.publisherName : [config?.publisherName];
  if (names.length !== 1 || names[0] !== expectedPublisher) {
    throw new Error('Packaged app-update.yml must contain only the expected signing publisher.');
  }
  if (config.provider !== 'github' || config.owner !== 'Gamedesigner' || config.repo !== 'grokdeck') {
    throw new Error('Packaged updater does not target the GrokDeck GitHub repository.');
  }
  if (config.token || config.requestHeaders) throw new Error('Packaged updater must not contain authentication material.');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {cwd: projectDir, stdio: 'inherit', ...options});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status ?? result.signal}).`);
}

export function failSigning(error) {
  process.exitCode = 1;
  // temp-file's async-exit-hook can call process.exit(0) during cleanup. Match
  // electron-builder's CLI safeguard so a late verifier error cannot turn green.
  process.on('exit', () => { process.exitCode = 1; });
  console.error(error.message);
}

export async function verifySignatureEvidence(output, expectedPublisher) {
  const reportPath = path.join(output, 'windows-signature-verification.json');
  const stat = await fs.stat(reportPath);
  if (!stat.isFile() || stat.size === 0 || stat.size > 64 * 1024) throw new Error('Missing or invalid Windows signature report.');
  const report = JSON.parse((await fs.readFile(reportPath, 'utf8')).replace(/^\uFEFF/, ''));
  const {version} = JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf8'));
  const expectedFiles = new Set(['win-unpacked/GrokDeck.exe', `GrokDeck-${version}-win-x64.exe`]);
  if (report.schemaVersion !== 1 || !Array.isArray(report.files) || report.files.length !== 2) {
    throw new Error('Windows signature report is incomplete.');
  }
  for (const file of report.files) {
    if (!expectedFiles.delete(file.file) || file.authenticode !== 'Valid' ||
        file.publisher !== expectedPublisher || file.timestampPresent !== true || !/^[a-f0-9]{64}$/i.test(file.sha256)) {
      throw new Error('Windows signature report does not establish both expected signed artifacts.');
    }
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.some(arg => !['--skip-build', '--check-config'].includes(arg))) {
    throw new Error('Usage: node scripts/package-win-signed.mjs [--skip-build] [--check-config]');
  }
  const config = createSigningConfiguration();
  if (args.includes('--check-config')) {
    console.log('Windows signing configuration is valid; no signing or account access was attempted.');
    return;
  }
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Signed Windows packaging requires Windows x64.');
  if (!args.includes('--skip-build')) run('npm.cmd', ['run', 'build'], {shell: true});
  await fs.access(path.join(projectDir, 'dist', 'index.html'));
  // Isolate this run from unsigned previews and never accept stale signed output.
  await fs.rm(signedOutput, {recursive: true, force: true});
  const {build, Platform, Arch} = await import('electron-builder');
  await build({
    projectDir,
    targets: Platform.WINDOWS.createTarget(['nsis', 'zip'], Arch.x64),
    publish: 'never',
    config,
  });
  await verifyUpdaterPublisher(signedOutput, config.win.azureSignOptions.publisherName);
  run('pwsh.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(projectDir, 'scripts', 'verify-windows-signatures.ps1'),
    '-ReleaseDirectory', signedOutput,
    '-PublisherName', config.win.azureSignOptions.publisherName,
  ], {timeout: 180_000});
  await verifySignatureEvidence(signedOutput, config.win.azureSignOptions.publisherName);
  console.log('Windows app and installer signatures, timestamps, and updater publisher verified. Nothing was published.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(failSigning);
}
