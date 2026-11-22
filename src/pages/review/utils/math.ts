/** Rounds to whole cents so sums of decimal amounts compare and display without float noise. */
export const roundCents = (n: number): number => Math.round(n * 100) / 100
