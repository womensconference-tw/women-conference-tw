import "server-only";
import { cache } from "react";
import { getStaffMember } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";

/** 目前登入的工作人員。同一個請求裡的版面與頁面共用一次查詢。 */
export const getCurrentStaff = cache(async () => getStaffMember(await createClient()));
