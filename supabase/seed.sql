-- 本機開發用的假資料。改下面三個時間點再執行 `npm run db:reset`，就能看到首頁切換狀態。
-- 預設讓首頁顯示「報名中」。
insert into public.conferences (
  year,
  conference_date,
  announce_at,
  registration_opens_at,
  registration_closes_at,
  is_current,
  start_time,
  end_time,
  theme_scripture_zh,
  theme_scripture_en,
  theme_scripture_reference_zh,
  theme_scripture_reference_en,
  welcome_zh,
  welcome_en,
  admin_line_id
) values (
  2027,
  '2027-05-15',
  '2026-09-01 09:00+08',  -- 公告上線
  '2026-10-01 09:00+08',  -- 報名開放
  '2027-04-30 23:59+08',  -- 報名截止
  true,
  '09:00',
  '16:00',
  '你的兒女都要受耶和華的教訓，你的兒女必大享平安。',
  'And all thy children shall be taught of the Lord; and great shall be the peace of thy children.',
  '以賽亞書 54:13',
  'Isaiah 54:13',
  E'親愛的姐妹們：\n\n歡迎參加台灣姐妹大會！這一天我們在三個場地同步聚會，一起學習、彼此鼓勵。',
  '',  -- 故意留空，用來看英文版退回中文
  'twwc-admin'
);

insert into public.venues (conference_id, position, name_zh, name_en, address_zh, address_en, features_zh, features_en)
select id, v.position, v.name_zh, v.name_en, v.address_zh, v.address_en, v.features_zh, v.features_en
from public.conferences, (values
  (1, '台北金華教堂', 'Taipei Jinhua Chapel', '台北市大安區金華街 183 號', 'No. 183, Jinhua St., Da''an Dist., Taipei', '另有午后動態；鄰近捷運東門站', 'Afternoon activities available; near MRT Dongmen Station'),
  (2, '台中大雅教堂', 'Taichung Daya Chapel', '台中市大雅區', 'Daya Dist., Taichung', '停車位充足', 'Plenty of parking'),
  (3, '高雄鳥松教堂', 'Kaohsiung Niaosong Chapel', '高雄市鳥松區', 'Niaosong Dist., Kaohsiung', '無障礙設施完善', '')
) as v(position, name_zh, name_en, address_zh, address_en, features_zh, features_en)
where year = 2027;

insert into public.faqs (conference_id, position, question_zh, question_en, answer_zh, answer_en)
select id, f.position, f.question_zh, f.question_en, f.answer_zh, f.answer_en
from public.conferences, (values
  (1, '參加大會要收費嗎？', 'Is there a fee?', '不用，大會免費參加。', 'No, the conference is free.'),
  (2, '可以幫家人報名嗎？', 'Can I register for a family member?', '可以，同一支電話可以幫多位姐妹報名。', 'Yes. One phone number can be used to register several sisters.'),
  (3, '報名後可以改場地嗎？', 'Can I change my venue after registering?', '報名截止前可以自己修改；截止後請聯絡管理員。', '')
) as f(position, question_zh, question_en, answer_zh, answer_en)
where year = 2027;

insert into public.custom_blocks (conference_id, position, title_zh, title_en, body_zh, body_en, button_label_zh, button_label_en, button_url)
select id, b.position, b.title_zh, b.title_en, b.body_zh, b.body_en, b.button_label_zh, b.button_label_en, b.button_url
from public.conferences, (values
  (1, '徵求即席唱詩班', 'Choir members wanted', '歡迎喜歡唱歌的姐妹，在報名時勾選「即席唱詩班」。', 'If you enjoy singing, choose "Choir" when you register.', '', '', null),
  (2, '大會手冊下載', '', '手冊內容將於大會前一週公布。', '', '前往教會網站', 'Go to the Church website', 'https://www.churchofjesuschrist.org/')
) as b(position, title_zh, title_en, body_zh, body_en, button_label_zh, button_label_en, button_url)
where year = 2027;

