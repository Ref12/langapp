"""Repeat the explicit Russian vocabulary selections against the pinned TSVs.

This is an authoring aid, not a frequency selector or the curriculum importer.
The checked-in YAML freezes record locators and locally assigned sense slots.
"""

from __future__ import annotations

import argparse
import re
from collections import Counter, defaultdict
from pathlib import Path

from curriculum_yaml import dump_entries, load_yaml
from russian_source import (
    TABLES as SOURCE_TABLES,
    expanded_selection,
    load_tables,
    source_reading,
    validate_selection,
)


CHECKSUMS = {
    "nouns": "c388f9e6dde51932832be8d7e9afdbe9f0acee72fcf70677f0fe25ea61293c84",
    "verbs": "8659de6799b949fb35f080b08088fb7d347ed300490954ebb380a31642646e1d",
    "adjectives": "89ab5d10dcd2f21f6b485de704aef372f32251468e3aa96f18b21e259f26b80a",
    "others": "9f22a16b17fc9a564298112168b667fced11aafb254ccebf5b7544fc37cdaa92",
}
TABLES = {"noun": "nouns", "verb": "verbs", "adjective": "adjectives"}
PREFIXES = {"nouns": "n", "verbs": "v", "adjectives": "a", "others": "o"}
# Known others-table inflections and their canonical source records.
PRONOUN_FORM_RECORDS = {
    4978: ("adjectives", 11866),
    4980: ("others", 6),
    4981: ("others", 20),
    4982: ("others", 18),
    4983: ("others", 21),
    4984: ("others", 6),
    4985: ("others", 20),
    4986: ("others", 4),
    4987: ("others", 11),
    4988: ("others", 18),
    4989: ("others", 21),
    4990: ("others", 14),
}
TOPICS = set(
    "communication people home clothing food health travel services leisure learning "
    "work money time actions description feelings reasoning grammar society institutions "
    "media technology nature science history culture arts argument register literature".split()
)

# Each block is an authored teaching decision, not a source-position range.
# Entries are lemma[ #sense-slot ][ @record ]|source span|optional authored hint.
# Bare lemmas use the explicit short-gloss ledger below, or the complete short
# source translation. There is no automatic first-sense extraction.
# Slots are explicit where a lexeme is revisited with a different common meaning.
BLOCKS: list[tuple[int | str, str, str, str]] = []

SHORT_GLOSSES = {
    row.split("|")[0]: row.split("|")[1:]
    for row in """
ответ|answer
пожалуйста|please
здесь|here
там|there
сейчас|now
налево|to the left
кухня|kitchen
спальня|bedroom
коридор|corridor
этаж|storey
лестница|stairs
потолок|ceiling
крыша|roof
лифт|elevator
кровать|bed
диван|sofa
кресло|armchair
шкаф|wardrobe
полка|shelf
зеркало|mirror
ковёр|carpet
лампа|lamp
электричество|electricity
холодильник|refrigerator
подушка|pillow
одеяло|blanket
простыня|bed-sheet
посуда|tableware
тарелка|plate
чашка|cup
вилка|fork
внутри|inside
сверху|from above
снизу|from below
продавец|shop assistant
покупатель|buyer
скидка|discount
рубль|rouble (Russian currency)
копейка|copeck
примерка|trying on
одежда|clothes
обувь|footwear
рубашка|shirt
футболка|T-Shirt
брюки|trousers
платье|dress
пальто|coat
шапка|cap|warm hat or cap
ботинок|shoe
сапог|boot
картофель|potatoes|potato
морковь|carrot
творог|cottage cheese
апельсин|orange|orange (fruit)
груша|pear
виноград|grapes
конфета|candy
насморк|coryza|runny nose
простуда|cold|a cold (illness)
самолёт|aeroplane
багаж|luggage
чемодан|suitcase
паспорт|passport
таможня|customs
трамвай|tram
платформа|platform
вагон|carriage|railway carriage
перекрёсток|Intersection
светофор|traffic lights
тротуар|sidewalk
парковка|parking lot
бензин|petrol
путешествие|journey
поездка|trip
турист|tourist
администратор|administrator
анкета|form|form or questionnaire
профессия|profession
сотрудник|employee
директор|director
зарплата|salary
совещание|meeting
учёба|studies
урок|lesson
ученик|pupil
учитель|teacher
преподаватель|instructor
экзамен|exam
тетрадь|exercise-book
словарь|dictionary
приглашение|invitation
праздник|holiday
подарок|gift
фильм|film
театр|theatre
концерт|concert
прогулка|stroll
кафе|café
меню|menu
произношение|pronunciation
газета|newspaper
радио|radio
телевидение|television|television broadcasting
телевизор|TV set
журналист|journalist
слушатель|listener
автор|author
шахматы|chess
футбол|soccer
велосипед|bicycle
игрок|player
тренер|coach
банкомат|ATM
ноутбук|laptop
интернет|internet
девальвация|devaluation
метр|metre
сантиметр|centimetre
грамм|gram
килограмм|kilogram
весна|springtime
осень|autumn
""".strip().splitlines()
}

LABEL_ADAPTATIONS = {
    "ru-or-o00082-s001": (
        "AI-authored interrogative label. The source's 'wherever' does not verify "
        "the selected 'where to?' meaning; the source spelling and stress are retained."
    ),
    "ru-or-n00254-s001": (
        "AI-authored English correction: 'border'. The source's 'abroad' is not a "
        "definition of this noun and is retained as provenance, not as the learner label."
    ),
    "ru-or-v00675-s001": (
        "AI-authored infinitival label normalizes the source's past-tense 'tried to'. "
        "The Russian lemma and source-marked stress are unchanged."
    ),
    "ru-or-n01282-s001": (
        "AI-authored general dependence label. The source's 'addiction' is a narrower "
        "meaning and does not independently verify this broader label."
    ),
    "ru-or-n00028-s001": (
        "AI-authored strength/force label. The source's broad English 'power' is "
        "retained as provenance, not as a verified technical definition."
    ),
}

# Reusing a meaning in another context is review, not a new introduction.
# Retain these rejected drafting candidates as an explicit negative ledger.
EXCLUDED_REVISITS = set("""
память#2 страница#2 объяснение#2 ошибка#2 проверить#2 проверить#3
оказаться#2 подозревать#2 независимый#2 исходный#2 предварительный#2
приблизительный#2 действительно#2 компенсация#2 предложение#3 покупатель#2
таможня#2 решение#2 регистрация#2 владелец#2 возвращать#2 продавать#2
потребовать#2 дисциплина#2 температура#2 давление#2 объём#2 среда#3
изменить#2 двигаться#2 нагревать#2 уважение#2 класс#2 происхождение#2
сочувствие#2 выбор#2 уважать#2 нарушить#2 сопротивляться#2 добровольный#2
частный#2 социальный#2 уточнение#2 подтверждение#2 возражение#2 слабость#2
приоритет#2 возможность#2 вероятность#2 альтернатива#2 уточнять#2
обусловливать#2 оспаривать#2 настаивать#2 уточнить#2 полный#2
принципиальный#2 существенный#3 убедительный#2 вместе#2 преимущественно#2
анализ#2 обобщение#2 оценка#2 структура#2 заключение#2 синтезировать#2
оформлять#2 упоминать#2 исключить#2 сократить#2 глубокий#2 дополнительный#2
обобщить#2 колебаться#2
убеждённость#2 заблуждение#2 догадаться#2 смущаться#2 сомневаться#2 искренний#2
будто#2 уведомление#2 распоряжение#2 возвратиться#2 официальный#2 уважительный#2
мягкий#2 подавленность#2 досада#2 восхищаться#2 наслаждаться#2 упиваться#2
горячий#2 холодный#2 светлый#2 содержание#2 разнообразие#2 соответствие#2
закономерность#2 необходимость#2 целостность#2 отличительный#2 внешний#2
самостоятельный#2 достаточный#2 необходимый#2 исчерпывающий#2 безусловный#2
объективный#2 субъективный#2 тон#2 плотность#2 уточнить#3 различаться#2
соответствовать#2 уступать#2 различить#2 соответствовать#3 ассоциация#2
конфликт#2 инсценировать#2 повествовательный#2 исторический#2 психологический#2
замысел#2 оценка#3 исследователь#2 миграция#2 настойчивость#2 достижение#2
усовершенствовать#2 экспериментальный#2 перспективный#2 уведомление#3
согласовывать#2 возместить#2 ключ#3 регистр#2 процесс#2 параметр#2 событие#2
распределение#2 дисперсия#2 равновесие#2 достоверный#2 статистический#2
подтекст#2 градация#2 пародировать#2 интерпретировать#2 риторический#2
растеряться#2 растеряться#3 непринуждённый#2
вырваться#2 рассыпаться#2 специфичный#2 внутренний#2 внутренний#3 равняться#2
препятствовать#2 хроника#2 первобытный#2 запрет#2 наследственность#2
исторический#3 основываться#2 объединение#2 достоверность#2 достоверность#3
неопределённость#2 колебаться#3 единственный#2 именно#2
судить#2 воспрепятствовать#2 ответственность#2 обращение#3 убеждённость#3
провозгласить#2 осведомляться#2 сломить#2 перетерпеть#2 невозмутимый#2
отчаянный#2 стойкий#2 крепкий#2
скользкий#2 растяжимый#2 сыпучий#2 очертание#2 конфигурация#2
сечение#2 высота#2 вариация#2
приглашение#2 делать#2 подняться#2 требование#2 неисправность#2 задолженность#2
покорить#2 учение#2 декламировать#2
""".split())

# Missing or mismatched source meaning, unsupported reading, or grammatical form.
# Never replace these automatically with the first available dictionary gloss.
DEFERRED = set("""
проверяемость подтвердиться обнаружиться косвенно объективно субъективно
вклад#2 сельское полномочия обложить поставить#2 приватизировать
вид#2 популяция развиться распространиться растворить выделять#2 выделиться
гендер этнос сопереживать терпеться переосмыслить
оговорить отстоять непротиворечивый категоричный релевантный тем
оценивание структурировать упорядочивать составлять#2 скорректировать
переработать#2 включить#2 перераспределить перестроить лаконичный
информативный заимствованный
недопонимание неоднозначность недосказанность предчувствовать переоценить
насторожиться настораживаться растеряться неоднозначный саркастический
настороженный намеренно учтивость объяснительная сленг эвфемизм фразеологизм
поприветствовать отругать надлежать осведомиться отбыть
растрогаться выдохнуться укорениться укореняться
отождествление различимость эквивалентность граница#2 оптимум
нетипичный специфичный несопоставимый взаимозависимый взаимосвязанный
опосредованный хрупкость ломкость объёмность весомость
отождествить сопоставляться соотноситься варьироваться
соизмерять соизмерить соподчинять отдалиться сблизить сужать
повествователь рассказчик аллюзия экспрессионизм переосмысливать экранизировать
мониторинг аудит инновация обобщённость масштабирование саморазвитие
соцобеспечение незащищённость инклюзия энергоснабжение энергосбережение
биоразнообразие рефлексия обратная реализовывать тестировать протестировать
реорганизовывать приспосабливать приспособиться интегрироваться объединиться
скооперироваться освоиться усвоиться инициировать подводить подвести
междисциплинарный интеграционный пилотный масштабируемый креативный эрудированный
внедрение осмыслять прочесть
найм соискатель текучесть#2 представительский документооборот реквизиты
логистика менеджмент мерчандайзинг трудоустроить трудоустраивать аккредитовать
завизировать визировать командировочный договорной
кодирование шифрование интерфейс процессор микропроцессор микросхема
резистор маршрутизатор репозиторий массив отладка декодировать отлаживать
отладить конфигурировать инициализировать перезагрузить перезапустить
перезапускать двоичный шестнадцатеричный аналоговый дискретный асинхронный аппаратный
воспроизводимость репликация репрезентативность регрессия ковариация
калибровка градуировка центрифуга нуклеотид геном метаболизм биомасса
экосистема геосфера верифицировать реплицировать экстраполировать
аппроксимировать коррелировать центрифугировать репрезентативный
воспроизводимый хромосомный метаболический
нарратология герменевтика семиотика прагматика интертекст интертекстуальность
архетип оксюморон эпифора эллипсис парцелляция литота цезура верлибр элегия
аллегоризировать версифицировать мифологизировать семиотический
интертекстуальный архетипический эпистолярный агиографический
тринадцать гречка
восхитить@7616
вооружённый скрытый ограниченный смущённый удручённый подавленный
измождённый измученный мерцающий насыщенный сжимаемый наклонённый вечная
синтаксист
доносить перенести#2 поручаться проделать доработаться отработать
нарабатывать прерваться вмешаться архивист раскопка руины
заселяться обосноваться возродиться датироваться определённость однозначность
доказуемость аутентичность очевидность конкретность хрестоматия
рецензирование предзаказ фонетика фонология этимология
размыслить увериться удостовериться пересудить прояснять спутать выдать#2
огласовка исповедальность душевность увещевание назидательность
втолковать втолковывать наставить увещать уведомляться
раздавливать разжаться надавить ухватываться сцепиться расколоться
надорваться сдержаться выносить#2 непробиваемый горячечный сокрушённый
абстрактность
однотонный сыпучий кулиса кулисы гастроли партия#2
климатология культурология ископаемый ископаемый#2 природопользование ресурсоёмкость
""".split())


def block(level: int | str, topic: str, pos: str, selections: str) -> None:
    BLOCKS.append((level, topic, pos, selections))


block(1, "communication", "noun", """
имя|name; слово|word; язык|language; вопрос|question; ответ; разговор|conversation
""")
block(1, "communication", "verb", """
понять|understand|understand or grasp (perfective); слышать|hear; значить|mean
говорить|speak; понимать|understand; повторить|repeat; знать|know
повторять|repeat
слушать|listen; спросить|ask; ответить|answer; читать|read; писать|write
""")
block(1, "people", "pronoun", """
я; ты|you|you (one familiar person); вы|you (formal)|you (formal or plural)
мы; он|he; она|she; они|they; кто; что|what
adjectives:мой|my; adjectives:твой|your|your (one familiar person's)
adjectives:этот|this; adjectives:какой|what kind of
""")
block(1, "communication", "interjection", """
да|yes; нет|no; спасибо; пожалуйста; здравствуйте; nouns:привет|hello (informal)
пожалуйста#2|you are welcome
""")
block(6, "communication", "interjection", "пожалуйста#3|here you go")
block(1, "communication", "adverb", """
adjectives:как|how; где; хорошо|well; плохо|it is bad; медленно|slowly
""")
block(1, "grammar", "conjunction", "и|and; но|but")
block(2, "grammar", "conjunction", "а|but, yet|whereas (contrast)")
block(1, "grammar", "particle", "не|not")
block(1, "grammar", "preposition", "в|in; на|on (place); из|from; с|with; о|about")
block(1, "actions", "verb", "быть|be; мочь|can; хотеть|want")
block(1, "description", "adjective", "русский|Russian; английский|English; новый|new; хороший|good")
block(2, "people", "noun", """
человек|person; друг|friend; семья; мать|mother; отец|father
сын|son; дочь|daughter; брат|brother; сестра|sister; ребёнок|child
женщина|woman; мужчина|man; иностранец|foreigner|person from another country
""")
block(2, "home", "noun", """
дом|house; квартира|apartment; комната|room; дверь|door; окно|window
стол|table; стул|chair; книга|book; телефон|telephone; сумка|bag; ключ|key
""")
block(2, "travel", "noun", """
город|town; улица|street; место|place; страна|country; школа|school
""")
block(2, "actions", "verb", "жить|live; иметь|have; видеть|see; искать|look for; находиться|be situated")
block(2, "people", "pronoun", "adjectives:чей|whose")
block(2, "description", "adjective", """
большой|big; маленький|small; старый|old; белый|white; чёрный|black
красный|red; синий|dark blue; зелёный|green
""")
block(2, "description", "adverb", "здесь; там; дома|at home")
block(2, "grammar", "preposition", "у|(possession)|possession with the genitive; для|for")
block(3, "food", "noun", """
вода|water; чай|tea; кофе|coffee; молоко|milk; хлеб|bread; суп|soup
рис|rice; мясо|meat; рыба|fish; яйцо|egg; сыр|cheese; яблоко|apple
сахар|sugar; соль|salt; завтрак|breakfast; обед|lunch; ужин@948|supper
""")
block(3, "food", "verb", "есть|eat; пить|drink; готовить|cook; любить|like")
block(3, "time", "noun", """
день|day; утро|morning; вечер|evening; ночь|night; час|hour; минута|minute
секунда|second|second (unit of time)
""")
block(3, "time", "adverb", "сегодня; завтра; сейчас; всегда|always; иногда|sometimes")
block(3, "actions", "verb", "делать|make, do|do or make; работать|work; спать|sleep; вставать|get up")
block(3, "description", "adjective", "горячий|hot; холодный|cold; вкусный|tasty")
block(3, "grammar", "numeral", """
nouns:ноль|nil|zero
один|one; два|two; три|three; четыре|four; nouns:пять|five
шесть|six; семь|seven; восемь|eight; девять|nine; десять|ten
""")
block(3, "grammar", "adverb", "сколько|how much; много|a lot of; мало|little")
block(3, "grammar", "noun", "половина|half")
block(3, "grammar", "verb", "считать#2|count|count (numbers or objects)")
block(4, "travel", "noun", """
дорога|road; автобус|bus; поезд|train; метро|metro; такси|taxi; билет|ticket
вокзал|station building; остановка|stop; карта|map; гостиница|hotel; туалет|toilet
""")
block(4, "health", "noun", "помощь|help; врач|doctor; аптека|pharmacy")
block(4, "communication", "noun", "переводчик|translator, interpreter|translator or interpreter (person)")
block(4, "time", "noun", "время|time; встреча|meeting; план|plan")
block(4, "actions", "verb", """
идти|walk; ехать|drive|go by vehicle; ждать|wait; помочь|help; помогать|help
показать|show; дать|give; взять|take; прийти|come
""")
block(4, "travel", "adverb", """
куда|wherever|where to?; далеко|far; близко|near; налево; направо; прямо|straight
""")
block(4, "grammar", "preposition", "к|towards, to; до|until; от|from (away); по|along")
block(4, "time", "adverb", "когда|when; потом|then; скоро|soon")
block(4, "communication", "predicative", "можно|may|it is permitted; нельзя|can't|not allowed or not possible")
block(4, "description", "adjective", "нужный|necessary; левый|left; правый|right-hand")

