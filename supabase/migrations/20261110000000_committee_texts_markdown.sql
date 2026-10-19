/*
 * 籌備委員會的三個文字頁改用 Markdown 排版（#75）。
 * 改版前存的內容是純文字，照 Markdown 顯示會變樣（連續空格縮成一格、*注意* 變斜體等），
 * 所以記下每個年度的文字頁是不是 Markdown：改版前存的先照純文字顯示，總管理員用新的編輯框存過一次才依樣式排版。
 * 之後新增的（存檔、複製建立新年度）預設都是 Markdown。
 */
alter table public.committee_texts add column markdown boolean not null default true;
update public.committee_texts set markdown = false;

/*
 * 儲存一個年度的三個文字頁；還沒有那一列時新增。年度不存在時丟出 not_found。
 * 以呼叫者的權限執行，權限規則照樣只讓總管理員寫入。存過就是 Markdown。
 */
create or replace function public.save_committee_texts(
  p_conference_id uuid,
  p_introduction text,
  p_chair_message text,
  p_memorandum text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
  if not exists (select 1 from public.conferences where id = p_conference_id) then
    raise exception 'not_found';
  end if;

  insert into public.committee_texts (conference_id, introduction, chair_message, memorandum, markdown)
  values (p_conference_id, p_introduction, p_chair_message, p_memorandum, true)
  on conflict (conference_id) do update
  set introduction = excluded.introduction,
    chair_message = excluded.chair_message,
    memorandum = excluded.memorandum,
    markdown = true,
    updated_at = now();
end;
$$;

grant update (markdown) on public.committee_texts to authenticated;
