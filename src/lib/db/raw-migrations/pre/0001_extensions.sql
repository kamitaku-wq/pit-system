-- vertical slice: 必須 PostgreSQL 拡張
-- pgcrypto: gen_random_uuid() 用 (PG 13+ で core にも入っているが念のため有効化)
-- btree_gist: 予約 exclusion constraint (tstzrange + UUID 組合せ) で必須
-- pg_trgm: 顧客検索 partial GIN index で必須 (α-1 以降で使用)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
