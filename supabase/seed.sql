-- 本機開發用的假資料。改下面三個時間點再執行 `npm run db:reset`，就能看到首頁切換狀態。
-- 預設讓首頁顯示「報名中」。
-- 資料版本號（#26）平常在交易提交時才加；假資料中途要暫時關掉一些限制（alter table），有還沒執行的觸發器時不能改，
-- 所以這裡讓它們立即執行。
set constraints
  public.venues_data_version, public.venues_data_version_update, public.sessions_data_version,
  public.sessions_data_version_update, public.courses_data_version, public.courses_data_version_update,
  public.lunch_options_data_version, public.lunch_options_data_version_update,
  public.registrations_data_version, public.registration_courses_data_version
  immediate;
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

-- 場地也在開放報名前定案；假資料的年度已在報名中，建立時暫時關掉這條限制。
alter table public.venues disable trigger venues_locked_after_opening;
insert into public.venues (conference_id, position, region, name_zh, name_en, address_zh, address_en, features_zh, features_en)
select id, v.position, v.region, v.name_zh, v.name_en, v.address_zh, v.address_en, v.features_zh, v.features_en
from public.conferences, (values
  (1, 'north', '台北金華教堂', 'Taipei Jinhua Chapel', '台北市大安區金華街 183 號', 'No. 183, Jinhua St., Da''an Dist., Taipei', '另有午后動態；鄰近捷運東門站', 'Afternoon activities available; near MRT Dongmen Station'),
  (2, 'central', '台中大雅教堂', 'Taichung Daya Chapel', '台中市大雅區', 'Daya Dist., Taichung', '停車位充足', 'Plenty of parking'),
  (3, 'south', '高雄鳥松教堂', 'Kaohsiung Niaosong Chapel', '高雄市鳥松區', 'Niaosong Dist., Kaohsiung', '無障礙設施完善', '')
) as v(position, region, name_zh, name_en, address_zh, address_en, features_zh, features_en)
where year = 2027;
alter table public.venues enable trigger venues_locked_after_opening;

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

-- 大會特色：2026 的九項。只有幾項寫了介紹內容（其他的卡片不能點），有些英文故意留空。
insert into public.highlights (conference_id, position, name_zh, name_en, summary_zh, summary_en, description_zh, description_en)
select id, h.position, h.name_zh, h.name_en, h.summary_zh, h.summary_en, h.description_zh, h.description_en
from public.conferences, (values
  (1, '即席唱詩班', 'Impromptu choir', '跟著影片練唱〈主是我的牧羊人〉', 'Practise "The Lord Is My Shepherd" with the video',
    E'大會開幕式由現場姐妹組成即席唱詩班獻唱。\n\n## 練唱\n\n1. 先看[練唱影片](https://www.youtube.com/)\n2. 選好聲部：**女高音**或**女低音**\n3. 報名時勾選「即席唱詩班」',
    E'Sisters at the conference form an impromptu choir for the opening session.\n\n## Practice\n\n1. Watch the [practice video](https://www.youtube.com/)\n2. Choose your part: **soprano** or **alto**\n3. Tick "Choir" when you register'),
  (2, '領袖演講', 'Leader addresses', '', '', '', ''),
  (3, '靈性課程', 'Spiritual classes', '提昇內在靈魂的課程', 'Classes that lift the soul', '', ''),
  (4, '角落課程', 'Corner classes', '在靜謐、歡樂與手作中療癒心靈', '', '', ''),
  (5, '迷妳音樂會', 'Mini concert', '', '', '', ''),
  (6, '向貴賓致敬', 'Honouring our guests', '80 歲長輩，持守到底的美好榜樣', 'Sisters aged 80 and over, examples of enduring to the end', '', ''),
  (7, '與年長夫婦傳教士有約', 'Meet the senior missionary couples', '', '', '', ''),
  (8, '公益服務', 'Service project', '歡迎姐妹一起來參加', 'All sisters are welcome',
    E'今年的公益服務是製作新生兒包巾。\n\n| 要帶的東西 | 說明 |\n| --- | --- |\n| 剪刀 | 有的話請帶 |\n| 針線包 | 大會也有準備 |',
    ''),
  (9, '靜態展示', 'Exhibition', '', '', '', '')
) as h(position, name_zh, name_en, summary_zh, summary_en, description_zh, description_en)
where year = 2027;

