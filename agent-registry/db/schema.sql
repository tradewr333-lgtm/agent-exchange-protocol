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

create table if not exists trust_anchors (
  id bigserial primary key,
  batch_id text not null unique,
  merkle_root text not null,
  from_event_id bigint not null,
  to_event_id bigint not null,
  event_count integer not null,
  chain_id integer,
  contract_address text,
  tx_hash text,
  block_number bigint,
  status text not null default 'prepared',
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
create index if not exists trust_anchors_status_idx on trust_anchors(status);
create index if not exists trust_anchors_range_idx on trust_anchors(from_event_id, to_event_id);

-- AXP Agent Economy Layer (Intent Feed + Opportunity Router + Universal Inbox + Genesis Cascade)

create table if not exists intents (
  intent_id text primary key,
  title text not null,
  service text,
  status text not null default 'open',
  reward_usd numeric not null default 0,
  urgency text not null default 'MEDIUM',
  required_capacity_usd numeric not null default 0,
  min_trust_score numeric not null default 0,
  source text,
  requester text,
  claimed_by text,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists inbox_messages (
  id bigserial primary key,
  agent_id text not null,
  kind text not null,
  subject text,
  from_id text,
  ref_id text,
  value_usd numeric not null default 0,
  read boolean not null default false,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists agent_lineage (
  agent_id text primary key,
  handle text,
  sponsor_agent_id text,
  depth integer not null default 0,
  origin text,
  spawned_for_intent text,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists discovery_rewards (
  id bigserial primary key,
  beneficiary_agent_id text not null,
  source_agent_id text,
  contract_id text,
  intent_id text,
  level integer not null default 1,
  amount_axp numeric not null default 0,
  reward_multiplier numeric not null default 1,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists growth_state (
  id text primary key default 'singleton',
  reward_multiplier numeric not null default 1,
  treasury_budget_axp numeric not null default 0,
  treasury_spent_axp numeric not null default 0,
  target_k numeric not null default 1.5,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists intents_status_idx on intents(status);
create index if not exists intents_service_idx on intents(service);
create index if not exists intents_urgency_idx on intents(urgency);
create index if not exists inbox_agent_created_idx on inbox_messages(agent_id, created_at desc);
create index if not exists inbox_agent_kind_idx on inbox_messages(agent_id, kind);
create index if not exists lineage_sponsor_idx on agent_lineage(sponsor_agent_id);
create index if not exists lineage_handle_idx on agent_lineage(handle);
create index if not exists discovery_rewards_beneficiary_idx on discovery_rewards(beneficiary_agent_id, created_at desc);
create index if not exists discovery_rewards_source_idx on discovery_rewards(source_agent_id);

-- AXP Alpha Engine: external demand signals (GitHub / HuggingFace / MCP registries / marketplaces)

create table if not exists external_signals (
  id bigserial primary key,
  source text not null,
  category text not null,
  metric text not null default 'count',
  value numeric not null default 0,
  growth_pct numeric not null default 0,
  query text,
  observed_at timestamptz not null default now(),
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists external_signals_cat_observed_idx on external_signals(category, observed_at desc);
create index if not exists external_signals_observed_idx on external_signals(observed_at desc);

-- AXP Marketplace: hosting subscriptions (Stripe) + one-time launch payments (on-chain)

create table if not exists subscriptions (
  id text primary key,
  customer text,
  agent_id text,
  plan_sku text,
  status text,
  owner_ref text,
  current_period_end timestamptz,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists launch_payments (
  id bigserial primary key,
  agent_id text,
  owner_address text,
  asset text,
  amount numeric,
  tx_hash text,
  verified boolean not null default false,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists subscriptions_agent_idx on subscriptions(agent_id);
create index if not exists subscriptions_status_idx on subscriptions(status);
create unique index if not exists launch_payments_tx_idx on launch_payments(tx_hash);

-- Hire-this-agent: real paid one-off jobs (customer pays -> agent works -> owner paid)

create table if not exists hires (
  id bigserial primary key,
  agent_id text,
  customer_address text,
  asset text,
  amount numeric,
  fee_usd numeric,
  owner_usd numeric,
  tx_hash text,
  payout_tx text,
  status text,
  task text,
  deliverable text,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists hires_agent_idx on hires(agent_id, created_at desc);
create unique index if not exists hires_tx_idx on hires(tx_hash);

-- Decision API credits: buyers top up (crypto/Stripe) and spend per /decision call.

create table if not exists credits (
  owner text primary key,
  balance_usd numeric not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists credit_ledger (
  id bigserial primary key,
  owner text not null,
  usd numeric not null,
  type text not null,
  source text,
  ref text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_owner_idx on credit_ledger(owner, created_at desc);
create unique index if not exists credit_ledger_topup_ref_idx on credit_ledger(ref) where type = 'topup';

create table if not exists credit_keys (
  key_hash text primary key,
  owner text not null,
  created_at timestamptz not null default now()
);
create index if not exists credit_keys_owner_idx on credit_keys(owner);

-- Deribit bot: per-user exchange credentials, ENCRYPTED at rest (AES-256-GCM).
-- Keys must be created trade-only (no withdrawal) + IP-whitelisted on Deribit.
create table if not exists deribit_creds (
  owner text primary key,
  enc text not null,
  testnet boolean not null default true,
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists deribit_bots (
  owner text primary key,
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default false,
  open_state jsonb,
  updated_at timestamptz not null default now()
);
alter table deribit_bots add column if not exists open_state jsonb;

-- Bot trade log (persisted across deploys) — powers the cumulative P&L chart.
create table if not exists bot_trades (
  id bigserial primary key,
  owner text not null,
  type text,
  price numeric,
  size numeric,
  pnl_usd numeric,
  credit_usd numeric,
  reason text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists bot_trades_owner_idx on bot_trades(owner, id desc);
