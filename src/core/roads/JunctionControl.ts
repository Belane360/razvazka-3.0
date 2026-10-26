/** Settings are scoped to one (q,r,level), never shared across stacked roads. */
export interface JunctionSettings {
  mode: "off" | "paired" | "individual";
  greenSeconds: number;
  allowLeft: boolean;
  mainRoadMask: number | null;
}
export type SignalState = "off" | "green" | "yellow" | "red";
export const DEFAULT_JUNCTION: Readonly<JunctionSettings> = Object.freeze({
  mode: "off",
  greenSeconds: 6,
  allowLeft: false,
  mainRoadMask: null,
});
export function isLeft(inEdge: number, outEdge: number): boolean {
  return (
    inEdge >= 0 && outEdge >= 0 && [1, 2].includes((outEdge - inEdge + 6) % 6)
  );
}
export function signalState(
  settings: JunctionSettings,
  mask: number,
  edge: number,
  time: number,
): SignalState {
  if (settings.mode === "off") return "off";
  const edges = Array.from({ length: 6 }, (_, e) => e).filter(
    (e) => mask & (1 << e),
  );
  const groups = [
    ...new Set(edges.map((e) => (settings.mode === "paired" ? e % 3 : e))),
  ].sort((a, b) => a - b);
  if (!groups.length || !(mask & (1 << edge))) return "red";
  const period = settings.greenSeconds + 2;
  const phase = Math.floor(Math.max(0, time) / period) % groups.length;
  if (groups[phase] !== (settings.mode === "paired" ? edge % 3 : edge))
    return "red";
  const elapsed = Math.max(0, time) % period;
  return elapsed < settings.greenSeconds
    ? "green"
    : elapsed < settings.greenSeconds + 1
      ? "yellow"
      : "red";
}
