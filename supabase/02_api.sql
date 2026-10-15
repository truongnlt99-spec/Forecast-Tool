-- =====================================================================
-- FORECAST TOOL — LỚP API (chạy SAU 01_tao_bang.sql)
-- Edge Function "api" chỉ gọi các hàm api_* dưới đây bằng service_role.
-- Định dạng output bắt chước getDisplayValues() của sheet:
--   ngày "dd/MM/yyyy" · tháng "MM/yyyy" · tiền "5.031.000" · % "50,00%"
-- =====================================================================

-- ---------- Bảo mật: view/hàm KHÔNG cho anon/authenticated đọc ----------
alter view v_database set (security_invoker = true);
revoke all on v_database from anon, authenticated;

-- ---------- Hàm format ----------
create or replace function fmt_date(d date) returns text immutable language sql as $$
  select coalesce(to_char(d, 'DD/MM/YYYY'), '') $$;
create or replace function fmt_month(d date) returns text immutable language sql as $$
  select coalesce(to_char(d, 'MM/YYYY'), '') $$;
create or replace function fmt_money(n numeric) returns text immutable language sql as $$
  select case when n is null then ''
              else replace(to_char(round(n), 'FM999,999,999,999,990'), ',', '.') end $$;
create or replace function fmt_pct(x numeric) returns text immutable language sql as $$
  select case when x is null then ''
              else replace(to_char(x * 100, 'FM9999990.00'), '.', ',') || '%' end $$;
-- số gọn: 100 → "100", 54.4 → "54,4"
create or replace function fmt_num(n numeric) returns text immutable language sql as $$
  select case when n is null then ''
              else replace(rtrim(rtrim(to_char(n, 'FM9999990.0000'), '0'), '.'), '.', ',') end $$;
-- 1 chữ số thập phân: 100 → "100,0"
create or replace function fmt_num1(n numeric) returns text immutable language sql as $$
  select case when n is null then '' else replace(to_char(n, 'FM9999990.0'), '.', ',') end $$;