block(5, "home", "noun", """
кухня; спальня; ванная; коридор; балкон; этаж; лестница
стена|wall; пол|floor; потолок; крыша; лифт; подъезд|entrance
кровать; диван; кресло; шкаф; полка; зеркало; ковёр
лампа; свет|light; электричество; газ|gas; отопление; батарея|radiator
холодильник; плита|stove; раковина|sink; кран|tap; душ|shower
ванна|bath; мыло|soap; полотенце; подушка; одеяло; простыня
посуда; тарелка; чашка; стакан; ложка; вилка; нож|knife
бутылка; банка|jar; коробка|box; пакет|bag; мусор|rubbish
мебель; вещь|thing; замок|lock; адрес|address; сосед|neighbour; телевизор
""")
block(5, "home", "verb", """
давать|give
открыть|open; закрыть|close; открывать|open; закрывать|close
мыть|wash; помыть|wash; стирать|wash; убирать|tidy; убрать|tidy
чистить|clean; положить|put; класть|put; ставить|put; поставить|put
включать|switch on; включить|turn on; выключать|switch off; выключить|switch off
чинить|repair; починить|repair; переехать|move; переезжать|move
платить|pay; снять|rent; снимать|rent; принадлежать|belong
""")
block(5, "description", "adjective", """
чистый|clean; грязный|dirty; пустой|empty; полный|full; удобный|comfortable
мягкий|soft; твёрдый|hard; тёплый|warm; светлый|light; тёмный|dark
тихий|quiet; громкий|loud; уютный|cosy; собственный|own; домашний|domestic
""")
block(5, "description", "adverb", "внутри; снаружи; сверху; снизу; рядом|near; вместе|together; отдельно|separately")
block(5, "grammar", "preposition", "под|under; над|above; перед|in front of; между|between; без|without; за|behind")
block(5, "people", "noun", "муж|husband; жена|wife; бабушка|grandmother; дедушка|grandfather; мама|mom; папа|dad")
block(6, "services", "noun", """
магазин|shop; рынок|market; супермаркет; касса|cash-desk; кассир; продавец
покупатель; покупка|purchase; цена|price; скидка; чек|receipt; сдача|change
счёт|bill|bill (amount to pay)
деньги|money; рубль; копейка; наличные; очередь|queue; размер|size; примерка
""")
block(6, "clothing", "noun", """
одежда; обувь; рубашка; футболка; брюки; джинсы; юбка; платье
куртка; пальто; шапка; шарф; перчатка; носок; ботинок; сапог; туфля
""")
block(6, "food", "noun", """
овощ|vegetable; фрукт|fruit; картофель; помидор; огурец; морковь
лук|onion; чеснок; капуста; салат|salad; масло|butter; сметана
йогурт; творог; курица|chicken; говядина; свинина; колбаса; сок|juice
лимон; апельсин; банан; груша; ягода|berry; виноград; гриб|mushroom
печенье; конфета; шоколад; мороженое; торт; мука|flour; перец|pepper
""")
block(6, "health", "noun", """
здоровье|health; боль|pain; голова|head; живот|abdomen; зуб|tooth
горло|throat; температура|temperature; кашель; насморк; простуда; лекарство@1059|medicine
больница; поликлиника; рецепт|prescription; аллергия; симптом; анализ|analysis
""")
block(6, "services", "verb", """
брать|take; пробовать|tried to|try or sample (imperfective)
купить|buy; покупать|buy; продать|sell; продавать|sell; стоить|cost
заплатить|pay; заказывать|order; заказать|order; выбрать|choose
выбирать|choose; попробовать|try; менять|change; обменять|exchange
""")
block(6, "health", "verb", "болеть|be ill; лечить|treat; отдыхать|rest; отдохнуть|rest; чувствовать|feel")
block(6, "time", "noun", "четверть|a quarter, a fourth|quarter (one fourth)")
block(6, "description", "adjective", """
дорогой|expensive; дешёвый|cheap; свежий|fresh; сладкий|sweet; кислый|sour
солёный|salty; острый|sharp; голодный|hungry; здоровый|healthy; больной|sick
""")
block(7, "travel", "noun", """
аэропорт; самолёт; рейс|flight; посадка|boarding; багаж; чемодан
паспорт; виза; таможня; пассажир; водитель; граница|abroad|border
транспорт@1190|transport; трамвай; троллейбус; маршрут|route; расписание|time-table
платформа; вагон; купе; пересадка|change; путь|track; станция|station
поворот|turn; перекрёсток; светофор; мост|bridge; площадь|square
тротуар; переход|crossing; вход|entrance; выход|exit; парковка; бензин
путешествие; поездка; турист; отпуск|holiday
номер|room; бронь|reservation; администратор; регистрация
документ|document; подпись|signature; анкета; дата|date
""")
block(7, "travel", "verb", """
приехать|arrive; приезжать|arrive; уехать|leave; уезжать|leave
прибыть|arrive; отправляться|depart; отправиться|depart
лететь|fly; летать|fly; плыть|swim; плавать|swim
ходить|walk; ездить|go; войти|enter; входить|enter
выйти|go out; выходить|go out; повернуть|turn; поворачивать|turn
перейти|cross; переходить|cross; остановиться|stop; останавливаться|stop
бронировать@9482|reserve; забронировать|book; опоздать|be late; опаздывать|be late
успеть|to have time; возвращаться|return; вернуться|return
нести|carry; носить|carry; везти|transport; возить|transport
""")
block(7, "time", "noun", """
неделя; месяц|month; год|year; понедельник; вторник; среда|Wednesday
четверг; пятница; суббота; воскресенье; начало|beginning; конец|end
""")
block(7, "time", "adverb", "вчера; рано|early; поздно|late; сначала|at first; заранее|beforehand; вовремя|on time")
block(7, "description", "adjective", "долгий|long; короткий|short; быстрый|fast; медленный|slow; свободный|free; занятый|busy; иностранный|foreign")
block(8, "work", "noun", """
работа|job; профессия; офис; фирма|firm; компания|company; коллега
начальник|boss; сотрудник; рабочий|worker; инженер; секретарь; директор
задание|task; задача|task; проект|project; срок|term; перерыв|break
зарплата; совещание; договор|contract; выходной|weekend; опыт|experience
""")
block(8, "learning", "noun", """
произношение|pronunciation
учёба; урок; занятие|lessons|class or lesson; курс|course; класс|class; университет
институт|institute; студент; студентка; ученик; учитель; преподаватель
экзамен; оценка|grade; ошибка|mistake; упражнение; правило@264|rule
тетрадь; ручка|pen; карандаш; словарь; страница; текст|text; пример|example
""")
block(8, "leisure", "noun", """
приглашение; гость|guest; праздник; подарок; день#2|afternoon
кино|cinema; фильм; театр; концерт; музыка|music; песня; танец
спорт; игра|game; парк|park; прогулка; ресторан; кафе; меню
""")
block(8, "work", "verb", """
начать|begin; начинать|begin; закончить|finish; заканчивать|finish
делать#2|make; сделать|do; продолжать|continue; продолжить|continue
объяснять|explain; объяснить|explain; послать|send; отправить|send; отправлять|send
получить|receive; получать|receive; звонить|(phone)call; позвонить|call|make a telephone call
""")
block(8, "learning", "verb", """
записать|record|write down or record; записывать|record|write down or record
учить|learn; учиться|study; изучать|study; выучить|learn
написать|write; прочитать|read; переводить|translate; перевести|translate
запомнить|memorize; помнить|remember; забыть|forget
""")
block(8, "leisure", "verb", """
пригласить|invite; приглашать|invite; встретить|meet; встречать|meet
встретиться|meet; встречаться|meet; играть|play; гулять|walk
танцевать|dance; петь|sing; смотреть|watch; посмотреть|watch
""")
block(8, "description", "adjective", "интересный|interesting; скучный|boring; трудный|difficult; лёгкий|easy|easy (not difficult); важный|important; готовый|ready")
block(8, "grammar", "conjunction", "если|if; или|or; чтобы|in order to")
block(2, "people", "noun", "кот|cat; собака|dog; кошка|cat")
block(5, "people", "pronoun", """
себя|ourselves, yourselves, himself, herself, itself, yourself, myself, themselves|oneself (reflexive pronoun)
adjectives:свой|my|one's own (referring to the subject)
adjectives:сам|yourself|oneself (emphatic pronoun)
""")
block(6, "grammar", "determiner", """
adjectives:весь@11866|all, the whole of|all or the whole of; adjectives:каждый|each; adjectives:любой|any
adjectives:некоторый|some; несколько|a few
""")
block(6, "grammar", "numeral", """
nouns:одиннадцать|eleven; двенадцать|twelve; тринадцать|thirteen
четырнадцать|fourteen; nouns:пятнадцать|fifteen; шестнадцать|sixteen
семнадцать|seventeen; восемнадцать|eighteen; nouns:девятнадцать|nineteen
двадцать|twenty; nouns:тридцать|thirty; сорок|forty; пятьдесят|fifty
шестьдесят|sixty; семьдесят|seventy; восемьдесят|eighty
девяносто|ninety; сто|hundred; nouns:двести|two hundred
триста|three hundred; четыреста|four hundred; пятьсот|five hundred
шестьсот|six hundred; семьсот|seven hundred; восемьсот|eight hundred; девятьсот|nine hundred
nouns:тысяча|a thousand
""")
block(20, "grammar", "numeral", "nouns:миллион|million; nouns:миллиард|billion")
block(8, "learning", "noun", "библиотека|library; образование|education")
block(9, "grammar", "pronoun", "никто|nobody; ничто|nothing; кто-то|somebody; что-то|something; какой-то|some")
block(12, "grammar", "pronoun", "adjectives:который|which; adjectives:такой|such")
block(19, "grammar", "pronoun", "нечто|something")
block(5, "grammar", "adverb", "тоже|also")
block(12, "grammar", "adverb", "также|also")
block(9, "grammar", "conjunction", "пока|while; хотя|although")
block(18, "grammar", "conjunction", "поскольку|since; зато|but on the other hand")
block(23, "grammar", "conjunction", "либо|or; ибо|for|for (formal causal conjunction)")
block(24, "grammar", "adverb", "итак|thus")
block(5, "home", "noun", """
утюг|iron; пылесос|vacuum cleaner; веник|broom; ведро|bucket
таз|basin; щётка|brush; губка|sponge; тряпка|rag; салфетка|napkin
покрывало|coverlet; наволочка|pillow-case; скатерть|table-cloth
штора|curtain; занавеска|curtain; жалюзи|Venetian blind
будильник|alarm clock; часы|watch
печка|stove; чайник|kettle; кастрюля|saucepan; сковорода|frying-pan
дуршлаг|colander; тёрка|grater; термос|thermos; пробка|cork
крышка|lid; ручка#2|handle
""")
block(6, "food", "noun", """
пшеница|wheat; рожь|rye; овёс|oats; гречка|buckwheat
крупа|cereals; каша|porridge; макароны|macaroni; лапша|noodles
орех|nut; арахис|peanut; миндаль|almonds|almond
мёд|honey; варенье|jam; джем|jam; булочка|roll; пирог|pie
блин|pancake; пельмень|meat dumplings|meat dumpling; сосиска|sausage
ветчина|ham; индейка|turkey; утка|duck; баранина|mutton
креветка|shrimp; краб|crab; икра|caviar; сельдь|herring
лосось|salmon; тунец|tuna; фасоль|haricot; горох|peas
свёкла|beet; кабачок|marrow; баклажан|aubergine; тыква|pumpkin
петрушка|parsley; укроп|dill; редис|radish
вишня|cherry; черешня|cherry|sweet cherry; слива|plum; персик|peach
абрикос|apricot; клубника|strawberry; малина|raspberry
арбуз|water-melon; дыня|melon; ананас|pineapple
гранат|pomegranate; изюм|raisins; финик|date
""")
block(7, "travel", "noun", """
рельс|rail; электричка|electric train; паром|ferry
катер|boat|motor boat; лодка|boat; корабль|ship
велосипедист|cyclist; мотоцикл|motor cycle; грузовик|lorry
колесо|wheel; шина|tyre; руль|wheel|steering wheel or handlebars
тормоз|brake; сиденье|seat; ремень|belt
пешеход|pedestrian; шоссе|highway; трасса|route
километраж|mileage; путеводитель|guide-book; экскурсия|excursion
экскурсовод|guide; справка|information; бюро|office
постоялец|lodger
""")
block(13, "nature", "noun", """
сад|garden; огород|kitchen-garden; трава|grass; цветок|flower
лист@281|leaf; корень|root; стебель|stem; ветка|branch
ветвь|branch; ствол|trunk; кора|bark; плод|fruit; семя|seed
берёза|birch; дуб|oak; сосна|pine; ель|spruce; липа|linden
клён|maple; ива|willow; куст|bush
роза|rose; тюльпан|tulip; ромашка|camomile
сирень|lilac; лилия|lili|lily; одуванчик|dandelion
корова|cow; бык|bull; лошадь|horse; овца|sheep; коза|goat
свинья|pig; петух|rooster; гусь|goose; цыплёнок|chick
медведь|bear; волк|wolf; лиса|fox; заяц|hare; кролик|rabbit
белка|squirrel; ёж|hedgehog; олень|deer; лось|elk
пчела|bee; муха|fly; комар|mosquito; бабочка|butterfly
жук|beetle; муравей|ant; паук|spider
лягушка|frog; змея|snake; черепаха|tortoise
воробей|sparrow; голубь|pigeon; ворона|crow; орёл|eagle; сова|owl
""")

