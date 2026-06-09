from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.material import Material
from app.models.user import User
from app.models.quiz import Progress
from app.config import settings
from app.services.interest_expander import expand_interests_to_context
from app.services.media_retrieval import fetch_images_for_slides
from pydantic import BaseModel
from typing import Optional, List
from openai import OpenAI
import json

router = APIRouter()
client = OpenAI(api_key=settings.OPENAI_API_KEY)

LEVEL_DESC = {
    "beginner":     "Начинающий — объясняй максимально просто, без терминов, используй много аналогий",
    "intermediate": "Средний уровень — используй термины с кратким объяснением, давай практические примеры",
    "advanced":     "Продвинутый — технические детали, углублённый разбор, можно использовать формулы",
}


# ── Pydantic models ───────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    lecture_id: str
    user_id: str
    interests: Optional[list] = []

class ExplainRequest(BaseModel):
    lecture_id: str
    question: str
    user_id: Optional[str] = None
    interests: Optional[list] = []
    chat_history: Optional[List[dict]] = []

class PresentationRequest(BaseModel):
    lecture_id: str
    interests: Optional[list] = []
    missing_topics: Optional[list] = []
    incomplete_topics: Optional[list] = []
    key_concepts: Optional[list] = []
    weak_areas: Optional[list] = []


# ── Student context builder ───────────────────────────────────────────────────

def build_student_context(user_id: str, lecture_id: str, fallback_interests: list, db: Session) -> dict:
    user = db.query(User).filter(User.id == user_id).first() if user_id else None
    progress = db.query(Progress).filter(
        Progress.user_id == user_id,
        Progress.lecture_id == lecture_id
    ).first() if user_id else None

    raw_interests = (user.interests or fallback_interests) if user else fallback_interests
    if not raw_interests:
        raw_interests = ["sport"]

    level = (user.student_level or "beginner") if user else "beginner"
    weak_topics = (progress.weak_topics or []) if progress else []

    # Expand interests → specific entities
    expanded = expand_interests_to_context(raw_interests)

    return {
        "level": level,
        "level_desc": LEVEL_DESC.get(level, LEVEL_DESC["beginner"]),
        "interests": raw_interests,
        "interests_str": ", ".join(raw_interests),
        "entities_str": expanded["entities_str"],
        "entities": expanded["entities"],
        "prompt_context": expanded["prompt_context"],
        "interest_primary": expanded["primary_interest"],
        "interest_data": expanded["primary_data"],
        "weak_topics": weak_topics,
        "weak_topics_str": "\n".join(f"  - {t}" for t in weak_topics) if weak_topics else "  не определены",
    }


# ── SVG helpers ───────────────────────────────────────────────────────────────

def generate_svg_illustration(concept: str, example: str, interest: str, entities: list) -> str:
    entity_hint = f" через {entities[0]}" if entities else ""
    prompt = f"""Create a simple SVG illustration (400x200px) explaining this concept{entity_hint}.

Concept: {concept}
Example: {example}
Theme: {interest}

Rules:
- viewBox="0 0 400 200"
- Colors: #7c3aed, #4f46e5, #a78bfa, #60a5fa, white on dark bg #1a1625
- Labels in Russian, short
- NO external images
- Return ONLY the SVG starting with <svg"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=2000, temperature=0.7,
    )
    svg = response.choices[0].message.content.strip()
    if not svg.startswith("<svg"):
        start = svg.find("<svg")
        svg = svg[start:] if start != -1 else _fallback_svg(concept, interest)
    return svg

def _fallback_svg(concept: str, interest: str) -> str:
    return f'''<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg">
  <rect width="400" height="200" fill="#1a1625" rx="12"/>
  <circle cx="200" cy="90" r="40" fill="none" stroke="#7c3aed" stroke-width="2"/>
  <text x="200" y="94" text-anchor="middle" fill="white" font-size="11">{concept[:15]}</text>
  <text x="200" y="160" text-anchor="middle" fill="#a78bfa" font-size="12">{interest}</text>
</svg>'''

def generate_quiz_svg(question: str, correct_answer: str, explanation: str, interest: str) -> str:
    prompt = f"""Create SVG (400x180px) illustrating this quiz answer using {interest}.
Question: {question}
Correct: {correct_answer}
Explanation: {explanation}
Rules: viewBox="0 0 400 180", dark bg #1a1625, colors #7c3aed #10b981 #a78bfa #60a5fa white, labels in Russian.
Return ONLY SVG starting with <svg"""
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1500, temperature=0.7,
    )
    svg = response.choices[0].message.content.strip()
    if not svg.startswith("<svg"):
        start = svg.find("<svg")
        svg = svg[start:] if start != -1 else _fallback_svg(question[:20], interest)
    return svg


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/analyze-notes")
def analyze_notes(data: AnalyzeRequest, db: Session = Depends(get_db)):
    materials = db.query(Material).filter(Material.lecture_id == data.lecture_id).all()
    lecture_text, note_text = "", ""
    for m in materials:
        if m.source_label == "lecture":
            lecture_text += m.extracted_text or ""
        elif m.source_label == "note":
            note_text += m.extracted_text or ""

    if not lecture_text:
        raise HTTPException(status_code=400, detail="No lecture material found")
    if not note_text:
        raise HTTPException(status_code=400, detail="No notes found")

    ctx = build_student_context(data.user_id, data.lecture_id, data.interests or [], db)

    prompt = f"""Ты — адаптивный AI-преподаватель. Проанализируй конспект студента относительно лекции.

