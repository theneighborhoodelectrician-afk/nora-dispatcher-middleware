export const STORAGE_SCHEMA_SQL = `
create table if not exists middleware_idempotency (
  key text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists middleware_idempotency_created_at_idx
  on middleware_idempotency (created_at);

create table if not exists middleware_webhook_events (
  id bigserial primary key,
  webhook_id text not null,
  kind text not null,
  phase text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists middleware_webhook_events_webhook_id_idx
  on middleware_webhook_events (webhook_id);

create index if not exists middleware_webhook_events_created_at_idx
  on middleware_webhook_events (created_at);
`;
