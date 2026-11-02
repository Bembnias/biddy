import { palette, toHex } from '@biddy/design-tokens';
import { ImageResponse } from 'next/og';

// Ikona karty przeglądarki generowana przy buildzie z tokenów: „B” na gradiencie marki
// (fiolet → róż z logo). Pełne logo jest za szerokie na 32 px.
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
        background: `linear-gradient(135deg, ${toHex(palette.violet[500])}, ${toHex(palette.pink[500])})`,
        color: toHex(palette.white),
        fontSize: 22,
        fontWeight: 800,
      }}
    >
      B
    </div>,
    size,
  );
}
