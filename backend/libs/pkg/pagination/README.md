# pagination

Opaque keyset cursors for AetherCode collection endpoints.

## Purpose

Every collection endpoint pages by keyset, not offset. Rows are inserted
continuously during an exam, so an offset would skip and duplicate records
mid-scroll. A cursor names the last row of the previous page as
`(sort_value, id)`; the query resumes strictly after it.

## API

| Function | Purpose |
|---|---|
| `Encode(sortValue, id string) string` | Build the token returned as `next_cursor`. |
| `Parse(raw string) (Cursor, bool, error)` | Decode a client token. Empty input returns `present == false`, not an error. |
| `ParseLimit(raw string, defaultLimit, maxLimit int) (int, error)` | Validate a page size. Out of range is an error, never a clamp. |
| `EncodeTime(value time.Time) string` | RFC3339 nanosecond UTC sort value. |
| `FormatInt(value int64) string` | Decimal sort value for version numbers. |

## Security

A cursor is **not signed and carries no authority**. It repositions a caller
inside a query that has already been authorized, tenant-scoped, and (for
Class A endpoints) actor-scoped. A forged cursor can only move a caller among
rows they may already read.

## Testing

`go test ./pagination/...` — no database or network required.
