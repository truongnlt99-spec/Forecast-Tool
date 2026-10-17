-- =====================================================================
-- 08 — MAIL BÁO NGƯỜI GỬI KHI FEEDBACK HOÀN THÀNH (17/10/2026)
-- Apps Script "Dong bo Supabase" (hàm guiMailFeedback, chạy mỗi 5 phút) lấy các feedback vừa chuyển
-- sang trạng thái cần báo (mặc định Completed) mà chưa gửi mail → gửi bằng Gmail của người chạy
-- script → đánh dấu đã gửi. Không cần Resend / tên miền.
--  • mail_sent_at: lúc đã gửi mail cho trạng thái hiện tại. Đổi trạng thái (Completed → In Progress
--    → Completed…) thì trigger xoá mốc này để lần hoàn thành sau lại được báo.
--  • Feedback đã Completed TRƯỚC khi chạy file này được coi như đã báo (không gửi bù mail cũ).
-- Chạy lại nhiều lần vẫn an toàn. Không có DELETE/DROP.
-- =====================================================================
-- Lần đầu thêm cột: feedback đã Completed / Won't Do coi như đã báo (không gửi bù mail cũ)
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'product_feedback' and column_name = 'mail_sent_at') then
    alter table product_feedback add column mail_sent_at timestamptz;
    update product_feedback set mail_sent_at = now() where status in ('Completed', 'Won''t Do');
  end if;
end $$;

create or replace function fb_mail_reset() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then new.mail_sent_at := null; end if;
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_fb_mail_reset') then
    create trigger trg_fb_mail_reset before update on product_feedback
      for each row execute function fb_mail_reset();
  end if;
end $$;

-- Feedback cần gửi mail: trạng thái thuộc p_statuses, chưa gửi, có email người gửi
create or replace function mail_fb_pending(p_statuses text[]) returns json stable language sql as $$
  select coalesce(json_agg(json_build_object(
           'id', id, 'email', sender_email, 'name', coalesce(sender_name, ''), 'title', coalesce(title, ''),
           'status', status, 'reply', coalesce(team_reply, ''),
           'submittedAt', coalesce(to_char(submitted_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY'), ''))
         order by submitted_at), '[]'::json)
  from product_feedback
  where status = any(p_statuses) and mail_sent_at is null
    and coalesce(sender_email, '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' $$;

-- Đánh dấu đã gửi — chỉ khi trạng thái vẫn đúng như lúc lấy (tránh đánh dấu nhầm nếu vừa bị đổi)
create or replace function mail_fb_mark_sent(p_id text, p_status text) returns boolean language sql as $$
  update product_feedback set mail_sent_at = now()
  where id = p_id and status = p_status and mail_sent_at is null
  returning true $$;

-- Chỉ service_role (Apps Script cầm service key) được gọi
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('mail_fb_pending', 'mail_fb_mark_sent') loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
    execute format('alter function %s set search_path = public', f);
  end loop;
end $$;
