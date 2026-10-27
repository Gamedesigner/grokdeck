import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createSigningConfiguration, verifyUpdaterPublisher, verifySignatureEvidence} from '../scripts/package-win-signed.mjs';

const settings = {
  GROKDECK_SIGNING_ENDPOINT: 'https://eus.codesigning.azure.net/',
  GROKDECK_SIGNING_ACCOUNT: 'example-signing',
  GROKDECK_SIGNING_PROFILE: 'example-profile',
  GROKDECK_PUBLISHER_NAME: 'Example Publisher',
};

test('signed Windows configuration requires every setting and a Microsoft HTTPS signing origin', () => {
  const config = createSigningConfiguration(settings);
  assert.equal(config.forceCodeSigning, true);
  assert.equal(config.win.forceCodeSigning, true);
  assert.equal(config.win.signExecutable, true);
  assert.equal(config.win.verifyUpdateCodeSignature, true);
  assert.equal(config.win.azureSignOptions.publisherName, settings.GROKDECK_PUBLISHER_NAME);
  assert.equal(config.win.azureSignOptions.fileDigest, 'SHA256');
  assert.equal(config.win.azureSignOptions.timestampDigest, 'SHA256');
  assert.equal(config.nsis.script, null);
  for (const name of Object.keys(settings)) {
    for (const value of [undefined, '', ' ', `${settings[name]}\n`]) {
      assert.throws(() => createSigningConfiguration({...settings, [name]: value}));
    }
  }
  for (const endpoint of [
    'http://eus.codesigning.azure.net', 'https://example.invalid',
    'https://eus.codesigning.azure.net.example.invalid', 'https://user@eus.codesigning.azure.net',
    'https://eus.codesigning.azure.net:8443', 'https://eus.codesigning.azure.net/extra',
    'https://eus.codesigning.azure.net/?token=fixture', 'https://eus.codesigning.azure.net/#fragment',
  ]) assert.throws(() => createSigningConfiguration({...settings, GROKDECK_SIGNING_ENDPOINT: endpoint}));
});

test('signing account and certificate profile names cannot introduce paths or command syntax', () => {
  for (const field of ['GROKDECK_SIGNING_ACCOUNT', 'GROKDECK_SIGNING_PROFILE']) {
    for (const value of ['../other', 'name; command', "name'", 'name--other', 'x'.repeat(101)]) {
      assert.throws(() => createSigningConfiguration({...settings, [field]: value}));
    }
  }
});

test('updater publisher validation fails closed on missing, mismatched, or credential-bearing config', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'grokdeck-signing-test-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const resources = path.join(root, 'win-unpacked', 'resources');
  await fs.mkdir(resources, {recursive: true});
  const configPath = path.join(resources, 'app-update.yml');
  const base = {provider: 'github', owner: 'Gamedesigner', repo: 'grokdeck', publisherName: ['Example Publisher']};
  await assert.rejects(verifyUpdaterPublisher(root, 'Example Publisher'));
  for (const publisherName of ['Example Publisher', ['Example Publisher']]) {
    await fs.writeFile(configPath, JSON.stringify({...base, publisherName}));
    await verifyUpdaterPublisher(root, 'Example Publisher');
  }
  for (const patch of [
    {publisherName: undefined}, {publisherName: null}, {publisherName: []},
    {publisherName: 'Other Publisher'}, {publisherName: ['Example Publisher', 'Other Publisher']},
    {provider: 'generic'}, {repo: 'another-project'}, {owner: 'another-owner'},
    {token: 'fixture-token'}, {requestHeaders: {Authorization: 'fixture-token'}},
  ]) {
    await fs.writeFile(configPath, JSON.stringify({...base, ...patch}));
    await assert.rejects(verifyUpdaterPublisher(root, 'Example Publisher'));
  }
});

test('late signing failure remains nonzero when builder cleanup calls process.exit(0)', () => {
  const script = new URL('../scripts/package-win-signed.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import {failSigning} from ${JSON.stringify(script)};
    process.on('beforeExit', () => process.exit(0));
    failSigning(new Error('fixture verifier failed'));
  `], {encoding: 'utf8', timeout: 10_000});
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1);
  assert.match(child.stderr, /fixture verifier failed/);
});

test('signature evidence is mandatory and must cover both matching timestamped artifacts', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'grokdeck-signature-report-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const file = path.join(root, 'windows-signature-verification.json');
  const {version} = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const files = ['win-unpacked/GrokDeck.exe', `GrokDeck-${version}-win-x64.exe`].map(file => ({
    file, sha256: 'a'.repeat(64), authenticode: 'Valid', publisher: 'Example Publisher', timestampPresent: true,
  }));
  await assert.rejects(verifySignatureEvidence(root, 'Example Publisher'));
  await fs.writeFile(file, '\uFEFF' + JSON.stringify({schemaVersion: 1, files}));
  await verifySignatureEvidence(root, 'Example Publisher');
  for (const invalid of [
    {schemaVersion: 1, files: [files[0]]},
    {schemaVersion: 1, files: [files[0], files[0]]},
    {schemaVersion: 1, files: [files[0], {...files[1], publisher: 'Other Publisher'}]},
    {schemaVersion: 1, files: [files[0], {...files[1], timestampPresent: false}]},
    {schemaVersion: 1, files: [files[0], {...files[1], authenticode: 'NotSigned'}]},
  ]) {
    await fs.writeFile(file, JSON.stringify(invalid));
    await assert.rejects(verifySignatureEvidence(root, 'Example Publisher'));
  }
});
