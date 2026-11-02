import { Module } from '@nestjs/common';

import { AvatarController } from './avatar.controller.js';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { FakeImageModerator, IMAGE_MODERATOR } from './processing/image-moderator.js';

/**
 * Moduł domenowy `media` (PROJECT.md §10.3): upload zdjęć, przetwarzanie (usunięcie EXIF,
 * warianty), moderacja i sprzątanie (F-12). Publiczne API: ./index.ts.
 */
@Module({
  controllers: [MediaController, AvatarController],
  providers: [
    MediaService,
    // Atrapa do czasu wyboru dostawcy moderacji (F-12, otwarte pytanie w specu).
    { provide: IMAGE_MODERATOR, useClass: FakeImageModerator },
  ],
  exports: [MediaService],
})
export class MediaModule {}
