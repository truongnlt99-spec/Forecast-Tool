-- =====================================================================
-- FORECAST TOOL — QUẢN TRỊ (feedback / todo / danh sách CS) + KẾT NỐI CLAUDE (MCP)
-- Chạy SAU 02_api.sql. Chạy lại nhiều lần vẫn an toàn.
--
--  • app_admins     : email được dùng tính năng quản trị (hiện chỉ truong.nguyen@base.vn)
--  • mcp_keys       : link kết nối Claude cá nhân — chỉ lưu SHA-256 của khoá, khoá gốc
--                     chỉ hiện 1 lần lúc tạo. Mỗi khoá gắn đúng 1 email → MCP chỉ thấy dữ liệu
--                     và quyền của email đó (admin thấy thêm tool quản trị).
--  • api_admin_*    : hàm chỉ admin gọi được (kiểm tra email trong app_admins)
--  • api_patch_deal_input : sửa từng ô Năm 1 (chỉ ô được gửi), dùng cho MCP; tôn trọng khoá
--                     "Đã kéo" (go-live CRM) và ô U/O lấy từ BigQuery như giao diện web.
-- =====================================================================

create table if not exists app_admins (
  email text primary key
);
insert into app_admins (email) values ('truong.nguyen@base.vn') on conflict do nothing;

