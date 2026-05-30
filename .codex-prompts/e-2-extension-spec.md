# E-2 Extension Spec — 残 18 assertions の構造

## 既存 9 ケース (Phase 11、tests/integration/record-audit-log.test.ts)

| describe | it | action | redact 期待値 |
|---|---|---|---|
| customers | INSERT | create | phone→`***5678` / email→`t***@example.com` |
| customers | UPDATE | update | before/after phone redacted |
| customers | DELETE | delete | before phone redacted, after NULL |
| vehicles | INSERT | create | vin→`***109186` |
| vehicles | UPDATE | update | vin before/after redacted |
| vendor_users | INSERT | create | email→`v***@example.com`, actor_kind='system' |
| vendors | INSERT | create | passthrough (contact_email そのまま) |
| customers soft delete | UPDATE deleted_at NULL→NOT NULL | delete | — |
| customers restore | UPDATE deleted_at NOT NULL→NULL | restore | — |

## 残 18 ケース (追加対象)

### users (3, email redact 対応)
- INSERT → create + email→`u***@example.com`
- UPDATE → update + email before/after redacted
- DELETE → delete (soft via deleted_at), before email redacted

### vehicles (1, DELETE 追加)
- DELETE (hard) → delete + before vin redacted, after NULL

### vendors (2, UPDATE/DELETE 追加)
- UPDATE → update + passthrough (no redact)
- DELETE (hard) → delete + before passthrough, after NULL

### vendor_users (2, UPDATE/DELETE 追加)
- UPDATE → update + email before/after redacted
- DELETE (hard) → delete + before email redacted, after NULL

### service_tickets (3, passthrough)
- INSERT → create + payload passthrough (quoted_amount_minor / tax_rate_bps / billing_status)
- UPDATE → update + before/after passthrough
- DELETE → delete + before passthrough, after NULL

### reservations (3, passthrough)
- INSERT → create + payload passthrough (start_at / end_at)
- UPDATE → update + start_at/end_at before/after
- DELETE → delete + before passthrough, after NULL

### transport_orders (3, passthrough)
- INSERT → create + payload passthrough (movement_type / price_minor / version=1)
- UPDATE → update + before/after passthrough
- DELETE → delete + before passthrough, after NULL

### transport_order_invitations (1, INSERT のみ — UPDATE/DELETE は accept_invitation flow 経由なので別途)
- INSERT → create + passthrough (response='pending', is_winning_bid=false)

合計 18 (3+1+2+2+3+3+3+1 = 18)

## entity → redact 対応一覧 (redact_audit_payload 5 entity)

| entity | redact field |
|---|---|
| customers | phone (last4) / email (first1+***) |
| vehicles | vin (last6) |
| vendor_users | email |
| users | email |
| customer_reservation_tokens | token_hash 削除 (audit trigger 対象外) |
| **他全部 (vendors / service_tickets / reservations / transport_orders / transport_order_invitations)** | passthrough |

## FK 依存解決順 (各 it 内で必要最小限)

| 親 → 子 | 必要 INSERT |
|---|---|
| companies | `INSERT INTO companies (name) VALUES (...) RETURNING id` |
| stores | `INSERT INTO stores (company_id, name) VALUES (...) RETURNING id` |
| lanes | `INSERT INTO lanes (company_id, store_id, name) VALUES (...) RETURNING id` |
| vehicles | `INSERT INTO vehicles (company_id, store_id, vin?, registration_number?) RETURNING id` (Phase 11 既存) |
| customers | `INSERT INTO customers (company_id, full_name, phone?, email?) RETURNING id` (Phase 11 既存) |
| vendors | `INSERT INTO vendors (company_id, name) RETURNING id` (Phase 11 既存) |
| vendor_users | `INSERT INTO vendor_users (vendor_id, company_id, email) RETURNING id` (Phase 11 既存) |
| users | `INSERT INTO users (id, company_id, email, name) VALUES (gen_random_uuid(), ..., ...) RETURNING id` — id default なし注意 |
| service_tickets | `INSERT INTO service_tickets (company_id) VALUES (...) RETURNING id` (default で残り全部充足) |
| reservations | `INSERT INTO reservations (company_id, store_id, lane_id, start_at, end_at)` |
| transport_orders | `INSERT INTO transport_orders (company_id, movement_type) VALUES (..., 'self_drive') RETURNING id` |
| transport_order_invitations | `INSERT INTO transport_order_invitations (company_id, transport_order_id) RETURNING id` |

## CHECK constraints 注意

- `transport_orders.movement_type IN ('self_drive', 'tow', 'carrier')`
- `transport_orders.tow_required=true` 強制 (movement_type='tow' の時)
- `transport_orders.price_minor >= 0`

→ INSERT 時 `movement_type='self_drive'` を使えば追加列不要。

## actor_kind 期待値

postgres-js + DIRECT_URL の test では `auth.uid()` は **NULL** → `actor_kind='system'` (Phase 11 vendor_users INSERT で確認済)。

## test 構造パターン (Phase 11 継承、厳守)

```ts
it("...", async () => {
  await sql.begin(async (tx) => {
    try {
      const company = (await tx<{ id: string }[]>`
        INSERT INTO companies (name) VALUES ('__e2_<unique>__') RETURNING id`)[0]!;
      // ... entity 固有 INSERT/UPDATE/DELETE
      const audit = (await tx<AuditRow[]>`
        SELECT ... FROM audit_logs WHERE entity_id = ${row.id}::uuid AND action='...'`)[0]!;
      expect(audit.action).toBe("...");
      expect((audit.after_json as Record<string, ...>).<field>).toBe(...);
    } finally {
      throw new Error("__rollback__");
    }
  }).catch((err) => {
    if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
  });
});
```

- `__e2_<unique>__` の company name は describe-it 単位でユニーク (collision 防止)
- finally `throw "__rollback__"` で必ず rollback
- catch で `__rollback__` 以外は再 throw
- `[0]!` で `T | undefined` を `T` に narrowing

## DoD

- 既存 9 + 新規 18 = 合計 27 assertions
- `pnpm test tests/integration/record-audit-log.test.ts` 27/27 PASS
- typecheck 緑
