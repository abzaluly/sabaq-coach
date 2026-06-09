import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

// Slide dimensions (px at 96dpi, 16:9)
const W = 1280
const H = 720

const C = {
  bg:     '#0F0A1E', card:  '#1A1033', card2: '#221844',
  purple: '#7C3AED', purpleL: '#A78BFA',
  blue:   '#4F46E5', blueL:   '#60A5FA',
  white:  '#FFFFFF', gray:  '#9CA3AF',
  red:    '#EF4444', amber: '#F59E0B', green: '#10B981',
  dark:   '#2A1A50',
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

const font = `font-family:system-ui,-apple-system,'Segoe UI',sans-serif`
const box  = `box-sizing:border-box`

function wrap(inner, bgImage) {
  const bg = bgImage
    ? `background:url('data:image/jpeg;base64,${bgImage}') center/cover no-repeat`
    : `background:${C.bg}`
  return `<div style="width:${W}px;height:${H}px;${bg};position:relative;overflow:hidden;${font};${box}">${inner}</div>`
}

// ── Title slide ───────────────────────────────────────────────────────────────

function htmlTitle(title, subtitle, entities) {
  const tagW = 200, tagGap = 12
  const total = entities.length * tagW + (entities.length - 1) * tagGap
  const tagStartX = (W - total) / 2

  return wrap(`
    <div style="position:absolute;top:-80px;right:60px;width:380px;height:380px;background:rgba(124,58,237,0.22);border-radius:50%"></div>
    <div style="position:absolute;bottom:-40px;left:-30px;width:260px;height:260px;background:rgba(79,70,229,0.18);border-radius:50%"></div>

    <div style="position:absolute;top:110px;left:0;right:0;text-align:center;color:${C.purpleL};font-size:13px;font-weight:700;letter-spacing:4px">
      ПЕРСОНАЛЬНЫЙ РАЗБОР ПРОБЕЛОВ
    </div>
    <div style="position:absolute;top:138px;left:50%;transform:translateX(-50%);width:190px;height:5px;background:${C.purpleL};border-radius:3px"></div>

    <div style="position:absolute;top:158px;left:60px;right:60px;text-align:center;color:${C.white};font-size:${title.length > 50 ? 34 : title.length > 30 ? 40 : 48}px;font-weight:800;line-height:1.2">
      ${title}
    </div>

    <div style="position:absolute;bottom:170px;left:0;right:0;text-align:center;color:${C.gray};font-size:16px">
      ${subtitle}
    </div>

    ${entities.slice(0, 4).map((tag, i) => `
      <div style="position:absolute;bottom:95px;left:${tagStartX + i * (tagW + tagGap)}px;width:${tagW}px;height:36px;
        background:rgba(124,58,237,0.35);border:1px solid rgba(167,139,250,0.6);border-radius:18px;
        display:flex;align-items:center;justify-content:center;color:${C.purpleL};font-size:13px">
        ${tag}
      </div>
    `).join('')}
  `)
}

// ── Overview slide ────────────────────────────────────────────────────────────

function htmlOverview(slides, interest, style) {
  const badge = style ? `⭐ ${interest} • ${style}` : `⭐ ${interest}`
  const statusColor = { missing: C.red, incomplete: C.amber, concept: C.blueL }
  const statusLabel = { missing: '❌ Пропущена', incomplete: '⚠️ Не понята', concept: '💡 Концепция' }
  const rowH = Math.min(54, (H - 250) / Math.max(slides.length, 1))

  return wrap(`
    <div style="position:absolute;top:-30px;right:-10px;width:250px;height:250px;background:rgba(79,70,229,0.18);border-radius:50%"></div>

    <div style="position:absolute;top:40px;left:0;right:0;text-align:center;color:${C.purpleL};font-size:12px;font-weight:700;letter-spacing:3px">СОДЕРЖАНИЕ</div>
    <div style="position:absolute;top:68px;left:0;right:0;text-align:center;color:${C.white};font-size:30px;font-weight:800">Темы для проработки</div>

    <div style="position:absolute;top:118px;left:50%;transform:translateX(-50%);
      background:rgba(124,58,237,0.4);border:1px solid rgba(167,139,250,0.5);border-radius:20px;
      padding:6px 24px;color:${C.purpleL};font-size:12px;white-space:nowrap">
      ${badge}
    </div>

    ${slides.map((s, i) => {
      const col = statusColor[s.status_key] || C.purpleL
      const y = 165 + i * (rowH + 8)
      return `
        <div style="position:absolute;top:${y}px;left:56px;right:56px;height:${rowH}px;
          background:${C.card2};border:1px solid ${col}55;border-radius:10px;
          display:flex;align-items:center;gap:14px;padding:0 18px">
          <span style="color:${col};font-size:15px;font-weight:800;flex-shrink:0">${i + 1}</span>
          <span style="color:${C.white};font-size:14px;flex:1">${s.title}</span>
          <span style="color:${col};font-size:11px;flex-shrink:0">${statusLabel[s.status_key] || s.status || ''}</span>
        </div>
      `
    }).join('')}
  `)
}

// ── Topic slide ───────────────────────────────────────────────────────────────

function htmlTopic(slide, num, total) {
  const hasImg   = !!slide.image_base64
  const statusC  = slide.status?.includes('пропущ') ? C.red : C.amber
  const factColC = [C.purple, C.blue, C.green]

  const M     = 36           // margin px
  const hdrH  = 108          // header height
  const colY  = hdrH + 10
  const colH  = 326
  const leftW = 700
  const rightW = W - M*2 - leftW - 20
  const exY   = colY + colH + 14
  const exH   = 154
  const remY  = exY + exH + 12

  const facts = (slide.key_points || []).slice(0, 3)
  const factStep = colH / 3.5

  return wrap(`
    ${hasImg ? `<div style="position:absolute;inset:0;background:rgba(7,4,15,0.84)"></div>` : ''}

    <!-- Header -->
    <div style="position:absolute;top:0;left:0;right:0;height:${hdrH}px;background:rgba(4,2,16,${hasImg ? 0.88 : 1})">
      <div style="position:absolute;top:0;left:0;width:8px;height:${hdrH}px;background:${C.purple}"></div>
      <div style="position:absolute;top:12px;left:${M}px;background:${statusC}44;border:1px solid ${statusC}99;border-radius:12px;padding:4px 16px;color:${statusC};font-size:11px;font-weight:700">${slide.status || 'слабая тема'}</div>
      <div style="position:absolute;top:14px;right:${M}px;color:${C.gray};font-size:12px">${num} / ${total}</div>
      <div style="position:absolute;bottom:12px;left:${M}px;right:${M}px;color:${C.white};font-size:22px;font-weight:800;text-align:center">${slide.title}</div>
    </div>

    <!-- Explanation -->
    <div style="position:absolute;top:${colY}px;left:${M}px;width:${leftW}px;height:${colH}px;
      background:${hasImg ? 'rgba(34,24,68,0.85)' : C.card2};border:1px solid rgba(124,58,237,0.5);border-radius:14px;padding:14px 18px;overflow:hidden">
      <div style="color:${C.purpleL};font-size:12px;font-weight:700;margin-bottom:10px">📖 Объяснение</div>
      <div style="color:${C.white};font-size:13px;line-height:1.6">${slide.explanation || ''}</div>
    </div>

    <!-- Key facts -->
    <div style="position:absolute;top:${colY}px;left:${M + leftW + 20}px;width:${rightW}px;height:${colH}px;
      background:${hasImg ? 'rgba(34,24,68,0.85)' : C.card2};border:1px solid rgba(79,70,229,0.5);border-radius:14px;padding:14px 16px;overflow:hidden">
      <div style="color:${C.blueL};font-size:12px;font-weight:700;margin-bottom:12px">⚡ Ключевые факты</div>
      ${facts.map((f, i) => `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:${factStep * 0.28}px">
          <div style="width:30px;height:30px;border-radius:50%;background:${factColC[i]}55;border:1px solid ${factColC[i]}aa;
            flex-shrink:0;display:flex;align-items:center;justify-content:center;color:${C.white};font-size:13px;font-weight:700">${i + 1}</div>
          <div style="color:${C.white};font-size:12px;line-height:1.45">${f}</div>
        </div>
      `).join('')}
    </div>

    <!-- Interest example -->
    <div style="position:absolute;top:${exY}px;left:${M}px;right:${M}px;height:${exH}px;
      background:${hasImg ? 'rgba(42,26,80,0.85)' : C.dark};border:1px solid rgba(124,58,237,0.35);border-radius:14px;padding:12px 18px;overflow:hidden">
      <div style="color:${C.purpleL};font-size:12px;font-weight:700;margin-bottom:8px">⭐ Пример из твоих интересов</div>
      <div style="color:${C.white};font-size:13px;line-height:1.55">${slide.interest_example || ''}</div>
    </div>

    <!-- Remember -->
    <div style="position:absolute;top:${remY}px;left:${M}px;right:${M}px;height:48px;
      background:rgba(16,185,129,0.28);border:1px solid rgba(16,185,129,0.55);border-radius:10px;
      display:flex;align-items:center;padding:0 18px">
      <span style="color:${C.white};font-size:13px;font-weight:700">💡 ${slide.remember || 'Запомни эту тему!'}</span>
    </div>
  `, hasImg ? slide.image_base64 : null)
}

// ── Final slide ───────────────────────────────────────────────────────────────

function htmlFinal(interest, entities) {
  const tagW = 190, tagGap = 10
  const total = Math.min(entities.length, 4) * tagW + (Math.min(entities.length, 4) - 1) * tagGap
  const tagStartX = (W - total) / 2

  return wrap(`
    <div style="position:absolute;top:50px;left:50%;transform:translateX(-50%);width:320px;height:320px;background:rgba(124,58,237,0.18);border-radius:50%"></div>

    <div style="position:absolute;top:110px;left:0;right:0;text-align:center;font-size:64px">✅</div>
    <div style="position:absolute;top:195px;left:0;right:0;text-align:center;color:${C.white};font-size:32px;font-weight:800">Продолжай в том же духе!</div>
    <div style="position:absolute;top:248px;left:100px;right:100px;text-align:center;color:${C.gray};font-size:16px;line-height:1.5">
      Используй примеры из ${interest} — это твой секретный инструмент запоминания
    </div>

    ${entities.slice(0, 4).map((tag, i) => `
      <div style="position:absolute;bottom:140px;left:${tagStartX + i * (tagW + tagGap)}px;width:${tagW}px;height:34px;
        background:rgba(124,58,237,0.35);border:1px solid rgba(167,139,250,0.55);border-radius:17px;
        display:flex;align-items:center;justify-content:center;color:${C.purpleL};font-size:12px">
        ${tag}
      </div>
    `).join('')}

    <div style="position:absolute;bottom:76px;left:50%;transform:translateX(-50%);width:380px;height:52px;
      background:rgba(124,58,237,0.4);border:1px solid rgba(167,139,250,0.5);border-radius:26px;
      display:flex;align-items:center;justify-content:center;color:${C.purpleL};font-size:15px;font-weight:700">
      🤖 Сгенерировано Sabaq Coach
    </div>
  `)
}

// ── Render HTML → canvas → PDF ────────────────────────────────────────────────

async function renderSlide(html) {
  const div = document.createElement('div')
  div.style.cssText = `position:fixed;top:-9999px;left:-9999px;width:${W}px;height:${H}px;z-index:-9999`
  div.innerHTML = html
  document.body.appendChild(div)
  try {
    const canvas = await html2canvas(div, {
      width: W, height: H, scale: 1,
      useCORS: true, logging: false,
      backgroundColor: C.bg,
    })
    return canvas
  } finally {
    document.body.removeChild(div)
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function buildPdf(slidesData, interest, lectureTitle, entities = [], style = '') {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'px', format: [W, H] })

  const enriched = slidesData.map(s => ({
    ...s,
    status_key: s.status?.includes('пропущ') ? 'missing'
               : s.status?.includes('понят')  ? 'incomplete'
               : 'concept',
  }))

  const subtitle = `${style || interest} • ${entities.slice(0, 3).join(', ')}`
  const allSlides = [
    htmlTitle(lectureTitle || 'Разбор слабых тем', subtitle, entities),
    htmlOverview(enriched, interest, style),
    ...enriched.map((s, i) => htmlTopic(s, i + 1, enriched.length)),
    htmlFinal(interest, entities),
  ]

  for (let i = 0; i < allSlides.length; i++) {
    if (i > 0) doc.addPage()
    const canvas = await renderSlide(allSlides[i])
    const imgData = canvas.toDataURL('image/jpeg', 0.92)
    doc.addImage(imgData, 'JPEG', 0, 0, W, H)
  }

  const filename = `разбор_пробелов_${Date.now()}.pdf`
  doc.save(filename)
  return filename
}
