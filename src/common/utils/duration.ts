const UNIT_TO_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

export function parseDurationToMs(duration: string): number {
  const match = /^(\d+)(s|m|h|d|w)$/.exec(duration.trim());

  if (!match) {
    throw new Error(`Invalid duration format: "${duration}"`);
  }

  return parseInt(match[1], 10) * UNIT_TO_MS[match[2]];
}
