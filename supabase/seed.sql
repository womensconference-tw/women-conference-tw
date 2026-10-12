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
