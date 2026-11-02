// Kolory e-maili z design tokens (OKLCH → hex: klienci poczty nie znają OKLCH).
import { semanticColors, toHex } from '@biddy/design-tokens';

export const colors = {
  background: toHex(semanticColors.muted),
  card: toHex(semanticColors.card),
  text: toHex(semanticColors.foreground),
  muted: toHex(semanticColors['muted-foreground']),
  primary: toHex(semanticColors.primary),
  primaryText: toHex(semanticColors['primary-foreground']),
  border: toHex(semanticColors.border),
} as const;

export const fontFamily =
  "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