block(9, "time", "noun", """
событие|event; случай|incident; история|story; прошлое|past
будущее|future; момент|moment; эпоха|epoch; период|period
детство; молодость|youth; возраст|age; рождение|birth; жизнь|life
смерть|death; воспоминание|memory; память|memory; сон|dream
январь; февраль; март; апрель; май; июнь; июль; август
сентябрь; октябрь; ноябрь; декабрь; весна; лето; осень; зима
""")
block(9, "actions", "verb", """
случиться|happen; происходить|happen; произойти|happen; бывать|happen
появиться|appear; появляться|appear; исчезнуть|disappear; исчезать|disappear
оказаться|turn out; оказываться|turn out; остаться|remain; оставаться|remain
стать|become; становиться|become; родиться|be born; рождаться|be born
умереть|die; умирать|die; вырасти|grow; расти|grow
проснуться|wake; просыпаться|wake; заснуть|fall asleep; засыпать|fall asleep
встать|get up; сесть|sit down; сидеть|sit; стоять|stand; лежать|be situated
подняться|to climb; подниматься|rise; упасть|fall; падать|fall
бежать|run; бегать|run; побежать|break into a run; пойти|go
уйти|leave; уходить|leave; дойти|reach; доходить|reach
найти|find; находить|find; потерять|lose; терять|lose
забывать|forget; вспомнить|remember; вспоминать|remember
увидеть|see; услышать|hear; заметить|notice; замечать|notice
""")
block(9, "time", "adverb", """
недавно|recently; давно|long ago; однажды|one day
тогда|then; теперь|now; уже|already; ещё|still; наконец|finally
вдруг|suddenly; внезапно|suddenly; сразу|immediately; снова|again; опять|again
вскоре|soon; постепенно|gradually; одновременно|at the same time
ежедневно|daily; ежегодно|annually; постоянно|constantly; обычно|usually
часто|often; редко|rarely; никогда|never; долго|long
""")
block(9, "description", "adjective", """
прошлый|last; ранний|early; поздний|late; последний|last; следующий|next
давний|old; прежний|former; будущий|future; молодой|young
пожилой|elderly; взрослый|adult; неожиданный|unexpected; внезапный|sudden
""")
block(10, "feelings", "noun", """
чувство|feeling; настроение|mood; радость|joy; счастье|happiness
печаль|sorrow; грусть|sadness; страх|fear; тревога|anxiety; надежда|hope
любовь|love; ненависть|hatred; гнев|anger; злость|fury; обида|offence
стыд|shame; вина@1280|guilt; гордость|pride; зависть|envy; ревность|jealousy
удовольствие|pleasure; удивление|surprise; разочарование; сожаление|regret
интерес|interest; скука|boredom; покой|peace; спокойствие|calm
усталость|tiredness; одиночество|loneliness; сочувствие|sympathy
""")
block(10, "people", "noun", """
отношение|attitude; дружба|friendship; знакомство|acquaintance
подруга|friend; приятель|friend; adjectives:знакомый|acquaintance
родственник|relative; внук|grandson; внучка|granddaughter
дядя|uncle; тётя|aunt; племянник|nephew; племянница|niece
невеста|bride; жених|bridegroom; свадьба|wedding; брак|marriage
развод|divorce; пара|couple; партнёр|partner; товарищ|companion
характер|character; привычка|habit; поведение|behavior; улыбка|smile
смех|laughter; слеза|tear; объятие|embrace; поцелуй|kiss
""")
block(10, "health", "noun", """
лицо|face; глаз|eye; ухо|ear; нос|nose; рот|mouth; язык#2|tongue
губа|lip; щека|cheek; лоб|forehead; подбородок|chin; волос|hair
шея|neck; плечо|shoulder; рука|hand; нога|leg; палец|finger
колено|knee; спина|back; грудь|chest; сердце|heart; тело|body
""")
block(10, "feelings", "verb", """
радоваться|rejoice; обрадоваться|be glad; грустить|be sad
бояться|fear; испугаться|be frightened; пугать|frighten
надеяться|hope; ненавидеть|hate; злиться|be angry; сердиться|be angry
обидеть|hurt; обижать|offend; обидеться|take offense
стесняться|feel shy; гордиться|be proud; завидовать|envy
ревновать|be jealous; удивиться|be surprised; удивляться|wonder|react with wonder
жалеть|regret; сожалеть|regret; беспокоиться|worry; волноваться|worry
успокоиться|calm down; успокаивать|calm; доверять|trust
верить|believe; уважать|respect; ценить|value; скучать|miss
нравиться|like; понравиться|like; влюбиться|fall in love
улыбаться|smile; улыбнуться|smile; смеяться|laugh; засмеяться|laugh
плакать|cry; заплакать|begin to cry; обнять|embrace; целовать|kiss
жениться|marry; ссориться|argue; помириться|be reconciled
извиниться|apologise; прощать|forgive; простить|forgive
""")
block(10, "description", "adjective", """
весёлый|cheerful; грустный|sad; счастливый|happy; несчастный|unhappy
добрый|kind; злой|angry; спокойный|calm; нервный|nervous
смелый|courageous; трусливый|cowardly; честный|honest; искренний|sincere
вежливый|polite; грубый|rude; внимательный|attentive; заботливый|considerate
скромный|modest; одинокий|lonely; близкий|close; родной|dear
""")
block(11, "actions", "noun", """
действие|action; процесс|process; результат|result; способ|method
порядок|order; шаг|step; часть|part; кусок|piece
середина|middle; край|edge; поверхность|surface; сторона|side
форма|shape; отверстие|hole; круг|circle; линия|line; угол|angle
инструмент|tool; молоток|hammer; отвёртка; гвоздь|nail; винт|screw
игла|needle; нитка|thread; верёвка|rope; ножницы|scissors
кисть|brush; клей|glue; краска|paint; материал|material; ткань|fabric
дерево|wood; металл|metal; стекло|glass; бумага|paper
""")
block(11, "actions", "verb", """
держать|hold; поднять|lift; поднимать|raise
опустить|lower; опускать|lower; двигать|move; передвинуть|move
тащить|Carry something heavy; толкать|push; потянуть|pull; тянуть|pull
бросить|throw; бросать|throw; поймать|catch; ловить|catch
ударить|hit; ударять|strike; стучать|knock; нажать|press; нажимать|press
резать|cut; разрезать@14602|cut|cut into sections (perfective)
отрезать@715|cut off; порезать|cut
соединить|join; соединять|connect; разделить|divide; делить|divide
смешать|mix; смешивать|mix; добавить|add; добавлять|add
налить|pour; наливать|pour; лить|pour
наполнить|fill; наполнять|fill; вытереть|wipe; вытирать|wipe
сушить|dry; нагреть|heat; нагревать|heat; охладить|cool
варить|cook sth boiling|cook by boiling; сварить|cook; жарить@2179|fry; пожарить|fry; печь|bake
кипеть|boil; закипеть|begin to boil; кипятить|boil
повесить|hang; вешать|hang; висеть|to be hanging; закрепить|fasten
прикрепить|attach; крепить|make fast|fasten securely; завязать|tie; связать|tie
согнуть|bend; гнуть|bend; сложить|fold; складывать|fold
разобрать|disassemble; разбирать|disassemble; собрать|assemble; собирать|collect
проверить|check; проверять|check; исправить|correct; исправлять|correct
получиться|turn out; получаться|Be obtained|be obtained as a result
""")
block(11, "description", "adjective", """
сухой|dry; мокрый|wet; влажный|damp; гладкий|smooth; ровный|even
круглый|round; квадратный|square; плоский|flat; прямой|straight
кривой|crooked; толстый|thick; тонкий|thin; широкий|wide; узкий|narrow
длинный|long; глубокий|deep; мелкий|shallow; прочный|strong; слабый|weak
осторожный|careful; безопасный|safe; опасный|dangerous
""")
block(11, "actions", "adverb", """
осторожно|carefully; аккуратно|neatly; правильно|correctly
неправильно|incorrectly; последовательно|consecutively; поочерёдно|in turn
""")
block(12, "communication", "noun", """
информация|information; сообщение|message; известие|news; новость|news
объявление|announcement; уведомление|notification; предупреждение|warning
просьба|request; совет|advice; указание|instructions; инструкция|instructions
объяснение|explanation; уточнение|specification; подтверждение|confirmation
письмо|letter; записка|note; запись|record; заметка|note
почта|post; конверт|envelope; марка|stamp; посылка|parcel
переписка|correspondence; беседа|conversation; речь|speech
голос|voice; звук|sound; фраза|phrase; предложение|sentence
значение|meaning; смысл|meaning; перевод|translation
ударение|stress; буква|letter; алфавит; название|name
""")
block(12, "media", "noun", """
газета; журнал|magazine; статья|article; заголовок|headline
радио; телевидение; передача|broadcast; программа|program
экран|screen; канал|channel; репортаж|reporting; интервью
фотография|photograph; снимок|photo; камера|camera; реклама|advertising
журналист; редактор; читатель; зритель; слушатель; автор
""")
block(12, "communication", "verb", """
сказать|say; рассказывать|tell; рассказать|tell; сообщить|inform; сообщать|inform
передать|pass; передавать|pass; узнать|find out; узнавать|recognize
спрашивать|ask; отвечать|answer; просить|request; попросить|ask
советовать|advise; посоветовать|advise; предупредить|warn; предупреждать|warn
напомнить|remind; напоминать|remind; уточнить|clarify; уточнять|specify
подтвердить|confirm; подтверждать|confirm; обещать|promise; пообещать|promise
заявить|declare; заявлять|declare; упомянуть|mention; упоминать|mention
обсудить|discuss; обсуждать|discuss; разговаривать|talk
беседовать|converse; молчать|be silent; кричать|shout; крикнуть|shout
шептать|whisper; шепнуть|whisper; произнести|pronounce; произносить|pronounce
назвать|name; называть|name; означать|mean
обозначать|designate; обозначить|designate; печатать|print; напечатать|print
опубликовать|publish; публиковать|publish; объявить|announce; объявлять|declare
""")
block(12, "description", "adjective", """
ясный|clear; понятный|clear; непонятный|incomprehensible; точный|exact
краткий|brief; подробный|detailed; устный|oral; письменный|written
официальный|official
""")
block(12, "grammar", "adverb", "почему|why; поэтому|therefore; возможно|possibly; наверное|probably; действительно|really; просто|simply")
block(13, "reasoning", "noun", """
выбор|choice; решение|decision; мнение|opinion; взгляд|opinion
предпочтение|preference; желание|wishes; потребность|need
вариант|option; возможность|possibility; преимущество|advantage
недостаток|disadvantage; отличие|difference; разница|difference
сходство|similarity; сравнение|comparison; качество|quality
количество|quantity; польза|benefit; вред|harm; причина|reason
цель|aim; условие|condition; требование|demand; ограничение|restriction
""")
block(13, "reasoning", "verb", """
думать|think; подумать|think a little; считать|consider; решить|decide
решать|decide; сравнить|compare; сравнивать|compare; предпочитать|prefer
предпочесть|prefer; отличаться|differ; различать|distinguish
различить|distinguish; подходить|suit
зависеть|depend; оценить|evaluate; оценивать|evaluate; рекомендовать|recommend
согласиться|agree; соглашаться|agree; возразить|object; возражать|object
предложить|suggest; предлагать|suggest; принять|accept; принимать|accept
отказаться|refuse; отказываться|refuse; требовать|demand; потребовать|demand
сомневаться|doubt; убедить|convince; убеждать|convince
""")
block(13, "description", "adjective", """
другой|different; разный|different; одинаковый|identical; похожий|similar
подобный|similar; различный|various; общий|common; особый|special
особенный|special; обычный|ordinary; необычный|unusual; странный|strange
простой|simple; сложный|complex; полезный|useful; вредный|harmful
необходимый|necessary; лишний|unnecessary; достаточный|sufficient
основной|main; главный|main; дополнительный|additional
красивый|beautiful; прекрасный|beautiful; привлекательный|attractive
приятный|pleasant; неприятный|unpleasant; замечательный|remarkable
отличный|awesome|excellent (enthusiastic approval); ужасный|terrible; идеальный|ideal
высокий|high; низкий|low; тяжёлый|heavy; лёгкий#2|light|light (not heavy)
сильный|strong; яркий|bright; бледный|pale; жёлтый|yellow
серый|grey; коричневый|brown; розовый|pink; фиолетовый|violet
голубой|pale blue; оранжевый|orange; цветной|coloured
""")
block(13, "description", "noun", "вид|appearance; сила|power|strength or force")
block(13, "leisure", "noun", """
хобби; увлечение|enthusiasm; коллекция; шахматы; футбол; баскетбол
волейбол; теннис; плавание|swimming; бег|running; велосипед
лыжа; конёк|skate; стадион; бассейн|swimming pool; тренировка|training
соревнование|competition; команда|team; победа|victory; поражение|defeat
игрок; тренер; болельщик|fan; мяч|ball
музей; выставка|exhibition; картина|picture; рисунок|drawing
живопись|painting; скульптура
""")
block(13, "leisure", "verb", "рисовать|draw; нарисовать|draw; фотографировать|photograph; кататься|ride; тренироваться|train; выиграть|win; проиграть|lose")
block(13, "grammar", "adverb", "слишком|too; достаточно|enough; почти|almost; особенно|especially; совершенно|totally; совсем|completely; примерно|approximately")

