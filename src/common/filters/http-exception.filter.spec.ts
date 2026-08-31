import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let json: jest.Mock<unknown, [body?: unknown]>;
  let status: jest.Mock<{ json: typeof json }, [number]>;
  let response: {
    status: jest.Mock<{ json: typeof json }, [number]>;
    json: jest.Mock<unknown, [body?: unknown]>;
  };
  let request: { method: string; url: string };
  let host: ArgumentsHost;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    json = jest.fn<unknown, [body?: unknown]>();
    status = jest
      .fn<{ json: typeof json }, [number]>()
      .mockReturnValue({ json });
    response = { status, json };
    request = { method: 'GET', url: '/api/users/me' };
    host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    filter = new HttpExceptionFilter();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps a string-body HttpException', () => {
    filter.catch(new BadRequestException('bad input'), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'bad input',
        path: '/api/users/me',
      }),
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('maps an object-body HttpException, preserving its message array', () => {
    const exception = new BadRequestException(['first', 'second']);
    filter.catch(exception, host);

    const body = json.mock.calls[0][0] as {
      statusCode: number;
      message: string[];
      error?: string;
      timestamp: string;
    };
    expect(body.statusCode).toBe(400);
    expect(body.message).toEqual(['first', 'second']);
    expect(body.error).toBe('Bad Request');
    expect(body.timestamp).toEqual(expect.any(String));
  });

  it('maps a non-HttpException to 500 and logs the stack', () => {
    const error = new Error('boom');
    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'Internal server error',
        error: 'Internal Server Error',
        path: '/api/users/me',
      }),
    );
    expect(errorSpy).toHaveBeenCalled();
  });

  it('does not leak the original message for 500 responses', () => {
    filter.catch(new Error('sensitive stack detail'), host);

    const body = json.mock.calls[0][0] as { message: string };
    expect(body.message).toBe('Internal server error');
  });
});
