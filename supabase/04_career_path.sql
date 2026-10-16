-- =====================================================================
-- FORECAST TOOL — CAREER PATH THEO QUÝ
-- Chạy SAU 03_admin_mcp.sql. Chạy lại nhiều lần vẫn an toàn.
--
--  • career_commits         : mỗi CS 1 dòng / quý — level mục tiêu + commit CR, SRR_1, SRR_4 (%)
--  • career_commit_history  : mọi lần chốt/sửa commit (dòng đầu tiên = bản chốt đầu quý)
--  • level_history          : lịch sử đổi level + lương (lên level qua Career path)
--  • api_career_*           : Edge Function "api" gọi. Quy tắc nghiệp vụ (cửa sổ thời gian,
--                             mốc sàn theo level, tính số thực tế quý, điều kiện bấm Đạt)
--                             kiểm tra ở Edge Function; SQL giữ toàn vẹn dữ liệu (khoá dòng,
--                             không sửa quý đã đạt, đổi level + lương cùng 1 transaction).
--  • api_register (ghi đè)  : CS đã có level thì KHÔNG tự đổi level qua popup hồ sơ nữa —
--                             level chỉ đổi qua Career path hoặc do admin.
-- =====================================================================

create table if not exists career_commits (
  id                 bigserial primary key,
  email              text not null,
  quarter            text not null check (quarter ~ '^Q[1-4]/\d{4}$'),   -- vd 'Q4/2026'
  base_level         text not null,              -- level lúc chốt/sửa commit gần nhất
  target_level       text not null,              -- = base_level nếu giữ level
  cr                 numeric not null check (cr > 0 and cr <= 100),   -- % 0–100
  s1                 numeric not null check (s1 > 0 and s1 <= 100),
  s4                 numeric check (s4 > 0 and s4 <= 100),            -- null = không commit SRR_4 (chỉ khi tạo bù)
  status             text not null default 'open' check (status in ('open', 'achieved')),
  achieved_at        timestamptz,
  achieved_snapshot  jsonb,                      -- số thực tế + % loading lúc bấm Đạt
  new_salary         bigint,                     -- lương CS nhập khi lên level
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (email, quarter)
);

create table if not exists career_commit_history (
  id            bigserial primary key,
  commit_id     bigint not null references career_commits(id) on delete cascade,
  base_level    text,
  target_level  text,
  cr            numeric,
  s1            numeric,
  s4            numeric,
  changed_at    timestamptz not null default now()
);
create index if not exists career_commit_history_commit_idx on career_commit_history (commit_id);

create table if not exists level_history (
  id          bigserial primary key,
  email       text not null,
  old_level   text,
  new_level   text,
  old_salary  bigint,
  new_salary  bigint,
  reason      text,             -- vd 'Career path Q4/2026'
  quarter     text,
  changed_by  text,
  changed_at  timestamptz not null default now()
);
create index if not exists level_history_email_idx on level_history (lower(email));

-- Bản đầu tạo s4 NOT NULL → nới cho DB đã chạy file này (tạo bù Q3 có thể không commit SRR_4)
alter table career_commits alter column s4 drop not null;

alter table career_commits        enable row level security;
alter table career_commit_history enable row level security;
alter table level_history         enable row level security;

