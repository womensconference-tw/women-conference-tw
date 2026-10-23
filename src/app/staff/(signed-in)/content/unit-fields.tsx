"use client";

import { useState } from "react";
import { REGION_LABELS, REGIONS, type Region } from "@/lib/staff";
import { inputClass } from "../../ui";

/** 人物可選的支聯會：啟用中的，加上這位人物原本選的（可能已經停用）。支會也一樣。 */
export type UnitStake = { id: string; name: string; region: Region; wards: { id: string; name: string }[] };

/**
 * 人物的支聯會與支會：從支聯會名單選，支聯會依區分組；支會只列出所選支聯會底下的。
 * 介紹頁的北／中／南區按鈕跟著所選的支聯會。傳教士只選支聯會（服務地區另外打字），不顯示支會選單。
 */
export function UnitFields({
  stakes,
  stakeId: initialStakeId,
  wardId,
  withWard,
}: {
  stakes: UnitStake[];
  stakeId: string;
  wardId: string;
  withWard: boolean;
}) {
  const [stakeId, setStakeId] = useState(initialStakeId);
  const stake = stakes.find((candidate) => candidate.id === stakeId);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1">
        <span className="font-semibold">支聯會</span>
        <select
          name="stakeId"
          value={stakeId}
          onChange={(event) => setStakeId(event.target.value)}
          className={inputClass}
        >
          <option value="">不寫支聯會</option>
          {REGIONS.map((region) => (
            <optgroup key={region} label={REGION_LABELS[region]}>
              {stakes
                .filter((candidate) => candidate.region === region)
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">
          {withWard ? "介紹頁的北／中／南區按鈕依這個支聯會的區。" : "選傳教士在台灣服務的支聯會，介紹頁的北／中／南區按鈕依這個支聯會的區。"}
        </span>
      </label>
      {withWard && (
        <label className="flex flex-col gap-1">
          <span className="font-semibold">支會（或分會）</span>
          {/* 換支聯會時重畫，選單回到「不寫支會」，不會留著別的支聯會的支會。 */}
          <select
            key={stakeId}
            name="wardId"
            defaultValue={stakeId === initialStakeId ? wardId : ""}
            disabled={!stake}
            className={inputClass}
          >
            <option value="">{stake ? "不寫支會" : "請先選支聯會"}</option>
            {stake?.wards.map((ward) => (
              <option key={ward.id} value={ward.id}>
                {ward.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
