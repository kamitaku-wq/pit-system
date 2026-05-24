# Phase E-2 typecheck fix

## ゴール

`tests/integration/record-audit-log.test.ts` (現状 248 行) の TypeScript strict mode エラー 9 件を修正。

## エラー内容

```
tests/integration/record-audit-log.test.ts(195,19): error TS18048: 'audit' is possibly 'undefined'.
tests/integration/record-audit-log.test.ts(216,69): error TS18048: 'company' is possibly 'undefined'.
... (合計 9 件、すべて destructure 後の変数アクセスで `undefined` の可能性)
```

## 修正方針

destructure 結果 `const [foo] = await tx<...>` の `foo` は型的に `T | undefined`。strict mode で使用時に `undefined` チェック必要。

**修正方法**: destructure を変更し、明示的に non-null 取得する helper を使う:

```typescript
// 修正前
const [company] = await tx<{ id: string }[]>`INSERT ...`;

// 修正後
const company = (await tx<{ id: string }[]>`INSERT ...`)[0]!;
```

または全 destructure 行に対し、その後に bang assertion `!` を追加して使う:

```typescript
const [company] = await tx<{ id: string }[]>`INSERT ...`;
// ...
${company!.id}  // または最初に `if (!company) throw new Error("missing row")`
```

## 推奨実装

**全ての `const [foo] = await tx<...>` パターンを `const foo = (await tx<...>)[0]!` に書き換え**。

具体例 (3 種類のパターン):

```typescript
// 1. company
const company = (await tx<{ id: string }[]>`
  INSERT INTO companies (name) VALUES ('...') RETURNING id`)[0]!;

// 2. row (insert target)
const row = (await tx<{ id: string }[]>`
  INSERT INTO customers (...) VALUES (...) RETURNING id`)[0]!;

// 3. audit (verification select)
const audit = (await tx<AuditRow[]>`
  SELECT ... FROM audit_logs WHERE entity_id = ${row.id}::uuid`)[0]!;
```

ファイル全体に上記パターンを適用。typeof / 構造は変更しない。

## 完了条件

- `pnpm typecheck` 通過
- 機能的な変更は一切しない (assertion 文字列、SQL 文、expect は元のまま)
- ファイル末尾の行数は ~245-250 行 (destructure ↔ subscript で行数微減)