block(14, "services", "noun", """
проблема|problem; трудность|difficulty; неудобство|inconvenience
неисправность|disrepair; поломка|breakage; авария|accident; утечка|leakage
ремонт|repair; замена|replacement; обслуживание|service
служба|service; мастер|expert|skilled tradesperson; специалист|specialist
заявка|application; жалоба|complaint; обращение|appeal
отказ|refusal; задержка|delay; отмена|cancellation; возврат|return
компенсация|compensation; гарантия|guarantee; квитанция|receipt
платёж|payment; долг|debt; банк|bank; банкомат; перевод#2|transfer
страхование|insurance; страховка|insurance; потеря|loss; пропажа|loss
кража|theft; вор|thief; полиция|police; охрана|guard
безопасность|safety; опасность|danger; риск|risk; происшествие|incident
пожар|fire; дым|smoke; огонь|fire; спасение|rescue; спасатель|rescuer
""")
block(14, "home", "noun", """
жильё|dwelling; аренда|rent; арендатор|tenant; владелец|owner
хозяин|landlord; соседка|neighbour; двор|yard; здание|building
строительство|construction; подвал|basement; чердак|attic; фундамент|foundation
труба|pipe; провод@1549|wire; розетка|socket; выключатель|switch
напряжение|voltage; водопровод|water-supply; канализация|sewer system
вентиляция; сырость|dampness; плесень|mould; трещина|crack
пятно|stain; пыль|dust; запах|smell; шум|noise; беспорядок|disorder
""")
block(14, "health", "noun", """
рана|wound; травма|injury; ожог|burn; порез|cut; ушиб|bruise
перелом|fracture; инфекция|infection; воспаление|inflammation
давление|pressure; пульс|pulse; кровь|blood; кожа|skin
дыхание|breathing; слабость|weakness; головокружение|dizziness
тошнота|nausea; обморок|fainting; обследование|inspection|medical examination or investigation
лечение|treatment; операция|operation; укол|injection
бинт|bandage; пластырь|plaster; таблетка|tablet; мазь|ointment
""")
block(14, "actions", "verb", """
сломать|break; ломать|break; сломаться|break; ломаться|break
испортить|spoil; портить|spoil; портиться|go bad
порвать|tear; рвать|tear; порваться|be torn; разбить|break; разбиться|crash
повредить|damage; повреждать|damage; протекать|leak
протечь|leak; отключить|disconnect; отключать|disconnect
заменить|replace; заменять|replace; отремонтировать|repair
восстановить|restore; восстанавливать|restore; устранить|eliminate; устранять|eliminate
жаловаться|complain; пожаловаться|complain; потребоваться|need|be required
понадобиться|be needed; вызвать|call; вызывать|call
отменить|cancel; отменять|cancel; задержать|delay; задерживать|delay
вернуть|return; возвращать|return; возместить|compensate; возмещать|compensate
украсть|steal; красть|steal; обнаружить|discover; обнаруживать|discover
спасти|save; спасать|save; защищать|protect; защитить|defend
пострадать|be injured; страдать|suffer; обращаться|turn to; обратиться|apply
""")
block(14, "description", "adjective", """
неисправный|faulty; исправный|in good repair; срочный|urgent
аварийный|emergency; серьёзный|serious; временный|temporary
постоянный|constant; виновный|guilty; бесплатный|free; платный|paid
""")
block(14, "services", "adverb", "срочно|urgently")
block(15, "work", "noun", """
сотрудничество|cooperation; коллектив|collective; отдел|department
отделение|department; подразделение|subdivision; руководство|leadership
руководитель|leader; заместитель|deputy; помощник|assistant
организация|organization; предприятие|enterprise; учреждение|institution
должность|post; обязанность|responsibility|assigned duty; ответственность|responsibility
полномочие|authority; поручение|assignment; исполнение|execution
подготовка|preparation; выполнение|fulfilment; распределение|distribution
участие|participation; участник|participant
поддержка|support; содействие|assistance; вклад|contribution
ресурс|resource; средство|means; бюджет|budget; расход|expenditure
затрата|expenditure; нагрузка|load; объём|volume; производительность|performance
эффективность|efficiency; отчёт|report; отчётность|accounts
итог|result; достижение|achievement; успех|success; неудача|failure
приоритет|priority; этап|stage; график|schedule; контроль|control
координация|co-ordination; согласование|agreement; взаимодействие|interaction
""")
block(15, "people", "noun", """
лидер|leader; член|member; союзник|ally; противник|opponent
конкурент|competitor; посредник|mediator; представитель|representative
доброволец|volunteer; добровольность|voluntariness; инициатива|initiative
доверие|trust; уважение|respect; терпение|patience; дисциплина|discipline
конфликт|conflict; спор|dispute; компромисс|compromise; уступка|concession
согласие|consent; разногласие|disagreement; возражение|objection
""")
block(15, "work", "verb", """
организовать|organize; организовывать|organize; планировать@1483|plan
запланировать|plan; подготовить|prepare; подготавливать|prepare
готовиться|prepare; подготовиться|prepare; выполнить|fulfil; выполнять|fulfil
осуществить|carry out; осуществлять|carry out; участвовать|participate
сотрудничать|co-operate; поддержать|support; поддерживать|support
поручить|entrust; поручать|entrust; назначить|appoint; назначать|appoint
распределить|distribute; распределять|distribute; руководить|be in charge
управлять|manage; контролировать|control; координировать|co-ordinate
согласовать|co-ordinate; согласовывать|co-ordinate
обеспечить|provide; обеспечивать|provide; снабжать|supply
снабдить|supply; выделить|allot; выделять|allot
привлечь|attract; привлекать|attract
предоставить|grant; предоставлять|provide; доверить|entrust
отчитаться|report; отчитываться|report; справиться|cope
справляться|cope; стараться|try; постараться|try; пытаться|try to
попытаться|tried to|attempt to do something; суметь|manage; достичь|achieve
достигать|achieve; преодолеть|overcome; преодолевать|overcome
отложить|postpone; откладывать|delay; перенести|postpone
усилить|strengthen; усиливать|strengthen; улучшить|improve; улучшать|improve
""")
block(15, "description", "adjective", """
совместный|joint; взаимный|mutual; индивидуальный|individual
коллективный|collective; ответственный|responsible; надёжный|reliable
добросовестный|conscientious; самостоятельный|independent
независимый|independent; способный|capable; опытный|experienced
профессиональный|professional; квалифицированный|qualified
компетентный|competent; эффективный|effective; успешный|successful
неуспешный|unsuccessful; регулярный|regular; обязательный|obligatory
добровольный|voluntary; гибкий|flexible; терпеливый|patient
""")
block(15, "work", "adverb", "совместно|jointly; самостоятельно|independently; взаимно|mutually; своевременно|in proper time")
block(16, "society", "noun", """
общество|society; народ|people; население|population; община|community
житель|inhabitant; гражданин|citizen; гражданство|citizenship
государство|state; республика|republic; федерация|federation
область|region; район|district; регион|region; столица|capital
деревня|village; село|village; посёлок|settlement; пригород|suburb
мир|world; мир#2|peace; война|war; армия|army; солдат|soldier
офицер|officer; оружие|weapon; оборона|defence; нападение|attack
беженец|refugee; миграция|migration; переселенец|settler
бедность|poverty; богатство|wealth; безработица|unemployment
неравенство|inequality; равенство|equality; благополучие|well-being
здравоохранение|public health; культура|culture
традиция|tradition; обычай|custom; религия|religion; вера|faith
""")
block(16, "institutions", "noun", """
власть|authority; правительство|government; парламент|parliament
президент|president; министр|minister; министерство|ministry
мэр|mayor; администрация|administration; совет#2|council
выборы|elections; избиратель|voter; голосование|voting
партия|party; политика|politics; закон|law; право|right
суд|court; судья|judge; юрист|lawyer; адвокат|lawyer
прокурор|prosecutor; преступление|crime; наказание|punishment
штраф|fine; разрешение|permission; запрет|ban; реформа|reform
протест|protest; демонстрация|demonstration; митинг|rally
""")
block(16, "media", "noun", """
источник|source; факт|fact; данные|data; слух|rumour
свидетель|witness; свидетельство|testimony; заявление|statement
комментарий|comment; обзор|review; хроника|chronicle
публикация|publication; редакция|editorial office; пресса|press
аудитория|audience; общественность|public; повестка|agenda
свобода|freedom; цензура|censorship; пропаганда|propaganda
""")
block(16, "society", "verb", """
голосовать|vote; избрать|elect; избирать|elect; править|rule
запретить|forbid; запрещать|forbid; разрешить|permit; разрешать|permit
нарушить|violate; нарушать|violate; соблюдать|observe
судить|judge; осудить|condemn; обвинить|accuse; обвинять|blame
наказать|punish; наказывать|punish; протестовать|protest
бороться|struggle
воевать|wage war; победить|win; побеждать|win; нападать@1443|attack
напасть|attack; отступить|retreat; отступать|retreat
переселиться|move; переселяться|move
""")
block(16, "description", "adjective", """
общественный|public; государственный|state; гражданский|civil
политический|political; социальный|social; международный|international
национальный|national; местный|local; городской|urban; сельский|rural
демократический|democratic; правовой|legal; законный|legal
незаконный|illegal; равный|equal; богатый|rich; бедный|poor
мирный|peaceful; военный|military; вооружённый|armed
""")
block(17, "technology", "noun", """
техника|equipment; технология|technology; устройство|device
прибор|instrument; аппарат|apparatus; механизм|mechanism
машина#2|machine; двигатель|engine; мотор|motor; оборудование|equipment
компьютер; ноутбук; клавиатура; мышь|mouse; монитор
файл|file; папка|folder; диск|disk
память#2|memory|computer memory; сеть|network; интернет; сайт
страница#2|page|page in an online document; ссылка|link; пароль|password
пользователь; доступ|access; соединение|junction
передача#2|transmission; сигнал|signal; волна@26442|wave; частота|frequency
скорость|speed; мощность|power; энергия|energy; заряд|charge
аккумулятор; кнопка|button; клавиша|key; кабель|cable
проводник|conductor; изоляция|insulation; датчик|data unit|sensing or measuring device
""")
block(17, "nature", "noun", """
природа|nature; среда#2|environment
окружение|environment; экология; климат|climate; погода|weather
воздух|air; атмосфера|atmosphere; кислород|oxygen; углерод|carbon
загрязнение|pollution; выброс|emission; переработка|processing
земля|earth; почва|soil; лес|forest; дерево#2|tree
растение|plant; животное|animal; птица|bird; насекомое|insect
море|sea; океан|ocean; река|river; озеро|lake; ручей|stream
берег|shore; остров|island; гора|mountain; холм|hill; долина|valley
равнина|plain; поле|field; луг|meadow; пустыня|desert; болото|swamp
дождь|rain; снег|snow; лёд|ice; ветер|wind; буря|storm
гроза|thunderstorm; гром|thunder; молния|lightning; туман|fog
облако|cloud; солнце|sun; луна|moon; звезда|star; небо|sky
наводнение|flood; засуха|drought; землетрясение|earthquake
""")
block(17, "technology", "verb", """
подключить|connect; подключать|connect
загрузить|load; загружать|load; скачать|download; сохранять|preserve
сохранить|preserve; удалить|delete; удалять|remove; копировать|copy
скопировать|copy; вставить|insert; вставлять|insert
обновить|update; обновлять|update; настроить|adjust; настраивать|adjust
использовать|use; пользоваться|use; применять|apply; применить|apply
работать#2|operate; функционировать|function; обслуживать|serve
измерить|measure; измерять|measure; передавать#2|transmit
потреблять|consume; потребить|consume; экономить|save
сэкономить|save; производить|produce; произвести|produce
""")
block(17, "nature", "verb", """
загрязнять|pollute; загрязнить|pollute; перерабатывать|process
охранять|protect; сохраняться|remain
вымирать|die out
таять|melt; растаять|melt; замерзать|freeze; замёрзнуть|freeze
нагреваться|get warm; охлаждаться|cool; испаряться|evaporate
течь|flow; дуть|blow; светить|give some light; светиться|shine
""")
block(17, "description", "adjective", """
технический|technical; электронный|electronic; цифровой|digital
автоматический|automatic; электрический|electric; механический|mechanical
современный|modern; природный|natural; экологический|ecological
климатический|climatic; солнечный|solar; водный|aqueous
воздушный|air; морской|marine; лесной|forest; подземный|underground
глобальный|global; устойчивый|stable
""")
block(18, "argument", "noun", """
предложение#2|offer; идея|idea; замысел|intention; намерение|intention
обоснование|justification; довод|argument; аргумент|argument
переговоры|negotiations; обсуждение|discussion; дискуссия|discussion
консультация|consultation; рекомендация|recommendation
требование#2|requirement
соглашение|agreement; сделка|deal; альтернатива|alternative
перспектива|prospect; прогноз|forecast; вероятность|probability
последствие|consequence; влияние|influence; воздействие|influence
резерв|reserve; запас|stock; баланс|balance; приём|technique
выгода|advantage; издержки|expenses
""")
block(18, "argument", "verb", """
обосновать|substantiate; обосновывать|substantiate
аргументировать|argue; доказать|prove; доказывать|prove
гарантировать|guarantee
договориться|agree; договариваться|agree; уступить|yield; уступать|yield
настаивать|insist; настоять|insist; воздержаться|abstain; воздерживаться|abstain
признать|admit; признавать|admit; учитывать|take into account
учесть|take into account; предусмотреть|foresee; предусматривать|foresee
рассмотреть|consider; рассматривать|consider; пересмотреть|reconsider
пересматривать|reconsider; изменить|change; изменять|change
измениться|change; изменяться|change; ограничить|limit; ограничивать|limit
расширить|extend; расширять|expand; сократить|reduce; сокращать|reduce
увеличить|increase; увеличивать|increase; уменьшить|decrease; уменьшать|decrease
повысить|promote; повышать|raise; снизить|lower; снижать|lower
сочетать|combine; совместить|combine
добиться|achieve; добиваться|achieve; заинтересовать|interest
предположить|suppose; предполагать|assume; ожидать|expect
рассчитывать|count on; повлиять|influence; влиять|influence
завершить|complete; завершать|complete; утвердить|approve; утверждать|assert
""")
block(18, "description", "adjective", """
возможный|possible; невозможный|impossible; вероятный|probable
реальный|real; осуществимый|feasible
целесообразный|expedient; выгодный|profitable; перспективный|promising
приемлемый|acceptable; неприемлемый|unacceptable; спорный|debatable
убедительный|convincing; разумный|reasonable; рациональный|rational
оптимальный|optimum; минимальный|minimum; максимальный|maximum
предварительный|preliminary; окончательный|final; долгосрочный|long-term
краткосрочный|short-term; существенный|essential; незначительный|insignificant
принципиальный|based on principle
""")
block(18, "argument", "adverb", "вероятно|very likely; очевидно|obviously; несомненно|undoubtedly; пожалуй|perhaps; скорее|rather; иначе|otherwise; напротив|on the contrary")
block(18, "grammar", "particle", "бы|would")
block(14, "travel", "verb", """
принести|bring; приносить|bring; отнести|carry; относить|take
унести|carry off; уносить|carry off; занести|bring
заносить|bring; вынести|carry out; выносить@1016|take sth away|carry away
донести|carry; доносить|carry; перенести#2|transfer
привезти|bring; привозить|bring; увезти|take away; увозить|carry off
отвезти|take; отвозить|take; завезти|deliver; завозить|deliver
вывезти|take out; вывозить@2591|take out; довезти|bring; довозить|bring
перевезти|transport; перевозить|transport; доставить|deliver; доставлять|deliver
привести|bring; приводить|bring; увести|lead away; уводить|lead away
отвести|lead; отводить|lead
зайти|call; заходить|call; заехать|call; заезжать|call
доехать|reach; доезжать|reach; добраться|reach; добираться|reach
обойти|go around; обходить|go around; объехать|travel around; объезжать|drive around
пройти#2|pass; проходить|pass; проехать|drive; проезжать|drive
пролететь|fly; пролетать|fly; проплыть|swim; проплывать|swim
подъехать|arrive; подъезжать|drive up; подойти#2|approach
прибежать|come running; прибегать|come running; убежать|run away
убегать|run away; выбежать|run out; выбегать@2396|run out
забежать|run; забегать|run; сбежать|run away; сбегать@14592|quickly go and get
спуститься|go down; спускаться|come down; подняться#2|come up
""")
block(5, "home", "verb", "завести|acquire; заводить|acquire")
block(15, "work", "verb", """
поручаться|vouch; поручиться|vouch; ручаться|vouch
забрать|pick up; забирать|take away; отобрать|take away; отбирать|select
переделать|do|do again or remake; переделывать|do over again; доделать|finish; доделывать|finish
проделать|do; проделывать|do; доработаться|work oneself
отработать|work off; отрабатывать|work off
наработать|turn out|produce through work; нарабатывать|produce
налаживать|put right; наладить|put right
возобновить|resume; возобновлять|resume
приостановить|suspend; приостанавливать|suspend
прекратить|stop; прекращать|stop; прекратиться|stop; прекращаться|cease
прервать|interrupt; прерывать|interrupt; прерваться|be interrupted
прерываться|be interrupted; вмешаться|interfere; вмешиваться|interfere
помешать|prevent; мешать|disturb; препятствовать|hinder
препятствовать#2|hinder|impede progress; воспрепятствовать|prevent
""")
block(21, "history", "noun", """
древность|antiquity; старина@2594|old times; современность|the present
наследие|heritage; наследственность#2|heredity|inherited biological traits
памятник|monument; мемориал|memorial; летопись|chronicle
хроника#2|chronicle|historical chronicle; архив|archives
архивист|archivist; историк|historian; археолог|archaeologist
раскопка|excavation; находка|find; руины|ruins; развалина|ruin
поселение|settlement; племя|tribe; род|family|lineage or clan; родина|homeland
отечество|fatherland; цивилизация|civilization
империя|empire; император|emperor; императрица|empress
царь|tsar; царица|tsarina; король|king; королева|queen
князь|prince; княгиня|princess; принц|prince; принцесса|princess
монарх|monarch; монархия|monarchy; династия|dynasty
престол|throne; трон|throne; корона|crown; герб|coat of arms
дворец|palace; крепость|fortress; замок@26428|castle
дворянство|nobility; дворянин|nobleman; аристократ|aristocrat
крестьянин|peasant; крестьянство|peasantry; помещик|landowner
раб|slave; рабство|slavery; крепостничество|serfdom
рыцарь|knight; вассал|vassal; феодал|feudal lord; феодализм
буржуазия|bourgeoisie; пролетариат|proletariat
революция|revolution; революционер|revolutionary
восстание|uprising; бунт|rebellion; мятеж|revolt
переворот|coup; завоевание|conquest; завоеватель|conqueror
колония|colony; колонизация|colonization; колониализм|colonialism
независимость|independence; освобождение|liberation
объединение#2|association|historical unification; распад|disintegration
расцвет|flourishing; упадок|decline; кризис|crisis
поход|campaign; битва|battle; сражение|battle; осада|siege
перемирие|armistice; капитуляция|capitulation; союз#2|alliance
дипломатия|diplomacy; посол|ambassador; посольство|embassy
""")
block(21, "learning", "noun", "атлас@7799|atlas")
block(27, "feelings", "noun", "мука@1154|torment")
block(21, "history", "verb", """
основать|found; основывать|found; основываться#2|be based|have a historical foundation
возвести|erect; возводить|erect; построить|build; строить@367|build
соорудить|erect; сооружать|erect
завоевать|conquer; завоёвывать|conquer; покорить#2|subdue
освободить|liberate; освобождать|liberate; освободиться|to be unoccupied
освобождаться|become free; заселить|settle; заселять|settle
заселяться|settle; обосноваться|settle; поселиться|settle
поселяться|settle; основаться|be founded
сохраниться|to maintain in a natural state|be preserved in a natural state; уцелеть|survive; пережить|survive
переживать|experience; возродиться|revive; возрождаться|revive
возродить|revive; возрождать|revive
распасться|disintegrate; распадаться|disintegrate
раскопать|excavate; раскапывать|excavate; датировать|date
датироваться|date; предшествовать|precede; сменить|replace; сменять|replace
""")
block(21, "description", "adjective", """
древний|ancient; старинный|ancient; средневековый|medieval
античный|ancient; доисторический|prehistoric
первобытный|primitive; первобытный#2|primitive|prehistoric rather than modern
цивилизованный|civilized; феодальный|feudal
капиталистический|capitalist; социалистический|socialist
коммунистический|communist; революционный|revolutionary
колониальный|colonial; имперский|imperial; царский|royal
королевский|royal; дворянский|noble; крестьянский|peasantish|peasant-related
исторический#3|historical|relating to the past
""")
block(22, "culture", "noun", """
духовность|spirituality; верование|belief; учение|doctrine
учение#2|teaching; религиозность|religiousness; атеизм|atheism
христианство|Christianity; ислам|Islam; буддизм|Buddhism
иудаизм|Judaism; индуизм|Hinduism; язычество|paganism
православие|Orthodoxy; католицизм|Catholicism; протестантизм|Protestantism
церковь|church; храм|temple; собор|cathedral; мечеть|mosque
синагога|synagogue; монастырь|monastery; священник|priest
духовенство|clergy; монах|monk; монахиня|nun
молитва|prayer; бог|god; богиня|goddess
святыня|object of worship; святость|holiness
обряд|rite; ритуал|ritual; церемония|ceremony
таинство|sacrament; исповедь|confession; покаяние|repentance
грех|sin; искупление|atonement; благословение|blessing
паломник|pilgrim; паломничество|pilgrimage
жертвоприношение|sacrifice; запрет#2|ban|religious prohibition
""")
block(23, "argument", "noun", """
аксиома|axiom; постулат|postulate; концепт|concept
предписание|prescription; предопределение|predestination
определённость|certainty; однозначность|unambiguity
убедительность|persuasiveness; беспристрастность|impartiality
объективность|objectivity; субъективность|subjectivity
доказуемость|provability; правдоподобие|plausibility
неправдоподобие|unlikelihood; достоверность#2|truth
достоверность#3|authenticity; аутентичность|authenticity
подлинность|authenticity; истинность|truth
очевидность|obviousness; наглядность|clearness
неточность|inaccuracy; неопределённость#2|uncertainty|lack of a settled interpretation
неясность|vagueness; неразбериха|confusion; путаница|confusion
двойственность|duality; противопоставление|opposition
упрощение|simplification; усложнение|complication
конкретизация|concrete definition; абстракция|abstraction
конкретность|concreteness; абстрактность|abstruseness
""")
block(24, "learning", "noun", """
параграф|paragraph; подраздел|subsection; подзаголовок|subheading
предисловие|preface; послесловие|afterword; посвящение|dedication
эпиграф|epigraph; тезаурус|thesaurus; энциклопедия|encyclopaedia
справочник|reference book; пособие#2|textbook; учебник|textbook
хрестоматия|reader; сборник|collection; антология|anthology
издание|edition; издательство|publishing house
издатель|publisher; типография|printing-house; тираж|circulation
печатник|printer; печать|print; переплёт|binding; обложка|cover
корешок|back|spine of a book; вкладка|supplementary sheet; закладка|bookmark
корректор|proof-reader; рецензирование|reviewing; предзаказ|preorder
орфография|orthography; пунктуация|punctuation
синтаксис|syntax; морфология|morphology; фонетика|phonetics
фонология|phonology; лексикография|lexicography
лексикология|lexicology; этимология|etymology
грамматика|grammar; синтаксист|syntactician
""")

