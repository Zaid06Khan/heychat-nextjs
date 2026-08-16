-- ---------------------------------------------------------------------------
-- 0019_group_invites.sql — being added to a group becomes something you agree to
--
-- FOLLOWUPS #13 listed two gaps that are really one: "no invite flow" and
-- "blocked_account_ids is not consulted". 0015's group_add_member() put someone
-- in a group the moment the admin said so. There was no accept step, so anyone
-- could be pulled into any conversation without consent — and because the block
-- list was never checked, **someone you had blocked could still put you in a
-- room with themselves**. Blocking is supposed to be the one control that always
-- works.
--
-- WHAT 0015 ALREADY GOT RIGHT, and is kept: only the admin may invite, the group
-- cap is 256, and `group_add_permission = 'contacts_only'` is honoured against
-- the accepted contact_requests. Those checks move into the invite step rather
-- than being re-litigated.
--
-- group_add_member() IS DROPPED rather than left as an alias. A function whose
-- name says "add" and whose behaviour is "ask" would be read wrong by whoever
-- touches this next, and the only caller is this repo's own client.
-- ---------------------------------------------------------------------------

create table if not exists public.group_invites (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  invited_account uuid not null references public.accounts(id) on delete cascade,
  invited_by      uuid not null references public.accounts(id) on delete cascade,
  status          contact_request_status not null default 'pending',
  created_date    timestamptz not null default now(),
  responded_at    timestamptz,
  constraint group_invites_no_self check (invited_account <> invited_by)
);

-- One live invite per person per group. Partial, so a declined invite does not
-- block a later one — an admin re-inviting after a "no" is legitimate, and
-- rate-limiting that is a social problem rather than a schema one.
create unique index if not exists group_invites_one_pending
  on public.group_invites (conversation_id, invited_account)
  where status = 'pending';

create index if not exists group_invites_invitee_idx
  on public.group_invites (invited_account, status);

alter table public.group_invites enable row level security;

-- Both sides can see the invite: the person deciding, and the admin who sent it.
drop policy if exists group_invites_select_party on public.group_invites;
create policy group_invites_select_party on public.group_invites
  for select to authenticated
  using (invited_account = auth.uid() or invited_by = auth.uid());

-- No INSERT or UPDATE policy on purpose. Creating and answering an invite both
-- have rules RLS cannot express — the block list, the invitee's privacy
-- setting, the group cap, and "accepting also changes participant_ids" — so
-- both go through the functions below and the table takes no direct writes.
grant select on public.group_invites to authenticated;

-- ---------------------------------------------------------------------------
-- Inviting.
-- ---------------------------------------------------------------------------

create or replace function public.group_invite_member(conv_id uuid, invitee uuid)
returns public.group_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller  uuid := auth.uid();
  v_conv    public.conversations%rowtype;
  v_perm    group_add_permission;
  v_blocked uuid[];
  v_row     public.group_invites%rowtype;
begin
  if v_caller is null then
    raise exception 'not signed in';
  end if;

  select * into v_conv from public.conversations where id = conv_id;
  if v_conv.id is null or v_conv.type <> 'group' then
    raise exception 'no such group';
  end if;

  -- `is distinct from`, not `<>` — admin_id is nullable (ON DELETE SET NULL),
  -- and `NULL <> v_caller` is NULL rather than true, so a plain `<>` would let
  -- ANY caller invite to an admin-less group. Same reasoning as 0015.
  if v_conv.admin_id is distinct from v_caller then
    raise exception 'only the group admin can invite people';
  end if;

  if invitee = any (v_conv.participant_ids) then
    raise exception 'they are already in this group';
  end if;

  if coalesce(array_length(v_conv.participant_ids, 1), 0) >= 256 then
    raise exception 'this group is full (256 members)';
  end if;

  select group_add_permission, blocked_account_ids
    into v_perm, v_blocked
    from public.accounts where id = invitee;

  if v_perm is null then
    raise exception 'no such account';
  end if;

  -- THE GAP THIS MIGRATION EXISTS FOR. Blocking someone has to stop them
  -- putting you in a room with themselves, or it does not mean much. Checked
  -- before the privacy setting so a blocked inviter cannot learn anything from
  -- which error comes back.
  if v_caller = any (v_blocked) then
    raise exception 'that person is not accepting invites from you';
  end if;

  if v_perm = 'contacts_only' and not exists (
    select 1 from public.contact_requests cr
    where cr.status = 'accepted'
      and ((cr.from_account_id = v_caller and cr.to_account_id = invitee)
        or (cr.from_account_id = invitee and cr.to_account_id = v_caller))
  ) then
    raise exception 'that person only accepts group invites from contacts';
  end if;

  -- Re-inviting someone who already has a pending invite is the state the
  -- caller wanted, so hand back the existing row. Written as a lookup rather
  -- than ON CONFLICT: the unique index is partial, and a DO UPDATE that has to
  -- no-op in order to RETURNING the existing row is a lot of subtlety for
  -- "already asked them".
  select * into v_row from public.group_invites
   where conversation_id = conv_id
     and invited_account = invitee
     and status = 'pending';

  if v_row.id is not null then
    return v_row;
  end if;

  insert into public.group_invites (conversation_id, invited_account, invited_by)
  values (conv_id, invitee, v_caller)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.group_invite_member(uuid, uuid) from public, anon;
