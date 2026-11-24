<?php

declare(strict_types=1);

/**
 * Launch Season prize screen content beyond the prize line: the sample itinerary ("Your week in
 * Vietnam", 7 days, a title + a line per language and a photo each) and "A word from the
 * founder" (name, own photo, a message per language). Season settings in contest_seasons
 * (itinerary, founder), edited in Admin › Launch Season; the apps get them in the visitor's
 * language (else English). The itinerary is a SAMPLE (deliverable, Saigon-centred): the real
 * trip is planned with the winner. The founder block shows only once a name and an English
 * message are saved (never a made-up text in public). Photos: ContestPhotos entries (Pixabay
 * picks or own uploads, license + author kept).
 */
final class ContestTrip
{
    public const DAYS = 7;

    /** The sample itinerary's default text: day => locale => [title, line]. */
    public const DEFAULT_ITINERARY = [
        1 => [
            'en' => ['Hello, Saigon', 'Land in Ho Chi Minh City, check in, then an evening walk down Nguyen Hue as the city lights up.'],
            'fr' => ['Bonjour Saigon', "Arrivée à Hô Chi Minh-Ville, installation, puis une balade du soir sur Nguyen Hue quand la ville s'illumine."],
            'vi' => ['Xin chào Sài Gòn', 'Đáp xuống TP. Hồ Chí Minh, nhận phòng, rồi dạo phố đi bộ Nguyễn Huệ khi thành phố lên đèn.'],
            'es' => ['Hola, Saigón', 'Llegada a Ciudad Ho Chi Minh, registro en el hotel y un paseo nocturno por Nguyen Hue cuando la ciudad se ilumina.'],
            'it' => ['Ciao, Saigon', "Arrivo a Ho Chi Minh City, check-in, poi una passeggiata serale su Nguyen Hue mentre la città si accende."],
            'pt-br' => ['Olá, Saigon', 'Chegada à Cidade de Ho Chi Minh, check-in e uma caminhada à noite pela Nguyen Hue quando a cidade se ilumina.'],
            'pt-pt' => ['Olá, Saigão', 'Chegada à Cidade de Ho Chi Minh, check-in e um passeio ao fim do dia pela Nguyen Hue quando a cidade se ilumina.'],
            'de' => ['Hallo, Saigon', 'Ankunft in Ho-Chi-Minh-Stadt, Check-in, dann ein Abendspaziergang über die Nguyen Hue, wenn die Stadt leuchtet.'],
            'nl' => ['Hallo, Saigon', 'Landen in Ho Chi Minhstad, inchecken en een avondwandeling over Nguyen Hue als de stad oplicht.'],
            'zh-hans' => ['你好，西贡', '抵达胡志明市，入住后，在城市亮灯时漫步阮惠步行街。'],
            'zh-hant' => ['你好，西貢', '抵達胡志明市，入住後，在城市亮燈時漫步阮惠步行街。'],
            'ja' => ['こんにちは、サイゴン', 'ホーチミン市に到着してチェックイン。街が灯り始めるグエンフエ通りを夜散歩。'],
            'ko' => ['안녕, 사이공', '호찌민시에 도착해 체크인, 도시에 불이 켜질 때 응우옌후에 거리를 저녁 산책해요.'],
            'fil' => ['Hello, Saigon', 'Lapag sa Ho Chi Minh City, check-in, tapos isang lakad sa gabi sa Nguyen Hue habang nagliliwanag ang lungsod.'],
            'th' => ['สวัสดี ไซง่อน', 'ถึงนครโฮจิมินห์ เช็กอิน แล้วเดินเล่นยามค่ำบนถนนเหงียนเว้ขณะที่เมืองเปิดไฟ'],
            'id' => ['Halo, Saigon', 'Tiba di Kota Ho Chi Minh, check-in, lalu jalan sore di Nguyen Hue saat kota mulai menyala.'],
            'hi' => ['नमस्ते, साइगॉन', 'हो ची मिन्ह सिटी पहुँचें, चेक-इन करें, फिर शाम को जगमगाती न्गुयेन हुए स्ट्रीट पर सैर।'],
            'ru' => ['Привет, Сайгон', 'Прилёт в Хошимин, заселение и вечерняя прогулка по Нгуен Хюэ, когда город зажигает огни.'],
            'ar' => ['مرحبًا سايغون', 'الوصول إلى مدينة هو تشي منه وتسجيل الدخول، ثم نزهة مسائية في شارع نغوين هوي حين تضيء المدينة.'],
        ],
        2 => [
            'en' => ['Street food on two wheels', 'Ride pillion with a local through the city\'s food spots: bánh mì, broken rice, iced coffee on tiny stools.'],
            'fr' => ['Street food à moto', "En passager d'un local, tour des bonnes adresses : bánh mì, riz brisé, café glacé sur des petits tabourets."],
            'vi' => ['Ẩm thực đường phố trên xe máy', 'Ngồi sau xe một người bản địa đi khắp các quán: bánh mì, cơm tấm, cà phê sữa đá trên ghế nhựa.'],
            'es' => ['Comida callejera en moto', 'De paquete con un local por los mejores puestos: bánh mì, arroz partido y café helado en taburetes diminutos.'],
            'it' => ['Street food su due ruote', 'Dietro a un local tra i posti del cibo di strada: bánh mì, riso spezzato, caffè ghiacciato su sgabellini.'],
            'pt-br' => ['Comida de rua sobre duas rodas', 'Na garupa de um local pelos melhores lugares: bánh mì, arroz quebrado, café gelado em banquinhos.'],
            'pt-pt' => ['Comida de rua em duas rodas', 'À pendura com um local pelos melhores sítios: bánh mì, arroz partido, café gelado em banquinhos.'],
            'de' => ['Streetfood auf zwei Rädern', 'Auf dem Sozius eines Einheimischen durch die Garküchen: Bánh mì, Bruchreis, Eiskaffee auf Mini-Hockern.'],
            'nl' => ['Streetfood op twee wielen', 'Achterop bij een local langs de beste eetplekken: bánh mì, gebroken rijst, ijskoffie op kleine krukjes.'],
            'zh-hans' => ['摩托上的街头美食', '坐在当地人的摩托后座逛美食：法棍面包、碎米饭、小板凳上的冰咖啡。'],
            'zh-hant' => ['機車上的街頭美食', '坐在當地人的機車後座逛美食：法棍麵包、碎米飯、小板凳上的冰咖啡。'],
            'ja' => ['バイクで屋台めぐり', '地元の人のバイクの後ろに乗ってグルメ巡り。バインミー、コムタム、小さな椅子でアイスコーヒー。'],
            'ko' => ['오토바이로 길거리 음식', '현지인 오토바이 뒷자리에 타고 맛집 탐방: 반미, 껌땀, 작은 의자에서 마시는 아이스커피.'],
            'fil' => ['Street food sakay ng motor', 'Angkas sa isang local papunta sa mga kainan: bánh mì, broken rice, iced coffee sa maliliit na upuan.'],
            'th' => ['สตรีทฟู้ดบนสองล้อ', 'ซ้อนท้ายคนท้องถิ่นตระเวนร้านอร่อย: บั๋นหมี่ ข้าวหักหมูย่าง กาแฟเย็นบนเก้าอี้ตัวเล็ก'],
            'id' => ['Jajanan kaki lima naik motor', 'Dibonceng warga lokal ke tempat makan favorit: bánh mì, nasi patah, es kopi di kursi kecil.'],
            'hi' => ['दो पहियों पर स्ट्रीट फ़ूड', 'किसी स्थानीय के पीछे बैठकर खाने की जगहों की सैर: बान्ह मी, टूटे चावल, छोटे स्टूल पर आइस्ड कॉफ़ी।'],
            'ru' => ['Уличная еда на байке', 'За спиной у местного по лучшим точкам: баньми, ком там, кофе со льдом на крошечных табуретках.'],
            'ar' => ['طعام الشارع على دراجة', 'خلف أحد السكان على دراجته بين أماكن الأكل: بان مي، الأرز المكسور، القهوة المثلجة على كراسٍ صغيرة.'],
        ],
        3 => [
            'en' => ['A day on the Mekong', 'Day trip to the Mekong Delta: small boats through coconut canals, fruit orchards, lunch by the river.'],
            'fr' => ['Une journée sur le Mékong', 'Excursion dans le delta du Mékong : petites barques dans les canaux de cocotiers, vergers, déjeuner au bord du fleuve.'],
            'vi' => ['Một ngày trên sông Mekong', 'Đi về miền Tây trong ngày: xuồng nhỏ qua rạch dừa, vườn trái cây, bữa trưa bên sông.'],
            'es' => ['Un día en el Mekong', 'Excursión al delta del Mekong: barcas por canales de cocoteros, huertos frutales y comida junto al río.'],
            'it' => ['Un giorno sul Mekong', 'Gita nel delta del Mekong: barchette tra i canali di cocco, frutteti, pranzo sul fiume.'],
            'pt-br' => ['Um dia no Mekong', 'Passeio no delta do Mekong: barquinhos por canais de coqueiros, pomares e almoço à beira do rio.'],
            'pt-pt' => ['Um dia no Mekong', 'Passeio no delta do Mekong: barquinhos por canais de coqueiros, pomares e almoço junto ao rio.'],
            'de' => ['Ein Tag am Mekong', 'Tagesausflug ins Mekong-Delta: kleine Boote durch Kokoskanäle, Obstgärten, Mittagessen am Fluss.'],
            'nl' => ['Een dag op de Mekong', 'Dagtocht naar de Mekongdelta: bootjes door kokoskanalen, fruitboomgaarden, lunch aan de rivier.'],
            'zh-hans' => ['湄公河一日', '湄公河三角洲一日游：小船穿过椰林水道，参观果园，在河边吃午饭。'],
            'zh-hant' => ['湄公河一日', '湄公河三角洲一日遊：小船穿過椰林水道，參觀果園，在河邊吃午餐。'],
            'ja' => ['メコン川の一日', 'メコンデルタへ日帰り。小舟でヤシの水路を抜け、果樹園を訪ね、川辺でランチ。'],
            'ko' => ['메콩강에서의 하루', '메콩델타 당일 여행: 작은 배로 야자수 수로를 지나고, 과수원을 들르고, 강가에서 점심.'],
            'fil' => ['Isang araw sa Mekong', 'Day trip sa Mekong Delta: maliliit na bangka sa mga kanal ng niyog, mga taniman ng prutas, tanghalian sa tabi ng ilog.'],
            'th' => ['หนึ่งวันบนแม่น้ำโขง', 'เที่ยวปากแม่น้ำโขงแบบไปกลับ: นั่งเรือลำเล็กลัดคลองมะพร้าว แวะสวนผลไม้ กินข้าวกลางวันริมน้ำ'],
            'id' => ['Sehari di Mekong', 'Perjalanan sehari ke Delta Mekong: perahu kecil menyusuri kanal kelapa, kebun buah, makan siang di tepi sungai.'],
            'hi' => ['मेकांग पर एक दिन', 'मेकांग डेल्टा की एक दिन की सैर: नारियल की नहरों में छोटी नाव, फलों के बाग़, नदी किनारे लंच।'],
            'ru' => ['День на Меконге', 'Поездка в дельту Меконга: лодки по кокосовым каналам, фруктовые сады, обед у реки.'],
            'ar' => ['يوم على نهر ميكونغ', 'رحلة يومية إلى دلتا الميكونغ: قوارب صغيرة بين قنوات جوز الهند، وبساتين فاكهة، وغداء على ضفة النهر.'],
        ],
        4 => [
            'en' => ['Your Hilads day', 'Shoot the daily challenge in Saigon with the Hilads team, then dinner together.'],
            'fr' => ['Ta journée Hilads', "Défi du jour à Saigon avec l'équipe Hilads, puis dîner ensemble."],
            'vi' => ['Một ngày cùng Hilads', 'Chụp thử thách hằng ngày ở Sài Gòn cùng đội Hilads, rồi cùng ăn tối.'],
            'es' => ['Tu día Hilads', 'El reto del día en Saigón con el equipo de Hilads y después, cena juntos.'],
            'it' => ['La tua giornata Hilads', 'La sfida del giorno a Saigon con il team Hilads, poi cena insieme.'],
            'pt-br' => ['Seu dia Hilads', 'O desafio do dia em Saigon com a equipe Hilads e depois jantar juntos.'],
            'pt-pt' => ['O teu dia Hilads', 'O desafio do dia em Saigão com a equipa Hilads e depois jantar juntos.'],
            'de' => ['Dein Hilads-Tag', 'Die Tagesaufgabe in Saigon mit dem Hilads-Team, danach gemeinsames Abendessen.'],
            'nl' => ['Jouw Hilads-dag', 'De dagelijkse uitdaging in Saigon met het Hilads-team, daarna samen eten.'],
            'zh-hans' => ['你的 Hilads 日', '在西贡和 Hilads 团队一起拍每日挑战，然后共进晚餐。'],
            'zh-hant' => ['你的 Hilads 日', '在西貢和 Hilads 團隊一起拍每日挑戰，然後共進晚餐。'],
            'ja' => ['あなたの Hilads デー', 'Hilads チームとサイゴンでデイリーチャレンジを撮影、そのあと一緒にディナー。'],
            'ko' => ['나의 Hilads 데이', 'Hilads 팀과 사이공에서 오늘의 챌린지를 찍고, 함께 저녁을 먹어요.'],
            'fil' => ['Ang Hilads day mo', 'Kunan ang daily challenge sa Saigon kasama ang Hilads team, tapos sabay na hapunan.'],
            'th' => ['วัน Hilads ของคุณ', 'ถ่ายภาพชาเลนจ์ประจำวันในไซง่อนกับทีม Hilads แล้วกินมื้อค่ำด้วยกัน'],
            'id' => ['Hari Hilads-mu', 'Memotret tantangan harian di Saigon bersama tim Hilads, lalu makan malam bersama.'],
            'hi' => ['आपका Hilads दिन', 'Hilads टीम के साथ साइगॉन में आज का चैलेंज शूट करें, फिर साथ में डिनर।'],
            'ru' => ['Твой день с Hilads', 'Снимаем задание дня в Сайгоне с командой Hilads, потом вместе ужинаем.'],
            'ar' => ['يومك مع Hilads', 'تصوير تحدي اليوم في سايغون مع فريق Hilads، ثم عشاء معًا.'],
        ],
        5 => [
            'en' => ['A coast getaway', 'Head to the sea, about two hours from Saigon: beaches, fresh seafood and a slower pace.'],
            'fr' => ['Escapade sur la côte', "Direction la mer, à environ deux heures de Saigon : plages, fruits de mer et un autre rythme."],
            'vi' => ['Trốn ra biển', 'Ra biển, cách Sài Gòn khoảng hai tiếng: bãi cát, hải sản tươi và nhịp sống chậm hơn.'],
            'es' => ['Escapada a la costa', 'Rumbo al mar, a unas dos horas de Saigón: playas, marisco fresco y otro ritmo.'],
            'it' => ['Fuga sulla costa', 'Verso il mare, a circa due ore da Saigon: spiagge, pesce fresco e un ritmo più lento.'],
            'pt-br' => ['Escapada para o litoral', 'Rumo ao mar, a cerca de duas horas de Saigon: praias, frutos do mar frescos e um ritmo mais calmo.'],
            'pt-pt' => ['Escapadinha à costa', 'Rumo ao mar, a cerca de duas horas de Saigão: praias, marisco fresco e um ritmo mais calmo.'],
            'de' => ['Ausflug an die Küste', 'Ans Meer, etwa zwei Stunden von Saigon: Strände, frische Meeresfrüchte und ein ruhigeres Tempo.'],
            'nl' => ['Uitje naar de kust', 'Naar zee, zo\'n twee uur van Saigon: stranden, verse zeevruchten en een rustiger tempo.'],
            'zh-hans' => ['海边小逃离', '前往离西贡约两小时车程的海边：沙滩、新鲜海鲜和更慢的节奏。'],
            'zh-hant' => ['海邊小逃離', '前往離西貢約兩小時車程的海邊：沙灘、新鮮海鮮和更慢的節奏。'],
            'ja' => ['海辺へショートトリップ', 'サイゴンから約2時間の海へ。ビーチ、新鮮なシーフード、ゆったりした時間。'],
            'ko' => ['해안으로 짧은 여행', '사이공에서 약 2시간 거리의 바다로: 해변, 신선한 해산물, 느긋한 시간.'],
            'fil' => ['Bakasyon sa baybayin', 'Pupunta sa dagat, mga dalawang oras mula Saigon: beach, sariwang seafood at mas mabagal na takbo.'],
            'th' => ['หนีไปทะเล', 'ไปทะเลห่างจากไซง่อนราวสองชั่วโมง: ชายหาด อาหารทะเลสด และจังหวะชีวิตที่ช้าลง'],
            'id' => ['Liburan ke pantai', 'Menuju laut, sekitar dua jam dari Saigon: pantai, makanan laut segar, dan suasana lebih santai.'],
            'hi' => ['समुद्र किनारे की सैर', 'साइगॉन से लगभग दो घंटे दूर समुद्र की ओर: बीच, ताज़ा सी-फ़ूड और धीमी रफ़्तार।'],
            'ru' => ['На побережье', 'К морю, примерно в двух часах от Сайгона: пляжи, свежие морепродукты и неспешный ритм.'],
            'ar' => ['رحلة إلى الساحل', 'إلى البحر على بُعد ساعتين تقريبًا من سايغون: شواطئ ومأكولات بحرية طازجة وإيقاع أهدأ.'],
        ],
        6 => [
            'en' => ['Saigon, your way', 'Markets, the old post office, a rooftop at sunset: a free day to explore and fill your camera roll.'],
            'fr' => ['Saigon, à ta façon', "Marchés, la vieille poste, un rooftop au coucher du soleil : une journée libre pour explorer et remplir ta pellicule."],
            'vi' => ['Sài Gòn theo cách của bạn', 'Chợ, bưu điện cũ, sân thượng lúc hoàng hôn: một ngày tự do để khám phá và chụp thật nhiều ảnh.'],
            'es' => ['Saigón a tu manera', 'Mercados, la antigua oficina de correos, una azotea al atardecer: un día libre para explorar y llenar tu carrete.'],
            'it' => ['Saigon a modo tuo', "Mercati, il vecchio ufficio postale, un rooftop al tramonto: una giornata libera per esplorare e riempire il rullino."],
            'pt-br' => ['Saigon do seu jeito', 'Mercados, os antigos correios, um rooftop ao pôr do sol: um dia livre para explorar e encher o rolo da câmera.'],
            'pt-pt' => ['Saigão à tua maneira', 'Mercados, os antigos correios, um rooftop ao pôr do sol: um dia livre para explorar e encher o rolo.'],
            'de' => ['Saigon nach deinem Geschmack', 'Märkte, das alte Postamt, eine Dachterrasse bei Sonnenuntergang: ein freier Tag zum Entdecken und Fotografieren.'],
            'nl' => ['Saigon op jouw manier', 'Markten, het oude postkantoor, een rooftop bij zonsondergang: een vrije dag om te ontdekken en te fotograferen.'],
            'zh-hans' => ['随你逛西贡', '市场、老邮局、日落时的屋顶酒吧：自由的一天，尽情探索、拍满相册。'],
            'zh-hant' => ['隨你逛西貢', '市場、老郵局、日落時的屋頂酒吧：自由的一天，盡情探索、拍滿相簿。'],
            'ja' => ['自由なサイゴン', '市場、旧郵便局、夕暮れのルーフトップ。自由に歩いてカメラロールをいっぱいに。'],
            'ko' => ['나만의 사이공', '시장, 옛 우체국, 노을 지는 루프톱: 자유롭게 둘러보고 사진을 가득 채우는 하루.'],
            'fil' => ['Saigon, sa sarili mong paraan', 'Mga palengke, ang lumang post office, rooftop sa paglubog ng araw: isang libreng araw para mag-explore at kumuha ng photos.'],
            'th' => ['ไซง่อนในแบบของคุณ', 'ตลาด ที่ทำการไปรษณีย์เก่า รูฟท็อปยามพระอาทิตย์ตก: วันอิสระให้คุณเที่ยวและถ่ายรูปเต็มที่'],
            'id' => ['Saigon versimu', 'Pasar, kantor pos tua, rooftop saat matahari terbenam: hari bebas untuk menjelajah dan memotret sepuasnya.'],
            'hi' => ['आपके अंदाज़ में साइगॉन', 'बाज़ार, पुराना डाकघर, सूर्यास्त पर रूफ़टॉप: घूमने और फ़ोटो लेने के लिए एक फ़्री दिन।'],
            'ru' => ['Сайгон по-твоему', 'Рынки, старый почтамт, крыша на закате: свободный день, чтобы гулять и снимать.'],
            'ar' => ['سايغون على طريقتك', 'أسواق، ومكتب البريد القديم، وسطح عند الغروب: يوم حر للاستكشاف وملء ألبوم صورك.'],
        ],
        7 => [
            'en' => ['See you soon, Vietnam', 'A last cà phê sữa đá, then the flight home with a camera roll full of stories.'],
            'fr' => ['À bientôt, Vietnam', 'Un dernier cà phê sữa đá, puis le vol retour avec une pellicule pleine d\'histoires.'],
            'vi' => ['Hẹn gặp lại, Việt Nam', 'Ly cà phê sữa đá cuối cùng, rồi bay về với một album đầy kỷ niệm.'],
            'es' => ['Hasta pronto, Vietnam', 'Un último cà phê sữa đá y el vuelo de vuelta con el carrete lleno de historias.'],
            'it' => ['A presto, Vietnam', 'Un ultimo cà phê sữa đá, poi il volo di ritorno con il rullino pieno di storie.'],
            'pt-br' => ['Até logo, Vietnã', 'Um último cà phê sữa đá e o voo de volta com o rolo cheio de histórias.'],
            'pt-pt' => ['Até breve, Vietname', 'Um último cà phê sữa đá e o voo de regresso com o rolo cheio de histórias.'],
            'de' => ['Bis bald, Vietnam', 'Ein letzter Cà phê sữa đá, dann der Heimflug mit einer Kamerarolle voller Geschichten.'],
            'nl' => ['Tot snel, Vietnam', 'Een laatste cà phê sữa đá en dan de vlucht naar huis met een camerarol vol verhalen.'],
            'zh-hans' => ['越南，再见', '最后一杯越南冰奶咖，然后带着满满的故事飞回家。'],
            'zh-hant' => ['越南，再見', '最後一杯越南冰奶咖，然後帶著滿滿的故事飛回家。'],
            'ja' => ['またね、ベトナム', '最後のカフェスアダーを飲んで、思い出いっぱいのカメラロールと帰国の便へ。'],
            'ko' => ['또 만나, 베트남', '마지막 카페 쓰어 다 한 잔, 그리고 이야기로 가득한 사진첩과 함께 귀국 비행기에.'],
            'fil' => ['Hanggang sa muli, Vietnam', 'Huling cà phê sữa đá, tapos ang flight pauwi na puno ng kuwento ang camera roll.'],
            'th' => ['แล้วพบกันใหม่ เวียดนาม', 'กาแฟเย็นแก้วสุดท้าย แล้วบินกลับบ้านพร้อมรูปที่เต็มไปด้วยเรื่องราว'],
            'id' => ['Sampai jumpa, Vietnam', 'Secangkir cà phê sữa đá terakhir, lalu terbang pulang dengan galeri penuh cerita.'],
            'hi' => ['फिर मिलेंगे, वियतनाम', 'आख़िरी बार कॉ फ़े सुआ दा, फिर कहानियों से भरी फ़ोटो गैलरी के साथ घर की फ़्लाइट।'],
            'ru' => ['До встречи, Вьетнам', 'Последний кофе со сгущёнкой и льдом, и обратный рейс с плёнкой, полной историй.'],
            'ar' => ['إلى اللقاء يا فيتنام', 'آخر فنجان من قهوة كا في سوا دا، ثم رحلة العودة وألبومك مليء بالحكايات.'],
        ],
    ];

