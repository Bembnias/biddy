import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import type { ReactNode } from 'react';

import { colors, fontFamily } from './theme.js';

export interface EmailAction {
  readonly label: string;
  readonly url: string;
}

export interface EmailFooter {
  /** Ustawienia powiadomień (e-maile z powiadomieniami). */
  readonly settingsUrl?: string | undefined;
  /** Wypisanie z e-maili tego typu (bez niego: e-mail transakcyjny albo konta). */
  readonly unsubscribeUrl?: string | undefined;
}

/** Wspólny układ: logo tekstowe, nagłówek, treść, jeden przycisk i stopka. */
export function EmailLayout({
  preview,
  heading,
  children,
  action,
  footer = {},
}: {
  readonly preview: string;
  readonly heading: string;
  readonly children: ReactNode;
  readonly action?: EmailAction | undefined;
  readonly footer?: EmailFooter;
}) {
  return (
    <Html lang="pl">
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{ backgroundColor: colors.background, fontFamily, margin: 0, padding: '24px 0' }}
      >
        <Container
          style={{
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            maxWidth: 560,
            padding: 32,
          }}
        >
          <Text style={{ color: colors.primary, fontSize: 22, fontWeight: 700, margin: 0 }}>
            Biddy
          </Text>
          <Heading
            as="h1"
            style={{ color: colors.text, fontSize: 20, lineHeight: '28px', margin: '24px 0 8px' }}
          >
            {heading}
          </Heading>
          {children}
          {action === undefined ? null : (
            <Section style={{ margin: '24px 0 8px' }}>
              <Button
                href={action.url}
                style={{
                  backgroundColor: colors.primary,
                  borderRadius: 6,
                  color: colors.primaryText,
                  fontSize: 15,
                  fontWeight: 600,
                  padding: '12px 20px',
                }}
              >
                {action.label}
              </Button>
            </Section>
          )}
          <Hr style={{ borderColor: colors.border, margin: '32px 0 16px' }} />
          <Text style={{ color: colors.muted, fontSize: 13, lineHeight: '20px', margin: 0 }}>
            Zespół Biddy
          </Text>
          {footer.unsubscribeUrl === undefined ? null : (
            <Text
              style={{ color: colors.muted, fontSize: 13, lineHeight: '20px', margin: '8px 0 0' }}
            >
              Nie chcesz takich e-maili?{' '}
              <Link href={footer.unsubscribeUrl} style={{ color: colors.muted }}>
                Wypisz się
              </Link>
              {footer.settingsUrl === undefined ? null : (
                <>
                  {' · '}
                  <Link href={footer.settingsUrl} style={{ color: colors.muted }}>
                    Ustawienia powiadomień
                  </Link>
                </>
              )}
            </Text>
          )}
        </Container>
      </Body>
    </Html>
  );
}

/** Akapit treści. */
export function Paragraph({ children }: { readonly children: ReactNode }) {
  return (
    <Text style={{ color: colors.text, fontSize: 15, lineHeight: '24px', margin: '8px 0' }}>
      {children}
    </Text>
  );
}
