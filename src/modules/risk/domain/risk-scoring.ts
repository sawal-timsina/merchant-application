import { RiskLevel } from './risk.enums';

export interface RiskInput {
  mcc: string | null;
  expectedMonthlyVolumeCents: number;
  averageTicketCents: number;
  businessType: string;
}

export interface KybResult {
  reference: string;
  businessVerified: boolean;
  watchlistHit: boolean;
}

/** Card-network categories commonly treated as high risk (gambling, quasi-cash/crypto, money transfer, telemarketing). */
const HIGH_RISK_MCCS = new Set(['7995', '6051', '4829', '5967', '5993']);
const HIGH_VOLUME_CENTS = 50_000_000; // 500k per month
const LARGE_TICKET_CENTS = 500_000; // 5k per transaction

export function scoreApplication(
  input: RiskInput,
  kyb: KybResult,
): { score: number; level: RiskLevel; reasons: string[] } {
  if (kyb.watchlistHit) return { score: 100, level: RiskLevel.HIGH, reasons: ['watchlist_hit'] };

  const reasons: string[] = [];
  let score = 10;
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(reason);
  };
  if (input.mcc && HIGH_RISK_MCCS.has(input.mcc)) add(40, 'high_risk_mcc');
  if (input.expectedMonthlyVolumeCents > HIGH_VOLUME_CENTS) add(20, 'high_volume');
  if (input.averageTicketCents > LARGE_TICKET_CENTS) add(15, 'large_ticket');
  if (input.businessType === 'SOLE_PROPRIETOR') add(5, 'sole_proprietor');
  if (!kyb.businessVerified) add(30, 'business_unverified');

  score = Math.min(100, Math.max(0, score));
  const level = score < 40 ? RiskLevel.LOW : score < 70 ? RiskLevel.MEDIUM : RiskLevel.HIGH;
  return { score, level, reasons };
}
