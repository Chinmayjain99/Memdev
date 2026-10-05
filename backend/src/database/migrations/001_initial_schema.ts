import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS pg_trgm;

    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text,
      display_name text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT users_email_not_blank CHECK (email IS NULL OR btrim(email) <> ''),
      CONSTRAINT users_display_name_not_blank CHECK (display_name IS NULL OR btrim(display_name) <> ''),
      CONSTRAINT users_updated_after_created CHECK (updated_at >= created_at)
    );
    CREATE UNIQUE INDEX users_email_lower_unique_idx ON users (lower(email)) WHERE email IS NOT NULL;

    CREATE TABLE oauth_accounts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider text NOT NULL,
      provider_account_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT oauth_accounts_provider_format CHECK (provider = lower(btrim(provider)) AND provider <> ''),
      CONSTRAINT oauth_accounts_account_id_not_blank CHECK (btrim(provider_account_id) <> ''),
      CONSTRAINT oauth_accounts_provider_account_unique UNIQUE (provider, provider_account_id),
      CONSTRAINT oauth_accounts_updated_after_created CHECK (updated_at >= created_at)
    );
    CREATE INDEX oauth_accounts_user_id_idx ON oauth_accounts (user_id);

    CREATE TABLE refresh_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash bytea NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      CONSTRAINT refresh_sessions_token_hash_length CHECK (octet_length(token_hash) = 32),
      CONSTRAINT refresh_sessions_expiry_after_creation CHECK (expires_at > created_at),
      CONSTRAINT refresh_sessions_revocation_after_creation CHECK (revoked_at IS NULL OR revoked_at >= created_at)
    );
    CREATE INDEX refresh_sessions_user_created_idx ON refresh_sessions (user_id, created_at DESC);
    CREATE INDEX refresh_sessions_active_expiry_idx ON refresh_sessions (user_id, expires_at)
      WHERE revoked_at IS NULL;

    CREATE TABLE memories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      capture_type text NOT NULL,
      title text,
      selected_text text,
      manual_note text,
      source_url text,
      page_title text,
      domain text,
      tags text[] NOT NULL DEFAULT '{}',
      topic text,
      language text,
      is_code boolean NOT NULL DEFAULT false,
      code_language text,
      is_deleted boolean NOT NULL DEFAULT false,
      deleted_at timestamptz,
      client_created_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      last_revisited_at timestamptz,
      revisit_count integer NOT NULL DEFAULT 0,
      version integer NOT NULL DEFAULT 1,
      search_vector tsvector NOT NULL DEFAULT ''::tsvector,
      CONSTRAINT memories_owner_identity_unique UNIQUE (user_id, id),
      CONSTRAINT memories_capture_type CHECK (capture_type IN ('text', 'url')),
      CONSTRAINT memories_title_not_blank CHECK (title IS NULL OR btrim(title) <> ''),
      CONSTRAINT memories_capture_content CHECK (
        (capture_type <> 'text' OR (selected_text IS NOT NULL AND btrim(selected_text) <> '')) AND
        (capture_type <> 'url' OR (source_url IS NOT NULL AND source_url ~* '^https?://'))
      ),
      CONSTRAINT memories_tags_no_null CHECK (array_position(tags, NULL) IS NULL),
      CONSTRAINT memories_code_language_consistent CHECK (is_code OR code_language IS NULL),
      CONSTRAINT memories_deletion_consistent CHECK (is_deleted = (deleted_at IS NOT NULL)),
      CONSTRAINT memories_revisit_count_nonnegative CHECK (revisit_count >= 0),
      CONSTRAINT memories_version_positive CHECK (version > 0),
      CONSTRAINT memories_updated_after_created CHECK (updated_at >= created_at),
      CONSTRAINT memories_deleted_after_created CHECK (deleted_at IS NULL OR deleted_at >= created_at),
      CONSTRAINT memories_revisited_after_created CHECK (
        last_revisited_at IS NULL OR last_revisited_at >= created_at
      )
    );
    CREATE INDEX memories_user_created_idx ON memories (user_id, created_at DESC, id);
    CREATE INDEX memories_user_updated_idx ON memories (user_id, updated_at DESC, id);
    CREATE INDEX memories_active_user_updated_idx ON memories (user_id, updated_at DESC)
      WHERE is_deleted = false;
    CREATE INDEX memories_user_domain_idx ON memories (user_id, domain) WHERE domain IS NOT NULL;
    CREATE INDEX memories_search_vector_idx ON memories USING gin (search_vector);
    CREATE INDEX memories_title_trigram_idx ON memories USING gin (title gin_trgm_ops)
      WHERE title IS NOT NULL;

    CREATE TABLE memory_changes (
      sequence_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      memory_id uuid NOT NULL,
      operation text NOT NULL,
      version integer NOT NULL,
      server_created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT memory_changes_memory_owner_fk FOREIGN KEY (user_id, memory_id)
        REFERENCES memories (user_id, id) ON DELETE CASCADE,
      CONSTRAINT memory_changes_operation CHECK (operation IN ('create', 'update', 'delete')),
      CONSTRAINT memory_changes_version_positive CHECK (version > 0)
    );
    CREATE INDEX memory_changes_user_cursor_idx ON memory_changes (user_id, sequence_id);
    CREATE INDEX memory_changes_memory_id_idx ON memory_changes (memory_id);

    CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    CREATE TRIGGER oauth_accounts_set_updated_at BEFORE UPDATE ON oauth_accounts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    CREATE FUNCTION maintain_memory_search_vector() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        NEW.updated_at = now();
      END IF;
      NEW.search_vector =
        setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('simple', array_to_string(NEW.tags, ' ')), 'B') ||
        setweight(to_tsvector('simple', coalesce(NEW.selected_text, '')), 'C') ||
        setweight(to_tsvector('simple', coalesce(NEW.domain, '')), 'D');
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER memories_maintain_search_vector BEFORE INSERT OR UPDATE ON memories
      FOR EACH ROW EXECUTE FUNCTION maintain_memory_search_vector();
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TRIGGER memories_maintain_search_vector ON memories;
    DROP TRIGGER oauth_accounts_set_updated_at ON oauth_accounts;
    DROP TRIGGER users_set_updated_at ON users;
    DROP FUNCTION set_updated_at();
    DROP FUNCTION maintain_memory_search_vector();
    DROP TABLE memory_changes;
    DROP TABLE memories;
    DROP TABLE refresh_sessions;
    DROP TABLE oauth_accounts;
    DROP TABLE users;
  `);
}
