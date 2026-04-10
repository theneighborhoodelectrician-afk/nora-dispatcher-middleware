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

create table if not exists middleware_chat_sessions (
  session_id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists middleware_chat_sessions_updated_at_idx
  on middleware_chat_sessions (updated_at);

create table if not exists middleware_config (
  key text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists middleware_config_updated_at_idx
  on middleware_config (updated_at);

create table if not exists lead_sources (
  code text primary key,
  display_name text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists contacts (
  contact_id text primary key,
  phone text,
  first_name text,
  last_name text,
  email text,
  address text,
  city text,
  zip_code text,
  updated_at timestamptz not null default now()
);

create index if not exists contacts_phone_idx
  on contacts (phone);

create table if not exists conversations (
  conversation_id text primary key,
  contact_id text references contacts(contact_id),
  lead_source text not null references lead_sources(code),
  timestamp_started timestamptz not null,
  timestamp_last_message timestamptz not null,
  current_stage text not null,
  updated_at timestamptz not null default now()
);

create index if not exists conversations_lead_source_idx
  on conversations (lead_source);

create table if not exists conversation_outcomes (
  conversation_id text primary key references conversations(conversation_id) on delete cascade,
  lead_source text not null references lead_sources(code),
  timestamp_started timestamptz not null,
  timestamp_last_message timestamptz not null,
  first_customer_message text not null,
  classified_service_type text,
  urgency_level text not null,
  urgency_keywords_detected jsonb not null default '[]'::jsonb,
  address_collected boolean not null default false,
  phone_collected boolean not null default false,
  email_collected boolean not null default false,
  photo_sent boolean not null default false,
  availability_shown boolean not null default false,
  slots_shown_count integer not null default 0,
  slot_selected boolean not null default false,
  booked_yes_no boolean not null default false,
  handoff_yes_no boolean not null default false,
  abandonment_stage text,
  final_hcp_job_type text,
  final_booking_status text,
  system_summary text,
  updated_at timestamptz not null default now()
);

create table if not exists conversation_stage_history (
  id bigserial primary key,
  conversation_id text not null references conversations(conversation_id) on delete cascade,
  stage text not null,
  created_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists conversation_stage_history_conversation_id_idx
  on conversation_stage_history (conversation_id, created_at);

create table if not exists conversation_messages (
  id bigserial primary key,
  conversation_id text not null references conversations(conversation_id) on delete cascade,
  direction text not null,
  text text,
  tool_name text,
  tool_call_summary text,
  created_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists conversation_messages_conversation_id_idx
  on conversation_messages (conversation_id, created_at);

create table if not exists slot_exposure_history (
  id bigserial primary key,
  conversation_id text not null references conversations(conversation_id) on delete cascade,
  slot_option_id text not null,
  slot_label text not null,
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  slot_order_presented integer not null,
  selected_yes_no boolean not null default false,
  created_at timestamptz not null,
  unique (conversation_id, slot_option_id)
);

create index if not exists slot_exposure_history_conversation_id_idx
  on slot_exposure_history (conversation_id, slot_order_presented);

create table if not exists urgency_keyword_hits (
  id bigserial primary key,
  conversation_id text not null references conversations(conversation_id) on delete cascade,
  keyword_detected text not null,
  mapped_urgency_level text not null,
  created_at timestamptz not null
);

create index if not exists urgency_keyword_hits_conversation_id_idx
  on urgency_keyword_hits (conversation_id, created_at);

create table if not exists booking_events (
  id bigserial primary key,
  conversation_id text not null references conversations(conversation_id) on delete cascade,
  booking_external_id text,
  final_hcp_job_type text,
  booking_status text not null,
  created_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists booking_events_conversation_id_idx
  on booking_events (conversation_id, created_at);

create table if not exists handoff_events (
  id bigserial primary key,
  conversation_id text not null references conversations(conversation_id) on delete cascade,
  reason text not null,
  created_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists handoff_events_conversation_id_idx
  on handoff_events (conversation_id, created_at);
