-- =====================================================================
-- FORECAST TOOL — SCHEMA SUPABASE (bước 3 trong plan migration)
-- Cách chạy: Supabase Dashboard → SQL Editor → New query → dán TOÀN BỘ
-- file này → bấm "Run". Chạy lại nhiều lần vẫn an toàn (dùng IF NOT EXISTS
-- / CREATE OR REPLACE).
--
-- Rule đã chốt (15/10/2026):
--   • AA Tier 4  = Bộ giải pháp "Other"
--   • AE Tháng ghi nhận CR = đúng tháng của ngày (KHÔNG áp quy tắc ngày 10)
--   • AB TTGL & AC Ngày go-live dự kiến = lấy sẵn từ BigQuery
--     (TTGL_so_ngay, Ngay_go_live_du_kien)
--   • Năm 2–5: số 0 ghi sẵn coi là trống; Tier 4 → Điểm U để trống
-- =====================================================================

-- ---------------------------------------------------------------------
-- LỚP 1 — Dữ liệu gốc từ BigQuery (thay tab "Bigquery"/"Extract of Raw")
-- Đồng bộ bằng UPSERT theo deal_id → không bao giờ lệch dòng.
-- ---------------------------------------------------------------------
create table if not exists deals_raw (
  deal_id                    bigint primary key,
  job_id                     bigint,
  income_id                  text,
  id_hop_dong                bigint,
  stage                      text,
  deal_name                  text,
  ten_cong_ty                text,
  system_id                  bigint,
  system_crm_id              bigint,
  co_owner                   text,
  deal_value                 bigint,
  gia_tri_hop_dong_job       bigint,
  tong_deal_value_theo_job   bigint,
  check_deal_value           text,
  loai_hop_dong              text,
  bo_giai_phap               text,
  so_luong_user              int,
  tier                       text,
  ty_le_doi_chieu            text,
  co_che_com                 text,
  ngay_tao_deal              date,
  expected_close_day         date,
  ngay_bat_dau               date,
  ngay_ket_thuc              date,
  so_nam                     int,
  gthd_1_nam                 bigint,
  tong_gia_tri_sizing        bigint,
  so_bo_giai_phap            int,
  co_ps_pas                  text,
  so_ngay_co_ban             int,
  so_ngay_cong_them_bo       int,
  so_ngay_non_software       int,
  ttgl_so_ngay               int,
  ngay_xac_thuc              date,
  ngay_go_live_du_kien       date,
  custom_ngay_keo_danh_gia   date,
  ngay_danh_gia_1_thang      text,
  ty_le_su_dung_1_thang      numeric,
  ty_le_active_thang_1       numeric,
  u1 numeric, o1 numeric, chs_cs_t1 numeric,
  ket_qua_danh_gia_1_thang   text,
  ngay_danh_gia_2_thang      text,
  ty_le_su_dung_2_thang      numeric,
  ty_le_active_thang_2       numeric,
  u2 numeric, o2 numeric, chs_cs_t2 numeric,
  ket_qua_danh_gia_2_thang   text,
  ngay_danh_gia_3_thang      text,
  ty_le_su_dung_3_thang      numeric,
  ty_le_active_thang_3       numeric,
  u3 numeric, o3 numeric, chs_cs_t3 numeric,
  ket_qua_danh_gia_3_thang   text,
  ngay_danh_gia_4_thang      text,
  ty_le_su_dung_4_thang      numeric,
  ty_le_active_thang_4       numeric,
  u4 numeric, o4 numeric, chs_cs_t4 numeric,
  ket_qua_danh_gia_4_thang   text,
  -- quản lý đồng bộ
  is_active      boolean     not null default true,   -- deal rớt khỏi query → false (KHÔNG xoá)
  last_seen_at   timestamptz not null default now(),
  synced_at      timestamptz not null default now()
);
create index if not exists deals_raw_job_idx on deals_raw (job_id);

