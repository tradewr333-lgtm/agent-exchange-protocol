create table if not exists agents (
  agent_id text primary key,
  status text,
  services text[] not null default '{}',
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists api_keys (
  key_id text primary key,
  owner_address text not null,
  agent_id text,
  status text not null default 'active',
  secret_hash text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists heartbeats (
  id bigserial primary key,
  agent_id text not null references agents(agent_id) on delete cascade,
  status text,
  available boolean not null default false,
  current_load numeric,
  available_capacity_usd numeric,
  endpoint text,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists contracts (
  contract_id text primary key,
  requester_agent_id text,
  provider_agent_id text,
  status text,
  service text,
  requested_capacity_usd numeric,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists settlements (
  id bigserial primary key,
  contract_id text not null references contracts(contract_id) on delete cascade,
  outcome text not null,
  reported_by text,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists trust_events (
  id bigserial primary key,
  event_type text not null,
  agent_id text,
  counterparty_id text,
  contract_id text,
  value_usd numeric not null default 0,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists api_usage (
  id bigserial primary key,
  key_id text not null,
  usage_type text not null,
  agent_id text,
  path text,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists agents_status_idx on agents(status);
create index if not exists agents_services_idx on agents using gin(services);
create index if not exists api_keys_owner_idx on api_keys(owner_address);
create index if not exists api_keys_agent_idx on api_keys(agent_id);
create index if not exists heartbeats_agent_created_idx on heartbeats(agent_id, created_at desc);
create index if not exists contracts_provider_idx on contracts(provider_agent_id);
create index if not exists contracts_status_idx on contracts(status);
create index if not exists settlements_contract_idx on settlements(contract_id);
create index if not exists trust_events_agent_created_idx on trust_events(agent_id, created_at desc);
create index if not exists trust_events_contract_idx on trust_events(contract_id);
create index if not exists trust_events_type_idx on trust_events(event_type);
create index if not exists api_usage_key_created_idx on api_usage(key_id, created_at desc);
create index if not exists api_usage_type_idx on api_usage(usage_type);
