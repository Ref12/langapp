"""Rebuild Korean vocabulary from the pinned NIKL dictionary mirror (stdlib only)."""

from __future__ import annotations

import argparse
import ast
import collections
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request


ROOT = Path(__file__).resolve().parents[1] / "curriculum" / "korean"
REVISION = "3b4cfd2126debfd5440cade3ef6c2a3c20cf7cf9"
URL = (
    "https://huggingface.co/datasets/binjang/NIKL-korean-english-dictionary/"
    f"resolve/{REVISION}/2024_01.csv"
)
SHA256 = "3250b7b0620eee814aadb4ad5611f1e209792e2aebfd57017bcfe3f1d7b92aa0"
FIELDS = [
    "id", "target", "reading", "english", "part_of_speech", "topic",
    "source_id", "source_entry", "level_basis",
]
BANDS = {"초급": "beginner", "중급": "intermediate", "고급": "advanced"}
POS = {
    "명사": "noun", "동사": "verb", "형용사": "descriptive verb",
    "부사": "adverb", "관형사": "determiner", "접사": "affix",
    "의존 명사": "bound noun", "수사": "numeral", "대명사": "pronoun",
    "감탄사": "interjection", "조사": "particle", "": "unspecified",
}
DOMAINS = {
    "개념": "concepts", "인간": "people", "사회 생활": "social life",
    "경제 생활": "economy", "삶": "daily life", "교육": "education",
    "식생활": "food", "자연": "nature", "주생활": "housing",
    "정치와 행정": "politics and administration", "동식물": "plants and animals",
    "의생활": "clothing and appearance", "문화": "culture", "종교": "religion",
}
TOPICS = {
    "시간": "time", "감정": "emotions", "태도": "attitudes",
    "사회 활동": "social activities", "신체 행위": "physical actions",
    "언어 행위": "speech acts", "모양": "shape", "인지 행위": "cognition",
    "정도": "degree", "수": "numbers", "사람의 종류": "types of people",
    "경제 수단": "financial instruments", "위치 및 방향": "location and direction",
    "신체 부위": "body parts", "능력": "abilities", "병과 증상": "illness and symptoms",
    "지역": "regions", "경제 행위": "economic activities", "친족 관계": "family relationships",
    "경제 상태": "economic conditions", "성격": "personality", "여가 활동": "leisure activities",
    "교수 학습 행위": "teaching and learning", "세는 말": "counters", "음식": "dishes",
    "기상 및 기후": "weather and climate", "생활 용품": "household goods", "순서": "sequence",
    "양": "quantity", "색깔": "colors", "지형": "landforms",
    "식사 및 조리 행위": "eating and cooking", "성질": "properties", "직업": "occupations",
    "사법 및 치안 행위": "judicial and policing activities", "식재료": "ingredients",
    "삶의 상태": "life circumstances", "사회 생활 상태": "social conditions",
    "주택 구성": "parts of a home", "감각": "senses", "소통 수단": "communication tools",
    "인간관계": "interpersonal relationships", "직장 생활": "workplace life", "동물류": "animals",
    "교통 수단": "transport", "경제 행위 장소": "commercial places",
    "정치 및 행정 주체": "political and administrative actors",
    "정치 및 행정 행위": "political and administrative activities", "치료 행위": "medical treatment",
    "옷 종류": "types of clothing", "말": "language", "교통 이용 장소": "transport facilities",
    "생리 현상": "physiological processes", "모자, 신발, 장신구": "hats shoes and accessories",
    "용모": "appearance", "지시": "demonstratives", "교통 이용 행위": "travel actions",
    "일상 행위": "daily routines", "학문 용어": "academic terminology",
    "삶의 행위": "life events", "음료": "drinks", "전공과 교과목": "subjects and majors",
    "문화 활동 주체": "cultural participants", "가족 행사": "family events", "직위": "job positions",
    "사법 및 치안 주체": "judicial and policing actors", "학습 관련 사물": "learning materials",
    "경제 행위 주체": "economic actors", "통신 행위": "telecommunications", "맛": "tastes",
    "교수 학습 주체": "teachers and learners", "인칭": "personal reference", "밝기": "brightness",
    "가사 행위": "housework", "체력 상태": "physical condition", "전통 문화": "traditional culture",
    "여가 시설": "leisure facilities", "학문 행위": "academic activities", "조리 도구": "cooking tools",
    "신체 내부 구성": "internal anatomy", "빈도": "frequency",
    "정치 및 치안 상태": "political and public safety conditions", "매체": "media",
    "속도": "speed", "여가 도구": "leisure equipment", "사회 행사": "social events",
    "대중 문화": "popular culture", "의문": "questions", "자원": "resources",
    "문화 활동": "cultural activities", "재해": "disasters", "공공 기관": "public institutions",
    "과일": "fruit", "채소": "vegetables", "의복 착용 행위": "dressing", "미용 행위": "grooming",
    "접속": "connectives", "문화 생활 장소": "cultural venues",
    "동식물 행위": "plant and animal activities", "학교 시설": "school facilities",
    "식물류": "plants", "식생활 관련 장소": "food venues", "주거 상태": "housing conditions",
    "식물의 부분": "plant parts", "치료 시설": "health facilities", "천체": "celestial objects",
    "약품류": "medicines", "신체에 가하는 행위": "actions affecting the body",
    "신체 변화": "physical changes", "직장": "workplaces", "곡류": "grains", "음악": "music",
    "교육 기관": "educational institutions", "건물 종류": "building types", "문학": "literature",
    "경제 산물": "economic products", "주거 행위": "housing activities", "예술": "arts",
    "온도": "temperature", "종교인": "religious figures", "옷의 부분": "clothing parts",
    "소리": "sounds", "의복 착용 상태": "state of dress", "지표면 사물": "surface features",
    "곤충류": "insects", "주거 지역": "residential areas", "종교 유형": "religions",
    "주거 형태": "housing types", "무기": "weapons", "종교 행위": "religious practices",
    "동물의 부분": "animal parts", "미술": "visual arts", "종교 활동 도구": "religious objects",
    "신앙 대상": "objects of belief", "종교어": "religious language",
    "종교 활동 장소": "religious venues", "옷감": "fabric",
    "의생활 관련 장소": "clothing related places", "동물 소리": "animal sounds",
}

