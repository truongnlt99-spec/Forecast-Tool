-- =====================================================================
-- 10b — CHUYỂN DEAL ID SANG NỀN TẢNG 3.0 (20/11/2026)
--
-- 3.0 dùng Deal ID / Job ID dạng chữ (vd "aFD7lKLl-QEskdNukDi-Gw9xOUcDUMf") thay vì số.
-- File này (1 transaction — lỗi ở đâu là huỷ toàn bộ, không hỏng dở dang):
--   1. Sao lưu 4 bảng deal sang schema bk30 (không lộ ra API).
--   2. Đổi cột deal_id (+ job_id) từ bigint → text ở deals_raw, deal_inputs,
--      deal_multiyear_inputs, deal_input_history. View phụ thuộc được lưu định nghĩa
--      đang chạy, xoá rồi tạo lại y nguyên (giữ security_invoker + quyền chỉ service_role).
--   3. Đổi mã cũ → mã mới theo bảng deal_id_map_3_0 (10a + napMaDeal30). Deal không có
--      trong bảng giữ mã cũ dạng chữ; lượt đồng bộ 3.0 đầu tiên sẽ tự ẩn chúng (không xoá).
--   4. Các hàm nhận / ép Deal ID kiểu số → nhận chữ.
--
-- TRƯỚC KHI CHẠY: tắt trigger dongBoDeals trong Apps Script (script cũ chạy sau khi đổi mã
-- sẽ nạp lại deal mã cũ). Sau khi chạy: dán script mới, chạy dongBoDeals() tay, rồi bật lại.
-- Khôi phục nếu cần: bảng gốc nằm ở bk30.deals_raw, bk30.deal_inputs, ...
-- =====================================================================

begin;

do $$ begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'deals_raw' and column_name = 'deal_id') = 'text' then
    raise exception 'deals_raw.deal_id đã là text — đã chuyển 3.0 rồi, không chạy lại.';
  end if;
  if (select count(*) from deal_id_map_3_0) < 1000 then
    raise exception 'deal_id_map_3_0 mới có % dòng — chạy napMaDeal30() trong Apps Script trước.',
      (select count(*) from deal_id_map_3_0);
  end if;
end $$;

-- 1. Sao lưu ------------------------------------------------------------
create schema if not exists bk30;
revoke all on schema bk30 from anon, authenticated;
create table bk30.deals_raw             as table public.deals_raw;
create table bk30.deal_inputs           as table public.deal_inputs;
create table bk30.deal_multiyear_inputs as table public.deal_multiyear_inputs;
create table bk30.deal_input_history    as table public.deal_input_history;

-- 2. Đổi kiểu cột --------------------------------------------------------
create temp table _v30 on commit drop as
  select c.relname::text as name, rtrim(pg_get_viewdef(c.oid), E'; \n') as def
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relname in ('v_deal_owner', 'v_database', 'v_database_display');
do $$ begin
  if (select count(*) from _v30) <> 3 then raise exception 'Không thấy đủ 3 view cần tạo lại.'; end if;
end $$;

drop view v_database_display;
drop view v_database;
drop view v_deal_owner;

alter table deal_inputs           drop constraint deal_inputs_deal_id_fkey;
alter table deal_multiyear_inputs drop constraint deal_multiyear_inputs_deal_id_fkey;

alter table deals_raw
  alter column deal_id type text using deal_id::text,
  alter column job_id  type text using job_id::text;
alter table deal_inputs           alter column deal_id type text using deal_id::text;
alter table deal_multiyear_inputs alter column deal_id type text using deal_id::text;
alter table deal_input_history    alter column deal_id type text using deal_id::text;

-- 3. Đổi mã cũ → mã mới -------------------------------------------------
update deals_raw r set deal_id = m.new_id, job_id = coalesce(m.new_job, r.job_id)
  from deal_id_map_3_0 m where r.deal_id = m.old_id::text;
update deal_inputs i           set deal_id = m.new_id from deal_id_map_3_0 m where i.deal_id = m.old_id::text;
update deal_multiyear_inputs i set deal_id = m.new_id from deal_id_map_3_0 m where i.deal_id = m.old_id::text;
update deal_input_history h    set deal_id = m.new_id from deal_id_map_3_0 m where h.deal_id = m.old_id::text;

