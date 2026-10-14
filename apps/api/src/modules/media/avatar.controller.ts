import { Body, Controller, Delete, Header, HttpCode, Inject, Put } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  CurrentUser,
  ProfileService,
  RequireSession,
  type AuthenticatedUser,
} from '../identity/index.js';
import { MediaService } from './media.service.js';

export class SetAvatarDto extends createZodDto(
  z.object({
    mediaId: z.uuid().describe('Zdjęcie AVATAR w stanie READY (POST /v1/media/uploads)'),
  }),
) {}

export class AvatarDto extends createZodDto(
  z.object({ avatarUrl: z.url().describe('Publiczny adres zdjęcia profilowego (WebP 256 px)') }),
) {}

/**
 * Zdjęcie profilowe (F-12, odłożone w F-10). Moduł media sprawdza zdjęcie i przekazuje do
 * identity identyfikator z publicznym adresem; poprzednie zdjęcie przestaje być użyte.
 */
@ApiTags('me')
@Controller('me/avatar')
@RequireSession()
export class AvatarController {
  constructor(
    private readonly media: MediaService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
  ) {}

  @Put()
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Ustawienie zdjęcia profilowego' })
  @ZodResponse({ status: 200, description: 'Zdjęcie profilowe', type: AvatarDto })
  async setAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SetAvatarDto,
  ): Promise<AvatarDto> {
    await this.media.attach(user.id, [body.mediaId], 'AVATAR');
    const avatarUrl = this.media.variantUrl('AVATAR', body.mediaId, 'large');
    const previous = await this.profiles.setAvatar(user.id, {
      mediaId: body.mediaId,
      url: avatarUrl,
    });
    if (previous !== null && previous !== body.mediaId) {
      await this.media.detach(user.id, [previous]);
    }
    return { avatarUrl };
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Usunięcie zdjęcia profilowego' })
  @ApiNoContentResponse({ description: 'Zdjęcie profilowe usunięte' })
  async deleteAvatar(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    const previous = await this.profiles.setAvatar(user.id, null);
    if (previous !== null) {
      await this.media.detach(user.id, [previous]);
    }
  }
}
