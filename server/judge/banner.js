// Which demo path the visitor is on, shown as a banner so nobody meets a dead end.
export function bannerFor({ mode, claim, realIds = [] }) {
  if (mode === 'hybrid') {
    const extra = claim ? ' 2 more practice cases were added to the stand-in.' : ''
    if (!realIds.length) return { layer: 0, text: `Sandbox demo mode: every prepared real sandbox case has been used, so case A runs on the stand-in like B and C. Open the Recorded run for real sandbox responses. Store figures come from a demo store ledger.${extra}`, writes: true }
    return { layer: 0, text: `Sandbox demo mode: case A is a real PayPal sandbox dispute (${realIds.join(', ')}); approving its refund calls api-m.sandbox.paypal.com. Cases B and C run on the stand-in. Store figures come from a demo store ledger.${extra}`, writes: true }
  }
  if (mode === 'mock') {
    const extra = claim ? ' Path 0: 2 more practice cases were added to your copy.' : ''
    return { layer: 0, text: `Offline demo: your own private copy of a PayPal Disputes API stand-in. Store figures come from a demo store ledger.${extra}`, writes: true }
  }
  if (!claim || claim.layer === 3) {
    return { layer: claim ? 3 : 0, text: claim ? 'No live cases are free right now. Open the Recorded run (real sandbox responses) or run it locally.' : 'Read-only: real PayPal sandbox disputes and the planner. Click "Claim my cases" to act on two of them.', writes: false }
  }
  if (claim.layer === 1) return { layer: 1, text: 'Your two sandbox cases come from the live pool. Actions on them are real sandbox calls.', writes: true }
  return { layer: 2, text: claim.claimStage ? 'Your cases are reserved sandbox disputes; at least one is already a claim, so it counts in the rate. Use the Recorded run for the inquiry-stage flow.' : 'Your cases are reserved sandbox inquiries. Settling one keeps it out of the dispute rate.', writes: true }
}
