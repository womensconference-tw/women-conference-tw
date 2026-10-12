import type { Locale } from "./locale";

/*
 * 固定介面文字（按鈕、欄位名、錯誤訊息）的中英對照檔。每年會換的內容放資料庫，不放這裡。
 * 中文是基準：英文少了鍵或多了鍵，型別檢查都會失敗。
 * 要帶入資料的文字寫成函式，參數已經格式化好。
 */
const zh = {
  site: {
    title: "台灣姐妹大會",
    description: "台灣姐妹大會官方網站與報名系統",
  },
  // 切換按鈕顯示「要切換過去的那個語言」，用該語言自己的寫法。
  languageSwitch: "English",
  home: {
    comingSoon: "大會資訊即將公布，請稍後再來看看。",
    conferenceDate: (year: number, date: string) => `${year} 年大會：${date}`,
    registrationOpensAt: (dateTime: string) => `報名將於 ${dateTime} 開放`,
    registrationOpensSoon: "報名開放時間即將公布",
    registrationOpenUntil: (dateTime: string) => `報名進行中，${dateTime} 截止`,
    registrationOpen: "報名進行中",
    registrationClosed: "報名已截止",
    conferenceTime: (start: string, end: string) => `時間：${start} 至 ${end}`,
    conferenceStartsAt: (start: string) => `時間：${start} 開始`,
    simultaneous: (places: string) => `${places}同步舉行`,
    registerButton: "我要報名",
    registerNotOpenYet: "我要報名（尚未開放）",
    closedCanStillLookUp: "您仍然可以查詢自己的報名資料。",
    lookupHeading: "已報名查詢",
    lookupDescription: "輸入姓名和電話（沒有電話的姐妹請用報名編號），就能看到您的報名資料。",
    lookupButton: "查詢我的報名",
    stepsHeading: "報名三步驟",
    steps: ["填寫姓名、電話與所屬支會", "選擇要參加的場地與課程", "確認資料無誤後送出"],
    venuesHeading: "大會場地",
    venueAddress: "地址：",
    venueFeatures: "特色：",
    helpHeading: "需要幫忙嗎？",
    helpDescription: "報名遇到困難，請用 LINE 聯絡大會管理員，會有專人回覆您。",
    helpLineId: (id: string) => `管理員 LINE ID：${id}`,
    helpLineButton: "用 LINE 加管理員好友",
    helpLineComingSoon: "管理員的聯絡方式即將公布。",
    aboutHeading: "關於大會",
    themeScriptureHeading: "主題經文",
    welcomeHeading: "歡迎詞",
    faqHeading: "常見問題",
  },
  register: {
    title: "報名台灣姐妹大會",
    stepProgress: (current: number, total: number, title: string) =>
      `第 ${current} 步（共 ${total} 步）：${title}`,
    stepTitles: ["基本資料", "選擇場地", "選擇課程", "肖像權同意與確認"],
    nameLabel: "姓名",
    phoneLabel: "電話",
    phoneHint: "手機或家裡電話都可以。幫家人報名，可以填您自己的電話。",
    noPhoneLabel: "我沒有電話（送出後系統會給您一組報名編號）",
    emailLabel: "Email（選填）",
    lineIdLabel: "LINE ID（選填）",
    stakeLabel: "支聯會",
    wardLabel: "支會",
    wardsOf: (stake: string) => `請選擇${stake}的支會`,
    findWardButton: "不知道支聯會？直接找支會",
    findWardLabel: "輸入支會名稱的一部分，例如「新店」",
    findWardNoMatch: "找不到符合的支會。請換個字試試，或從上面的支聯會找。",
    wardWithStake: (ward: string, stake: string) => `${ward}（${stake}）`,
    venueLabel: "場地",
    venueHint: "任何一個場地都可以選，不限所屬的支聯會。",
    coursesHint: "每個場次請選一門課。標示「已額滿」的課程不能選。",
    noCourses: "這個場地不用選課，請按「下一步」。",
    courseFull: "已額滿",
    sessionAllFull: "這個場次的課程都額滿了。請回上一步改選其他場地，或聯絡大會管理員。",
    portraitConsentHeading: "肖像權同意",
    portraitConsentText:
      "大會當天會拍攝照片與影片。我同意大會使用拍到我的影像，作為教會內部的大會紀錄，以及教會網站、社群媒體與往後大會的介紹。",
    portraitConsentCheckbox: "我已閱讀並同意",
    reviewHeading: "請確認您的資料",
    notProvided: "未填",
    noPhone: "沒有電話",
    nextButton: "下一步",
    backButton: "回上一步",
    submitButton: "確認送出報名",
    submittingButton: "送出中，請稍候…",
    fixErrors: "有資料需要修改，請看紅字的說明。",
    notOpenHeading: "目前不在報名期間",
    notOpenDescription: "報名開放與截止的時間請看首頁。",
    homeButton: "回首頁",
    errors: {
      nameRequired: "請填寫姓名。",
      nameTooLong: "姓名太長了，請填 50 個字以內。",
      phoneRequired: "請填寫電話。如果沒有電話，請勾選下方的「我沒有電話」。",
      phoneInvalid: "電話號碼格式不對，請只填數字，例如 0912345678 或 02-23456789。",
      emailInvalid: "Email 格式不對，請檢查有沒有「@」和「.」，例如 name@example.com。沒有 Email 可以不填。",
      lineIdTooLong: "LINE ID 太長了，請填 50 個字以內。",
      stakeRequired: "請選擇支聯會。",
      wardRequired: "請選擇支會。",
      wardNotInStake: "這個支會不在您選的支聯會裡，請重新選擇支會。",
      venueRequired: "請選擇場地。",
      courseRequired: "每個場次都要選一門課，請選擇還沒選的場次。",
      courseFull: "您選的課程剛剛被選滿了，請改選其他課程。其他資料都還在，不用重填。",
      portraitConsentRequired: "需要同意肖像權才能報名。如有疑問，請先聯絡大會管理員。",
      notOpen: "目前不在報名期間，報名沒有送出。",
      unknown: "系統暫時出了問題，報名沒有送出。請稍後再試一次，或聯絡大會管理員。",
    },
    done: {
      heading: "報名完成",
      description: "以下是您的報名資料：",
      registrationNumberLabel: "您的報名編號",
      registrationNumberHint: "查詢報名時，請用姓名和這組報名編號。請一定要記下來。",
      screenshotHint: "您沒有填 Email，請把這個畫面截圖保存，或請家人幫忙記下來。",
    },
  },
};

