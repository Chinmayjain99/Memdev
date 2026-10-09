import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE sync_mutations (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mutation_id uuid NOT NULL,
      request_hash bytea NOT NULL,
      operation text NOT NULL,
      memory_id uuid,
      status text NOT NULL,
      conflict_code text,
      base_version integer,
      result_version integer,
      change_sequence_id bigint,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT sync_mutations_pkey PRIMARY KEY (user_id, mutation_id),
      CONSTRAINT sync_mutations_hash_length CHECK (octet_length(request_hash) = 32),
      CONSTRAINT sync_mutations_operation CHECK (operation IN ('create', 'update', 'delete')),
      CONSTRAINT sync_mutations_status CHECK (status IN ('applied', 'conflict', 'not_found')),
      CONSTRAINT sync_mutations_version_positive CHECK (
        (base_version IS NULL OR base_version > 0) AND (result_version IS NULL OR result_version > 0)
      ),
      CONSTRAINT sync_mutations_memory_owner_fk FOREIGN KEY (user_id, memory_id)
        REFERENCES memories(user_id, id) ON DELETE CASCADE,
      CONSTRAINT sync_mutations_change_fk FOREIGN KEY (change_sequence_id)
        REFERENCES memory_changes(sequence_id) ON DELETE CASCADE,
      CONSTRAINT sync_mutations_result_consistent CHECK (
        (status = 'applied' AND memory_id IS NOT NULL AND result_version IS NOT NULL AND change_sequence_id IS NOT NULL AND conflict_code IS NULL)
        OR (status <> 'applied' AND change_sequence_id IS NULL AND conflict_code IS NOT NULL)
      )
    );
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql('DROP TABLE sync_mutations');
}
