-- Urutan slide carousel Instagram yang bisa diatur bebas oleh user.
-- Token: "card:<index>" untuk halaman kartu fess, "media:<id>" untuk media user.
ALTER TABLE "Fess"
  ADD COLUMN "carouselOrder" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
