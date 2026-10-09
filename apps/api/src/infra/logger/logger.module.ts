import type { DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { Logger } from 'pino';

/**
 * nestjs-pino na tym samym loggerze co Fastify (`useExisting`): logi NestJS (także startowe,
 * buforowane przez bufferLogs) idą przez pino, a logi z kodu obsługującego żądanie mają reqId,
 * bo PinoLogger i Logger z @nestjs/common korzystają z loggera żądania z Fastify.
 */
export function createLoggerModule(logger: Logger): DynamicModule {
  return LoggerModule.forRoot({
    pinoHttp: { logger },
    useExisting: true,
  });
}
