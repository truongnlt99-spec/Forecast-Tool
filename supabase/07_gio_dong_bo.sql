-- =====================================================================
-- 07 — GIỜ ĐỒNG BỘ CRM GẦN NHẤT (17/10/2026)
-- Trang hiện "Dữ liệu CRM cập nhật lúc …" để CS biết deal mới tạo trên CRM sau giờ đó
-- sẽ lên ở lượt đồng bộ sau (giảm feedback "thiếu deal"). Edge Function api trả kèm
-- trường syncedAt trong response GET; chưa chạy file này thì syncedAt = null, trang ẩn dòng đó.
-- Chạy lại nhiều lần vẫn an toàn. Không có DELETE/DROP.
-- =====================================================================
create or replace function api_data_synced_at() returns text stable language sql as $$
  select to_char(max(synced_at) at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI')
  from deals_raw where is_active $$;

-- Chỉ service_role (Edge Function) được gọi
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'api_data_synced_at' loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
    execute format('alter function %s set search_path = public', f);
  end loop;
end $$;
