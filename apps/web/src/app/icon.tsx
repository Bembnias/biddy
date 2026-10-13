import { palette, toHex } from '@biddy/design-tokens';
import { ImageResponse } from 'next/og';

// Ikona karty przeglądarki generowana przy buildzie z tokenów (tymczasowa, do czasu logo).
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
        background: toHex(palette.navy[700]),
        color: toHex(palette.white),
        fontSize: 22,
        fontWeight: 700,
      }}
    >
      B
    </div>,
    size,
  );
}