# Core spellings override a category's later placement only within the beginner band.
CORE = set("""
가다 오다 있다 없다 하다 먹다 마시다 자다 일어나다 앉다 서다 보다 듣다 읽다
쓰다 말하다 알다 모르다 배우다 공부하다 좋아하다 싫어하다 좋다 나쁘다 크다 작다
많다 적다 높다 낮다 길다 짧다 빠르다 느리다 비싸다 싸다 덥다 춥다 따뜻하다
차갑다 뜨겁다 맛있다 맛없다 재미있다 재미없다 쉽다 어렵다 예쁘다 아프다 바쁘다
깨끗하다 피곤하다 행복하다 괜찮다 고맙다 미안하다 죄송하다 반갑다 안녕 안녕하세요
이름 사람 친구 가족 엄마 아빠 부모 아버지 어머니 형 누나 오빠 언니 동생 아이
학교 학생 선생님 교실 책 책상 의자 공책 연필 펜 가방 사전 숙제 시험 수업
한국 한국어 영어 중국 일본 나라 집 방 문 창문 화장실 부엌 침대 전화 휴대폰
컴퓨터 텔레비전 사진 영화 음악 노래 운동 축구 수영 여행 취미 주말 날씨 비 눈
봄 여름 가을 겨울 오늘 내일 어제 지금 아침 점심 저녁 밤 오전 오후 시간
분 초 년 달 월 일 주 요일 월요일 화요일 수요일 목요일 금요일 토요일 일요일
한 두 세 네 다섯 여섯 일곱 여덟 아홉 열 하나 둘 셋 넷 스물 백 천 만
영 공 이 삼 사 오 육 칠 팔 구 십 나 저 우리 저희 너 여러분 이 그 저것
이것 그것 여기 거기 저기 어디 누구 무엇 뭐 언제 왜 어떻게 어느 어떤 몇
네 예 아니요 안 못 잘 더 다시 또 같이 함께 정말 아주 너무 조금 많이
그리고 그래서 하지만 그렇다 이렇다 크기 색 색깔 빨간색 파란색 검은색 흰색
빨갛다 파랗다 하얗다 검다 돈 원 값 가격 가게 시장 식당 카페 은행 병원 약국
우체국 공항 역 정류장 버스 지하철 택시 기차 자동차 자전거 길 왼쪽 오른쪽 앞
뒤 옆 안 밖 위 아래 사이 쪽 근처 밥 물 빵 우유 커피 차 주스 과일 사과
바나나 고기 생선 채소 김치 국 라면 냉면 김밥 떡 음식 메뉴 컵 잔 병 개 명
옷 바지 치마 셔츠 모자 신발 양말 입다 벗다 신다 사다 팔다 주다 받다
만나다 살다 기다리다 만들다 열다 닫다 타다 내리다 걷다 뛰다 찾다 쉬다 놀다
보내다 전화하다 이야기하다 도와주다 시작하다 끝나다 필요하다 일하다 요리하다
씻다 청소하다 준비하다 주문하다 예약하다 설명하다 질문하다 대답하다 이해하다
사용하다 가져오다 가져가다 나오다 들어가다 들어오다 나가다 돌아오다 도착하다
출발하다 출근하다 퇴근하다 결혼하다 이름 나이 생일 주소 번호 직업 회사 회사원
의사 간호사 경찰 요리사 가수 배우 손 발 머리 얼굴 눈 코 입 귀 몸 배
감기 약 건강 문제 사진 여행 지도 표 짐 방학 휴가 약속 선물 편지 이메일
오래 일찍 늦게 자주 가끔 항상 보통 먼저 모두 다 가장 제일 매일 매주 매년
아직 벌써 바로 천천히 빨리 왜냐하면 또는 아니 그렇지만 그러면 그러니까
""".split())
BEGINNER_EARLY = {
    "time", "numbers", "counters", "location and direction", "family relationships",
    "body parts", "colors", "dishes", "ingredients", "drinks", "fruit", "vegetables",
    "daily routines", "household goods", "parts of a home", "transport",
    "transport facilities", "travel actions", "personal reference", "demonstratives",
    "questions", "weather and climate", "types of clothing", "hats shoes and accessories",
    "dressing", "learning materials", "teachers and learners", "school facilities",
    "food venues", "occupations", "eating and cooking", "housework",
}
INTERMEDIATE_LATE = {
    "economy", "politics and administration", "religion",
}
INTERMEDIATE_LATE_TOPICS = {
    "academic terminology", "academic activities", "subjects and majors", "media",
    "social conditions", "cognition", "attitudes", "abilities", "properties",
    "speech acts", "traditional culture", "literature", "arts", "visual arts",
    "cultural activities", "telecommunications", "communication tools", "degree",
    "quantity", "sequence", "frequency", "language",
}
ADVANCED_LATE_DOMAINS = {"politics and administration", "religion", "nature"}
ADVANCED_LATE_TOPICS = {
    "academic terminology", "academic activities", "subjects and majors", "cognition",
    "properties", "degree", "quantity", "sequence", "frequency", "literature",
    "arts", "visual arts", "traditional culture", "internal anatomy",
    "political and public safety conditions", "language", "speech acts",
}

