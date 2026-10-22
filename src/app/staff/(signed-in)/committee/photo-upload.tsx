"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import {
  checkCommitteePhoto,
  COMMITTEE_PHOTO_BUCKET,
  committeePhotoNotRecorded,
  committeePhotoPath,
  type CommitteePhotoFileError,
} from "@/lib/committee-photos";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { SubmitButton } from "../../submit-button";
import { alertClass, buttonClass, inputClass } from "../../ui";
import { attachPhotoAction } from "./actions";

/** 上傳前就能說明的錯誤，直接顯示在選檔案的地方。 */
const FILE_ERRORS: Record<CommitteePhotoFileError, string> = {
  file_type: "只收 JPG、PNG、WebP 格式的照片。",
  file_too_large: "照片超過 5 MB，請另存小一點的檔案（例如存成 JPG）。",
};

/**
 * 上傳或更換一位籌備委員的照片。照片由瀏覽器直接上傳到存放空間（Vercel 的伺服器收不了這麼大的檔案），
 * 上傳完再請伺服器把路徑記到這位委員上；確定沒記上時把剛上傳的檔案刪掉，不留沒人用的檔案。
 * 存放空間只讓總管理員上傳，格式與大小也由它擋下；這裡先檢查一次，好說明原因。
 * 做完導回籌備委員會頁（同一個年度），用跳出的視窗說明結果。
 */
export function CommitteePhotoUpload({
  conferenceId,
  year,
  memberId,
  previous,
}: {
  conferenceId: string;
  year: number;
  memberId: string;
  /** 畫面上看到的目前照片；沒有是 null。 */
  previous: string | null;
}) {
  const id = useId();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const back = (result: string) => router.push(`/staff/committee?year=${year}&${result}`);

  function choose(file: File | undefined) {
    const error = file ? checkCommitteePhoto(file.type, file.size) : null;
    setFileError(error && FILE_ERRORS[error]);
  }

  async function upload() {
    const file = input.current?.files?.[0];
    if (!file || file.size === 0) return setFileError("請先選一張照片。");
    const error = checkCommitteePhoto(file.type, file.size);
    if (error) return setFileError(FILE_ERRORS[error]);

    const path = committeePhotoPath(conferenceId, memberId, file.type);
    const storage = createClient().storage.from(COMMITTEE_PHOTO_BUCKET);
    // 每次都是新檔名，可以讓瀏覽器與 CDN 一直快取。
    const uploaded = await storage
      .upload(path, file, { contentType: file.type, cacheControl: "31536000" })
      .catch((error: unknown) => ({ error }));
    if (uploaded.error) {
      console.error("上傳籌備委員照片失敗", uploaded.error);
      return back("error=photo_failed");
    }
    // 沒拿到回應（斷線、逾時）時不知道有沒有記成功，記好了的話刪掉新照片個人頁就破圖了，所以不刪，請她重新整理看看。
    let result;
    try {
      result = await attachPhotoAction({ memberId, path, previous });
    } catch (error) {
      console.error("記錄籌備委員照片沒有回應", error);
      return back("error=unavailable");
    }
    if (!result.ok) {
      if (committeePhotoNotRecorded(result.error)) await storage.remove([path]).catch(() => {});
      return back(`error=${result.error}`);
    }
    back("done=photo_uploaded");
  }

  return (
    <form action={upload} className="flex flex-col gap-2">
      <label htmlFor={id} className="font-semibold">
        {previous ? "換一張照片" : "上傳照片"}
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
      <span className="text-sm text-muted-foreground">直式（3:4）、臉在中間偏上最好看。JPG、PNG、WebP，5 MB 以內。</span>
      {fileError && (
        <p role="alert" className={alertClass}>
          {fileError}
        </p>
      )}
      <SubmitButton pendingLabel="上傳中…" className={cn(buttonVariants(), buttonClass, "self-start font-bold")}>
        上傳
      </SubmitButton>
    </form>
  );
}