ПРОФИЛЬ СТУДЕНТА:
Уровень: {ctx['level_desc']}
Интересы: {ctx['interests_str']}
Конкретные персонажи/личности для примеров: {ctx['entities_str']}
Тематика примеров: {ctx['prompt_context']}
Ранее слабые темы:
{ctx['weak_topics_str']}

ТЕКСТ ЛЕКЦИИ:
{lecture_text[:4000]}

КОНСПЕКТ СТУДЕНТА:
{note_text[:3000]}

Задача: найти ЧТО именно студент не понял или пропустил.
В примерах key_concepts используй КОНКРЕТНЫХ персонажей/личностей: {ctx['entities_str']}
Верни ТОЛЬКО валидный JSON (без markdown):
{{
  "understanding_estimate": 0.72,
  "explanation": "2-3 предложения — общий вывод об уровне понимания",
  "missing_topics": ["тема полностью отсутствует в конспекте"],
  "incomplete_topics": [{{"topic": "название", "issue": "что именно не дописано"}}],
  "weak_areas": ["область знаний для укрепления"],
  "recommendations": ["конкретная рекомендация"],
  "key_concepts": [
    {{
      "term": "Название концепции",
      "simple_explanation": "Простое объяснение",
      "example_with_interests": "Пример через {ctx['entities_str']} — конкретный сценарий (2-3 предложения)",
      "importance": "Почему важно знать"
    }}
  ],
  "completed_note_text": "Полный улучшенный конспект (без LaTeX)"
}}"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=4000, temperature=0.3,
    )

    try:
        text = response.choices[0].message.content.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0]
        result = json.loads(text)
    except Exception:
        result = {
            "explanation": response.choices[0].message.content,
            "missing_topics": [], "weak_areas": [],
            "understanding_estimate": 0,
            "completed_note_text": "",
            "recommendations": [], "key_concepts": [], "incomplete_topics": [],
        }

    # Save progress with updated weak topics
    if data.user_id:
        all_weak = list(result.get("missing_topics", [])) + [
            t.get("topic", "") for t in result.get("incomplete_topics", []) if isinstance(t, dict)
        ]
        all_weak = [t for t in all_weak if t]
        progress = db.query(Progress).filter(
            Progress.user_id == data.user_id,
            Progress.lecture_id == data.lecture_id
        ).first()
        score = result.get("understanding_estimate", 0)
        if progress:
            progress.understanding_score = score
            progress.weak_topics = all_weak
            progress.status = "in_progress"
        else:
            progress = Progress(
                user_id=data.user_id, lecture_id=data.lecture_id,
                understanding_score=score, weak_topics=all_weak, status="in_progress",
            )
            db.add(progress)
        db.commit()

    # Generate SVG for each key concept using expanded entities
    for concept in result.get("key_concepts", []):
        try:
            concept["svg"] = generate_svg_illustration(
                concept.get("term", ""),
                concept.get("example_with_interests", ""),
                ctx["interest_primary"],
                ctx["entities"],
            )
        except Exception:
            concept["svg"] = _fallback_svg(concept.get("term", ""), ctx["interest_primary"])

    # Return expanded entity context to frontend
    result["interest_context"] = {
        "entities": ctx["entities"],
        "style": ctx["interest_data"].get("style", ""),
        "prompt_context": ctx["prompt_context"],
    }
    return result


@router.get("/debug")
def debug_endpoint():
    import traceback, os
    key = settings.OPENAI_API_KEY or ""
    key_preview = f"{key[:8]}...{key[-4:]}" if len(key) > 12 else f"len={len(key)}"
    try:
        test = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": "say ok"}],
            max_tokens=5,
        )
        return {"openai": "ok", "reply": test.choices[0].message.content, "key": key_preview}
    except Exception as e:
        return {"openai_error": str(e), "key": key_preview, "trace": traceback.format_exc()[-600:]}