-- ---------------------------------------------------------------------
-- LỚP 2 — Dữ liệu CS nhập tay
-- ---------------------------------------------------------------------
-- Năm 1 (thay Database!M:T). % lưu dạng tỉ lệ: 0.5 = 50%.
create table if not exists deal_inputs (
  deal_id         bigint primary key references deals_raw(deal_id),
  go_live_actual  date,          -- M  Ngày go-live thực tế
  go_live_extend  date,          -- N  Ngày go-live gia hạn
  active_t1       numeric(7,4),  -- O  % Active T1
  output_t1       numeric(7,4),  -- P  % Output T1
  active_t4       numeric(7,4),  -- Q  % Active T4
  output_t4       numeric(7,4),  -- R  % Output T4
  stopped         boolean not null default false,  -- S  Dừng triển khai ("X")
  link_request    text,          -- T  Link request
  updated_by      text,
  updated_at      timestamptz not null default now()
);

-- Năm 2–5 (thay 16 cột nhập tay trong BE..CZ) — mỗi (deal, năm, kỳ) 1 dòng
create table if not exists deal_multiyear_inputs (
  deal_id     bigint   not null references deals_raw(deal_id),
  year        smallint not null check (year between 2 and 5),
  period      text     not null check (period in ('T1','T4')),
  active      numeric(7,4),
  output      numeric(7,4),
  updated_by  text,
  updated_at  timestamptz not null default now(),
  primary key (deal_id, year, period)
);

