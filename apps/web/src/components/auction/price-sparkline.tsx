/**
 * Mały wykres ceny (F-63) z kwot ofert w kolejności chronologicznej. Ozdobny, z opisem dla
 * czytników ekranu w `label`; bez osi, bo dokładne kwoty są w historii ofert pod spodem.
 */
const WIDTH = 300;
const HEIGHT = 72;
/** Margines u góry i u dołu, żeby linia nie dotykała krawędzi. */
const PADDING = 6;

export function PriceSparkline({
  amounts,
  label,
}: {
  readonly amounts: readonly number[];
  readonly label: string;
}) {
  if (amounts.length < 2) {
    return null;
  }
  const min = Math.min(...amounts);
  const range = Math.max(...amounts) - min || 1;
  const step = WIDTH / (amounts.length - 1);
  const line = amounts
    .map((amount, index) => {
      const y = HEIGHT - PADDING - ((amount - min) / range) * (HEIGHT - 2 * PADDING);
      return `${(index * step).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
      preserveAspectRatio="none"
      className="h-18 w-full"
    >
      <polygon
        points={`${line} ${String(WIDTH)},${String(HEIGHT)} 0,${String(HEIGHT)}`}
        className="fill-accent"
      />
      <polyline
        points={line}
        fill="none"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className="stroke-brand-strong"
      />
    </svg>
  );
}
