/**
 * Canonical form for every number in an image URL: at most 3 decimals, no
 * trailing zeros, no exponent. The backend rejects any other spelling (spec
 * 12.1), so `1.5` and `1.50` can never become two cache entries.
 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`Cannot format ${n} for a URL`)
  // `toFixed` and `String` switch to exponent notation from 1e21 on. Numbers
  // that large are integers, so BigInt prints all their digits.
  if (Math.abs(n) >= 1e21) return BigInt(n).toString()
  // Number() drops trailing zeros and turns -0 into 0.
  return String(Number(n.toFixed(3)))
}
