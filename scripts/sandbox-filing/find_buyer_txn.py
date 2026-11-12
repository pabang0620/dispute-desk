"""Finds the buyer-side transaction id of the newest sandbox payment with a given amount (buyer activity page),
so file_dispute_ui.py can open the filing page directly instead of picking a dashboard row. Sandbox only.
Usage: python find_buyer_txn.py 66.12   -> prints BUYER_TXN <id>"""
import sys, re, os
from playwright.sync_api import sync_playwright
from lib import CHROME, OUT, buyer_login

amt = sys.argv[1]
with sync_playwright() as p:
  b = p.chromium.launch(headless=True, **({'executable_path': CHROME} if CHROME else {}))
  pg = b.new_context(viewport={'width': 1280, 'height': 1000}).new_page()
  pg.goto('https://www.sandbox.paypal.com/myaccount/activities/', wait_until='domcontentloaded')
  if pg.locator('#email').count() or pg.locator('#password').count(): buyer_login(pg)
  found = None
  for attempt in range(6):
    pg.goto('https://www.sandbox.paypal.com/myaccount/activities/', wait_until='domcontentloaded'); pg.wait_for_timeout(9000)
    for a in pg.locator('a[href*="/activities/details/"]').all():
      if amt in (a.inner_text() or ''):
        m = re.search(r'/details/(?:inline/)?([0-9A-Z]{17})', a.get_attribute('href') or '')
        if m: found = m.group(1); break
    if not found:
      # Newer activity pages render rows without detail links: open the newest row with this amount and read the id.
      row = pg.get_by_text(re.compile(rf'[-\u2212]\${re.escape(amt)}')).first
      if row.count():
        row.click(); pg.wait_for_timeout(6000)
        m = re.search(r'/details/(?:inline/)?([0-9A-Z]{17})', pg.url) or re.search(r'Transaction ID\s*([0-9A-Z]{17})', pg.inner_text('body'))
        if m: found = m.group(1)
    if found: break
    pg.wait_for_timeout(20000)
  pg.screenshot(path=os.path.join(OUT, 'shots', f'activity_{amt}.png'), full_page=True)
  if found: print('BUYER_TXN', found)
  b.close()
  raise SystemExit(0 if found else 3)
