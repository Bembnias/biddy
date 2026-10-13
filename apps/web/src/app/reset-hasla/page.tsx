import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { AuthCard } from '@/components/auth/form-parts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.forgotPassword');
  return { title: t('metaTitle'), robots: { index: false } };
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations('auth.forgotPassword');
  return (
    <AuthCard title={t('title')}>
      <ForgotPasswordForm />
    </AuthCard>
  );
}
