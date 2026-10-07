import { InvalidCursorError } from '../../domain/errors.js';

/**
 * Opaque keyset-pagination cursor over the (created_at, id) ordering of
 * ledger entries. Keyset beats OFFSET because it stays O(log n) regardless of
 * how deep the client paginates and is immune to rows being inserted between
 * page fetches.
 */
export interface StatementCursor {
  readonly createdAt: string;
  readonly id: string;
}

// base64url over btoa/atob (available in Node ≥18 and every browser) keeps the
// cursor codec free of Node's Buffer, so the same persistence code runs
// unchanged in the browser demo. Payloads are pure ASCII (an ISO date + a
// UUID), so no UTF-8 escaping is needed.
export function encodeCursor(cursor: StatementCursor): string {
  return btoa(JSON.stringify(cursor)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function decodeCursor(raw: string): StatementCursor {
  try {
    if (raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new InvalidCursorError();
    const base64 = raw.replaceAll('-', '+').replaceAll('_', '/');
    const parsed: unknown = JSON.parse(atob(base64));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as StatementCursor).createdAt === 'string' &&
      typeof (parsed as StatementCursor).id === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test((parsed as StatementCursor).createdAt) &&
      new Date((parsed as StatementCursor).createdAt).toISOString() ===
        (parsed as StatementCursor).createdAt &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        (parsed as StatementCursor).id,
      )
    ) {
      return parsed as StatementCursor;
    }
  } catch {
    // fall through to the error below
  }
  throw new InvalidCursorError();
}
