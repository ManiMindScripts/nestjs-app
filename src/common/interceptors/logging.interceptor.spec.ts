import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Logger,
} from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let metrics: { record: jest.Mock };
  let context: ExecutionContext;
  let response: { statusCode: number };
  let request: {
    method: string;
    originalUrl: string;
    path: string;
    route?: { path?: unknown } | undefined;
  };
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  const buildHandler = (value: unknown = { ok: true }): CallHandler => ({
    handle: () => of(value),
  });

  beforeEach(() => {
    metrics = { record: jest.fn() };
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    interceptor = new LoggingInterceptor(metrics as never);
    request = {
      method: 'GET',
      originalUrl: '/api/users/me',
      path: '/api/users/me',
      route: { path: '/users/me' },
    };
    response = { statusCode: 200 };
    context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs the request and records a metric on success', (done) => {
    interceptor.intercept(context, buildHandler()).subscribe(() => {
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('GET /api/users/me 200'),
      );
      expect(metrics.record).toHaveBeenCalledWith(
        '/users/me',
        200,
        expect.any(Number),
      );
      done();
    });
  });

  it('falls back to a normalized route key when no route matched', (done) => {
    request.route = undefined;
    request.path = '/api/users/00000000-0000-4000-8000-000000000000';

    interceptor.intercept(context, buildHandler()).subscribe(() => {
      expect(metrics.record).toHaveBeenCalledWith(
        '/api/users/:id',
        200,
        expect.any(Number),
      );
      done();
    });
  });

  it('logs a warning and records the HttpException status on error', (done) => {
    const handler = {
      handle: () => throwError(() => new HttpException('Forbidden', 403)),
    } as unknown as CallHandler;

    interceptor.intercept(context, handler).subscribe({
      error: () => {
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('GET /api/users/me 403'),
        );
        expect(metrics.record).toHaveBeenCalledWith(
          '/users/me',
          403,
          expect.any(Number),
        );
        done();
      },
    });
  });

  it('records 500 for a non-HttpException error', (done) => {
    const handler = {
      handle: () => throwError(() => new Error('boom')),
    } as unknown as CallHandler;

    interceptor.intercept(context, handler).subscribe({
      error: () => {
        expect(metrics.record).toHaveBeenCalledWith(
          '/users/me',
          500,
          expect.any(Number),
        );
        done();
      },
    });
  });
});
