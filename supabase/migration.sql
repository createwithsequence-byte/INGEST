-- INGEST.IO Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Cards table
create table if not exists cards (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  url text not null,
  title text not null default '',
  sub text default '',
  type text default 'OTHER' check (type in ('TOOL','ARTICLE','VIDEO','SOCIAL','GITHUB','OTHER')),
  domain text default '',
  date date default current_date,
  summary text default '',
  details jsonb default '[]'::jsonb,
  pros jsonb default '[]'::jsonb,
  cons jsonb default '[]'::jsonb,
  best_for jsonb default '[]'::jsonb,
  tags jsonb default '[]'::jsonb,
  category text default 'Other',
  score integer default 50 check (score >= 0 and score <= 100),
  longevity text default '6-12mo',
  stale jsonb default '[]'::jsonb,
  intent text default '',
  notes text default '',
  pinned boolean default false,
  ai_suggestion jsonb default null,
  canvas_x float default 400,
  canvas_y float default 400,
  hidden_from_canvas boolean default false,
  status text default 'ingesting' check (status in ('ingesting','complete','error')),
  raw_content text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Categories table
create table if not exists categories (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  color text default '#6366f1',
  canvas_x float default 500,
  canvas_y float default 400,
  created_at timestamptz default now(),
  unique(user_id, name)
);

-- Connections table (card-to-card links)
create table if not exists connections (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  from_card_id uuid references cards(id) on delete cascade not null,
  to_card_id uuid references cards(id) on delete cascade not null,
  created_at timestamptz default now()
);

-- Notes table (sticky notes on canvas)
create table if not exists notes (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  text text default '',
  canvas_x float default 500,
  canvas_y float default 500,
  color text default '#6366f1',
  created_at timestamptz default now()
);

-- Score history (for timeline scrubbing)
create table if not exists score_history (
  id uuid default uuid_generate_v4() primary key,
  card_id uuid references cards(id) on delete cascade not null,
  score integer not null,
  reason text default '',
  recorded_at timestamptz default now()
);

-- Usage events (for analytics and relevance weighting)
create table if not exists events (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  card_id uuid references cards(id) on delete cascade,
  event_type text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- Row Level Security
alter table cards enable row level security;
alter table categories enable row level security;
alter table connections enable row level security;
alter table notes enable row level security;
alter table score_history enable row level security;
alter table events enable row level security;

-- Policies: users can only see their own data
create policy "Users see own cards" on cards for all using (auth.uid() = user_id);
create policy "Users see own categories" on categories for all using (auth.uid() = user_id);
create policy "Users see own connections" on connections for all using (auth.uid() = user_id);
create policy "Users see own notes" on notes for all using (auth.uid() = user_id);
create policy "Users see own score_history" on score_history for all using (card_id in (select id from cards where user_id = auth.uid()));
create policy "Users see own events" on events for all using (auth.uid() = user_id);

-- Indexes
create index if not exists idx_cards_user on cards(user_id);
create index if not exists idx_cards_category on cards(category);
create index if not exists idx_cards_status on cards(status);
create index if not exists idx_categories_user on categories(user_id);
create index if not exists idx_connections_user on connections(user_id);
create index if not exists idx_notes_user on notes(user_id);
create index if not exists idx_events_user on events(user_id);
create index if not exists idx_events_card on events(card_id);

-- Full text search on cards
alter table cards add column if not exists fts tsvector
  generated always as (
    to_tsvector('english', coalesce(title,'') || ' ' || coalesce(sub,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(notes,''))
  ) stored;
create index if not exists idx_cards_fts on cards using gin(fts);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger cards_updated_at
  before update on cards
  for each row execute function update_updated_at();
