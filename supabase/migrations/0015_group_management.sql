-- ---------------------------------------------------------------------------
-- 0015_group_management.sql — groups stop being frozen at creation
--
-- Until now a group was whatever GroupCreateDialog made it, forever. No adding
-- members, no removing them, no rename, no new photo, and — worst of the set —
-- NO WAY TO LEAVE. Being added to a group was permanent. That is not a missing
-- feature so much as a trap.
--
-- THIS ALSO CLOSES A HOLE THAT WAS ALREADY OPEN, and which is the reason this
-- file does more than add functions. 0002's policy reads:
--
--     create policy conversations_update_member on public.conversations
--       for update to authenticated
--       using (auth.uid() = any (participant_ids))
--
-- Row-level, with no column restriction, so any member could already UPDATE
-- any column of a group they belonged to: add anyone, remove anyone including
-- the admin, set admin_id to themselves, rename it. Nothing in the UI offered
-- that, which is the only reason it was not being done.
--
-- RLS cannot express "you may change this column but not that one" — it is
-- row-level by construction. Column privileges are the grant layer's job, so
-- that is where the restriction goes, and the operations that need real
-- authorisation move into SECURITY DEFINER functions where the rules can be
-- written out and read.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Narrow what a member may write directly
--
-- `disappearing_timer` stays open to any member: ChatView already lets anyone
-- in a conversation set it, that is deliberate, and it is the one column where
-- "any member" is the intended rule.
--
-- Everything else — participant_ids, admin_id, name, cover_image, type — is now
-- unreachable by a direct UPDATE and has to go through the functions below.
-- INSERT is untouched, so creating a group still works exactly as before.
-- ---------------------------------------------------------------------------

revoke update on public.conversations from authenticated;
grant update (disappearing_timer) on public.conversations to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Who is in charge
-- ---------------------------------------------------------------------------

create or replace function public.is_group_admin(conv_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = conv_id
      and c.type = 'group'
      and c.admin_id = auth.uid()
  );
$$;

grant execute on function public.is_group_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Adding a member
--
-- Admin only, and the person being added gets a say: accounts carry
-- `group_add_permission`, which until now was a setting the UI collected and
-- nothing enforced. 'contacts_only' means an accepted contact request must
-- exist in one direction or the other.
-- ---------------------------------------------------------------------------

create or replace function public.group_add_member(conv_id uuid, new_member uuid)
returns public.conversations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_conv   public.conversations%rowtype;
  v_perm   group_add_permission;
  v_row    public.conversations%rowtype;
begin
  if v_caller is null then
    raise exception 'not signed in';
  end if;

  select * into v_conv from public.conversations where id = conv_id;
  if v_conv.id is null or v_conv.type <> 'group' then
    raise exception 'no such group';
  end if;
  -- `is distinct from`, not `<>`. admin_id is nullable (it is ON DELETE SET
  -- NULL), and `NULL <> v_caller` is NULL rather than true — so with a plain
  -- `<>` this guard would not fire on an admin-less group and ANY caller could
  -- add members to it. `is distinct from` treats NULL as a value.
  if v_conv.admin_id is distinct from v_caller then
    raise exception 'only the group admin can add members';
  end if;
  if new_member = any (v_conv.participant_ids) then
    -- Not an error worth failing on: the desired state already holds.
    return v_conv;
  end if;

  -- A cap, because `participant_ids` is an array scanned on every membership
  -- check. This is a chat group, not a mailing list.
  if array_length(v_conv.participant_ids, 1) >= 256 then
    raise exception 'this group is full (256 members)';
  end if;

  select group_add_permission into v_perm from public.accounts where id = new_member;
  if v_perm is null then
    raise exception 'no such account';
  end if;

  if v_perm = 'contacts_only' and not exists (
    select 1 from public.contact_requests cr
    where cr.status = 'accepted'
      and ((cr.from_account_id = v_caller and cr.to_account_id = new_member)
        or (cr.from_account_id = new_member and cr.to_account_id = v_caller))
  ) then
    raise exception 'that person only accepts group invites from contacts';
  end if;

  update public.conversations
     set participant_ids = array_append(participant_ids, new_member)
   where id = conv_id
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Removing a member
--
-- Admin only, and never the admin themselves — that is what leaving is for,
-- and it has different consequences (succession).
-- ---------------------------------------------------------------------------

