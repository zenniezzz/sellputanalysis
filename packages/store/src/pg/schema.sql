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
  notes                  text
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
