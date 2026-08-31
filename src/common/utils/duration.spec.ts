import { parseDurationToMs } from './duration';

describe('parseDurationToMs', () => {
  it('parses seconds', () => {
    expect(parseDurationToMs('15s')).toBe(15_000);
  });

  it('parses minutes, hours, days and weeks', () => {
    expect(parseDurationToMs('1m')).toBe(60_000);
    expect(parseDurationToMs('2h')).toBe(7_200_000);
    expect(parseDurationToMs('3d')).toBe(259_200_000);
    expect(parseDurationToMs('1w')).toBe(604_800_000);
  });

  it('trims surrounding whitespace', () => {
    expect(parseDurationToMs(' 30m ')).toBe(1_800_000);
  });

  it.each(['', '30', 'ms', '30ms', '1.5m', 'm30', 'abc'])(
    'rejects invalid format "%s"',
    (value) => {
      expect(() => parseDurationToMs(value)).toThrow(/Invalid duration/);
    },
  );
});
