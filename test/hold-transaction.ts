import type { TransactionSql } from "postgres";
import { databaseClient } from "./supabase";

/**
 * 在一個還沒結束的資料庫交易裡做 hold，交易開著時呼叫 submit（送出、修改或取消）；
 * 確認 submit 的送出函式真的卡在等這個交易的鎖之後，再做 thenDo（有給的話），才結束交易，回傳 submit 的結果。
 * 送出函式一直沒有等這個交易（例如沒有上鎖），測試直接失敗，不靠時間碰運氣。
 * waitingFor 是 submit 執行的資料庫函式名稱的規則運算式，預設是送出、修改、取消報名。
 */
export async function submitWhileHolding<T>(
  hold: (tx: TransactionSql) => Promise<unknown>,
  submit: () => Promise<T>,
  thenDo?: (tx: TransactionSql) => Promise<unknown>,
  waitingFor = "(submit|update|cancel)_registration",
): Promise<T> {
  const sql = databaseClient();
  const watcher = databaseClient();
  let release!: () => void;
  const mayCommit = new Promise<void>((resolve) => (release = resolve));
  let held!: (pid: number) => void;
  const holding = new Promise<number>((resolve) => (held = resolve));
  const transaction = sql.begin(async (tx) => {
    const [{ pid }] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
    await hold(tx);
    held(pid);
    await mayCommit;
    await thenDo?.(tx);
  });
  try {
    // 交易在通知之前就失敗（例如 hold 的 SQL 有錯）時，直接把錯誤拋出來，不要一直等下去。
    const holderPid = await Promise.race([
      holding,
      transaction.then(() => {
        throw new Error("交易結束了卻沒有進入等待狀態");
      }),
    ]);
    const submitted = submit();
    // 只認正在執行 waitingFor 的函式、而且被這個交易擋住的連線，其他連線的等待不算。
    for (let waited = 0; ; waited += 50) {
      const [{ blocked }] = await watcher<{ blocked: boolean }[]>`
        select exists (
          select 1 from pg_stat_activity
          where ${holderPid}::int = any(pg_blocking_pids(pid))
            and query ~ ${waitingFor}
        ) as blocked`;
      if (blocked) break;
      if (waited > 3000) throw new Error("送出函式沒有等那個交易的鎖：可能沒有上鎖");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    release();
    // 互相等待時資料庫也可能中止這個交易（不一定是 submit 那邊），那不是 submit 的問題。
    await transaction.catch((error) => {
      if (error?.code !== "40P01") throw error;
    });
    return await submitted;
  } finally {
    release();
    await transaction.catch(() => {});
    await Promise.all([sql.end(), watcher.end()]);
  }
}
