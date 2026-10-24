"use client";

import { useId, useRef, useState } from "react";
import { LoadingOverlay } from "@/components/loading-overlay";
import { buttonVariants } from "@/components/ui/button";
import {
  checkHighlightImage,
  HIGHLIGHT_IMAGE_BUCKET,
  highlightImagePath,
  type HighlightImageError,
} from "@/lib/highlight-images";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Field } from "../../fields";
import { alertClass, buttonClass, inputClass } from "../../ui";

const FILE_ERRORS: Record<HighlightImageError, string> = {
  file_type: "只收 JPG、PNG、WebP 格式的照片。",
  file_too_large: "照片超過 5 MB，請另存小一點的檔案（例如存成 JPG）。",
};

// 和編輯器插入圖片一樣：存放空間的上傳不能中途取消，太久沒回應就不等了。
const UPLOAD_TIMEOUT_MS = 2 * 60 * 1000;

/** 照片裁成圓形時對準的高度（object-position 的垂直位置）。 */
const FOCUS_OPTIONS = [
  { value: 0, label: "最上面" },
  { value: 25, label: "偏上" },
  { value: 50, label: "中間" },
  { value: 75, label: "偏下" },
  { value: 100, label: "最下面" },
];

/**
 * 介紹頁人物（與各教堂頁團隊成員）的照片與對準位置，放在人物的表單裡。選了照片就由瀏覽器直接上傳到存放空間（和編輯器的圖片同一個空間），
 * 路徑放進隱藏欄位，按表單的儲存才記到這位人物上；沒按儲存的照片只是多一個沒用到的檔案（見 src/lib/highlight-images.ts）。
 * 圓形預覽跟著對準位置即時變，管理員看得到頭或下巴會不會被切掉。
 */
export function PersonPhotoField({
  conferenceId,
  photo,
  focus,
}: {
  conferenceId: string;
  photo: { path: string; url: string } | null;
  focus: number;
}) {
  return <HighlightImageField conferenceId={conferenceId} image={photo} focus={focus} />;
}

/**
 * 圖文型介紹頁的活動圖片、各教堂頁的海報：和人物照片一樣上傳，但不裁成圓形、沒有對準位置。
 * name 是隱藏欄位的名稱（表單送出的路徑）。
 */
export function WideImageField({
  conferenceId,
  image,
  name,
  legend,
  hint,
}: {
  conferenceId: string;
  image: { path: string; url: string } | null;
  name: string;
  legend: string;
  hint: string;
}) {
  return <HighlightImageField conferenceId={conferenceId} image={image} wide={{ name, legend, hint }} />;
}

function HighlightImageField({
  conferenceId,
  image: photo,
  focus = 50,
  wide,
}: {
  conferenceId: string;
  image: { path: string; url: string } | null;
  focus?: number;
  wide?: { name: string; legend: string; hint: string };
}) {
  const noun = wide ? "圖片" : "照片";
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState(photo);
  const [position, setPosition] = useState(focus);
  // 已存的位置不是五個選項之一（例如直接改過資料庫）時多一個選項，只改姓名就儲存也不會被改成中間。
  const options = FOCUS_OPTIONS.some((option) => option.value === focus)
    ? FOCUS_OPTIONS
    : [...FOCUS_OPTIONS, { value: focus, label: `目前的位置（${focus}%）` }].sort((a, b) => a.value - b.value);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function upload(file: File | undefined) {
    // 清掉選取，失敗後或拿掉照片後再選同一張，瀏覽器才會再通知一次。
    if (input.current) input.current.value = "";
    if (!file || file.size === 0) return;
    const problem = checkHighlightImage(file.type, file.size);
    if (problem) return setError(FILE_ERRORS[problem].replace("照片", noun));
    setError("");
    setUploading(true);
    const path = highlightImagePath(conferenceId, file.type);
    const storage = createClient().storage.from(HIGHLIGHT_IMAGE_BUCKET);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), UPLOAD_TIMEOUT_MS);
    });
    let uploaded: { error: unknown } | "timeout";
    try {
      // 每次都是新檔名，可以讓瀏覽器與 CDN 一直快取。
      uploaded = await Promise.race([storage.upload(path, file, { contentType: file.type, cacheControl: "31536000" }), timedOut]);
    } catch (error) {
      uploaded = { error };
    } finally {
      clearTimeout(timer);
      setUploading(false);
    }
    if (uploaded === "timeout") return setError("上傳太久沒有回應，請檢查網路後再試一次。");
    if (uploaded.error) {
      console.error("上傳介紹頁人物照片失敗", uploaded.error);
      return setError(`${noun}沒有上傳成功，請檢查網路後再試一次。`);
    }
    setCurrent({ path, url: storage.getPublicUrl(path).data.publicUrl });
  }

  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
      <legend className="px-1 font-semibold">{wide?.legend ?? "照片"}</legend>
      <input type="hidden" name={wide?.name ?? "photoPath"} value={current?.path ?? ""} />
      {current ? (
        // 存放空間的公開網址，不經過 Next.js 的圖片最佳化（後台只是預覽）。
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={current.url}
          alt="介紹頁上的樣子"
          className={wide ? "max-h-60 w-auto self-start rounded-lg border" : "size-36 rounded-full border object-cover"}
          style={wide ? undefined : { objectPosition: `50% ${position}%` }}
        />
      ) : (
        <p className="text-muted-foreground">還沒有{noun}。</p>
      )}
      <label htmlFor={id} className="font-semibold">
        {current ? `換一張${noun}` : `上傳${noun}`}
      </label>
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => upload(event.target.files?.[0])}
        className={inputClass}
      />
      <span className="text-sm text-muted-foreground">
        {wide ? wide.hint : "請用原始的長方形照片（不要先裁成圓形），介紹頁會自動裁成圓形。"}JPG、PNG、WebP，5 MB 以內。
        選好就會上傳，要按下面的儲存才會換上去。
      </span>
      {error && (
        <p role="alert" className={alertClass}>
          {error}
        </p>
      )}
      {current && (
        <button
          type="button"
          onClick={() => setCurrent(null)}
          className={cn(buttonVariants({ variant: "outline" }), buttonClass, "self-start")}
        >
          拿掉{noun}
        </button>
      )}
      {!wide && (
        <Field label="照片對準的位置" hint="頭或下巴被切掉時改這裡：臉在照片的上半部就選「偏上」。上面的圓形會跟著變。">
          <select
            name="photoFocus"
            value={position}
            onChange={(event) => setPosition(Number(event.target.value))}
            className={cn(inputClass, "sm:max-w-xs")}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      <LoadingOverlay show={uploading} label={`上傳${noun}中…`} />
    </fieldset>
  );
}