create table if not exists mcp_keys (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  key_hash      text not null unique,        -- sha256 hex của khoá
  label         text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
create index if not exists mcp_keys_email_idx on mcp_keys (lower(email));

alter table todolist add column if not exists created_at timestamptz not null default now();
alter table todolist add column if not exists updated_at timestamptz;
alter table todolist add column if not exists updated_by text;
alter table todolist add column if not exists deleted_at timestamptz;   -- xoá mềm
alter table product_feedback add column if not exists replied_at timestamptz;
alter table product_feedback add column if not exists replied_by text;

alter table app_admins enable row level security;
alter table mcp_keys   enable row level security;

-- ---------- Quyền ----------
create or replace function api_is_admin(p_email text) returns boolean stable language sql as $$
  select exists (select 1 from app_admins where lower(email) = lower(trim(coalesce(p_email, '')))) $$;

create or replace function admin_check(p_email text) returns void stable language plpgsql as $$
begin
  if not api_is_admin(p_email) then
    raise exception 'Chỉ admin mới dùng được tính năng này';
  end if;
end $$;

-- ---------- Feedback (admin) ----------
create or replace function api_admin_list_feedback(p_email text, p_status text default null)
returns json stable language plpgsql as $$
begin
  perform admin_check(p_email);
  return (
    select coalesce(json_agg(json_build_object(
             'id', id,
             'ts', coalesce(to_char(submitted_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI'), ''),
             'senderEmail', coalesce(sender_email, ''), 'senderName', coalesce(sender_name, ''),
             'title', coalesce(title, ''), 'category', coalesce(type, ''),
             'description', coalesce(description, ''),
             'attachments', coalesce(attachments, '[]'::jsonb),
             'expected', fmt_date(expected_date),
             'status', coalesce(status, ''), 'response', coalesce(team_reply, ''),
             'repliedAt', coalesce(to_char(replied_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI'), ''))
           order by submitted_at desc nulls last, id desc), '[]'::json)
    from product_feedback
    where nullif(trim(coalesce(p_status, '')), '') is null or status = trim(p_status));
end $$;

-- p_status / p_reply = null → giữ nguyên ô đó
create or replace function api_admin_update_feedback(p_email text, p_id text, p_status text, p_reply text)
returns json language plpgsql as $$
declare r product_feedback%rowtype;
begin
  perform admin_check(p_email);
  if p_status is not null and p_status not in ('Received', 'In Progress', 'Won''t Do', 'Completed') then
    raise exception 'Trạng thái phải là Received / In Progress / Won''t Do / Completed';
  end if;
  update product_feedback set
    status     = coalesce(p_status, status),
    team_reply = coalesce(p_reply, team_reply),
    replied_at = case when p_reply is not null and p_reply is distinct from team_reply then now() else replied_at end,
    replied_by = case when p_reply is not null and p_reply is distinct from team_reply then lower(p_email) else replied_by end
  where id = p_id
  returning * into r;
  if not found then raise exception 'Không tìm thấy feedback %', p_id; end if;
  return json_build_object('id', r.id, 'title', r.title, 'senderEmail', r.sender_email,
                           'senderName', r.sender_name, 'status', r.status, 'response', coalesce(r.team_reply, ''));
end $$;

-- ---------- Todo (admin) ----------
create or replace function api_admin_list_todo(p_email text) returns json stable language plpgsql as $$
begin
  perform admin_check(p_email);
  return (
    select coalesce(json_agg(json_build_object(
             'id', id, 'stt', stt, 'noiDung', coalesce(noi_dung, ''), 'note', coalesce(note, ''),
             'dauMoi', coalesce(dau_moi, ''), 'done', done,
             'updatedAt', coalesce(to_char(coalesce(updated_at, created_at) at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI'), ''))
           order by done, stt nulls last, id), '[]'::json)
    from todolist where deleted_at is null);
end $$;

-- p_item: {id?, noiDung?, note?, dauMoi?, done?, stt?} — có id → sửa các khoá được gửi; không có → thêm mới
create or replace function api_admin_save_todo(p_email text, p_item jsonb) returns json language plpgsql as $$
declare t todolist%rowtype; tid int;
begin
  perform admin_check(p_email);
  if coalesce(p_item->>'id', '') ~ '^\d+$' then
    tid := (p_item->>'id')::int;
    update todolist set
      noi_dung = case when p_item ? 'noiDung' then trim(p_item->>'noiDung') else noi_dung end,
      note     = case when p_item ? 'note'    then trim(coalesce(p_item->>'note', '')) else note end,
      dau_moi  = case when p_item ? 'dauMoi'  then trim(coalesce(p_item->>'dauMoi', '')) else dau_moi end,
      done     = case when p_item ? 'done'    then coalesce((p_item->>'done')::boolean, false) else done end,
      stt      = case when p_item ? 'stt' and (p_item->>'stt') ~ '^\d+$' then (p_item->>'stt')::int else stt end,
      updated_at = now(), updated_by = lower(p_email)
    where id = tid and deleted_at is null returning * into t;
    if not found then raise exception 'Không tìm thấy việc #%', tid; end if;
  else
    if trim(coalesce(p_item->>'noiDung', '')) = '' then raise exception 'Cần nhập nội dung công việc'; end if;
    insert into todolist (stt, noi_dung, note, dau_moi, done, updated_at, updated_by)
    values ((select coalesce(max(stt), 0) + 1 from todolist where deleted_at is null), trim(p_item->>'noiDung'),
            trim(coalesce(p_item->>'note', '')), trim(coalesce(p_item->>'dauMoi', '')),
            coalesce((p_item->>'done')::boolean, false), now(), lower(p_email))
    returning * into t;
  end if;
  return json_build_object('id', t.id, 'stt', t.stt, 'noiDung', t.noi_dung, 'note', coalesce(t.note, ''),
                           'dauMoi', coalesce(t.dau_moi, ''), 'done', t.done);
end $$;

create or replace function api_admin_delete_todo(p_email text, p_id int) returns void language plpgsql as $$
begin
  perform admin_check(p_email);
  update todolist set deleted_at = now(), updated_at = now(), updated_by = lower(p_email)
  where id = p_id and deleted_at is null;
  if not found then raise exception 'Không tìm thấy việc #%', p_id; end if;
end $$;

-- ---------- Danh sách CS (admin) — kèm số deal đang phụ trách trên console ----------
create or replace function api_admin_list_cs(p_email text) returns json stable language plpgsql as $$
begin
  perform admin_check(p_email);
  return (
    with d as (
      select lower(trim("Email phụ trách")) as email,
             count(*) as so_deal,
             count(*) filter (where "Ngày go-live thực tế" is null) as chua_golive,
             count(*) filter (where "Thiếu U/O BigQuery" is not null) as thieu_uo
      from v_database group by 1
    )
    select coalesce(json_agg(json_build_object(
             'username', m.username, 'email', lower(m.email), 'hoTen', coalesce(m.ho_ten, ''),
             'level', coalesce(m.level, ''), 'salary', m.salary,
             'avatar', coalesce(m.avatar_url, ''),
             'daDangKy', trim(coalesce(m.ho_ten, '')) <> '' and trim(coalesce(m.level, '')) <> '',
             'soDeal', coalesce(d.so_deal, 0), 'chuaGoLive', coalesce(d.chua_golive, 0),
             'thieuUO', coalesce(d.thieu_uo, 0),
             'isAdmin', api_is_admin(m.email),
             'mcpConnected', exists (select 1 from mcp_keys k where lower(k.email) = lower(m.email) and k.revoked_at is null))
           order by coalesce(d.so_deal, 0) desc, m.username), '[]'::json)
    from cs_members m left join d on d.email = lower(trim(m.email)));
end $$;

-- ---------- Khoá MCP (link kết nối Claude cá nhân) ----------
create or replace function api_mcp_create_key(p_email text, p_hash text, p_label text) returns json language plpgsql as $$
declare k mcp_keys%rowtype;
begin
  if (select count(*) from mcp_keys where lower(email) = lower(p_email) and revoked_at is null) >= 5 then
    raise exception 'Đã có 5 link đang dùng — thu hồi bớt link cũ trước khi tạo mới';
  end if;
  insert into mcp_keys (email, key_hash, label)
  values (lower(trim(p_email)), p_hash, nullif(trim(coalesce(p_label, '')), ''))
  returning * into k;
  return json_build_object('id', k.id, 'label', coalesce(k.label, ''),
                           'createdAt', to_char(k.created_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI'));
end $$;

create or replace function api_mcp_list_keys(p_email text) returns json stable language sql as $$
  select coalesce(json_agg(json_build_object(
           'id', id, 'label', coalesce(label, ''),
           'createdAt', to_char(created_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI'),
           'lastUsedAt', coalesce(to_char(last_used_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI'), ''))
         order by created_at desc), '[]'::json)
  from mcp_keys where lower(email) = lower(trim(p_email)) and revoked_at is null $$;

create or replace function api_mcp_revoke_key(p_email text, p_id uuid) returns void language plpgsql as $$
begin
  update mcp_keys set revoked_at = now()
  where id = p_id and lower(email) = lower(trim(p_email)) and revoked_at is null;
  if not found then raise exception 'Không tìm thấy link này'; end if;
end $$;

-- Khoá → email (null nếu sai/đã thu hồi). Ghi last_used_at tối đa 1 lần/phút.
create or replace function api_mcp_resolve(p_hash text) returns text language plpgsql as $$
declare em text;
begin
  update mcp_keys set last_used_at = now()
  where key_hash = p_hash and revoked_at is null
    and (last_used_at is null or last_used_at < now() - interval '1 minute');
  select email into em from mcp_keys where key_hash = p_hash and revoked_at is null;
  return em;
end $$;

-- ---------- Sửa từng ô Năm 1 (MCP) ----------
-- p_patch: {goLive?: 'dd/mm/yyyy' | '', aT1?, oT1?, aT4?, oT4?: số 0–100 | null}. Chỉ khoá được gửi mới đổi.
create or replace function api_patch_deal_input(p_email text, p_deal_id bigint, p_patch jsonb)
returns json language plpgsql as $$
declare r deals_raw%rowtype; cur deal_inputs%rowtype; locked text[] := '{}'; k text;
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
    if r.ty_le_su_dung_1_thang > 0 then locked := locked || 'aT1'::text; end if;
    if r.o1 is not null then locked := locked || 'oT1'::text; end if;
    if r.ty_le_su_dung_4_thang > 0 then locked := locked || 'aT4'::text; end if;
    if r.o4 is not null then locked := locked || 'oT4'::text; end if;
  end if;
  for k in select jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) loop
    if k not in ('goLive', 'aT1', 'oT1', 'aT4', 'oT4') then
      raise exception 'Ô "%" không sửa được (chỉ goLive, aT1, oT1, aT4, oT4)', k;
    end if;
    if k = any(locked) then
      raise exception 'Ô % của deal % đã lấy từ Base CRM/BigQuery — không sửa tay được', k, p_deal_id;
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
end $$;

-- ---------- Quyền + search_path cho các hàm mới ----------
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'api\_%' or p.proname = 'admin_check') loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
    execute format('alter function %s set search_path = public', f);
  end loop;
end $$;

-- =====================================================================
-- CLAUDE TỰ XỬ LÝ FEEDBACK MỖI SÁNG (16/10/2026) — xem docs/XU-LY-FEEDBACK.md
--  • product_feedback.ai_*: kết quả Claude xử lý (nội bộ, người gửi không thấy)
--  • todolist.feedback_id / nguon / pr_url: todo sinh từ feedback, không tạo trùng
--  • api_admin_get_deal / api_admin_find_deals: admin soi deal bất kỳ để kiểm tra feedback dữ liệu
-- =====================================================================
alter table product_feedback add column if not exists ai_status text;
alter table product_feedback add column if not exists ai_note text;
alter table product_feedback add column if not exists ai_checked_at timestamptz;
alter table product_feedback add column if not exists ai_todo_id int;
alter table product_feedback add column if not exists ai_pr_url text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'product_feedback_ai_status_chk') then
    alter table product_feedback add constraint product_feedback_ai_status_chk
      check (ai_status is null or ai_status in ('da_tra_loi','cho_duyet_pr','da_tao_todo','bo_qua'));
  end if;
end $$;
alter table todolist add column if not exists feedback_id text;
alter table todolist add column if not exists nguon text not null default 'manual';
alter table todolist add column if not exists pr_url text;

create or replace function fb_json(f product_feedback) returns json stable language sql as $$
  select json_build_object(
    'id', f.id,
    'ts', coalesce(to_char(f.submitted_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI'), ''),
    'senderEmail', coalesce(f.sender_email, ''), 'senderName', coalesce(f.sender_name, ''),
    'title', coalesce(f.title, ''), 'category', coalesce(f.type, ''),
    'description', coalesce(f.description, ''),
    'attachments', coalesce(f.attachments, '[]'::jsonb),
    'expected', fmt_date(f.expected_date),
    'status', coalesce(f.status, ''), 'response', coalesce(f.team_reply, ''),
    'repliedAt', coalesce(to_char(f.replied_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI'), ''),
    'aiStatus', coalesce(f.ai_status, ''), 'aiNote', coalesce(f.ai_note, ''),
    'aiCheckedAt', coalesce(to_char(f.ai_checked_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI'), ''),
    'aiTodoId', f.ai_todo_id, 'aiPrUrl', coalesce(f.ai_pr_url, '')) $$;

create or replace function api_admin_list_feedback(p_email text, p_status text default null)
returns json stable language plpgsql as $$
begin
  perform admin_check(p_email);
  return (select coalesce(json_agg(fb_json(f) order by f.submitted_at desc nulls last, f.id desc), '[]'::json)
          from product_feedback f
          where nullif(trim(coalesce(p_status, '')), '') is null or f.status = trim(p_status));
end $$;

-- Hàng chờ cho Claude: feedback còn mở (Received / In Progress) mà Claude chưa xử lý, cũ nhất trước
create or replace function api_admin_feedback_queue(p_email text) returns json stable language plpgsql as $$
begin
  perform admin_check(p_email);
  return (select coalesce(json_agg(fb_json(f) order by f.submitted_at nulls first, f.id), '[]'::json)
          from product_feedback f
          where f.ai_status is null and coalesce(f.status, 'Received') in ('Received', 'In Progress'));
end $$;

create or replace function api_admin_get_feedback(p_email text, p_id text) returns json stable language plpgsql as $$
declare r json;
begin
  perform admin_check(p_email);
  select fb_json(f) into r from product_feedback f where f.id = p_id;
  if r is null then raise exception 'Không tìm thấy feedback %', p_id; end if;
  return r;
end $$;

-- Ghi kết quả Claude xử lý 1 feedback (không đổi trạng thái/phản hồi người gửi thấy)
create or replace function api_admin_mark_feedback(p_email text, p_id text, p_ai_status text, p_note text,
                                                   p_todo_id int default null, p_pr_url text default null)
returns json language plpgsql as $$
declare r product_feedback%rowtype;
begin
  perform admin_check(p_email);
  if p_ai_status is not null and p_ai_status not in ('da_tra_loi', 'cho_duyet_pr', 'da_tao_todo', 'bo_qua') then
    raise exception 'ket_qua phải là da_tra_loi / cho_duyet_pr / da_tao_todo / bo_qua (hoặc null để đưa lại vào hàng chờ)';
  end if;
  update product_feedback set
    ai_status = p_ai_status,
    ai_note = case when p_ai_status is null then null else nullif(trim(coalesce(p_note, '')), '') end,
    ai_checked_at = case when p_ai_status is null then null else now() end,
    ai_todo_id = case when p_ai_status is null then null else coalesce(p_todo_id, ai_todo_id) end,
    ai_pr_url = case when p_ai_status is null then null else coalesce(nullif(trim(coalesce(p_pr_url, '')), ''), ai_pr_url) end
  where id = p_id returning * into r;
  if not found then raise exception 'Không tìm thấy feedback %', p_id; end if;
  return fb_json(r);
end $$;

create or replace function api_admin_list_todo(p_email text) returns json stable language plpgsql as $$
begin
  perform admin_check(p_email);
  return (
    select coalesce(json_agg(json_build_object(
             'id', id, 'stt', stt, 'noiDung', coalesce(noi_dung, ''), 'note', coalesce(note, ''),
             'dauMoi', coalesce(dau_moi, ''), 'done', done,
             'feedbackId', coalesce(feedback_id, ''), 'nguon', coalesce(nguon, 'manual'), 'prUrl', coalesce(pr_url, ''),
             'updatedAt', coalesce(to_char(coalesce(updated_at, created_at) at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI'), ''))
           order by done, stt nulls last, id), '[]'::json)
    from todolist where deleted_at is null);
end $$;

-- p_item: {id?, noiDung?, note?, dauMoi?, done?, stt?, feedbackId?, nguon?, prUrl?}
-- Thêm mới kèm feedbackId mà feedback đó đã có todo đang mở → cập nhật todo cũ (không tạo trùng)
create or replace function api_admin_save_todo(p_email text, p_item jsonb) returns json language plpgsql as $$
declare t todolist%rowtype; tid int;
begin
  perform admin_check(p_email);
  if coalesce(p_item->>'id', '') ~ '^\d+$' then
    tid := (p_item->>'id')::int;
  elsif nullif(trim(coalesce(p_item->>'feedbackId', '')), '') is not null then
    select id into tid from todolist
    where feedback_id = trim(p_item->>'feedbackId') and deleted_at is null and not done
    order by id desc limit 1;
  end if;

  if tid is not null then
    update todolist set
      noi_dung = case when p_item ? 'noiDung' then trim(p_item->>'noiDung') else noi_dung end,
      note     = case when p_item ? 'note'    then trim(coalesce(p_item->>'note', '')) else note end,
      dau_moi  = case when p_item ? 'dauMoi'  then trim(coalesce(p_item->>'dauMoi', '')) else dau_moi end,
      done     = case when p_item ? 'done'    then coalesce((p_item->>'done')::boolean, false) else done end,
      stt      = case when p_item ? 'stt' and (p_item->>'stt') ~ '^\d+$' then (p_item->>'stt')::int else stt end,
      feedback_id = case when p_item ? 'feedbackId' then nullif(trim(coalesce(p_item->>'feedbackId', '')), '') else feedback_id end,
      pr_url   = case when p_item ? 'prUrl'   then nullif(trim(coalesce(p_item->>'prUrl', '')), '') else pr_url end,
      updated_at = now(), updated_by = lower(p_email)
    where id = tid and deleted_at is null returning * into t;
    if not found then raise exception 'Không tìm thấy việc #%', tid; end if;
  else
    if trim(coalesce(p_item->>'noiDung', '')) = '' then raise exception 'Cần nhập nội dung công việc'; end if;
    insert into todolist (stt, noi_dung, note, dau_moi, done, feedback_id, nguon, pr_url, updated_at, updated_by)
    values ((select coalesce(max(stt), 0) + 1 from todolist where deleted_at is null), trim(p_item->>'noiDung'),
            trim(coalesce(p_item->>'note', '')), trim(coalesce(p_item->>'dauMoi', '')),
            coalesce((p_item->>'done')::boolean, false),
            nullif(trim(coalesce(p_item->>'feedbackId', '')), ''),
            coalesce(nullif(trim(coalesce(p_item->>'nguon', '')), ''), 'manual'),
            nullif(trim(coalesce(p_item->>'prUrl', '')), ''), now(), lower(p_email))
    returning * into t;
  end if;
  return json_build_object('id', t.id, 'stt', t.stt, 'noiDung', t.noi_dung, 'note', coalesce(t.note, ''),
                           'dauMoi', coalesce(t.dau_moi, ''), 'done', t.done, 'feedbackId', coalesce(t.feedback_id, ''),
                           'nguon', t.nguon, 'prUrl', coalesce(t.pr_url, ''));
end $$;

-- Admin xem 1 deal bất kỳ: dòng hiển thị trên console + số gốc BigQuery + số CS nhập + lịch sử sửa
create or replace function api_admin_get_deal(p_email text, p_deal_id bigint) returns json stable language plpgsql as $$
declare raw json;
begin
  perform admin_check(p_email);
  select row_to_json(r) into raw from deals_raw r where r.deal_id = p_deal_id;
  if raw is null then raise exception 'Không có deal % trong dữ liệu (deals_raw)', p_deal_id; end if;
  return json_build_object(
    'trenConsole', (select row_to_json(d) from v_database_display d where d."Deal ID" = p_deal_id::text),
    'lyDoKhongHien', case
       when not (raw->>'is_active')::boolean then 'Deal đã rớt khỏi query BigQuery (is_active = false)'
       when raw->>'co_che_com' = 'Chính sách cũ' then 'Cơ chế tính com = Chính sách cũ (bị loại khỏi console)'
       when not exists (select 1 from v_database_display d where d."Deal ID" = p_deal_id::text) then 'Không hiện trên console'
       end,
    'csPhuTrach', (select lower(email) from v_deal_owner o where o.deal_id = p_deal_id),
    'bigQueryGoc', raw,
    'csNhapNam1', (select row_to_json(i) from deal_inputs i where i.deal_id = p_deal_id),
    'csNhapNam2_5', (select coalesce(json_agg(row_to_json(m) order by m.year, m.period), '[]'::json)
                     from deal_multiyear_inputs m where m.deal_id = p_deal_id),
    'lichSuSua', (select coalesce(json_agg(json_build_object('luc', to_char(h.changed_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI'),
                        'o', h.field, 'cu', h.old_value, 'moi', h.new_value, 'boi', h.changed_by) order by h.changed_at desc), '[]'::json)
                  from (select * from deal_input_history where deal_id = p_deal_id order by changed_at desc limit 30) h));
end $$;

create or replace function api_admin_find_deals(p_email text, p_query text) returns json stable language plpgsql as $$
declare q text := lower(trim(coalesce(p_query, '')));
begin
  perform admin_check(p_email);
  if length(q) < 2 then raise exception 'Từ khoá tối thiểu 2 ký tự'; end if;
  return (select coalesce(json_agg(json_build_object('dealId', r.deal_id, 'ten', r.deal_name, 'congTy', r.ten_cong_ty,
            'systemId', r.system_id, 'cs', r.co_owner, 'stage', r.stage, 'ngayTao', fmt_date(r.ngay_tao_deal),
            'coCheCom', r.co_che_com, 'active', r.is_active)), '[]'::json)
          from (select * from deals_raw r
                where r.deal_id::text = q or r.system_id::text = q or r.job_id::text = q
                   or lower(r.deal_name) like '%' || q || '%' or lower(coalesce(r.ten_cong_ty, '')) like '%' || q || '%'
                order by r.ngay_tao_deal desc nulls last limit 30) r);
end $$;

do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'api\_%' or p.proname in ('admin_check', 'fb_json')) loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
    execute format('alter function %s set search_path = public', f);
  end loop;
end $$;
