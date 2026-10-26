#!/usr/bin/env python3
"""Install/launch the Debug app on one explicit physical device with local-only pairing inputs."""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
from urllib.parse import urlparse

parser = argparse.ArgumentParser()
parser.add_argument('--device', required=True, help='Explicit paired physical iPhone identifier or UDID')
parser.add_argument('--url', required=True, help='Exact private HTTPS LAN bridge endpoint')
parser.add_argument('--app', default=str(Path.home() / 'Library/Developer/Xcode/DerivedData/GrokDeckDevice/Build/Products/Debug-iphoneos/GrokDeck.app'))
parser.add_argument('--certificate', help='Local PEM leaf certificate; defaults to the selected private IP identity')
parser.add_argument('--rejected-pin', action='store_true', help='Check TLS rejection using an incorrect public fingerprint')
args = parser.parse_args()
address = urlparse(args.url)
try:
    ip = ipaddress.IPv4Address(address.hostname)
    private = any(ip in ipaddress.IPv4Network(network) for network in ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'])
    valid = address.scheme == 'https' and private and not address.username and not address.password and not address.query and not address.fragment and address.path in ['', '/'] and address.port is not None
except (ValueError, TypeError):
    valid = False
if not valid:
    parser.error('Use one explicit private IPv4 HTTPS bridge address with its port, without credentials or a path.')
app = Path(args.app)
if not app.is_dir():
    parser.error('Build the signed Debug iPhone app first.')
configuration = Path.home() / '.grokdeck-bridge'
credential = configuration / 'pairing-token-v2'
certificate = Path(args.certificate) if args.certificate else configuration / ('tls-' + str(ip)) / 'cert.pem'
if credential.is_symlink() or not credential.is_file() or not certificate.is_file():
    parser.error('Start the loopback bridge and private HTTPS LAN proxy first.')
token = credential.read_text().strip()
if not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
    parser.error('The local pairing credential is invalid.')
fingerprint = hashlib.sha256(ssl.PEM_cert_to_DER_cert(certificate.read_text())).hexdigest()
inventory = json.loads(subprocess.check_output(['xcrun', 'devicectl', 'list', 'devices', '--json-output', '-'], stderr=subprocess.DEVNULL))
selected = next((device for device in inventory['result']['devices'] if args.device in [device.get('identifier'), device.get('hardwareProperties', {}).get('udid'), device.get('properties', {}).get('hardware', {}).get('udid')]), None)
if not selected or selected.get('hardwareProperties', selected.get('properties', {}).get('hardware', {})).get('reality') != 'physical':
    parser.error('Choose an explicitly identified paired physical device; simulators and unrelated devices are not selected automatically.')
environment = os.environ.copy()
environment['DEVICECTL_CHILD_GROKDECK_BRIDGE_URL'] = args.url
environment['DEVICECTL_CHILD_GROKDECK_BRIDGE_TOKEN'] = token
environment['DEVICECTL_CHILD_GROKDECK_BRIDGE_CERT_SHA256'] = ('0' * 64) if args.rejected_pin else fingerprint
subprocess.run(['xcrun', 'devicectl', 'device', 'install', 'app', '--device', args.device, str(app.resolve())], check=True)
subprocess.run(['xcrun', 'devicectl', 'device', 'process', 'launch', '--device', args.device, '--terminate-existing', 'com.gamedesigner.grokdeck.ios'], env=environment, check=True)
print('Prototype launched with an incorrect test certificate pin.' if args.rejected_pin else 'Prototype launched with private HTTPS pairing; credential stayed in local process environment.')
