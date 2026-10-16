/*
 * 首頁內容的常見問題與自訂區塊，只能在目前年度新增、修改、排序、刪除（#21，Codex 審查）。
 * 後台頁面開著時目前年度被換掉，從舊頁面送出的動作不能改到舊年度、又說首頁已經更新。
 * 先檢查再寫入的話，兩步中間年度還是可能被換掉；所以檢查和寫入放在同一個交易裡，
 * 並鎖住年度大會（for share）：換年度要改這一列，得等這裡做完；這裡在換年度之後才排到的話，
 * 重新檢查時已經不是目前年度，丟出 not_found。
 * 年度大會本身的內容與時程用 update ... where is_current 寫入，同一句裡檢查，不需要另外處理。
 */

-- 鎖住目前年度大會；不是目前年度（或看不到）時丟出 not_found。
create function public.lock_current_conference(p_conference_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.conferences where id = p_conference_id and is_current for share;
  if not found then
    raise exception 'not_found';
  end if;
end;
$$;

revoke all on function public.lock_current_conference from public, anon;
grant execute on function public.lock_current_conference to authenticated;

/*
 * 新增或修改一個常見問題（p_table = 'faqs'）或自訂區塊（'custom_blocks'）。p_id 空值是新增，排在最後。
 * p_values 是要寫入的欄位，鍵是欄位名稱；只取這張表的內容欄位，其他的忽略（不能換年度或排序）。
 * 以呼叫者的權限執行，權限規則照樣只讓總管理員寫入。
 */
create function public.save_home_item(p_table text, p_id uuid, p_conference_id uuid, p_values jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_columns text[];
  v_id uuid;
begin
  -- 只接受這兩張表；表名與欄位名用 %I 帶進去，不會被當成指令。
  v_columns := case p_table
    when 'faqs' then array['question_zh', 'question_en', 'answer_zh', 'answer_en']
    when 'custom_blocks' then
      array['title_zh', 'title_en', 'body_zh', 'body_en', 'button_label_zh', 'button_label_en', 'button_url']
  end;
  if v_columns is null then
    raise exception 'not_found';
  end if;
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
  perform public.lock_current_conference(p_conference_id);

  if p_id is null then
    execute format(
      'insert into public.%1$I (conference_id, position, %2$s)
      select $1,
        coalesce((select max(position) from public.%1$I where conference_id = $1), 0) + 1,
        %3$s
      from jsonb_populate_record(null::public.%1$I, $2) as v
      returning id',
      p_table,
      (select string_agg(format('%I', c), ', ') from unnest(v_columns) as c),
      (select string_agg(format('v.%I', c), ', ') from unnest(v_columns) as c)
    )
      into v_id
      using p_conference_id, p_values;
  else
    execute format(
      'update public.%1$I as item
      set (%2$s, updated_at) = (select %3$s, now() from jsonb_populate_record(null::public.%1$I, $3) as v)
      where item.id = $1 and item.conference_id = $2
      returning item.id',
      p_table,
      (select string_agg(format('%I', c), ', ') from unnest(v_columns) as c),
      (select string_agg(format('v.%I', c), ', ') from unnest(v_columns) as c)
    )
      into v_id
      using p_id, p_conference_id, p_values;
    if v_id is null then
      raise exception 'not_found';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_home_item from public, anon;
grant execute on function public.save_home_item to authenticated;

-- 刪除一個常見問題或自訂區塊，只在它屬於目前年度時。
create function public.delete_home_item(p_table text, p_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_conference_id uuid;
  v_deleted uuid;
begin
  if p_table is null or p_table not in ('faqs', 'custom_blocks') then
    raise exception 'not_found';
  end if;
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;

  execute format('select conference_id from public.%I where id = $1', p_table)
    into v_conference_id
    using p_id;
  if v_conference_id is null then
    raise exception 'not_found';
  end if;
  perform public.lock_current_conference(v_conference_id);

  execute format('delete from public.%I where id = $1 and conference_id = $2 returning id', p_table)
    into v_deleted
    using p_id, v_conference_id;
  if v_deleted is null then
    raise exception 'not_found';
  end if;
end;
$$;

revoke all on function public.delete_home_item from public, anon;
grant execute on function public.delete_home_item to authenticated;

-- 排序也一樣只在目前年度。其餘說明見 20261027000000_content_editing.sql。
create or replace function public.move_home_item(p_table text, p_id uuid, p_up boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_conference_id uuid;
  v_ids uuid[];
  v_index integer;
  v_target integer;
begin
  if p_table is null or p_table not in ('faqs', 'custom_blocks') then
    raise exception 'not_found';
  end if;
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;

  execute format('select conference_id from public.%I where id = $1', p_table)
    into v_conference_id
    using p_id;
  if v_conference_id is null then
    raise exception 'not_found';
  end if;
  perform public.lock_current_conference(v_conference_id);

  execute format(
    'select array_agg(id order by position, id)
    from (select id, position from public.%I where conference_id = $1 for update) as items',
    p_table
  )
    into v_ids
    using v_conference_id;

  v_index := array_position(v_ids, p_id);
  if v_index is null then
    raise exception 'not_found';
  end if;
  v_target := v_index + case when p_up then -1 else 1 end;
  if v_target < 1 or v_target > cardinality(v_ids) then
    return;
  end if;
  v_ids[v_index] := v_ids[v_target];
  v_ids[v_target] := p_id;

  execute format(
    'update public.%I as item
    set position = ordered.position, updated_at = now()
    from unnest($1::uuid[]) with ordinality as ordered(id, position)
    where item.id = ordered.id and item.position <> ordered.position',
    p_table
  )
    using v_ids;
end;
$$;

/*
 * 按鈕網址不能有的空白與控制字元，改成明確列出，和後台的 isSafeButtonUrl（src/lib/content.ts）完全一致：
 * U+0001–0020、U+007F–00A0、以及 JavaScript \s 認得的其他空白（含 U+FEFF）。
 * 原本的 [[:space:]] 依資料庫語系而定，和 JavaScript 不一致時，既有的區塊會因為沒改的網址存不了。
 */
alter table public.custom_blocks drop constraint custom_blocks_button_url_safe;
-- 既有網址裡有這些字元的（舊規則可能接受，例如 U+FEFF），先換成百分比編碼（U+FEFF → %EF%BB%BF），
-- 連結指到的地方不變，新規則才加得上去。
update public.custom_blocks
set button_url = (
  select string_agg(
    case
      when ch ~ '[\u0001- \u007f-   -     　﻿]'
        then regexp_replace(upper(encode(convert_to(ch, 'UTF8'), 'hex')), '(..)', '%\1', 'g')
      else ch
    end,
    '' order by n
  )
  from regexp_split_to_table(button_url, '') with ordinality as chars(ch, n)
)
where button_url ~ '[\u0001- \u007f-   -     　﻿]';
alter table public.custom_blocks add constraint custom_blocks_button_url_safe check (
  button_url is null
  or (
    button_url ~* '^(https?://[^/\\?#]+|/([^/\\]|$))'
    and button_url !~ '[\u0001- \u007f-   -     　﻿]'
  )
);
