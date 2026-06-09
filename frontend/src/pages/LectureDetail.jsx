import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { materialsAPI, aiAPI, quizzesAPI, lecturesAPI } from '../api'
import ReactMarkdown from 'react-markdown'
import { buildPptx } from '../utils/generatePptx'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  Title, Tooltip, Legend, RadialLinearScale, PointElement,
  LineElement, Filler, ArcElement
} from 'chart.js'
import { Radar } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend,
  RadialLinearScale, PointElement, LineElement, Filler, ArcElement
)

const TABS = [
  { key: 'materials', icon: '📁', label: 'Файлы' },
  { key: 'ai',        icon: '🤖', label: 'Анализ' },
  { key: 'chat',      icon: '💬', label: 'Чат' },
  { key: 'quiz',      icon: '✏️', label: 'Тест' },
]

const HINTS = [
  'Объясни главную тему простыми словами',
  'Какие самые важные концепции?',
  'Дай пример из реальной жизни',
  'Объясни шаг за шагом',
]

/* Animated score counter */
function useCounter(target, active) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (!active) return
    let frame
    const start = performance.now()
    const dur   = 900
    const tick = (now) => {
      const t = Math.min((now - start) / dur, 1)
      const eased = 1 - Math.pow(1 - t, 3)   // ease-out cubic
      setVal(Math.round(eased * target))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, active])
  return val
}