alter table deal_inputs
  add constraint deal_inputs_deal_id_fkey foreign key (deal_id) references deals_raw(deal_id);
alter table deal_multiyear_inputs
  add constraint deal_multiyear_inputs_deal_id_fkey foreign key (deal_id) references deals_raw(deal_id);

-- tạo lại view y nguyên định nghĩa đang chạy, quyền như cũ (chỉ service_role)
do $$ declare v record; begin
  for v in select * from _v30
           order by array_position(array['v_deal_owner', 'v_database', 'v_database_display'], name) loop
    execute format('create view public.%I with (security_invoker = true) as %s', v.name, v.def);
    execute format('revoke all on public.%I from public, anon, authenticated', v.name);
    execute format('grant all on public.%I to service_role', v.name);
  end loop;
end $$;

-- 4. Hàm nhận Deal ID dạng chữ ------------------------------------------
drop function api_admin_get_deal(text, bigint);
drop function api_patch_deal_input(text, bigint, jsonb);
drop function deal_ngay_dg(bigint, text);

create function public.deal_ngay_dg(p_deal_id text, p_ky text)
 returns date language sql stable set search_path to 'public'
as $function$
  select ngay_dg(case when p_ky = 'T4' then r.ngay_danh_gia_4_thang else r.ngay_danh_gia_1_thang end,
                 coalesce(r.custom_ngay_keo_danh_gia, i.go_live_actual),
                 case when p_ky = 'T4' then 4 else 1 end)
  from deals_raw r left join deal_inputs i on i.deal_id = r.deal_id
  where r.deal_id = p_deal_id $function$;

create function public.api_admin_get_deal(p_email text, p_deal_id text)
 returns json language plpgsql stable set search_path to 'public'