# Replace metalinguistic glosses that otherwise contain untranslated Korean or Hanja.
ENGLISH_OVERRIDES = {
    ("이래서", "unspecified"): "So; for this reason; by doing it this way.",
    ("쟤", "unspecified"): "That child; that person over there (informal contraction).",
    ("제", "pronoun"): "I (humble subject form before the subject particle); he or she (context-dependent subject form).",
    ("제", "unspecified"): "My (humble possessive); his or her (context-dependent possessive).",
    ("된소리", "noun"): "A tense consonant sound produced with increased tension in the vocal tract.",
    ("태국", "noun"): "Thailand, a country in mainland Southeast Asia.",
    ("걔", "unspecified"): "That child; that person already mentioned (informal contraction).",
    ("그래도", "unspecified"): "Even so; nevertheless; even if one does so.",
    ("내", "pronoun"): "I, in the subject form used before the subject particle.",
    ("네", "pronoun"): "You, in the subject form used before the subject particle.",
    ("얘", "unspecified"): "This child; this person (informal contraction).",
    ("어떡하다", "unspecified"): "To do what; to deal with something in what way (contraction).",
    ("어미", "noun"): "An inflectional ending attached to a predicate or predicative copula.",
    ("원장", "noun"): "The director or head of an institution, such as a kindergarten or hospital.",
    ("차", "noun"): (
        "A wheeled vehicle for carrying people or goods. / A vehicle-load used to count "
        "people or goods. / A chariot piece in Korean chess."
    ),
    ("별", "noun"): (
        "A star, a celestial body other than the moon that shines at night. / "
        "A general-level military officer, or that officer's insignia. / "
        "A five-pointed star-shaped figure. / "
        "(figurative) A person who has achieved distinction or become famous and popular. / "
        "(figurative) Flickering lights seen after hitting one's head or feeling dizzy."
    ),
}


