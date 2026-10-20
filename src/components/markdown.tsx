import type { Element, Root } from "hast";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { ExternalLink } from "./external-link";

/*
 * 籌備委員會文字頁（大會簡介、主席的話、備忘錄）與大會特色介紹頁（#82）的 Markdown 排版（#75），後台與公開頁面共用。
 * - GitHub 風格的 Markdown（含表格）；每個換行都保留，舊的純文字內容照樣顯示。
 * - 不接受 HTML：react-markdown 把 HTML 當成文字顯示，不會變成頁面上的元素。
 * - 連結只接受 http(s)，在新分頁開；其他網址（javascript:、mailto:、站內路徑等）只顯示文字。
 * - 圖片不顯示，只留替代文字。
 * - 編號清單依層次是 1. → A. → a. → 1)，和籌備委員會備忘錄一致。
 */

// 只寫「https://」沒填網址的，也當成不是連結。
const SAFE_URL = /^https?:\/\/[^\s/?#]/i;

/** 只留 http(s) 網址，其他一律拿掉；元件再把沒有網址的連結畫成一般文字。 */
const urlTransform = (url: string) => (SAFE_URL.test(url) ? url : "");

/** 第幾層編號清單用哪種編號；超過四層就重複最後一種。 */
const ORDERED_LIST_STYLES = ["list-decimal", "list-[upper-alpha]", "list-[lower-alpha]", "list-[paren-decimal]"];

/** 在每個編號清單記下它是第幾層（外面包了幾層編號清單），排版時依層次換編號。 */
function rehypeOrderedListDepth() {
  return (tree: Root) => {
    const walk = (node: Root | Element, depth: number) => {
      for (const child of node.children) {
        if (child.type !== "element") continue;
        if (child.tagName === "ol") {
          child.properties.dataDepth = depth;
          walk(child, depth + 1);
        } else {
          walk(child, depth);
        }
      }
    };
    walk(tree, 0);
  };
}

const headingClass = "mt-2 font-bold break-words";

const components: Components = {
  // 頁面上每個文字頁的名稱是 h2，內容裡的標題從 h3 開始。
  h1: ({ children }) => <h3 className={`${headingClass} text-lead`}>{children}</h3>,
  h2: ({ children }) => <h4 className={`${headingClass} text-lg`}>{children}</h4>,
  h3: ({ children }) => <h5 className={headingClass}>{children}</h5>,
  h4: ({ children }) => <h6 className={headingClass}>{children}</h6>,
  h5: ({ children }) => <h6 className={headingClass}>{children}</h6>,
  h6: ({ children }) => <h6 className={headingClass}>{children}</h6>,
  p: ({ children }) => <p className="break-words">{children}</p>,
  img: ({ alt }) => (alt ? <span>{alt}</span> : null),
  ul: ({ children }) => <ul className="flex list-disc flex-col gap-1 pl-7">{children}</ul>,
  ol: ({ node, children, start }) => {
    const depth = Number(node?.properties.dataDepth ?? 0);
    const style = ORDERED_LIST_STYLES[Math.min(depth, ORDERED_LIST_STYLES.length - 1)];
    return (
      <ol start={start} className={`flex flex-col gap-1 pl-8 ${style}`}>
        {children}
      </ol>
    );
  },
  li: ({ children }) => <li className="break-words [&>ol]:mt-1 [&>ul]:mt-1">{children}</li>,
  blockquote: ({ children }) => <blockquote className="border-l-4 border-quote-line pl-4">{children}</blockquote>,
  // 表格在手機上左右捲動，不撐破版面。
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-left [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:whitespace-nowrap">
        {children}
      </table>
    </div>
  ),
  hr: () => <hr className="border-card-outline" />,
  // 縮排四格的文字（舊的純文字內容、在清單外按往內縮一層）會被當成程式碼，照樣用一般字型、保留換行。
  pre: ({ children }) => <pre className="pl-8 font-sans whitespace-pre-wrap break-words [&_code]:font-sans">{children}</pre>,
};

/** newTabLabel：連結後面給讀螢幕軟體的「在新分頁開啟」，英文頁面換成英文。 */
export function Markdown({ children, newTabLabel }: { children: string; newTabLabel?: string }) {
  const withLinks: Components = {
    ...components,
    a: ({ href, children }) =>
      href && SAFE_URL.test(href) ? (
        <ExternalLink href={href} newTabLabel={newTabLabel}>
          {children}
        </ExternalLink>
      ) : (
        <span>{children}</span>
      ),
  };
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeOrderedListDepth]}
        urlTransform={urlTransform}
        components={withLinks}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
