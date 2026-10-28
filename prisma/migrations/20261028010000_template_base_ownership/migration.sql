-- Template bisa dimiliki satu base (eksklusif) atau tetap bersama.
-- NULL = katalog bersama yang dipakai semua base (12 template lama).
ALTER TABLE "Template" ADD COLUMN "baseId" TEXT;

CREATE INDEX "Template_baseId_status_sortOrder_idx"
  ON "Template"("baseId", "status", "sortOrder");

ALTER TABLE "Template"
  ADD CONSTRAINT "Template_baseId_fkey"
  FOREIGN KEY ("baseId") REFERENCES "Base"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
