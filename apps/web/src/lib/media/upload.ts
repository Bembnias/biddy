// Upload zdjęć (F-12): sprawdzenie pliku w przeglądarce, presigned PUT prosto do magazynu
// (XHR, bo fetch nie raportuje postępu wysyłania), potwierdzenie i oczekiwanie na przetworzenie
// w workerze. Ostateczną walidację (format z zawartości, rozmiar, EXIF) robi serwer.
import {
  type CreateUploadDtoPurpose,
  type MediaDto,
  completeUpload,
  createUpload,
  getMedia,
} from '@biddy/api-client';

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const POLL_INTERVAL_MS = 1_000;
const POLL_TIMEOUT_MS = 90_000;

/** Powód błędu do komunikatu z next-intl (`media.errors.*`). */
export type UploadErrorKind = 'type' | 'size' | 'upload' | 'timeout';

export class UploadError extends Error {
  constructor(readonly kind: UploadErrorKind) {
    super(kind);
    this.name = 'UploadError';
  }
}

/** Błąd pliku przed wysłaniem albo undefined. */
export function fileIssue(file: File): UploadErrorKind | undefined {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return 'type';
  }
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    return 'size';
  }
  return undefined;
}

function put(
  url: string,
  file: File,
  headers: Readonly<Record<string, string>>,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded / event.total);
      }
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(1);
        resolve();
      } else {
        reject(new UploadError('upload'));
      }
    };
    request.onerror = () => {
      reject(new UploadError('upload'));
    };
    request.send(file);
  });
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Wysyła zdjęcie i czeka na wynik przetwarzania (READY, FLAGGED albo REJECTED). Błędy API
 * (np. limit) przechodzą jako ApiError, błędy pliku i sieci jako UploadError.
 */
export async function uploadPhoto(
  file: File,
  purpose: CreateUploadDtoPurpose,
  onProgress: (fraction: number) => void = () => undefined,
  onStarted: (media: MediaDto) => void = () => undefined,
): Promise<MediaDto> {
  const issue = fileIssue(file);
  if (issue !== undefined) {
    throw new UploadError(issue);
  }
  const { media, upload } = await createUpload({
    purpose,
    contentType: file.type as (typeof ACCEPTED_IMAGE_TYPES)[number],
    sizeBytes: file.size,
  });
  onStarted(media);
  await put(upload.url, file, upload.headers, onProgress);
  let current = await completeUpload(media.id);
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (current.status === 'PENDING_UPLOAD' || current.status === 'PROCESSING') {
    if (Date.now() > deadline) {
      throw new UploadError('timeout');
    }
    await sleep(POLL_INTERVAL_MS);
    current = await getMedia(media.id);
  }
  return current;
}
