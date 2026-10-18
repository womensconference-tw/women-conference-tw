import { useRef } from "react";

/*
 * 送出編號（見 20261103000000_submission_keys.sql）：送出報名、修改報名時帶給伺服器，
 * 回應斷掉後重按沿用同一個，資料庫就不會多存一筆、多寄一封信。
 * 沒收到回應（連線中斷），或回應是「系統出了問題」（資料庫可能已經存好、只是回給網站伺服器時斷了）時，
 * 不確定有沒有存下，同一份內容重按沿用同一個編號；內容改了（她以為沒存到、順手改了再送）就換新的。
 * 其他回應之後換新的：成功了，代報、「再幫一位報名」是新的一筆；
 * 被拒絕了（額滿、欄位不對等），什麼都沒存，這個編號也沒被用掉。
 */

/** 上一次送出的編號與內容。 */
export type Submission = { key: string; sent: string };

/** 這次送出要用的編號：內容和上一次一樣就沿用，不然換新的。 */
export function nextSubmission(previous: Submission | null, content: unknown, newKey = randomKey): Submission {
  const sent = JSON.stringify(content);
  return previous?.sent === sent ? previous : { key: newKey(), sent };
}

// 不是 https 的網址（例如用區網 IP 開本機）沒有 crypto.randomUUID：送空的，由伺服器換一個新的（照常存下）。
function randomKey(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : "";
}

/** 這個回應之後要不要換新的送出編號：只有「系統出了問題」不確定有沒有存下，沿用。 */
export function settled(result: { ok: true } | { ok: false; errors: { form?: string } }): boolean {
  return result.ok || result.errors.form !== "unknown";
}

/** 報名表用的送出編號：keyFor(內容) 取得這次送出的編號，收到確定的回應（見 settled）後呼叫 answered() 換新的。 */
export function useSubmissionKey() {
  const last = useRef<Submission | null>(null);
  return {
    keyFor(content: unknown): string {
      last.current = nextSubmission(last.current, content);
      return last.current.key;
    },
    answered() {
      last.current = null;
    },
  };
}
