-- =====================================================================
-- 06 — KHOÁ NHẬP %Active/%Output THEO NGÀY ĐÁNH GIÁ T1/T4 (quyết định 16/10/2026)
-- Trước: ô U/O bị khoá khi deal đã kéo trên CRM và BigQuery có số.
-- Nay:   ô U/O kỳ T1/T4 bị khoá khi QUA ngày đánh giá kỳ đó (ngày đánh giá < hôm nay):
--          ngày đánh giá = "Ngày đánh giá 1 tháng / 4 tháng" trên CRM nếu có,
--          trống thì = ngày go-live (ưu tiên ngày kéo đánh giá) + 1 / + 4 tháng.
--        Năm 2–5: ngày đánh giá Năm 1 + (N−1) năm.
--        Trước ngày đánh giá: số CS nhập được ưu tiên hơn số CRM; qua ngày: chốt số CRM
--        (CRM chưa có thì giữ số CS). Chặn ở cả máy chủ (web + MCP).
-- File này chỉ là phần THAY ĐỔI, trích nguyên văn từ 01_tao_bang.sql / 02_api.sql /
-- 03_admin_mcp.sql (đã sửa sẵn) — chạy lại nhiều lần vẫn an toàn. Không có DELETE/DROP.
-- =====================================================================
-- NGÀY ĐÁNH GIÁ T1/T4 — mốc khoá nhập %Active/%Output (quyết định 16/10/2026):
-- ngày trên CRM ("Ngày đánh giá 1 tháng" / "4 tháng") nếu có; CRM trống thì tự tính
-- = ngày go-live thực tế (ưu tiên ngày kéo đánh giá trên CRM) + 1 / + 4 tháng.
-- Qua ngày đó (ngày đánh giá < hôm nay) thì kỳ đó khoá, không sửa tay được nữa.
create or replace function crm_date(t text) returns date immutable language plpgsql as $$
declare s text := trim(coalesce(t, ''));
begin
  if s ~ '^\d{1,2}/\d{1,2}/\d{4}' then return to_date(substring(s from '^\d{1,2}/\d{1,2}/\d{4}'), 'DD/MM/YYYY'); end if;
  if s ~ '^\d{4}-\d{2}-\d{2}' then return substring(s from '^\d{4}-\d{2}-\d{2}')::date; end if;
  return null;
exception when others then return null;   -- ngày sai (vd 31/02) → coi như trống
end $$;

create or replace function ngay_dg(crm text, go_live date, months int) returns date immutable language sql as $$
  select coalesce(crm_date(crm), (go_live + make_interval(months => months))::date) $$;

-- Ngày đánh giá của 1 deal theo kỳ ('T1' | 'T4') — dùng cho các hàm ghi (web, MCP)
create or replace function deal_ngay_dg(p_deal_id bigint, p_ky text) returns date stable language sql as $$
  select ngay_dg(case when p_ky = 'T4' then r.ngay_danh_gia_4_thang else r.ngay_danh_gia_1_thang end,
                 coalesce(r.custom_ngay_keo_danh_gia, i.go_live_actual),
                 case when p_ky = 'T4' then 4 else 1 end)
  from deals_raw r left join deal_inputs i on i.deal_id = r.deal_id
  where r.deal_id = p_deal_id $$;
