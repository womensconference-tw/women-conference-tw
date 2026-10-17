-- 後台維護支聯會與支會名單（#23）。只有總管理員能寫入，由下面的權限規則強制（ADR 0004）。
-- 名單不屬於任何年度大會。教會重新劃分時停用舊單位、新增新單位（GLOSSARY「支聯會／支會」）：
-- 舊報名繼續指向停用的舊單位，歷史統計與報報組的範圍維持原樣。

/*
 * 預設場地：支聯會平常對應的場地，只用來判斷跨區（#24）。
 * 場地屬於年度大會，每年各有一筆；這裡記的是場地的固定識別（venues.site_key），
 * 複製新年度時場地沿用同一個識別，預設場地不必重設。空值表示還沒設定。
 * 固定識別在不同年度會重複，不能用外鍵；後台只讓總管理員從已有的場地挑選。
 */
alter table public.stakes add column default_site_key uuid;

create policy "Admins can manage stakes"
  on public.stakes for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

create policy "Admins can manage wards"
  on public.wards for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

/*
 * 既有支會不能改隸屬的支聯會，支聯會也不能改區：報名記下的支聯會、支會要維持報名當下的歸屬，
 * 報報組依支聯會的區看名單，改了會讓舊報名跑到別區。名稱、排序、停用可以改。
 */
create function public.ward_stake_fixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stake_id <> old.stake_id then
    raise exception 'ward_stake_fixed';
  end if;
  return new;
end;
$$;

create trigger wards_stake_fixed
  before update of stake_id on public.wards
  for each row execute function public.ward_stake_fixed();

create function public.stake_region_fixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.region <> old.region then
    raise exception 'stake_region_fixed';
  end if;
  return new;
end;
$$;

create trigger stakes_region_fixed
  before update of region on public.stakes
  for each row execute function public.stake_region_fixed();

/*
 * 刪除支聯會時連同它的支會一起刪。有報名（包括已取消的）指向支聯會或任何一個支會時，
 * 報名的外鍵擋下整個刪除；後台說明可以改成停用。
 */
alter table public.wards
  drop constraint wards_stake_id_fkey,
  add constraint wards_stake_id_fkey foreign key (stake_id) references public.stakes (id) on delete cascade;
