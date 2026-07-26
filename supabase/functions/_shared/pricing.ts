// Shared GST/pricing calculation — single source of truth used by the admin pricing
// screen, booking flow, Scout payout step, and invoice/RCTI generation.
//
// Confirmed model (accountant-confirmed, 2026-07-26): Spekto is the PRINCIPAL supplier
// of the inspection service, not an agent/facilitator. GST applies to the full supply
// value (pay_to_scout + fee_excluding_gst), never to the fee alone.

export interface InspectionPricing {
  payToScout: number
  feeExcludingGst: number
  gst: number
  total: number
  supplyValue: number
}

export function calculateInspectionPricing(payToScout: number, feeExcludingGst: number): InspectionPricing {
  const supplyValue = payToScout + feeExcludingGst
  const gst = Math.round(supplyValue * 0.10 * 100) / 100
  const total = Math.round((supplyValue + gst) * 100) / 100
  return { payToScout, feeExcludingGst, gst, total, supplyValue }
}

export interface ScoutPayout {
  grossPayout: number
  gstComponent: number
  netToScout: number
}

// scoutIsGstRegistered must be evaluated at PAYOUT time, not booking time — a Scout can
// register for GST between accepting a job and completing it.
export function calculateScoutPayout(payToScout: number, scoutIsGstRegistered: boolean): ScoutPayout {
  if (!scoutIsGstRegistered) {
    return { grossPayout: payToScout, gstComponent: 0, netToScout: payToScout }
  }
  const gstComponent = Math.round(payToScout * 0.10 * 100) / 100
  const grossPayout = Math.round((payToScout + gstComponent) * 100) / 100
  return { grossPayout, gstComponent, netToScout: payToScout }
}

export interface SpektoMarginResult {
  netGstRemitted: number
  margin: number
}

// margin should always equal feeExcludingGst regardless of the Scout's GST status —
// this is the core invariant to assert in tests.
export function calculateSpektoMargin(
  clientTotal: number,
  gstOnSupply: number,
  scoutGrossPayout: number,
  scoutGstCredit: number,
): SpektoMarginResult {
  const netGstRemitted = Math.round((gstOnSupply - scoutGstCredit) * 100) / 100
  const margin = Math.round((clientTotal - scoutGrossPayout - netGstRemitted) * 100) / 100
  return { netGstRemitted, margin }
}

// Whether GST should actually be charged on a booking made "now" — checks both the
// company-level registration flag AND the effective-from date, so pricing edited before
// registration is finalised never leaks real GST into a live charge.
export function isGstActiveNow(companySettings: { gst_registered: boolean; gst_effective_from: string | null }): boolean {
  if (!companySettings.gst_registered) return false
  if (!companySettings.gst_effective_from) return false
  const today = new Date().toISOString().split('T')[0]
  return today >= companySettings.gst_effective_from
}

// Applies the GST gate to a pricing row fetched from `pricing` — returns the actual
// figures to charge/snapshot for a booking made right now.
export function gatedPricingSnapshot(
  pricingRow: { pay_to_scout: number; fee_excluding_gst: number; gst: number; total: number },
  companySettings: { gst_registered: boolean; gst_effective_from: string | null },
) {
  if (isGstActiveNow(companySettings)) {
    return {
      pay_to_scout: pricingRow.pay_to_scout,
      fee_excluding_gst: pricingRow.fee_excluding_gst,
      gst: pricingRow.gst,
      total: pricingRow.total,
    }
  }
  return {
    pay_to_scout: pricingRow.pay_to_scout,
    fee_excluding_gst: pricingRow.fee_excluding_gst,
    gst: 0,
    total: pricingRow.pay_to_scout + pricingRow.fee_excluding_gst,
  }
}