create or replace function vn_ts(t timestamptz) returns text stable language sql as $$
  select coalesce(to_char(t at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI'), '') $$;

-- ---------- ĐỌC: toàn bộ commit + lịch sử level của 1 CS ----------
create or replace function api_career_list(p_email text) returns json stable language sql as $$
  select json_build_object(
    'commits', coalesce((
      select json_agg(json_build_object(
        'quarter', c.quarter, 'baseLevel', c.base_level, 'targetLevel', c.target_level,
        'cr', c.cr, 's1', c.s1, 's4', c.s4, 'status', c.status,
        'achievedAt', vn_ts(c.achieved_at), 'snapshot', c.achieved_snapshot,
        'newSalary', c.new_salary, 'createdAt', vn_ts(c.created_at), 'updatedAt', vn_ts(c.updated_at),
        'history', coalesce((
          select json_agg(json_build_object(
            'baseLevel', h.base_level, 'targetLevel', h.target_level,
            'cr', h.cr, 's1', h.s1, 's4', h.s4, 'at', vn_ts(h.changed_at)) order by h.changed_at, h.id)
          from career_commit_history h where h.commit_id = c.id), '[]'::json))
        order by split_part(c.quarter, '/', 2) desc, c.quarter desc)
      from career_commits c where lower(c.email) = lower(trim(p_email))), '[]'::json),
    'levelHistory', coalesce((
      select json_agg(json_build_object(
        'oldLevel', l.old_level, 'newLevel', l.new_level,
        'oldSalary', l.old_salary, 'newSalary', l.new_salary,
        'reason', l.reason, 'quarter', l.quarter, 'at', vn_ts(l.changed_at)) order by l.changed_at desc, l.id desc)
      from level_history l where lower(l.email) = lower(trim(p_email))), '[]'::json)) $$;

-- ---------- GHI: chốt / sửa commit quý (Edge Function đã kiểm tra cửa sổ + mốc sàn) ----------
create or replace function api_career_save_commit(p_email text, p_quarter text, p_base_level text,
                                                  p_target_level text, p_cr numeric, p_s1 numeric, p_s4 numeric)
returns json language plpgsql as $$
declare em text := lower(trim(p_email)); c career_commits%rowtype;
begin
  select * into c from career_commits where email = em and quarter = p_quarter for update;
  if found and c.status = 'achieved' then
    raise exception 'Quý % đã bấm Đạt — không sửa commit được nữa', p_quarter;
  end if;
  if found and c.base_level = p_base_level and c.target_level = p_target_level
     and c.cr = p_cr and c.s1 = p_s1 and c.s4 is not distinct from p_s4 then
    return api_career_list(em);   -- không đổi gì → không ghi thêm lịch sử
  end if;
  insert into career_commits (email, quarter, base_level, target_level, cr, s1, s4)
  values (em, p_quarter, p_base_level, p_target_level, p_cr, p_s1, p_s4)
  on conflict (email, quarter) do update set
    base_level = excluded.base_level, target_level = excluded.target_level,
    cr = excluded.cr, s1 = excluded.s1, s4 = excluded.s4, updated_at = now()
  returning * into c;
  insert into career_commit_history (commit_id, base_level, target_level, cr, s1, s4)
  values (c.id, c.base_level, c.target_level, c.cr, c.s1, c.s4);
  return api_career_list(em);
end $$;

-- ---------- GHI: bấm Đạt — hoàn tất quý; lên level thì đổi level + lương cùng transaction ----------
-- p_new_level null = giữ level (chỉ đánh dấu đạt).
create or replace function api_career_achieve(p_email text, p_quarter text, p_new_level text,
                                              p_new_salary bigint, p_snapshot jsonb)
returns json language plpgsql as $$
declare em text := lower(trim(p_email)); c career_commits%rowtype; m cs_members%rowtype;
begin
  select * into c from career_commits where email = em and quarter = p_quarter for update;
  if not found then raise exception 'Chưa có commit cho quý %', p_quarter; end if;
  if c.status = 'achieved' then raise exception 'Quý % đã bấm Đạt rồi', p_quarter; end if;

  update career_commits set status = 'achieved', achieved_at = now(), achieved_snapshot = p_snapshot,
         new_salary = case when p_new_level is null then null else p_new_salary end, updated_at = now()
  where id = c.id;

  if p_new_level is not null then
    select * into m from cs_members where lower(trim(email)) = em for update;
    if not found then raise exception 'Không tìm thấy hồ sơ CS của %', em; end if;
    update cs_members set level = p_new_level, salary = p_new_salary where username = m.username;
    insert into level_history (email, old_level, new_level, old_salary, new_salary, reason, quarter, changed_by)
    values (em, m.level, p_new_level, m.salary, p_new_salary, 'Career path ' || p_quarter, p_quarter, em);
  end if;
  return api_career_list(em);
end $$;

-- ---------- Ghi đè api_register (02_api.sql): khoá tự đổi level ----------
-- Đăng ký lần đầu (chưa có dòng / chưa có level) vẫn chọn level như cũ.
create or replace function api_register(p_email text, p_ho_ten text, p_level text,
                                        p_salary text, p_avatar text)
returns jsonb language plpgsql as $$
declare
  em text := lower(trim(p_email));
  uname text := replace(split_part(lower(trim(p_email)), '@', 1), '.', '');
  sal bigint := case when trim(coalesce(p_salary, '')) ~ '^\d+(\.\d+)?$'
                     then round(trim(p_salary)::numeric) end;
  cur_level text;
begin
  if exists (select 1 from cs_members where lower(trim(email)) = em) then
    select level into cur_level from cs_members where lower(trim(email)) = em limit 1;
    if trim(coalesce(cur_level, '')) <> '' and trim(cur_level) <> trim(coalesce(p_level, '')) then
      raise exception 'Level chỉ đổi qua Career path (bấm Đạt cuối quý) hoặc nhờ admin cập nhật';
    end if;
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

-- ---------- Chỉ service_role (Edge Function) được gọi — giống cuối 03_admin_mcp.sql ----------
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'api\_career\_%' or p.proname in ('api_register', 'vn_ts')) loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
    execute format('alter function %s set search_path = public', f);
  end loop;
end $$;
