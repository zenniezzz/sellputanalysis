-- Put-Sell Screener — snapshot schema (plan §9). M1 subset.
-- Migrations proper (drizzle-kit) land with the Next.js app; this file is the
-- source of truth for the Postgres store until then.

create table if not exists snapshot (
  id                     uuid primary key,
  run_id                 text unique not null,
  created_at             timestamptz not null,
  snapshot_day           date not null,
  run_type               text not null check (run_type in ('scheduled','ondemand','replay')),
  status                 text not null check (status in ('good','degraded','failed')),
  data_completeness      numeric(4,3) not null,
  score_basis            text not null check (score_basis in ('cross_sectional','blended','reference')),
  metric_schema_version  integer not null,
  rates_as_of            date not null,
  universe_hash          text not null,
  provider               text not null,
  display_delayed        boolean not null,
  filter_defaults        jsonb not null,
  notes                  text,
  universe               jsonb not null default '[]'
);

create index if not exists snapshot_created_at_idx on snapshot (created_at desc);

create table if not exists snapshot_row (
  snapshot_id       uuid not null references snapshot(id) on delete cascade,
  snapshot_day      date not null,
  occ_symbol        text not null,
  symbol            text not null,
  expiration        date not null,
  strike            numeric(18,6) not null,
  multiplier        integer not null,
  dte               integer not null,
  spot              numeric(18,6) not null,
  spot_adj          numeric(18,6) not null,
  bid               numeric(18,6),
  ask               numeric(18,6),
  mid               numeric(18,6) not null,
  last              numeric(18,6),
  volume            integer,
  open_interest     integer,
  quote_as_of       timestamptz not null,
  entry_credit      numeric(18,6),
  entry_credit_100  numeric(18,6),
  mid_credit        numeric(18,6),
  slippage_k        numeric(4,3),
  iv                numeric(9,6),
  iv_vs_fitted      numeric(9,6),
  iv_rank           numeric(6,3),
  iv_pctile         numeric(6,3),
  put_skew_25d      numeric(9,6),
  delta             numeric(9,6),
  gamma             numeric(12,8),
  theta_day         numeric(12,8),
  daily_decay       numeric(12,8),
  vega              numeric(12,8),
  moneyness_pct     numeric(9,6),
  spread_pct        numeric(9,6),
  vol_oi            numeric(12,6),
  decay_yield       numeric(12,8),
  theta_vega        numeric(12,6),
  breakeven         numeric(18,6),
  be_pct            numeric(9,6),
  prob_itm          numeric(9,6),
  pop               numeric(9,6),
  em_distance       numeric(9,6),
  csp_capital_100   numeric(18,6),
  regt_capital_100  numeric(18,6),
  ann_roc           numeric(9,6),
  capital_basis     text check (capital_basis in ('csp','regt')),
  ev_100            numeric(18,6),
  max_loss_100      numeric(18,6),
  ev_to_maxloss     numeric(9,6),
  credit_to_maxloss numeric(9,6),
  sigma_f           numeric(9,6),
  vrp_haircut       numeric(6,4),
  mu                numeric(9,6),
  score             numeric(9,4),
  score_components  jsonb,
  model_caution     jsonb not null,
  assignment_watch  boolean not null,
  is_candidate      boolean not null,
  excluded_reason   text,
  primary key (snapshot_id, occ_symbol)
);

create index if not exists snapshot_row_score_idx    on snapshot_row (snapshot_id, score desc nulls last);
create index if not exists snapshot_row_symbol_idx   on snapshot_row (snapshot_id, symbol, score desc);
create index if not exists snapshot_row_contract_idx on snapshot_row (occ_symbol, snapshot_day);

create table if not exists ingestion_run (
  run_id                        text primary key,
  started_at                    timestamptz,
  finished_at                   timestamptz,
  names_ok                      integer,
  names_failed                  integer,
  contracts_priced              integer,
  iv_solve_failures             integer,
  candidates_found              integer,
  greek_xcheck_median_abs_pct   numeric(6,3),
  status                        text
);

