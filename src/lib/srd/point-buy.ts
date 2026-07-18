// Standard 5e point buy: 27 points, scores 8-15 before racial bonuses.
export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_MIN = 8;
export const POINT_BUY_MAX = 15;

const COSTS: Record<number, number> = {
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 7,
  15: 9,
};

export function pointBuyCost(score: number): number {
  const cost = COSTS[score];
  if (cost === undefined) {
    throw new Error(`Score ${score} is outside the point-buy range (8-15).`);
  }
  return cost;
}

export function pointBuyTotal(scores: number[]): number {
  return scores.reduce((total, score) => total + pointBuyCost(score), 0);
}

export function pointBuyRemaining(scores: number[]): number {
  return POINT_BUY_BUDGET - pointBuyTotal(scores);
}
