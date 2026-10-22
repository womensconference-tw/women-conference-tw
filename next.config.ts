import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 讓同一個 Wi-Fi 的手機能用 192.168.x.x 開開發中的網站
  allowedDevOrigins: ["192.168.*.*"],
};

export default nextConfig;
