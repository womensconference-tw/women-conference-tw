/** 連結只接受 http(s) 網址；只寫「https://」沒填網址的，也當成不是連結。公開頁面與後台編輯器共用（#75、#88）。 */
export const SAFE_URL = /^https?:\/\/[^\s/?#]/i;
