import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { MetricsService } from '../../shared/metrics/metrics.service';

// Fallback normalization for requests that never matched a route (e.g. 404):
// collapse UUIDs and id-like segments so the key stays bounded.
const ID_SEGMENT =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9]+/gi;

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();

    const method = request.method;
    const url = request.originalUrl;
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          this.logger.log(
            `${method} ${url} ${response.statusCode} ${duration}ms`,
          );
          this.metricsService.record(
            this.routeKey(request),
            response.statusCode,
            duration,
          );
        },
        error: (error: unknown) => {
          const duration = Date.now() - startTime;
          const status =
            error instanceof HttpException
              ? error.getStatus()
              : HttpStatus.INTERNAL_SERVER_ERROR;
          this.logger.warn(`${method} ${url} ${status} ${duration}ms`);
          // Record the status code only - never the error detail, so nothing
          // sensitive finds its way into /metrics.
          this.metricsService.record(this.routeKey(request), status, duration);
        },
      }),
    );
  }
  private routeKey(request: Request): string {
    const matchedPath = (request.route as { path?: unknown } | undefined)?.path;
    if (typeof matchedPath === 'string' && matchedPath.length > 0) {
      return matchedPath;
    }
    return (request.path ?? '').replace(ID_SEGMENT, ':id') || '/';
  }
}
