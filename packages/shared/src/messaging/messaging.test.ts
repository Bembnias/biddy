import { describe, expect, it } from 'vitest';

import { detectContactData } from './messaging.js';

describe('detectContactData', () => {
  it.each([
    'Zadzwoń: 600 700 800',
    'mój numer 600700800',
    'tel. 600-700-800',
    '+48 600 700 800',
    '(+48) 600.700.800',
    '0048 600 700 800',
    '48600700800',
    'stacjonarny 22 123 45 67',
    'Mam 2 sztuki, pisz 600 700 800',
    '+1 (555) 123-4567',
    '+49 30 1234567',
  ])('wykrywa telefon w „%s”', (text) => {
    expect(detectContactData(text)).toEqual(['PHONE']);
  });

  it.each([
    'jan.kowalski@example.com',
    'pisz na jan @ wp.pl',
    'jan małpa wp kropka pl',
    'jan (at) gmail (dot) com',
    'JAN [AT] ONET [DOT] PL',
    'anna_k+biddy@poczta.onet.pl, dzięki',
  ])('wykrywa e-mail w „%s”', (text) => {
    expect(detectContactData(text)).toEqual(['EMAIL']);
  });

  it.each([
    'konto 61 1090 1014 0000 0712 1981 2874',
    '61109010140000071219812874',
    'PL61 1090 1014 0000 0712 1981 2874',
    'pl61109010140000071219812874',
    'DE89 3704 0044 0532 0130 00',
    'GB82WEST12345698765432',
  ])('wykrywa numer konta w „%s”', (text) => {
    expect(detectContactData(text)).toEqual(['IBAN']);
  });

  it('zwraca wszystkie rodzaje w stałej kolejności', () => {
    expect(
      detectContactData('Przelew na 61 1090 1014 0000 0712 1981 2874, jan@wp.pl, 600 700 800'),
    ).toEqual(['PHONE', 'EMAIL', 'IBAN']);
  });

  it.each([
    'Cena 1 500 000 zł to za dużo',
    'Wysyłka 15 zł, przedmiot 120 zł',
    'Nadam 12.05.2026 10:30',
    'Odbiór 12/05/2026',
    'Kod 00-950 Warszawa',
    'Numer paczki 6000 0123 4567 8901 2345 6789',
    'Numer paczki 520000012345678901234567',
    'Wymiary 30x40x50 cm, waga 2,5 kg',
    'Zamówienie k3x9qa7m',
    'Numer 012345678',
    'Spotkajmy się at 5',
    'Instagram @janek',
    'DE89 3704 0044 0532 0130 01',
    'Pytanie o stan: czy są rysy?',
  ])('nie wykrywa niczego w „%s”', (text) => {
    expect(detectContactData(text)).toEqual([]);
  });
});
