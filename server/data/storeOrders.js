// Demo store data for Juniper Home: orders, shipping addresses, tracking and listing text.
// A sandbox seller has none of this history, so the screen labels it "demo store data".
export const STORE_ORDERS = {
  'JH-1042': {
    orderId: 'JH-1042',
    item: 'Wool Blanket',
    listingTitle: 'Highland Wool Throw, charcoal grey',
    listingText: 'Brushed wool-blend throw, 50 x 60 in, charcoal grey. Wool blend, 80 percent wool.',
    listingPhotos: 3,
    transactionAddress: '18 Alder Row, Portland, OR 97205',
    shipToAddress: '18 Alder Row, Portland, OR 97205',
    tracking: { carrier: 'USPS', number: '9400111899223100000118', status: 'DELIVERED', deliveredOn: '2026-10-29' },
    inquiries: [],
    physical: true,
  },
  'JH-1049': {
    orderId: 'JH-1049',
    item: 'Ceramic Lamp Shade',
    listingTitle: 'Stoneware lamp shade, small',
    listingText: 'Hand glazed stoneware shade, 7 in diameter. Small imperfections are part of the glaze.',
    listingPhotos: 2,
    transactionAddress: '402 Birch Court, Austin, TX 78704',
    shipToAddress: '402 Birch Court, Austin, TX 78704',
    tracking: { carrier: 'UPS', number: '1Z999AA10123456784', status: 'DELIVERED', deliveredOn: '2026-11-02' },
    inquiries: [],
    physical: true,
  },
  'JH-1051': {
    orderId: 'JH-1051',
    item: 'Desk Lamp',
    listingTitle: 'Brass desk lamp',
    listingText: 'Brass desk lamp with linen shade. Ships in 2 business days.',
    listingPhotos: 4,
    transactionAddress: '77 Harbor Street, Boston, MA 02110',
    shipToAddress: '77 Harbor Street, Boston, MA 02110',
    tracking: { carrier: 'USPS', number: '9400111899223100000204', status: 'DELIVERED', deliveredOn: '2026-10-30' },
    inquiries: [{ date: '2026-11-04', from: 'BUYER', text: 'Has my lamp shipped?' }],
    physical: true,
  },
}

export function getStoreOrder(orderId) {
  return STORE_ORDERS[orderId] || null
}
