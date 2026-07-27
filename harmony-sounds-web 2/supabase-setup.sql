-- =========================================================
-- Harmony Sounds — Supabase setup
-- Run this once, in full, in Supabase: SQL Editor > New Query
-- =========================================================

create extension if not exists pgcrypto;

-- Safe to re-run: clears out anything left from a previous partial attempt.
drop table if exists fuel_logs cascade;
drop table if exists journeys cascade;
drop table if exists fleet cascade;
drop table if exists quote_line_items cascade;
drop table if exists quotes cascade;
drop table if exists event_staff cascade;
drop table if exists event_equipment cascade;
drop table if exists events cascade;
drop table if exists clients cascade;
drop table if exists equipment_logs cascade;
drop table if exists equipment cascade;
drop table if exists profiles cascade;

-- ---------- TABLES ----------

create table profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  name text not null,
  email text unique not null,
  role text not null default 'staff' check (role in ('admin','staff','warehouse','driver')),
  status text not null default 'invited' check (status in ('invited','active')),
  created_at timestamptz default now()
);

create table equipment (
  id uuid primary key default gen_random_uuid(),
  code text,
  barcode text,
  name text not null,
  category text not null,
  total_qty int not null default 0,
  day_rate numeric not null default 0,
  qty_out int not null default 0,
  qty_repair int not null default 0,
  qty_missing int not null default 0,
  created_at timestamptz default now()
);

create table equipment_logs (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid references equipment(id) on delete cascade,
  type text not null,
  qty int not null,
  note text,
  by_name text,
  created_at timestamptz default now()
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  email text,
  phone text,
  created_at timestamptz default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_id uuid references clients(id) on delete set null,
  venue text,
  start_date date not null,
  end_date date not null,
  status text not null default 'quote' check (status in ('quote','confirmed','completed','cancelled')),
  notes text,
  created_at timestamptz default now()
);

create table event_equipment (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  equipment_id uuid references equipment(id) on delete cascade,
  qty int not null default 1
);

create table event_staff (
  event_id uuid references events(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  primary key (event_id, profile_id)
);

create table quotes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  event_id uuid references events(id) on delete set null,
  tax_percent numeric not null default 0,
  status text not null default 'draft' check (status in ('draft','sent','accepted','paid')),
  created_date date not null default current_date
);

create table quote_line_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid references quotes(id) on delete cascade,
  description text,
  qty numeric not null default 1,
  rate numeric not null default 0
);

create table fleet (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plate text,
  type text
);

create table journeys (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid references profiles(id) on delete set null,
  fleet_id uuid references fleet(id) on delete set null,
  purpose text not null check (purpose in ('event','shipment')),
  event_id uuid references events(id) on delete set null,
  shipment_note text,
  status text not null default 'active' check (status in ('active','completed')),
  start_time timestamptz not null default now(),
  start_odometer numeric,
  start_photo text,
  start_lat numeric,
  start_lng numeric,
  end_time timestamptz,
  end_odometer numeric,
  end_photo text,
  end_lat numeric,
  end_lng numeric,
  miles_traveled numeric
);

create table fuel_logs (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid references journeys(id) on delete cascade,
  amount numeric not null,
  created_at timestamptz default now()
);

-- ---------- HELPER FUNCTIONS ----------

create or replace function current_profile_id() returns uuid
language sql stable as $$
  select id from profiles where auth_user_id = auth.uid()
$$;

create or replace function get_my_role() returns text
language sql stable as $$
  select role from profiles where auth_user_id = auth.uid()
$$;

create or replace function is_admin() returns boolean
language sql stable as $$
  select get_my_role() = 'admin'
$$;

create or replace function is_admin_or_warehouse() returns boolean
language sql stable as $$
  select get_my_role() in ('admin','warehouse')
$$;

-- ---------- NEW-USER TRIGGER ----------
-- First person ever to sign in becomes admin automatically.
-- Anyone else must already have an invited profile row matching their email
-- (created by an admin via the Team page) — signing in links it to their account.

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_count int;
  matched_id uuid;
begin
  select count(*) into existing_count from profiles;

  if existing_count = 0 then
    insert into profiles (auth_user_id, name, email, role, status)
    values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)), new.email, 'admin', 'active');
    return new;
  end if;

  select id into matched_id from profiles where email = new.email and auth_user_id is null;

  if matched_id is not null then
    update profiles set auth_user_id = new.id, status = 'active' where id = matched_id;
  else
    -- Someone signed in without a prior invite — let them in as staff so nobody
    -- is silently locked out, but admin should review and correct their role.
    insert into profiles (auth_user_id, name, email, role, status)
    values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)), new.email, 'staff', 'active');
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- ---------- ROW LEVEL SECURITY ----------

