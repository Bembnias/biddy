-- Rozszerzenie ltree: drzewo kategorii jako ścieżki etykiet (np. moda.obuwie.sneakersy) z szybkimi
-- zapytaniami o poddrzewo przez operatory <@ i @> oraz indeks GiST (PROJECT.md §11.2, F-11).
-- ltree jest rozszerzeniem zaufanym (PG 13+), więc wystarczą uprawnienia właściciela bazy.
-- IF NOT EXISTS: migracja przechodzi także na bazie, w której rozszerzenie już włączono.
CREATE EXTENSION IF NOT EXISTS ltree;
