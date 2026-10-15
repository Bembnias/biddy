// Snapshot przedmiotu w zamówieniu (F-16, PROJECT.md §13.1): stan aukcji i przedmiotu w chwili
// zakupu. Opis aukcji może się później zmienić albo zniknąć, a zamówienie, spór i ocena
// odnoszą się do tego, co kupujący widział. Wersja pola pozwala zmieniać kształt w przyszłości.

export interface OrderItemSnapshot {
  readonly version: 1;
  readonly auction: {
    readonly id: string;
    readonly publicId: string;
    readonly startPrice: number;
    readonly endedAt: string;
    readonly endedBy: 'TIME' | 'BUY_NOW';
  };
  readonly item: {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly condition: string;
    readonly brand: string | null;
    readonly category: { readonly id: string; readonly path: readonly string[] } | null;
    /** Atrybuty z etykietami (do wyświetlenia) i wartości surowe (do porównań). */
    readonly attributes: readonly {
      readonly key: string;
      readonly label: string;
      readonly value: string;
    }[];
    readonly attributeValues: Readonly<Record<string, string | number | boolean>>;
    readonly packageSize: string | null;
    readonly weightGrams: number | null;
    readonly dimensionsCm: {
      readonly length: number;
      readonly width: number;
      readonly height: number;
    } | null;
    readonly allowedCarriers: readonly string[];
    readonly photos: readonly {
      readonly id: string;
      readonly urls: Readonly<Record<string, string>>;
    }[];
  };
}
