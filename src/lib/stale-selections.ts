import type {
  CourseChoices,
  ExtraChoices,
  RegistrationError,
  RegistrationErrors,
  RegistrationField,
  RegistrationInput,
} from "./registration";
import type { LimitedOption, RegistrationOptions } from "./registration-options";

/**
 * 已經不在名單裡或剛額滿的選擇：要清掉的值、整理後的選課與午餐等選擇、要顯示的錯誤，
 * 以及已經不用回答、錯誤要收起的題目（場地的午餐或午后動態全被刪掉時）。
 * 剛額滿的選擇也取消選取並標出來，不必等再次送出才被拒絕。
 * 選的課已經不在原本那個場次（被刪除，或被管理員移到別的場次）時，清掉那個場次的選擇請她重選，
 * 不會不知不覺換到別的時段。
 * 修改報名時（editing）支聯會、支會不能改，不檢查；她原本已佔的選項（heldIds）就算額滿也照樣保留。
 */
export function staleSelections(
  input: RegistrationInput,
  choices: CourseChoices,
  extras: ExtraChoices,
  options: RegistrationOptions,
  heldIds: string[],
  editing: boolean,
): {
  changes: Partial<RegistrationInput>;
  choices: CourseChoices;
  extras: ExtraChoices;
  errors: RegistrationErrors;
  dropped: RegistrationField[];
} {
  const changes: Partial<RegistrationInput> = {};
  const errors: RegistrationErrors = {};
  const dropped: RegistrationField[] = [];
  const stake = options.stakes.find((option) => option.id === input.stakeId);
  // 修改時支聯會、支會不能改，停用了也照樣是她報名當下的那一個，不檢查。
  if (!editing && input.stakeId && !stake) {
    changes.stakeId = "";
    changes.wardId = "";
    errors.stake = "stakeUnavailable";
  } else if (!editing && input.wardId && !stake?.wards.some((ward) => ward.id === input.wardId)) {
    changes.wardId = "";
    errors.ward = "wardUnavailable";
  }
  if (input.venueId && !options.venues.some((venue) => venue.id === input.venueId)) {
    changes.venueId = "";
    errors.venue = "venueUnavailable";
    return {
      changes,
      choices: {},
      extras: { printedHandbook: extras.printedHandbook },
      errors,
      dropped,
    };
  }
  const venue = options.venues.find((option) => option.id === input.venueId);
  // 她原本已佔的選項就算額滿也照樣是她的。
  const isFull = (option: LimitedOption) => option.isFull && !heldIds.includes(option.id);
  const keptExtras = { ...extras };
  const checkExtra = (
    key: "lunch" | "afternoonActivity",
    options: LimitedOption[],
    unavailable: RegistrationError,
    full: RegistrationError,
  ) => {
    const choice = extras[key];
    if (venue && options.length === 0) {
      delete keptExtras[key];
      dropped.push(key);
      return;
    }
    if (!choice) return;
    const option = options.find((candidate) => candidate.id === choice);
    if (!option || isFull(option)) {
      delete keptExtras[key];
      errors[key] = option ? full : unavailable;
    }
  };
  checkExtra("lunch", venue?.lunchOptions ?? [], "lunchUnavailable", "lunchFull");
  checkExtra(
    "afternoonActivity",
    venue?.afternoonActivities ?? [],
    "afternoonActivityUnavailable",
    "afternoonActivityFull",
  );
  const sessions = venue?.sessions ?? [];
  const kept: CourseChoices = {};
  for (const [sessionId, courseId] of Object.entries(choices)) {
    const course = sessions
      .find((option) => option.id === sessionId)
      ?.courses.find((option) => option.id === courseId);
    if (courseId === null ? sessions.some((option) => option.id === sessionId) : course && !isFull(course)) {
      kept[sessionId] = courseId;
    } else if (courseId !== null) {
      errors.courses = course ? "courseFull" : "courseRequired";
    }
  }
  return { changes, choices: kept, extras: keptExtras, errors, dropped };
}