    /** The founder block's draft (admin prefill only, never public until saved with a name). */
    public const FOUNDER_DRAFT_EN = "Hey, I'm Jacques, a French guy who fell in love with Saigon and never left. "
        . "I built Hilads on my own because I wanted to see the whole world through one simple photo a day. "
        . "If you win, I'm not sending you a voucher: I'll pick you up in Saigon myself, take you to my favourite street-food spots, "
        . "and we'll shoot a daily challenge together. Can't wait to meet you.";

    /** Normalized days: [{photo: entry|null, i18n: {locale: {title, text}}}] x DAYS (defaults where empty). */
    public static function days(array $season): array
    {
        $raw = $season['itinerary'] ?? [];
        if (is_string($raw)) $raw = json_decode($raw, true);
        $raw = is_array($raw) ? array_values($raw) : [];
        $out = [];
        for ($d = 1; $d <= self::DAYS; $d++) {
            $day = is_array($raw[$d - 1] ?? null) ? $raw[$d - 1] : [];
            $i18n = [];
            foreach (Contest::LOCALES as $l) {
                $saved = $day['i18n'][$l] ?? null;
                $def   = self::DEFAULT_ITINERARY[$d][$l] ?? null;
                $i18n[$l] = is_array($saved) && ($saved['title'] ?? '') !== ''
                    ? ['title' => (string) $saved['title'], 'text' => (string) ($saved['text'] ?? '')]
                    : ($def ? ['title' => $def[0], 'text' => $def[1]] : ['title' => '', 'text' => '']);
            }
            $photo = is_array($day['photo'] ?? null) && preg_match('#^https?://#', (string) ($day['photo']['url'] ?? '')) ? $day['photo'] : null;
            $out[] = ['photo' => $photo, 'i18n' => $i18n];
        }
        return $out;
    }

