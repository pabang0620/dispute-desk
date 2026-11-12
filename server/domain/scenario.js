import scenario from '../data/scenario.json' with { type: 'json' }

// The single source of every number shown on screen, in the video and in the Devpost text.
export const SCENARIO = scenario

export function scenarioLedger() {
  return {
    netSales3mo: scenario.store.netSales3mo,
    salesCount: scenario.store.salesCount,
    countedClaims: scenario.store.countedClaims,
    pastDisputes: scenario.store.pastDisputes,
  }
}

export function scenarioCases() {
  return scenario.openInquiries.map((c) => ({
    label: c.label,
    disputeId: c.disputeId,
    kind: c.kind,
    amount: c.amount,
    tierAtCreation: c.tierAtCreation,
    paymentMethod: c.paymentMethod,
    spEligible: Boolean(c.sellerProtectionEligible),
  }))
}

export function scenarioAssumptions() {
  return { ...scenario.assumptions }
}