-- ---------- v_database (thêm cột ở CUỐI: Ngày đánh giá T1/T4, Khoá U/O, Khoá Năm 2++) ----------
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
    -- Ngày go-live thực tế: ưu tiên ngày đã kéo đánh giá trên Base CRM (BigQuery),
    -- chưa kéo thì dùng ngày CS forecast/nhập tay (quyết định 15/10/2026)
    coalesce(r.custom_ngay_keo_danh_gia, i.go_live_actual) as m_, i.go_live_extend as n_,
    -- % Active/Output T1/T4: deal đã kéo đánh giá trên CRM → lấy tỉ lệ sử dụng tháng 1/tháng 4
    -- và O (thang 0–100) từ BigQuery, tool tự tính U/O/CHS; BigQuery chưa có số thì dùng số CS nhập
    -- (quyết định 15/10/2026; BigQuery chỉ có 1 cột O nên O dùng chung cho T1 và T4).
    -- 16/10/2026: TRƯỚC ngày đánh giá kỳ đó, số CS nhập (nếu có) được ưu tiên hơn số CRM;
    -- QUA ngày đánh giá thì khoá và chốt số CRM (CRM chưa có thì giữ số CS).
    case when ngay_dg(r.ngay_danh_gia_1_thang, coalesce(r.custom_ngay_keo_danh_gia, i.go_live_actual), 1) >= vn_today()
              and i.active_t1 is not null then i.active_t1
         when r.custom_ngay_keo_danh_gia is not null and r.ty_le_su_dung_1_thang is not null
         then case when r.ty_le_su_dung_1_thang > 0 then r.ty_le_su_dung_1_thang::numeric(7,4)
                   else coalesce(i.active_t1, 0::numeric(7,4)) end   -- 0% coi như chưa có: CS được nhập tay
         else i.active_t1 end as o_,
    case when ngay_dg(r.ngay_danh_gia_1_thang, coalesce(r.custom_ngay_keo_danh_gia, i.go_live_actual), 1) >= vn_today()
              and i.output_t1 is not null then i.output_t1
         when r.custom_ngay_keo_danh_gia is not null and r.o1 is not null
         then (r.o1 / 100)::numeric(7,4) else i.output_t1 end as p_,
    case when ngay_dg(r.ngay_danh_gia_4_thang, coalesce(r.custom_ngay_keo_danh_gia, i.go_live_actual), 4) >= vn_today()
              and i.active_t4 is not null then i.active_t4
         when r.custom_ngay_keo_danh_gia is not null and r.ty_le_su_dung_4_thang is not null
         then case when r.ty_le_su_dung_4_thang > 0 then r.ty_le_su_dung_4_thang::numeric(7,4)
                   else coalesce(i.active_t4, 0::numeric(7,4)) end   -- 0% coi như chưa có: CS được nhập tay
         else i.active_t4 end as q_,
    case when ngay_dg(r.ngay_danh_gia_4_thang, coalesce(r.custom_ngay_keo_danh_gia, i.go_live_actual), 4) >= vn_today()
              and i.output_t4 is not null then i.output_t4
         when r.custom_ngay_keo_danh_gia is not null and r.o4 is not null
         then (r.o4 / 100)::numeric(7,4) else i.output_t4 end as r_,
    ngay_dg(r.ngay_danh_gia_1_thang, coalesce(r.custom_ngay_keo_danh_gia, i.go_live_actual), 1) as dg1_,
    ngay_dg(r.ngay_danh_gia_4_thang, coalesce(r.custom_ngay_keo_danh_gia, i.go_live_actual), 4) as dg4_,
    i.active_t1 as cs_a1_, i.output_t1 as cs_o1_, i.active_t4 as cs_a4_, i.output_t4 as cs_o4_,
    coalesce(i.stopped, false) as stopped, i.link_request,
    case when r.job_id is null then null
         else sum(r.deal_value) over (partition by r.job_id) end as x_tong_gt,
    -- ARR gộp theo Job (giá trị/số năm, số năm 0/trống = 1) — dùng xếp Phân khúc (policy mục 2)
    case when r.job_id is null then null
         else sum(r.deal_value::numeric / greatest(coalesce(r.so_nam, 1), 1)) over (partition by r.job_id) end as x_arr,
    case when r.job_id is null then null
         else count(*)          over (partition by r.job_id) end as y_so_bo
  from deals_raw r
  left join deal_inputs i on i.deal_id = r.deal_id
  left join cs_members  m on m.username = r.co_owner
  where r.is_active
    -- Chỉ tính deal "Chính sách mới"; deal CRM chưa gắn cơ chế (trống) vẫn giữ (quyết định 16/10/2026)
    and r.co_che_com is distinct from 'Chính sách cũ'
),
s2 as (   -- Z, AA, AB, AC
  select s1.*,
    case when not has_job then null
         when x_arr < 20000000  then 'SA'
         when x_arr < 200000000 then 'MA' else 'KA' end                as z_phan_khuc,
    case when not has_job then null
         when bo_giai_phap = 'Other' then 4
         when bo_giai_phap = 'Work Ops'
              then case when coalesce(so_luong_user, 0) <= 15 then 2 when coalesce(so_luong_user, 0) <= 500 then 1 else 3 end
         when bo_giai_phap = 'People Ops'
              then case when coalesce(so_luong_user, 0) <= 1000 then 2 else 3 end
         when bo_giai_phap = 'Business Ops'
              then case when coalesce(so_luong_user, 0) <= 15 then 1 when coalesce(so_luong_user, 0) <= 200 then 2 else 3 end
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
         when vn_today() > ac_gl_plan + ab_ttgl then 'Quá 200% → dồn CR1'  -- 200% TTGL tính từ cùng mốc với ngày go-live dự kiến
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
    case when not has_job or stopped or m_ is null then null
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
    case when not has_job then null   -- số năm 0 hoặc trống = 1 năm (quyết định 15/10/2026)
         else deal_value::numeric / case when coalesce(so_nam, 0) = 0 then 1 else so_nam end end as ar_acr,
    case when not has_job or stopped or m_ is null then null
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
  case when not has_job then null
       when tier_num is null then
            case when bo_giai_phap is null then 'Thiếu bộ giải pháp'
                 when upper(bo_giai_phap) in ('PS', 'PAS') then 'PS/PaS (không tính SRR/Com)'
                 else '?' end
       else 'Tier ' || tier_num end as "Tier",
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
  case when m_t4_y5 is null or chs_t4_y5 is null or chs_t4_y5 < 50 then 0 else ar_acr end as "ACR đủ đk COM T4 - Năm 5",
  case when custom_ngay_keo_danh_gia is not null then 'Đã kéo'
       when m_ is not null then 'Forecast' end as "Nguồn go-live",
  -- Ô đang hiện số lấy từ BigQuery (UI gắn nhãn "CRM"); ô BigQuery còn trống sau khi tới tháng đánh giá → cảnh báo
  -- (U = 0% cũng coi là thiếu). Trước ngày đánh giá mà CS đã nhập thì ô hiện số CS (không tính là BigQuery).
  nullif(concat_ws(',',
    case when custom_ngay_keo_danh_gia is not null and ty_le_su_dung_1_thang > 0 and (dg1_ < vn_today() or cs_a1_ is null) then 'aT1' end,
    case when custom_ngay_keo_danh_gia is not null and o1 is not null and (dg1_ < vn_today() or cs_o1_ is null) then 'oT1' end,
    case when custom_ngay_keo_danh_gia is not null and ty_le_su_dung_4_thang > 0 and (dg4_ < vn_today() or cs_a4_ is null) then 'aT4' end,
    case when custom_ngay_keo_danh_gia is not null and o4 is not null and (dg4_ < vn_today() or cs_o4_ is null) then 'oT4' end), '') as "U/O từ BigQuery",
  nullif(concat_ws(', ',
    case when custom_ngay_keo_danh_gia is not null and tier_num is distinct from 4
              and ((ty_le_su_dung_1_thang is null and custom_ngay_keo_danh_gia + interval '1 month' <= current_date)
                   or ty_le_su_dung_1_thang = 0) then 'U T1' end,
    case when custom_ngay_keo_danh_gia is not null and o1 is null
              and custom_ngay_keo_danh_gia + interval '1 month' <= current_date then 'O T1' end,
    case when custom_ngay_keo_danh_gia is not null and tier_num is distinct from 4
              and ((ty_le_su_dung_4_thang is null and custom_ngay_keo_danh_gia + interval '4 months' <= current_date)
                   or ty_le_su_dung_4_thang = 0) then 'U T4' end,
    case when custom_ngay_keo_danh_gia is not null and o4 is null
              and custom_ngay_keo_danh_gia + interval '4 months' <= current_date then 'O T4' end), '') as "Thiếu U/O BigQuery",
  -- Khoá nhập U/O theo ngày đánh giá (16/10/2026). Năm N: ngày đánh giá Năm 1 + (N−1) năm.
  dg1_                   as "Ngày đánh giá T1",
  dg4_                   as "Ngày đánh giá T4",
  nullif(concat_ws(',',
    case when dg1_ < vn_today() then 'aT1,oT1' end,
    case when dg4_ < vn_today() then 'aT4,oT4' end), '') as "Khoá U/O",
  nullif(concat_ws(',',
    case when m_t1_y2 is not null and dg1_ + interval '1 year'  < vn_today() then '2|T1' end,
    case when m_t4_y2 is not null and dg4_ + interval '1 year'  < vn_today() then '2|T4' end,
    case when m_t1_y3 is not null and dg1_ + interval '2 years' < vn_today() then '3|T1' end,
    case when m_t4_y3 is not null and dg4_ + interval '2 years' < vn_today() then '3|T4' end,
    case when m_t1_y4 is not null and dg1_ + interval '3 years' < vn_today() then '4|T1' end,
    case when m_t4_y4 is not null and dg4_ + interval '3 years' < vn_today() then '4|T4' end,
    case when m_t1_y5 is not null and dg1_ + interval '4 years' < vn_today() then '5|T1' end,
    case when m_t4_y5 is not null and dg4_ + interval '4 years' < vn_today() then '5|T4' end), '') as "Khoá Năm 2++"
from s9
order by ngay_tao_deal desc, deal_id desc;
alter view v_database set (security_invoker = true);

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
  coalesce(d."U/O từ BigQuery", '') as "U/O từ BigQuery",       -- vd 'aT1,oT1' → ô đang hiện số CRM (nhãn "CRM")
  coalesce(d."Thiếu U/O BigQuery", '') as "Thiếu U/O BigQuery", -- vd 'U T1, O T1' → UI tô đỏ
  fmt_date(d."Ngày đánh giá T1") as "Ngày đánh giá T1",
  fmt_date(d."Ngày đánh giá T4") as "Ngày đánh giá T4",
  coalesce(d."Khoá U/O", '') as "Khoá U/O",                    -- vd 'aT1,oT1' → qua ngày đánh giá T1, UI khoá
  coalesce(d."Khoá Năm 2++", '') as "Khoá Năm 2++"             -- vd '2|T1,2|T4' → UI khoá ô Năm 2–5
from v_database d;
revoke all on v_database_display from anon, authenticated;

-- Kỳ T1/T4 đã qua ngày đánh giá (deal_ngay_dg < hôm nay) → giữ nguyên số cũ, bỏ qua số gửi lên
-- (web gửi đủ 5 ô của deal đã sửa nên không báo lỗi, chỉ không ghi ô đã khoá).
create or replace function api_save_rows(p_email text, p_rows jsonb) returns int language plpgsql as $$
declare
  r jsonb; did bigint; cur deal_inputs%rowtype; n int := 0; k1 boolean; k4 boolean;
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
end $$;

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
    -- Năm N đã qua ngày đánh giá (ngày đánh giá Năm 1 + (N−1) năm) → khoá, bỏ qua
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
end $$;

create or replace function api_patch_deal_input(p_email text, p_deal_id bigint, p_patch jsonb)
returns json language plpgsql as $$
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
  -- U/O khoá theo ngày đánh giá T1/T4 (16/10/2026), không còn theo việc CRM đã có số
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
end $$;

-- ---------- Quyền + search_path ----------
alter function crm_date(text) set search_path = '';
alter function ngay_dg(text, date, int) set search_path = public;
alter function deal_ngay_dg(bigint, text) set search_path = public;
-- deal_ngay_dg đọc dữ liệu deal → chỉ service_role (Edge Function api/mcp) gọi trực tiếp
revoke all on function deal_ngay_dg(bigint, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function deal_ngay_dg(bigint, text) from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function deal_ngay_dg(bigint, text) to service_role';
  end if;
end $$;
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('api_save_rows', 'api_save_multiyear', 'api_patch_deal_input') loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
    execute format('alter function %s set search_path = public', f);
  end loop;
end $$;
