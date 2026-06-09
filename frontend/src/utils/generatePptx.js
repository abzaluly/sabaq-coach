import PptxGenJS from 'pptxgenjs'

// Colour palette matching the app
const C = {
  bg:      '0F0A1E',
  card:    '1A1033',
  card2:   '221844',
  purple:  '7C3AED',
  purpleL: 'A78BFA',
  blue:    '4F46E5',
  blueL:   '60A5FA',
  white:   'FFFFFF',
  gray:    '9CA3AF',
  red:     'EF4444',
  amber:   'F59E0B',
  green:   '10B981',
  dark:    '2A1A50',
}

// ── helpers ────────────────────────────────────────────────────────────────

function blob(sld, x, y, w, h, color, transparency = 82) {
  sld.addShape(sld._slideRId ? PptxGenJS.ShapeType?.ellipse ?? 'ellipse' : 'ellipse', {
    x, y, w, h,
    fill: { color, transparency },
    line: { color, transparency },
  })
}

function rect(sld, x, y, w, h, color, alpha = 0) {
  sld.addShape('rect', {
    x, y, w, h,
    fill: { color, transparency: alpha },
    line: { color, transparency: alpha },
  })
}

function roundRect(sld, x, y, w, h, fillColor, strokeColor, radius = 0.1, fillAlpha = 0, strokeAlpha = 40) {
  sld.addShape('roundRect', {
    x, y, w, h,
    fill: { color: fillColor, transparency: fillAlpha },
    line: { color: strokeColor, transparency: strokeAlpha },
    rectRadius: radius,
  })
}

function txt(sld, text, x, y, w, h, opts = {}) {
  sld.addText(text, {
    x, y, w, h,
    fontFace: 'Calibri',
    color: C.white,
    valign: 'middle',
    wrap: true,
    ...opts,
  })
}

// ── Title slide ────────────────────────────────────────────────────────────

function slideTitlePage(prs, title, subtitle, interest, entities) {
  const sld = prs.addSlide()
  sld.background = { color: C.bg }

  // Decorative blobs
  sld.addShape('ellipse', { x: 7.5, y: -0.8, w: 3.2, h: 3.2, fill: { color: C.purple, transparency: 78 }, line: { color: C.purple, transparency: 78 } })
  sld.addShape('ellipse', { x: -0.6, y: 4.0, w: 2.4, h: 2.4, fill: { color: C.blue, transparency: 82 }, line: { color: C.blue, transparency: 82 } })

  // Top label bar centered
  txt(sld, 'ПЕРСОНАЛЬНЫЙ РАЗБОР ПРОБЕЛОВ', 0.5, 1.0, 9, 0.35, {
    fontSize: 11, bold: true, color: C.purpleL, charSpacing: 3, align: 'center',
  })
  // Underline centered
  rect(sld, 4.15, 1.38, 1.7, 0.06, C.purpleL)

  // Title — centered, adaptive size
  const titleFontSize = title.length > 60 ? 24 : title.length > 40 ? 28 : 34
  txt(sld, title, 0.5, 1.6, 9, 1.8, {
    fontSize: titleFontSize, bold: true, align: 'center', valign: 'middle',
  })

  // Subtitle centered
  txt(sld, subtitle, 0.5, 3.45, 9, 0.4, {
    fontSize: 13, color: C.gray, align: 'center',
  })

  // Entity tags — centered row
  const tags = (entities || []).slice(0, 4)
  if (tags.length > 0) {
    const tagW = 2.0
    const gap = 0.2
    const totalW = tags.length * tagW + (tags.length - 1) * gap
    const startX = (10 - totalW) / 2
    tags.forEach((tag, i) => {
      const tx = startX + i * (tagW + gap)
      sld.addShape('roundRect', {
        x: tx, y: 4.0, w: tagW, h: 0.36,
        fill: { color: C.purple, transparency: 60 },
        line: { color: C.purpleL, transparency: 35 },
        rectRadius: 0.1,
      })
      txt(sld, tag, tx, 4.0, tagW, 0.36, {
        fontSize: 10, color: C.purpleL, align: 'center',
      })
    })
  }
}

// ── Overview slide ─────────────────────────────────────────────────────────

