-- Budget ledger: the database behind the app (Supabase / Postgres).
-- This file documents what is set up in the project. It holds no personal data.

-- One row per document per account: 'settings' (categories, budgets, repeating
-- entries) and one 'm-YYYY-MM' row for each month of entries.
create table public.ledger_docs (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  key        text        not null check (key = 'settings' or key ~ '^m-[0-9]{4}-[0-9]{2}$'),
  body       jsonb       not null check (jsonb_typeof(body) = 'object' and octet_length(body::text) <= 524288),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.ledger_docs enable row level security;
revoke all on public.ledger_docs from anon, public;
grant select, insert, update, delete on public.ledger_docs to authenticated;

-- Each account reads and writes only its own rows.
create policy "read own budget" on public.ledger_docs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "add to own budget" on public.ledger_docs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "change own budget" on public.ledger_docs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete from own budget" on public.ledger_docs
  for delete to authenticated using ((select auth.uid()) = user_id);

-- The people who share the ledger (the dashboard's tabs). The app cannot read or
-- change this table directly; rows are added by the project owner in Supabase:
--   insert into public.ledger_members (user_id, name) values ('<account id>', 'Name');
create table public.ledger_members (
  user_id  uuid        primary key references auth.users(id) on delete cascade,
  name     text        not null check (char_length(name) between 1 and 40),
  added_at timestamptz not null default now()
);
alter table public.ledger_members enable row level security;
revoke all on public.ledger_members from anon, authenticated, public;

-- Who is on the ledger. Answers only for someone who is on it.
create function public.ledger_people() returns table (user_id uuid, name text)
  language sql stable security definer set search_path = ''
  as $$
    select m.user_id, m.name
    from public.ledger_members m
    where exists (select 1 from public.ledger_members me where me.user_id = (select auth.uid()))
    order by m.name;
  $$;

-- One person's documents, read-only. Answers for your own, or for a fellow
-- member's when you are both on the ledger.
create function public.ledger_read(target uuid) returns table (key text, body jsonb)
  language sql stable security definer set search_path = ''
  as $$
    select d.key, d.body
    from public.ledger_docs d
    where d.user_id = target
      and (
        target = (select auth.uid())
        or (exists (select 1 from public.ledger_members a where a.user_id = (select auth.uid()))
            and exists (select 1 from public.ledger_members b where b.user_id = target))
      );
  $$;

revoke all on function public.ledger_people() from public, anon;
revoke all on function public.ledger_read(uuid) from public, anon;
grant execute on function public.ledger_people() to authenticated;
grant execute on function public.ledger_read(uuid) to authenticated;
