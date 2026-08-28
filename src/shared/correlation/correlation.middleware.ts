import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { CorrelationService } from './correlation.service';

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Every HTTP request runs inside a correlation context and echoes its id back
 * on the response so clients can tie a log line back to their request. A
 * client-supplied id is honored (after sanitization) so a caller can correlate
 * across internal retries; otherwise one is minted.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  constructor(private readonly correlationService: CorrelationService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const header = request.header(REQUEST_ID_HEADER);
    const id = this.correlationService.isValidHeader(header)
      ? header
      : this.correlationService.generate();

    response.setHeader(REQUEST_ID_HEADER, id);
    this.correlationService.run(id, () => next());
  }
}