export default function LectureDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const user = JSON.parse(localStorage.getItem('user') || '{}')
  const messagesEndRef = useRef(null)
  const tabBarRef      = useRef(null)

  const [tab, setTab]         = useState('materials')
  const [indicator, setIndicator] = useState({ x: 0, w: 0 })

  const [materials, setMaterials]   = useState([])
  const [uploading, setUploading]   = useState(false)
  const [analysis,  setAnalysis]    = useState(null)
  const [analyzing, setAnalyzing]   = useState(false)
  const [progressW, setProgressW]   = useState(0)   // animated progress bar

  const [chatMessages, setChatMessages] = useState([])
  const [question, setQuestion] = useState('')
  const [asking,   setAsking]   = useState(false)

  const [quizzes,     setQuizzes]     = useState([])
  const [activeQuiz,  setActiveQuiz]  = useState(null)
  const [generating,  setGenerating]  = useState(false)
  const [answers,     setAnswers]     = useState({})
  const [result,      setResult]      = useState(null)
  const [showHistory, setShowHistory] = useState(false)
  const [attempts,    setAttempts]    = useState([])
  const [historyQs,   setHistoryQs]   = useState([])

  const [genPpt,       setGenPpt]       = useState(false)
  const [pptDone,      setPptDone]      = useState(false)
  const [newWeakTopics, setNewWeakTopics] = useState([])
  const [lectureTitle, setLectureTitle] = useState('')

  const scoreDisplay = useCounter(result?.percentage ?? 0, !!result)

  /* ── tab indicator (sliding pill) ─────────── */
  useLayoutEffect(() => {
    const bar = tabBarRef.current
    if (!bar) return
    const el = bar.querySelector(`[data-tab="${tab}"]`)
    if (el) setIndicator({ x: el.offsetLeft, w: el.offsetWidth })
  }, [tab])

  /* ── data loading ──────────────────────────── */
  useEffect(() => {
    loadMaterials()
    loadQuizzes()
    lecturesAPI.getById(id).then(r => setLectureTitle(r.data.title || '')).catch(() => {})
  }, [])
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, asking])

  const loadMaterials = async () => {
    try { const res = await materialsAPI.getAll(id); setMaterials(res.data) } catch {}
  }
  const loadQuizzes = async () => {
    try { const res = await quizzesAPI.getAll(id); setQuizzes(res.data) } catch {}
  }

  /* ── actions ───────────────────────────────── */
  const uploadFile = async (e, sourceLabel) => {
    const file = e.target.files[0]; if (!file) return
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file); fd.append('lecture_id', id)
    fd.append('source_label', sourceLabel)
    fd.append('type', sourceLabel === 'note' ? 'note' : 'pdf')
    await materialsAPI.upload(fd)
    await loadMaterials()
    setUploading(false)
  }

  const analyzeNotes = async () => {
    const hasLecture = materials.some(m => m.source_label === 'lecture')
    const hasNote    = materials.some(m => m.source_label === 'note')
    if (!hasLecture || !hasNote) {
      alert(`Загрузи оба файла:\n${!hasLecture ? '❌ Лекция (от преподавателя)\n' : '✅ Лекция загружена\n'}${!hasNote ? '❌ Конспект (твои записи)' : '✅ Конспект загружен'}`)
      return
    }
    setAnalyzing(true); setProgressW(0)
    try {
      const res = await aiAPI.analyzeNotes({ lecture_id: id, user_id: user.id, interests: user.interests || [] })
      setAnalysis(res.data)
      setTimeout(() => setProgressW(Math.round((res.data.understanding_estimate || 0) * 100)), 200)
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || 'Неизвестная ошибка'
      alert(`Ошибка анализа: ${msg}`)
    }
    setAnalyzing(false)
  }

  const askQuestion = async () => {
    if (!question.trim() || asking) return
    const text = question.trim()
    setQuestion(''); setAsking(true)
    const newMsgs = [...chatMessages, { role: 'user', content: text }]
    setChatMessages(newMsgs)
    try {
      const res = await aiAPI.explain({ lecture_id: id, question: text, user_id: user.id, interests: user.interests || [], chat_history: chatMessages })
      setChatMessages([...newMsgs, { role: 'assistant', content: res.data.answer, image_url: res.data.image_url }])
    } catch (err) {
      const isNetwork = !err?.response
      const msg = isNetwork
        ? '⏳ Сервер просыпается (~30 сек), отправь вопрос ещё раз.'
        : `❌ Ошибка: ${err?.response?.data?.detail || 'попробуй снова'}`
      setChatMessages([...newMsgs, { role: 'assistant', content: msg }])
    }
    setAsking(false)
  }

  const createPresentation = async () => {
    if (!analysis) return
    setGenPpt(true); setPptDone(false)
    try {
      const res = await aiAPI.generatePresentation({
        lecture_id: id,
        interests: user.interests || [],
        missing_topics: analysis.missing_topics || [],
        incomplete_topics: analysis.incomplete_topics || [],
        key_concepts: analysis.key_concepts || [],
        weak_areas: analysis.weak_areas || [],
      })
      await buildPptx(res.data.slides, res.data.interest, lectureTitle || 'Разбор слабых тем', res.data.entities || [], res.data.style || '')
      setPptDone(true)
    } catch { alert('Ошибка при создании презентации') }
    setGenPpt(false)
  }

  const generateQuiz = async () => {
    setGenerating(true)
    try {
      const res = await quizzesAPI.generate({
        lecture_id: id, weak_areas: analysis?.weak_areas || [],
        num_questions: 10, interests: user.interests || [],
      })
      setActiveQuiz(res.data); setAnswers({}); setResult(null)
      await loadQuizzes()
    } catch (err) {
      const isNetwork = !err?.response
      alert(isNetwork
        ? 'Сервер просыпается (~30 сек). Попробуй снова через полминуты.'
        : `Ошибка: ${err?.response?.data?.detail || 'Убедись что загружены материалы.'}`)
    }
    setGenerating(false)
  }

  const openExistingQuiz = async (quizId) => {
    const res = await quizzesAPI.getQuestions(quizId)
    setActiveQuiz(res.data); setAnswers({}); setResult(null); setShowHistory(false)
  }

  const submitQuiz = async () => {
    const ans = activeQuiz.questions.map((_, i) => answers[i] || '')
    const res = await quizzesAPI.submitAttempt({
      quiz_id: activeQuiz.quiz_id || activeQuiz.id, user_id: user.id, answers: ans,
    })
    setResult(res.data)
    setNewWeakTopics(res.data.new_weak_topics || [])
    await loadQuizzes()
  }

  const loadAttempts = async (quiz) => {
    const [attRes, qRes] = await Promise.all([
      quizzesAPI.getAttempts(quiz.id),
      quizzesAPI.getQuestions(quiz.id),
    ])
    setAttempts(attRes.data); setHistoryQs(qRes.data.questions || []); setShowHistory(true)
  }

  /* ── radar chart ───────────────────────────── */
  const radarData = (() => {
    if (!analysis?.key_concepts?.length) return null
    const labels = analysis.key_concepts.map(c => c.term)
    const data   = analysis.key_concepts.map((_, i) =>
      Math.max(10, Math.round((analysis.understanding_estimate || 0.5) * 100 - i * 6)))
    if (analysis.missing_topics?.length) {
      labels.push(...analysis.missing_topics)
      data.push(...analysis.missing_topics.map(() => 0))
    }
    return {
      labels,
      datasets: [{
        label: 'Понимание', data,
        backgroundColor: 'rgba(124,58,237,.2)',
        borderColor: '#7c3aed', pointBackgroundColor: '#a78bfa',
        borderWidth: 2,
      }],
    }
  })()

  const scoreColor = result
    ? result.percentage >= 80 ? 'var(--green)'
      : result.percentage >= 50 ? 'var(--amber)' : 'var(--red)'
    : 'white'

  /* ── render ────────────────────────────────── */
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="orb orb-1" />

      {/* Header + tab bar */}
      <div className="header" style={{ flexShrink: 0 }}>
        <button className="btn-ghost animate-in s1" onClick={() => navigate(-1)} style={{ marginBottom: 16 }}>
          ← Назад
        </button>

        {/* Sliding tab bar */}
        <div className="tab-bar" ref={tabBarRef}>
          <div
            className="tab-indicator"
            style={{ transform: `translateX(${indicator.x}px)`, width: indicator.w }}
          />
          {TABS.map(t => (
            <button
              key={t.key}
              className="tab-btn"
              data-tab={t.key}
              data-active={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              <span className="tab-btn-icon">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content — key forces re-mount → CSS entry animation */}
      <div
        key={tab}
        className="animate-in"
        style={{
          flex: 1, padding: '0 20px',
          paddingBottom: tab === 'chat' ? 0 : 80,
          display: 'flex', flexDirection: 'column',
        }}
      >

        {/* ═══════════════ MATERIALS ═══════════════ */}
        {tab === 'materials' && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>📁 Материалы лекции</h2>
            <p style={{ color: 'rgba(255,255,255,.4)', fontSize: 13, marginBottom: 20 }}>
              Загрузи лекцию и свой конспект для AI анализа
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
              {[
                { label: '📄 Лекция',  sub: 'PDF или текст от преподавателя', source: 'lecture', color: '#7c3aed' },
                { label: '📝 Конспект', sub: 'Твои записи с занятия',          source: 'note',    color: '#0ea5e9' },
              ].map(item => (
                <label key={item.source} className="upload-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <p style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{item.label}</p>
                      <p style={{ color: 'rgba(255,255,255,.38)', fontSize: 12 }}>{item.sub}</p>
                    </div>
                    <div style={{
                      width: 40, height: 40, borderRadius: 12,
                      background: `${item.color}22`, border: `1px solid ${item.color}44`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
                    }}>{item.source === 'lecture' ? '📄' : '📝'}</div>
                  </div>
                  <div
                    className="btn btn-primary"
                    style={{ background: `linear-gradient(135deg,${item.color},${item.color}bb)`, textAlign: 'center' }}
                  >
                    Выбрать файл
                  </div>
                  <input type="file" accept=".pdf,.txt,.png,.jpg" style={{ display: 'none' }}
                    onChange={e => uploadFile(e, item.source)} />
                </label>
              ))}
            </div>

            {uploading && (
              <div className="info-box">
                <span className="spinner" style={{ width: 16, height: 16 }} />
                Загружаем файл...
              </div>
            )}

            {materials.length > 0 && (
              <div>
                <p className="section-label">Загруженные файлы ({materials.length})</p>
                {materials.map(m => (
                  <div key={m.id} className="file-item">
                    <span style={{ color: 'rgba(255,255,255,.7)', fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.source_label === 'lecture' ? '📄' : '📝'} {m.file_path?.split('/').pop()}
                    </span>
                    <span className={`badge ${m.source_label === 'lecture' ? 'badge-purple' : 'badge-blue'}`}>
                      {m.source_label}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════ AI ANALYSIS ═══════════════ */}
        {tab === 'ai' && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>🤖 AI Анализ</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              {user.student_level && (
                <span style={{
                  padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                  background: 'rgba(124,58,237,.2)', border: '1px solid rgba(124,58,237,.35)',
                  color: '#a78bfa',
                }}>
                  {{ beginner: '🌱 Начинающий', intermediate: '📚 Средний', advanced: '🚀 Продвинутый' }[user.student_level] || '🌱 Начинающий'}
                </span>
              )}
              {(user.interests || []).slice(0, 3).map((it, i) => (
                <span key={i} style={{
                  padding: '3px 10px', borderRadius: 20, fontSize: 11,
                  background: 'rgba(79,70,229,.15)', border: '1px solid rgba(79,70,229,.3)',
                  color: '#60a5fa',
                }}>⭐ {it}</span>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {[
                { label: 'Лекция', key: 'lecture', icon: '📄' },
                { label: 'Конспект', key: 'note', icon: '📝' },
              ].map(({ label, key, icon }) => {
                const has = materials.some(m => m.source_label === key)
                return (
                  <div key={key} style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                    borderRadius: 10, fontSize: 12, fontWeight: 600,
                    background: has ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.1)',
                    border: `1px solid ${has ? 'rgba(16,185,129,.3)' : 'rgba(239,68,68,.3)'}`,
                    color: has ? '#34d399' : '#f87171',
                  }}>
                    {has ? '✅' : '❌'} {icon} {label}
                  </div>
                )
              })}
            </div>

            <button
              className="btn btn-primary"
              onClick={analyzeNotes}
              disabled={analyzing}
              style={{ marginBottom: 24 }}
            >
              {analyzing ? <><span className="spinner" /> Анализируем...</> : '🔍 Запустить анализ'}
            </button>

            {analysis && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Understanding score */}
                <div className="card-gradient animate-scale">
                  <p style={{ color: 'rgba(255,255,255,.6)', fontSize: 13, marginBottom: 8 }}>
                    Уровень понимания материала
                  </p>
                  <p style={{ fontSize: 56, fontWeight: 800, lineHeight: 1, marginBottom: 12 }}>
                    {progressW}%
                  </p>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${progressW}%` }} />
                  </div>
                </div>

                {/* Interest entity context banner */}
                {analysis.interest_context?.entities?.length > 0 && (
                  <div className="card animate-in s2" style={{
                    background: 'linear-gradient(135deg,rgba(79,70,229,.12),rgba(124,58,237,.08))',
                    border: '1px solid rgba(124,58,237,.3)',
                  }}>
                    <p style={{ fontSize: 11, color: '#a78bfa', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                      🎯 Адаптивный контекст — примеры через
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {analysis.interest_context.entities.map((e, i) => (
                        <span key={i} style={{
                          padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                          background: 'rgba(124,58,237,.2)', border: '1px solid rgba(124,58,237,.4)',
                          color: 'white',
                        }}>{e}</span>
                      ))}
                    </div>
                    {analysis.interest_context.style && (
                      <p style={{ color: 'rgba(255,255,255,.35)', fontSize: 11, marginTop: 8 }}>
                        Стиль: {analysis.interest_context.style}
                      </p>
                    )}
                  </div>
                )}

                {/* Radar chart */}
                {radarData && (
                  <div className="card animate-in s2">
                    <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>📊 Карта знаний</p>
                    <Radar data={radarData} options={{
                      responsive: true,
                      plugins: { legend: { display: false } },
                      scales: {
                        r: {
                          min: 0, max: 100,
                          ticks: { color: 'rgba(255,255,255,.4)', font: { size: 10 }, stepSize: 25 },
                          grid: { color: 'rgba(255,255,255,.08)' },
                          pointLabels: { color: 'rgba(255,255,255,.7)', font: { size: 11 } },
                          angleLines: { color: 'rgba(255,255,255,.08)' },
                        },
                      },
                    }} />
                  </div>
                )}

                {/* Explanation */}
                {analysis.explanation && (
                  <div className="card animate-in s3">
                    <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>📊 Общий вывод</p>
                    <p style={{ color: 'rgba(255,255,255,.75)', fontSize: 14, lineHeight: 1.7 }}>
                      {analysis.explanation}
                    </p>
                  </div>
                )}

                {/* Key concepts */}
                {analysis.key_concepts?.length > 0 && (
                  <div>
                    <p className="section-label">💡 Ключевые концепции</p>
                    {analysis.key_concepts.map((c, i) => (
                      <div key={i} className={`card animate-in s${Math.min(i + 2, 8)}`}
                        style={{ marginBottom: 14, borderLeft: '3px solid #7c3aed' }}>
                        <p style={{ fontWeight: 800, fontSize: 15, marginBottom: 12 }}>
                          {i + 1}. {c.term}
                        </p>
                        {c.image_url && (
                          <div style={{ marginBottom: 12, borderRadius: 12, overflow: 'hidden' }}>
                            <img src={c.image_url} alt={c.term}
                              style={{ width: '100%', height: 180, objectFit: 'cover', display: 'block' }}
                              onError={e => { e.target.style.display = 'none' }} />
                            <p style={{ background: 'rgba(0,0,0,.5)', color: 'rgba(255,255,255,.5)', fontSize: 11, padding: '5px 10px' }}>
                              📸 Иллюстрация: {c.term}
                            </p>
                          </div>
                        )}
                        <div className="concept-block">
                          <p className="concept-label">📖 Простое объяснение</p>
                          <p className="concept-text">{c.simple_explanation}</p>
                        </div>
                        {c.example_with_interests && (
                          <div className="concept-block" style={{ background: 'rgba(124,58,237,.10)', border: '1px solid rgba(124,58,237,.20)' }}>
                            <p className="concept-label" style={{ color: '#a78bfa' }}>⭐ Пример из твоих интересов</p>
                            <p className="concept-text">{c.example_with_interests}</p>
                          </div>
                        )}
                        {c.importance && (
                          <div className="concept-block" style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.15)' }}>
                            <p className="concept-label" style={{ color: 'var(--green-light)' }}>🎯 Почему важно</p>
                            <p className="concept-text">{c.importance}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Missing topics */}
                {analysis.missing_topics?.length > 0 && (
                  <div className="card" style={{ borderLeft: '3px solid var(--red)' }}>
                    <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--red-light)', marginBottom: 10 }}>
                      ❌ Пропущенные темы
                    </p>
                    {analysis.missing_topics.map((t, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
                        <span style={{ color: 'var(--red)', flexShrink: 0 }}>•</span>
                        <p style={{ color: 'rgba(255,255,255,.8)', fontSize: 14 }}>{t}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Incomplete topics */}
                {analysis.incomplete_topics?.length > 0 && (
                  <div className="card" style={{ borderLeft: '3px solid var(--amber)' }}>
                    <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--amber-light)', marginBottom: 10 }}>
                      ⚠️ Неполные темы
                    </p>
                    {analysis.incomplete_topics.map((t, i) => (
                      <div key={i} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: i < analysis.incomplete_topics.length - 1 ? '1px solid rgba(255,255,255,.06)' : 'none' }}>
                        <p style={{ color: 'var(--amber-light)', fontSize: 13, fontWeight: 700, marginBottom: 3 }}>{t.topic}</p>
                        <p style={{ color: 'rgba(255,255,255,.6)', fontSize: 13 }}>{t.issue}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Recommendations */}
                {analysis.recommendations?.length > 0 && (
                  <div className="card" style={{ borderLeft: '3px solid var(--green)' }}>
                    <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--green-light)', marginBottom: 10 }}>
                      💡 Рекомендации
                    </p>
                    {analysis.recommendations.map((r, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
                        <span style={{ color: 'var(--green)', fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
                        <p style={{ color: 'rgba(255,255,255,.75)', fontSize: 14, lineHeight: 1.5 }}>{r}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Improved note */}
                {analysis.completed_note_text && (
                  <div className="card">
                    <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>📋 Улучшенный конспект</p>
                    <div style={{ color: 'rgba(255,255,255,.8)', fontSize: 14, lineHeight: 1.8 }}>
                      <ReactMarkdown>{analysis.completed_note_text}</ReactMarkdown>
                    </div>
                  </div>
                )}

                {/* Presentation generator */}
                {(analysis.missing_topics?.length > 0 || analysis.incomplete_topics?.length > 0) && (
                  <div className="card animate-in" style={{
                    background: 'linear-gradient(135deg, rgba(124,58,237,0.15), rgba(79,70,229,0.10))',
                    border: '1px solid rgba(124,58,237,0.35)',
                    marginBottom: 4,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                        background: 'rgba(124,58,237,0.25)', border: '1px solid rgba(124,58,237,0.4)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
                      }}>📊</div>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
                          Создать презентацию
                        </p>
                        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 14, lineHeight: 1.5 }}>
                          AI создаст .pptx файл с разбором пропущенных и не до конца понятых тем — с примерами из твоих интересов
                        </p>
                        <button
                          className="btn btn-primary"
                          onClick={createPresentation}
                          disabled={genPpt}
                          style={{
                            background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                            fontSize: 14, padding: '10px 20px',
                          }}
                        >
                          {genPpt
                            ? <><span className="spinner" /> Генерируем презентацию...</>
                            : pptDone
                              ? '✅ Скачать снова'
                              : '📥 Создать PPTX презентацию'}
                        </button>
                        {pptDone && (
                          <p style={{ color: 'rgba(16,185,129,0.9)', fontSize: 12, marginTop: 8 }}>
                            ✅ Файл сохранён в папку Загрузки
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <button className="btn btn-secondary" onClick={() => setTab('quiz')} style={{ marginBottom: 20 }}>
                  ✏️ Пройти тест по слабым местам →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════ CHAT ═══════════════ */}
        {tab === 'chat' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <div style={{ marginBottom: 12, flexShrink: 0 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>💬 Чат с AI</h2>
              <p style={{ color: 'rgba(255,255,255,.4)', fontSize: 13, marginBottom: 0 }}>
                Задавай вопросы — объясню с примерами из твоих интересов
              </p>
            </div>

            {/* Messages */}
            <div style={{
              flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column',
              gap: 14, paddingBottom: 14,
              minHeight: 300, maxHeight: 'calc(100vh - 380px)',
            }}>
              {chatMessages.length === 0 && (
                <div className="animate-fade" style={{ textAlign: 'center', padding: '20px 12px' }}>
                  <p style={{ fontSize: 44, marginBottom: 10 }}>🤖</p>
                  <p style={{ color: 'rgba(255,255,255,.6)', fontSize: 15, fontWeight: 600, marginBottom: 5 }}>
                    Привет! Я твой AI-ассистент
                  </p>
                  <p style={{ color: 'rgba(255,255,255,.32)', fontSize: 13, marginBottom: 20 }}>
                    Интересы: {(user.interests || []).join(', ') || 'не указаны'}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {HINTS.map((h, i) => (
                      <button
                        key={i}
                        className={`hint-chip animate-in s${i + 2}`}
                        onClick={() => setQuestion(h)}
                      >
                        💡 {h}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={msg.role === 'user' ? 'chat-message chat-message-user' : 'chat-message chat-message-bot'}
                >
                  {msg.role === 'assistant' && (
                    <div className="chat-avatar chat-avatar-bot">🤖</div>
                  )}
                  <div style={{ maxWidth: '82%', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {msg.image_url && (
                      <div style={{ borderRadius: 16, overflow: 'hidden' }}>
                        <img src={msg.image_url} alt="illustration"
                          style={{ width: '100%', maxHeight: 200, objectFit: 'cover', display: 'block' }}
                          onError={e => { e.target.style.display = 'none' }} />
                        <p style={{ background: 'rgba(0,0,0,.6)', color: 'rgba(255,255,255,.45)', fontSize: 10, padding: '4px 8px' }}>
                          📸 Иллюстрация к объяснению
                        </p>
                      </div>
                    )}
                    <div className={msg.role === 'user' ? 'chat-bubble chat-bubble-user' : 'chat-bubble chat-bubble-bot'}>
                      {msg.role === 'assistant'
                        ? <div style={{ lineHeight: 1.7 }}><ReactMarkdown>{msg.content}</ReactMarkdown></div>
                        : <p style={{ margin: 0 }}>{msg.content}</p>
                      }
                    </div>
                  </div>
                  {msg.role === 'user' && (
                    <div className="chat-avatar chat-avatar-user">👤</div>
                  )}
                </div>
              ))}

              {asking && (
                <div className="chat-message chat-message-bot">
                  <div className="chat-avatar chat-avatar-bot">🤖</div>
                  <div className="typing-bubble">
                    <span className="dot" />
                    <span className="dot" />
                    <span className="dot" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input bar */}
            <div className="chat-input-bar">
              <textarea
                className="chat-textarea"
                placeholder="Напиши вопрос... (Enter — отправить)"
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askQuestion() } }}
                rows={1}
              />
              <button
                className="send-btn"
                onClick={askQuestion}
                disabled={asking || !question.trim()}
              >↑</button>
            </div>
          </div>
        )}

        {/* ═══════════════ QUIZ ═══════════════ */}
        {tab === 'quiz' && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>✏️ Тесты</h2>
            <p style={{ color: 'rgba(255,255,255,.4)', fontSize: 13, marginBottom: 20 }}>
              10 уникальных вопросов каждый раз
            </p>

            {/* List / generate */}
            {!activeQuiz && !showHistory && (
              <div>
                <button
                  className="btn btn-primary"
                  onClick={generateQuiz}
                  disabled={generating}
                  style={{ marginBottom: 24 }}
                >
                  {generating ? <><span className="spinner" /> Генерируем 10 вопросов...</> : '✨ Создать новый тест'}
                </button>

                {quizzes.length > 0 && (
                  <div>
                    <p className="section-label">📚 История тестов ({quizzes.length})</p>
                    {quizzes.map((q, i) => (
                      <div key={q.id} className={`card animate-in s${Math.min(i + 1, 8)}`} style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                          <p style={{ fontWeight: 700, fontSize: 14, flex: 1, marginRight: 8 }}>{q.title}</p>
                          <span className={`badge ${
                            q.best_score >= 80 ? 'badge-green' : q.best_score >= 50 ? 'badge-amber' : 'badge-red'
                          }`}>{q.best_score}%</span>
                        </div>
                        <p style={{ color: 'rgba(255,255,255,.4)', fontSize: 12, marginBottom: 12 }}>
                          Попыток: {q.attempts_count}
                        </p>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            className="btn btn-primary"
                            style={{ flex: 1, padding: '10px', fontSize: 13 }}
                            onClick={() => openExistingQuiz(q.id)}
                          >▶ Пройти снова</button>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '10px 14px', fontSize: 13, width: 'auto' }}
                            onClick={() => loadAttempts(q)}
                          >📊 История</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* History */}
            {showHistory && (
              <div>
                <button className="btn btn-secondary" style={{ marginBottom: 16 }}
                  onClick={() => { setShowHistory(false); setAttempts([]); setHistoryQs([]) }}>
                  ← Назад к тестам
                </button>

                {historyQs.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <p className="section-label">📝 Вопросы теста ({historyQs.length})</p>
                    {historyQs.map((q, i) => (
                      <div key={i} className={`card animate-in s${Math.min(i + 1, 8)}`} style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
                          <div className="num-pill" style={{ width: 28, height: 28, borderRadius: 8, fontSize: 11 }}>{i + 1}</div>
                          <p style={{ color: 'white', fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>{q.question}</p>
                        </div>
                        {q.options?.map((opt, j) => (
                          <div key={j} style={{
                            padding: '8px 12px', marginBottom: 6, borderRadius: 10,
                            background: opt[0] === q.correct_answer ? 'rgba(16,185,129,.12)' : 'rgba(255,255,255,.03)',
                            border: `1px solid ${opt[0] === q.correct_answer ? 'rgba(16,185,129,.3)' : 'rgba(255,255,255,.06)'}`,
                            display: 'flex', alignItems: 'center', gap: 8,
                          }}>
                            <span style={{ fontSize: 12 }}>{opt[0] === q.correct_answer ? '✅' : '○'}</span>
                            <span style={{ color: opt[0] === q.correct_answer ? 'var(--green-light)' : 'rgba(255,255,255,.6)', fontSize: 13 }}>{opt}</span>
                          </div>
                        ))}
                        {q.explanation && (
                          <div style={{ marginTop: 8, background: 'rgba(167,139,250,.08)', borderRadius: 10, padding: '10px 12px' }}>
                            <p style={{ color: 'var(--violet)', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>💡 ОБЪЯСНЕНИЕ</p>
                            <p style={{ color: 'rgba(255,255,255,.65)', fontSize: 12, lineHeight: 1.5 }}>{q.explanation}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <p className="section-label">📊 Попытки ({attempts.length})</p>
                {attempts.length === 0 ? (
                  <div className="empty-state" style={{ padding: '30px 20px' }}>Попыток пока нет</div>
                ) : attempts.map((a, i) => (
                  <div key={i} className={`card animate-in s${Math.min(i + 1, 8)}`}
                    style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 600 }}>Попытка {attempts.length - i}</p>
                      <p style={{ color: 'rgba(255,255,255,.4)', fontSize: 12, marginTop: 2 }}>{a.total} вопросов</p>
                    </div>
                    <span className={`badge ${a.score >= 0.8 ? 'badge-green' : a.score >= 0.5 ? 'badge-amber' : 'badge-red'}`}
                      style={{ fontSize: 14, padding: '6px 14px' }}>
                      {Math.round(a.score * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Active quiz */}
            {activeQuiz && !result && (
              <div>
                <button className="btn btn-secondary" style={{ marginBottom: 16 }}
                  onClick={() => setActiveQuiz(null)}>← Назад</button>

                <div className="card" style={{ background: 'rgba(124,58,237,.15)', marginBottom: 20, borderLeft: '3px solid var(--purple)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <p style={{ color: 'var(--violet)', fontWeight: 700, fontSize: 14 }}>📝 {activeQuiz.title}</p>
                    <span style={{ color: 'rgba(255,255,255,.4)', fontSize: 12 }}>{activeQuiz.questions?.length} вопросов</span>
                  </div>
                </div>

                {activeQuiz.questions?.map((q, i) => (
                  <div key={i} className={`card animate-in s${Math.min(i + 1, 8)}`} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'flex-start' }}>
                      <div className="num-pill" style={{ width: 30, height: 30, borderRadius: 8, fontSize: 12 }}>{i + 1}</div>
                      <p style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.5 }}>{q.question}</p>
                    </div>
                    {q.options?.map((opt, j) => (
                      <div
                        key={j}
                        className="quiz-option"
                        data-selected={answers[i] === opt[0]}
                        onClick={() => setAnswers({ ...answers, [i]: opt[0] })}
                      >
                        <div className="quiz-radio" data-selected={answers[i] === opt[0]} />
                        <span style={{
                          color: answers[i] === opt[0] ? 'white' : 'rgba(255,255,255,.7)',
                          fontSize: 14, transition: 'color 130ms ease',
                        }}>{opt}</span>
                      </div>
                    ))}
                  </div>
                ))}

                <button className="btn btn-primary" onClick={submitQuiz} style={{ marginBottom: 40 }}>
                  Сдать тест →
                </button>
              </div>
            )}

            {/* Result */}
            {result && (
              <div className="animate-scale" style={{ paddingBottom: 40 }}>
                <div className="card-gradient" style={{ textAlign: 'center', marginBottom: 20 }}>
                  <p style={{ fontSize: 52, marginBottom: 10 }}>
                    {result.percentage >= 80 ? '🎉' : result.percentage >= 50 ? '👍' : '📚'}
                  </p>
                  <p style={{ fontSize: 58, fontWeight: 800, lineHeight: 1, marginBottom: 6, color: scoreColor }}>
                    {scoreDisplay}%
                  </p>
                  <p style={{ color: 'rgba(255,255,255,.6)', fontSize: 15, marginBottom: 16 }}>
                    {result.correct} из {result.total} правильных
                  </p>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${result.percentage}%`,
                        background: result.percentage >= 80
                          ? 'linear-gradient(135deg,var(--green),var(--green-light))'
                          : result.percentage >= 50
                            ? 'linear-gradient(135deg,var(--amber),var(--amber-light))'
                            : 'linear-gradient(135deg,var(--red),var(--red-light))',
                      }}
                    />
                  </div>
                </div>

                {/* Weak topics feedback loop */}
                {newWeakTopics.length > 0 && (
                  <div className="card animate-in" style={{
                    borderLeft: '3px solid var(--amber)', marginBottom: 16,
                    background: 'rgba(245,158,11,.06)',
                  }}>
                    <p style={{ fontWeight: 700, fontSize: 13, color: 'var(--amber-light)', marginBottom: 8 }}>
                      🧠 AI обновил твой профиль
                    </p>
                    <p style={{ color: 'rgba(255,255,255,.55)', fontSize: 12, marginBottom: 8 }}>
                      Эти темы добавлены в слабые — следующие объяснения и тесты будут сфокусированы на них:
                    </p>
                    {newWeakTopics.map((t, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ color: 'var(--amber)', fontSize: 13 }}>•</span>
                        <span style={{ color: 'rgba(255,255,255,.8)', fontSize: 13 }}>{t}</span>
                      </div>
                    ))}
                  </div>
                )}

                <p className="section-label">📋 Разбор ответов</p>
                {result.results?.map((r, i) => (
                  <div key={i} className={`card animate-in s${Math.min(i + 1, 8)}`}
                    style={{ marginBottom: 12, borderLeft: `3px solid ${r.is_correct ? 'var(--green)' : 'var(--red)'}` }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 18, flexShrink: 0 }}>{r.is_correct ? '✅' : '❌'}</span>
                      <p style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>{r.question}</p>
                    </div>
                    {!r.is_correct && (
                      <div style={{ marginLeft: 26, marginBottom: 10 }}>
                        <p style={{ color: 'var(--red-light)', fontSize: 12, marginBottom: 4 }}>
                          Твой ответ: <strong>{r.your_answer}</strong>
                        </p>
                        <p style={{ color: 'var(--green-light)', fontSize: 12 }}>
                          Правильно: <strong>{r.correct_answer}</strong>
                        </p>
                      </div>
                    )}
                    {r.explanation && (
                      <div style={{ marginLeft: 26, background: 'rgba(255,255,255,.04)', borderRadius: 10, padding: '10px 12px' }}>
                        <p style={{ color: 'var(--violet)', fontSize: 11, fontWeight: 700, marginBottom: 4, textTransform: 'uppercase' }}>
                          💡 Объяснение
                        </p>
                        <p style={{ color: 'rgba(255,255,255,.7)', fontSize: 13, lineHeight: 1.6 }}>{r.explanation}</p>
                      </div>
                    )}
                  </div>
                ))}

                <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                  <button className="btn btn-primary" style={{ flex: 1 }}
                    onClick={() => { setResult(null); setAnswers({}) }}>
                    🔄 Пройти снова
                  </button>
                  <button className="btn btn-secondary" style={{ flex: 1 }}
                    onClick={() => { setActiveQuiz(null); setResult(null); setAnswers({}) }}>
                    📚 Все тесты
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
