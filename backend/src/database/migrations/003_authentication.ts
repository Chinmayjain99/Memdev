import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE users ADD COLUMN password_hash text;
    ALTER TABLE refresh_sessions ADD COLUMN family_id uuid NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE refresh_sessions ADD COLUMN replaced_by_session_id uuid
      REFERENCES refresh_sessions(id) ON DELETE SET NULL;
    CREATE INDEX refresh_sessions_family_active_idx ON refresh_sessions (family_id)
      WHERE revoked_at IS NULL;
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP INDEX refresh_sessions_family_active_idx;
    ALTER TABLE refresh_sessions DROP COLUMN replaced_by_session_id;
    ALTER TABLE refresh_sessions DROP COLUMN family_id;
    ALTER TABLE users DROP COLUMN password_hash;
  `);
}
