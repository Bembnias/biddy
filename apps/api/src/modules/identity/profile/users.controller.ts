import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { DomainError } from '../../../infra/http/index.js';
import { ProfileService } from './profile.service.js';

export class PublicProfileDto extends createZodDto(
  z.object({
    id: z.uuid(),
    name: z.string().describe('Imię wyświetlane'),
    memberSince: z.iso.datetime().describe('Data założenia konta'),
    phoneVerified: z.boolean().describe('Czy konto ma zweryfikowany numer telefonu'),
  }),
) {}

/** Identyfikator w adresie; zły format traktujemy jak nieznany profil (404). */
class UserIdParams extends createZodDto(z.object({ id: z.string().max(64) })) {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Profil publiczny (F-10): bez e-maila, telefonu i adresów. Konto zablokowane: 404. */
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly profiles: ProfileService) {}

  @Get(':id')
  @Header('cache-control', 'public, max-age=60')
  @ApiOperation({ summary: 'Profil publiczny użytkownika' })
  @ZodResponse({ status: 200, description: 'Profil publiczny', type: PublicProfileDto })
  async getPublicProfile(@Param() params: UserIdParams): Promise<PublicProfileDto> {
    const profile = UUID.test(params.id) ? await this.profiles.publicProfile(params.id) : undefined;
    if (profile === undefined) {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono profilu.' });
    }
    return {
      id: profile.id,
      name: profile.name,
      memberSince: profile.memberSince.toISOString(),
      phoneVerified: profile.phoneVerified,
    };
  }
}
