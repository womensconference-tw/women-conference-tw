-- 送出時使用的電話（#10，ADR 0003）。

/*
 * 代報人沒有帳號，只在每筆報名記下送出時使用的電話，用來追蹤是誰代報的。
 * phone 之後可以由報名者修改，這一欄不跟著改。沒有電話（拿報名編號）的報名是空的。
 * 也是個資：清除個資時（#26）要和 phone 一起清掉。
 */
alter table public.registrations
  add column submitted_phone text,
  add constraint registrations_submitted_phone_format check (submitted_phone ~ '^\+?[0-9]{8,15}$');

-- 已存在的報名補上目前的電話；之前改過電話的，原本的電話已經查不到了。
update public.registrations set submitted_phone = phone;

-- 每筆新的報名都記下寫入當下的電話，不管是前台送出還是之後的後台新增；呼叫的人不能自己指定。
create function public.registrations_submitted_phone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.submitted_phone := new.phone;
  return new;
end;
$$;

create trigger registrations_submitted_phone
  before insert on public.registrations
  for each row execute function public.registrations_submitted_phone();