-- 支聯會、支會名單（假資料，正式名單由後台維護）。最後一個支聯會已停用，報名表上不會出現。
insert into public.stakes (position, name_zh, name_en, is_active) values
  (1, '台北支聯會', 'Taipei Stake', true),
  (2, '台北西支聯會', 'Taipei West Stake', true),
  (3, '台中支聯會', 'Taichung Stake', true),
  (4, '高雄支聯會', 'Kaohsiung Stake', true),
  (5, '舊台北東支聯會', 'Former Taipei East Stake', false);

insert into public.wards (stake_id, position, name_zh, name_en, is_active)
select s.id, w.position, w.name_zh, w.name_en, w.is_active
from public.stakes s
join (values
  ('台北支聯會', 1, '新店支會', 'Xindian Ward', true),
  ('台北支聯會', 2, '景美支會', 'Jingmei Ward', true),
  ('台北支聯會', 3, '木柵支會', 'Muzha Ward', true),
  ('台北支聯會', 4, '舊公館支會', 'Former Gongguan Ward', false),
  ('台北西支聯會', 1, '板橋支會', 'Banqiao Ward', true),
  ('台北西支聯會', 2, '三重支會', 'Sanchong Ward', true),
  ('台北西支聯會', 3, '新莊支會', 'Xinzhuang Ward', true),
  ('台中支聯會', 1, '大雅支會', 'Daya Ward', true),
  ('台中支聯會', 2, '西屯支會', 'Xitun Ward', true),
  ('台中支聯會', 3, '豐原支會', 'Fengyuan Ward', true),
  ('高雄支聯會', 1, '鳥松支會', 'Niaosong Ward', true),
  ('高雄支聯會', 2, '鳳山支會', 'Fengshan Ward', true),
  ('高雄支聯會', 3, '左營支會', 'Zuoying Ward', true),
  ('舊台北東支聯會', 1, '舊南港支會', 'Former Nangang Ward', true)
) as w(stake_name, position, name_zh, name_en, is_active) on w.stake_name = s.name_zh;

-- 每個場地三個場次，各有幾門課。有的限量、有的不限人數（容量空白）。
-- 正式環境的場次與課程在開放報名前建好；假資料的年度已在報名中，所以建立時暫時關掉這條限制。
alter table public.sessions disable trigger sessions_locked_after_opening;
alter table public.courses disable trigger courses_locked_after_opening;
insert into public.sessions (conference_id, venue_id, position, name_zh, name_en)
select v.conference_id, v.id, s.position, s.name_zh, s.name_en
from public.venues v, (values
  (1, '第一場 10:00–10:50', 'Session 1, 10:00–10:50'),
  (2, '第二場 11:00–11:50', 'Session 2, 11:00–11:50'),
  (3, '第三場 13:30–14:20', 'Session 3, 13:30–14:20')
) as s(position, name_zh, name_en);

insert into public.courses (conference_id, session_id, position, title_zh, title_en, description_zh, description_en, capacity)
select s.conference_id, s.id, c.position, c.title_zh, c.title_en, c.description_zh, c.description_en, c.capacity
from public.sessions s
join (values
  (1, 1, '在家庭中研讀經文', 'Studying the scriptures as a family', '講師：林姊妹', 'Teacher: Sister Lin', 40),
  (1, 2, '家譜入門', 'Getting started with family history', '請帶手機', 'Please bring your phone', 1),
  (1, 3, '詩歌欣賞', 'Enjoying sacred music', '', '', null),
  (2, 1, '健康的飲食', 'Healthy eating', '', '', 30),
  (2, 2, '溝通與傾聽', 'Communicating and listening', '講師：陳姊妹', 'Teacher: Sister Chen', 30),
  -- 成對課程：第一場與第二場連著上，下面設成一組。
  (1, 4, '婦女會手冊研習（上）', 'Relief Society handbook study (part 1)', '與第二場的（下）連堂', 'Continues in session 2', 25),
  (2, 3, '婦女會手冊研習（下）', 'Relief Society handbook study (part 2)', '', '', 25),
  (3, 1, '手作卡片', 'Handmade cards', '材料由大會提供', 'Materials provided', 20),
  (3, 2, '分享見證', 'Sharing testimonies', '', '', null)
) as c(session_position, position, title_zh, title_en, description_zh, description_en, capacity)
  on c.session_position = s.position;

