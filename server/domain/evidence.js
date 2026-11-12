import { getStoreOrder } from '../data/storeOrders.js'

// Evidence checklist. Every item carries the id of the record it came from; an item without a source is rejected,
// so neither the model nor the UI can claim "delivered" without a record behind it.
export function buildChecklist(dispute, kind, orderId) {
  const order = orderId ? getStoreOrder(orderId) : null
  const message = (dispute.messages || [])[0]
  const items = []
  items.push({ id: 'buyer_message', label: 'Buyer message read', present: Boolean(message), sourceId: message ? `dispute:${dispute.dispute_id}:messages[0]` : null, value: message?.content?.slice(0, 160) })
  items.push({ id: 'order', label: 'Order found in store records', present: Boolean(order), sourceId: order ? `order:${order.orderId}` : null, value: order ? `${order.item}, order ${order.orderId}` : null })
  if (kind === 'INR') {
    const t = order?.tracking
    items.push({ id: 'tracking', label: 'Tracking shows delivered', present: t?.status === 'DELIVERED', sourceId: t ? `tracking:${t.carrier}:${t.number}` : null, value: t ? `${t.carrier} ${t.number}, ${t.status} ${t.deliveredOn}` : null })
    const same = order && order.shipToAddress === order.transactionAddress
    items.push({ id: 'address', label: 'Shipped to the transaction address', present: Boolean(same), sourceId: order ? `order:${order.orderId}:shipToAddress` : null, value: order?.shipToAddress })
  } else {
    items.push({ id: 'listing_text', label: 'Listing text', present: Boolean(order?.listingText), sourceId: order ? `order:${order.orderId}:listingText` : null, value: order?.listingText })
    items.push({ id: 'listing_photo', label: 'Listing photos', present: (order?.listingPhotos || 0) > 0, sourceId: order ? `order:${order.orderId}:listingPhotos` : null, value: order ? `${order.listingPhotos} photos` : null })
    const t = order?.tracking
    items.push({ id: 'tracking', label: 'Delivery confirmed', present: t?.status === 'DELIVERED', sourceId: t ? `tracking:${t.carrier}:${t.number}` : null, value: t ? `${t.carrier} ${t.number}, ${t.status}` : null })
  }
  return items
}

export function validateChecklist(items) {
  const bad = items.filter((i) => i.present && !i.sourceId)
  return bad.length ? { ok: false, error: `Checklist items without a source record: ${bad.map((b) => b.id).join(', ')}` } : { ok: true }
}

// The reply may only contain dollar amounts the server computed. Any other amount is rejected.
export function validateDraftAmounts(text, allowed) {
  const found = [...String(text).matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g)].map((m) => Number(m[1].replace(/,/g, '')))
  const ok = new Set(allowed.map((a) => Math.round(a * 100)))
  const invented = found.filter((n) => !ok.has(Math.round(n * 100)))
  return invented.length ? { ok: false, invented } : { ok: true }
}

export function defaultDraft({ kind, action, amount, offerAmount, item, order }) {
  const fmt = (n) => `$${n.toFixed(2)}`
  if (action === 'accept_claim') {
    return `Hi, I am sorry the ${item} did not work out. I have refunded the full ${fmt(amount)} to your PayPal account. Thank you for your patience.`
  }
  if (action === 'make_offer') {
    return `Hi, I am sorry the ${item} was not what you expected. I would like to offer a partial refund of ${fmt(offerAmount)} so we can close this directly. If that works for you, please accept it in the Resolution Center.`
  }
  if (action === 'provide_evidence' && kind === 'INR' && order?.tracking) {
    const t = order.tracking
    return `The ${item} was shipped with ${t.carrier} tracking number ${t.number} to the address on the transaction. Tracking shows it was delivered on ${t.deliveredOn}.`
  }
  if (action === 'provide_evidence') {
    return `Attached are the listing text and photos for the ${item}, and the delivery confirmation.`
  }
  if (action === 'send_message') return `Hi, thank you for contacting us about the ${item}. We are looking into your case and will reply with an update shortly.`
  if (action === 'escalate') return `We disagree that the ${item} was not as described or not received and ask PayPal to review the records we provided.`
  return `Hi, thank you for contacting us about the ${item}. We are looking into it and will reply shortly.`
}
