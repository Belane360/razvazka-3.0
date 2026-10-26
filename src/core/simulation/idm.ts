export interface IDMParameters {
  desiredSpeed: number;
  headway: number;
  minGap: number;
  acceleration: number;
  braking: number;
}
export const CAR: IDMParameters = {
  desiredSpeed: 11,
  headway: 1.1,
  minGap: 1.5,
  acceleration: 2.4,
  braking: 3,
};
export const TRUCK: IDMParameters = {
  desiredSpeed: 8,
  headway: 1.6,
  minGap: 2,
  acceleration: 1.4,
  braking: 2,
};
/** Deterministic Intelligent Driver Model; gap is bumper-to-bumper in metres.
 * Grade lowers power-limited desired speed/acceleration, while drivetrain holds hills.
 */
export function idm(
  speed: number,
  gap: number,
  leaderSpeed: number,
  p: IDMParameters = CAR,
  grade = 0,
): number {
  const uphill = Math.max(0, grade),
    a = p.acceleration / (1 + uphill * 4),
    v0 = p.desiredSpeed / (1 + uphill * 2);
  const desired =
    p.minGap +
    Math.max(
      0,
      speed * p.headway +
        (speed * (speed - leaderSpeed)) / (2 * Math.sqrt(a * p.braking)),
    );
  return Math.max(
    -12,
    a *
      (1 -
        Math.pow(speed / v0, 4) -
        (gap === Infinity ? 0 : Math.pow(desired / Math.max(0.05, gap), 2))),
  );
}
