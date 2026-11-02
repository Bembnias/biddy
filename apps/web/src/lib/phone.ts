/** Numer E.164 do wyświetlenia: `+48500600700` → `+48 500 600 700` (inne zostają bez zmian). */
export function formatPhoneNumber(phoneNumber: string): string {
  const match = /^\+48(\d{3})(\d{3})(\d{3})$/.exec(phoneNumber);
  return match === null ? phoneNumber : `+48 ${match[1]} ${match[2]} ${match[3]}`;
}