export type Messages = typeof zh;

const en = {
  site: {
    title: "Taiwan Women's Conference",
    description: "Official website and registration for the Taiwan Women's Conference",
  },
  languageSwitch: "中文",
  home: {
    comingSoon: "Conference details are coming soon. Please check back later.",
    conferenceDate: (year: number, date: string) => `${year} Conference: ${date}`,
    registrationOpensAt: (dateTime: string) => `Registration opens ${dateTime} (Taiwan time)`,
    registrationOpensSoon: "The registration opening date will be announced soon",
    registrationOpenUntil: (dateTime: string) =>
      `Registration is open until ${dateTime} (Taiwan time)`,
    registrationOpen: "Registration is open",
    registrationClosed: "Registration has closed",
    conferenceTime: (start: string, end: string) => `Time: ${start} to ${end} (Taiwan time)`,
    conferenceStartsAt: (start: string) => `Time: starts at ${start} (Taiwan time)`,
    simultaneous: (places: string) => `Held at the same time in ${places}`,
    registerButton: "Register now",
    registerNotOpenYet: "Register now (not open yet)",
    closedCanStillLookUp: "You can still look up your registration.",
    lookupHeading: "Already registered?",
    lookupDescription:
      "Enter your name and phone number (or your registration number if you have no phone) to see your registration.",
    lookupButton: "Look up my registration",
    stepsHeading: "Register in three steps",
    steps: [
      "Enter your name, phone number and ward",
      "Choose your venue and classes",
      "Check your details and submit",
    ],
    venuesHeading: "Venues",
    venueAddress: "Address: ",
    venueFeatures: "Highlights: ",
    helpHeading: "Need help?",
    helpDescription:
      "If you have trouble registering, contact the conference administrator on LINE. A real person will reply.",
    helpLineId: (id: string) => `Administrator's LINE ID: ${id}`,
    helpLineButton: "Add the administrator on LINE",
    helpLineComingSoon: "The administrator's contact details will be announced soon.",
    aboutHeading: "About the conference",
    themeScriptureHeading: "Theme scripture",
    welcomeHeading: "Welcome",
    faqHeading: "Frequently asked questions",
  },
  register: {
    title: "Register for the Taiwan Women's Conference",
    stepProgress: (current: number, total: number, title: string) =>
      `Step ${current} of ${total}: ${title}`,
    stepTitles: ["Your details", "Choose a venue", "Choose your classes", "Photo consent and review"],
    nameLabel: "Name",
    phoneLabel: "Phone number",
    phoneHint:
      "A mobile or home number is fine. If you are registering a family member, you can use your own number.",
    noPhoneLabel: "I don't have a phone (you will get a registration number after submitting)",
    emailLabel: "Email (optional)",
    lineIdLabel: "LINE ID (optional)",
    stakeLabel: "Stake",
    wardLabel: "Ward",
    wardsOf: (stake: string) => `Choose your ward in ${stake}`,
    findWardButton: "Don't know your stake? Find your ward",
    findWardLabel: "Type part of your ward's name, for example \"Xindian\"",
    findWardNoMatch: "No ward matches. Try different words, or choose your stake above.",
    wardWithStake: (ward: string, stake: string) => `${ward} (${stake})`,
    venueLabel: "Venue",
    venueHint: "You can choose any venue, whichever stake you belong to.",
    coursesHint: "Please choose one class for each session. Classes marked \"Full\" can't be chosen.",
    noCourses: "There are no classes to choose at this venue. Please press \"Next\".",
    courseFull: "Full",
    sessionAllFull:
      "All classes in this session are full. Please go back and choose another venue, or contact the conference administrator.",
    portraitConsentHeading: "Photo consent",
    portraitConsentText:
      "Photos and videos will be taken at the conference. I agree that the conference may use images of me for the Church's internal record of the conference, and to introduce this and future conferences on Church websites and social media.",
    portraitConsentCheckbox: "I have read this and agree",
    reviewHeading: "Please check your details",
    notProvided: "Not provided",
    noPhone: "No phone",
    nextButton: "Next",
    backButton: "Back",
    submitButton: "Submit my registration",
    submittingButton: "Submitting, please wait…",
    fixErrors: "Some details need fixing. Please read the red messages.",
    notOpenHeading: "Registration is not open right now",
    notOpenDescription: "See the homepage for when registration opens and closes.",
    homeButton: "Back to the homepage",
    errors: {
      nameRequired: "Please enter your name.",
      nameTooLong: "Your name is too long. Please use 50 characters or fewer.",
      phoneRequired:
        "Please enter a phone number. If you don't have a phone, tick \"I don't have a phone\" below.",
      phoneInvalid:
        "This phone number doesn't look right. Please use digits only, for example 0912345678 or 02-23456789.",
      emailInvalid:
        "This email address doesn't look right. Check that it has \"@\" and \".\", for example name@example.com. You can leave it blank.",
      lineIdTooLong: "Your LINE ID is too long. Please use 50 characters or fewer.",
      stakeRequired: "Please choose your stake.",
      wardRequired: "Please choose your ward.",
      wardNotInStake: "This ward is not in the stake you chose. Please choose your ward again.",
      venueRequired: "Please choose a venue.",
      courseRequired: "Please choose one class for each session.",
      courseFull:
        "A class you chose has just filled up. Please choose another class. Everything else you entered is still here.",
      portraitConsentRequired:
        "You need to agree to the photo consent to register. If you have questions, please contact the conference administrator first.",
      notOpen: "Registration is not open right now. Your registration was not submitted.",
      unknown:
        "Something went wrong and your registration was not submitted. Please try again later, or contact the conference administrator.",
    },
    done: {
      heading: "You're registered",
      description: "Here are your registration details:",
      registrationNumberLabel: "Your registration number",
      registrationNumberHint:
        "Use your name and this registration number to look up your registration. Please write it down.",
      screenshotHint:
        "You didn't give an email address. Please take a screenshot of this page, or ask a family member to write it down.",
    },
  },
} satisfies Messages;

// `satisfies` 擋住缺鍵和多鍵；這行再擋住參數比中文少的函式（例如英文漏掉日期）。
// 這行出現「Type 'true' does not satisfy the expected type 'false'」就是英文和中文的形狀不同。
true satisfies Equal<Shape<typeof en>, Shape<Messages>>;

// 比較形狀前把文字一律當成 string、拿掉 readonly，`as const` 這種寫法才不會被誤判。
type Shape<T> = T extends string
  ? string
  : T extends (...args: infer Args) => string
    ? (...args: Args) => string
    : { -readonly [K in keyof T]: Shape<T[K]> };

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export const messages: Record<Locale, Messages> = { zh, en };
