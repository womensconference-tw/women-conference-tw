/*
 * 報名服務的取消：前台唯一能取消報名的地方。
 * 和修改一樣，姓名與電話（或沒有電話者的報名編號）都要符合這一筆（ADR 0002），只能在報名中取消目前年度的報名。
 * 取消只把狀態改成已取消、記下取消時間，不刪除；課程、午餐、午后動態的紀錄都留著。
 * 名額只算未取消的報名（course_seats_taken 等），所以提交後名額立即釋出，不必再檢查名額。
 *
 * 和查詢、修改共用猜錯次數：姓名與電話不符算猜錯一次，這時不丟出例外、回傳 JSON 的 null，猜錯的紀錄才會留下。
 * 和修改一樣回傳 JSON、唯讀時一律拒絕，不能用篩選、「只回一筆」或 GET 讓猜錯的紀錄撤銷。
 *
 * 已經取消的報名再取消一次（例如取消已經存下、只是回應在路上斷掉，她再按一次）照樣成功，取消時間不變。
 * 查詢本來就看得到已取消的報名，所以這不會多透露什麼。
 */
create function public.cancel_registration(
  p_registration_id uuid,
  p_lookup_name text,
  p_lookup_phone text,
  p_lookup_registration_number text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conference public.conferences;
  v_hash text;
  v_registration public.registrations;
begin
  perform public.reject_read_only();

  select * into v_conference from public.conferences where is_current;
  if v_conference.id is null
    -- 時間點沒填時比較結果是 null，也當成不在報名期間。
    or not coalesce(
      now() >= v_conference.registration_opens_at and now() < v_conference.registration_closes_at,
      false
    )
  then
    raise exception 'registration_not_open';
  end if;

  v_hash := public.lookup_attempt_start(p_lookup_name);

  -- 鎖住這一筆：同時送出的修改與取消依序處理，修改不會在取消之後又寫回來。
  select r.* into v_registration
  from public.registrations r
  where r.id = p_registration_id
    and r.conference_id = v_conference.id
    and public.lookup_name_key(r.name) = public.lookup_name_key(p_lookup_name)
    and (r.phone = p_lookup_phone or r.registration_number = p_lookup_registration_number)
  for update;
  if v_registration.id is null then
    perform public.lookup_attempt_failed(
      v_hash,
      (select count(distinct guess)::integer
        from unnest(array[p_lookup_phone, p_lookup_registration_number]) as guess)
    );
    return 'null';
  end if;

  if v_registration.status = 'registered' then
    update public.registrations
    set status = 'cancelled', cancelled_at = now(), updated_at = now()
    where id = v_registration.id
    returning * into v_registration;
  end if;

  return jsonb_build_object(
    'id', v_registration.id,
    'status', v_registration.status,
    'cancelled_at', v_registration.cancelled_at
  );
end;
$$;

revoke all on function public.cancel_registration from public;
grant execute on function public.cancel_registration to anon, authenticated;
