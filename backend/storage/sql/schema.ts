// The tables, as Kysely sees them. Times are milliseconds since the epoch (a bigint in PostgreSQL, so `pg` gives it back as a
// string: read it with Number()). JSON columns are plain text: nothing queries inside them.
import type { ColumnType } from "kysely";

type Time = ColumnType<number | string, number, number>;

export interface Schema {
  feeds: {
    name: string;
    read_id: string;
    password_hash: string | null;
    settings: string | null;
    created_at: Time;
    // Encryption at rest: the main key's id and the feed's data key wrapped by it; the name and read id sealed with the data key.
    // All null on a plain feed, where `name` and `read_id` are the values themselves, not their fingerprints.
    key_id: string | null;
    data_key: string | null;
    name_sealed: string | null;
    read_id_sealed: string | null;
  };
  notes: {
    feed: string;
    id: string;
    ext: string;
    content: Buffer;
    // The key of the bytes in the image store; null when they are in `content`.
    blob_key: string | null;
    size: Time;
    metadata: string | null;
    created_at: Time;
    updated_at: Time;
    // 1: the bytes and the metadata are sealed with the feed's data key.
    sealed: ColumnType<number, number | undefined, number>;
  };
  tombstones: {
    name: string;
    read_id: string | null;
    removed_at: Time;
    // 1: `name` and `read_id` are fingerprints.
    sealed: ColumnType<number, number | undefined, number>;
  };
  // One row, "fingerprint": the database's fingerprint key, wrapped by the main key `key_id` names.
  keyring: {
    name: string;
    key_id: string;
    wrapped: string;
  };
  blocked_images: {
    hash: string;
    added_at: Time;
  };
}