-- 支聯會、支會名單（假資料，正式名單由後台維護）。最後一個支聯會已停用，報名表上不會出現。
insert into public.stakes (position, region, name_zh, name_en, is_active) values
  (1, 'north', '台北支聯會', 'Taipei Stake', true),
  (2, 'north', '台北西支聯會', 'Taipei West Stake', true),
  (3, 'central', '台中支聯會', 'Taichung Stake', true),
  (4, 'south', '高雄支聯會', 'Kaohsiung Stake', true),
  (5, 'north', '舊台北東支聯會', 'Former Taipei East Stake', false);

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
-- 金華教堂另有第四個場次「午后動態」，活動就是這個場次的課程，其他場地的報名表不會出現這個場次。
-- 正式環境的場次與課程在開放報名前建好；假資料的年度已在報名中，所以建立時暫時關掉這條限制。
alter table public.sessions disable trigger sessions_locked_after_opening;
alter table public.sessions disable trigger course_pairs_valid_after_session_change;
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
  (1, 1, '在家庭中研讀經文', 'Studying the scriptures as a family', '', '', 40),
  (1, 2, '家譜入門', 'Getting started with family history', '請帶手機', 'Please bring your phone', 1),
  (1, 3, '詩歌欣賞', 'Enjoying sacred music', '', '', null),
  (2, 1, '健康的飲食', 'Healthy eating', '', '', 30),
  (2, 2, '溝通與傾聽', 'Communicating and listening', '', '', 30),
  -- 成對課程：第一場與第二場連著上，下面設成一組。
  (1, 4, '婦女會手冊研習（上）', 'Relief Society handbook study (part 1)', '與第二場的（下）連堂', 'Continues in session 2', 25),
  (2, 3, '婦女會手冊研習（下）', 'Relief Society handbook study (part 2)', '', '', 25),
  (3, 1, '手作卡片', 'Handmade cards', '材料由大會提供', 'Materials provided', 20),
  (3, 2, '分享見證', 'Sharing testimonies', '', '', null)
) as c(session_position, position, title_zh, title_en, description_zh, description_en, capacity)
  on c.session_position = s.position;

with afternoon as (
  insert into public.sessions (conference_id, venue_id, position, name_zh, name_en)
  select conference_id, id, 4, '午后動態 14:30–16:00', 'Afternoon activity, 14:30–16:00'
  from public.venues
  where name_zh = '台北金華教堂'
  returning id, conference_id
)
insert into public.courses (conference_id, session_id, position, title_zh, title_en, description_zh, description_en, capacity)
select s.conference_id, s.id, c.position, c.title_zh, c.title_en, c.description_zh, c.description_en, c.capacity
from afternoon s, (values
  (1, '手作花圈', 'Wreath making', '材料由大會提供', 'Materials provided', 20),
  (2, '聖殿巡禮', 'Temple grounds walk', '步行約 20 分鐘', 'About a 20-minute walk', 30)
) as c(position, title_zh, title_en, description_zh, description_en, capacity);

-- 每個場地的手冊研習上下兩堂設成成對課程，選了其中一堂就會一起選另一堂。
alter table public.course_pairs disable trigger course_pairs_checked;
alter table public.course_pairs disable trigger course_pairs_stopped_together;
insert into public.course_pairs (conference_id, first_course_id, second_course_id)
select a.conference_id, a.id, b.id
from public.courses a
join public.sessions sa on sa.id = a.session_id
join public.sessions sb on sb.venue_id = sa.venue_id
join public.courses b on b.session_id = sb.id
where a.title_zh = '婦女會手冊研習（上）' and b.title_zh = '婦女會手冊研習（下）';
alter table public.course_pairs enable trigger course_pairs_checked;
alter table public.course_pairs enable trigger course_pairs_stopped_together;

