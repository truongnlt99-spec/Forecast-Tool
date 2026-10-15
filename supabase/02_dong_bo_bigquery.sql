-- =====================================================================
-- FORECAST TOOL — ĐỒNG BỘ BIGQUERY → deals_raw (bước 4 trong plan migration)
-- Chạy SAU 01_tao_bang.sql. Chạy lại nhiều lần vẫn an toàn.
--
-- Apps Script (supabase/apps-script/DongBoSupabase.gs) gọi hàm này qua
-- POST /rest/v1/rpc/sync_deals_raw, mỗi lần 1 lô dòng:
--   p_rows   : mảng JSON, mỗi phần tử = 1 dòng BigQuery {tên cột: giá trị}
--   p_run_at : mốc thời gian chung của cả lượt đồng bộ
--   p_final  : true ở lô cuối → deal không còn trong BigQuery bị đánh
--              is_active = false (KHÔNG xoá, giữ dữ liệu CS đã nhập)
--
-- Tên cột BigQuery được chuẩn hoá (chữ thường, ký tự lạ → "_") rồi khớp với
-- cột deals_raw: "TTGL_so_ngay" → ttgl_so_ngay. Cột không khớp bị bỏ qua và
-- trả về trong "cot_khong_khop" để biết mà sửa.
-- =====================================================================

create or replace function sync_deals_raw(
  p_rows   jsonb,
  p_run_at timestamptz,
  p_final  boolean default false
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_types     jsonb;    -- {cột: kiểu} của deals_raw (trừ cột quản lý)
  v_present   text[];   -- cột vừa có trong dữ liệu gửi lên vừa có trong bảng
  v_unknown   text[];
  v_clean     jsonb;
  v_no_id     int;
  v_upserted  int := 0;
  v_seen      int;
  v_active    int;
  v_deact     int := 0;
  v_set       text;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'p_rows phải là mảng JSON';
  end if;

  select jsonb_object_agg(attname, format_type(atttypid, atttypmod))
    into v_types
  from pg_attribute
  where attrelid = 'public.deals_raw'::regclass and attnum > 0 and not attisdropped
    and attname not in ('is_active', 'last_seen_at', 'synced_at');

  -- Tách từng ô, chuẩn hoá tên cột, ép kiểu mềm (chuỗi rỗng → null,
  -- số lẻ → làm tròn cho cột số nguyên, timestamp → lấy phần ngày)
  with cells as (
    select t.ord,
           trim(both '_' from lower(regexp_replace(x.k, '[^A-Za-z0-9]+', '_', 'g'))) as k,
           x.v
    from jsonb_array_elements(p_rows) with ordinality t(e, ord),
         jsonb_each(t.e) x(k, v)
  ),
  typed as (
    select c.ord, c.k, v_types ->> c.k as typ,
           case
             when c.v is null or jsonb_typeof(c.v) = 'null' or btrim(c.v #>> '{}') = '' then 'null'::jsonb
             when v_types ->> c.k in ('bigint', 'integer', 'smallint')
               then to_jsonb(round((replace(c.v #>> '{}', ',', ''))::numeric))
             when v_types ->> c.k = 'numeric'
               then to_jsonb((replace(c.v #>> '{}', ',', ''))::numeric)
             when v_types ->> c.k = 'date'
               then to_jsonb(left(c.v #>> '{}', 10))
             when v_types ->> c.k = 'text' and jsonb_typeof(c.v) <> 'string'
               then to_jsonb(c.v #>> '{}')
             else c.v
           end as v
    from cells c
  ),
  per_row as (
    select ord, jsonb_object_agg(k, v) filter (where typ is not null) as r
    from typed group by ord
  ),
  dedup as (   -- 1 deal xuất hiện nhiều lần trong lô → lấy dòng sau cùng
    select distinct on ((r ->> 'deal_id')) r
    from per_row
    where r ->> 'deal_id' is not null
    order by (r ->> 'deal_id'), ord desc
  )
  select
    (select coalesce(jsonb_agg(r), '[]'::jsonb) from dedup),
    (select count(*) from per_row where r is null or r ->> 'deal_id' is null),
    (select array_agg(distinct k) from typed where typ is not null),
    (select array_agg(distinct k) from typed where typ is null)
  into v_clean, v_no_id, v_present, v_unknown;

  if jsonb_array_length(v_clean) > 0 then
    select string_agg(format('%1$I = excluded.%1$I', c), ', ')
      into v_set
    from unnest(v_present) c
    where c <> 'deal_id';

    execute format($f$
      insert into deals_raw
      select (jsonb_populate_record(null::deals_raw,
                r || jsonb_build_object('is_active', true,
                                        'last_seen_at', $2,
                                        'synced_at', now()))).*
      from jsonb_array_elements($1) r
      on conflict (deal_id) do update set
        %s
        is_active = true, last_seen_at = excluded.last_seen_at, synced_at = excluded.synced_at
    $f$, coalesce(v_set || ',', ''))
    using v_clean, p_run_at;
    get diagnostics v_upserted = row_count;
  end if;

  if p_final then
    select count(*) filter (where last_seen_at >= p_run_at),
           count(*) filter (where is_active)
      into v_seen, v_active
    from deals_raw;

    -- Chốt an toàn: query BigQuery lỗi/trả thiếu thì KHÔNG tắt hàng loạt deal
    if v_seen = 0 or v_seen < v_active * 0.5 then
      raise exception 'Lượt đồng bộ chỉ thấy % deal trong khi đang có % deal active — dừng, không đánh dấu ngừng. Kiểm tra lại query BigQuery.', v_seen, v_active;
    end if;

    update deals_raw set is_active = false
    where is_active and last_seen_at < p_run_at;
    get diagnostics v_deact = row_count;
  end if;

  return jsonb_build_object(
    'upserted',        v_upserted,
    'bo_qua_thieu_id', v_no_id,
    'cot_khong_khop',  coalesce(to_jsonb(v_unknown), '[]'::jsonb),
    'deactivated',     v_deact
  );
end $$;

-- Chỉ backend (service_role) được gọi; trình duyệt cầm anon key thì không.
revoke execute on function sync_deals_raw(jsonb, timestamptz, boolean) from public, anon, authenticated;
grant  execute on function sync_deals_raw(jsonb, timestamptz, boolean) to service_role;
