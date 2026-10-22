import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

// 僅供本機開發：這台電腦目前的區網 IP（終端機 Network: 那一行），同一個 Wi-Fi 的手機用這個網址開網站時，
// 允許載入開發資源與熱更新。只列確切的位址：萬用字元的 * 也會配到網域名稱（例如 192.168.attacker.com，Codex 審查）。
// 換了網路要重開 npm run dev。不影響正式網站。
const lanAddresses = Object.values(networkInterfaces())
  .flatMap((addresses) => addresses ?? [])
  .filter((address) => address.family === "IPv4" && !address.internal)
  .map((address) => address.address);

const nextConfig: NextConfig = {
  allowedDevOrigins: lanAddresses,
};

export default nextConfig;
