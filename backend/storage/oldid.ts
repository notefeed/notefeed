// The ids notes had before ids were opaque (ADR 0042): `<stamp>-<uuid>`, and `-2`, `-3`, … when taken. The migration
// (backend/notemigration.ts) moves them; the storage only answers whether any are left (`migrationPending`).
// Group 7 is the uuid, 8 its version.
export const OLD_ID = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-([0-9a-f]{8}-[0-9a-f]{4}-([0-9a-f])[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12})(?:-\d+)?$/i;

export const isOldId = (id: string): boolean => OLD_ID.test(id);