-- 講師與分類（分類是同年度的一項大會特色）。有些英文講師故意留空，用來看缺漏警示與英文版退回中文。
update public.courses c
set speaker_zh = v.speaker_zh,
  speaker_en = v.speaker_en,
  highlight_id = (select h.id from public.highlights h where h.conference_id = c.conference_id and h.name_zh = v.category)
from (values
  ('在家庭中研讀經文', '林姊妹', 'Sister Lin', '靈性課程'),
  ('家譜入門', '蔡婷儀', '', '靈性課程'),
  ('詩歌欣賞', '', '', '迷妳音樂會'),
  ('溝通與傾聽', '陳姊妹', 'Sister Chen', '角落課程'),
  ('婦女會手冊研習（上）', '沈亦斌 姐妹、黃蘋 姐妹', '', '靈性課程'),
  ('婦女會手冊研習（下）', '沈亦斌 姐妹、黃蘋 姐妹', '', '靈性課程'),
  ('手作卡片', '', '', '角落課程'),
  ('手作花圈', '余心愛', 'Yu Hsin-ai', '公益服務')
) as v(title, speaker_zh, speaker_en, category)
where c.title_zh = v.title;

-- 教室是內部資料，只有後台看得到。
insert into public.course_classrooms (course_id, classroom)
select c.id, case c.position when 1 then '禮拜堂' when 2 then '文化廳' else c.position || '0' || s.position || ' 教室' end
from public.courses c
join public.sessions s on s.id = c.session_id;

alter table public.sessions enable trigger sessions_locked_after_opening;
alter table public.sessions enable trigger course_pairs_valid_after_session_change;
alter table public.courses enable trigger courses_locked_after_opening;

-- 大會程序：2026 的時間軸（設計稿 docs/design/homepage-mobile.dc.html 的 VENUES）。三個場地共用，各場地的地點不同；
-- 三個場次接到第一、二、三場次，金華的午后動態接到「公益服務說明」。有些英文故意留空。
insert into public.agenda_items (conference_id, position, start_time, end_time, name_zh, name_en)
select id, a.position, a.start_time, a.end_time, a.name_zh, a.name_en
from public.conferences, (values
  (1, time '08:30', time '09:15', '報到', 'Check-in'),
  (2, '09:30', '10:30', '開幕式', 'Opening session'),
  (3, '11:00', '11:50', '第一場次', 'Session 1'),
  (4, '11:50', '12:30', '午餐聯誼', 'Lunch'),
  (5, '12:30', '13:15', '公益服務說明', ''),
  (6, '13:30', '14:15', '第二場次', 'Session 2'),
  (7, '14:30', '15:15', '第三場次', 'Session 3'),
  (8, '15:30', '16:30', '閉幕式', 'Closing session')
) as a(position, start_time, end_time, name_zh, name_en)
where year = 2027;

insert into public.agenda_item_parts (conference_id, agenda_item_id, position, name_zh, name_en, highlight_id)
select i.conference_id, i.id, p.position, p.name_zh, p.name_en,
  (select h.id from public.highlights h where h.conference_id = i.conference_id and h.name_zh = p.highlight)
from public.agenda_items i
join (values
  ('開幕式', 1, '即席唱詩班', 'Impromptu choir', '即席唱詩班'),
  ('開幕式', 2, '80 歲年長貴賓', 'Honoured guests aged 80 and over', '向貴賓致敬'),
  ('開幕式', 3, '領袖演講', 'Leader address', '領袖演講'),
  ('閉幕式', 1, '見證', '', null),
  ('閉幕式', 2, '領袖演講', 'Leader address', '領袖演講')
) as p(item, position, name_zh, name_en, highlight) on p.item = i.name_zh;

insert into public.agenda_item_venues (conference_id, agenda_item_id, venue_id, place_zh, place_en, note_zh, note_en, session_id)
select i.conference_id, i.id, v.id, coalesce(x.place_zh, ''), coalesce(x.place_en, ''), coalesce(x.note_zh, ''), '',
  (select s.id from public.sessions s where s.venue_id = v.id and s.position = x.session_position)
