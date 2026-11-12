"""Create N captured CAPTURE-intent sandbox orders paid by the sandbox buyer.
Usage: python make_payments.py 40.00:Desk_Lamp 65.00:Wool_Blanket
Appends results to payments.json."""
import sys, json, os
from playwright.sync_api import sync_playwright
from lib import call, token, buyer_login, CHROME, OUT

tok, _ = token()
specs = [a.split(':') for a in sys.argv[1:]] or [['40.00', 'Desk_Lamp'], ['65.00', 'Wool_Blanket']]
path = os.path.join(OUT, 'payments.json')
done = json.load(open(path)) if os.path.exists(path) else []

with sync_playwright() as p:
  b = p.chromium.launch(headless=True, **({'executable_path': CHROME} if CHROME else {}))
  for amt, name in specs:
    name = name.replace('_', ' ')
    st, order = call('POST', '/v2/checkout/orders', {
      'intent': 'CAPTURE',
      'purchase_units': [{'description': name, 'amount': {'currency_code': 'USD', 'value': amt, 'breakdown': {'item_total': {'currency_code': 'USD', 'value': amt}}},
                          'items': [{'name': name, 'quantity': '1', 'category': 'PHYSICAL_GOODS', 'unit_amount': {'currency_code': 'USD', 'value': amt}}]}],
      'payment_source': {'paypal': {'experience_context': {'return_url': 'https://example.com/ok', 'cancel_url': 'https://example.com/no', 'user_action': 'PAY_NOW', 'shipping_preference': 'GET_FROM_FILE'}}},
    }, tok)
    print('create', amt, st, order.get('id'))
    approve = next(l['href'] for l in order['links'] if l['rel'] in ('payer-action', 'approve'))
    ctx = b.new_context(); pg = ctx.new_page()
    pg.goto(approve); buyer_login(pg)
    for sel in ['#payment-submit-btn', 'text=Complete Purchase', 'text=Pay Now', 'text=Continue']:
      loc = pg.locator(sel)
      if loc.count() and loc.first.is_visible(): loc.first.click(); break
    pg.wait_for_url('https://example.com/**', timeout=60000)
    ctx.close()
    st, cap = call('POST', f"/v2/checkout/orders/{order['id']}/capture", {}, tok)
    c = cap['purchase_units'][0]['payments']['captures'][0]
    print('capture', st, c['status'], c['id'])
    done.append({'order_id': order['id'], 'capture_id': c['id'], 'amount': amt, 'item': name, 'capture_status': c['status']})
  b.close()
json.dump(done, open(path, 'w'), indent=2)
