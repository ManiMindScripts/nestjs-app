import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

const devConsoleFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, context, ...meta }) => {
    const ctx = typeof context === 'string' ? ` [${context}]` : '';
    const extra =
      Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `${String(timestamp)}${ctx} ${level} ${String(message)}${extra}`;
  }),
);

const jsonFileFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  winston.format.timestamp(),
  winston.format.ms(),
  winston.format.json(),
);

@Module({
  imports: [
    WinstonModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const nodeEnv = configService.get<string>('app.nodeEnv');
        const logLevel = configService.get<string>('app.logLevel') ?? 'info';
        const isProduction = nodeEnv === 'production';

        return {
          transports: [
            new winston.transports.Console({
              level: logLevel,
              format: isProduction ? jsonFileFormat : devConsoleFormat,
            }),
            new winston.transports.DailyRotateFile({
              dirname: 'logs',
              filename: 'application-%DATE%.log',
              datePattern: 'YYYY-MM-DD',
              zippedArchive: true,
              maxSize: '20m',
              maxFiles: '14d',
              level: logLevel,
              format: jsonFileFormat,
            }),
            new winston.transports.DailyRotateFile({
              dirname: 'logs',
              filename: 'error-%DATE%.log',
              datePattern: 'YYYY-MM-DD',
              zippedArchive: true,
              maxSize: '20m',
              maxFiles: '30d',
              level: 'error',
              format: jsonFileFormat,
            }),
          ],
        };
      },
    }),
  ],
})
export class LoggerModule {}
