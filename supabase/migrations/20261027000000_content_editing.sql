-- 後台編輯年度內容、時程時間點、常見問題與自訂區塊（#21）。只有總管理員能寫入，由下面的權限規則強制（ADR 0004）。
-- 時程的先後順序、目前年度時程要填完整、報名開放後不能改開放時間，由 20261011000000_conferences.sql 與
-- 20261014000000_sessions_courses.sql 原有的檢查擋下。

/*
 * 年度大會只開放改內容與時程欄位。年度、是不是目前年度、個資清除時間由年度管理（#27、#25）處理，
 * 不能從這裡直接改，免得一個表單送錯就換掉前台的目前年度。新增、刪除年度沒有權限規則，一律不行。
 */
revoke update on public.conferences from authenticated;
grant update (
  conference_date,
  start_time,
  end_time,
  announce_at,
  registration_opens_at,
  registration_closes_at,
  theme_scripture_zh,
  theme_scripture_en,
  theme_scripture_reference_zh,
  theme_scripture_reference_en,
  welcome_zh,
  welcome_en,
  admin_line_id,
  updated_at
) on public.conferences to authenticated;

create policy "Admins can update conferences"
  on public.conferences for update
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

-- 常見問題與自訂區塊修改時不能換年度，免得一筆內容從目前年度消失。
revoke update on public.faqs, public.custom_blocks from authenticated;
grant update (position, question_zh, question_en, answer_zh, answer_en, updated_at) on public.faqs to authenticated;
grant update (
  position, title_zh, title_en, body_zh, body_en, button_label_zh, button_label_en, button_url, updated_at
) on public.custom_blocks to authenticated;

create policy "Admins can manage FAQs"
  on public.faqs for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

create policy "Admins can manage custom blocks"
  on public.custom_blocks for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

/*
 * 把一個常見問題或自訂區塊往前（p_up）或往後移一格。同年度的同一類依目前順序（排序相同時依 id，和首頁一樣）
 * 重新編成 1、2、3…，再和相鄰的一個對調，排序數字重複也不會卡住。
 * 先鎖住同年度的同一類，兩位總管理員同時移動時排隊，不會互相蓋掉。已經在最前或最後時不動。
 * 以呼叫者的權限執行，權限規則照樣只讓總管理員寫入。
 */
create function public.move_home_item(p_table text, p_id uuid, p_up boolean)
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
  -- 只接受這兩張表；表名用 %I 帶進去，不會被當成指令。
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

  execute format(
    'select array_agg(id order by position, id)
    from (select id, position from public.%I where conference_id = $1 for update) as items',
    p_table
  )
    into v_ids
    using v_conference_id;

  v_index := array_position(v_ids, p_id);
  -- 等鎖的時候被別人刪掉了。
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

revoke all on function public.move_home_item from public, anon;
grant execute on function public.move_home_item to authenticated;
