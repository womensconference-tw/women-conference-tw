"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * 告訴 server action 這次表單是由 JavaScript 送出的：伺服器產生的 HTML 裡值是空的，
 * 瀏覽器跑起 JavaScript 之後才變成 "1"。
 */
export function EnhancedInput() {
  const enhanced = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return <input type="hidden" name="enhanced" value={enhanced ? "1" : ""} />;
}
