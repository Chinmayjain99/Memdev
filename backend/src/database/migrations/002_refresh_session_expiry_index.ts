import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  pgm.createIndex('refresh_sessions', 'expires_at', {
    name: 'refresh_sessions_expires_at_idx',
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('refresh_sessions', 'expires_at', {
    name: 'refresh_sessions_expires_at_idx',
  });
}
