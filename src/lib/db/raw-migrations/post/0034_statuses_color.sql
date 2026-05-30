-- Phase 69 S0a: statuses.color (ステータス色分け)
-- spec/screen-list.md §1.2 (カレンダー色分け) / phase-68-feature-audit.md must blocker #5
--
-- 監査: statuses に color 列が無く、カレンダーのステータス色分け・整備伝票バッジが
-- DB レベルでブロックされていた (唯一のスキーマギャップ, phase-68-schema-readiness-precheck)。
--
-- 設計 (Phase 69, option B): statuses は company 別マスタなので、会社が任意ステータスに
-- 色を指定できるよう color 列 (hex) を持たせる。NULL の場合はフロント既定色マップ
-- (src/lib/statuses/status-color.ts) にフォールバックする (DB と同じ既定色)。
--
-- 既定色 (c2-calendar.png 準拠): 確定/受諾系=緑 / 仮・打診中=黄 / 作業中=青 / 完了=シアン / 中止・却下=赤。
-- 冪等: 列・制約の存在チェック後に追加。backfill は color IS NULL の行のみ。
-- DEFAULT は付けない (新規 insert 時 NULL → フロント既定で描画。admin が設定画面で上書き可)。

-- 1) color 列の追加 (冪等)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'statuses'
      AND column_name = 'color'
  ) THEN
    ALTER TABLE public.statuses ADD COLUMN color text;
  END IF;
END $$;

-- 2) hex 形式の CHECK 制約 (冪等)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'statuses_color_hex_check'
      AND conrelid = 'public.statuses'::regclass
  ) THEN
    ALTER TABLE public.statuses
      ADD CONSTRAINT statuses_color_hex_check
      CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END $$;

-- 3) 既存行の backfill (color IS NULL の行のみ。key の意味から既定色を割当)。
--    フロント status-color.ts の DEFAULT_BY_KEY と一致させる。
UPDATE public.statuses
SET color = CASE lower(key)
  WHEN 'confirmed'   THEN '#16a34a'
  WHEN 'accepted'    THEN '#16a34a'
  WHEN 'approved'    THEN '#16a34a'
  WHEN 'active'      THEN '#16a34a'
  WHEN 'open'        THEN '#16a34a'
  WHEN 'pending'     THEN '#d97706'
  WHEN 'tentative'   THEN '#d97706'
  WHEN 'hold'        THEN '#d97706'
  WHEN 'invited'     THEN '#d97706'
  WHEN 'awaiting'    THEN '#d97706'
  WHEN 'requested'   THEN '#d97706'
  WHEN 'in_progress' THEN '#2563eb'
  WHEN 'processing'  THEN '#2563eb'
  WHEN 'working'     THEN '#2563eb'
  WHEN 'dispatched'  THEN '#2563eb'
  WHEN 'completed'   THEN '#0891b2'
  WHEN 'done'        THEN '#0891b2'
  WHEN 'closed'      THEN '#475569'
  WHEN 'cancelled'   THEN '#dc2626'
  WHEN 'canceled'    THEN '#dc2626'
  WHEN 'rejected'    THEN '#dc2626'
  WHEN 'declined'    THEN '#dc2626'
  WHEN 'failed'      THEN '#dc2626'
  WHEN 'no_show'     THEN '#b91c1c'
  WHEN 'expired'     THEN '#9ca3af'
  ELSE NULL
END
WHERE color IS NULL;