-- ---------- View hiển thị: 104 cột text đúng thứ tự header sheet + cột "Nguồn go-live" ----------
create or replace view v_database_display with (security_invoker = true) as
select
  coalesce((d."ID Workflow bàn giao")::text, '') as "ID Workflow bàn giao",
  coalesce((d."Deal ID")::text, '') as "Deal ID",
  coalesce((d."Tên khách hàng")::text, '') as "Tên khách hàng",
  coalesce((d."Username CS triển khai")::text, '') as "Username CS triển khai",
  coalesce((d."Email phụ trách")::text, '') as "Email phụ trách",
  coalesce((d."Vai trò phụ trách")::text, '') as "Vai trò phụ trách",
  coalesce((d."Loại hợp đồng")::text, '') as "Loại hợp đồng",
  coalesce((d."Bộ giải pháp")::text, '') as "Bộ giải pháp",
  fmt_money(d."Giá trị phần mềm bộ (VNĐ)") as "Giá trị phần mềm bộ (VNĐ)",
  coalesce((d."Số năm HĐ")::text, '') as "Số năm HĐ",
  coalesce((d."Số users đăng ký")::text, '') as "Số users đăng ký",
  fmt_date(d."Ngày nhận deal") as "Ngày nhận deal",
  fmt_date(d."Ngày go-live thực tế") as "Ngày go-live thực tế",
  fmt_date(d."Ngày go-live gia hạn ") as "Ngày go-live gia hạn ",
  fmt_pct(d."% Active T1") as "% Active T1",
  fmt_pct(d."% Output T1") as "% Output T1",
  fmt_pct(d."% Active T4") as "% Active T4",
  fmt_pct(d."% Output T4") as "% Output T4",
  case when d."Dừng triển khai " is null then '' else 'x' end as "Dừng triển khai ",
  coalesce((d."Link request")::text, '') as "Link request",
  coalesce((d."System ID")::text, '') as "System ID",
  coalesce((d."Tên công ty ")::text, '') as "Tên công ty ",
  coalesce((d."Non-SW?")::text, '') as "Non-SW?",
  fmt_money(d."Tổng giá trị HĐ") as "Tổng giá trị HĐ",
  coalesce((d."Số bộ trong deal")::text, '') as "Số bộ trong deal",
  coalesce((d."Phân khúc")::text, '') as "Phân khúc",
  coalesce((d."Tier")::text, '') as "Tier",
  case when d."TTGL (ngày)" is null then '' else d."TTGL (ngày)" || ' ngày' end as "TTGL (ngày)",
  fmt_date(d."Ngày go-live dự kiến") as "Ngày go-live dự kiến",
  coalesce((d."Trạng thái go-live")::text, '') as "Trạng thái go-live",
  coalesce((d."Tháng ghi nhận CR")::text, '') as "Tháng ghi nhận CR",
  fmt_money(d."DT phải go-live") as "DT phải go-live",
  fmt_money(d."DT go-live đạt") as "DT go-live đạt",
  fmt_month(d."Tháng đo T1") as "Tháng đo T1",
  fmt_month(d."Tháng đo T4") as "Tháng đo T4",
  fmt_num(d."Điểm U (T1)") as "Điểm U (T1)",
  fmt_num(d."Điểm O (T1)") as "Điểm O (T1)",
  fmt_num1(d."CHS_CS T1") as "CHS_CS T1",
  coalesce((d."Đạt T1? (≥50)")::text, '') as "Đạt T1? (≥50)",
  fmt_num(d."Điểm U (T4)") as "Điểm U (T4)",
  fmt_num(d."Điểm O (T4)") as "Điểm O (T4)",
  fmt_num1(d."CHS_CS T4") as "CHS_CS T4",
  coalesce((d."Đạt T4? (≥50)")::text, '') as "Đạt T4? (≥50)",
  fmt_money(d."ACR (VNĐ/năm)") as "ACR (VNĐ/năm)",
  fmt_money(d."ACR đủ đk COM T1") as "ACR đủ đk COM T1",
  fmt_money(d."ACR đủ đk COM T4") as "ACR đủ đk COM T4",
  fmt_date(d."Ngày hết hạn trả Com") as "Ngày hết hạn trả Com",
  coalesce((d."Số năm nhận com")::text, '') as "Số năm nhận com",
  fmt_month(d."Tháng nhận Com T1 - Năm 2") as "Tháng nhận Com T1 - Năm 2",
  fmt_month(d."Tháng nhận Com T4 - Năm 2") as "Tháng nhận Com T4 - Năm 2",
  fmt_month(d."Tháng nhận Com T1 - Năm 3") as "Tháng nhận Com T1 - Năm 3",
  fmt_month(d."Tháng nhận Com T4 - Năm 3") as "Tháng nhận Com T4 - Năm 3",
  fmt_month(d."Tháng nhận Com T1 - Năm 4") as "Tháng nhận Com T1 - Năm 4",
  fmt_month(d."Tháng nhận Com T4 - Năm 4") as "Tháng nhận Com T4 - Năm 4",
  fmt_month(d."Tháng nhận Com T1 - Năm 5") as "Tháng nhận Com T1 - Năm 5",
  fmt_month(d."Tháng nhận Com T4 - Năm 5") as "Tháng nhận Com T4 - Năm 5",
  fmt_pct(d."% Active T1 - Năm 2") as "% Active T1 - Năm 2",
  fmt_pct(d."% Output T1 - Năm 2") as "% Output T1 - Năm 2",
  fmt_num(d."Điểm U (T1) - Năm 2") as "Điểm U (T1) - Năm 2",
  fmt_num(d."Điểm O (T1) - Năm 2") as "Điểm O (T1) - Năm 2",
  fmt_num1(d."CHS_CS T1 - Năm 2") as "CHS_CS T1 - Năm 2",
  fmt_money(d."ACR đủ đk COM T1 - Năm 2") as "ACR đủ đk COM T1 - Năm 2",
  fmt_pct(d."% Active T4 - Năm 2") as "% Active T4 - Năm 2",
  fmt_pct(d."% Output T4 - Năm 2") as "% Output T4 - Năm 2",
  fmt_num(d."Điểm U (T4) - Năm 2") as "Điểm U (T4) - Năm 2",
  fmt_num(d."Điểm O (T4) - Năm 2") as "Điểm O (T4) - Năm 2",
  fmt_num1(d."CHS_CS T4 - Năm 2") as "CHS_CS T4 - Năm 2",
  fmt_money(d."ACR đủ đk COM T4 - Năm 2") as "ACR đủ đk COM T4 - Năm 2",
  fmt_pct(d."% Active T1 - Năm 3") as "% Active T1 - Năm 3",
  fmt_pct(d."% Output T1 - Năm 3") as "% Output T1 - Năm 3",
  fmt_num(d."Điểm U (T1) - Năm 3") as "Điểm U (T1) - Năm 3",
  fmt_num(d."Điểm O (T1) - Năm 3") as "Điểm O (T1) - Năm 3",
  fmt_num1(d."CHS_CS T1 - Năm 3") as "CHS_CS T1 - Năm 3",
  fmt_money(d."ACR đủ đk COM T1 - Năm 3") as "ACR đủ đk COM T1 - Năm 3",
  fmt_pct(d."% Active T4 - Năm 3") as "% Active T4 - Năm 3",
  fmt_pct(d."% Output T4 - Năm 3") as "% Output T4 - Năm 3",
  fmt_num(d."Điểm U (T4) - Năm 3") as "Điểm U (T4) - Năm 3",
  fmt_num(d."Điểm O (T4) - Năm 3") as "Điểm O (T4) - Năm 3",
  fmt_num1(d."CHS_CS T4 - Năm 3") as "CHS_CS T4 - Năm 3",
  fmt_money(d."ACR đủ đk COM T4 - Năm 3") as "ACR đủ đk COM T4 - Năm 3",
  fmt_pct(d."% Active T1 - Năm 4") as "% Active T1 - Năm 4",
  fmt_pct(d."% Output T1 - Năm 4") as "% Output T1 - Năm 4",
  fmt_num(d."Điểm U (T1) - Năm 4") as "Điểm U (T1) - Năm 4",
  fmt_num(d."Điểm O (T1) - Năm 4") as "Điểm O (T1) - Năm 4",
  fmt_num1(d."CHS_CS T1 - Năm 4") as "CHS_CS T1 - Năm 4",
  fmt_money(d."ACR đủ đk COM T1 - Năm 4") as "ACR đủ đk COM T1 - Năm 4",
  fmt_pct(d."% Active T4 - Năm 4") as "% Active T4 - Năm 4",
  fmt_pct(d."% Output T4 - Năm 4") as "% Output T4 - Năm 4",
  fmt_num(d."Điểm U (T4) - Năm 4") as "Điểm U (T4) - Năm 4",
  fmt_num(d."Điểm O (T4) - Năm 4") as "Điểm O (T4) - Năm 4",
  fmt_num1(d."CHS_CS T4 - Năm 4") as "CHS_CS T4 - Năm 4",
  fmt_money(d."ACR đủ đk COM T4 - Năm 4") as "ACR đủ đk COM T4 - Năm 4",
  fmt_pct(d."% Active T1 - Năm 5") as "% Active T1 - Năm 5",
  fmt_pct(d."% Output T1 - Năm 5") as "% Output T1 - Năm 5",
  fmt_num(d."Điểm U (T1) - Năm 5") as "Điểm U (T1) - Năm 5",
  fmt_num(d."Điểm O (T1) - Năm 5") as "Điểm O (T1) - Năm 5",
  fmt_num1(d."CHS_CS T1 - Năm 5") as "CHS_CS T1 - Năm 5",
  fmt_money(d."ACR đủ đk COM T1 - Năm 5") as "ACR đủ đk COM T1 - Năm 5",
  fmt_pct(d."% Active T4 - Năm 5") as "% Active T4 - Năm 5",
  fmt_pct(d."% Output T4 - Năm 5") as "% Output T4 - Năm 5",
  fmt_num(d."Điểm U (T4) - Năm 5") as "Điểm U (T4) - Năm 5",
  fmt_num(d."Điểm O (T4) - Năm 5") as "Điểm O (T4) - Năm 5",
  fmt_num1(d."CHS_CS T4 - Năm 5") as "CHS_CS T4 - Năm 5",
  fmt_money(d."ACR đủ đk COM T4 - Năm 5") as "ACR đủ đk COM T4 - Năm 5",
  coalesce(d."Nguồn go-live", '') as "Nguồn go-live",  -- 'Đã kéo' (CRM) / 'Forecast' (CS nhập)
  coalesce(d."U/O từ BigQuery", '') as "U/O từ BigQuery",       -- vd 'aT1,oT1' → UI khoá các ô này
  coalesce(d."Thiếu U/O BigQuery", '') as "Thiếu U/O BigQuery"  -- vd 'U T1, O T1' → UI tô đỏ
