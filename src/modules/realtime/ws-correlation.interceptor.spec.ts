import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { WsCorrelationInterceptor } from './ws-correlation.interceptor';

describe('WsCorrelationInterceptor', () => {
  let interceptor: WsCorrelationInterceptor;
  let correlation: {
    generate: jest.Mock;
    run: jest.Mock;
  };
  let context: ExecutionContext;
  const handler = { handle: () => of(true) } as unknown as CallHandler;

  beforeEach(() => {
    correlation = {
      generate: jest.fn().mockReturnValue('generated-id'),
      run: jest.fn((_id: string, fn: () => unknown) => fn()),
    };
    interceptor = new WsCorrelationInterceptor(correlation as never);
    context = {
      switchToWs: () => ({
        getClient: () => ({ data: {} }),
      }),
    } as unknown as ExecutionContext;
  });

  it('reuses the correlation id persisted on the socket', () => {
    context = {
      switchToWs: () => ({
        getClient: () => ({ data: { correlationId: 'socket-id' } }),
      }),
    } as unknown as ExecutionContext;

    interceptor.intercept(context, handler).subscribe();

    expect(correlation.run).toHaveBeenCalledWith(
      'socket-id',
      expect.any(Function),
    );
    expect(correlation.generate).not.toHaveBeenCalled();
  });

  it('generates a new id when the socket has none', () => {
    interceptor.intercept(context, handler).subscribe();

    expect(correlation.generate).toHaveBeenCalled();
    expect(correlation.run).toHaveBeenCalledWith(
      'generated-id',
      expect.any(Function),
    );
  });
});
