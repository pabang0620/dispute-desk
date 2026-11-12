"""File a buyer dispute on the sandbox web UI (headless Playwright). Sandbox only.
Usage: python file_dispute_ui.py <INR|SNAD> <buyer_txn_id|seller_capture_id> <amount>
If a seller capture id is given, the buyer txn id is looked up through GET /v2/payments/captures (not available) -> instead the
script opens the disputes dashboard and picks the payment row by amount. Pass the buyer txn id when you have it.
Prints the case id (PP-R-...). Screenshots: shots/file_<kind>_<txn>_NN.png"""
import sys, os, re
from datetime import datetime
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright
from lib import ENV, CHROME, OUT

kind, txn, amt = sys.argv[1].upper(), sys.argv[2], sys.argv[3]
shots = os.path.join(OUT, 'shots'); os.makedirs(shots, exist_ok=True)
SNAD_NOTE = ('Listing said 100 percent merino wool, heavy weight. The item I got is a thin polyester throw '
             'with a different label and color. Photos of the label are available on request.')
INR_NOTE = 'Ordered two weeks ago, nothing arrived and the seller never sent tracking.'
n = [0]


def shot(pg, tag):
  n[0] += 1; pg.screenshot(path=f'{shots}/file_{kind}_{txn}_{n[0]:02d}_{tag}.png', full_page=True)


def btn(pg, name, optional=False):
  loc = pg.get_by_role('button', name=name).locator('visible=true')
  if not loc.count():
    if optional: return False
    loc = pg.get_by_text(name).locator('visible=true')
  loc.first.click(); pg.wait_for_timeout(5000); return True


def label(pg, text):
  pg.locator('label', has_text=text).locator('visible=true').first.click(); pg.wait_for_timeout(1500)


with sync_playwright() as p:
  b = p.chromium.launch(headless=True, **({'executable_path': CHROME} if CHROME else {}))
  pg = b.new_context(viewport={'width': 1280, 'height': 1000}).new_page()
  url = 'https://www.sandbox.paypal.com/resolutioncenter' if txn == 'auto' else f'https://www.sandbox.paypal.com/resolutioncenter/filing/{txn}/create?type=PAYMENT'
  pg.goto(url, wait_until='domcontentloaded'); pg.wait_for_timeout(6000)
  em = pg.locator('#email')
  if em.count() and em.is_visible():
    em.fill(ENV['SANDBOX_BUYER_EMAIL'])
    nx = pg.locator('#btnNext')
    if nx.count() and nx.is_visible(): nx.click(); pg.wait_for_timeout(4000)
  pg.locator('#password').wait_for(timeout=20000)
  pg.locator('#password').fill(ENV['SANDBOX_BUYER_PASSWORD']); pg.locator('#btnLogin').click()
  pg.wait_for_timeout(12000)
  if 'captcha' in pg.content().lower() or 'security check' in pg.inner_text('body').lower():
    shot(pg, 'challenge'); print('BLOCKED: captcha/security challenge'); raise SystemExit(2)
  if txn == 'auto':
    # pick the newest payment row with this amount on the buyer disputes dashboard
    pg.goto('https://www.sandbox.paypal.com/resolutioncenter', wait_until='domcontentloaded'); pg.wait_for_timeout(7000)
    pg.get_by_role('button', name=re.compile(rf'Payment .*\${re.escape(amt)} USD')).first.click(); pg.wait_for_timeout(4000)
    btn(pg, 'Report a Problem')
    txn = re.search(r'/filing/([0-9A-Z]+)/', pg.url).group(1); print('BUYER_TXN', txn)
  elif '/filing/' not in pg.url:
    pg.goto(url, wait_until='domcontentloaded'); pg.wait_for_timeout(7000)
  shot(pg, 'start')
  if btn(pg, 'Start over', optional=True): btn(pg, 'Yes, Start Over', optional=True)
  if kind == 'INR':
    btn(pg, 'I haven’t received the item or service')
  else:
    btn(pg, 'I received an item or service that was different or not as described')
  pg.locator('#dropdownMenuSelect_Itemtype').select_option(label='Physical product', force=True)
  pg.locator('#dropdownMenuSelect_Category').select_option(label='Home', force=True)
  shot(pg, 'items'); btn(pg, 'Continue')
  if kind == 'INR':
    label(pg, 'The item hasn’t reached me'); shot(pg, 'subissue'); btn(pg, 'Continue')
    pg.locator('#text-input-items\\.0\\.expected_refund').fill(amt)
    shot(pg, 'details'); btn(pg, 'Continue')
    label(pg, 'No'); shot(pg, 'contact'); btn(pg, 'Continue')
    pg.locator('#text-input-notes').fill(INR_NOTE)
  else:
    label(pg, 'I got a different item'); shot(pg, 'subissue'); btn(pg, 'Continue')
    pg.locator('#dropdownMenuSelect_Chooseanoption').select_option(label='Material', force=True)
    pg.locator('#text-input-items\\.0\\.notes').fill(SNAD_NOTE)
    pg.locator('#text-input-dateSelector').fill(datetime.now(ZoneInfo('America/Los_Angeles')).strftime('%m/%d/%Y'))
    pg.locator('#text-input-items\\.0\\.expected_refund').fill(amt)
    pg.locator('#selection_items\\.0\\.product_details\\.return_details\\.return_intent_NO_RETURN').locator('xpath=..').click()
    pg.wait_for_timeout(1500)
    rn = pg.locator('#text-input-items\\.0\\.product_details\\.return_details\\.notes')
    if rn.count(): rn.fill('The item is cheap and return shipping would cost more than it is worth.')
    shot(pg, 'details'); btn(pg, 'Continue')
    # possible contact-seller and documents steps, same as INR
    body = pg.inner_text('body')
    if 'contacted the seller' in body:
      label(pg, 'No'); shot(pg, 'contact'); btn(pg, 'Continue')
    nt = pg.locator('#text-input-notes')
    if nt.count(): nt.fill('Please help, wrong material.')
  shot(pg, 'docs')
  while 'Do a quick check' not in pg.inner_text('body'):
    btn(pg, 'Continue'); shot(pg, 'next')
    if n[0] > 20: break
  shot(pg, 'review'); btn(pg, 'Submit'); pg.wait_for_timeout(8000)
  shot(pg, 'done')
  m = re.search(r'PP-[A-Z]-[A-Z]{3}-\d+', pg.inner_text('body'))
  print('URL', pg.url)
  print('CASE', m.group(0) if m else None)
  if not m: print(re.sub(r'\n\s*\n+', '\n', pg.inner_text('body'))[:1500])
  b.close()