def classify(target: str, band: str, pos: str, topic: str) -> tuple[int, str]:
    domain, _, subtopic = topic.partition(" > ")
    if band == "beginner":
        early = target in CORE or subtopic in BEGINNER_EARLY or pos in {
            "pronoun", "numeral", "interjection",
        }
        return (1 if early else 2), (
            "core-spelling/basic-life-category rule" if early
            else "beginner expansion/category or uncategorized entry"
        )
    if band == "intermediate":
        late = (
            domain in INTERMEDIATE_LATE or subtopic in INTERMEDIATE_LATE_TOPICS
            or pos in {"affix", "bound noun", "determiner", "adverb"}
            or topic == "general / source uncategorized"
        )
        return (4 if late else 3), (
            "abstract/form-building/uncategorized expansion" if late
            else "concrete daily-social category"
        )
    late = (
        domain in ADVANCED_LATE_DOMAINS or subtopic in ADVANCED_LATE_TOPICS
        or pos in {"affix", "bound noun", "determiner", "adverb"}
        or topic == "general / source uncategorized"
    )
    return (6 if late else 5), (
        "specialist/abstract/form-building/uncategorized expansion" if late
        else "professional and social category"
    )


def build_vocabulary(raw: bytes) -> dict:
    digest = hashlib.sha256(raw).hexdigest()
    if digest != SHA256:
        raise ValueError(f"Source checksum mismatch: {digest}; expected {SHA256}")
    levels = {level: [] for level in range(1, 7)}
    source_bands = collections.Counter()
    omitted = collections.Counter()
    for record, source in enumerate(
        csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))), start=1
    ):
        if source["Vocabulary Level"] not in BANDS:
            omitted["unbanded_dictionary_entries"] += 1
            continue
        band = BANDS[source["Vocabulary Level"]]
        pos = POS[source["Part of Speech"]]
        target = source["Form"].strip()
        meanings = ast.literal_eval(source["English Definition"])
        if not isinstance(meanings, list) or not meanings:
            raise ValueError(f"Missing English meanings in source record {record}")
        glosses = list(dict.fromkeys(re.sub(r"\s+", " ", value).strip() for value in meanings))
        english = " / ".join(glosses)
        if re.search(r"[가-힣ㄱ-ㅎㅏ-ㅣ一-龥]", english):
            english = ENGLISH_OVERRIDES[(target, pos)]
        if not english or not re.search("[A-Za-z]", english):
            raise ValueError(f"Invalid English in source record {record}")
        raw_topic = source["Semantic Category"]
        if raw_topic:
            domain, subtopic = raw_topic.split(" > ")
            topic = DOMAINS[domain] + " > " + TOPICS[subtopic]
        else:
            topic = "general / source uncategorized"
        level, rule = classify(target, band, pos, topic)
        source_bands[band] += 1
        levels[level].append({
            "id": f"ko-nikl-{record:05d}",
            "target": target,
            "reading": "",
            "english": english,
            "part_of_speech": pos,
            "topic": topic,
            "source_id": "nikl-2024-mirror",
            "source_entry": f"{URL}#record={record}",
            "level_basis": (
                f"NIKL source band: {band}; project heuristic TOPIK {level}: {rule}; "
                "not an official per-grade list"
            ),
        })
    counts = {}
    for level, rows in levels.items():
        directory = ROOT / f"topik-{level}"
        directory.mkdir(parents=True, exist_ok=True)
        rows.sort(key=lambda row: (row["target"], row["part_of_speech"], row["id"]))
        with (directory / "vocabulary.csv").open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=FIELDS, lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)
        counts[f"topik-{level}"] = len(rows)
    all_rows = [row for rows in levels.values() for row in rows]
    return {
        "source_revision": REVISION,
        "source_sha256": digest,
        "source_total_records": record,
        "source_band_counts": dict(source_bands),
        "omitted": dict(omitted),
        "vocabulary_counts": counts,
        "vocabulary_total": len(all_rows),
        "unique_target_spellings": len({row["target"] for row in all_rows}),
        "unique_target_pos_pairs": len({(row["target"], row["part_of_speech"]) for row in all_rows}),
        "placement_version": "semantic-band-heuristic-v1",
        "note": "All banded source entries retained. Homographs and distinct source entries are not collapsed.",
    }


