-- =====================================================================
-- NÚT "CỘNG PHƯỚC" — cho vui, KHÔNG ảnh hưởng số liệu nào.
-- Mỗi CS 1 dòng đếm số lần bấm; trang hiện số của mình + tổng cả team.
-- Chạy lại nhiều lần vẫn an toàn. Không có DELETE/DROP.
-- =====================================================================
create table if not exists cong_phuoc (
  email      text primary key,
  so_lan     bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table cong_phuoc enable row level security;

create or replace function api_phuoc_get(p_email text) returns json stable language sql as $$
  select json_build_object(
    'mine',  coalesce((select so_lan from cong_phuoc where email = lower(trim(p_email))), 0),
    'total', coalesce((select sum(so_lan) from cong_phuoc), 0)) $$;

-- Trình duyệt gom nhiều lần bấm rồi gửi 1 lần (p_n), chặn số bất thường.
create or replace function api_phuoc_add(p_email text, p_n int) returns json language plpgsql as $$
begin
  if p_n is null or p_n < 1 or p_n > 200 then raise exception 'Số lần cộng phước không hợp lệ'; end if;
  insert into cong_phuoc (email, so_lan) values (lower(trim(p_email)), p_n)
  on conflict (email) do update set so_lan = cong_phuoc.so_lan + excluded.so_lan, updated_at = now();
  return api_phuoc_get(p_email);
end $$;

-- Chỉ service_role (Edge Function) được gọi
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'api\_phuoc\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
    execute format('alter function %s set search_path = public', f);
  end loop;
end $$;