block(19, "reasoning", "noun", """
знание|knowledge; исследование|research; наблюдение|observation
доказательство|proof; свидетельство#2|evidence; предположение|assumption
гипотеза|hypothesis; теория|theory; версия|version; объяснение#2|explanation|explanatory account
вывод|conclusion; заключение|conclusion; суждение|judgment
утверждение|assertion; тезис|thesis; основание|basis
проверка|examination; проверяемость|verifiability; достоверность|trustworthiness
надёжность|reliability; точность|accuracy; погрешность|error
измерение|measurement; подсчёт|calculation; расчёт|calculation
вычисление|calculation; статистика|statistics; выборка|selection
опрос|survey; эксперимент|experiment; опыт#2|experiment
выявление|exposure; установление|establishment; определение|definition
признак|sign; показатель|index; критерий|criterion
свойство@1174|property; характеристика|characteristic; параметр|parameter
совпадение|coincidence; закономерность|conformity to natural laws; случайность|chance
взаимосвязь|interdependence; зависимость|addiction|dependence; причинность|causality
неопределённость|uncertainty; сомнение|doubt; уверенность|confidence
убеждение|belief; заблуждение|delusion; иллюзия|illusion
предубеждение|prejudice; предвзятость|bias; ошибка#2|error|error in reasoning or measurement
""")
block(19, "reasoning", "verb", """
колебаться|hesitate
исследовать|investigate; изучить|study; наблюдать|observe
проследить|trace; отслеживать|track; выяснить|find out; выяснять|find out
выявить|reveal; выявлять|reveal; определить|determine; определять|determine
зафиксировать|fix; фиксировать|fix; зарегистрировать|register
регистрировать|register
подсчитать|count; подсчитывать|count; вычислить|calculate; вычислять|calculate
рассчитать|calculate; сопоставить|compare; сопоставлять|compare
проанализировать|analyse; анализировать|analyse
проверить#2|check|verify evidence; подтвердиться|be confirmed
подтверждаться|be confirmed; опровергнуть|refute; опровергать|refute
обнаружиться|be found; обнаруживаться|be found; выясниться|come to light
выясняться|turn out; оказаться#2|turn out|turn out on investigation
полагать|suppose; подозревать|suspect; подозревать#2|suspect|suspect an unverified explanation
допустить|admit; допускать|admit; исключить|exclude; исключать|exclude
отличить|tell a difference; проверить#3|check|test a claim rather than assume it
заблуждаться|be mistaken; ошибаться|be mistaken; ошибиться|make a mistake
""")
block(19, "description", "adjective", """
достоверный|valid; недостоверный|not authentic; объективный|objective
субъективный|subjective; очевидный|obvious; явный|obvious
неявный|implicit; скрытый|concealed; сомнительный|doubtful
бесспорный|indisputable; неопределённый|uncertain; определённый|specific
случайный|random; закономерный|naturally determined; причинный|causal
независимый#2|independent|independent evidence; зависимый|dependent
исходный|initial; исходный#2|initial|starting assumption
первичный|primary; вторичный|secondary; предварительный#2|preliminary|provisional finding
приблизительный|approximate; приблизительный#2|approximate|approximate numerical value
статистический|statistic|statistical; экспериментальный|experimental
теоретический|theoretical; эмпирический|empiric|empirical; логический|logical
фактический|actual; ошибочный|erroneous; ложный|false; истинный|true
""")
block(19, "reasoning", "adverb", """
предположительно|presumably; приблизительно|approximately
относительно|relatively; частично|partially; непосредственно|directly
косвенно|indirectly; объективно|objectively; субъективно|subjectively
якобы|supposedly; будто|as if; действительно#2|really|actually rather than apparently
""")
block(20, "money", "noun", """
экономика|economy; финансы|finances; капитал|capital; капитализм
доход|income; прибыль|profit; убыток|loss; рентабельность|profitability
выручка|receipts; оборот|turnover; инвестиция|investment; инвестор
вклад#2|deposit; кредит@2137|credit; заём|loan; ссуда|loan; ипотека|mortgage
процент|percentage; ставка|rate; валюта|currency; курс#2|exchange
инфляция; дефляция; девальвация; налог|tax; пошлина|duty
сбор|dues; тариф|tariff; субсидия|subsidy; дотация|subsidy
пособие|allowance; пенсия|pension; стипендия|scholarship; оплата|payment
вознаграждение|reward; премия|bonus; гонорар|fee; компенсация#2|compensation|financial compensation
собственность|property; имущество|property; актив|assets
обязательство|obligation; банкротство|bankruptcy; задолженность|debts
спрос|demand; предложение#3|offer|supply offered for sale
потребление|consumption; производство|production; торговля|trade
поставка|delivery; закупка|purchase; продажа|sale; сбыт|sale
производитель|producer; поставщик|supplier; потребитель|consumer
клиент|client; заказчик|customer; покупатель#2|buyer
конкуренция|competition; монополия|monopoly; предприниматель|entrepreneur
предпринимательство|business undertakings; бизнес|business; отрасль|field of industry
промышленность|industry; хозяйство|economy; сельское|rural
сырьё|raw materials; продукция|output; товар|goods
экспорт|export; импорт|import; таможня#2|customs|customs as an institution
""")
block(20, "institutions", "noun", """
управление|management; самоуправление|self-government
законодательство|legislation; конституция|constitution; кодекс|code
устав|charter; регламент|regulation; постановление|resolution
распоряжение|order; приказ|order; указ|decree
решение#2|decision|ruling by an institution; лицензия|licence
сертификат|certificate; патент|patent; регистрация#2|registration|official registration
полномочия|powers; компетенция|competence; юрисдикция|jurisdiction
департамент|department; ведомство|department; комитет|committee
комиссия|commission; коллегия|board; палата|chamber
фонд|fund; ассоциация|association; объединение|association
союз|union; профсоюз|trade union; корпорация|corporation
акционер|shareholder; акция|share; облигация|bond; биржа|bourse|stock or commodity exchange
аукцион; конкурс|competition; тендер|tender; контракт|contract
владелец#2|owner|legal owner; наследство|inheritance; наследник|heir
""")
block(20, "money", "verb", """
приобрести|acquire|acquire or purchase; приобретать|acquire|acquire or purchase
заработать|earn; зарабатывать|earn; тратить|spend; потратить|spend
вложить|invest; вкладывать|invest; инвестировать|invest
занять|borrow; занимать|occupy; одолжить|lend; одалживать|lend
возвратить|return; возвращать#2|return|repay borrowed funds
выплатить|pay; выплачивать|pay; оплатить|pay; оплачивать|pay
уплатить|pay; уплачивать|pay; перечислить|transfer; перечислять|transfer
начислить|charge extra; начислять|accrue; удержать|deduct; удерживать|deduct
облагать|assess|assess for taxation; обложить|tax; финансировать|finance; субсидировать|subsidize
продавать#2|sell|sell goods commercially; торговать|trade
поставлять|supply; поставить#2|deliver; закупать|buy; закупить|buy
потребовать#2|demand|demand payment; конкурировать|compete
приватизировать|privatize; владеть|own; распоряжаться|dispose
наследовать|inherit; обанкротиться|collapse|become bankrupt or fail
""")
block(20, "description", "adjective", """
экономический|economic; финансовый|financial; денежный|monetary
валютный|currency; налоговый|tax; бюджетный|budgetary
коммерческий|commercial; торговый|commercial; промышленный|industrial
производственный|industrial; сельскохозяйственный|agricultural
потребительский|Adjective of потребитель|consumer-related; частный|private; публичный|public
муниципальный|municipal; федеральный|federal; региональный|regional
законодательный|legislative; исполнительный|executive; судебный|judicial
административный|administrative; юридический|legal; договорный|contractual
оптовый|wholesale; розничный|retail; прибыльный|profitable; убыточный|unprofitable
""")
block(21, "science", "noun", """
наука|science; adjectives:учёный|scientist; лаборатория|laboratory
метод|method; методика|method; методология|methodology
дисциплина#2|discipline|branch of scientific study
физика; химия; биология; география; геология
астрономия; математика; медицина; психология; социология
философия; история#2|history; археология; лингвистика
модель|model; система|system; структура|structure; элемент|element
компонент|component; состав|composition; вещество|substance
материя|matter; масса|mass; вес|weight; плотность|density
температура#2|temperature|physical temperature; давление#2|pressure|physical pressure
движение|movement; ускорение|acceleration
пространство|space; расстояние|distance; длина|length
ширина|width; высота|height; глубина|depth; площадь#2|area
объём#2|volume|volume of matter; величина|quantity; единица|unit
метр; сантиметр; километр; миллиметр; грамм; килограмм
литр; тонна; формула|formula; уравнение|equation; число|number
доля|share; пропорция|proportion; сумма|sum; разность|difference
атом; молекула; частица|particle; электрон; протон; нейтрон
ядро|nucleus; излучение|radiation; радиация|radiation
тепло|heat; холод|cold; трение|friction; гравитация|gravitation
кислота|acid; щёлочь|alkali; раствор|solution; реакция|reaction
клетка|cell; организм|organism; ткань#2|tissue; орган@315|organ|body organ
ген; генетика; наследственность|heredity; эволюция|evolution
вид#2|species; популяция|population; среда#3|environment|biological environment
развитие|development; изменение|change; превращение|transformation
происхождение|origin; рост|growth; спад|downturn; цикл|cycle
стадия|stage; прогресс|progress; регресс|regress
""")
block(21, "science", "verb", """
существовать|exist; возникнуть|arise; возникать|arise
образовать|form; образовывать|form; образоваться|form; образовываться|form
состоять|consist; содержать|contain; содержаться|contain|be contained in
включать#2|include; составлять|amount to; составить|amount to
развиваться|develop; развиться|develop; развивать|develop; развить|develop
изменить#2|change|alter a property; преобразовать|transform
преобразовывать|transform; превращаться|turn into; превратиться|turn into
превратить|convert; превращать|convert
распространяться|spread; распространиться|spread
возрастать|increase; возрасти|increase; убывать|decrease; убыть|decrease
колебаться#2|hesitate
вращаться|rotate; вращать|rotate; перемещаться|move; переместиться|move
двигаться|move; двигаться#2|move|move in physical space
взаимодействовать|interact; воздействовать|influence; реагировать|react
растворять|dissolve; растворить|dissolve; растворяться|dissolve
выделять#2|secrete; выделиться|separate; выделяться|stand out
поглощать|absorb; поглотить|absorb; отражать|reflect; отразить|reflect
излучать|radiate; испускать|emit; нагревать#2|heat|raise the temperature
притягивать|attract; притянуть|pull; отталкивать|repel
изолировать|isolate; синтезировать|synthesize; классифицировать|classify
""")
block(21, "description", "adjective", """
научный|scientific; физический|physical; химический|chemical
биологический|biological; географический|geographic
геологический|geological; астрономический|astronomic|astronomical
математический|mathematical; медицинский|medical
психологический|psychologic|psychological; исторический|historical
естественный|natural; искусственный|artificial; органический|organic
неорганический|inorganic; живой|alive; неживой|inanimate
генетический|genetic; наследственный|hereditary
эволюционный|evolutionary; постепенный|gradual; непрерывный|continuous
циклический|cyclic; линейный|linear; относительный|relative
абсолютный|absolute; качественный|qualitative; количественный|quantitative
""")
block(22, "society", "noun", """
ценность|value; идеал|ideal; принцип|principle; норма|norm
мораль|morals; нравственность|morals; этика|ethics
совесть|conscience; достоинство|dignity; честь|honor
справедливость|justice; несправедливость|injustice
равноправие|equality; дискриминация|discrimination
уважение#2|respect|respect for others' rights; терпимость|tolerance
предрассудок|prejudice; стереотип|stereotype
идентичность|identity; личность|personality; индивидуальность|individuality
меньшинство|minority; большинство|most of the|majority; сообщество|community
класс#2|class|social class; слой|layer; поколение|generation
гендер|gender; пол#2|sex; раса|race; национальность|nationality
этнос|ethnos; происхождение#2|origin|social or cultural origin
разнообразие|diversity; солидарность|solidarity
сочувствие#2|sympathy|sympathy for another perspective; сострадание|compassion
милосердие|mercy; благотворительность|charity
жестокость|cruelty; насилие|violence; принуждение|coercion
угроза|threat; унижение|humiliation; оскорбление|insult
долг#2|duty; доброта@2476|kindness; щедрость|generosity
эгоизм|egoism; альтруизм|altruism; честность|honesty
искренность|sincerity; искушение|temptation; соблазн|temptation
выбор#2|choice|choice in an ethical dilemma; дилемма|dilemma
противоречие|contradiction; убеждённость|conviction
мировоззрение|world outlook; восприятие|perception
интерпретация|interpretation; позиция|position
""")
block(22, "people", "verb", """
сочувствовать|sympathize; сострадать|compassionate|feel compassion
сопереживать|empathize; терпеть|tolerate; вытерпеть|endure
стерпеть|endure; терпеться|have patience
уважать#2|respect|respect a position without agreeing
оскорбить|insult; оскорблять|insult; унизить|humiliate; унижать|humiliate
угрожать|threaten; пригрозить|threaten; принуждать|compel; принудить|compel
заставить|force; заставлять|force; вынудить|compel; вынуждать|compel
дискриминировать|discriminate; ущемлять|infringe; ущемить|infringe
жертвовать|sacrifice; пожертвовать|sacrifice; пожертвовать#2|make a donation
дарить|give; подарить|give; делиться|share; поделиться|share
осуждать|condemn; оправдать|justify; оправдывать|justify
избежать|escape; избегать|avoid; пренебрегать|neglect
пренебречь|neglect; злоупотреблять|abuse; манипулировать|manipulate
соблюсти|observe; нарушить#2|violate|violate a moral principle
противостоять|oppose; сопротивляться|resist; сопротивляться#2|resist|resist pressure
осознавать|realize; осознать|realize; переосмыслить|rethink
""")
block(22, "description", "adjective", """
моральный|moral; нравственный|moral; этический|ethic|ethical
справедливый|fair; несправедливый|unjust; достойный|worthy
недостойный|unworthy; гуманный|humane; бесчеловечный|inhumane
жестокий|brutal; терпимый|tolerant; нетерпимый|intolerant
уважительный|respectful; унизительный|humiliating
оскорбительный|insulting; принудительный|compulsory
добровольный#2|voluntary|chosen freely rather than coerced
личный|personal; частный#2|private|private rather than public
человеческий|human; общечеловеческий|common to all mankind|common to humanity
этнический|ethnic; культурный|cultural; религиозный|religious
социальный#2|social|concerning relations within society
уязвимый|vulnerable; равноправный|equal; неравный|unequal
эгоистичный|egotistic; бескорыстный|unselfish; щедрый|generous
""")
block(23, "argument", "noun", """
логика|logic; рассуждение|reasoning; аргументация|argumentation
посылка#2|premise; предпосылка|prerequisite
следствие|consequence; умозаключение|deduction; допущение|assumption
обобщение|generalization; исключение|exception; оговорка|reservation
уточнение#2|specification|qualification of a claim
поправка|amendment; коррекция|correction; пересмотр|revision
опровержение|refutation; подтверждение#2|confirmation|corroboration of a claim
критика|criticism; возражение#2|objection|reasoned counterargument
слабость#2|weakness|weakness in an argument; уязвимость|vulnerability
непоследовательность|inconsistency; последовательность|sequence
противоположность|opposite; различие|difference; разграничение|delimitation
соотношение|correlation; соответствие|correspondence
несоответствие|discrepancy; противовес|counterbalance
приоритет#2|priority|priority among competing reasons
дополнение|addition; обоснованность|validity; достаточность|sufficiency
необходимость|necessity; возможность#2|possibility|logical possibility
вероятность#2|probability|degree of likelihood
альтернатива#2|alternative|alternative explanation
оптимизм|optimism; пессимизм|pessimism; скептицизм|scepticism
детерминизм|determinism; рационализм|rationalism
""")
block(23, "argument", "verb", """
рассуждать|reason; заключать|conclude
вывести|infer; выводить@1191|infer; обобщать|generalize; обобщить|generalize
уточнять#2|specify|qualify a general claim; оговорить|stipulate
оговаривать|stipulate; подразумевать|imply
следовать|follow; обусловить|condition; обусловливать|condition
обусловливать#2|condition|be a determining condition
противоречить|contradict; соответствовать|correspond
противопоставить|oppose; противопоставлять|oppose
разграничить|differentiate; разграничивать|differentiate
разделять|share; отвергнуть|reject; отвергать|reject
отклонить|turn down; отклонять|turn down; оспорить|dispute; оспаривать|dispute
оспаривать#2|dispute|challenge an argument; критиковать|criticize
отстаивать|defend; отстоять|defend; настаивать#2|insist|insist on a distinction
объясниться|have a talk; объясняться|be explained
сводить|reduce; свести|reduce
основываться|be based; базироваться|be based
опираться|be guided; опереться|lean; подкреплять|support; подкрепить|support
дополнить|supplement; дополнять|supplement; уточнить#2|clarify|clarify the limits of a statement
""")
block(23, "description", "adjective", """
последовательный|consistent; others:непоследовательный|inconsistent
противоречивый|contradictory; непротиворечивый|consistent
обоснованный|well-founded; необоснованный|groundless
доказательный|demonstrative; голословный|unfounded
категоричный|categorical; безоговорочный|unconditional
условный|conditional; безусловный|unconditional
ограниченный|limited; всеобщий|universal; универсальный|universal
частичный|partial; полный#2|full|complete rather than partial
абстрактный|abstract; конкретный|specific
принципиальный#2|of principle|concerning a principle
формальный|formal; содержательный|substantial
релевантный|relevant; существенный#3|essential|material to the conclusion
уместный|appropriate; неуместный|inappropriate
убедительный#2|convincing|persuasive as an argument
состоятельный|well-grounded; несостоятельный|groundless
""")
block(23, "argument", "adverb", """
однако|however; тем|by that|by that (instrumental demonstrative)
впрочем|however; следовательно|consequently; соответственно|accordingly
притом|besides; причём|moreover; наоборот|on the contrary
вместе#2|together|taken together; исключительно|exclusively
преимущественно|mainly; преимущественно#2|mainly|predominantly rather than universally
отчасти|partly; лишь|only; только|only
именно|exactly; вовсе|at all; вполне|quite
""")
block(24, "learning", "noun", """
синтез|synthesis; анализ#2|analysis|analysis of several sources
резюме|summary; изложение|exposition; описание|description
обобщение#2|generalization|synthesis of multiple observations
аннотация|annotation; реферат|abstract; доклад|report
диссертация|dissertation; диплом|diploma; исследователь|investigator
рецензия|review; рецензент|reviewer; экспертиза|commission of experts
эксперт|expert; оценивание|evaluation; оценка#2|grade|assessment of a piece of work
источниковедение|source study; библиография|bibliography
ссылка#2|reference; цитата|quotation; цитирование|quoting
плагиат@26497|plagiarism; авторство|authorship; соавтор|co-author
публицистика|journalism; эссе|essay; очерк|essay; трактат|treatise
тема|theme; тематика|subject-matter; предмет|subject
содержание|content; структура#2|structure|structure of an extended text
раздел|section; глава|chapter; пункт|point; абзац|paragraph
введение|introduction; вступление|introduction; заключение#2|conclusion|closing section
примечание|note; сноска|footnote
таблица|table; диаграмма|diagram; схема|scheme; график#2|graph
иллюстрация|illustration; оглавление|contents|table of contents
перечень|list; список|list; каталог|catalogue; указатель|index
рукопись|manuscript; черновик|draft; редакция#2|wording
редактирование|editing; корректура|proof-reading
оформление|design; стандарт|standard; формат|format
""")
block(24, "learning", "verb", """
изложить|state; излагать|state; описать@643|describe; описывать|describe
обобщить#2|generalize|combine findings into a general account
резюмировать|sum up; суммировать|sum up; синтезировать#2|synthesize|combine ideas into a synthesis
систематизировать|systematize; структурировать|structure
упорядочить|put in order; упорядочивать|put in order
составить#2|compose; составлять#2|compile; оформить|put into shape
оформлять|put into shape; оформлять#2|complete|prepare in the required form
редактировать|edit; отредактировать|edit; корректировать|correct
скорректировать|correct; переписать|rewrite; переписывать|rewrite
переработать#2|rework; доработать|finish; дорабатывать|finish
цитировать|quote; процитировать|quote; ссылаться|refer
сослаться|refer; упоминать#2|mention|acknowledge a source
пояснить|elaborate; пояснять|explain; комментировать|comment
проиллюстрировать|illustrate; иллюстрировать|illustrate
включить#2|include; исключить#2|exclude|omit from a synthesis
сократить#2|reduce|shorten an account; перераспределить|redistribute
перестроить|rebuild; перестраивать|rebuild
""")
block(24, "description", "adjective", """
систематический|systematic; структурный|structural
целостный|integral; целый|whole; связный|coherent
бессвязный|incoherent; лаконичный|laconic; развёрнутый|detailed
обстоятельный|thorough; исчерпывающий|exhaustive
поверхностный|superficial; глубокий#2|deep|thorough rather than superficial
сжатый|concise; многословный|verbose; избыточный|redundant
информативный|informative; описательный|descriptive
аналитический|analytic|analytical; обзорный|Adjective of обзор|giving an overview
академический|academic; учебный|educational; исследовательский|research
авторский|Adjective of автор|authorial; оригинальный|original; заимствованный|borrowed
дополнительный#2|additional|supplementary material; справочный|inquiry|for reference or information
""")

