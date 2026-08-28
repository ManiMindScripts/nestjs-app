import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Express } from 'express';
import * as express from 'express';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';
import { AppConfig } from './config/app.config';
import { buildCorsOptions } from './config/cors.config';
import { validationPipeOptions } from './common/pipes/validation-pipe-options';
import { applyTrustProxy } from './config/trust-proxy';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter';
import { CorrelationMiddleware } from './shared/correlation/correlation.middleware';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  const configService = app.get(ConfigService);
  const appConfig = configService.getOrThrow<AppConfig>('app');

  const correlationMiddleware = app.get(CorrelationMiddleware);
  app.use(
    (req: express.Request, res: express.Response, next: express.NextFunction) =>
      correlationMiddleware.use(req, res, next),
  );

  app.setGlobalPrefix(appConfig.apiPrefix);
  const corsOptions = buildCorsOptions(appConfig.corsOrigin);
  app.enableCors(corsOptions);
  applyTrustProxy(
    app.getHttpAdapter().getInstance() as Express,
    appConfig.trustProxy,
  );
  app.useWebSocketAdapter(new RedisIoAdapter(app, corsOptions));
  // Helmet's default CSP blocks the inline scripts the Swagger UI injects.
  // The API serves no HTML besides the docs page, so CSP is disabled while
  // every other helmet protection (HSTS, noSniff, frameguard, ...) stays on.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(compression());
  app.use(cookieParser());

  app.useGlobalPipes(new ValidationPipe(validationPipeOptions));

  if (appConfig.swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('My app API')
      .setDescription(
        'API Documentation. All endpoints are rate-limited; see individual routes for stricter limits.',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${appConfig.apiPrefix}/docs`, app, document);
  }

  app.enableShutdownHooks();

  await app.listen(appConfig.port);
}

void bootstrap();
