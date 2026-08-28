import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import 'winston-daily-rotate-file';
import { CorrelationService } from '../correlation/correlation.service';

/**
 * Injects the active correlation id into every log line at write-time. The id
 * lives in AsyncLocalStorage (set by CorrelationMiddleware / WS guards), so
 * this single format hook threads it through every logger without each
 * call site having to pass it manually.
 */
const withRequestId = (
  correlationService: CorrelationService,
): winston.Logform.Format =>
  winston.format((info) => {
    const requestId = correlationService.getId();
    if (requestId) {
      info.requestId = requestId;
    }
    return info;
  })();

const devConsoleFormat = (correlationService: CorrelationService) =>
  winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize({ all: true }),
    withRequestId(correlationService),
    winston.format.printf(
      ({ timestamp, level, message, context, requestId, ...meta }) => {
        const ctx = typeof context === 'string' ? ` [${context}]` : '';
        const req = typeof requestId === 'string' ? ` req=${requestId}` : '';
        const extra =
          Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
        return `${String(timestamp)}${ctx}${req} ${level} ${String(message)}${extra}`;
      },
    ),
  );

const jsonFileFormat = (correlationService: CorrelationService) =>
  winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.timestamp(),
    winston.format.ms(),
    withRequestId(correlationService),
    winston.format.json(),
  );

@Module({
  imports: [
    WinstonModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService, CorrelationService],
      useFactory: (
        configService: ConfigService,
        correlationService: CorrelationService,
      ) => {
        const nodeEnv = configService.get<string>('app.nodeEnv');
        const logLevel = configService.get<string>('app.logLevel') ?? 'info';
        const isProduction = nodeEnv === 'production';

        return {
          transports: [
            new winston.transports.Console({
              level: logLevel,
              format: isProduction
                ? jsonFileFormat(correlationService)
                : devConsoleFormat(correlationService),
            }),
            new winston.transports.DailyRotateFile({
              dirname: 'logs',
              filename: 'application-%DATE%.log',
              datePattern: 'YYYY-MM-DD',
              zippedArchive: true,
              maxSize: '20m',
              maxFiles: '14d',
              level: logLevel,
              format: jsonFileFormat(correlationService),
            }),
            new winston.transports.DailyRotateFile({
              dirname: 'logs',
              filename: 'error-%DATE%.log',
              datePattern: 'YYYY-MM-DD',
              zippedArchive: true,
              maxSize: '20m',
              maxFiles: '30d',
              level: 'error',
              format: jsonFileFormat(correlationService),
            }),
          ],
        };
      },
    }),
  ],
})
export class LoggerModule {}