as $function$
declare raw json;
begin
  perform admin_check(p_email);
  select row_to_json(r) into raw from deals_raw r where r.deal_id = p_deal_id;
  if raw is null then raise exception 'Không có deal % trong dữ liệu (deals_raw)', p_deal_id; end if;
  return json_build_object(
    'trenConsole', (select row_to_json(d) from v_database_display d where d."Deal ID" = p_deal_id),
    'lyDoKhongHien', case
       when not (raw->>'is_active')::boolean then 'Deal đã rớt khỏi query BigQuery (is_active = false)'
       when raw->>'co_che_com' = 'Chính sách cũ' then 'Cơ chế tính com = Chính sách cũ (bị loại khỏi console)'
       when not exists (select 1 from v_database_display d where d."Deal ID" = p_deal_id) then 'Không hiện trên console'
       end,
    'csPhuTrach', (select lower(email) from v_deal_owner o where o.deal_id = p_deal_id),
    'bigQueryGoc', raw,
    'csNhapNam1', (select row_to_json(i) from deal_inputs i where i.deal_id = p_deal_id),
    'csNhapNam2_5', (select coalesce(json_agg(row_to_json(m) order by m.year, m.period), '[]'::json)
                     from deal_multiyear_inputs m where m.deal_id = p_deal_id),
    'lichSuSua', (select coalesce(json_agg(json_build_object('luc', to_char(h.changed_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI'),
                        'o', h.field, 'cu', h.old_value, 'moi', h.new_value, 'boi', h.changed_by) order by h.changed_at desc), '[]'::json)
                  from (select * from deal_input_history where deal_id = p_deal_id order by changed_at desc limit 30) h));
end $function$;

create function public.api_patch_deal_input(p_email text, p_deal_id text, p_patch jsonb)
 returns json language plpgsql set search_path to 'public'
as $function$
declare r deals_raw%rowtype; cur deal_inputs%rowtype; locked text[] := '{}'; k text; dg1 date; dg4 date;
begin
  if not exists (select 1 from v_deal_owner o where o.deal_id = p_deal_id and o.email = lower(trim(p_email))) then
    raise exception 'Deal % không thuộc bạn phụ trách (hoặc không tồn tại)', p_deal_id;
  end if;
  select * into r from deals_raw where deal_id = p_deal_id;
  if r.co_che_com = 'Chính sách cũ' then
    raise exception 'Deal % thuộc Chính sách cũ — không tính trên console', p_deal_id;
  end if;
  if r.custom_ngay_keo_danh_gia is not null then
    locked := locked || 'goLive'::text;
  end if;
  dg1 := deal_ngay_dg(p_deal_id, 'T1');
  dg4 := deal_ngay_dg(p_deal_id, 'T4');
  if dg1 < vn_today() then locked := locked || array['aT1', 'oT1']; end if;
  if dg4 < vn_today() then locked := locked || array['aT4', 'oT4']; end if;
  for k in select jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) loop
    if k not in ('goLive', 'aT1', 'oT1', 'aT4', 'oT4') then
      raise exception 'Ô "%" không sửa được (chỉ goLive, aT1, oT1, aT4, oT4)', k;
    end if;
    if k = 'goLive' and k = any(locked) then
      raise exception 'Ngày go-live của deal % đã kéo đánh giá trên Base CRM — không sửa tay được', p_deal_id;
    end if;
    if k = any(locked) then
      raise exception 'Ô % của deal % đã qua ngày đánh giá % (%) — khoá, không sửa được nữa', k, p_deal_id,
        right(k, 2), to_char(case when right(k, 2) = 'T1' then dg1 else dg4 end, 'DD/MM/YYYY');
    end if;
  end loop;
  if p_patch ? 'goLive' and trim(coalesce(p_patch->>'goLive', '')) <> ''
     and trim(p_patch->>'goLive') !~ '^\d{1,2}/\d{1,2}/\d{4}$' then
    raise exception 'Ngày go-live phải dạng dd/mm/yyyy';
  end if;

  insert into deal_inputs (deal_id) values (p_deal_id) on conflict (deal_id) do nothing;
  select * into cur from deal_inputs where deal_id = p_deal_id for update;
  update deal_inputs set
    go_live_actual = case when p_patch ? 'goLive' then date_in(p_patch->>'goLive', cur.go_live_actual) else go_live_actual end,
    active_t1 = case when p_patch ? 'aT1' then pct_in(p_patch->'aT1', cur.active_t1) else active_t1 end,
    output_t1 = case when p_patch ? 'oT1' then pct_in(p_patch->'oT1', cur.output_t1) else output_t1 end,
    active_t4 = case when p_patch ? 'aT4' then pct_in(p_patch->'aT4', cur.active_t4) else active_t4 end,
    output_t4 = case when p_patch ? 'oT4' then pct_in(p_patch->'oT4', cur.output_t4) else output_t4 end,
    updated_by = lower(p_email), updated_at = now()
  where deal_id = p_deal_id
  returning * into cur;
  return json_build_object('dealId', p_deal_id, 'goLive', fmt_date(cur.go_live_actual),
    'aT1', cur.active_t1, 'oT1', cur.output_t1, 'aT4', cur.active_t4, 'oT4', cur.output_t4,
    'locked', to_json(locked));
end $function$;

-- hàm mới tạo: quyền như cũ (chỉ service_role)
revoke all on function deal_ngay_dg(text, text), api_admin_get_deal(text, text),
  api_patch_deal_input(text, text, jsonb) from public, anon, authenticated;
grant execute on function deal_ngay_dg(text, text), api_admin_get_deal(text, text),
  api_patch_deal_input(text, text, jsonb) to service_role;

-- 3 hàm lưu: giữ nguyên chữ ký (giữ quyền), chỉ bỏ ép Deal ID về số
create or replace function public.api_save_rows(p_email text, p_rows jsonb)
 returns integer language plpgsql set search_path to 'public'
as $function$
declare
  r jsonb; did text; cur deal_inputs%rowtype; n int := 0; k1 boolean; k4 boolean;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    did := trim(coalesce(r->>'dealId', ''));
    if did = '' then continue; end if;
    if not exists (select 1 from v_deal_owner o where o.deal_id = did and o.email = lower(trim(p_email))) then
      continue;
    end if;
    insert into deal_inputs (deal_id) values (did) on conflict (deal_id) do nothing;
    select * into cur from deal_inputs where deal_id = did for update;
    k1 := coalesce(deal_ngay_dg(did, 'T1') < vn_today(), false);
    k4 := coalesce(deal_ngay_dg(did, 'T4') < vn_today(), false);
    update deal_inputs set
      go_live_actual = date_in(r->>'goLive', cur.go_live_actual),
      active_t1 = case when k1 then cur.active_t1 else pct_in(r->'aT1', cur.active_t1) end,
      output_t1 = case when k1 then cur.output_t1 else pct_in(r->'oT1', cur.output_t1) end,
      active_t4 = case when k4 then cur.active_t4 else pct_in(r->'aT4', cur.active_t4) end,
      output_t4 = case when k4 then cur.output_t4 else pct_in(r->'oT4', cur.output_t4) end,
      updated_by = lower(p_email), updated_at = now()
    where deal_id = did;
    n := n + 1;
  end loop;
  return n;
