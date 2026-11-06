'use client';

// Przycisk „Wybierz na mapie” (F-64): wczytuje skrypt mapy Furgonetki dopiero po kliknięciu
// i otwiera okno mapy z jedną usługą. Wybrany kod oddaje wyżej; sprawdzenie punktu w API Biddy
// robi PickupPointPicker. Po zamknięciu mapy fokus wraca na przycisk.
import { Map as MapIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { config } from '@/config';
import {
  type FurgonetkaMapPoint,
  loadFurgonetkaMap,
  MapLoadError,
} from '@/lib/pickup-points/furgonetka-map';

export interface PointMapConfig {
  readonly provider: 'furgonetka';
  readonly service: string;
  readonly env: 'sandbox' | 'production';
}

/** Miejsce startowe mapy: tylko miasto i kod pocztowy (bez ulicy i danych osoby). */
export interface MapNear {
  readonly city?: string;
  readonly postcode?: string;
}

/** Klucz mapy jest tylko na środowiskach z domeną przypisaną w panelu Furgonetki. */
export function mapAvailable(pointMap: PointMapConfig | null): pointMap is PointMapConfig {
  return pointMap !== null && config.furgonetkaMapKey !== undefined;
}

export function PickupPointMapButton({
  pointMap,
  carrierKind,
  near,
  selectedId,
  onPick,
  onOpen,
  onError,
}: {
  readonly pointMap: PointMapConfig;
  readonly carrierKind: string;
  readonly near: MapNear | undefined;
  readonly selectedId: string | undefined;
  readonly onPick: (point: FurgonetkaMapPoint) => void;
  readonly onOpen: () => void;
  readonly onError: (reason: 'load' | 'timeout') => void;
}) {
  const t = useTranslations('pickupPoints');
  const button = useRef<HTMLButtonElement>(null);
  const [loading, setLoading] = useState(false);

  const open = async () => {
    if (loading) {
      return;
    }
    setLoading(true);
    try {
      const furgonetka = await loadFurgonetkaMap();
      onOpen();
      new furgonetka.Map({
        apiKey: config.furgonetkaMapKey ?? '',
        env: pointMap.env,
        courierServices: [pointMap.service],
        courierServicesFilter: [pointMap.service],
        // „Paczkomat” to tylko automaty; punkt odbioru pokazuje automaty i punkty z obsługą.
        ...(carrierKind === 'LOCKER' ? { availableServiceTypes: ['parcel_machine'] as const } : {}),
        showServiceTypeFilter: false,
        locale: 'pl',
        ...(near?.city === undefined || near.city === '' ? {} : { city: near.city }),
        ...(near?.postcode === undefined || near.postcode === ''
          ? {}
          : { postcode: near.postcode }),
        ...(selectedId === undefined ? {} : { pointId: selectedId }),
        callback: ({ point }) => {
          onPick(point);
        },
        closeModalCallback: () => {
          button.current?.focus();
        },
      }).show();
    } catch (error) {
      onError(error instanceof MapLoadError ? error.reason : 'load');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      ref={button}
      type="button"
      variant="outline"
      aria-busy={loading ? true : undefined}
      onClick={() => {
        void open();
      }}
    >
      <MapIcon aria-hidden />
      {loading ? t('mapLoading') : t('openMap')}
    </Button>
  );
}
