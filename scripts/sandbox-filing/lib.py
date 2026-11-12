"""Helpers for creating sandbox disputes through the buyer web flow. Sandbox only.
Reads PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, SANDBOX_BUYER_EMAIL, SANDBOX_BUYER_PASSWORD from the app .env or the environment.
Adapted from the sandbox probe notes (RESULT.md): the dispute-create API is closed to this app, so the buyer web UI is automated."""
import json, base64, urllib.request, urllib.error, uuid, os, glob

HERE = os.path.dirname(os.path.abspath(__file__))
ENV = dict(os.environ)
env_file = os.path.join(HERE, '..', '..', '.env')
if os.path.exists(env_file):
  for line in open(env_file):
    if '=' in line and not line.startswith('#'):
      k, v = line.strip().split('=', 1)
      ENV.setdefault(k, v)
for needed in ('PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'SANDBOX_BUYER_EMAIL', 'SANDBOX_BUYER_PASSWORD'):
  assert ENV.get(needed), f'{needed} is not set'
API = 'https://api-m.sandbox.paypal.com'
assert 'sandbox' in API
# CHROME_PATH, else the newest Chromium under ~/.cache/ms-playwright (the pip playwright may expect a build that is not
# downloaded), else None: the Chromium that `playwright install chromium` fetched
_cached = sorted(glob.glob(os.path.expanduser('~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome')))
CHROME = os.environ.get('CHROME_PATH') or (_cached[-1] if _cached else None)
OUT = os.path.join(HERE, 'out')
os.makedirs(OUT, exist_ok=True)


def token():
  basic = base64.b64encode(f"{ENV['PAYPAL_CLIENT_ID']}:{ENV['PAYPAL_CLIENT_SECRET']}".encode()).decode()
  req = urllib.request.Request(API + '/v1/oauth2/token', data=b'grant_type=client_credentials', headers={'Authorization': 'Basic ' + basic})
  d = json.loads(urllib.request.urlopen(req).read())
  return d['access_token'], d.get('scope', '')


def call(method, path, body=None, tok=None, headers=None, ctype='application/json'):
  h = {'Content-Type': ctype}
  if tok: h['Authorization'] = f'Bearer {tok}'
  h['PayPal-Request-Id'] = str(uuid.uuid4())
  if headers: h.update(headers)
  data = json.dumps(body).encode() if body is not None else None
  req = urllib.request.Request(API + path, method=method, headers=h, data=data)
  try:
    with urllib.request.urlopen(req) as r:
      txt = r.read(); st = r.status
  except urllib.error.HTTPError as e:
    txt = e.read(); st = e.code
  try: resp = json.loads(txt or b'{}')
  except Exception: resp = {'_raw': txt[:500].decode('utf-8', 'replace')}
  return st, resp


def buyer_login(pg):
  pg.wait_for_timeout(5000)
  em = pg.locator('#email')
  if em.count() and em.is_visible():
    em.fill(ENV['SANDBOX_BUYER_EMAIL'])
    nx = pg.locator('#btnNext')
    if nx.count() and nx.is_visible(): nx.click(); pg.wait_for_timeout(4000)
  pg.locator('#password').wait_for(timeout=20000)
  pg.locator('#password').fill(ENV['SANDBOX_BUYER_PASSWORD']); pg.locator('#btnLogin').click()
  pg.wait_for_timeout(10000)
