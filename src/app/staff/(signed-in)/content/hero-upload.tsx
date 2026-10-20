"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import {
  checkHeroFile,
  HERO_BUCKET,
  heroImagePath,
  heroNotRecorded,
  heroRatioOff,
  type HeroError,
  type HeroSlot,
} from "@/lib/hero";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { SubmitButton } from "../../submit-button";
import { alertClass, buttonClass, inputClass, noticeClass } from "../../ui";
import { attachHeroImageAction } from "./actions";

/** 上傳前就能說明的錯誤，直接顯示在選檔案的地方。 */
const FILE_ERRORS: Partial<Record<HeroError, string>> = {
  file_type: "只收 JPG、PNG、WebP 格式的圖片。",
  file_too_large: "圖片超過 5 MB，請請美編組另存小一點的檔案（例如存成 JPG）。",
};

/**
 * 上傳一張主視覺（#81）。圖片由瀏覽器直接上傳到存放空間（Vercel 的伺服器收不了這麼大的檔案），
 * 上傳完再請伺服器把路徑記到年度大會上；記不成功時把剛上傳的檔案刪掉，不留沒人用的檔案。
 * 存放空間只讓總管理員上傳，格式與大小也由它擋下；這裡先檢查一次，好說明原因。
 * 長寬比和建議差太多時提醒，但不擋。做完導回首頁內容頁，用跳出的視窗說明結果。
 */
export function HeroUpload({
  conferenceId,
  slot,
  label,
  ratioHint,
}: {
  conferenceId: string;
  slot: HeroSlot;
  label: string;
  ratioHint: string;
}) {
  const id = useId();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [ratioWarning, setRatioWarning] = useState(false);

  function choose(file: File | undefined) {
    setRatioWarning(false);
    if (!file) return setFileError(null);
    const error = checkHeroFile(file.type, file.size);
    setFileError(error ? FILE_ERRORS[error]! : null);
    if (error) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setRatioWarning(heroRatioOff(slot, image.naturalWidth, image.naturalHeight));
      URL.revokeObjectURL(url);
    };
    image.onerror = () => URL.revokeObjectURL(url);
    image.src = url;
  }

  async function upload() {
    const file = input.current?.files?.[0];
    if (!file || file.size === 0) return setFileError("請先選一張圖片。");
    const error = checkHeroFile(file.type, file.size);
    if (error) return setFileError(FILE_ERRORS[error]!);

    const path = heroImagePath(conferenceId, slot, file.type);
    const storage = createClient().storage.from(HERO_BUCKET);
    // 每次都是新檔名，可以讓瀏覽器與 CDN 一直快取。
    const uploaded = await storage
      .upload(path, file, { contentType: file.type, cacheControl: "31536000" })
      .catch((error: unknown) => ({ error }));
    if (uploaded.error) {
      console.error("上傳主視覺失敗", uploaded.error);
      return router.push("/staff/content?error=upload_failed");
    }
    // 沒拿到回應（斷線、逾時）時不知道有沒有記成功：可能已經記好、舊圖也刪了，這時刪掉新圖首頁就破圖了。
    // 所以不刪，請她重新整理看看；最多留下一個沒人用的檔案（Codex 審查）。
    let result;
    try {
      result = await attachHeroImageAction({ conferenceId, slot, path });
    } catch (error) {
      console.error("記錄主視覺沒有回應", error);
      return router.push("/staff/content?error=upload_unknown");
    }
    if (!result.ok) {
      // 伺服器確定沒記上才刪掉剛上傳的檔案；不確定時留著，請她重新整理看看。
      if (heroNotRecorded(result.error)) await storage.remove([path]).catch(() => {});
      return router.push(`/staff/content?error=${heroNotRecorded(result.error) ? result.error : "upload_unknown"}`);
    }
    router.push("/staff/content?done=heroUploaded");
  }

  return (
    <form action={upload} className="flex flex-col gap-2">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <input
        ref={input}
        id={id}
        name="file"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => choose(event.target.files?.[0])}
        className={inputClass}
      />
      <span className="text-sm text-muted-foreground">{ratioHint}JPG、PNG、WebP，5 MB 以內。</span>
      {fileError && (
        <p role="alert" className={alertClass}>
          {fileError}
        </p>
      )}
      {ratioWarning && (
        <p role="status" className={noticeClass}>
          這張圖的長寬比和建議的差比較多，首頁上可能會留白或顯得太扁、太長。確定是這張的話照樣可以上傳。
        </p>
      )}
      <SubmitButton pendingLabel="上傳中…" className={cn(buttonVariants(), buttonClass, "self-start font-bold")}>
        上傳
      </SubmitButton>
    </form>
  );
}