from v_database d;
revoke all on v_database_display from anon, authenticated;

-- Chủ deal (để kiểm tra quyền sửa) — giống cột "Email phụ trách" của sheet
create or replace view v_deal_owner with (security_invoker = true) as
select r.deal_id, lower(trim(m.email)) as email
from deals_raw r left join cs_members m on m.username = r.co_owner
where r.is_active;
revoke all on v_deal_owner from anon, authenticated;

-- ---------- Helper parse input (giữ đúng hành vi Apps Script) ----------
-- % từ frontend gửi 0–100: rỗng/null → xoá (null); số → /100; chữ không hợp lệ → giữ nguyên cũ
create or replace function pct_in(v jsonb, cur numeric) returns numeric immutable language sql as $$
  select case
    when v is null or jsonb_typeof(v) = 'null' then null
    when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric / 100
    when jsonb_typeof(v) = 'string' and trim(v #>> '{}') = '' then null
    when jsonb_typeof(v) = 'string' and trim(v #>> '{}') ~ '^-?\d+(\.\d+)?$' then trim(v #>> '{}')::numeric / 100
    else cur end $$;

-- Ngày "dd/mm/yyyy": đúng định dạng → ngày; rỗng → xoá; sai → giữ nguyên cũ
create or replace function date_in(t text, cur date) returns date immutable language sql as $$
  select case
    when trim(coalesce(t, '')) = '' then null
    when trim(t) ~ '^\d{1,2}/\d{1,2}/\d{4}$' then to_date(trim(t), 'DD/MM/YYYY')
    else cur end $$;

-- ---------- ĐỌC ----------
create or replace function api_get_profile(p_email text) returns jsonb stable language sql as $$
  select jsonb_build_object(
           'username', coalesce(username, ''), 'email', lower(email),
           'hoTen', coalesce(ho_ten, ''), 'level', coalesce(level, ''),
           'salary', coalesce(salary::text, ''), 'avatar', coalesce(avatar_url, ''))
  from cs_members
  where lower(trim(email)) = lower(trim(p_email))
    and trim(coalesce(ho_ten, '')) <> '' and trim(coalesce(level, '')) <> ''
  limit 1 $$;

-- Deals của đúng email phụ trách (giống getDeals_). Dùng json (không phải jsonb)
-- để giữ đúng thứ tự cột = thứ tự key, vì app.js lấy cột khớp ĐẦU TIÊN.
create or replace function api_get_deals_json(p_email text) returns json stable language sql as $$
  select coalesce(json_agg(row_to_json(x)), '[]'::json)
  from v_database_display x
  where lower(trim(x."Email phụ trách")) = lower(trim(p_email))
    and x."Deal ID" <> '' $$;

-- ---------- GHI: 5 ô Năm 1 (thay saveRows_) ----------
create or replace function api_save_rows(p_email text, p_rows jsonb) returns int language plpgsql as $$
declare
  r jsonb; did bigint; cur deal_inputs%rowtype; n int := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if coalesce(r->>'dealId', '') !~ '^\s*\d+\s*$' then continue; end if;
    did := trim(r->>'dealId')::bigint;
    -- chỉ sửa deal của chính mình
    if not exists (select 1 from v_deal_owner o where o.deal_id = did and o.email = lower(trim(p_email))) then
      continue;
    end if;
    insert into deal_inputs (deal_id) values (did) on conflict (deal_id) do nothing;
    select * into cur from deal_inputs where deal_id = did for update;
    update deal_inputs set
      go_live_actual = date_in(r->>'goLive', cur.go_live_actual),
      active_t1 = pct_in(r->'aT1', cur.active_t1),
      output_t1 = pct_in(r->'oT1', cur.output_t1),
      active_t4 = pct_in(r->'aT4', cur.active_t4),
      output_t4 = pct_in(r->'oT4', cur.output_t4),
      updated_by = lower(p_email), updated_at = now()
    where deal_id = did;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- GHI: Năm 2–5 (thay saveMultiYearRows_) ----------
create or replace function api_save_multiyear(p_email text, p_rows jsonb) returns int language plpgsql as $$
declare
  r jsonb; did bigint; yr int; per text; cur deal_multiyear_inputs%rowtype; n int := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if coalesce(r->>'dealId', '') !~ '^\s*\d+\s*$' then continue; end if;
    did := trim(r->>'dealId')::bigint;
    if not exists (select 1 from v_deal_owner o where o.deal_id = did and o.email = lower(trim(p_email))) then
      continue;
    end if;
    if coalesce(r->>'year', '') !~ '^\s*\d+\s*$' then continue; end if;
    yr := trim(r->>'year')::int;
    if yr < 2 or yr > 5 then continue; end if;
    per := case when upper(coalesce(r->>'period', '')) = 'T4' then 'T4' else 'T1' end;
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
end $$;

-- ---------- GHI: Gia hạn / Dừng triển khai (thay saveRequest_) ----------
create or replace function api_save_request(p_email text, p_deal_id text, p_type text,
                                            p_gl_extend text, p_link text, p_remove boolean)
returns void language plpgsql as $$
declare did bigint; gl text := trim(coalesce(p_gl_extend, ''));
begin
  if coalesce(p_deal_id, '') !~ '^\s*\d+\s*$'
     or not exists (select 1 from v_deal_owner where deal_id = trim(p_deal_id)::bigint) then
    raise exception 'Không tìm thấy deal % trong Database', p_deal_id;
  end if;
  did := trim(p_deal_id)::bigint;
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
end $$;

-- ---------- GHI: Đăng ký / cập nhật thông tin CS (thay registerProfile_) ----------
create or replace function api_register(p_email text, p_ho_ten text, p_level text,
                                        p_salary text, p_avatar text)
returns jsonb language plpgsql as $$
declare
  em text := lower(trim(p_email));
  uname text := replace(split_part(lower(trim(p_email)), '@', 1), '.', '');
  sal bigint := case when trim(coalesce(p_salary, '')) ~ '^\d+(\.\d+)?$'
                     then round(trim(p_salary)::numeric) end;
begin
  if exists (select 1 from cs_members where lower(trim(email)) = em) then
    update cs_members set ho_ten = p_ho_ten, level = p_level, salary = sal,
                          avatar_url = coalesce(p_avatar, '')
    where lower(trim(email)) = em;
  else
    -- Username đã thuộc email KHÁC (vd an.nguyen vs annguyen) → không ghi đè,
    -- nếu không người đăng ký sau sẽ "chiếm" luôn các deal của người kia.
    if exists (select 1 from cs_members where username = uname) then
      raise exception 'Username % đã thuộc email khác — liên hệ admin để thêm thủ công', uname;
    end if;
    insert into cs_members (username, email, ho_ten, level, salary, avatar_url)
    values (uname, em, p_ho_ten, p_level, sal, coalesce(p_avatar, ''));
  end if;
  select username into uname from cs_members where lower(trim(email)) = em limit 1;
  return jsonb_build_object('username', uname, 'email', em, 'hoTen', p_ho_ten,
                            'level', p_level, 'salary', p_salary, 'avatar', coalesce(p_avatar, ''));
end $$;

-- ---------- Product Feedback ----------
create or replace function api_submit_feedback(p_id text, p_email text, p_name text, p_title text,
                                               p_category text, p_description text,
                                               p_attachments jsonb, p_expected text)
returns void language sql as $$
  insert into product_feedback (id, submitted_at, sender_email, sender_name, title, type,
                                description, attachments, expected_date, status, team_reply)
  values (p_id, now(), lower(p_email), coalesce(p_name, ''), trim(coalesce(p_title, '')),
          trim(coalesce(p_category, '')), trim(coalesce(p_description, '')),
          coalesce(p_attachments, '[]'::jsonb),
          case when trim(coalesce(p_expected, '')) ~ '^\d{4}-\d{2}-\d{2}$'
               then trim(p_expected)::date end,
          'Received', '') $$;

create or replace function api_list_feedback(p_email text) returns json stable language sql as $$
  select coalesce(json_agg(json_build_object(
           'id', id,
           'ts', coalesce(to_char(submitted_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI'), ''),
           'title', coalesce(title, ''), 'category', coalesce(type, ''),
           'description', coalesce(description, ''),
           'attachments', coalesce(attachments, '[]'::jsonb),
           'expected', fmt_date(expected_date),
           'status', coalesce(status, ''), 'response', coalesce(team_reply, ''))
         order by submitted_at desc nulls last, id desc), '[]'::json)
  from product_feedback
  where lower(trim(sender_email)) = lower(trim(p_email)) $$;

-- ---------- Lịch sử thay đổi (tự ghi mỗi lần sửa) ----------
create or replace function log_input_change() returns trigger language plpgsql as $$
declare k text; o jsonb; nw jsonb;
begin
  o := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  nw := to_jsonb(new);
  for k in select jsonb_object_keys(nw) loop
    if k in ('updated_at', 'updated_by', 'deal_id', 'year', 'period') then continue; end if;
    if (o -> k) is distinct from (nw -> k) and not (tg_op = 'INSERT' and jsonb_typeof(nw -> k) = 'null') then
      insert into deal_input_history (deal_id, field, old_value, new_value, changed_by)
      values (new.deal_id,
              case when tg_table_name = 'deal_multiyear_inputs'
                   then k || ' ' || (nw ->> 'period') || ' - Năm ' || (nw ->> 'year') else k end,
              o ->> k, nw ->> k, new.updated_by);
    end if;
  end loop;
  return new;
end $$;

create or replace trigger trg_log_deal_inputs after insert or update on deal_inputs
  for each row execute function log_input_change();
create or replace trigger trg_log_multiyear after insert or update on deal_multiyear_inputs
  for each row execute function log_input_change();

-- ---------- Chỉ service_role (Edge Function) được gọi các hàm api_* ----------
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'api\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;

-- ---------- Cố định search_path cho mọi hàm trong file này ----------
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and (p.proname like 'api\_%' or p.proname like 'fmt\_%'
                  or p.proname in ('pct_in', 'date_in', 'log_input_change')) loop
    execute format('alter function %s set search_path = public', f);
  end loop;
end $$;

-- ---------- Storage bucket cho file đính kèm Product Feedback (chỉ có trên Supabase) ----------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('feedback', 'feedback', true)
    on conflict (id) do nothing;
  end if;
end $$;
