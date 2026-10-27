import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createSigningConfiguration, verifyUpdaterPublisher} from '../scripts/package-win-signed.mjs';

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