grant execute on function public.group_invite_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Answering.
-- ---------------------------------------------------------------------------

create or replace function public.group_invite_respond(invite_id uuid, accept boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_inv    public.group_invites%rowtype;
  v_conv   public.conversations%rowtype;
begin
  if v_caller is null then
    raise exception 'not signed in';
  end if;

  select * into v_inv from public.group_invites
   where id = invite_id and invited_account = v_caller and status = 'pending'
   for update;

  -- Same message whether it never existed, belongs to someone else, or has
  -- already been answered: an id someone guessed should tell them nothing.
  if v_inv.id is null then
    raise exception 'no such invitation';
  end if;

  if not accept then
    update public.group_invites
       set status = 'declined', responded_at = now()
     where id = invite_id;
    return false;
  end if;

  select * into v_conv from public.conversations
   where id = v_inv.conversation_id for update;

  if v_conv.id is null then
    raise exception 'that group no longer exists';
  end if;

  -- Re-checked at accept time, not just at invite time. An invite can sit for
  -- days, and the group can fill up or the person can be added another way in
  -- between.
  if v_caller = any (v_conv.participant_ids) then
    update public.group_invites
       set status = 'accepted', responded_at = now()
     where id = invite_id;
    return true;
  end if;

  if coalesce(array_length(v_conv.participant_ids, 1), 0) >= 256 then
    raise exception 'this group is full (256 members)';
  end if;

  update public.conversations
     set participant_ids = array_append(participant_ids, v_caller)
   where id = v_inv.conversation_id;

  update public.group_invites
     set status = 'accepted', responded_at = now()
   where id = invite_id;

  return true;
end;
$$;

revoke all on function public.group_invite_respond(uuid, boolean) from public, anon;
grant execute on function public.group_invite_respond(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Listing what you have been asked to join.
--
-- An RPC rather than a select, because the invitee is BY DEFINITION not a member
-- of the conversation yet, so `conversations_select_member` will not show them
-- the group's name. This returns exactly the group name and the inviter — the
-- two things needed to make a decision — and nothing else about a conversation
-- they have not joined.
-- ---------------------------------------------------------------------------

create or replace function public.my_group_invites()
returns table (
  id              uuid,
  conversation_id uuid,
  group_name      text,
  cover_image     text,
  invited_by      uuid,
  inviter_name    text,
  created_date    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    gi.id,
    gi.conversation_id,
    coalesce(c.name, 'Group') as group_name,
    c.cover_image,
    gi.invited_by,
    coalesce(a.display_name, a.username) as inviter_name,
    gi.created_date
  from public.group_invites gi
  join public.conversations c on c.id = gi.conversation_id
  join public.accounts a      on a.id = gi.invited_by
  where gi.invited_account = auth.uid()
    and gi.status = 'pending'
  order by gi.created_date desc;
$$;

revoke all on function public.my_group_invites() from public, anon;
grant execute on function public.my_group_invites() to authenticated;

-- The old direct-add path. Dropped rather than kept as an alias: a function
-- called "add" that now only asks would be misread by whoever comes next.
drop function if exists public.group_add_member(uuid, uuid);

notify pgrst, 'reload schema';