function slideOverview(prs, slides, interest, style) {
  const sld = prs.addSlide()
  sld.background = { color: C.bg }

  sld.addShape('ellipse', { x: 7.5, y: -0.3, w: 2.2, h: 2.2, fill: { color: C.blue, transparency: 82 }, line: { color: C.blue, transparency: 82 } })

  txt(sld, 'СОДЕРЖАНИЕ', 0.5, 0.3, 9, 0.32, { fontSize: 10, bold: true, color: C.purpleL, charSpacing: 2, align: 'center' })
  txt(sld, 'Темы для проработки', 0.5, 0.64, 9, 0.55, { fontSize: 26, bold: true, align: 'center' })

  const badgeText = style ? `⭐ ${interest}  •  ${style}` : `⭐ ${interest}`
  const badgeW = 4.0
  sld.addShape('roundRect', { x: (10 - badgeW) / 2, y: 1.28, w: badgeW, h: 0.34, fill: { color: C.purple, transparency: 55 }, line: { color: C.purpleL, transparency: 30 }, rectRadius: 0.1 })
  txt(sld, badgeText, (10 - badgeW) / 2, 1.28, badgeW, 0.34, { fontSize: 10, color: C.purpleL, align: 'center' })

  const statusColor = { missing: C.red, incomplete: C.amber, concept: C.blueL }
  const statusLabel = { missing: '❌ Пропущена', incomplete: '⚠️ Не понята', concept: '💡 Концепция' }

  slides.forEach((s, i) => {
    const y = 1.88 + i * 0.54
    const col = statusColor[s.status_key] || C.purpleL

    sld.addShape('roundRect', { x: 0.5, y, w: 8.8, h: 0.44, fill: { color: C.card2, transparency: 0 }, line: { color: col, transparency: 55 }, rectRadius: 0.08 })
    txt(sld, `${i + 1}`, 0.6, y, 0.38, 0.44, { fontSize: 12, bold: true, color: col, align: 'center' })
    txt(sld, s.title, 1.05, y, 5.8, 0.44, { fontSize: 13 })
    txt(sld, statusLabel[s.status_key] || s.status || '', 6.9, y, 2.3, 0.44, { fontSize: 10, color: col, align: 'right' })
  })
}

// ── Topic slide ────────────────────────────────────────────────────────────

function slideTopic(prs, slide, num, total) {
  const sld = prs.addSlide()
  sld.background = { color: C.bg }

  const hasImage = !!slide.image_base64
  const M = 0.28
  const W = 10 - M * 2

  // ── Full-bleed background image ──────────────────────────────────────────
  if (hasImage) {
    try {
      sld.addImage({
        data: `image/${slide.image_ext || 'jpg'};base64,${slide.image_base64}`,
        x: 0, y: 0, w: 10, h: 5.63,
        sizing: { type: 'cover', w: 10, h: 5.63 },
      })
    } catch (_) {}
    // Dark gradient overlay so text stays readable
    sld.addShape('rect', {
      x: 0, y: 0, w: 10, h: 5.63,
      fill: { color: '08051A', transparency: 22 },
      line: { color: '08051A', transparency: 100 },
    })
  }

  // ── Header bar ───────────────────────────────────────────────────────────
  sld.addShape('rect', {
    x: 0, y: 0, w: 10, h: 1.06,
    fill: { color: hasImage ? '04020F' : C.card, transparency: hasImage ? 30 : 0 },
    line: { color: '000000', transparency: 100 },
  })
  rect(sld, 0, 0, 0.14, 1.06, C.purple)

  const statusColor = slide.status?.includes('пропущ') ? C.red : C.amber
  sld.addShape('roundRect', {
    x: M, y: 0.12, w: 2.1, h: 0.3,
    fill: { color: statusColor, transparency: 60 },
    line: { color: statusColor, transparency: 35 },
    rectRadius: 0.08,
  })
  txt(sld, slide.status || 'слабая тема', M, 0.12, 2.1, 0.3, {
    fontSize: 9, bold: true, color: statusColor, align: 'center',
  })
  txt(sld, `${num} / ${total}`, 8.4, 0.13, 1.5, 0.3, { fontSize: 10, color: C.gray, align: 'right' })
  txt(sld, slide.title, M, 0.48, W, 0.54, {
    fontSize: 20, bold: true, align: 'center', valign: 'middle',
  })

  // ── Two columns: Explanation (left 60%) + Key Facts infographic (right 40%) ──
  const colY = 1.14
  const colH = 2.38
  const gap  = 0.16
  const leftW  = 5.5
  const rightW = W - leftW - gap

  // Left: Explanation card
  sld.addShape('roundRect', {
    x: M, y: colY, w: leftW, h: colH,
    fill: { color: C.card2, transparency: hasImage ? 18 : 0 },
    line: { color: C.purple, transparency: 48 },
    rectRadius: 0.12,
  })
  txt(sld, '📖  Объяснение', M + 0.18, colY + 0.1, leftW - 0.36, 0.28, {
    fontSize: 10, bold: true, color: C.purpleL,
  })
  txt(sld, slide.explanation || '', M + 0.18, colY + 0.4, leftW - 0.36, colH - 0.52, {
    fontSize: 12, valign: 'top',
  })

  // Right: Key Facts as infographic (numbered cards)
  const kpX = M + leftW + gap
  sld.addShape('roundRect', {
    x: kpX, y: colY, w: rightW, h: colH,
    fill: { color: C.card2, transparency: hasImage ? 18 : 0 },
    line: { color: C.blue, transparency: 42 },
    rectRadius: 0.12,
  })
  txt(sld, '⚡  Ключевые факты', kpX + 0.15, colY + 0.1, rightW - 0.3, 0.28, {
    fontSize: 10, bold: true, color: C.blueL,
  })
  const factColors = [C.purple, C.blue, C.green]
  ;(slide.key_points || []).slice(0, 3).forEach((pt, i) => {
    const fy = colY + 0.44 + i * 0.62
    // Numbered circle
    sld.addShape('ellipse', {
      x: kpX + 0.14, y: fy + 0.04, w: 0.32, h: 0.32,
      fill: { color: factColors[i] || C.purple, transparency: 45 },
      line: { color: factColors[i] || C.purple, transparency: 20 },
    })
    txt(sld, `${i + 1}`, kpX + 0.14, fy + 0.04, 0.32, 0.32, {
      fontSize: 11, bold: true, color: C.white, align: 'center', valign: 'middle',
    })
    txt(sld, pt, kpX + 0.52, fy, rightW - 0.66, 0.4, {
      fontSize: 11, valign: 'middle',
    })
  })

  // ── Interest example (full width) ────────────────────────────────────────
  const exY = colY + colH + 0.12
  const exH = 0.94
  sld.addShape('roundRect', {
    x: M, y: exY, w: W, h: exH,
    fill: { color: C.dark, transparency: hasImage ? 18 : 0 },
    line: { color: C.purple, transparency: 30 },
    rectRadius: 0.12,
  })
  txt(sld, '⭐  Пример из твоих интересов', M + 0.18, exY + 0.08, W - 0.36, 0.26, {
    fontSize: 10, bold: true, color: C.purpleL,
  })
  txt(sld, slide.interest_example || '', M + 0.18, exY + 0.34, W - 0.36, exH - 0.42, {
    fontSize: 12, valign: 'top',
  })

  // ── Remember footer ──────────────────────────────────────────────────────
  if (slide.remember) {
    const remY = exY + exH + 0.1
    sld.addShape('roundRect', {
      x: M, y: remY, w: W, h: 0.4,
      fill: { color: C.green, transparency: 70 },
      line: { color: C.green, transparency: 38 },
      rectRadius: 0.08,
    })
    txt(sld, `💡  ${slide.remember}`, M + 0.18, remY, W - 0.36, 0.4, {
      fontSize: 12, bold: true, color: C.white, valign: 'middle',
    })
  }
}