-- Lịch sử mọi lần sửa (sheet không có — để không bao giờ mất dữ liệu nữa)
create table if not exists deal_input_history (
  id          bigserial primary key,
  deal_id     bigint,
  field       text,
  old_value   text,
  new_value   text,
  changed_by  text,
  changed_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Các tab phụ
-- ---------------------------------------------------------------------
create table if not exists cs_members (            -- tab "Danh sách CS"
  username    text primary key,
  email       text unique not null,
  ho_ten      text,
  level       text,
  salary      bigint,
  avatar_url  text                                -- ảnh để ở Storage, không lưu base64
);

create table if not exists product_feedback (      -- tab "Product Feedback"
  id             text primary key,
  submitted_at   timestamptz,
  sender_email   text,
  sender_name    text,
  title          text,
  type           text,
  description    text,
  attachments    jsonb,
  expected_date  date,
  status         text not null default 'Received'
                 check (status in ('Received','In Progress','Won''t Do','Completed')),
  team_reply     text
);

create table if not exists todolist (              -- tab "Todolist"
  id        serial primary key,
  stt       int,
  noi_dung  text,
  note      text,
  dau_moi   text,
  done      boolean not null default false
);

-- Bật Row Level Security, KHÔNG tạo policy → chỉ backend (service_role) đọc/ghi
-- được; trình duyệt cầm anon key cũng không đọc được dữ liệu.
alter table deals_raw              enable row level security;
alter table deal_inputs            enable row level security;
alter table deal_multiyear_inputs  enable row level security;
alter table deal_input_history     enable row level security;
alter table cs_members             enable row level security;
alter table product_feedback       enable row level security;
alter table todolist               enable row level security;

-- ---------------------------------------------------------------------
-- LỚP 3 — Hàm dùng chung cho công thức
-- ---------------------------------------------------------------------
-- Hôm nay theo giờ Việt Nam (thay TODAY())
create or replace function vn_today() returns date stable language sql as $$
  select (now() at time zone 'Asia/Ho_Chi_Minh')::date $$;

-- Mốc tháng đo: ngày ≤10 → đầu tháng đó, >10 → đầu tháng sau (dùng cho AH)
create or replace function month_anchor(d date) returns date immutable language sql as $$
  select case when d is null then null
              when extract(day from d) <= 10 then date_trunc('month', d)::date
              else (date_trunc('month', d) + interval '1 month')::date end $$;

-- Điểm U theo Tier, a là tỉ lệ (0.5 = 50%). Tier 4 / không rõ → null
create or replace function u_point(tier int, a numeric) returns numeric immutable language sql as $$
  select case when a is null then null
    when tier = 1 then case when a > 0.6 then 100 when a > 0.3  then 60 when a > 0.1  then 40 else 0 end
    when tier = 2 then case when a > 0.5 then 100 when a > 0.3  then 80 when a > 0.1  then 50 else 0 end
    when tier = 3 then case when a > 0.3 then 100 when a > 0.15 then 80 when a > 0.05 then 40 else 0 end
    else null end $$;

-- CHS_CS: Tier 4 = Điểm O; Tier 1–3 = 0.7·U + 0.3·O (cần đủ cả Active & Output)
create or replace function chs(tier int, a numeric, o numeric) returns numeric immutable language sql as $$
  select case when o is null then null
              when tier = 4 then o * 100
              when a is null or u_point(tier, a) is null then null
              else 0.7 * u_point(tier, a) + 0.3 * o * 100 end $$;

-- ---------------------------------------------------------------------
-- VIEW TÍNH TOÁN — tương đương toàn bộ công thức tab Database (A → CZ)
-- ---------------------------------------------------------------------
create or replace view v_database as
with
my as (   -- xoay Năm 2–5 từ dòng thành cột
  select deal_id,
    max(active) filter (where year = 2 and period = 'T1') as a_t1_y2,
    max(output) filter (where year = 2 and period = 'T1') as o_t1_y2,
    max(active) filter (where year = 2 and period = 'T4') as a_t4_y2,
    max(output) filter (where year = 2 and period = 'T4') as o_t4_y2,
    max(active) filter (where year = 3 and period = 'T1') as a_t1_y3,
    max(output) filter (where year = 3 and period = 'T1') as o_t1_y3,
    max(active) filter (where year = 3 and period = 'T4') as a_t4_y3,
    max(output) filter (where year = 3 and period = 'T4') as o_t4_y3,
    max(active) filter (where year = 4 and period = 'T1') as a_t1_y4,
    max(output) filter (where year = 4 and period = 'T1') as o_t1_y4,
    max(active) filter (where year = 4 and period = 'T4') as a_t4_y4,
    max(output) filter (where year = 4 and period = 'T4') as o_t4_y4,
    max(active) filter (where year = 5 and period = 'T1') as a_t1_y5,
    max(output) filter (where year = 5 and period = 'T1') as o_t1_y5,
    max(active) filter (where year = 5 and period = 'T4') as a_t4_y5,
    max(output) filter (where year = 5 and period = 'T4') as o_t4_y5
  from deal_multiyear_inputs group by deal_id
),
s1 as (   -- A..L, M..T, U..W + X, Y (gộp theo Job)
  select
    r.*,
    r.job_id is not null                                         as has_job,
    m.email                                                      as cs_email,
    i.go_live_actual as m_, i.go_live_extend as n_,
    i.active_t1 as o_, i.output_t1 as p_, i.active_t4 as q_, i.output_t4 as r_,
    coalesce(i.stopped, false) as stopped, i.link_request,
    case when r.job_id is null then null
         else sum(r.deal_value) over (partition by r.job_id) end as x_tong_gt,
    case when r.job_id is null then null
         else count(*)          over (partition by r.job_id) end as y_so_bo
  from deals_raw r
  left join deal_inputs i on i.deal_id = r.deal_id
  left join cs_members  m on m.username = r.co_owner
  where r.is_active
),
s2 as (   -- Z, AA, AB, AC
  select s1.*,
    case when not has_job then null
         when x_tong_gt < 20000000  then 'SA'
         when x_tong_gt < 200000000 then 'MA' else 'KA' end           as z_phan_khuc,
    case when not has_job then null
         when bo_giai_phap = 'Other' then 4
         when bo_giai_phap = 'Work Ops'
              then case when so_luong_user <= 15 then 2 when so_luong_user <= 500 then 1 else 3 end
         when bo_giai_phap = 'People Ops'
              then case when so_luong_user <= 1000 then 2 else 3 end
         when bo_giai_phap = 'Business Ops'
              then case when so_luong_user <= 15 then 1 when so_luong_user <= 200 then 2 else 3 end
         else null end                                                as tier_num,
    case when has_job then ttgl_so_ngay end                           as ab_ttgl,
    case when has_job then ngay_go_live_du_kien end                   as ac_gl_plan
  from s1
),
s3 as (   -- AD trạng thái go-live
  select s2.*,
    case when not has_job then null
         when stopped then 'Dừng triển khai'
         when m_ is not null then
              case when m_ <= coalesce(n_, ac_gl_plan) then 'Go-live đúng hạn' else 'Go-live trễ' end
         when vn_today() > ngay_tao_deal + 2 * ab_ttgl then 'Quá 200% → dồn CR1'
         when vn_today() > coalesce(n_, ac_gl_plan)    then 'Trễ - chưa go-live'
         else 'Đang triển khai' end                                    as ad_trang_thai
  from s2
),
s4 as (   -- AE..AV
  select s3.*,
    case when not has_job or ad_trang_thai = 'Dừng triển khai' then null
         else to_char(coalesce(n_, ac_gl_plan), 'MM/YYYY') end         as ae_thang_cr,
    case when has_job then deal_value end                             as af_dt_phai,
    case when not has_job then null when m_ is not null then deal_value else 0 end as ag_dt_dat
  from s3
),
s5 as (
  select s4.*,
    case when not has_job or ae_thang_cr is null or m_ is null then null
         else month_anchor(m_) end                                     as ah_thang_t1
  from s4
),
s6 as (
  select s5.*,
    (ah_thang_t1 + interval '3 month')::date                          as ai_thang_t4,
    case when tier_num = 4 then null else u_point(tier_num, o_) end   as aj_u_t1,
    p_ * 100                                                          as ak_o_t1,
    case when not has_job then null else chs(tier_num, o_, p_) end    as al_chs_t1,
    case when tier_num = 4 then null else u_point(tier_num, q_) end   as an_u_t4,
    r_ * 100                                                          as ao_o_t4,
    case when not has_job then null else chs(tier_num, q_, r_) end    as ap_chs_t4,
    case when not has_job or so_nam is null or ae_thang_cr is null then null
         else deal_value::numeric / case when so_nam = 0 then 1 else so_nam end end as ar_acr,
    case when m_ is null or ae_thang_cr is null then null
         else (m_ + make_interval(years => greatest(coalesce(so_nam, 0), 1)))::date end as au_het_han_com,
    case when has_job then greatest(coalesce(so_nam, 0), 1) end       as av_so_nam_com
  from s5
),
s7 as (
  select s6.*,
    case when al_chs_t1 is null then null when al_chs_t1 >= 50 then 'Đạt' else 'Chưa' end as am_dat_t1,
    case when ap_chs_t4 is null then null when ap_chs_t4 >= 50 then 'Đạt' else 'Chưa' end as aq_dat_t4
  from s6
),
s8 as (   -- AW..BD tháng nhận Com Năm 2–5
  select s7.*,
    case when not has_job or av_so_nam_com < 2 or ah_thang_t1 is null then null
         else (ah_thang_t1 + interval '1 year')::date end as m_t1_y2,
    case when not has_job or av_so_nam_com < 2 or ai_thang_t4 is null then null
         else (ai_thang_t4 + interval '1 year')::date end as m_t4_y2,
    case when not has_job or av_so_nam_com < 3 or ah_thang_t1 is null then null
         else (ah_thang_t1 + interval '2 year')::date end as m_t1_y3,
    case when not has_job or av_so_nam_com < 3 or ai_thang_t4 is null then null
         else (ai_thang_t4 + interval '2 year')::date end as m_t4_y3,
    case when not has_job or av_so_nam_com < 4 or ah_thang_t1 is null then null
         else (ah_thang_t1 + interval '3 year')::date end as m_t1_y4,
    case when not has_job or av_so_nam_com < 4 or ai_thang_t4 is null then null
         else (ai_thang_t4 + interval '3 year')::date end as m_t4_y4,
    case when not has_job or av_so_nam_com < 5 or ah_thang_t1 is null then null
         else (ah_thang_t1 + interval '4 year')::date end as m_t1_y5,
    case when not has_job or av_so_nam_com < 5 or ai_thang_t4 is null then null
         else (ai_thang_t4 + interval '4 year')::date end as m_t4_y5
  from s7
),
s9 as (   -- BE..CZ Năm 2–5: Điểm U, Điểm O, CHS, ACR đủ đk
  select s8.*,
    my.a_t1_y2, my.o_t1_y2,
    my.a_t4_y2, my.o_t4_y2,
    my.a_t1_y3, my.o_t1_y3,
    my.a_t4_y3, my.o_t4_y3,
    my.a_t1_y4, my.o_t1_y4,
    my.a_t4_y4, my.o_t4_y4,
    my.a_t1_y5, my.o_t1_y5,
    my.a_t4_y5, my.o_t4_y5,
    case when tier_num in (1,2,3) then u_point(tier_num, my.a_t1_y2) end as u_t1_y2,
    my.o_t1_y2 * 100 as op_t1_y2,
    case when m_t1_y2 is null then null else chs(tier_num, my.a_t1_y2, my.o_t1_y2) end as chs_t1_y2,
    case when tier_num in (1,2,3) then u_point(tier_num, my.a_t4_y2) end as u_t4_y2,
    my.o_t4_y2 * 100 as op_t4_y2,
    case when m_t4_y2 is null then null else chs(tier_num, my.a_t4_y2, my.o_t4_y2) end as chs_t4_y2,
    case when tier_num in (1,2,3) then u_point(tier_num, my.a_t1_y3) end as u_t1_y3,
    my.o_t1_y3 * 100 as op_t1_y3,
    case when m_t1_y3 is null then null else chs(tier_num, my.a_t1_y3, my.o_t1_y3) end as chs_t1_y3,
    case when tier_num in (1,2,3) then u_point(tier_num, my.a_t4_y3) end as u_t4_y3,
    my.o_t4_y3 * 100 as op_t4_y3,
    case when m_t4_y3 is null then null else chs(tier_num, my.a_t4_y3, my.o_t4_y3) end as chs_t4_y3,
    case when tier_num in (1,2,3) then u_point(tier_num, my.a_t1_y4) end as u_t1_y4,
    my.o_t1_y4 * 100 as op_t1_y4,
    case when m_t1_y4 is null then null else chs(tier_num, my.a_t1_y4, my.o_t1_y4) end as chs_t1_y4,
    case when tier_num in (1,2,3) then u_point(tier_num, my.a_t4_y4) end as u_t4_y4,
    my.o_t4_y4 * 100 as op_t4_y4,
    case when m_t4_y4 is null then null else chs(tier_num, my.a_t4_y4, my.o_t4_y4) end as chs_t4_y4,
    case when tier_num in (1,2,3) then u_point(tier_num, my.a_t1_y5) end as u_t1_y5,
    my.o_t1_y5 * 100 as op_t1_y5,
    case when m_t1_y5 is null then null else chs(tier_num, my.a_t1_y5, my.o_t1_y5) end as chs_t1_y5,
    case when tier_num in (1,2,3) then u_point(tier_num, my.a_t4_y5) end as u_t4_y5,
    my.o_t4_y5 * 100 as op_t4_y5,
    case when m_t4_y5 is null then null else chs(tier_num, my.a_t4_y5, my.o_t4_y5) end as chs_t4_y5
  from s8 left join my on my.deal_id = s8.deal_id
)
-- Tên cột = ĐÚNG header sheet Database (kể cả khoảng trắng cuối) vì app.js
-- tìm cột theo tên header.
select
  job_id                 as "ID Workflow bàn giao",
  deal_id                as "Deal ID",
  deal_name              as "Tên khách hàng",
  co_owner               as "Username CS triển khai",
  coalesce(cs_email,' ') as "Email phụ trách",
  'CS_PM,CS_A'           as "Vai trò phụ trách",
  loai_hop_dong          as "Loại hợp đồng",
  bo_giai_phap           as "Bộ giải pháp",
  deal_value             as "Giá trị phần mềm bộ (VNĐ)",
  so_nam                 as "Số năm HĐ",
  so_luong_user          as "Số users đăng ký",
  ngay_tao_deal          as "Ngày nhận deal",
  m_                     as "Ngày go-live thực tế",
  n_                     as "Ngày go-live gia hạn ",
  o_                     as "% Active T1",
  p_                     as "% Output T1",
  q_                     as "% Active T4",
  r_                     as "% Output T4",
  case when stopped then 'X' end as "Dừng triển khai ",
  link_request           as "Link request",
  nullif(replace(trim(substring(deal_name from '\[Project\] (.*?) -')), ',', ''), '') as "System ID",
  trim(substring(deal_name from '^[^-]+-[^-]+-(.*)'))  as "Tên công ty ",
  co_ps_pas              as "Non-SW?",
  x_tong_gt              as "Tổng giá trị HĐ",
  y_so_bo                as "Số bộ trong deal",
  z_phan_khuc            as "Phân khúc",
  case when not has_job then null when tier_num is null then '?' else 'Tier ' || tier_num end as "Tier",
  ab_ttgl                as "TTGL (ngày)",
  ac_gl_plan             as "Ngày go-live dự kiến",
  ad_trang_thai          as "Trạng thái go-live",
  ae_thang_cr            as "Tháng ghi nhận CR",
  af_dt_phai             as "DT phải go-live",
  ag_dt_dat              as "DT go-live đạt",
  ah_thang_t1            as "Tháng đo T1",
  ai_thang_t4            as "Tháng đo T4",
  aj_u_t1                as "Điểm U (T1)",
  ak_o_t1                as "Điểm O (T1)",
  al_chs_t1              as "CHS_CS T1",
  am_dat_t1              as "Đạt T1? (≥50)",
  an_u_t4                as "Điểm U (T4)",
  ao_o_t4                as "Điểm O (T4)",
  ap_chs_t4              as "CHS_CS T4",
  aq_dat_t4              as "Đạt T4? (≥50)",
  ar_acr                 as "ACR (VNĐ/năm)",
  case when am_dat_t1 = 'Đạt' then ar_acr else 0 end as "ACR đủ đk COM T1",
  case when aq_dat_t4 = 'Đạt' then ar_acr else 0 end as "ACR đủ đk COM T4",
  au_het_han_com         as "Ngày hết hạn trả Com",
  av_so_nam_com          as "Số năm nhận com",
  m_t1_y2 as "Tháng nhận Com T1 - Năm 2",
  m_t4_y2 as "Tháng nhận Com T4 - Năm 2",
  m_t1_y3 as "Tháng nhận Com T1 - Năm 3",
  m_t4_y3 as "Tháng nhận Com T4 - Năm 3",
  m_t1_y4 as "Tháng nhận Com T1 - Năm 4",
  m_t4_y4 as "Tháng nhận Com T4 - Năm 4",
  m_t1_y5 as "Tháng nhận Com T1 - Năm 5",
  m_t4_y5 as "Tháng nhận Com T4 - Năm 5",
  a_t1_y2   as "% Active T1 - Năm 2",
  o_t1_y2   as "% Output T1 - Năm 2",
  u_t1_y2   as "Điểm U (T1) - Năm 2",
  op_t1_y2  as "Điểm O (T1) - Năm 2",
  chs_t1_y2 as "CHS_CS T1 - Năm 2",
  case when m_t1_y2 is null or chs_t1_y2 is null or chs_t1_y2 < 50 then 0 else ar_acr end as "ACR đủ đk COM T1 - Năm 2",
  a_t4_y2   as "% Active T4 - Năm 2",
  o_t4_y2   as "% Output T4 - Năm 2",
  u_t4_y2   as "Điểm U (T4) - Năm 2",
  op_t4_y2  as "Điểm O (T4) - Năm 2",
  chs_t4_y2 as "CHS_CS T4 - Năm 2",
  case when m_t4_y2 is null or chs_t4_y2 is null or chs_t4_y2 < 50 then 0 else ar_acr end as "ACR đủ đk COM T4 - Năm 2",
  a_t1_y3   as "% Active T1 - Năm 3",
  o_t1_y3   as "% Output T1 - Năm 3",
  u_t1_y3   as "Điểm U (T1) - Năm 3",
  op_t1_y3  as "Điểm O (T1) - Năm 3",
  chs_t1_y3 as "CHS_CS T1 - Năm 3",
  case when m_t1_y3 is null or chs_t1_y3 is null or chs_t1_y3 < 50 then 0 else ar_acr end as "ACR đủ đk COM T1 - Năm 3",
  a_t4_y3   as "% Active T4 - Năm 3",
  o_t4_y3   as "% Output T4 - Năm 3",
  u_t4_y3   as "Điểm U (T4) - Năm 3",
  op_t4_y3  as "Điểm O (T4) - Năm 3",
  chs_t4_y3 as "CHS_CS T4 - Năm 3",
  case when m_t4_y3 is null or chs_t4_y3 is null or chs_t4_y3 < 50 then 0 else ar_acr end as "ACR đủ đk COM T4 - Năm 3",
  a_t1_y4   as "% Active T1 - Năm 4",
  o_t1_y4   as "% Output T1 - Năm 4",
  u_t1_y4   as "Điểm U (T1) - Năm 4",
  op_t1_y4  as "Điểm O (T1) - Năm 4",
  chs_t1_y4 as "CHS_CS T1 - Năm 4",
  case when m_t1_y4 is null or chs_t1_y4 is null or chs_t1_y4 < 50 then 0 else ar_acr end as "ACR đủ đk COM T1 - Năm 4",
  a_t4_y4   as "% Active T4 - Năm 4",
  o_t4_y4   as "% Output T4 - Năm 4",
  u_t4_y4   as "Điểm U (T4) - Năm 4",
  op_t4_y4  as "Điểm O (T4) - Năm 4",
  chs_t4_y4 as "CHS_CS T4 - Năm 4",
  case when m_t4_y4 is null or chs_t4_y4 is null or chs_t4_y4 < 50 then 0 else ar_acr end as "ACR đủ đk COM T4 - Năm 4",
  a_t1_y5   as "% Active T1 - Năm 5",
  o_t1_y5   as "% Output T1 - Năm 5",
  u_t1_y5   as "Điểm U (T1) - Năm 5",
  op_t1_y5  as "Điểm O (T1) - Năm 5",
  chs_t1_y5 as "CHS_CS T1 - Năm 5",
  case when m_t1_y5 is null or chs_t1_y5 is null or chs_t1_y5 < 50 then 0 else ar_acr end as "ACR đủ đk COM T1 - Năm 5",
  a_t4_y5   as "% Active T4 - Năm 5",
  o_t4_y5   as "% Output T4 - Năm 5",
  u_t4_y5   as "Điểm U (T4) - Năm 5",
  op_t4_y5  as "Điểm O (T4) - Năm 5",
  chs_t4_y5 as "CHS_CS T4 - Năm 5",
  case when m_t4_y5 is null or chs_t4_y5 is null or chs_t4_y5 < 50 then 0 else ar_acr end as "ACR đủ đk COM T4 - Năm 5"
from s9
order by ngay_tao_deal desc, deal_id desc;

-- ---------------------------------------------------------------------
-- BẢO MẬT — view chạy theo quyền người gọi (không bỏ qua RLS), hàm cố
-- định search_path. Thiếu dòng security_invoker thì anon key đọc được
-- toàn bộ dữ liệu qua v_database.
-- ---------------------------------------------------------------------
alter view v_database set (security_invoker = true);
alter function vn_today() set search_path = '';
alter function month_anchor(date) set search_path = '';
alter function u_point(int, numeric) set search_path = public;
alter function chs(int, numeric, numeric) set search_path = public;
