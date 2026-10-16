import { alertClass, noticeClass } from "./ui";

/**
 * 上一個動作的結果，放在頁面最上面。動作做完導向 `?done=<代碼>` 或 `?error=<代碼>`，這裡換成訊息。
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
  return (
    <>
      {doneMessage && (
        <p role="status" className={noticeClass}>
          {doneMessage}
        </p>
      )}
      {errorMessage && (
        <p role="alert" className={alertClass}>
          {errorMessage}
        </p>
      )}
    </>
  );
}
