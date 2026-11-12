import { TIER } from './rules.js'

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

// P11: Seller Protection for item-not-received needs proof of delivery to the address on the transaction.
// Not covered: not-as-described, claims a buyer files with a card issuer, non-physical goods.
// In the High Volume tier PayPal says Seller Protection may be lost (P5), so it is not counted there.
export function sellerProtectionCheck({ kind, filedWith = 'PAYPAL', tracking, transactionAddress, shipToAddress, physical = true, tier }) {
  const checks = [
    { id: 'inr', ok: kind === 'INR', text: 'Reason is item not received (not-as-described is not covered)' },
    { id: 'paypal_filed', ok: filedWith === 'PAYPAL', text: 'Filed with PayPal, not as a card issuer chargeback' },
    { id: 'delivered', ok: tracking?.status === 'DELIVERED', text: 'Trackable shipment with a delivered status' },
    {
      id: 'address',
      ok: Boolean(transactionAddress && shipToAddress) && norm(transactionAddress) === norm(shipToAddress),
      text: 'Shipped to the address on the transaction details page',
    },
    { id: 'physical', ok: physical === true, text: 'Physical item' },
    { id: 'tier', ok: tier !== TIER.HIGH_VOLUME, text: 'Dispute created while the account was in the Standard tier' },
  ]
  const failed = checks.filter((c) => !c.ok)
  return {
    eligible: failed.length === 0,
    checks,
    mayNotApply: tier === TIER.HIGH_VOLUME,
    summary: failed.length === 0 ? 'Seller Protection eligible' : `Not eligible: ${failed.map((c) => c.id).join(', ')}`,
  }
}