-- 每個場地的手冊研習上下兩堂設成成對課程，選了其中一堂就會一起選另一堂。
alter table public.course_pairs disable trigger course_pairs_checked;
insert into public.course_pairs (conference_id, first_course_id, second_course_id)
select a.conference_id, a.id, b.id
from public.courses a
join public.sessions sa on sa.id = a.session_id
join public.sessions sb on sb.venue_id = sa.venue_id
join public.courses b on b.session_id = sb.id
where a.title_zh = '婦女會手冊研習（上）' and b.title_zh = '婦女會手冊研習（下）';
alter table public.course_pairs enable trigger course_pairs_checked;

-- 教室是內部資料，只有後台看得到。
insert into public.course_classrooms (course_id, classroom)
select c.id, case c.position when 1 then '禮拜堂' when 2 then '文化廳' else c.position || '0' || s.position || ' 教室' end
from public.courses c
join public.sessions s on s.id = c.session_id;

alter table public.sessions enable trigger sessions_locked_after_opening;
alter table public.courses enable trigger courses_locked_after_opening;

-- 午餐、午后動態也在開放報名前定案，建立時同樣暫時關掉限制。
alter table public.lunch_options disable trigger lunch_options_locked_after_opening;
alter table public.afternoon_activities disable trigger afternoon_activities_locked_after_opening;

-- 每個場地各自的午餐，有的限量、有的不限。金華教堂的素食便當只有 1 份，下面的假報名會訂走。
insert into public.lunch_options (conference_id, venue_id, position, name_zh, name_en, description_zh, description_en, capacity)
select v.conference_id, v.id, l.position, l.name_zh, l.name_en, l.description_zh, l.description_en,
  case when v.name_zh = '台北金華教堂' and l.position = 2 then 1 else l.capacity end
from public.venues v, (values
  (1, '葷食便當', 'Bento (meat)', '附飲料', 'Drink included', 200),
  (2, '素食便當', 'Bento (vegetarian)', '蛋奶素', 'Lacto-ovo vegetarian', 50),
  (3, '自備午餐', 'Bringing my own lunch', '', '', null)
) as l(position, name_zh, name_en, description_zh, description_en, capacity);

-- 只有金華教堂有午后動態，其他場地的報名表不會出現這一題。
insert into public.afternoon_activities (conference_id, venue_id, position, title_zh, title_en, description_zh, description_en, capacity)
select v.conference_id, v.id, a.position, a.title_zh, a.title_en, a.description_zh, a.description_en, a.capacity
from public.venues v, (values
  (1, '手作花圈', 'Wreath making', '14:30–16:00，材料由大會提供', '14:30–16:00, materials provided', 20),
  (2, '聖殿巡禮', 'Temple grounds walk', '14:30–16:00，步行約 20 分鐘', '14:30–16:00, about a 20-minute walk', 30)
) as a(position, title_zh, title_en, description_zh, description_en, capacity)
where v.name_zh = '台北金華教堂';

alter table public.lunch_options enable trigger lunch_options_locked_after_opening;
alter table public.afternoon_activities enable trigger afternoon_activities_locked_after_opening;

-- 一筆假報名，佔掉金華教堂「家譜入門」（容量 1）唯一的名額，選課畫面會顯示「已額滿」；
-- 也訂走唯一一份素食便當。
with registration as (
  insert into public.registrations (
    conference_id, venue_id, stake_id, ward_id, name, phone, portrait_consented_at,
    lunch_option_id, choir_part, services, printed_handbook
  )
  select v.conference_id, v.id, w.stake_id, w.id, '測試報名者', '0912000000', now(),
    l.id, 'soprano', '{reception}', true
  from public.venues v
  join public.lunch_options l on l.venue_id = v.id and l.name_zh = '素食便當',
    public.wards w
  where v.name_zh = '台北金華教堂' and w.name_zh = '新店支會'
  returning id, venue_id
)
insert into public.registration_courses (registration_id, venue_id, session_id, course_id)
select r.id, r.venue_id, c.session_id, c.id
from registration r
join public.sessions s on s.venue_id = r.venue_id
join public.courses c on c.session_id = s.id
-- 第一場選家譜入門，其他場次選第一門課。
where case when s.position = 1 then c.title_zh = '家譜入門' else c.position = 1 end;
