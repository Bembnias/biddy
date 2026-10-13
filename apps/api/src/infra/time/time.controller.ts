import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Czas serwera (UTC, ISO 8601 z milisekundami). */
export class ServerTimeDto extends createZodDto(
  z.object({
    serverTime: z.iso
      .datetime()
      .describe('Czas serwera w chwili odpowiedzi (UTC, ISO 8601), np. 2026-12-24T19:00:00.123Z'),
  }),
) {}

/**
 * Czas serwera do synchronizacji zegara klienta (PROJECT.md §15.4): klient mierzy t0 i t1 wokół
 * żądania i liczy przesunięcie `serverTime − (t0 + t1) / 2`. Liczniki aukcji w UI opierają się
 * na tym przesunięciu, a ostateczną decyzję o czasie oferty i tak podejmuje serwer.
 */
@ApiTags('time')
@Controller('time')
export class TimeController {
  @Get()
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Czas serwera (synchronizacja zegara klienta)' })
  @ZodResponse({ status: 200, description: 'Czas serwera', type: ServerTimeDto })
  getServerTime(): ServerTimeDto {
    return { serverTime: new Date().toISOString() };
  }
}
