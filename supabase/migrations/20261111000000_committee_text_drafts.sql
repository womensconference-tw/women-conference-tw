/*
 * 籌備委員會三個文字頁的草稿、預覽與發布（#76）。
 * 備忘錄很長、又有排版，總管理員希望編輯完先看一下發布後的樣子，確定了再讓大家看到。
 * committee_texts 是已發布的版本，公開頁面與所有工作人員讀的都是它；草稿另外放在 committee_text_drafts，
 * 只有總管理員讀得到。每個年度最多一份草稿，兩位總管理員同時編輯時後存的蓋掉先存的。
 * 每次存草稿換一個版本代號（revision）：預覽頁帶著它發布，代號不一樣（預覽後草稿又被存過）就不發布，請她重新預覽。
 * 會議記錄、重要連結與兩份名單照舊存了就公開。年度複製只複製已發布的版本（copy_conference 本來就只讀 committee_texts）。
 */

create table public.committee_text_drafts (
  conference_id uuid primary key references public.conferences (id) on delete cascade,
  introduction text not null default '',
  chair_message text not null default '',
  memorandum text not null default '',
  revision uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now()
);

alter table public.committee_text_drafts enable row level security;

create policy "Admins can manage committee text drafts"
  on public.committee_text_drafts for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

-- 只透過下面的函式寫入；前台訪客連權限都沒有。
revoke all on public.committee_text_drafts from anon;
revoke insert, update, delete on public.committee_text_drafts from authenticated;

-- 原本直接發布的 save_committee_texts 換成下面的存草稿，網站不再呼叫它。正式環境的 migration 和網站不是同時上線，
-- 先留著，舊版網站在上線前的空檔照樣存得了；下一次改資料庫時再刪掉。

/*
 * 存一個年度三個文字頁的草稿；還沒有草稿時新增。年度不存在時丟出 not_found。
 * 傳回這份草稿的版本代號。以擁有者的權限執行（資料表不開放直接寫入），自己確認是總管理員。
 */
create function public.save_committee_text_draft(
  p_conference_id uuid,
  p_introduction text,
  p_chair_message text,
  p_memorandum text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision uuid := gen_random_uuid();
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
  if not exists (select 1 from public.conferences where id = p_conference_id) then
    raise exception 'not_found';
  end if;

  insert into public.committee_text_drafts (conference_id, introduction, chair_message, memorandum, revision)
  values (p_conference_id, p_introduction, p_chair_message, p_memorandum, v_revision)
  on conflict (conference_id) do update
  set introduction = excluded.introduction,
    chair_message = excluded.chair_message,
    memorandum = excluded.memorandum,
    revision = excluded.revision,
    updated_at = now();
  return v_revision;
end;
$$;

revoke all on function public.save_committee_text_draft from public, anon;
grant execute on function public.save_committee_text_draft to authenticated;

/*
 * 把草稿發布成正式版本，草稿清掉。p_revision 是預覽時看到的草稿版本代號：
 * 沒有草稿（已經被發布或捨棄）丟出 no_draft，代號不一樣（預覽之後又被存過）丟出 draft_changed。
 * 鎖住草稿，同時發布、存草稿時排隊。發布後是 Markdown（和原本的儲存一樣，#75）。
 */
create function public.publish_committee_texts(p_conference_id uuid, p_revision uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft public.committee_text_drafts;
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;

  select * into v_draft from public.committee_text_drafts where conference_id = p_conference_id for update;
  if not found then
    raise exception 'no_draft';
  end if;
  -- 沒帶代號（null）也不發布：<> 遇到 null 不成立，會跳過檢查。
  if v_draft.revision is distinct from p_revision then
    raise exception 'draft_changed';
  end if;

  insert into public.committee_texts (conference_id, introduction, chair_message, memorandum, markdown)
  values (p_conference_id, v_draft.introduction, v_draft.chair_message, v_draft.memorandum, true)
  on conflict (conference_id) do update
  set introduction = excluded.introduction,
    chair_message = excluded.chair_message,
    memorandum = excluded.memorandum,
    markdown = true,
    updated_at = now();
  delete from public.committee_text_drafts where conference_id = p_conference_id;
end;
$$;

revoke all on function public.publish_committee_texts from public, anon;
grant execute on function public.publish_committee_texts to authenticated;

/* 捨棄一個年度的草稿，回到已發布的版本。沒有草稿時什麼都不做。 */
create function public.discard_committee_text_draft(p_conference_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
  delete from public.committee_text_drafts where conference_id = p_conference_id;
end;
$$;

revoke all on function public.discard_committee_text_draft from public, anon;
grant execute on function public.discard_committee_text_draft to authenticated;
