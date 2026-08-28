import { CorrelationService } from './correlation.service';

describe('CorrelationService', () => {
  let service: CorrelationService;

  beforeEach(() => {
    service = new CorrelationService();
  });

  it('returns undefined outside any context', () => {
    expect(service.getId()).toBeUndefined();
  });

  it('exposes the active id inside a run() context', () => {
    service.run('abc', () => {
      expect(service.getId()).toBe('abc');
    });
  });

  it('isolates nested contexts to their own stack depth', () => {
    service.run('outer', () => {
      service.run('inner', () => {
        expect(service.getId()).toBe('inner');
      });
      expect(service.getId()).toBe('outer');
    });
  });

  it('generates unique, hex ids', () => {
    const a = service.generate();
    const b = service.generate();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it.each([
    ['abc', true],
    ['req-123', true],
    ['semi;colon', true],
    ['', false],
    ['x'.repeat(65), false],
    ['with space', false],
    ['tab\tchar', false],
    [undefined, false],
  ])('isValidHeader(%p) is %s', (value, expected) => {
    expect(service.isValidHeader(value)).toBe(expected);
  });
});
