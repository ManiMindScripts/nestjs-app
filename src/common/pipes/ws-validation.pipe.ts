import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
  ValidationPipe,
} from '@nestjs/common';
import type { ValidationPipeOptions } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { validationPipeOptions } from './validation-pipe-options';

@Injectable()
export class WsValidationPipe extends ValidationPipe implements PipeTransform {
  constructor(options?: ValidationPipeOptions) {
    super({ ...validationPipeOptions, ...options });
  }

  async transform(
    value: unknown,
    metadata: ArgumentMetadata,
  ): Promise<unknown> {
    try {
      return await super.transform(value, metadata);
    } catch (error) {
      if (error instanceof BadRequestException) {
        const response = error.getResponse();
        const message =
          typeof response === 'string'
            ? response
            : ((response as { message?: string | string[] }).message ??
              'Validation failed');
        throw new WsException(message);
      }
      throw error;
    }
  }
}
