"""Refresh an already registered public Composer package without logging credentials."""
import json
import os
import urllib.request

username = os.environ.get('PACKAGIST_USERNAME')
token = os.environ.get('PACKAGIST_TOKEN')
if not username or not token:
    raise SystemExit('Set PACKAGIST_USERNAME and PACKAGIST_TOKEN after registering trafficops/template-dsl on Packagist.')
body = json.dumps({'repository': 'https://github.com/trafficops-io/tops-templates'}).encode()
request = urllib.request.Request('https://packagist.org/api/update-package', data=body, headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {username}:{token}', 'User-Agent': 'TrafficOps-release (https://github.com/trafficops-io/tops-templates)'})
try:
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)
    if payload.get('status') != 'success':
        raise SystemExit('Packagist did not report success; check package registration and credentials.')
    print('Packagist updated.')
except urllib.error.URLError:
    raise SystemExit('Packagist update failed; check registration, credentials and service status.') from None
