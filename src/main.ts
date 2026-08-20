import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';
import { AppConfig } from './config/app.config';
import { buildCorsOptions } from './config/cors.config';
import { validationPipeOptions } from './common/pipes/validation-pipe-options';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  const configService = app.get(ConfigService);
  const appConfig = configService.getOrThrow<AppConfig>('app');

  app.setGlobalPrefix(appConfig.apiPrefix);
  const corsOptions = buildCorsOptions(appConfig.corsOrigin);
  app.enableCors(corsOptions);
  app.useWebSocketAdapter(new RedisIoAdapter(app, corsOptions));
  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());

  app.useGlobalPipes(new ValidationPipe(validationPipeOptions));

  if (appConfig.swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('My app API')
      .setDescription('API Documentation')
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
