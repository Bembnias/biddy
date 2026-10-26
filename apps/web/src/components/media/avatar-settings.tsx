'use client';

import {
  getGetMeQueryKey,
  getGetSessionQueryKey,
  isApiError,
  useDeleteAvatar,
  useSetAvatar,
} from '@biddy/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';

import { track } from '@/analytics/posthog';
import { FormAlert } from '@/components/auth/form-parts';
import { UserAvatar } from '@/components/profile/user-avatar';
import { Button } from '@/components/ui/button';
import { ACCEPTED_IMAGE_TYPES, UploadError, uploadPhoto } from '@/lib/media/upload';

/** Zdjęcie profilowe (F-12): upload, ustawienie (PUT /v1/me/avatar) i usunięcie. */
export function AvatarSettings({
  userId,
  name,
  avatarUrl,
}: {
  readonly userId: string;
  readonly name: string;
  readonly avatarUrl: string | null;
}) {
  const t = useTranslations('media');
  const tProfile = useTranslations('profile');
  const router = useRouter();
  const queryClient = useQueryClient();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const setAvatar = useSetAvatar();
  const removeAvatar = useDeleteAvatar();
  const [current, setCurrent] = useState(avatarUrl);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() }),
    ]);
    router.refresh();
  };

  const upload = async (file: File | undefined) => {
    if (file === undefined) {
      return;
    }
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      const media = await uploadPhoto(file, 'AVATAR');
      if (media.status === 'FLAGGED') {
        setError(t('avatar.flagged'));
      } else if (media.status !== 'READY') {
        setError(media.rejectionReason ?? t('errors.upload'));
      } else {
        const result = await setAvatar.mutateAsync({ data: { mediaId: media.id } });
        setCurrent(result.avatarUrl);
        setStatus(t('avatar.saved'));
        track('avatar_updated');
        await refresh();
      }
    } catch (caught) {
      setError(
        caught instanceof UploadError
          ? t(`errors.${caught.kind}`)
          : isApiError(caught) && caught.problem !== undefined
            ? caught.problem.detail
            : t('errors.upload'),
      );
    } finally {
      setBusy(false);
      if (input.current !== null) {
        input.current.value = '';
      }
    }
  };

  const remove = async () => {
    setError(undefined);
    setStatus(undefined);
    try {
      await removeAvatar.mutateAsync();
      setCurrent(null);
      setStatus(t('avatar.removed'));
      await refresh();
    } catch (caught) {
      setError(
        isApiError(caught) && caught.problem !== undefined
          ? caught.problem.detail
          : t('errors.upload'),
      );
    }
  };

  return (
    <section
      aria-labelledby={`${inputId}-title`}
      className="flex flex-col items-center gap-3 text-center"
    >
      <h2 id={`${inputId}-title`} className="sr-only">
        {t('avatar.title')}
      </h2>
      <UserAvatar
        userId={userId}
        name={name}
        label={tProfile('avatarLabel', { name })}
        imageUrl={current}
        size="xl"
      />
      <input
        ref={input}
        id={inputId}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(',')}
        className="sr-only"
        aria-label={current === null ? t('avatar.add') : t('avatar.change')}
        aria-describedby={`${inputId}-hint`}
        onChange={(event) => void upload(event.target.files?.[0])}
      />
      <div className="flex flex-wrap justify-center gap-1">
        <Button
          type="button"
          variant="ghost"
          className="text-link"
          disabled={busy}
          aria-controls={inputId}
          onClick={() => input.current?.click()}
        >
          {busy ? t('avatar.uploading') : current === null ? t('avatar.add') : t('avatar.change')}
        </Button>
        {current === null ? null : (
          <Button
            type="button"
            variant="ghost"
            disabled={busy || removeAvatar.isPending}
            onClick={() => void remove()}
          >
            {t('avatar.remove')}
          </Button>
        )}
      </div>
      <p id={`${inputId}-hint`} className="max-w-60 text-caption text-muted-foreground">
        {t('avatar.hint')}
      </p>
      {error === undefined ? null : <FormAlert>{error}</FormAlert>}
      <p role="status" className="text-body-sm font-semibold text-success">
        {status}
      </p>
    </section>
  );
}