alter table profiles enable row level security;
alter table equipment enable row level security;
alter table equipment_logs enable row level security;
alter table clients enable row level security;
alter table events enable row level security;
alter table event_equipment enable row level security;
alter table event_staff enable row level security;
alter table quotes enable row level security;
alter table quote_line_items enable row level security;
alter table fleet enable row level security;
alter table journeys enable row level security;
alter table fuel_logs enable row level security;

-- profiles
create policy "profiles read all" on profiles for select to authenticated using (true);
create policy "profiles admin write" on profiles for insert to authenticated with check (is_admin());
create policy "profiles admin or self update" on profiles for update to authenticated using (is_admin() or auth_user_id = auth.uid());
create policy "profiles admin delete" on profiles for delete to authenticated using (is_admin());

-- equipment
create policy "equipment read all" on equipment for select to authenticated using (true);
create policy "equipment admin/warehouse write" on equipment for insert to authenticated with check (is_admin_or_warehouse());
create policy "equipment admin/warehouse update" on equipment for update to authenticated using (is_admin_or_warehouse());
create policy "equipment admin delete" on equipment for delete to authenticated using (is_admin());

-- equipment_logs
create policy "logs read all" on equipment_logs for select to authenticated using (true);
create policy "logs admin/warehouse insert" on equipment_logs for insert to authenticated with check (is_admin_or_warehouse());

-- clients
create policy "clients admin all select" on clients for select to authenticated using (is_admin());
create policy "clients admin all insert" on clients for insert to authenticated with check (is_admin());
create policy "clients admin all update" on clients for update to authenticated using (is_admin());
create policy "clients admin all delete" on clients for delete to authenticated using (is_admin());

-- events
create policy "events select scoped" on events for select to authenticated using (
  is_admin()
  or get_my_role() in ('warehouse','driver')
  or exists (select 1 from event_staff es where es.event_id = events.id and es.profile_id = current_profile_id())
);
create policy "events admin insert" on events for insert to authenticated with check (is_admin());
create policy "events admin update" on events for update to authenticated using (is_admin());
create policy "events admin delete" on events for delete to authenticated using (is_admin());

-- event_equipment
create policy "event_equipment read all" on event_equipment for select to authenticated using (true);
create policy "event_equipment admin insert" on event_equipment for insert to authenticated with check (is_admin());
create policy "event_equipment admin update" on event_equipment for update to authenticated using (is_admin());
create policy "event_equipment admin delete" on event_equipment for delete to authenticated using (is_admin());

-- event_staff
create policy "event_staff read all" on event_staff for select to authenticated using (true);
create policy "event_staff admin insert" on event_staff for insert to authenticated with check (is_admin());
create policy "event_staff admin delete" on event_staff for delete to authenticated using (is_admin());

-- quotes
create policy "quotes admin select" on quotes for select to authenticated using (is_admin());
create policy "quotes admin insert" on quotes for insert to authenticated with check (is_admin());
create policy "quotes admin update" on quotes for update to authenticated using (is_admin());
create policy "quotes admin delete" on quotes for delete to authenticated using (is_admin());

-- quote_line_items
create policy "quote_lines admin select" on quote_line_items for select to authenticated using (is_admin());
create policy "quote_lines admin insert" on quote_line_items for insert to authenticated with check (is_admin());
create policy "quote_lines admin update" on quote_line_items for update to authenticated using (is_admin());
create policy "quote_lines admin delete" on quote_line_items for delete to authenticated using (is_admin());

-- fleet
create policy "fleet read all" on fleet for select to authenticated using (true);
create policy "fleet admin insert" on fleet for insert to authenticated with check (is_admin());
create policy "fleet admin update" on fleet for update to authenticated using (is_admin());
create policy "fleet admin delete" on fleet for delete to authenticated using (is_admin());

-- journeys
create policy "journeys select own or admin" on journeys for select to authenticated using (
  is_admin() or driver_id = current_profile_id()
);
create policy "journeys insert own or admin" on journeys for insert to authenticated with check (
  is_admin() or driver_id = current_profile_id()
);
create policy "journeys update own or admin" on journeys for update to authenticated using (
  is_admin() or driver_id = current_profile_id()
);

-- fuel_logs
create policy "fuel select own or admin" on fuel_logs for select to authenticated using (
  is_admin() or exists (select 1 from journeys j where j.id = fuel_logs.journey_id and j.driver_id = current_profile_id())
);
create policy "fuel insert own or admin" on fuel_logs for insert to authenticated with check (
  is_admin() or exists (select 1 from journeys j where j.id = fuel_logs.journey_id and j.driver_id = current_profile_id())
);

-- ---------- REALTIME ----------
alter publication supabase_realtime add table equipment, equipment_logs, events, event_equipment, event_staff, journeys, fuel_logs, clients, quotes, quote_line_items, fleet, profiles;