    /** The founder: {name, photo: entry|null, i18n: {locale: message}} (empty name = not shown). */
    public static function founder(array $season): array
    {
        $raw = $season['founder'] ?? [];
        if (is_string($raw)) $raw = json_decode($raw, true);
        $raw = is_array($raw) ? $raw : [];
        return [
            'name'  => (string) ($raw['name'] ?? ''),
            'role'  => (string) ($raw['role'] ?? ''),
            'photo' => is_array($raw['photo'] ?? null) && preg_match('#^https?://#', (string) ($raw['photo']['url'] ?? '')) ? $raw['photo'] : null,
            'i18n'  => is_array($raw['i18n'] ?? null) ? array_map('strval', $raw['i18n']) : [],
        ];
    }

    /** What the apps get, in a language (else English). */
    public static function payload(array $season, ?string $locale): array
    {
        $loc = $locale !== null && in_array($locale, Contest::LOCALES, true) ? $locale : 'en';
        $days = [];
        foreach (self::days($season) as $i => $d) {
            $t = $d['i18n'][$loc]['title'] !== '' ? $d['i18n'][$loc] : $d['i18n']['en'];
            if ($t['title'] === '') continue;
            $days[] = ['day' => $i + 1, 'title' => $t['title'], 'text' => $t['text'],
                       'photo' => $d['photo'] ? ['url' => $d['photo']['url'], 'credit' => self::credit($d['photo'])] : null];
        }
        $f = self::founder($season);
        $msg = trim($f['i18n'][$loc] ?? '') !== '' ? $f['i18n'][$loc] : ($f['i18n']['en'] ?? '');
        $founder = $f['name'] !== '' && trim($msg) !== ''
            ? ['name' => $f['name'], 'role' => $f['role'], 'message' => $msg, 'photo' => $f['photo'] ? ['url' => $f['photo']['url']] : null]
            : null;
        return ['itinerary' => $days, 'founder' => $founder];
    }

    private static function credit(array $p): string
    {
        $c = (string) ($p['credit'] ?? '');
        return $c !== '' && ($p['source'] ?? '') === 'pixabay' ? $c . ' · Pixabay' : $c;
    }
}