@router.post("/explain")
def explain_topic(data: ExplainRequest, db: Session = Depends(get_db)):
    try:
        materials = db.query(Material).filter(
            Material.lecture_id == data.lecture_id,
            Material.source_label == "lecture"
        ).all()
        lecture_text = " ".join([m.extracted_text or "" for m in materials])

        ctx = build_student_context(data.user_id, data.lecture_id, data.interests or [], db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {str(e)}")

    system_prompt = f"""Ты — адаптивный AI-репетитор для студентов Казахстана.

ПРОФИЛЬ СТУДЕНТА:
Уровень: {ctx['level_desc']}
Интересы: {ctx['interests_str']}
Конкретные личности/персонажи для примеров: {ctx['entities_str']}
Тематика: {ctx['prompt_context']}
Слабые темы (уделяй особое внимание):
{ctx['weak_topics_str']}

ПРАВИЛА ОТВЕТА:
- Только русский язык
- НЕ используй LaTeX — пиши математику текстом (a/b, x^2)
- Используй ## заголовки и эмодзи
- Примеры ОБЯЗАТЕЛЬНО через: {ctx['entities_str']}
- Если вопрос по слабой теме — объясняй особенно подробно
- Адаптируй сложность под уровень: {ctx['level']}
- В конце: "💡 Запомни:" — короткое правило или мнемоника

МАТЕРИАЛ ЛЕКЦИИ:
{lecture_text[:3000]}"""

    messages = [{"role": "system", "content": system_prompt}]
    for msg in data.chat_history[-10:]:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": data.question})

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            max_tokens=2000, temperature=0.7,
        )
        answer = response.choices[0].message.content
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OpenAI error: {str(e)}")

    svg = None
    try:
        svg = generate_svg_illustration(
            data.question[:50], answer[:200],
            ctx["interest_primary"], ctx["entities"],
        )
    except Exception:
        pass

    return {
        "answer": answer,
        "svg": svg,
        "entities_used": ctx["entities"][:3],
    }


@router.post("/generate-presentation")
def generate_presentation(data: PresentationRequest, db: Session = Depends(get_db)):
    expanded = expand_interests_to_context(data.interests or [])
    interests_str = ", ".join(data.interests) if data.interests else "спорт"
    interest = expanded["primary_interest"]
    entities_str = expanded["entities_str"]
    interest_data = expanded["primary_data"]

    all_weak = []
    for t in (data.missing_topics or []):
        all_weak.append({"topic": t, "type": "missing", "issue": "тема полностью пропущена"})
    for t in (data.incomplete_topics or []):
        if isinstance(t, dict):
            all_weak.append({"topic": t.get("topic", ""), "type": "incomplete", "issue": t.get("issue", "")})
    if not all_weak:
        for c in (data.key_concepts or [])[:4]:
            all_weak.append({"topic": c.get("term", ""), "type": "concept", "issue": "требует углублённого изучения"})
    if not all_weak:
        raise HTTPException(status_code=400, detail="Нет слабых тем для презентации")

    entities = expanded["entities"]
    prompt = f"""Ты эксперт-преподаватель. Создай детальный контент для учебной презентации на русском языке.

ИНТЕРЕСЫ СТУДЕНТА: {interests_str}
КОНКРЕТНЫЕ ПЕРСОНАЖИ/ЛИЧНОСТИ (ОБЯЗАТЕЛЬНО используй в примерах): {entities_str}
ТЕМАТИКА ПРИМЕРОВ: {expanded['prompt_context']}

СЛАБЫЕ ТЕМЫ: {json.dumps(all_weak, ensure_ascii=False)}

Для КАЖДОЙ темы создай слайд. В каждом примере упомяни конкретного персонажа из: {entities_str}

Верни ТОЛЬКО валидный JSON:
{{
  "slides": [
    {{
      "title": "Название темы",
      "status": "пропущена" или "не до конца понята",
      "explanation": "Чёткое объяснение (3-4 предложения, простым языком)",
      "key_points": ["Факт 1 (до 12 слов)", "Факт 2", "Факт 3"],
      "interest_example": "КОНКРЕТНЫЙ пример через {entities_str} — опиши реальный сценарий (2-3 предл.)",
      "entity_for_image": "Имя персонажа/личности из {entities_str} для иллюстрации этого слайда",
      "remember": "Одна мнемоника или запоминалка"
    }}
  ]
}}

Требования: без LaTeX, простой разговорный русский, entity_for_image — из списка {entities_str}"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=3000, temperature=0.4,
    )

    text = response.choices[0].message.content.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0]

    try:
        result = json.loads(text)
    except Exception:
        raise HTTPException(status_code=500, detail="Ошибка генерации контента")

    slides = result.get("slides", [])

    # Fetch real images for each slide in parallel
    slides = fetch_images_for_slides(slides, interest_data)

    return {
        "slides": slides,
        "interest": interest,
        "entities": entities,
        "style": interest_data.get("style", ""),
    }


@router.post("/quiz-svg")
def get_quiz_svg(data: dict, db: Session = Depends(get_db)):
    interest = data.get("interest", "sport")
    try:
        svg = generate_quiz_svg(
            data.get("question", ""),
            data.get("correct_answer", ""),
            data.get("explanation", ""),
            interest,
        )
        return {"svg": svg}
    except Exception:
        return {"svg": _fallback_svg(data.get("question", "")[:20], interest)}
