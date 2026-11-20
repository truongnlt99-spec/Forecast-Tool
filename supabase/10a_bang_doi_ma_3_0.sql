-- =====================================================================
-- 10a — BẢNG ĐỐI CHIẾU MÃ DEAL 1.0 → 3.0 (20/11/2026)
--
-- Chạy file này TRƯỚC, sau đó chạy napMaDeal30() trong Apps Script "Dong bo Supabase"
-- để nạp cặp (Deal_ID_cu → Deal_ID) từ tab raw_bao_cao_deal_trien_khai_3_0.
-- Rồi mới chạy 10b_chuyen_ma_3_0.sql. Chạy lại file này không sao (if not exists).
-- =====================================================================

create table if not exists deal_id_map_3_0 (
  old_id    bigint primary key,      -- Deal_ID_cu (1.0)
  new_id    text   not null unique,  -- Deal_ID (3.0)
  old_job   bigint,                  -- Job_ID_cu
  new_job   text,                    -- Job_ID
  loaded_at timestamptz not null default now()
);

-- Chỉ service_role (Apps Script) đọc/ghi — RLS bật, không policy → anon/authenticated không thấy gì
alter table deal_id_map_3_0 enable row level security;
revoke all on deal_id_map_3_0 from anon, authenticated;
grant all on deal_id_map_3_0 to service_role;
