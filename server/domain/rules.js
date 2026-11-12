import scenario from '../data/scenario.json' with { type: 'json' }

// PayPal published dispute-fee rules (help349, help350, fee table of 2026-11-04). Values live in scenario.json.
export const RULES = Object.freeze({ ...scenario.rules })

export const TIER = Object.freeze({ STANDARD: 'STANDARD', HIGH_VOLUME: 'HIGH_VOLUME' })

// P4: more than 100 sales in the previous 3 full months and a dispute rate of 1.5% or more.
// Compared in cents with integers so 1.5% exactly counts as High Volume.
export function tierFor({ claimsCents, salesCents, salesCount }) {
  const rate = salesCents > 0 ? claimsCents / salesCents : 0
  const highVolume = salesCount > RULES.highVolumeMinSales && claimsCents * 1000 >= salesCents * Math.round(RULES.highVolumeRate * 1000)
  return { rate, tier: highVolume ? TIER.HIGH_VOLUME : TIER.STANDARD }
}

export function disputeFee(tier) {
  return tier === TIER.HIGH_VOLUME ? RULES.highVolumeFee : RULES.standardFee
}
