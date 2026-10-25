#!/usr/bin/env python3
"""Launch the Debug prototype on an explicitly selected simulator without logging its pairing credential."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import hashlib
import ssl
from urllib.parse import urlparse

parser = argparse.ArgumentParser()
parser.add_argument('--device', required=True, help='Dedicated GrokDeck simulator UUID')
parser.add_argument('--app', default=str(Path.home() / 'Library/Developer/Xcode/DerivedData/GrokDeckPrototype/Build/Products/Debug-iphonesimulator/GrokDeck.app'))
parser.add_argument('--url', default='http://127.0.0.1:43872')
parser.add_argument('--certificate', help='Local PEM leaf certificate for a pinned HTTPS bridge')
parser.add_argument('--rejected-key', action='store_true', help='Check the authentication-error UI using an invalid key')
args = parser.parse_args()
app = Path(args.app)
if not app.is_dir():
    parser.error('Build the Debug simulator app first.')
token_file = Path.home() / '.grokdeck-bridge' / 'pairing-token'
if not token_file.is_file():
    parser.error('Start npm run bridge first. Do not paste a pairing key into chat or command arguments.')
environment = os.environ.copy()
environment['SIMCTL_CHILD_GROKDECK_BRIDGE_URL'] = args.url
environment['SIMCTL_CHILD_GROKDECK_BRIDGE_TOKEN'] = ('B' * 43) if args.rejected_key else token_file.read_text().strip()
if args.certificate:
    if urlparse(args.url).scheme != 'https':
        parser.error('Certificate pinning requires an HTTPS bridge URL.')
    certificate = ssl.PEM_cert_to_DER_cert(Path(args.certificate).read_text())
    environment['SIMCTL_CHILD_GROKDECK_BRIDGE_CERT_SHA256'] = hashlib.sha256(certificate).hexdigest()
devices = json.loads(subprocess.check_output(['xcrun','simctl','list','devices','available','--json']))
selected = next((device for group in devices['devices'].values() for device in group if device['udid'] == args.device), None)
if not selected or not selected['name'].startswith('GrokDeck'):
    parser.error('Use a dedicated simulator whose name starts with GrokDeck; other project simulators are protected.')
if selected['state'] != 'Booted':
    subprocess.run(['xcrun','simctl','boot',args.device],check=True)
subprocess.run(['xcrun','simctl','bootstatus',args.device,'-b'],check=True,timeout=240)
subprocess.run(['xcrun', 'simctl', 'install', args.device, str(app.resolve())], check=True)
subprocess.run(['xcrun', 'simctl', 'launch', '--terminate-running-process', args.device, 'com.gamedesigner.grokdeck.ios'], env=environment, check=True)
print('Prototype launched with an invalid test key.' if args.rejected_key else 'Prototype launched with local pairing; credential not logged or embedded in the app.')
