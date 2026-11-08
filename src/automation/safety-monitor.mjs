// Messages that mean Instagram is limiting the account. The engine never retries or works around these.
export const SAFETY = {
  captcha: /captcha|security check|confirm (that )?you'?re (a )?human|verify you'?re human/i,
  blocked: /action blocked|try again later|we restrict certain activity|suspicious activity|unusual activity|temporarily blocked|confirm it'?s you|help us confirm|we limit how often/i,
};

/** Counts consecutive FAILED accounts; a streak means something systemic (layout change, network, block). */
export class SafetyMonitor {
  constructor(threshold) { this.threshold = threshold; this.streak = 0; }
  ok() { this.streak = 0; }
  failure() { this.streak++; return this.streak >= this.threshold; }
}
