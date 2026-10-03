import { WORLD } from './places-world.js';

// Provinces / governorates / states and main cities for the place pickers, in each country's own language.
//
//   PLACES[countryCode][province] = [cities...]
//
// Naming rule: each country is written in ITS OWN language, as it appears on documents and addresses:
//   Arab countries  -> Arabic            Turkey -> Turkish (İstanbul, Şanlıurfa)   Germany -> German (Bayern, München)
//   France -> French     Sweden -> Swedish     Netherlands -> Dutch     USA / UK / Canada / Australia -> English
// Countries we cannot write in their own language (other scripts such as Japanese, Chinese, Russian,
// Persian) come from places-world.js in English. Cities are the main ones, not every village: every
// picker also has "غير ذلك (اكتب)". Searching ignores accents, so "Istanbul" finds "İstanbul".

/** { 'أضنة': ['أضنة'], ... } for countries whose provinces are named after their capital city. */
const same = (names) => Object.fromEntries(names.map((n) => [n, [n]]));

export const PLACES = {
  // ------------------------------------------------------------------ Syria
  SY: {
    'دمشق': ['دمشق'],
    'ريف دمشق': ['دوما', 'داريا', 'جرمانا', 'قدسيا', 'التل', 'الزبداني', 'يبرود', 'النبك', 'قطنا', 'الكسوة', 'صحنايا', 'جديدة عرطوز', 'معضمية الشام', 'حرستا', 'عربين', 'زملكا', 'سقبا', 'الضمير', 'مضايا', 'بلودان', 'رنكوس', 'القطيفة', 'الرحيبة'],
    'حلب': ['حلب', 'منبج', 'الباب', 'اعزاز', 'عفرين', 'جرابلس', 'السفيرة', 'دير حافر', 'تل رفعت', 'عين العرب', 'مارع', 'الأتارب', 'خناصر', 'مسكنة', 'نبل', 'الزهراء'],
    'حمص': ['حمص', 'تدمر', 'القصير', 'الرستن', 'تلكلخ', 'المخرم', 'الحولة', 'تلبيسة', 'القريتين', 'الفرقلس', 'صدد', 'كفرنان'],
    'حماة': ['حماة', 'سلمية', 'مصياف', 'محردة', 'السقيلبية', 'كفرزيتا', 'طيبة الإمام', 'صوران', 'عقيربات', 'حلفايا', 'السلمية'],
    'اللاذقية': ['اللاذقية', 'جبلة', 'القرداحة', 'الحفة', 'كسب'],
    'طرطوس': ['طرطوس', 'بانياس', 'صافيتا', 'دريكيش', 'الشيخ بدر', 'القدموس', 'أرواد'],
    'إدلب': ['إدلب', 'معرة النعمان', 'جسر الشغور', 'أريحا', 'سراقب', 'حارم', 'بنش', 'سلقين', 'خان شيخون', 'كفرنبل', 'الدانا', 'أطمة', 'معرة مصرين'],
    'الحسكة': ['الحسكة', 'القامشلي', 'رأس العين', 'المالكية', 'الشدادي', 'عامودا', 'القحطانية', 'تل تمر', 'الدرباسية', 'اليعربية'],
    'الرقة': ['الرقة', 'الطبقة', 'تل أبيض', 'الثورة', 'عين عيسى'],
    'دير الزور': ['دير الزور', 'البوكمال', 'الميادين', 'الصور', 'القورية', 'هجين', 'الشحيل', 'البصيرة', 'موحسن'],
    'السويداء': ['السويداء', 'شهبا', 'صلخد', 'القريا', 'ولغا', 'عريقة', 'شقا'],
    'درعا': ['درعا', 'إزرع', 'الصنمين', 'نوى', 'جاسم', 'طفس', 'بصرى الشام', 'الحراك', 'الشيخ مسكين', 'داعل', 'إنخل', 'الجيزة', 'المزيريب'],
    'القنيطرة': ['القنيطرة', 'خان أرنبة', 'البعث', 'جباتا الخشب', 'مسعدة', 'خان أرنبة'],
  },

  // ------------------------------------------------------------------ Egypt
  EG: {
    'القاهرة': ['القاهرة', 'مدينة نصر', 'مصر الجديدة', 'المعادي', 'حلوان', 'شبرا', 'التجمع الخامس', 'الشروق', 'الزيتون', 'عين شمس'],
    'الجيزة': ['الجيزة', 'السادس من أكتوبر', 'الشيخ زايد', 'الهرم', 'إمبابة', 'الدقي', 'العياط', 'أوسيم', 'الحوامدية'],
    'الإسكندرية': ['الإسكندرية', 'برج العرب', 'العجمي', 'المنتزه', 'سيدي جابر'],
    'القليوبية': ['بنها', 'شبرا الخيمة', 'القناطر الخيرية', 'قليوب', 'الخانكة', 'العبور', 'طوخ', 'كفر شكر'],
    'الشرقية': ['الزقازيق', 'العاشر من رمضان', 'بلبيس', 'منيا القمح', 'أبو كبير', 'فاقوس', 'ههيا', 'ديرب نجم'],
    'الدقهلية': ['المنصورة', 'ميت غمر', 'طلخا', 'السنبلاوين', 'دكرنس', 'بلقاس', 'أجا', 'شربين'],
    'البحيرة': ['دمنهور', 'كفر الدوار', 'رشيد', 'إدكو', 'أبو حمص', 'إيتاي البارود', 'كوم حمادة'],
    'كفر الشيخ': ['كفر الشيخ', 'دسوق', 'بلطيم', 'فوه', 'سيدي سالم', 'الحامول'],
    'الغربية': ['طنطا', 'المحلة الكبرى', 'كفر الزيات', 'زفتى', 'سمنود', 'بسيون'],
    'المنوفية': ['شبين الكوم', 'مدينة السادات', 'منوف', 'أشمون', 'قويسنا', 'تلا'],
    'دمياط': ['دمياط', 'دمياط الجديدة', 'رأس البر', 'فارسكور', 'كفر سعد'],
    'بورسعيد': ['بورسعيد', 'بورفؤاد'],
    'الإسماعيلية': ['الإسماعيلية', 'القنطرة', 'فايد', 'التل الكبير'],
    'السويس': ['السويس'],
    'شمال سيناء': ['العريش', 'رفح', 'الشيخ زويد', 'بئر العبد'],
    'جنوب سيناء': ['الطور', 'شرم الشيخ', 'دهب', 'نويبع', 'سانت كاترين'],
    'الفيوم': ['الفيوم', 'إطسا', 'سنورس', 'طامية', 'أبشواي'],
    'بني سويف': ['بني سويف', 'الواسطى', 'ناصر', 'ببا', 'الفشن'],
    'المنيا': ['المنيا', 'ملوي', 'مغاغة', 'سمالوط', 'أبو قرقاص', 'بني مزار'],
    'أسيوط': ['أسيوط', 'ديروط', 'القوصية', 'أبنوب', 'منفلوط', 'أبوتيج'],
    'سوهاج': ['سوهاج', 'جرجا', 'أخميم', 'طهطا', 'المراغة', 'دار السلام'],
    'قنا': ['قنا', 'نجع حمادي', 'دشنا', 'قوص', 'فرشوط', 'أبو تشت'],
    'الأقصر': ['الأقصر', 'إسنا', 'أرمنت', 'الطود'],
    'أسوان': ['أسوان', 'كوم أمبو', 'إدفو', 'نصر النوبة', 'دراو'],
    'البحر الأحمر': ['الغردقة', 'سفاجا', 'القصير', 'مرسى علم', 'رأس غارب'],
    'الوادي الجديد': ['الخارجة', 'الداخلة', 'الفرافرة', 'باريس'],
    'مطروح': ['مرسى مطروح', 'العلمين', 'سيوة', 'الضبعة', 'سيدي براني'],
  },

  // ------------------------------------------------------------------ Saudi Arabia
  SA: {
    'منطقة الرياض': ['الرياض', 'الخرج', 'الدرعية', 'المجمعة', 'الزلفي', 'الدوادمي', 'وادي الدواسر', 'الأفلاج', 'شقراء', 'عفيف'],
    'منطقة مكة المكرمة': ['مكة المكرمة', 'جدة', 'الطائف', 'رابغ', 'القنفذة', 'الليث', 'خليص'],
    'منطقة المدينة المنورة': ['المدينة المنورة', 'ينبع', 'العلا', 'بدر', 'خيبر', 'المهد'],
    'منطقة القصيم': ['بريدة', 'عنيزة', 'الرس', 'البكيرية', 'المذنب', 'البدائع'],
    'المنطقة الشرقية': ['الدمام', 'الخبر', 'الظهران', 'الأحساء', 'الجبيل', 'القطيف', 'حفر الباطن', 'رأس تنورة', 'الخفجي', 'بقيق'],
    'منطقة عسير': ['أبها', 'خميس مشيط', 'بيشة', 'النماص', 'محايل عسير', 'سراة عبيدة'],
    'منطقة تبوك': ['تبوك', 'ضباء', 'الوجه', 'تيماء', 'أملج', 'حقل'],
    'منطقة حائل': ['حائل', 'بقعاء', 'الغزالة', 'الشنان'],
    'منطقة الحدود الشمالية': ['عرعر', 'رفحاء', 'طريف', 'العويقيلة'],
    'منطقة جازان': ['جازان', 'صبيا', 'أبو عريش', 'صامطة', 'فرسان', 'بيش'],
    'منطقة نجران': ['نجران', 'شرورة', 'حبونا', 'بدر الجنوب'],
    'منطقة الباحة': ['الباحة', 'بلجرشي', 'المخواة', 'قلوة'],
    'منطقة الجوف': ['سكاكا', 'دومة الجندل', 'القريات', 'طبرجل'],
  },

  // ------------------------------------------------------------------ Iraq
  IQ: {
    'بغداد': ['بغداد', 'الكاظمية', 'الأعظمية', 'المحمودية', 'أبو غريب'],
    'نينوى': ['الموصل', 'تلعفر', 'سنجار', 'الحمدانية', 'تلكيف'],
    'البصرة': ['البصرة', 'الزبير', 'أبو الخصيب', 'القرنة', 'شط العرب'],
    'أربيل': ['أربيل', 'سوران', 'كويسنجق', 'شقلاوة', 'مخمور'],
    'السليمانية': ['السليمانية', 'حلبجة', 'رانية', 'كلار', 'دوكان'],
    'دهوك': ['دهوك', 'زاخو', 'العمادية', 'سميل'],
    'كركوك': ['كركوك', 'الحويجة', 'داقوق', 'الدبس'],
    'الأنبار': ['الرمادي', 'الفلوجة', 'هيت', 'حديثة', 'القائم', 'عانة', 'الرطبة'],
    'ديالى': ['بعقوبة', 'خانقين', 'المقدادية', 'بلدروز', 'الخالص'],
    'صلاح الدين': ['تكريت', 'سامراء', 'بلد', 'بيجي', 'الدور', 'الشرقاط'],
    'بابل': ['الحلة', 'المسيب', 'الإسكندرية', 'المحاويل'],
    'كربلاء': ['كربلاء', 'عين التمر', 'الهندية'],
    'النجف': ['النجف', 'الكوفة', 'المناذرة'],
    'القادسية': ['الديوانية', 'عفك', 'الشامية', 'الحمزة'],
    'واسط': ['الكوت', 'الصويرة', 'النعمانية', 'الحي'],
    'ميسان': ['العمارة', 'المجر الكبير', 'قلعة صالح'],
    'ذي قار': ['الناصرية', 'الرفاعي', 'سوق الشيوخ', 'الشطرة'],
    'المثنى': ['السماوة', 'الرميثة', 'الخضر'],
  },

  // ------------------------------------------------------------------ Jordan
  JO: {
    'عمّان': ['عمّان', 'سحاب', 'ناعور', 'مرج الحمام', 'الجيزة'],
    'إربد': ['إربد', 'الرمثا', 'الحصن', 'بيت راس', 'الطيبة', 'الكورة'],
    'الزرقاء': ['الزرقاء', 'الرصيفة', 'الهاشمية', 'الأزرق'],
    'البلقاء': ['السلط', 'الفحيص', 'عين الباشا', 'ماحص', 'دير علا'],
    'مأدبا': ['مأدبا', 'ذيبان', 'حسبان'],
    'الكرك': ['الكرك', 'المزار الجنوبي', 'القطرانة', 'مؤتة', 'الأغوار الجنوبية'],
    'الطفيلة': ['الطفيلة', 'بصيرا', 'الحسا'],
    'معان': ['معان', 'البترا', 'وادي موسى', 'الشوبك'],
    'العقبة': ['العقبة', 'القويرة'],
    'جرش': ['جرش', 'سوف', 'برما'],
    'عجلون': ['عجلون', 'كفرنجة', 'عنجرة'],
    'المفرق': ['المفرق', 'الرويشد', 'الصفاوي', 'البادية الشمالية'],
  },

  // ------------------------------------------------------------------ Lebanon
  LB: {
    'بيروت': ['بيروت'],
    'جبل لبنان': ['جونية', 'بعبدا', 'عاليه', 'الشوف', 'بيت الدين', 'جبيل', 'كسروان', 'المتن', 'الدامور', 'الحازمية', 'برمانا', 'الجية'],
    'الشمال': ['طرابلس', 'زغرتا', 'إهدن', 'البترون', 'الكورة', 'بشري', 'أميون', 'المنية'],
    'الجنوب': ['صيدا', 'صور', 'جزين', 'الزهراني', 'قانا'],
    'النبطية': ['النبطية', 'بنت جبيل', 'مرجعيون', 'حاصبيا', 'الخيام'],
    'البقاع': ['زحلة', 'شتورة', 'راشيا', 'جب جنين', 'المرج', 'عنجر', 'سعدنايل'],
    'عكار': ['حلبا', 'القبيات', 'بيت ملات', 'عكار العتيقة'],
    'بعلبك الهرمل': ['بعلبك', 'الهرمل', 'عرسال', 'اللبوة'],
  },

  // ------------------------------------------------------------------ Palestine
  PS: {
    'القدس': ['القدس', 'أبو ديس', 'العيزرية', 'بيت حنينا', 'الرام'],
    'رام الله والبيرة': ['رام الله', 'البيرة', 'بيتونيا', 'سلفيت'],
    'أريحا والأغوار': ['أريحا', 'العوجا'],
    'بيت لحم': ['بيت لحم', 'بيت جالا', 'بيت ساحور', 'دورا القرع'],
    'الخليل': ['الخليل', 'دورا', 'يطا', 'حلحول', 'الظاهرية', 'السموع'],
    'نابلس': ['نابلس', 'بيتا', 'عصيرة الشمالية'],
    'جنين': ['جنين', 'يعبد', 'قباطية', 'عرابة'],
    'طولكرم': ['طولكرم', 'عنبتا', 'بلعا'],
    'قلقيلية': ['قلقيلية', 'عزون', 'حبلة'],
    'سلفيت': ['سلفيت', 'كفل حارس', 'بديا'],
    'طوباس': ['طوباس', 'طمون', 'تياسير'],
    'شمال غزة': ['جباليا', 'بيت حانون', 'بيت لاهيا'],
    'غزة': ['غزة', 'الشجاعية', 'الرمال'],
    'دير البلح': ['دير البلح', 'النصيرات', 'البريج', 'المغازي', 'الزوايدة'],
    'خان يونس': ['خان يونس', 'بني سهيلا', 'عبسان', 'القرارة'],
    'رفح': ['رفح', 'تل السلطان'],
  },

  // ------------------------------------------------------------------ Yemen
  YE: {
    'أمانة العاصمة': ['صنعاء'],
    'صنعاء': ['صنعاء', 'بني مطر', 'همدان', 'أرحب'],
    'عدن': ['عدن', 'كريتر', 'المنصورة', 'الشيخ عثمان', 'التواهي'],
    'تعز': ['تعز', 'التربة', 'المخا', 'الحوبان', 'ماوية'],
    'الحديدة': ['الحديدة', 'زبيد', 'بيت الفقيه', 'اللحية', 'الخوخة'],
    'إب': ['إب', 'يريم', 'جبلة', 'السياني', 'العدين'],
    'ذمار': ['ذمار', 'معبر', 'عتمة', 'رداع'],
    'حضرموت': ['المكلا', 'سيئون', 'تريم', 'شبام', 'الشحر'],
    'حجة': ['حجة', 'عبس', 'ميدي'],
    'مأرب': ['مأرب', 'صرواح'],
    'صعدة': ['صعدة', 'رازح', 'ساقين'],
    'عمران': ['عمران', 'خمر', 'حوث'],
    'البيضاء': ['البيضاء', 'رداع', 'مكيراس'],
    'لحج': ['الحوطة', 'تور الباحة', 'طور الباحة'],
    'أبين': ['زنجبار', 'جعار', 'لودر'],
    'شبوة': ['عتق', 'بيحان', 'الروضة'],
    'الجوف': ['الحزم', 'خب والشعف'],
    'المحويت': ['المحويت', 'الطويلة'],
    'ريمة': ['الجبين', 'كسمة'],
    'الضالع': ['الضالع', 'قعطبة'],
    'المهرة': ['الغيضة', 'حوف'],
    'سقطرى': ['حديبو', 'قلنسية'],
  },

  // ------------------------------------------------------------------ Sudan
  SD: {
    'الخرطوم': ['الخرطوم', 'أم درمان', 'بحري', 'الخرطوم بحري'],
    'الجزيرة': ['ود مدني', 'الحصاحيصا', 'المناقل', 'رفاعة'],
    'كسلا': ['كسلا', 'خشم القربة', 'همشكوريب'],
    'القضارف': ['القضارف', 'الفاو', 'دوكة'],
    'البحر الأحمر': ['بورتسودان', 'سواكن', 'طوكر', 'هيا'],
    'نهر النيل': ['الدامر', 'عطبرة', 'شندي', 'بربر'],
    'الشمالية': ['دنقلا', 'مروي', 'وادي حلفا', 'القولد'],
    'النيل الأبيض': ['ربك', 'كوستي', 'الدويم', 'ود عشانا'],
    'النيل الأزرق': ['الدمازين', 'الروصيرص', 'الكرمك'],
    'سنار': ['سنجة', 'سنار', 'الدندر'],
    'شمال كردفان': ['الأبيض', 'بارا', 'أم روابة'],
    'جنوب كردفان': ['كادقلي', 'الدلنج', 'أبو جبيهة'],
    'غرب كردفان': ['الفولة', 'النهود', 'بابنوسة'],
    'شمال دارفور': ['الفاشر', 'كتم', 'كبكابية'],
    'جنوب دارفور': ['نيالا', 'الضعين', 'برام'],
    'غرب دارفور': ['الجنينة', 'كلبس'],
    'وسط دارفور': ['زالنجي', 'وادي صالح'],
    'شرق دارفور': ['الضعين', 'عديلة'],
  },

  // ------------------------------------------------------------------ Libya (22 districts)
  LY: same(['طرابلس', 'بنغازي', 'مصراتة', 'الزاوية', 'الجفارة', 'المرقب', 'النقاط الخمس', 'الجبل الغربي', 'نالوت', 'سرت', 'الجفرة', 'سبها', 'وادي الشاطئ', 'وادي الحياة', 'مرزق', 'الكفرة', 'غات', 'الجبل الأخضر', 'درنة', 'المرج', 'الواحات', 'طبرق']),

  // ------------------------------------------------------------------ Tunisia (24)
  TN: same(['تونس', 'أريانة', 'بن عروس', 'منوبة', 'نابل', 'زغوان', 'بنزرت', 'باجة', 'جندوبة', 'الكاف', 'سليانة', 'القيروان', 'القصرين', 'سيدي بوزيد', 'سوسة', 'المنستير', 'المهدية', 'صفاقس', 'قفصة', 'توزر', 'قبلي', 'قابس', 'مدنين', 'تطاوين']),

  // ------------------------------------------------------------------ Algeria (58)
  DZ: same(['أدرار', 'الشلف', 'الأغواط', 'أم البواقي', 'باتنة', 'بجاية', 'بسكرة', 'بشار', 'البليدة', 'البويرة', 'تمنراست', 'تبسة', 'تلمسان', 'تيارت', 'تيزي وزو', 'الجزائر', 'الجلفة', 'جيجل', 'سطيف', 'سعيدة', 'سكيكدة', 'سيدي بلعباس', 'عنابة', 'قالمة', 'قسنطينة', 'المدية', 'مستغانم', 'المسيلة', 'معسكر', 'ورقلة', 'وهران', 'البيض', 'إليزي', 'برج بوعريريج', 'بومرداس', 'الطارف', 'تندوف', 'تيسمسيلت', 'الوادي', 'خنشلة', 'سوق أهراس', 'تيبازة', 'ميلة', 'عين الدفلى', 'النعامة', 'عين تموشنت', 'غرداية', 'غليزان', 'تيميمون', 'برج باجي مختار', 'أولاد جلال', 'بني عباس', 'إن صالح', 'إن قزام', 'تقرت', 'جانت', 'المغير', 'المنيعة']),

  // ------------------------------------------------------------------ Morocco (12 regions)
  MA: {
    'طنجة-تطوان-الحسيمة': ['طنجة', 'تطوان', 'الحسيمة', 'شفشاون', 'العرائش', 'أصيلة'],
    'الشرق': ['وجدة', 'الناظور', 'بركان', 'جرادة', 'الدريوش'],
    'فاس-مكناس': ['فاس', 'مكناس', 'تازة', 'إفران', 'صفرو'],
    'الرباط-سلا-القنيطرة': ['الرباط', 'سلا', 'القنيطرة', 'تمارة', 'الخميسات'],
    'بني ملال-خنيفرة': ['بني ملال', 'خريبكة', 'خنيفرة', 'الفقيه بن صالح', 'أزيلال'],
    'الدار البيضاء-سطات': ['الدار البيضاء', 'المحمدية', 'سطات', 'الجديدة', 'برشيد', 'سيدي بنور'],
    'مراكش-آسفي': ['مراكش', 'آسفي', 'الصويرة', 'قلعة السراغنة', 'اليوسفية'],
    'درعة-تافيلالت': ['ورزازات', 'الرشيدية', 'ميدلت', 'زاكورة', 'تنغير'],
    'سوس-ماسة': ['أكادير', 'تارودانت', 'إنزكان', 'تيزنيت', 'اشتوكة آيت باها'],
    'كلميم-واد نون': ['كلميم', 'طانطان', 'سيدي إفني', 'أسا'],
    'العيون-الساقية الحمراء': ['العيون', 'السمارة', 'بوجدور', 'طرفاية'],
    'الداخلة-وادي الذهب': ['الداخلة', 'أوسرد'],
  },

  // ------------------------------------------------------------------ Gulf states
  KW: {
    'العاصمة': ['مدينة الكويت', 'الشرق', 'القبلة', 'دسمان'],
    'حولي': ['حولي', 'السالمية', 'الرميثية', 'الجابرية', 'سلوى'],
    'الفروانية': ['الفروانية', 'خيطان', 'جليب الشيوخ', 'العارضية'],
    'الأحمدي': ['الأحمدي', 'الفحيحيل', 'الفنطاس', 'المنقف', 'أبو حليفة', 'الفنيطيس'],
    'الجهراء': ['الجهراء', 'القصر', 'العيون', 'النسيم'],
    'مبارك الكبير': ['مبارك الكبير', 'صباح السالم', 'العدان', 'القرين'],
  },
  BH: {
    'العاصمة': ['المنامة', 'الجفير', 'السنابس', 'جدحفص'],
    'المحرق': ['المحرق', 'الحد', 'عراد', 'البسيتين'],
    'الشمالية': ['سار', 'البديع', 'الجنبية', 'مدينة حمد'],
    'الجنوبية': ['مدينة عيسى', 'الرفاع', 'الزلاق', 'عسكر'],
  },
  QA: {
    'الدوحة': ['الدوحة', 'لوسيل', 'الوعب', 'اللقطة'],
    'الريان': ['الريان', 'معيذر', 'الغرافة', 'أبو هامور'],
    'الوكرة': ['الوكرة', 'مسيعيد', 'الوكير'],
    'الخور والذخيرة': ['الخور', 'الذخيرة'],
    'الشمال': ['مدينة الشمال', 'الرويس', 'أبو دلوف'],
    'أم صلال': ['أم صلال محمد', 'أم صلال علي'],
    'الضعاين': ['الضعاين', 'سميسمة'],
    'الشحانية': ['الشحانية', 'دخان'],
  },
  AE: {
    'أبوظبي': ['أبوظبي', 'العين', 'الظفرة', 'مدينة زايد', 'الرويس'],
    'دبي': ['دبي', 'جبل علي', 'حتا', 'ديرة', 'بر دبي'],
    'الشارقة': ['الشارقة', 'خورفكان', 'كلباء', 'دبا الحصن', 'الذيد'],
    'عجمان': ['عجمان', 'مصفوت', 'المنامة'],
    'أم القيوين': ['أم القيوين', 'فلج المعلا'],
    'رأس الخيمة': ['رأس الخيمة', 'الرمس', 'خت', 'الجزيرة الحمراء'],
    'الفجيرة': ['الفجيرة', 'دبا الفجيرة', 'مسافي', 'البثنة'],
  },
  OM: {
    'مسقط': ['مسقط', 'مطرح', 'السيب', 'بوشر', 'العامرات', 'قريات'],
    'ظفار': ['صلالة', 'طاقة', 'مرباط', 'ثمريت'],
    'مسندم': ['خصب', 'بخا', 'دبا'],
    'البريمي': ['البريمي', 'محضة', 'السنينة'],
    'الداخلية': ['نزوى', 'بهلاء', 'سمائل', 'أدم', 'إزكي'],
    'شمال الباطنة': ['صحار', 'شناص', 'لوى', 'صحم', 'الخابورة'],
    'جنوب الباطنة': ['الرستاق', 'بركاء', 'المصنعة', 'السويق'],
    'جنوب الشرقية': ['صور', 'جعلان', 'مصيرة'],
    'شمال الشرقية': ['إبراء', 'المضيبي', 'بدية', 'القابل'],
    'الظاهرة': ['عبري', 'ينقل', 'ضنك'],
    'الوسطى': ['هيما', 'الدقم', 'محوت'],
  },

  // ------------------------------------------------------------------ rest of the Arab world
  SO: {
    'بنادر': ['مقديشو', 'أفجوي', 'مركا'],
    'صوماليلاند': ['هرجيسا', 'برعو', 'بربرة', 'بوراما'],
    'بونتلاند': ['بوصاصو', 'غاروي', 'جالكعيو', 'قردو'],
    'جوبالاند': ['كيسمايو', 'جمامي'],
    'جنوب غرب الصومال': ['بيداوا', 'بيدوا', 'براوة'],
    'هيرشبيلي': ['جوهر', 'بلدوين'],
    'غلمدغ': ['دوسمريب', 'عدادو'],
  },
  MR: {
    'نواكشوط الغربية': ['نواكشوط'],
    'نواكشوط الشمالية': ['نواكشوط'],
    'نواكشوط الجنوبية': ['نواكشوط'],
    'داخلت نواذيبو': ['نواذيبو'],
    'الترارزة': ['روصو', 'ولاتة'],
    'البراكنة': ['ألاك', 'بوتلميت'],
    'كوركول': ['كيهيدي', 'مقامة'],
    'لعصابة': ['كيفه', 'بومديد'],
    'الحوض الشرقي': ['النعمة', 'عدل بكرو'],
    'الحوض الغربي': ['العيون', 'تمبدغة'],
    'آدرار': ['أطار', 'شنقيط', 'وادان'],
    'تيرس زمور': ['زويرات', 'بئر أم كرين'],
    'تكانت': ['تيشيت', 'تجكجة'],
    'كيدي ماغا': ['سيلبابي', 'ولد ينجه'],
    'إينشيري': ['أكجوجت', 'بنشاب'],
  },
  DJ: {
    'جيبوتي': ['جيبوتي'],
    'علي صبيح': ['علي صبيح'],
    'دخيل': ['دخيل'],
    'تاجورة': ['تاجورة'],
    'أوبوك': ['أوبوك'],
    'عرتا': ['عرتا'],
  },
  KM: {
    'القمر الكبرى': ['موروني'],
    'أنجوان': ['موتسامودو'],
    'موهيلي': ['فومبوني'],
  },

  // ------------------------------------------------------------------ Turkey (81 provinces, Turkish)
  TR: {
    ...same(['Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Amasya', 'Ankara', 'Antalya', 'Artvin', 'Aydın', 'Balıkesir', 'Bilecik', 'Bingöl', 'Bitlis', 'Bolu', 'Burdur', 'Bursa', 'Çanakkale', 'Çankırı', 'Çorum', 'Denizli', 'Diyarbakır', 'Edirne', 'Elazığ', 'Erzincan', 'Erzurum', 'Eskişehir', 'Gaziantep', 'Giresun', 'Gümüşhane', 'Hakkâri', 'Hatay', 'Isparta', 'Mersin', 'İstanbul', 'İzmir', 'Kars', 'Kastamonu', 'Kayseri', 'Kırklareli', 'Kırşehir', 'Kocaeli', 'Konya', 'Kütahya', 'Malatya', 'Manisa', 'Kahramanmaraş', 'Mardin', 'Muğla', 'Muş', 'Nevşehir', 'Niğde', 'Ordu', 'Rize', 'Sakarya', 'Samsun', 'Siirt', 'Sinop', 'Sivas', 'Tekirdağ', 'Tokat', 'Trabzon', 'Tunceli', 'Şanlıurfa', 'Uşak', 'Van', 'Yozgat', 'Zonguldak', 'Aksaray', 'Bayburt', 'Karaman', 'Kırıkkale', 'Batman', 'Şırnak', 'Bartın', 'Ardahan', 'Iğdır', 'Yalova', 'Karabük', 'Kilis', 'Osmaniye', 'Düzce']),
    'İstanbul': ['İstanbul', 'Fatih', 'Bağcılar', 'Esenyurt', 'Beşiktaş', 'Beyoğlu', 'Şişli', 'Kadıköy', 'Üsküdar', 'Ümraniye', 'Pendik', 'Kartal', 'Maltepe', 'Başakşehir', 'Avcılar', 'Küçükçekmece', 'Bahçelievler', 'Zeytinburnu', 'Sultanbeyli', 'Esenler', 'Gaziosmanpaşa', 'Sultangazi', 'Bakırköy'],
    'Hatay': ['Antakya', 'İskenderun', 'Reyhanlı', 'Kırıkhan', 'Samandağ', 'Defne', 'Dörtyol', 'Arsuz', 'Hassa', 'Altınözü'],
    'Gaziantep': ['Gaziantep', 'Şahinbey', 'Şehitkamil', 'Nizip', 'İslahiye', 'Karkamış', 'Oğuzeli'],
    'Şanlıurfa': ['Şanlıurfa', 'Eyyübiye', 'Haliliye', 'Siverek', 'Viranşehir', 'Suruç', 'Birecik', 'Akçakale', 'Ceylanpınar', 'Harran'],
    'Mersin': ['Mersin', 'Mezitli', 'Yenişehir', 'Tarsus', 'Erdemli', 'Silifke', 'Anamur', 'Akdeniz', 'Toroslar'],
    'Ankara': ['Ankara', 'Çankaya', 'Keçiören', 'Yenimahalle', 'Mamak', 'Etimesgut', 'Sincan', 'Altındağ', 'Pursaklar', 'Gölbaşı'],
    'İzmir': ['İzmir', 'Konak', 'Karşıyaka', 'Bornova', 'Buca', 'Bayraklı', 'Çiğli', 'Karabağlar', 'Gaziemir'],
  },

  // ------------------------------------------------------------------ Germany (16 states, German)
  DE: {
    'Baden-Württemberg': ['Stuttgart', 'Mannheim', 'Karlsruhe', 'Freiburg im Breisgau', 'Heidelberg', 'Ulm', 'Heilbronn', 'Pforzheim'],
    'Bayern': ['München', 'Nürnberg', 'Augsburg', 'Regensburg', 'Würzburg', 'Ingolstadt', 'Fürth', 'Erlangen'],
    'Berlin': ['Berlin'],
    'Brandenburg': ['Potsdam', 'Cottbus', 'Brandenburg an der Havel', 'Frankfurt (Oder)'],
    'Bremen': ['Bremen', 'Bremerhaven'],
    'Hamburg': ['Hamburg'],
    'Hessen': ['Frankfurt am Main', 'Wiesbaden', 'Kassel', 'Darmstadt', 'Offenbach am Main', 'Gießen', 'Marburg'],
    'Mecklenburg-Vorpommern': ['Rostock', 'Schwerin', 'Greifswald'],
    'Niedersachsen': ['Hannover', 'Braunschweig', 'Osnabrück', 'Göttingen', 'Oldenburg', 'Wolfsburg', 'Hildesheim'],
    'Nordrhein-Westfalen': ['Köln', 'Düsseldorf', 'Dortmund', 'Essen', 'Bonn', 'Duisburg', 'Bochum', 'Bielefeld', 'Aachen', 'Münster', 'Wuppertal', 'Gelsenkirchen', 'Mönchengladbach', 'Hagen', 'Oberhausen'],
    'Rheinland-Pfalz': ['Mainz', 'Koblenz', 'Ludwigshafen am Rhein', 'Trier', 'Kaiserslautern'],
    'Saarland': ['Saarbrücken', 'Neunkirchen'],
    'Sachsen': ['Dresden', 'Leipzig', 'Chemnitz', 'Zwickau'],
    'Sachsen-Anhalt': ['Magdeburg', 'Halle (Saale)', 'Dessau-Roßlau'],
    'Schleswig-Holstein': ['Kiel', 'Lübeck', 'Flensburg', 'Neumünster'],
    'Thüringen': ['Erfurt', 'Jena', 'Weimar', 'Gera'],
  },

  // ------------------------------------------------------------------ USA (50 states + DC, English)
  US: {
    'Alabama': ['Birmingham', 'Montgomery', 'Mobile', 'Huntsville'],
    'Alaska': ['Anchorage', 'Fairbanks', 'Juneau'],
    'Arizona': ['Phoenix', 'Tucson', 'Mesa', 'Chandler'],
    'Arkansas': ['Little Rock', 'Fayetteville'],
    'California': ['Los Angeles', 'San Francisco', 'San Diego', 'San Jose', 'Sacramento', 'Oakland', 'Anaheim', 'Irvine', 'Fresno', 'Long Beach'],
    'Colorado': ['Denver', 'Colorado Springs', 'Aurora'],
    'Connecticut': ['Hartford', 'New Haven', 'Stamford'],
    'Delaware': ['Wilmington', 'Dover'],
    'Florida': ['Miami', 'Orlando', 'Tampa', 'Jacksonville', 'Fort Lauderdale', 'Tallahassee'],
    'Georgia': ['Atlanta', 'Savannah', 'Augusta'],
    'Hawaii': ['Honolulu'],
    'Idaho': ['Boise'],
    'Illinois': ['Chicago', 'Springfield', 'Aurora', 'Naperville'],
    'Indiana': ['Indianapolis', 'Fort Wayne'],
    'Iowa': ['Des Moines', 'Cedar Rapids'],
    'Kansas': ['Wichita', 'Topeka', 'Kansas City'],
    'Kentucky': ['Louisville', 'Lexington'],
    'Louisiana': ['New Orleans', 'Baton Rouge'],
    'Maine': ['Portland', 'Augusta'],
    'Maryland': ['Baltimore', 'Rockville', 'Annapolis'],
    'Massachusetts': ['Boston', 'Cambridge', 'Worcester', 'Springfield'],
    'Michigan': ['Detroit', 'Dearborn', 'Ann Arbor', 'Grand Rapids', 'Lansing'],
    'Minnesota': ['Minneapolis', 'Saint Paul'],
    'Mississippi': ['Jackson'],
    'Missouri': ['Saint Louis', 'Kansas City', 'Jefferson City'],
    'Montana': ['Billings', 'Helena'],
    'Nebraska': ['Omaha', 'Lincoln'],
    'Nevada': ['Las Vegas', 'Reno', 'Carson City'],
    'New Hampshire': ['Manchester', 'Concord'],
    'New Jersey': ['Newark', 'Jersey City', 'Paterson', 'Elizabeth', 'Trenton'],
    'New Mexico': ['Albuquerque', 'Santa Fe'],
    'New York': ['New York City', 'Buffalo', 'Albany', 'Rochester', 'Syracuse', 'Yonkers'],
    'North Carolina': ['Charlotte', 'Raleigh', 'Greensboro'],
    'North Dakota': ['Fargo', 'Bismarck'],
    'Ohio': ['Cleveland', 'Columbus', 'Cincinnati', 'Toledo', 'Akron'],
    'Oklahoma': ['Oklahoma City', 'Tulsa'],
    'Oregon': ['Portland', 'Salem', 'Eugene'],
    'Pennsylvania': ['Philadelphia', 'Pittsburgh', 'Harrisburg', 'Allentown'],
    'Rhode Island': ['Providence'],
    'South Carolina': ['Columbia', 'Charleston'],
    'South Dakota': ['Sioux Falls', 'Pierre'],
    'Tennessee': ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga'],
    'Texas': ['Houston', 'Dallas', 'Austin', 'San Antonio', 'Fort Worth', 'El Paso', 'Plano'],
    'Utah': ['Salt Lake City', 'Provo'],
    'Vermont': ['Burlington', 'Montpelier'],
    'Virginia': ['Richmond', 'Norfolk', 'Fairfax', 'Virginia Beach', 'Arlington'],
    'Washington': ['Seattle', 'Spokane', 'Tacoma', 'Olympia', 'Bellevue'],
    'West Virginia': ['Charleston', 'Huntington'],
    'Wisconsin': ['Milwaukee', 'Madison'],
    'Wyoming': ['Cheyenne', 'Casper'],
    'District of Columbia': ['Washington'],
  },

  // ------------------------------------------------------------------ Canada (English / French names)
  CA: {
    'Ontario': ['Toronto', 'Ottawa', 'Mississauga', 'Hamilton', 'London', 'Brampton', 'Windsor', 'Kitchener'],
    'Québec': ['Montréal', 'Québec', 'Laval', 'Gatineau', 'Sherbrooke'],
    'British Columbia': ['Vancouver', 'Victoria', 'Surrey', 'Burnaby', 'Kelowna'],
    'Alberta': ['Calgary', 'Edmonton', 'Red Deer'],
    'Manitoba': ['Winnipeg', 'Brandon'],
    'Saskatchewan': ['Regina', 'Saskatoon'],
    'Nova Scotia': ['Halifax', 'Sydney'],
    'New Brunswick': ['Moncton', 'Fredericton', 'Saint John'],
    'Newfoundland and Labrador': ["St. John's"],
    'Prince Edward Island': ['Charlottetown'],
    'Yukon': ['Whitehorse'],
    'Northwest Territories': ['Yellowknife'],
    'Nunavut': ['Iqaluit'],
  },

  // ------------------------------------------------------------------ United Kingdom
  GB: {
    'England': ['London', 'Manchester', 'Birmingham', 'Liverpool', 'Leeds', 'Sheffield', 'Nottingham', 'Bristol', 'Newcastle upon Tyne', 'Leicester', 'Bradford', 'Southampton', 'Oxford', 'Cambridge', 'Luton'],
    'Scotland': ['Edinburgh', 'Glasgow', 'Aberdeen', 'Dundee'],
    'Wales': ['Cardiff', 'Swansea', 'Newport'],
    'Northern Ireland': ['Belfast', 'Derry'],
  },

  // ------------------------------------------------------------------ France (13 regions, French)
  FR: {
    'Île-de-France': ['Paris', 'Versailles', 'Saint-Denis', 'Boulogne-Billancourt', 'Nanterre', 'Créteil', 'Argenteuil'],
    'Auvergne-Rhône-Alpes': ['Lyon', 'Grenoble', 'Saint-Étienne', 'Clermont-Ferrand', 'Annecy', 'Villeurbanne'],
    "Provence-Alpes-Côte d'Azur": ['Marseille', 'Nice', 'Toulon', 'Avignon', 'Cannes', 'Aix-en-Provence'],
    'Occitanie': ['Toulouse', 'Montpellier', 'Nîmes', 'Perpignan'],
    'Nouvelle-Aquitaine': ['Bordeaux', 'Limoges', 'Poitiers', 'La Rochelle'],
    'Grand Est': ['Strasbourg', 'Metz', 'Reims', 'Nancy', 'Mulhouse'],
    'Hauts-de-France': ['Lille', 'Amiens', 'Roubaix', 'Dunkerque'],
    'Bretagne': ['Rennes', 'Brest', 'Quimper'],
    'Pays de la Loire': ['Nantes', 'Angers', 'Le Mans'],
    'Normandie': ['Rouen', 'Caen', 'Le Havre'],
    'Bourgogne-Franche-Comté': ['Dijon', 'Besançon'],
    'Centre-Val de Loire': ['Orléans', 'Tours'],
    'Corse': ['Ajaccio', 'Bastia'],
  },

  // ------------------------------------------------------------------ Sweden (21 counties, Swedish)
  SE: {
    'Stockholms län': ['Stockholm', 'Södertälje', 'Solna', 'Huddinge', 'Nacka'],
    'Uppsala län': ['Uppsala', 'Enköping'],
    'Södermanlands län': ['Nyköping', 'Eskilstuna', 'Katrineholm'],
    'Östergötlands län': ['Linköping', 'Norrköping', 'Motala'],
    'Jönköpings län': ['Jönköping', 'Värnamo', 'Nässjö'],
    'Kronobergs län': ['Växjö', 'Ljungby'],
    'Kalmar län': ['Kalmar', 'Västervik', 'Oskarshamn'],
    'Gotlands län': ['Visby'],
    'Blekinge län': ['Karlskrona', 'Karlshamn', 'Ronneby'],
    'Skåne län': ['Malmö', 'Helsingborg', 'Lund', 'Kristianstad', 'Landskrona'],
    'Hallands län': ['Halmstad', 'Varberg', 'Falkenberg'],
    'Västra Götalands län': ['Göteborg', 'Borås', 'Trollhättan', 'Uddevalla', 'Skövde'],
    'Värmlands län': ['Karlstad', 'Kristinehamn', 'Arvika'],
    'Örebro län': ['Örebro', 'Karlskoga'],
    'Västmanlands län': ['Västerås', 'Köping'],
    'Dalarnas län': ['Falun', 'Borlänge', 'Mora'],
    'Gävleborgs län': ['Gävle', 'Sandviken', 'Hudiksvall'],
    'Västernorrlands län': ['Sundsvall', 'Härnösand', 'Örnsköldsvik'],
    'Jämtlands län': ['Östersund'],
    'Västerbottens län': ['Umeå', 'Skellefteå'],
    'Norrbottens län': ['Luleå', 'Kiruna', 'Piteå'],
  },

  // ------------------------------------------------------------------ Netherlands (12 provinces, Dutch)
  NL: {
    'Noord-Holland': ['Amsterdam', 'Haarlem', 'Alkmaar', 'Zaanstad', 'Hilversum'],
    'Zuid-Holland': ['Rotterdam', 'Den Haag', 'Leiden', 'Dordrecht', 'Delft', 'Gouda'],
    'Utrecht': ['Utrecht', 'Amersfoort', 'Nieuwegein', 'Veenendaal'],
    'Noord-Brabant': ['Eindhoven', 'Tilburg', 'Breda', "'s-Hertogenbosch", 'Helmond'],
    'Gelderland': ['Arnhem', 'Nijmegen', 'Apeldoorn', 'Ede'],
    'Overijssel': ['Zwolle', 'Enschede', 'Deventer', 'Almelo'],
    'Flevoland': ['Almere', 'Lelystad'],
    'Friesland': ['Leeuwarden', 'Drachten', 'Sneek'],
    'Groningen': ['Groningen', 'Hoogezand'],
    'Drenthe': ['Assen', 'Emmen', 'Hoogeveen'],
    'Zeeland': ['Middelburg', 'Vlissingen', 'Goes'],
    'Limburg': ['Maastricht', 'Heerlen', 'Venlo', 'Sittard'],
  },

  // ------------------------------------------------------------------ Australia
  AU: {
    'New South Wales': ['Sydney', 'Newcastle', 'Wollongong', 'Parramatta'],
    'Victoria': ['Melbourne', 'Geelong', 'Ballarat'],
    'Queensland': ['Brisbane', 'Gold Coast', 'Cairns', 'Townsville'],
    'Western Australia': ['Perth', 'Fremantle'],
    'South Australia': ['Adelaide'],
    'Tasmania': ['Hobart', 'Launceston'],
    'Australian Capital Territory': ['Canberra'],
    'Northern Territory': ['Darwin', 'Alice Springs'],
  },
};

/**
 * Provinces of a country: the hand-written Arabic list when there is one, otherwise the English
 * list from the open world dataset (places-world.js); null when neither exists (free-text box).
 */
export function provincesOf(code) {
  return PLACES[code] ? Object.keys(PLACES[code]) : WORLD[code] || null;
}

/** Cities of a province (null when unknown: free-text box). Always without duplicates. */
export function citiesOf(code, province) {
  const list = PLACES[code]?.[province];
  return list ? [...new Set(list)] : null;
}
