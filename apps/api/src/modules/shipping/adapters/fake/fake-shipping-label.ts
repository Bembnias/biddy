// Etykieta testowa FakeShipping (F-24): najprostszy poprawny PDF (A6, Helvetica) bez
// zależności. Czcionki standardowe PDF nie mają polskich znaków, więc tekst jest bez
// diakrytyków; etykieta służy tylko do sprawdzenia przepływu „Nadaj” → „Pobierz etykietę”.

/** Strona A6 w punktach PDF (105 × 148 mm). */
const PAGE_WIDTH = 298;
const PAGE_HEIGHT = 421;

/** Tekst w ASCII: bez polskich znaków (ł nie rozkłada się przez NFD). */
function ascii(text: string): string {
  return text
    .replaceAll('ł', 'l')
    .replaceAll('Ł', 'L')
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^\x20-\x7e]/gu, '?');
}

function pdfString(text: string): string {
  return `(${ascii(text).replace(/[\\()]/gu, (char) => `\\${char}`)})`;
}

/** PDF z liniami tekstu od góry strony. */
export function fakeLabelPdf(lines: readonly string[]): Buffer {
  const content = [
    'BT',
    '/F1 10 Tf',
    '14 TL',
    `20 ${PAGE_HEIGHT - 30} Td`,
    ...lines.flatMap((line) => [`${pdfString(line)} Tj`, 'T*']),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
