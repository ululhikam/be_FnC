-- Auto post + filter NLP per base, flag konten otomatis, dan agregasi notifikasi like.
ALTER TABLE "Base" ADD COLUMN "postMode" TEXT NOT NULL DEFAULT 'moderated';

ALTER TABLE "Fess" ADD COLUMN "autoFlagged" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Fess" ADD COLUMN "flagReason" TEXT;

ALTER TABLE "Notification" ADD COLUMN "actors" JSONB;
ALTER TABLE "Notification" ADD COLUMN "actorCount" INTEGER NOT NULL DEFAULT 1;