def build_grammar() -> dict:
    """The compact authoring table contains only original bilingual teaching material."""
    entries = {level: [] for level in range(1, 7)}
    path = ROOT / "grammar-authoring.tsv"
    with path.open(encoding="utf-8", newline="") as stream:
        for row in csv.DictReader(stream, delimiter="\t"):
            level = int(row["level"])
            index = len(entries[level]) + 1
            entry = {
                "id": f"ko-topik{level}-g{index:03d}",
                "pattern": row["pattern"],
                "english": row["english"],
                "note": row["note"],
                "examples": [
                    {"target": row["example1"], "english": row["translation1"]},
                    {"target": row["example2"], "english": row["translation2"]},
                ],
                "source_id": "original-ko",
                "level_basis": (
                    f"Original teaching selection for TOPIK {level} preparation; "
                    "pedagogical estimate, not an exhaustive official grammar inventory"
                ),
            }
            if any(not row[column].strip() for column in row):
                raise ValueError(f"Empty grammar field: {entry['id']}")
            entries[level].append(entry)
    for level, content in entries.items():
        if len(content) < 30:
            raise ValueError(f"Insufficient grammar coverage for level {level}")
        (ROOT / f"topik-{level}" / "grammar.json").write_text(
            json.dumps(content, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    return {f"topik-{level}": len(content) for level, content in entries.items()}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-file", type=Path, help="Use a local copy; SHA-256 is still enforced.")
    parser.add_argument("--grammar-only", action="store_true", help="Regenerate original grammar without downloading.")
    args = parser.parse_args()
    if not (ROOT / "grammar-authoring.tsv").is_file():
        parser.error(f"Required grammar authoring source is missing: {ROOT / 'grammar-authoring.tsv'}")
    if args.grammar_only:
        print(json.dumps(build_grammar(), indent=2))
        return
    if args.source_file:
        raw = args.source_file.read_bytes()
    else:
        request = urllib.request.Request(URL, headers={"User-Agent": "langapp-curriculum-import/1.0"})
        with urllib.request.urlopen(request, timeout=180) as response:
            raw = response.read()
    report = build_vocabulary(raw)
    report["grammar_counts"] = build_grammar()
    (ROOT / "import-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