from public.agenda_items i
join public.venues v on v.conference_id = i.conference_id
join (values
  ('開幕式', '台北金華教堂', '一樓大會堂', '1F Assembly Hall', null, null),
  ('開幕式', '台中大雅教堂', '3F 大會堂', '3F Assembly Hall', null, null),
  ('開幕式', '高雄鳥松教堂', '3F 大會堂', '', null, null),
  ('第一場次', '台北金華教堂', null, null, null, 1),
  ('第一場次', '台中大雅教堂', null, null, null, 1),
  ('第一場次', '高雄鳥松教堂', null, null, null, 1),
  ('午餐聯誼', '台中大雅教堂', '3F 康樂廳', '3F Recreation Hall', null, null),
  ('公益服務說明', '台北金華教堂', '一樓大會堂', '1F Assembly Hall',
    '或改參加午后動態「聲之靜·心之境」・三樓大會堂（名額有限，報名時選擇）', 4),
  ('公益服務說明', '台中大雅教堂', '3F 大會堂', '', null, null),
  ('公益服務說明', '高雄鳥松教堂', '3F 大會堂', '', null, null),
  ('第二場次', '台北金華教堂', null, null, null, 2),
  ('第二場次', '台中大雅教堂', null, null, null, 2),
  ('第二場次', '高雄鳥松教堂', null, null, null, 2),
  ('第三場次', '台北金華教堂', null, null, null, 3),
  ('第三場次', '台中大雅教堂', null, null, null, 3),
  ('第三場次', '高雄鳥松教堂', null, null, null, 3),
  ('閉幕式', '台北金華教堂', '一樓大會堂', '1F Assembly Hall', null, null),
  ('閉幕式', '台中大雅教堂', '3F 大會堂', '3F Assembly Hall', null, null),
  ('閉幕式', '高雄鳥松教堂', '3F 大會堂', '', null, null)
) as x(item, venue, place_zh, place_en, note_zh, session_position) on x.item = i.name_zh and x.venue = v.name_zh;

-- 午餐也在開放報名前定案，建立時同樣暫時關掉限制。
alter table public.lunch_options disable trigger lunch_options_locked_after_opening;

-- 每個場地各自的午餐，有的限量、有的不限。金華教堂的素食便當只有 1 份，下面的假報名會訂走。
insert into public.lunch_options (conference_id, venue_id, position, name_zh, name_en, description_zh, description_en, capacity)
select v.conference_id, v.id, l.position, l.name_zh, l.name_en, l.description_zh, l.description_en,
  case when v.name_zh = '台北金華教堂' and l.position = 2 then 1 else l.capacity end
from public.venues v, (values
  (1, '葷食便當', 'Bento (meat)', '附飲料', 'Drink included', 200),
  (2, '素食便當', 'Bento (vegetarian)', '蛋奶素', 'Lacto-ovo vegetarian', 50),
  (3, '自備午餐', 'Bringing my own lunch', '', '', null)
) as l(position, name_zh, name_en, description_zh, description_en, capacity);

alter table public.lunch_options enable trigger lunch_options_locked_after_opening;

-- 一筆假報名，佔掉金華教堂「家譜入門」（容量 1）唯一的名額，選課畫面會顯示「已額滿」；
-- 也訂走唯一一份素食便當。
with registration as (
  insert into public.registrations (
    conference_id, venue_id, stake_id, ward_id, name, phone, portrait_consented_at,
    lunch_option_id, choir_part, services, printed_handbook, locale
  )
  select v.conference_id, v.id, w.stake_id, w.id, '測試報名者', '0912000000', now(),
    l.id, 'soprano', '{reception}', true, 'zh'
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
-- 第一場選家譜入門，第二、三場選第一門課，午后動態不參加。
where s.position <= 3 and case when s.position = 1 then c.title_zh = '家譜入門' else c.position = 1 end;
