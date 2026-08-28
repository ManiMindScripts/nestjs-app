import type { Request, Response } from 'express';
import { CorrelationMiddleware } from './correlation.middleware';
import { CorrelationService } from './correlation.service';

describe('CorrelationMiddleware', () => {
  const service = new CorrelationService();
  let middleware: CorrelationMiddleware;
  let next: jest.Mock;

  const makeReqRes = (headerValue?: string) => {
    const headers: Record<string, string> = headerValue
      ? { 'x-request-id': headerValue }
      : {};
    const request = {
      header: (name: string) => headers[name.toLowerCase()],
    } as unknown as Request;
    const setHeader = jest.fn() as jest.Mock<[string, string], []>;
    const response = { setHeader } as unknown as Response;
    return { request, response, setHeader };
  };

  beforeEach(() => {
    middleware = new CorrelationMiddleware(service);
    next = jest.fn();
  });

  it('mints an id when none is supplied and sets it on the response', () => {
    const { request, response, setHeader } = makeReqRes();

    middleware.use(request, response, next);

    expect(setHeader).toHaveBeenCalledWith(
      'x-request-id',
      expect.stringMatching(/^[0-9a-f]{32}$/),
    );
    expect(next).toHaveBeenCalled();
  });

  it('honours a valid inbound id', () => {
    const { request, response, setHeader } = makeReqRes('client-id-123');

    middleware.use(request, response, next);

    expect(setHeader).toHaveBeenCalledWith('x-request-id', 'client-id-123');
  });

  it('ignores an invalid inbound id and mints a fresh one', () => {
    const { request, response, setHeader } = makeReqRes('\nbad\r');

    middleware.use(request, response, next);

    const id: unknown = setHeader.mock.calls[0][1];
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(id).not.toBe('\nbad\r');
  });

  it('runs next() inside the correlation context', () => {
    const { request, response } = makeReqRes('corr-1');

    let seenInside: string | undefined;
    middleware.use(request, response, () => {
      seenInside = service.getId();
      next();
    });

    expect(seenInside).toBe('corr-1');
  });

  it('clears the context after the handler completes', () => {
    const { request, response } = makeReqRes('corr-1');

    middleware.use(request, response, next);

    expect(service.getId()).toBeUndefined();
  });
});
