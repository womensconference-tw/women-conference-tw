"use client";

import { useState } from "react";
import { REGION_LABELS, REGIONS, STAFF_ROLE_LABELS, STAFF_ROLES, type Region, type StaffRole } from "@/lib/staff";
import { inputClass } from "../../ui";

/**
 * 角色與負責的區。總管理員不分區：選了總管理員時區的選單停用、不送出，
 * 免得看起來像報報組的「全區」。課務組要選一區，報報組選一區或全區。
 */
export function ScopeFields({ role: initialRole, region }: { role?: StaffRole; region?: Region | null }) {
  const [role, setRole] = useState<StaffRole>(initialRole ?? "course_team");
  const isAdmin = role === "admin";

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1">
        <span className="font-semibold">角色</span>
        <select
          name="role"
          value={role}
          onChange={(event) => setRole(event.target.value as StaffRole)}
          className={inputClass}
        >
          {STAFF_ROLES.map((candidate) => (
            <option key={candidate} value={candidate}>
              {STAFF_ROLE_LABELS[candidate]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">負責的區</span>
        {isAdmin ? (
          <select disabled value="" className={inputClass}>
            <option value="">總管理員不分區</option>
          </select>
        ) : (
          <select name="region" defaultValue={region ?? ""} required={role === "course_team"} className={inputClass}>
            <option value="" disabled={role === "course_team"}>
              {role === "course_team" ? "請選擇" : "全區"}
            </option>
            {REGIONS.map((candidate) => (
              <option key={candidate} value={candidate}>
                {REGION_LABELS[candidate]}
              </option>
            ))}
          </select>
        )}
        <span className="text-sm text-muted-foreground">
          {isAdmin ? "總管理員看得到全部、可以修改。" : "課務組要選一區；報報組可以選一區或全區。"}
        </span>
      </label>
    </div>
  );
}
