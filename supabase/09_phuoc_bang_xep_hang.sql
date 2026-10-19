-- =====================================================================
-- CỘNG PHƯỚC — BẢNG XẾP HẠNG (màn Quản trị, chỉ admin).
-- Đọc bảng cong_phuoc (05_cong_phuoc.sql), ghép tên / level từ cs_members.
-- Chỉ đọc, chạy lại nhiều lần vẫn an toàn. Không có DELETE/DROP.
-- =====================================================================
create or replace function api_admin_phuoc_board(p_email text) returns json stable language plpgsql as $$
begin
  perform admin_check(p_email);
  return (
    with b as (
      select p.email, p.so_lan, p.updated_at,
             coalesce(nullif(trim(m.ho_ten), ''), nullif(trim(m.username), ''), p.email) as ten,
             coalesce(m.level, '') as level,
             rank() over (order by p.so_lan desc) as hang
      from cong_phuoc p
      left join lateral (
        select ho_ten, username, level from cs_members
        where lower(trim(email)) = p.email limit 1
      ) m on true
      where p.so_lan > 0
    )
    select json_build_object(
      'total',   coalesce((select sum(so_lan) from b), 0),
      'people',  (select count(*) from b),
      'members', (select count(*) from cs_members),
      'items',   coalesce((select json_agg(json_build_object(
                     'rank', hang, 'email', email, 'name', ten, 'level', level, 'count', so_lan,
                     'lastAt', coalesce(to_char(updated_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI'), ''))
                   order by so_lan desc, ten) from b), '[]'::json))
  );
end $$;

-- Chỉ service_role (Edge Function) được gọi
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'api_admin_phuoc_board' loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
    execute format('alter function %s set search_path = public', f);
  end loop;
end $$;
