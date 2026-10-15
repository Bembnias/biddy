-- Startowi przewoźnicy (F-14, PROJECT.md §8.1–§8.2): usługi i obsługiwane gabaryty. Migracja
-- danych, więc lista jest w każdym środowisku. Ceny i dokładne limity per przewoźnik dojdą
-- w F-24; zmiana listy do czasu panelu admina to nowa migracja.
INSERT INTO "shipping_carriers" ("id", "name", "kind", "package_sizes", "position") VALUES
  ('inpost-paczkomat', 'InPost Paczkomat 24/7', 'LOCKER', '{S,M,L}', 0),
  ('inpost-kurier', 'InPost Kurier', 'COURIER', '{S,M,L,XL}', 1),
  ('orlen-paczka', 'Orlen Paczka', 'PICKUP_POINT', '{S,M,L}', 2),
  ('dpd-pickup', 'DPD Pickup', 'PICKUP_POINT', '{S,M,L}', 3),
  ('dpd-kurier', 'DPD Kurier', 'COURIER', '{S,M,L,XL}', 4);
