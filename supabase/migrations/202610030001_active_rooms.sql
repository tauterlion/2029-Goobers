-- All private state lives in a versioned aggregate. A single conditional UPDATE
-- atomically commits membership, votes, scores and transitions together.
create table public.rooms (
 id uuid primary key,
 code text not null unique check (code ~ '^[A-Z2-9]{5}$'),
 version bigint not null default 0,
 state jsonb not null check (jsonb_typeof(state) = 'object'),
 created_at timestamptz not null default now(),
 last_activity_at timestamptz not null default now()
);
create index rooms_expiry on public.rooms(last_activity_at);
alter table public.rooms enable row level security;
revoke all on public.rooms from anon, authenticated;
grant all on public.rooms to service_role;
create or replace function public.commit_room(room_id uuid, expected_version bigint, new_state jsonb, notify_clients boolean default true)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
 update public.rooms set state=new_state, version=version+1,last_activity_at=now()
 where id=room_id and version=expected_version;
 if not found then return false; end if;
 -- Only an invalidation signal is public; names, captions and tokens never broadcast.
 if notify_clients then
   perform realtime.send(jsonb_build_object('version',expected_version+1),'changed','room:'||room_id::text,false);
 end if;
 return true;
end; $$;
create or replace function public.cleanup_stale_rooms()
returns void language sql security invoker set search_path = '' as $$
 delete from public.rooms where last_activity_at < now()-interval '6 hours';
$$;
revoke all on function public.commit_room(uuid,bigint,jsonb,boolean) from public, anon, authenticated;
revoke all on function public.cleanup_stale_rooms() from public, anon, authenticated;
grant execute on function public.commit_room(uuid,bigint,jsonb,boolean) to service_role;
grant execute on function public.cleanup_stale_rooms() to service_role;