block(25, "communication", "noun", """
намёк|hint; подтекст|implication; ирония|irony; сарказм|sarcasm
юмор|humour; шутка|joke; насмешка|mockery; усмешка|smirk
недоразумение|misunderstanding; недопонимание|misunderstanding
двусмысленность|ambiguity; неоднозначность|ambiguity
недомолвка|innuendo; умолчание|failure to mention; недосказанность|reticence
иносказание|allegory; внушение|suggestion; убеждённость#2|conviction|strength of a belief
догадка|conjecture|guess; подозрение|suspicion; предчувствие|presentiment
ожидание|expectation; впечатление|impression; ощущение|sensation
интуиция|intuition; воображение|imagination; фантазия|fantasy
мечта|dream; заблуждение#2|delusion|mistaken belief about another's intent
самообман|self-deception; обман|deception; ложь|lie
притворство|pretence; лесть|flattery; лицемерие|hypocrisy
откровенность|frankness; прямота|straightforwardness
сдержанность|restraint; застенчивость|shyness; смущение|confusion
неловкость|awkwardness; такт|tact; бестактность|tactlessness
""")
block(25, "feelings", "verb", """
догадываться|guess; догадаться|guess; догадаться#2|guess|infer an unstated meaning
угадывать|guess; угадать|guess; предчувствовать|foresee
намекать|hint; намекнуть|hint; внушать|inspire; внушить|inspire
воображать|imagine; вообразить|imagine; представлять|imagine
представить|imagine; мечтать|dream; фантазировать|dream up
притворяться|pretend; притвориться|pretend; симулировать|simulate
преувеличить|exaggerate; преувеличивать|exaggerate
преуменьшить|underestimate; преуменьшать|underestimate
недооценить|underestimate; недооценивать|underestimate
переоценить|overestimate; переоценивать|overestimate
скрывать|hide; скрыть|hide; скрываться|hide
утаить|conceal; утаивать|conceal; умолчать|pass over in silence
умалчивать|pass over in silence; обмануть|deceive; обманывать|deceive
лгать|lie; солгать|lie; врать|lie; соврать|lie
льстить|flatter; лицемерить|play the hypocrite
насторожить|put on his, her guard|put someone on guard
настораживать|put on his, her guard|put someone on guard
насторожиться|become alert; настораживаться|become alert
смущать|embarrass; смутить|embarrass; смущаться|be embarrassed
смущаться#2|be embarrassed|feel self-conscious; растеряться|be confused
растеряться#2|be confused|lose one's composure; растеряться#3|be confused|be at a loss
теряться|be lost|be lost or at a loss; озадачить|puzzle; озадачивать|puzzle
недоумевать|be perplexed; сомневаться#2|doubt|withhold commitment
""")
block(25, "description", "adjective", """
косвенный|indirect; прямолинейный|straightforward
двусмысленный|ambiguous; неоднозначный|ambiguous
недвусмысленный|unambiguous; многозначительный|significant
явственный|distinct; невольный|involuntary
намеренный|intentional; преднамеренный|premeditated
непреднамеренный|unpremeditated; умышленный|deliberate
иронический|ironical; саркастический|sarcastic
насмешливый|mocking; шутливый|jocular; иносказательный|allegorical
откровенный|frank; искренний#2|sincere|genuine rather than pretended
неискренний|insincere; притворный|feigned; льстивый|flattering
лицемерный|hypocritical; наивный|naive; доверчивый|trustful
подозрительный|suspicious; недоверчивый|mistrustful
настороженный|on one's guard; застенчивый|shy; смущённый|embarrassed
сдержанный|restrained; деликатный|delicate; тактичный|tactful
бестактный|tactless; неловкий|embarrassing; скрытный|secretive
""")
block(25, "grammar", "particle", """
же|as for; ведь|after all; разве|really|really? (questioning an assumption)
неужели|really|really? (surprised question)
будто#2|as if|as if introducing a doubtful appearance
вроде|sort of; даже|even; именно#2|namely
""")
block(25, "feelings", "adverb", "невольно|involuntarily; нарочно|on purpose; намеренно|deliberately; искренне|sincerely; откровенно|frankly; едва|hardly")
block(26, "register", "noun", """
регистр|register; стиль|style; тон|tone; интонация|intonation
манера|manner; этикет|etiquette; вежливость|politeness
учтивость|courtesy; любезность|courtesy; фамильярность|familiarity
субординация|seniority; дистанция|distance
обращение#2|address; приветствие|greeting; прощание|farewell
благодарность|gratitude; извинение|apology; поздравление|congratulation
пожелание|wish; соболезнование|condolence; комплимент|compliment
похвала|praise; одобрение|approval; неодобрение|disapproval
порицание|censure; упрёк|reproach; замечание|remark
выговор|reprimand; претензия|claim; обвинение|accusation
оправдание|justification; отговорка|excuse; объяснительная|explanatory note
ходатайство|petition; прошение|petition; петиция|petition
запрос|inquiry; уведомление#2|notification|formal notification
приглашение#2|invitation|formal invitation; распоряжение#2|order|instruction from an authority
лексика|vocabulary; лексикон|lexicon; термин|term
терминология|terminology; жаргон|jargon; сленг|slang
просторечие|popular language|nonstandard colloquial speech; диалект|dialect; наречие|dialect
неологизм|neologism; архаизм|archaism; заимствование|borrowing
эвфемизм|euphemism; ругательство|swear-word
брань|abuse; острота|witticism; поговорка|saying
пословица|proverb; фразеологизм|phraseological unit
""")
block(26, "communication", "verb", """
приветствовать|greet; поприветствовать|greet; прощаться|say goodbye
попрощаться|say goodbye; благодарить|thank; поблагодарить|thank
извиняться|apologise; поздравлять|congratulate; поздравить|congratulate
соболезновать|condole; желать|wish; пожелать|wish
приветствовать#2|welcome; одобрять|approve; одобрить|approve
похвалить|praise; хвалить|praise; хвалиться|boast
похвастаться|show off; хвастаться|boast; упрекнуть|reproach
упрекать|reproach; укорять|reproach; укорить|reproach
порицать|blame; отчитать|tell off; отругать|scold
ругать|scold; ругаться|swear; бранить|scold; браниться|swear
требоваться|require|be required; надлежать|be necessary; полагаться|be due
являться|is|be (formal linking verb); представляться|seem
осведомиться|inquire; осведомляться|inquire
поинтересоваться|express interest in; интересоваться|be interested
уведомить|notify; уведомлять|notify; известить|inform; извещать|inform
предписать|prescribe; предписывать|prescribe
ходатайствовать|apply|petition an authority; уполномочить|authorize
дозволять|permit; дозволить|permit; повелеть|command
проследовать|proceed; прибывать|arrive; отбыть|depart
отбывать|depart; возвратиться|return; возвратиться#2|return|return (formal narrative)
изволить|deign; соизволить|deign; удостоить|honour
""")
block(26, "description", "adjective", """
официальный#2|official|official rather than conversational
неофициальный|unofficial; деловой|business; канцелярский|bureaucratic
разговорный|colloquial; просторечный|low colloquial; книжный|bookish
литературный|literary; поэтический|poetic; торжественный|solemn
риторический|rhetorical; нейтральный|neutral; эмоциональный|emotional
экспрессивный|expressive; оценочный|Adjective of оценка|evaluative
уважительный#2|respectful|deferential in tone; учтивый|courteous
любезный|obliging; обходительный|well-mannered; почтительный|respectful
фамильярный|familiar; дружеский|friendly; дружелюбный|friendly
непринуждённый|free and easy; непринуждённый#2|unconstrained|relaxed in manner
снисходительный|condescending; высокомерный|arrogant
презрительный|contemptuous; презренный|contemptible
грубоватый|rude; резкий|sharp; мягкий#2|soft|gentle rather than harsh in tone
вульгарный|vulgar; непристойный|indecent; неприличный|improper
приличный|decent; корректный|correct; некорректный|discourteous
дипломатичный|diplomatic; дипломатический|diplomatic
""")
block(27, "feelings", "noun", """
душа|soul; дух|spirit; воля|will; разум|mind; ум|mind
сознание|consciousness; подсознание|subconsciousness
сердечность|cordiality; отзывчивость|responsiveness
пыл|ardour; страсть|passion; порыв|impulse; стремление|aspiration
рвение|zeal; усердие|diligence; настойчивость|persistence
упорство|persistence; упрямство|stubbornness; решимость|determination
отвага|courage; мужество|courage; трусость|cowardice
хладнокровие|composure; самообладание|self-control
самоуверенность|self-confidence; самомнение|conceit
тщеславие|vanity; честолюбие|ambition; самолюбие|pride
обаяние|charm; очарование|charm; восторг|excitement
восхищение|admiration; умиление|tender emotion; нежность|tenderness
блаженство|bliss; наслаждение|enjoyment; ликование|exultation
тоска|melancholy; уныние|dejection; отчаяние|despair
подавленность|depression; подавленность#2|depression|low spirits
безразличие|indifference; равнодушие|indifference
апатия|apathy; отвращение|disgust; презрение|contempt
негодование|indignation; возмущение|indignation; раздражение|irritation
нетерпение|impatience; досада|annoyance; досада#2|annoyance|frustration at a setback
растерянность|confusion; замешательство|confusion
""")
block(27, "feelings", "verb", """
стремиться|aspire; рваться|long|long eagerly to do something; тосковать|long
унывать|lose heart; отчаяться|despair; отчаиваться|despair
ликовать|exult; восторгаться|be delighted; восхищаться|admire
восхитить@7616|delight; восхищать|delight; восхищаться#2|admire|admire an achievement
наслаждаться|enjoy; наслаждаться#2|enjoy|take deep pleasure
упиваться|revel; упиваться#2|revel|revel figuratively in success
очаровать|charm; очаровывать|charm; пленить|capture
пленять|captivate; покорить|conquer; покорять|conquer
потрясти|Shock; потрясать|shake; поразить|strike
поражать|strike; поражаться|to be surprised
растрогать|touch; растрогаться|be touched; тронуть|touch
утешить|comfort; утешать|comfort; утешаться|console oneself
ободрить|encourage; ободрять|encourage; вдохновить|inspire
вдохновлять|inspire; воодушевить|inspire; воодушевлять|inspire
увлечь|carry away; увлекать|carry away; увлекаться|be carried away
презреть|despise; презирать|despise; отвращать|avert
возмущаться|be indignant; возмутиться|outrage|react with indignation
негодовать|be indignant; раздражать|annoy; раздражить|irritate
раздражаться|chafe|become irritated; досадовать|bemoan
огорчать|distress; огорчить|distress; огорчаться|be disappointed
огорчиться|be disappointed; мучить|torment; мучиться|suffer
терзать|torment; терзаться|suffer torments; томиться|languish
изнемогать|be exhausted; изнурять|exhaust
обессилеть|grow weak; выдохнуться|be exhausted
""")
block(27, "actions", "verb", """
переносить|endure
разжечь|kindle; разжигать|kindle; вспыхнуть|flare up
вспыхивать|flare up; угаснуть|die away; угасать|die away
погасить|extinguish; гасить|extinguish; погаснуть|turn off|go out (a light or flame)
пылать|blaze; гореть|burn; сгореть|be burnt down
разгореться|flare up; тлеть|smoulder; охватить|embrace
охватывать|embrace; погрязнуть|be bogged down; увязнуть|get bogged down
застрять|be held up; застревать|Get caught; вырваться|break loose
вырываться|break loose; пробиться|force a way through; пробиваться|push up
вырваться#2|break away|escape figuratively from a constraint
пробудить|rouse; пробуждать|rouse; пробуждаться|awake
расцветать|bloom; расцвести|bloom; увядать|fade
увянуть|fade; рассыпаться@1342|crumble; рассыпаться#2|crumble|collapse figuratively
рухнуть|collapse; рушиться|collapse; разрушить|destroy
разрушать|destroy; разрушаться|go to ruin
заронить|drop; зарождаться|arise; зародиться|to be conceived
укорениться|take root; укореняться|take root
ожить|revive; оживать|revive; оживить|revive; оживлять|revive
""")
block(27, "description", "adjective", """
пылкий|ardent; страстный|passionate; горячий#2|hot|ardent or heated
пламенный|fiery; холодный#2|cold|emotionally cold
ледяной|icy; жгучий|burning; горький|bitter
сладостный|sweet; едкий|caustic; колкий|caustic; язвительный|caustic
тягостный|burdensome; тяжкий|heavy; гнетущий|oppressive
мрачный|gloomy; угрюмый|sullen; унылый|despondent
светлый#2|light|hopeful or uplifting; радужный|iridescent
блестящий|brilliant; блистательный|brilliant; ослепительный|dazzling
яростный|furious; неистовый|furious; буйный|violent
нежный|tender; трогательный|touching; умилительный|touching
жизнерадостный|cheerful; безрадостный|joyless
равнодушный|indifferent; безразличный|indifferent
отзывчивый|responsive; чуткий|sensitive; бесчувственный|insensitive
упорный|persistent; упрямый|stubborn; настойчивый|persistent
самонадеянный|presumptuous; самоуверенный|self-confident
""")
block(28, "reasoning", "noun", """
понятие|concept; категория|category; сущность|essence
суть|essence; содержание#2|content|semantic content
явление|phenomenon; реальность|reality; действительность|reality
бытие|being; существование|existence; отсутствие|lacking of|absence or lack
наличие|presence; единство|unity; целостность|integrity
множественность|plurality; разнообразие#2|diversity|variety of forms
тождество|identity; идентификация|identification
отождествление|identification; различимость|distinguishability
соответствие#2|correspondence|correspondence between concepts
эквивалент|equivalent; эквивалентность|equivalence
аналог|analogue; аналогия|analogy; подобие|likeness
градация|gradation; иерархия|hierarchy; уровень|level
ранг|rank; степень|degree; масштаб|scale
диапазон|range; интервал|interval; предел|limit
граница#2|boundary; рамка|frame; порог|threshold
максимум|maximum; минимум|minimum; оптимум|optimum
избыток|surplus; дефицит|deficit; достаток|prosperity
совокупность|aggregate; множество|tons of|a great number
совместимость|compatibility; несовместимость|incompatibility
однородность|homogeneity; неоднородность|heterogeneity
целесообразность|expediency; закономерность#2|conformity to natural laws|regular pattern
обратимость|reversibility; необратимость|irreversibility
неизбежность|inevitability; необходимость#2|necessity|logical necessity
целостность#2|integrity|wholeness of a system
""")
block(28, "description", "adjective", """
единичный|single; множественный|plural; единственный|only
единственный#2|sole; уникальный|unique; типичный|typical
нетипичный|atypical; характерный@11755|characteristic; своеобразный|original
специфический|specific; специфичный|specific; специфичный#2|specific|peculiar to a domain
отличительный|distinctive; отличительный#2|distinctive|serving to distinguish
тождественный|identical; идентичный|identical; эквивалентный|equivalent
аналогичный|analogous; соразмерный|proportionate
соизмеримый|commensurable; несоизмеримый|incommensurable
сопоставимый|comparable; несопоставимый|incomparable
сравнимый|comparable; несравнимый|incomparable
совместимый|compatible; несовместимый|incompatible
однородный|homogeneous; неоднородный|heterogeneous
однозначный|unambiguous; многозначный|polysemantic
односторонний|one-sided; двусторонний|bilateral; многосторонний|multilateral
внутренний|inner; внешний|external; внутренний#2|inner
внутренний#3|internal|intrinsic to a system; внешний#2|external|extrinsic to a system
присущий|inherent; свойственный|peculiar; неотъемлемый|inalienable
неотделимый|inseparable; самостоятельный#2|independent|independent as a unit
взаимозависимый|interdependent; взаимосвязанный|interconnected
обратный|opposite; обратимый|reversible; необратимый|irreversible
неизбежный|inevitable; неминуемый|inevitable; допустимый|permissible
недопустимый|inadmissible; достаточный#2|sufficient|sufficient for a stated condition
необходимый#2|necessary|logically necessary
исчерпывающий#2|exhaustive|covering all possibilities
предельный|utmost; бесконечный|infinite; конечный|ultimate
безграничный|boundless; безмерный|boundless; неограниченный|unlimited
безусловный#2|unconditional|not dependent on another condition
непосредственный|direct; опосредованный|mediated
потенциальный|potential; актуальный|relevant
объективный#2|objective|independent of an observer
субъективный#2|subjective|dependent on an observer
""")
block(28, "description", "noun", """
цвет|colour; оттенок|shade; тон#2|tone|shade of colour
яркость|brightness; контраст|contrast; насыщенность|saturation
прозрачность|transparency; непрозрачность|opacity
прочность|strength; твёрдость|hardness; мягкость|softness
гибкость|flexibility; упругость|elasticity; эластичность|elasticity
хрупкость|fragility; ломкость|brittleness; пластичность|plasticity
гладкость|smoothness; шероховатость|roughness
влажность|humidity; сухость|dryness; вязкость|viscosity
текучесть|fluidity; растворимость|solubility; горючесть|combustibility
проводимость|conductivity; проницаемость|permeability
ёмкость|capacity; вместимость|capacity; объёмность|volume
весомость|weightiness; плотность#2|density|concentration in a volume
равномерность|evenness; неравномерность|unevenness
симметрия|symmetry; асимметрия|asymmetry; пропорциональность|proportionality
""")
block(28, "actions", "verb", """
конкретизировать|define concretely; детализировать|detail
уточнить#3|clarify|make a distinction precise; дифференцировать|differentiate
различаться|differ; различаться#2|differ|be distinguishable
совпадать|coincide; совпасть|coincide; соответствовать#2|correspond|match a specification
отождествлять|identify; отождествить|identify
приравнять|equate; приравнивать|equate; сопоставляться|be compared
соотнести|correlate; соотносить|correlate; соотноситься|correlate
варьировать|vary; варьироваться|vary; колебаться#3|waver
превышать|exceed; превысить|exceed; превосходить|surpass
превзойти|surpass; уступать#2|yield|be inferior in comparison
равняться|match; равняться#2|equal|amount to an exact value
соизмерять|compare; соизмерить|compare; соподчинять|coordinate
различить#2|distinguish|discern a fine distinction
соответствовать#3|correspond|correspond exactly
приближаться|approach; приблизиться|approach
отдаляться|keep away; отдалиться|move away
сближать|brings together|bring together; сблизить|bring together
сужать|narrow; сузить|narrow; расширяться|widen
сокращаться|decrease; увеличиваться|increase; уменьшаться|decrease
усложнять|complicate; усложнить|complicate; упростить|simplify
упрощать|simplify; упрощаться|become simpler
""")
block(29, "literature", "noun", """
литература|literature; произведение|work; творчество|creative work
писатель|writer; поэт|poet; поэтесса|poetess; драматург|playwright
проза|prose; поэзия|poetry; роман|novel; повесть|narrative|a longer fictional narrative
рассказ|story; новелла|short story; сказка|fairy tale; басня|fable
легенда|legend; миф|myth; эпос|epic; былина|bylina
стихотворение|poem; стих|verse; строфа|stanza; рифма|rhyme
ритм|rhythm; размер#2|metre
пьеса|play; драма|drama; комедия|comedy; трагедия|tragedy
сюжет|plot; фабула|plot; композиция|composition
повествование|narration; повествователь|narrator; рассказчик|narrator
персонаж|character; герой|hero; героиня|heroine
образ|image; мотив|motif; символ|symbol
аллегория|allegory; метафора|metaphor; метонимия|metonymy
эпитет|epithet; гипербола|hyperbole; олицетворение|personification
ассоциация#2|association|mental association; аллюзия|allusion
пародия|parody; сатира|satire; гротеск|grotesque
реализм|realism; романтизм|romanticism; модернизм|modernism
символизм|symbolism; импрессионизм|impressionism
натурализм|naturalism; экспрессионизм|expressionism
жанр|genre; направление|orientation|artistic or intellectual orientation; течение|current
трактовка|interpretation; прочтение|reading; толкование|interpretation
контекст|context; ракурс|foreshortening; перспектива#2|perspective
эпизод|episode; сцена|scene; действие#2|act
конфликт#2|conflict|conflict in a narrative
завязка|start|opening development of a plot; кульминация|culmination; развязка|denouement
финал|finale; пролог@7721|prologue; эпилог|epilogue
""")
block(29, "arts", "noun", """
искусство|art; художник|artist; живописец|painter
скульптор|sculptor; архитектор|architect; архитектура|architecture
композитор|composer; музыкант|musician; певец|singer; певица|singer
исполнитель|performer; дирижёр|conductor; оркестр|orchestra
ансамбль|ensemble; хор|choir; мелодия|melody; гармония|harmony
аккорд|chord; нота|note; темп|tempo; тембр|timbre
симфония|symphony; соната|sonata; опера|opera; балет|ballet
режиссёр|director; актёр|actor; актриса|actress
спектакль|performance; постановка|production; экранизация|screen version
сценарий|scenario; кадр|shot; монтаж|montage
портрет|portrait; пейзаж|landscape; натюрморт|still life
полотно|canvas; эскиз|sketch; набросок|sketch
акварель|water-colour; гравюра|engraving; фреска|fresco
мозаика|mosaic; орнамент|ornament; декор|decor
экспозиция|exposition; галерея|gallery; шедевр|masterpiece
""")
block(29, "literature", "verb", """
толковать|interpret; истолковать|interpret; интерпретировать|interpret
трактовать|interpret; прочитывать|to finish reading several books etc|read through; прочесть|read
изобразить|depict; изображать|depict; воплотить|embody
воплощать|embody; воплощаться|be realized; выразить|express
выражать|express; выражаться|express oneself
олицетворять|personify; символизировать|symbolize
ассоциироваться|associate|be associated; ассоциировать|associate
воспринимать|perceive; воспринять|perceive
осмыслить|comprehend; осмысливать|comprehend
осмыслять|comprehend; переосмысливать|rethink
пародировать|parody; высмеивать|ridicule; высмеять|ridicule
воспевать|glorify; воспеть|glorify; прославлять|glorify
прославить|glorify; идеализировать|idealize
создавать|create; создать|create; сочинять|compose; сочинить|compose
импровизировать|improvise; инсценировать|stage
экранизировать|film; инсценировать#2|stage|adapt for the stage
""")
block(29, "description", "adjective", """
художественный|artistic; образный|figurative; выразительный|expressive
символический|symbolic; others:метафорический|metaphorical
аллегорический|allegoric|allegorical; сатирический|satiric
пародийный|parody|parodic; лирический|lyric; эпический|epic
драматический|dramatic; трагический|tragic; комический|comic
реалистический|realistic; романтический|romantic
иррациональный|irrational; мистический|mystic
эстетический|aesthetic; композиционный|Adjective of композиция|compositional
повествовательный|narrative; повествовательный#2|narrative|narratorial
автобиографический|autobiographic; документальный|documentary
исторический#2|historical|based on historical events
психологический#2|psychologic|concerned with inner life
""")
block(30, "work", "noun", """
замысел#2|intention|conception of an extended project
концепция|conception; стратегия|strategy; тактика|tactics
подход|way|approach to a problem; разработка|elaboration; внедрение|introduction
реализация|realization; апробация|approbation; испытание|test
тестирование|testing; мониторинг|monitoring
аудит|audit; оценка#3|grade|project assessment
модернизация|modernization; реконструкция|reconstruction
инновация|innovation; изобретение|invention; открытие|discovery
усовершенствование|improvement; нововведение|innovation
адаптация|adaptation; интеграция|integration
обобщённость|generality; масштабирование|scaling
кооперация|co-operation; специализация|specialization
квалификация|qualification; аттестация|attestation
обучение|training; самообразование|self-education
саморазвитие|self-development; совершенствование|perfection|improvement towards mastery
наставник|mentor; наставничество|tutorship
стажировка|internship; практика|practice
практикант|engaged in practical work|practical trainee; стажёр|trainee; выпускник|graduate
исследователь#2|investigator|independent investigator
разработчик|developer; изобретатель|inventor; новатор|innovator
реформатор|reformer; организатор|organizer; координатор|co-ordinator
""")
block(30, "society", "noun", """
урбанизация|urbanization; инфраструктура|infrastructure
демография|demography; рождаемость|birth rate; смертность|death-rate
долголетие|longevity; старение|aging; урбанизм|urbanism
миграция#2|migration|movement of a population
эмиграция|emigration; иммиграция|immigration; эмигрант|emigrant
иммигрант|immigrant; переселение|resettlement
занятость|employment; трудоустройство|placing in a job
профориентация|vocational guidance; труд|labour
благосостояние|welfare; обеспечение|provision
соцобеспечение|social security; незащищённость|insecurity
инклюзия|inclusion; доступность|accessibility
инвалидность|disability; инвалид|disabled person
реабилитация|rehabilitation; профилактика|preventive measures
санитария|sanitation; гигиена|hygiene; питание|nutrition
водоснабжение|water-supply; энергоснабжение|power supply
утилизация|utilization; энергосбережение|energy saving
возобновление|renewal; устойчивость|stability
приспособление|adaptation; равновесие|equilibrium
биоразнообразие|biodiversity; заповедник@26468|reserve|nature reserve
охрана#2|protection|protection of natural resources
сохранность|safety; восстановление|restoration
""")
block(30, "learning", "noun", """
самооценка|self-appraisal; самоконтроль|self-control
рефлексия|reflection; обратная|reverse; совершенство|perfection
мастерство|skill; умение|skill; навык|skill
компетентность|competence; грамотность|literacy
осведомлённость|possession of information|being informed; эрудиция|erudition
кругозор|horizon; любознательность|curiosity
наблюдательность|observation|ability to notice things; изобретательность|inventiveness
находчивость|resourcefulness; сообразительность|quick wits
внимательность|attentiveness; усидчивость|diligence
работоспособность|capacity for work; организованность|organization
самодисциплина|self-discipline; целеустремлённость|purposefulness
настойчивость#2|persistence|persistence in independent work
мотивация|motivation; мотивировка|motivation
стимул|stimulus; стимуляция|stimulation
поощрение|encouragement; признание|recognition
достижение#2|achievement|achievement demonstrated by a project
применение|application; осуществление|realization
""")
block(30, "actions", "verb", """
разработать|develop; разрабатывать|develop
внедрить|instil; внедрять|put into practice; реализовать|realize
реализовывать|realize; осуществляться|be put into effect
апробировать|approve; испытать|test; испытывать|test
тестировать|test; протестировать|test; моделировать|model
смоделировать|model; проектировать|design; спроектировать|design
сконструировать|construct; конструировать|construct
изобрести|invent; изобретать|invent; усовершенствовать|perfect
усовершенствовать#2|perfect|improve a working design
совершенствовать|perfect; совершенствоваться|perfect oneself
модернизировать|modernize; реконструировать|reconstruct
реорганизовать|reorganize; реорганизовывать|reorganize
адаптировать|adapt; адаптироваться|adapt
приспособить|adapt; приспосабливать|adapt
приспособиться|adapt oneself; приспосабливаться|to adapt
интегрировать|integrate; интегрироваться|integrate
объединить|unite; объединять|unite; объединиться|unite
объединяться|unite; скооперироваться|cooperate
обучать|teach; обучить|teach; обучаться|learn
научить|teach; научиться|learn; обучиться|learn
освоить|master; осваивать|master; освоиться|get used
усвоить|assimilate; усваивать|assimilate; усвоиться|be assimilated
овладеть|master; овладевать|master; постичь|comprehend
постигать|comprehend; поощрить|encourage; поощрять|encourage
стимулировать|stimulate; мотивировать|motivate
инициировать|initiate; возглавить|head; возглавлять|head
подытожить|sum up; подводить|sum up; подвести|sum up
обнародовать|publish; продемонстрировать|demonstrate
демонстрировать|demonstrate; презентовать|present
""")
block(30, "description", "adjective", """
практический|practical; прикладной|applied; фундаментальный|fundamental
междисциплинарный|interdisciplinary; комплексный@2126|combined|comprehensive or combined
интегральный|integral; интеграционный|integrational
инновационный|innovative; новаторский|innovatory
экспериментальный#2|experimental|trial rather than established
пилотный|pilot; пробный|trial; опытный#2|experimental
масштабный|large scale; масштабируемый|scalable
жизнеспособный|viable; долговечный|durable
перспективный#2|promising|promising for future development
продуктивный|productive; творческий|creative
креативный|creative; изобретательный|inventive
находчивый|resourceful; сообразительный|quick-witted
целеустремлённый|purposeful; любознательный|inquisitive
усидчивый|assiduous; трудолюбивый|hard-working
работоспособный|capable of working; образованный|educated
грамотный|literate; эрудированный|erudite
всесторонний|comprehensive; многообразный|diverse
""")
block(25, "reasoning", "verb", """
задуматься|ponder; задумываться|ponder; обдумать|think over; обдумывать|think over
продумать|think over; продумывать|think over; раздумывать|ponder
размыслить|reflect; размышлять|reflect; помыслить|think
представиться|introduce oneself; предстать|appear; представать|appear
усомниться|doubt; увериться|become convinced; уверять|assure
уверить|assure; удостовериться|make sure; убеждаться|make sure
убедиться|make sure; склоняться|incline; склониться|incline
склонять|incline; склонить|incline
судить#2|judge|form an opinion; пересудить|discuss
предугадать|guess; предугадывать|guess; предвидеть|foresee
предсказать|predict; предсказывать|predict
прогнозировать|forecast; предвещать|portend
воспрепятствовать#2|prevent|forestall a foreseeable problem
распознать|recognize; распознавать|recognize
опознать|identify; опознавать|identify; осведомить|inform; осведомлять|inform
разобраться|figure it out|figure something out; разбираться|understand
уяснить|understand; уяснять|understand; прояснить|clarify
прояснять|clarify; проясниться@14623|clear|become clear; проясняться|clearing up|become clear
запутаться|to be confused; путаться|get confused
путать|confuse; спутать|confuse; перепутать|confuse; перепутывать|mix up
запутать|confuse; запутывать|confuse
разгадать|solve; разгадывать|solve; раскрыть|reveal; раскрывать|reveal
разоблачить|expose; разоблачать|expose; изобличить|expose; изобличать|expose
выдать|reveal; выдавать|reveal; выдать#2|betray
""")
block(26, "communication", "noun", """
реплика|remark; отклик|response; отзыв@4120|review; ответственность#2|responsibility|answerability
откровение|revelation; признание#2|confession
призыв|appeal; воззвание|appeal; обращение#3|appeal|public address
осведомление|information; разъяснение|explanation
освещение|elucidation; огласка|publicity
огласовка|vocalization; оглашение|proclaiming; обнародование|publication
исповедальность|confessional character; душевность|soulfulness
назидание|edification; нравоучение|moral admonition; поучение|precept
увещевание|admonition; назидательность|didacticism
убеждённость#3|conviction|confidently held belief
""")
block(26, "communication", "verb", """
откликнуться|respond; откликаться|respond; отозваться|answer; отзываться|answer
отзываться#2|speak|express an opinion about someone
отозвать|recall; отзывать|recall; воззвать|appeal; взывать|appeal
призвать|call; призывать|call; возвестить|announce
возвещать|announce; огласить|announce; оглашать|announce
провозгласить|proclaim; провозглашать|proclaim
декларировать|proclaim; провозгласить#2|proclaim|formally proclaim a position
разъяснить|explain; разъяснять|explain; растолковать|explain
растолковывать|explain; втолковать|explain; втолковывать|explain
поучать|teach; наставить|instruct; наставлять|mentor
увещевать|exhort; увещать|exhort
поведать|tell; повествовать|narrate; уведомляться|be informed
осведомляться#2|inquire|make a formal inquiry
""")
block(27, "actions", "verb", """
сжать|squeeze; сжимать|squeeze; сжаться|shrink; сжиматься|shrink
сдавить|squeeze; сдавливать|squeeze; раздавить|crush; раздавливать|crush
разжать|unclench; разжимать|unclench; разжаться|unclench
давить|press; придавить|press; прижимать|press; прижать|press
надавить|press; надавливать|press; подавить|press; подавлять|suppress
выдавить|squeeze out; выдавливать|squeeze out; стиснуть|squeeze; стискивать|squeeze
схватить|grab; схватывать|grasp; хватать|grab; хватить|be enough
ухватить|grasp; ухватиться|grasp; ухватываться|grasp
сцепить|couple; сцеплять|couple; сцепиться|clash; сцепляться|grapple
разорвать|tear; разрывать|tear; разорваться|burst; разрываться|be divided
расколоть|split; раскалывать|split; расколоться|split; раскалываться|split
сломить|break; ломить|break through; сломить#2|break|break someone's resistance
сокрушить|shatter; сокрушать|shatter; сокрушаться|grieve
потрескаться|crack; треснуть|crack; трескаться|crack
лопнуть|burst; лопаться|burst; надорвать|tear
надрываться|overstrain oneself; надорваться|overstrain
выдержать|endure; выдерживать|endure; сдержать|restrain
сдерживать|restrain; сдержаться|restrain oneself; сдерживаться|hold oneself in check
перетерпеть|endure; перетерпеть#2|endure|endure until a difficulty passes
выносить#2|endure; вынести#2|endure
""")
block(27, "feelings", "adjective", """
несгибаемый|unbending; непреклонный|inflexible; непримиримый|irreconcilable
непоколебимый|unshakeable; несокрушимый|indestructible
стойкий|staunch; стойкий#2|firm; крепкий|strong; крепкий#2|firm
твёрдый#2|firm; нерушимый|inviolable; непробиваемый|impenetrable
неуязвимый|invulnerable; ранимый|vulnerable
чувствительный|sensitive; впечатлительный|impressionable
мнительный|hypochondriac; обидчивый|touchy
вспыльчивый|quick-tempered; раздражительный|irritable
нетерпеливый|impatient; горячечный|feverish
хладнокровный|cool; безмятежный|serene
невозмутимый|imperturbable; невозмутимый#2|imperturbable|not visibly perturbed
удручённый|depressed; подавленный|depressed
сокрушительный|shattering; сокрушённый|contrite
измождённый|exhausted; измученный|exhausted
надрывный|heart-rending; отчаянный|desperate; отчаянный#2|desperate|recklessly daring
""")
block(28, "description", "adjective", """
прозрачный|transparent; непрозрачный|opaque
матовый|lustreless; глянцевый|glossy; тусклый|dim
мерцающий|flickering; однотонный|monochrome
пёстрый|motley; красочный|colourful
насыщенный|saturated; бесцветный|colourless
шероховатый|rough; шершавый|rough; неровный|uneven
бугристый|uneven; ребристый|ribbed; зернистый|granular
пористый|porous; рыхлый|loose; плотный|dense
вязкий|viscous; жидкий|liquid; густой|thick
тягучий|viscous; липкий|sticky; клейкий|sticky
скользкий|slippery; скользкий#2|slippery|difficult to pin down
сыпучий|loose; ломкий|brittle; хрупкий|fragile
упругий|elastic; эластичный|elastic; растяжимый|extensible
растяжимый#2|extensible|capable of stretching
сжимаемый|compressible; сыпучий#2|loose|free-flowing granular material
выпуклый|convex; вогнутый|concave; округлый|rounded
овальный|oval; продолговатый|oblong
треугольный|triangular; прямоугольный|rectangular
цилиндрический|cylindrical; конический|conic|conical; сферический|spherical
спиральный|spiral; зигзагообразный|zigzag
вертикальный|vertical; горизонтальный|horizontal
наклонный|inclined; наклонённый|inclined
продольный|longitudinal; поперечный|transversal|transverse
""")
block(28, "description", "noun", """
очертание|outline; контур|contour; силуэт|silhouette
очертание#2|outline|outline of an object; конфигурация#2|configuration|spatial configuration
грань|edge; ребро|edge; плоскость|plane
кривизна|curvature; изгиб|bend; впадина|hollow; выпуклость|convexity
выемка|groove; выступ|projection; углубление|depression
вмятина|dent; бугор|mound; борозда|furrow
морщина|wrinkle; складка|fold; сгиб|bend
разрез|cut; срез|cut; надрез|incision
сечение|section; сечение#2|section|cross-section of an object
отрезок|segment; промежуток|interval; протяжённость|extent
толщина|thickness; высота#2|height|height as a measured dimension
параллель|parallel; перпендикуляр|perpendicular
диагональ|diagonal; окружность|circumference
радиус|radius; диаметр|diameter; ось|axis
координата|co-ordinate; симметричность|symmetry
""")
block(29, "arts", "noun", """
декорация|scenery; декоратор|decorator; костюм|costume
реквизит|props; бутафория|stage-properties
сцена#2|stage; кулиса|wing; кулисы|wings; занавес|curtain
рампа|footlights; партер|stalls; ложа|box; бельэтаж|dress circle
репетиция|rehearsal; репертуар|repertoire
премьера|premiere; гастроли|tour; антракт|interval
аплодисменты|applause; овация|ovation; публика|public
труппа|company; солист|soloist; дуэт|duet; трио|trio
квартет|quartet; квинтет|quintet; партия#2|part
ария|aria; романс|romance; увертюра|overture
прелюдия|prelude; фуга|fugue; этюд|study; вариация#2|variation|musical variation
импровизация|improvisation; аранжировка|arrangement
аккомпанемент|accompaniment; партитура|score
фортепиано|piano; рояль|grand piano; пианино|piano|upright piano
скрипка|violin; виолончель|cello; контрабас|double-bass
гитара|guitar; флейта|flute; кларнет|clarinet
саксофон|saxophone; труба#2|trumpet; барабан|drum
тарелка#2|cymbals|cymbal; гармоника|concertina; аккордеон|accordion
""")
block(30, "science", "noun", """
геофизика|geophysics; геохимия|geochemistry
метеорология|meteorology; климатология|climatology
палеонтология|paleontology; антропология|anthropology
этнография|ethnography; культурология|culturology
минерал|mineral; руда|ore; месторождение|deposit
добыча|extraction; разработка#2|exploitation
шахта|mine; карьер|quarry; рудник|mine
нефть|oil; уголь|coal; торф|peat; сланец|slate
топливо|fuel; горючее|fuel; ископаемое|fossil
ископаемый|fossil; ископаемый#2|fossil|fossilized material
природопользование|nature management; ресурсоёмкость|resource consumption
водоём|reservoir; водохранилище|reservoir
водосток|drain; водоотвод|drainage; сток|flow
плотина|dam; дамба|dam; канал#2|canal
орошение|irrigation; мелиорация|land-improvement|land improvement
ледник@5180|glacier; айсберг|iceberg; вечная|perpetual
мерзлота|frozen condition of ground; эрозия|erosion
выветривание|weathering; осадок|sediment; отложение|deposit
ил|silt; песок|sand; глина|clay; гравий|gravel
галька|pebbles; щебень|road-metal|crushed stone; камень|stone; скала@745|rock
известняк|limestone; гранит|granite; мрамор|marble
базальт|basalt; кварц|quartz; кремний|silicon
железо|iron; медь|copper; алюминий|aluminium
цинк|zinc; олово|tin; свинец|lead
серебро|silver; золото|gold; платина|platinum
""")

