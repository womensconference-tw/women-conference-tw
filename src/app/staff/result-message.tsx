import { Suspense } from "react";
import { ResultDialog } from "./result-dialog";

/**
 * 上一個動作的結果，用跳出的視窗顯示（ResultDialog）。動作做完導向 `?done=<代碼>` 或 `?error=<代碼>`，這裡換成訊息。
 * 只認得自己列出的代碼（用 Object.hasOwn，`?error=__proto__` 之類的不會被當成訊息）。
 */
export async function ResultMessage({
  searchParams,
  done,
  errors,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  done: Record<string, string>;
  errors: Record<string, string>;
}) {
  const params = await searchParams;
  const message = (messages: Record<string, string>, code: unknown) =>
    typeof code === "string" && Object.hasOwn(messages, code) ? messages[code] : undefined;
  const doneMessage = message(done, params.done);
  const errorMessage = message(errors, params.error);
  // 錯誤優先：同時有兩個代碼時（網址被改過），不要讓「完成」蓋過錯誤。
  const result = errorMessage
    ? ({ kind: "error", message: errorMessage } as const)
    : doneMessage
      ? ({ kind: "done", message: doneMessage } as const)
      : null;
  if (!result) return null;
  // ResultDialog 讀網址參數（useSearchParams），要包在 Suspense 裡。
  return (
    <Suspense>
      <ResultDialog key={`${result.kind}:${result.message}`} {...result} />
    </Suspense>
  );
}
