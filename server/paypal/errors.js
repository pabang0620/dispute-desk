// Error shape PayPal returns (observed in sandbox): { name, message, debug_id, details: [{ issue }] }
export class PayPalError extends Error {
  constructor(status, name, issue, message) {
    super(message || name)
    this.status = status
    this.paypalName = name
    this.issue = issue
    this.body = {
      name,
      message: message || 'The requested action could not be performed, semantically incorrect, or failed business validation.',
      debug_id: Math.random().toString(16).slice(2, 15),
      information_link: 'https://developer.paypal.com/docs/api/customer-disputes/v1/#errors',
      details: [{ issue }],
      links: [],
    }
  }
}

export const notAllowed = (status = 422) =>
  new PayPalError(status, status === 400 ? 'INVALID_REQUEST' : 'UNPROCESSABLE_ENTITY', 'ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE')
