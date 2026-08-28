import { Global, Module } from '@nestjs/common';
import { CorrelationMiddleware } from './correlation.middleware';
import { CorrelationService } from './correlation.service';

@Global()
@Module({
  providers: [CorrelationService, CorrelationMiddleware],
  exports: [CorrelationService, CorrelationMiddleware],
})
export class CorrelationModule {}
