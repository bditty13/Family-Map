-- Family Story Map: database setup
-- In Supabase: SQL Editor -> New query -> paste all of this -> Run.
-- BEFORE running: replace YOUR-EMAIL@EXAMPLE.COM on the last line with your own email.
-- Safe to run again later; it won't erase memories.

-- Who is allowed on the map
create table if not exists public.members (
  email text primary key check (email = lower(email)),
  role text not null default 'member' check (role in ('owner', 'member')),
  added_at timestamptz not null default now()
);

-- The memories
create table if not exists public.memories (
  id text primary key default gen_random_uuid()::text,
  title text not null check (char_length(title) <= 200),
  when_text text,
  category text not null default 'other',
  people text,
  story text,
  address text,
  lat double precision not null,
  lng double precision not null,
  photos text[] not null default '{}',
  added_by_email text default lower(auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Helpers the rules below use
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where email = lower(auth.jwt() ->> 'email'));
$$;
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where email = lower(auth.jwt() ->> 'email') and role = 'owner');
$$;

-- Rules: only invited family can see or change anything
alter table public.members enable row level security;
alter table public.memories enable row level security;

drop policy if exists "family can see members" on public.members;
drop policy if exists "family can invite" on public.members;
drop policy if exists "owner can remove" on public.members;
create policy "family can see members" on public.members for select to authenticated using (public.is_member());
create policy "family can invite" on public.members for insert to authenticated with check (public.is_member() and role = 'member');
create policy "owner can remove" on public.members for delete to authenticated using (public.is_owner() and role <> 'owner');

drop policy if exists "family can read memories" on public.memories;
drop policy if exists "family can add memories" on public.memories;
drop policy if exists "family can edit memories" on public.memories;
drop policy if exists "family can delete memories" on public.memories;
create policy "family can read memories" on public.memories for select to authenticated using (public.is_member());
create policy "family can add memories" on public.memories for insert to authenticated with check (public.is_member());
create policy "family can edit memories" on public.memories for update to authenticated using (public.is_member()) with check (public.is_member());
create policy "family can delete memories" on public.memories for delete to authenticated using (public.is_member());

grant select, insert, delete on public.members to authenticated;
grant select, insert, update, delete on public.memories to authenticated;
grant execute on function public.is_member() to authenticated;
grant execute on function public.is_owner() to authenticated;

-- Photo storage (private: only family can view)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "family can view photos" on storage.objects;
drop policy if exists "family can add photos" on storage.objects;
drop policy if exists "family can replace photos" on storage.objects;
drop policy if exists "family can delete photos" on storage.objects;
create policy "family can view photos" on storage.objects for select to authenticated using (bucket_id = 'photos' and public.is_member());
create policy "family can add photos" on storage.objects for insert to authenticated with check (bucket_id = 'photos' and public.is_member());
create policy "family can replace photos" on storage.objects for update to authenticated using (bucket_id = 'photos' and public.is_member());
create policy "family can delete photos" on storage.objects for delete to authenticated using (bucket_id = 'photos' and public.is_member());

-- Live updates when someone else adds or edits a memory
do $$ begin
  alter publication supabase_realtime add table public.memories;
exception when duplicate_object then null; end $$;

-- You, as the owner. REPLACE THE EMAIL BELOW WITH YOURS.
insert into public.members (email, role) values (lower('YOUR-EMAIL@EXAMPLE.COM'), 'owner')
on conflict (email) do update set role = 'owner';