block("professional", "work", "noun", """
вакансия|vacancy; собеседование|interview; резюме#2|resume
найм|hiring; наём|hire; работодатель|employer; соискатель|applicant
персонал|personnel; кадры|personnel; штат|staff
текучесть#2|turnover; увольнение|dismissal; сокращение|reduction
уведомление#3|notification|notice to an employee
командировка|business trip; доверенность|power of attorney
представительский|representative
агент|agent; агентство|agency; филиал|branch; представительство|representation
делопроизводство|record-keeping; документооборот|document circulation
реквизиты|details; накладная|delivery slip
счёт#2|account; фактура|invoice; неустойка|forfeit
пеня|fine; задолженность#2|arrears; аванс|advance
задаток|deposit; залог|pledge; поручительство|guarantee
дебитор|debtor; кредитор|creditor; бухгалтер|accountant
бухгалтерия|accounts department; смета|estimate
калькуляция|calculation; себестоимость|cost price
логистика|logistics; маркетинг|marketing; менеджмент|management
мерчандайзинг|merchandising; франшиза|deductable|insurance deductible
""")
block("professional", "work", "verb", """
нанять|hire; нанимать|hire; уволить|fire; увольнять|dismiss
трудоустроить|employ; трудоустраивать|employ
командировать|send on an official journey trip|send on an official business trip
делегировать|delegate; аккредитовать|accredit
уполномочивать|authorize; заверить|certify; заверять|certify
засвидетельствовать|testify; удостоверить|certify; удостоверять|certify
завизировать|endorse; визировать|endorse
согласовывать#2|co-ordinate|agree document wording
калькулировать|calculate; тарифицировать|tariff|assign a tariff
возместить#2|compensate|reimburse a business expense
""")
block("professional", "work", "adjective", """
штатный|regular; внештатный|not on permanent staff
кадровый|regular|regular staff; трудовой|labour; полномочный|plenipotentiary
наёмный|hired; командировочный|travelling
бухгалтерский|book-keeping; договорной|contractual
конфиденциальный|confidential; служебный|official
представительский|representative; должностной|official
""")
block("technical", "technology", "noun", """
приложение|application|software application; программирование|programming
программист|programmer; алгоритм|algorithm; код|code
кодирование|coding; декодирование|decoding; шифрование|encryption
шифр|cipher; ключ#3|key|cryptographic key
сервер|server; протокол|protocol; интерфейс|interface
процессор|processor; микропроцессор|microprocessor
микросхема|microcircuit; транзистор|transistor; диод|diode
резистор|resistor; конденсатор|capacitor; трансформатор|transformer
выпрямитель|rectifier; генератор|generator; стабилизатор|stabilizer
коммутатор|commutator; маршрутизатор|router
модем|modem; терминал|terminal; порт|port
пакет#2|packet; буфер|buffer; регистр#2|register|processor register
компилятор|compiler; интерпретатор|interpreter
репозиторий|repository
переменная|variable; константа|constant; функция|function
массив|array; указатель#2|pointer; строка|line|line of text
поток|stream; процесс#2|process|operating-system process
синхронизация|synchronization; конфигурация|configuration
параметр#2|parameter|parameter of a program; отладка|debugging
неисправность#2|faultiness|technical fault; сбой|failure
событие#2|event|event in a computing system
""")
block("technical", "technology", "verb", """
программировать|program; запрограммировать|program
кодировать|encode; закодировать|encode; декодировать|decode
шифровать|encipher; зашифровать|put into code; расшифровать|decipher
расшифровывать|decipher; компилировать|compile
отлаживать|debug; отладить|debug
синхронизировать|synchronize; конфигурировать|configure
инициализировать|initialize; перезагрузить|reload
перезапустить|restart; перезапускать|restart
""")
block("technical", "technology", "adjective", """
двоичный|binary; шестнадцатеричный|hexadecimal
аналоговый|analog; дискретный|discrete
асинхронный|asynchronous; синхронный|synchronous
параллельный|parallel; последовательный#2|consecutive
программный|program; аппаратный|hardware
информационный|Adjective of информация|information-related; вычислительный|computing
логарифмический|logarithmic; алгоритмический|algorithmic
""")
block("scientific", "science", "noun", """
воспроизводимость|reproducibility; повторяемость|recurrence
репликация|replication; репрезентативность|representativeness
дисперсия|dispersion; вариация|variation
корреляция|correlation; регрессия|regression
распределение#2|distribution|statistical distribution
медиана|median; дисперсия#2|dispersion|statistical variance
ковариация|covariance; статистик|statistician
калибровка|calibration; градуировка|graduation
спектр|spectrum; спектроскопия|spectroscopy
микроскоп|microscope; телескоп|telescope
центрифуга|centrifuge; пробирка|test-tube; колба|retort|laboratory flask
пипетка|pipette; реагент|reagent; реактив|reagent
катализатор|catalyst; катализ|catalysis
фермент|enzyme; белок|protein; аминокислота|amino acid
нуклеотид|nucleotide; хромосома|chromosome
геном|genome; мутация|mutation; метаболизм|metabolism
биомасса|biomass; экосистема|ecosystem
геосфера|geosphere; биосфера|biosphere
термодинамика|thermodynamics; энтропия|entropy
равновесие#2|equilibrium|thermodynamic equilibrium
""")
block("scientific", "science", "verb", """
верифицировать|verify; воспроизвести|reproduce
воспроизводить|reproduce; реплицировать|replicate
калибровать|calibrate; градуировать|graduate
экстраполировать|extrapolate; интерполировать|interpolate
аппроксимировать|approximate; коррелировать|correlate
центрифугировать|centrifuge; титровать|titrate
кристаллизовать|crystallize; кристаллизоваться|crystallize
дистиллировать|distil; фильтровать|filter
""")
block("scientific", "science", "adjective", """
репрезентативный|representative; воспроизводимый|reproducible
достоверный#2|valid|valid under stated experimental conditions
контрольный|test|for testing or checking; измерительный|measuring
лабораторный|laboratory; молекулярный|molecular
атомный|atomic; ядерный|nuclear; клеточный|cellular
хромосомный|chromosomal; метаболический|metabolic
термодинамический|thermodynamic; статистический#2|statistic|statistical in method
""")
block("literary", "literature", "noun", """
нарратология|narratology; герменевтика|hermeneutics
поэтика|poetics; стилистика|stylistics
риторика|rhetoric; семиотика|semiotics
семантика|semantics; прагматика|pragmatics
интертекст|intertext; интертекстуальность|intertextuality
реминисценция|reminiscence; подтекст#2|implication|literary subtext
лейтмотив|leit-motif; архетип|archetype
оксюморон|oxymoron; антитеза|antithesis
анафора|anaphora; эпифора|epiphora
инверсия|inversion; эллипсис|ellipsis
градация#2|gradation|rhetorical gradation; парцелляция|parcellation
синекдоха|synecdoche; литота|litotes
стилизация|stylization; аллитерация|alliteration
ассонанс|assonance; цезура|caesura
ямб|iambus; хорей|trochee; дактиль|dactyl
амфибрахий|amphibrach; анапест|anapaest
верлибр|free verse; сонет|sonnet; элегия|elegy
ода|ode; эпиграмма|epigram; баллада|ballad
притча|parable; апокриф|apocrypha
житие|life; патетика|pathetic element|emotionally elevated expression; пафос|pathos
""")
block("literary", "literature", "verb", """
стилизовать|stylize; пародировать#2|parody|imitate for satirical effect
аллегоризировать|allegorize; декламировать|declaim
декламировать#2|recite; рифмовать|rhyme
версифицировать|versify; персонифицировать|personify
мифологизировать|mythologize; интерпретировать#2|interpret|interpret a literary device
""")
block("literary", "literature", "adjective", """
стилистический|stylistic; риторический#2|rhetorical|rhetorical in construction
семиотический|semiotic; семантический|semantic
интертекстуальный|intertextual; архетипический|archetypal
метонимический|metonymical; метафоричный|metaphorical
синтаксический|syntactic; метрический|metric
силлабический|syllabic; тонический|tonic
эпистолярный|epistolary; агиографический|hagiographic
""")