create table if not exists ingestion_log (
  run_id      text not null,
  symbol      text not null,
  stage       text not null,
  outcome     text not null check (outcome in ('ok','skipped','failed')),
  error       text,
  duration_ms integer,
  seq         integer not null,
  primary key (run_id, seq)
);

-- 30-day ATM IV history for IV rank / percentile (plan §9.1). Values are AS
-- COMPUTED on `date` and never recomputed as the trailing window rolls.
create table if not exists iv_history (
  symbol        text not null,
  date          date not null,
  atm_iv_30d    numeric(9,6) not null,
  hv20          numeric(9,6),
  hv252         numeric(9,6),
  put_skew_25d  numeric(9,6),
  source        text not null check (source in ('own','orats_backfill','hv_proxy')),
  primary key (symbol, date)
);
create index if not exists iv_history_symbol_date_idx on iv_history (symbol, date desc);

-- Composite-score reference (plan §6.2). `metric_sample_daily` holds the pooled
-- daily aggregate the pipeline appends; `reference(asOf)` rolls the trailing
-- window up. `metric_reference` is the optional materialized rollup a job writes.
create table if not exists metric_sample_daily (
  metric  text not null,
  date    date not null,
  sum     double precision not null,
  sum_sq  double precision not null,
  count   integer not null,
  primary key (metric, date)
);

create table if not exists metric_reference (
  metric      text not null,
  window_end  date not null,
  mean        numeric(18,6) not null,
  stddev      numeric(18,6) not null,
  n_days      integer not null,
  primary key (metric, window_end)
);

-- Raw provider-response bundle index for replay (plan §4.5).
create table if not exists raw_payload_manifest (
  run_id      text not null,
  symbol      text not null default '',
  kind        text not null check (kind in ('chain','underlying','expirations','earnings','rates','most_active')),
  object_key  text not null,
  bytes       bigint not null,
  fetched_at  timestamptz not null,
  pinned      boolean not null default false,
  primary key (run_id, symbol, kind)
);

-- Accounts + per-user data (plan §9.3, M3.5). Auth.js JWT session strategy, so
-- no `session` table; verification tokens back the email-magic-link flow.
create extension if not exists citext;

create table if not exists app_user (
  id             uuid primary key,
  email          citext unique not null,
  name           text,
  image          text,
  email_verified timestamptz
);

create table if not exists account (
  user_id             uuid not null references app_user(id) on delete cascade,
  type                text not null,
  provider            text not null,
  provider_account_id text not null,
  refresh_token text, access_token text, expires_at bigint,
  token_type text, scope text, id_token text,
  primary key (provider, provider_account_id)
);

create table if not exists verification_token (
  identifier text not null,
  token      text not null,
  expires    timestamptz not null,
  primary key (identifier, token)
);

create table if not exists saved_screen (
  id         uuid primary key,
  user_id    uuid not null references app_user(id) on delete cascade,
  name       text not null,
  query      text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (user_id, name)
);

create table if not exists watchlist_symbol (
  user_id uuid not null references app_user(id) on delete cascade,
  symbol  text not null,
  primary key (user_id, symbol)
);

-- Frozen side-by-side comparisons + snapshot bookmarks (plan §8.4, §8.5, M4.5/M5).
create table if not exists frozen_comparison (
  id              uuid primary key,
  user_id         uuid,
  snapshot_run_id text not null,
  occ_symbols     text[] not null,
  created_at      timestamptz not null
);

create table if not exists snapshot_bookmark (
  id              uuid primary key,
  user_id         uuid,
  name            text not null,
  snapshot_run_id text not null,
  filter_query    text not null default '',
  created_at      timestamptz not null
);
create index if not exists snapshot_bookmark_user_idx on snapshot_bookmark (user_id, created_at desc);

-- Partitioning note (plan §9.5): at production scale `snapshot_row` is
-- range-partitioned monthly on `snapshot_day`, e.g.
--   alter table snapshot_row ... partition by range (snapshot_day);
--   create table snapshot_row_2026_09 partition of snapshot_row
--     for values from ('2026-09-01') to ('2026-10-01');
-- The M1 schema above is the unpartitioned form; the migration to partitions
-- lands with drizzle-kit alongside the Next.js app.
