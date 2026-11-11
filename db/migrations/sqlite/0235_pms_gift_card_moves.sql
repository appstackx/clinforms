-- ClinForms 0235 (SQLite / Cloudflare D1): clinic system, billing - gift cards (PK04).
-- pms_gift_card_moves: every change to a card's balance, append-only - sale, redeem (a payment, negative), refund (the
-- payment reversed), expire, adjust - with the balance after it (never below zero). Goes with its card (ON DELETE
-- CASCADE, offboarding only). payment_id has no foreign key (a payment is never deleted). New table only (additive).
-- Kept in step with supabase/migrations/20261024000235_pms_gift_card_moves.sql (db/parity.test.ts).
-- Idempotent. No BEGIN/COMMIT. Keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS pms_gift_card_moves (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  gift_card_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sale', 'redeem', 'refund', 'expire', 'adjust')),
  amount_pence INTEGER NOT NULL,
  payment_id TEXT,
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  created_by TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, gift_card_id) REFERENCES pms_gift_cards (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS pms_gift_card_moves_card ON pms_gift_card_moves (tenant_id, gift_card_id, created_at);
CREATE INDEX IF NOT EXISTS pms_gift_card_moves_payment ON pms_gift_card_moves (tenant_id, payment_id);
