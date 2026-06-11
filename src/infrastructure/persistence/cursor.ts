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

export function encodeCursor(cursor: StatementCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): StatementCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as StatementCursor).createdAt === 'string' &&
      typeof (parsed as StatementCursor).id === 'string'
    ) {
      return parsed as StatementCursor;
    }
  } catch {
    // fall through to the error below
  }
  throw new InvalidCursorError();
}
