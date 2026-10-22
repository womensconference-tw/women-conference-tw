import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

/**
 * 僅供 npm run dev：允許從這台電腦各網卡的確切 IPv4 位址載入開發資源與熱更新，同一個 Wi-Fi 的手機才能開開發中的網站。
 * 可能包含 VPN 或虛擬網卡的位址。不使用萬用字元：192.168.*.* 的 * 也會配到網域名稱，例如 192.168.attacker.com（Codex 審查）。
 * 換網路後請重開 npm run dev。正式建置不讀網卡（Codex 審查）。
 */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((address) => address.family === "IPv4" && !address.internal)
    .map((address) => address.address);
}

export default function nextConfig(phase: string): NextConfig {
  return phase === PHASE_DEVELOPMENT_SERVER ? { allowedDevOrigins: lanAddresses() } : {};
}