create or replace function public.group_remove_member(conv_id uuid, member uuid)
returns public.conversations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_conv   public.conversations%rowtype;
  v_row    public.conversations%rowtype;
begin
  select * into v_conv from public.conversations where id = conv_id;
  if v_conv.id is null or v_conv.type <> 'group' then
    raise exception 'no such group';
  end if;
  -- `is distinct from` for the same reason as group_add_member: a NULL admin_id
  -- would make a `<>` comparison NULL, and the guard would let anyone through.
  if v_conv.admin_id is distinct from v_caller then
    raise exception 'only the group admin can remove members';
  end if;
  if member = v_caller then
    raise exception 'use group_leave() to leave a group you administer';
  end if;
  if not (member = any (v_conv.participant_ids)) then
    return v_conv;
  end if;

  update public.conversations
     set participant_ids = array_remove(participant_ids, member)
   where id = conv_id
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Leaving
--
-- Anyone may leave, always. The two consequences that need deciding rather
-- than defaulting:
--
--   the admin leaves  -> the longest-standing remaining member inherits it.
--                        A group with no admin can never be administered again,
--                        since every function above tests admin_id.
--   the last member   -> the conversation is deleted outright. An empty group
--                        is unreachable by anyone and would sit there forever.
-- ---------------------------------------------------------------------------

create or replace function public.group_leave(conv_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller    uuid := auth.uid();
  v_conv      public.conversations%rowtype;
  v_remaining uuid[];
begin
  select * into v_conv from public.conversations where id = conv_id;
  if v_conv.id is null or v_conv.type <> 'group' then
    raise exception 'no such group';
  end if;
  if not (v_caller = any (v_conv.participant_ids)) then
    raise exception 'you are not in this group';
  end if;

  v_remaining := array_remove(v_conv.participant_ids, v_caller);

  if coalesce(array_length(v_remaining, 1), 0) = 0 then
    -- Messages and everything else cascade from the conversation.
    delete from public.conversations where id = conv_id;
    return;
  end if;

  update public.conversations
     set participant_ids = v_remaining,
         admin_id = case
           -- Also rescues a group that already had no admin: without the NULL
           -- arm it would stay adminless forever, and every function here
           -- tests admin_id, so nobody could ever manage it again.
           when v_conv.admin_id is null or v_conv.admin_id = v_caller
             then v_remaining[1]
           else v_conv.admin_id
         end
   where id = conv_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Renaming and the cover image
--
-- Admin only. Both were reachable by any member until the grant above.
-- ---------------------------------------------------------------------------

create or replace function public.group_update_details(
  conv_id uuid,
  new_name text default null,
  new_cover text default null
)
returns public.conversations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.conversations%rowtype;
begin
  if not public.is_group_admin(conv_id) then
    raise exception 'only the group admin can change the group details';
  end if;

  if new_name is not null and length(btrim(new_name)) = 0 then
    raise exception 'a group needs a name';
  end if;
  if new_name is not null and length(new_name) > 80 then
    raise exception 'that name is too long';
  end if;

  -- NULL means "leave this one alone", so either can be changed on its own.
  update public.conversations
     set name        = coalesce(btrim(new_name), name),
         cover_image = coalesce(new_cover, cover_image)
   where id = conv_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.group_add_member(uuid, uuid) from public, anon;
revoke all on function public.group_remove_member(uuid, uuid) from public, anon;
revoke all on function public.group_leave(uuid) from public, anon;
revoke all on function public.group_update_details(uuid, text, text) from public, anon;

grant execute on function public.group_add_member(uuid, uuid)              to authenticated, service_role;
grant execute on function public.group_remove_member(uuid, uuid)           to authenticated, service_role;
grant execute on function public.group_leave(uuid)                         to authenticated, service_role;
grant execute on function public.group_update_details(uuid, text, text)    to authenticated, service_role;

-- Make the new functions and the changed grant visible to the API. See
-- scripts/reload-api-cache.sql for why this is needed and not automatic.
notify pgrst, 'reload schema';
