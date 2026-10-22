/*
 * 大會特色介紹內容與教堂分頁裡的圖片（#102）：總管理員在後台編輯器按「圖片」上傳，公開網址寫進 Markdown。
 * 任何人都能用公開網址讀（介紹頁要顯示），只有總管理員能上傳、刪除（ADR 0004）。
 * 只收 JPG、PNG、WebP，單張上限 5 MB，由存放空間本身擋下；後台在上傳前也先檢查，好說明原因。
 * 圖片由瀏覽器直接上傳到這裡（不經過網站伺服器），所以權限一定要在這裡擋。
 * 檔案路徑：<年度大會編號>/<隨機編號>.<副檔名>。複製建立新年度時介紹內容跟著複製，新舊年度用同一個檔案。
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('highlight-images', 'highlight-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']);

-- 公開的空間用公開網址讀不需要權限規則；刪除、覆寫時存放空間要先讀得到那個檔案，所以總管理員要能讀。
create policy "Admins can read highlight images"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'highlight-images' and public.is_staff_admin());

create policy "Admins can upload highlight images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'highlight-images' and public.is_staff_admin());

create policy "Admins can replace highlight images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'highlight-images' and public.is_staff_admin())
  with check (bucket_id = 'highlight-images' and public.is_staff_admin());

create policy "Admins can delete highlight images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'highlight-images' and public.is_staff_admin());
