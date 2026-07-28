import { roundCredits } from './credit-math';

export type VideoBillingAdjustment = {
  requestedDuration: number;
  reportedDurationSeconds: number;
  actualBillableDuration: number;
  quotedCredits: number;
  actualCredits: number;
  refundCredits: number;
};

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function billableVideoSeconds(value: unknown): number | null {
  const seconds = positiveNumber(value);
  if (seconds == null) return null;
  return Math.max(1, Math.ceil(seconds - 0.05));
}

export function calculateVideoBillingAdjustment(input: {
  requestedDuration: unknown;
  reportedDurationSeconds: unknown;
  quotedCredits: unknown;
  unitCredits: unknown;
}): VideoBillingAdjustment | null {
  const requestedDuration = positiveNumber(input.requestedDuration);
  const reportedDurationSeconds = positiveNumber(input.reportedDurationSeconds);
  const quotedCredits = positiveNumber(input.quotedCredits);
  const unitCredits = positiveNumber(input.unitCredits);
  if (requestedDuration == null || reportedDurationSeconds == null || quotedCredits == null || unitCredits == null) {
    return null;
  }

  const actualBillableDuration = billableVideoSeconds(reportedDurationSeconds);
  if (actualBillableDuration == null || actualBillableDuration >= requestedDuration) return null;

  const actualCredits = roundCredits(unitCredits * actualBillableDuration);
  const refundCredits = roundCredits(quotedCredits - actualCredits);
  if (refundCredits < 0.1) return null;

  return {
    requestedDuration,
    reportedDurationSeconds,
    actualBillableDuration,
    quotedCredits: roundCredits(quotedCredits),
    actualCredits,
    refundCredits
  };
}