// ── Final slide ────────────────────────────────────────────────────────────

function slideFinal(prs, interest, entities) {
  const sld = prs.addSlide()
  sld.background = { color: C.bg }

  sld.addShape('ellipse', { x: 3.5, y: 0.5, w: 3, h: 3, fill: { color: C.purple, transparency: 88 }, line: { color: C.purple, transparency: 88 } })

  txt(sld, '✅', 4.3, 0.9, 1.4, 1.2, { fontSize: 48, align: 'center', valign: 'top' })
  txt(sld, 'Продолжай в том же духе!', 1, 2.1, 8, 0.7, { fontSize: 28, bold: true, align: 'center' })
  txt(sld, `Используй примеры из ${interest} — это твой секретный инструмент запоминания`, 1.5, 2.85, 7, 0.55, { fontSize: 14, color: C.gray, align: 'center' })

  const tags = (entities || []).slice(0, 4)
  const tagW = 9 / Math.max(tags.length, 1)
  tags.forEach((t, i) => {
    sld.addShape('roundRect', { x: 0.5 + i * tagW, y: 3.58, w: tagW - 0.1, h: 0.34, fill: { color: C.purple, transparency: 65 }, line: { color: C.purpleL, transparency: 35 }, rectRadius: 0.1 })
    txt(sld, t, 0.5 + i * tagW, 3.58, tagW - 0.1, 0.34, { fontSize: 10, color: C.purpleL, align: 'center' })
  })

  sld.addShape('roundRect', { x: 2.5, y: 4.18, w: 5, h: 0.56, fill: { color: C.purple, transparency: 45 }, line: { color: C.purpleL, transparency: 20 }, rectRadius: 0.15 })
  txt(sld, '🤖 Сгенерировано Sabaq Coach', 2.5, 4.18, 5, 0.56, { fontSize: 13, color: C.purpleL, align: 'center' })
}

// ── Main export ────────────────────────────────────────────────────────────

export async function buildPptx(slidesData, interest, lectureTitle, entities = [], style = '') {
  const prs = new PptxGenJS()
  prs.layout  = 'LAYOUT_WIDE'
  prs.author  = 'Sabaq Coach'
  prs.title   = lectureTitle || 'Разбор слабых тем'
  prs.subject = 'Персональный разбор пробелов'

  const enriched = slidesData.map(s => ({
    ...s,
    status_key: s.status?.includes('пропущ') ? 'missing'
               : s.status?.includes('понят')  ? 'incomplete'
               : 'concept',
  }))

  slideTitlePage(prs, lectureTitle || 'Разбор слабых тем', `${style || interest} • ${entities.slice(0,3).join(', ')}`, interest, entities)
  slideOverview(prs, enriched, interest, style)
  enriched.forEach((s, i) => slideTopic(prs, s, i + 1, enriched.length))
  slideFinal(prs, interest, entities)

  const filename = `разбор_пробелов_${Date.now()}.pptx`
  await prs.writeFile({ fileName: filename })
  return filename
}