end $function$;

create or replace function public.api_save_multiyear(p_email text, p_rows jsonb)
 returns integer language plpgsql set search_path to 'public'
as $function$
declare
  r jsonb; did text; yr int; per text; cur deal_multiyear_inputs%rowtype; n int := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    did := trim(coalesce(r->>'dealId', ''));
    if did = '' then continue; end if;
    if not exists (select 1 from v_deal_owner o where o.deal_id = did and o.email = lower(trim(p_email))) then
      continue;
    end if;
    if coalesce(r->>'year', '') !~ '^\s*\d+\s*$' then continue; end if;
    yr := trim(r->>'year')::int;
    if yr < 2 or yr > 5 then continue; end if;
    per := case when upper(coalesce(r->>'period', '')) = 'T4' then 'T4' else 'T1' end;
    if deal_ngay_dg(did, per) + make_interval(years => yr - 1) < vn_today() then continue; end if;
    insert into deal_multiyear_inputs (deal_id, year, period) values (did, yr, per)
      on conflict (deal_id, year, period) do nothing;
    select * into cur from deal_multiyear_inputs
      where deal_id = did and year = yr and period = per for update;
    update deal_multiyear_inputs set
      active = pct_in(r->'active', cur.active),
      output = pct_in(r->'output', cur.output),
      updated_by = lower(p_email), updated_at = now()
    where deal_id = did and year = yr and period = per;
    n := n + 1;
  end loop;
  return n;
end $function$;

create or replace function public.api_save_request(p_email text, p_deal_id text, p_type text, p_gl_extend text, p_link text, p_remove boolean)
 returns void language plpgsql set search_path to 'public'
as $function$
declare did text := trim(coalesce(p_deal_id, '')); gl text := trim(coalesce(p_gl_extend, ''));
begin
  if did = '' or not exists (select 1 from v_deal_owner where deal_id = did) then
    raise exception 'Không tìm thấy deal % trong Database', p_deal_id;
  end if;
  if not exists (select 1 from v_deal_owner o where o.deal_id = did and o.email = lower(trim(p_email))) then
    raise exception 'Không có quyền sửa deal này';
  end if;
  insert into deal_inputs (deal_id) values (did) on conflict (deal_id) do nothing;

  if p_type = 'extend' then
    if coalesce(p_remove, false) or gl = '' then
      update deal_inputs set go_live_extend = null where deal_id = did;
    elsif gl ~ '^\d{1,2}/\d{1,2}/\d{4}$' then
      update deal_inputs set go_live_extend = to_date(gl, 'DD/MM/YYYY') where deal_id = did;
    else
      raise exception 'Ngày gia hạn không đúng định dạng dd/mm/yyyy';
    end if;
  elsif p_type = 'stop' then
    update deal_inputs set stopped = not coalesce(p_remove, false) where deal_id = did;
  else
    raise exception 'reqType phải là "extend" hoặc "stop"';
  end if;

  update deal_inputs set
    link_request = case when coalesce(p_remove, false) then null else nullif(coalesce(p_link, ''), '') end,
    updated_by = lower(p_email), updated_at = now()
  where deal_id = did;
end $function$;

-- Kết quả: bao nhiêu deal / số CS đã nhập đã sang mã mới
select
  (select count(*) from deals_raw where deal_id in (select new_id from deal_id_map_3_0))                 as deal_da_doi_ma,
  (select count(*) from deals_raw where deal_id not in (select new_id from deal_id_map_3_0))             as deal_giu_ma_cu,
  (select count(*) from deal_inputs where deal_id in (select new_id from deal_id_map_3_0))               as so_cs_nhap_da_doi_ma,
  (select string_agg(deal_id, ', ') from deal_inputs where deal_id not in (select new_id from deal_id_map_3_0)) as so_cs_nhap_giu_ma_cu;

commit;