def load_sources(directory: Path):
    if CHECKSUMS != {table: values[1] for table, values in SOURCE_TABLES.items()}:
        raise ValueError("Authoring pins disagree with the Russian source module")
    rows = {}
    index = defaultdict(list)
    for table, table_rows in load_tables(directory).items():
        for ordinal, row in enumerate(table_rows, 1):
            rows[table, ordinal] = row
            index[table, row["bare"]].append((ordinal, row))
    return rows, index


def reading_supported(row) -> bool:
    if not re.fullmatch(r"[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*", row["bare"]):
        return False
    try:
        source_reading(row["accented"], target=row["bare"])
    except ValueError:
        return False
    return True


def find_span(raw: str, requested: str):
    return re.search(r"(?<![A-Za-z0-9'-])" + re.escape(requested) + r"(?![A-Za-z0-9'-])",
                     raw, re.IGNORECASE)


def selections(index):
    output = []
    errors = []
    seen = set()
    seen_spans = set()
    lexical_rows = {}
    for level, topic, pos, text in BLOCKS:
        assert topic in TOPICS, topic
        assert level in range(1, 31) or level in {
            "professional", "technical", "scientific", "literary"
        }
        for entry in re.split(r"\n|;", text):
            entry = entry.strip()
            if not entry:
                continue
            fields = [part.strip() for part in entry.split("|")]
            key, *sense = fields
            if key in EXCLUDED_REVISITS or key in DEFERRED:
                continue
            record = None
            if "@" in key:
                key, record_text = key.split("@")
                record = int(record_text)
            slot = 1
            if "#" in key:
                key, slot_text = key.split("#")
                slot = int(slot_text)
            if not 1 <= slot <= 999:
                errors.append(f"{level}/{topic}: {entry} -- invalid local sense slot")
                continue
            table = TABLES.get(pos, "others")
            if ":" in key:
                table, key = key.split(":")
            if not sense and key in SHORT_GLOSSES:
                sense = SHORT_GLOSSES[key]
            candidates = index.get((table, key), [])
            if record is not None:
                candidates = [pair for pair in candidates if pair[0] == record]
            if sense:
                candidates = [
                    pair for pair in candidates
                    if find_span(pair[1]["translations_en"], sense[0])
                ]
            candidates = [pair for pair in candidates if reading_supported(pair[1])]
            if len(candidates) != 1:
                errors.append(f"{level}/{topic}: {entry} -- {len(candidates)} supported rows")
                for candidate_table in CHECKSUMS:
                    for candidate_record, candidate in index.get((candidate_table, key), []):
                        errors.append(
                            f"  {candidate_table}:{candidate_record} {candidate['accented']} "
                            f"[{'reading OK' if reading_supported(candidate) else 'reading GAP'}] "
                            f"{candidate['translations_en']}"
                        )
                continue
            ordinal, row = candidates[0]
            if table == "others" and ordinal in PRONOUN_FORM_RECORDS:
                parent_table, parent_record = PRONOUN_FORM_RECORDS[ordinal]
                errors.append(
                    f"{level}/{topic}: {entry} -- inflected pronoun form; "
                    f"use canonical {parent_table}:{parent_record} without extra lexical credit"
                )
                continue
            raw = row["translations_en"]
            if sense:
                gloss = find_span(raw, sense[0]).group()
            else:
                gloss = raw
            hint = sense[1] if len(sense) > 1 else gloss
            if not gloss or not re.search("[A-Za-z]", gloss) or len(hint) > 64:
                errors.append(f"{level}/{topic}: {entry} -- choose span: {raw}")
                continue
            mixed = f"{gloss} {hint}".casefold()
            if (
                (table == "nouns" and key == "атлас" and "satin" in mixed)
                or (table == "verbs" and key == "знать" and re.search(
                    r"\b(aristocracy|nobility|elite|evidently)\b|it seems", mixed
                ))
                or (table == "adjectives" and key == "лёгкий"
                    and (pos != "adjective" or "lung" in mixed))
                or (table == "others" and key == "всё" and pos == "pronoun")
                or (table == "others" and key == "есть")
            ):
                errors.append(f"{level}/{topic}: {entry} -- unsupported sense/POS or form credit")
                continue
            stem = f"ru-or-{PREFIXES[table]}{ordinal:05d}"
            identity = f"ru-lex-or-{PREFIXES[table]}{ordinal:05d}"
            if table == "others" and key == "она":
                identity = "ru-lex-or-o00004"
            if table == "nouns" and key == "мир":
                identity += "-world" if slot == 1 else "-peace"
            if table == "nouns" and key == "среда":
                identity += "-weekday" if slot == 1 else "-environment"
            if table == "nouns" and key == "пол":
                identity += "-floor" if slot == 1 else "-sex"
            entry_id = f"{stem}-s{slot:03d}"
            if entry_id in seen:
                errors.append(f"{level}/{topic}: {entry} -- repeated ID {entry_id}")
                continue
            if (stem, gloss.casefold()) in seen_spans:
                errors.append(f"{level}/{topic}: {entry} -- duplicate selected meaning")
                continue
            previous = lexical_rows.get((table, key))
            if previous and previous != ordinal and key not in {"замок", "мука", "лук"}:
                errors.append(f"{level}/{topic}: {entry} -- needs duplicate/homograph review")
                continue
            lexical_rows[table, key] = ordinal
            seen.add(entry_id)
            seen_spans.add((stem, gloss.casefold()))
            item = {
                "id": entry_id,
                "source_table": table,
                "source_record": ordinal,
                "source_gloss": gloss,
                "ds": hint,
                "level": level,
                "topic": topic,
                "lexical_identity": identity,
                "part_of_speech": pos,
            }
            if len(sense) > 1:
                item["sense_note"] = (
                    "Authored English hint qualifies the selected source span; "
                    "it is not a separately source-verified definition."
                )
            if entry_id in LABEL_ADAPTATIONS:
                item["sense_note"] = LABEL_ADAPTATIONS[entry_id]
            if entry_id == "ru-or-a11866-s001":
                item["sense_note"] = (
                    "Selected as a quantifying determiner. Source decl_n_nom/decl_n_acc "
                    "supply the neuter form всё, and decl_pl_nom supplies plural все. "
                    "These are inflected realizations, not additional lexical headwords."
                )
            output.append(item)
    branch_order = {"professional": 31, "technical": 32, "scientific": 33, "literary": 34}
    output.sort(key=lambda item: item["level"] if isinstance(item["level"], int)
                else branch_order[item["level"]])
    return output, errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--lookup", nargs="+", help="Inspect exact source rows for named lemmas")
    parser.add_argument("--audit", action="store_true", help="Report selection problems without writing")
    args = parser.parse_args()
    rows, index = load_sources(args.sources)
    if args.lookup:
        for lemma in args.lookup:
            for table in CHECKSUMS:
                for record, row in index.get((table, lemma), []):
                    print(table, record, row["bare"], row["accented"],
                          "READING_OK" if reading_supported(row) else "READING_GAP",
                          "::", row["translations_en"])
        return 0
    output, errors = selections(index)
    tables = {
        table: [row for (row_table, _), row in rows.items() if row_table == table]
        for table in CHECKSUMS
    }
    for selection in output:
        try:
            row = validate_selection(selection, tables, TOPICS)
            expanded_selection(selection, row)
        except ValueError as exc:
            errors.append(f"{selection['id']}: {exc}")
    for error in errors:
        print(error)
    counts = Counter(item["level"] for item in output)
    print("Selected senses:", len(output), "Lexical identities:",
          len({item["lexical_identity"] for item in output}))
    print("By level/branch:", dict(counts))
    if errors or args.audit:
        print("Selection errors:", len(errors))
        return bool(errors)
    target = Path(__file__).resolve().parents[1] / "curriculum" / "russian" / "authoring" / "vocabulary.yaml"
    serialized = dump_entries(output)
    if args.check:
        if not target.exists() or target.read_text(encoding="utf-8") != serialized:
            print("Stale Russian vocabulary authoring YAML")
            return 1
        assert load_yaml(target) == output
        return 0
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(serialized, encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
