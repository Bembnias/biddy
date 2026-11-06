import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { CurrentUser, RequireSession, type AuthenticatedUser } from '../identity/index.js';
import { MEDIA_PURPOSES, MEDIA_STATUSES, type Media } from './db/media.schema.js';
import {
  ACCEPTED_CONTENT_TYPES,
  MAX_UPLOAD_BYTES,
  MediaService,
  UPLOADS_PER_HOUR,
} from './media.service.js';

export class CreateUploadDto extends createZodDto(
  z.object({
    purpose: z
      .enum(MEDIA_PURPOSES)
      .describe(
        'Zdjęcie przedmiotu, zdjęcie profilowe, dowód w sporze (prywatny, F-28) albo zdjęcie w wiadomości (prywatne, F-29)',
      ),
    contentType: z.enum(ACCEPTED_CONTENT_TYPES, {
      error: 'Dodaj zdjęcie JPEG, PNG albo WebP.',
    }),
    sizeBytes: z
      .int()
      .min(1, 'Plik jest pusty.')
      .max(MAX_UPLOAD_BYTES, 'Zdjęcie jest za duże: maksymalnie 15 MB.')
      .describe('Dokładny rozmiar pliku w bajtach (podpisany w adresie uploadu)'),
  }),
) {}

export class MediaDto extends createZodDto(
  z.object({
    id: z.uuid(),
    purpose: z.enum(MEDIA_PURPOSES),
    status: z
      .enum(MEDIA_STATUSES)
      .describe(
        'PENDING_UPLOAD → PROCESSING → READY (publiczne), FLAGGED (czeka na moderatora) albo REJECTED',
      ),
    width: z.int().nullable(),
    height: z.int().nullable(),
    urls: z
      .object({
        thumb: z.url().optional(),
        medium: z.url().optional(),
        small: z.url().optional(),
        large: z.url(),
      })
      .nullable()
      .describe('Publiczne adresy wariantów WebP (tylko READY; zdjęcia ze sporu: null)'),
    rejectionReason: z.string().min(1).nullable().describe('Powód odrzucenia (REJECTED)'),
    createdAt: z.iso.datetime(),
  }),
) {}

export class UploadDto extends createZodDto(
  z.object({
    media: MediaDto.schema,
    upload: z.object({
      url: z.url().describe('Presigned PUT do prywatnego kubełka'),
      method: z.literal('PUT'),
      headers: z
        .record(z.string(), z.string())
        .describe('Nagłówki do wysłania z plikiem (Content-Length ustawia przeglądarka)'),
      expiresAt: z.iso.datetime(),
    }),
  }),
) {}

class MediaIdParams extends createZodDto(z.object({ id: z.uuid() })) {}

/** Zdjęcia (F-12): upload przez presigned PUT, stan przetwarzania, usuwanie nieużytych. */
@ApiTags('media')
@Controller('media')
@RequireSession()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('uploads')
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Nowe zdjęcie: adres presigned PUT',
    description: `JPEG, PNG albo WebP do 15 MB. Plik wyślij metodą PUT pod upload.url z nagłówkami upload.headers, potem wywołaj POST /v1/media/{id}/complete. Najwyżej ${String(UPLOADS_PER_HOUR)} zdjęć na godzinę (429).`,
  })
  @ZodResponse({ status: 201, description: 'Zdjęcie i adres uploadu', type: UploadDto })
  async createUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateUploadDto,
  ): Promise<UploadDto> {
    const { media, upload } = await this.media.createUpload(user.id, body);
    return {
      media: this.toDto(media),
      upload: {
        ...upload,
        headers: { ...upload.headers },
        expiresAt: upload.expiresAt.toISOString(),
      },
    };
  }

  @Post(':id/complete')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Plik wysłany: przetwarzanie',
    description:
      'Idempotentne. Stan sprawdzaj przez GET /v1/media/{id}. Pliku nie ma w magazynie: 409 MEDIA_NOT_UPLOADED.',
  })
  @ZodResponse({ status: 202, description: 'Zdjęcie w przetwarzaniu', type: MediaDto })
  async completeUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: MediaIdParams,
  ): Promise<MediaDto> {
    return this.toDto(await this.media.complete(user.id, params.id));
  }

  @Get(':id')
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Stan zdjęcia (tylko właściciel)' })
  @ZodResponse({ status: 200, description: 'Zdjęcie', type: MediaDto })
  async getMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: MediaIdParams,
  ): Promise<MediaDto> {
    return this.toDto(await this.media.owned(user.id, params.id));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Usunięcie nieużytego zdjęcia' })
  @ApiNoContentResponse({ description: 'Zdjęcie usunięte' })
  async deleteMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: MediaIdParams,
  ): Promise<void> {
    await this.media.delete(user.id, params.id);
  }

  private toDto(item: Media): MediaDto {
    const urls = this.media.publicUrls(item);
    return {
      id: item.id,
      purpose: item.purpose,
      status: item.status,
      width: item.width,
      height: item.height,
      urls: urls === null ? null : (urls as MediaDto['urls']),
      rejectionReason: item.rejectionReason,
      createdAt: item.createdAt.toISOString(),
    };
  }
}
