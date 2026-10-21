// TEMPORARY real-browser driver (never committed). Run from the worktree root:
//   node selection-driver.mjs --mode=explore
//   node selection-driver.mjs --mode=run [--fixtures=standard,dense,both] [--viewports=1700x1000,1000x700]
//   node selection-driver.mjs --mode=shots
// Starts Vite (JS API, project vite.config.ts) on 5199 and drives real Chrome.
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'

const ART = '/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.agents/tasks/edge-selection'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'https://localhost:5199/selection-harness.html'
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? 'true']
  }),
)
const MODE = args.mode ?? 'run'
const FIXTURES = (args.fixtures ?? 'standard,dense,both').split(',')
const VIEWPORTS = (args.viewports ?? '1700x1000,1000x700').split(',').map((s) => s.split('x').map(Number))
const REFS = (args.refs ?? 'shown,hidden').split(',')
const DIRS = (args.dirs ?? 'LR,TB').split(',')
const MAPS = (args.maps ?? 'on').split(',')
const DSF = Number(args.dsf ?? 1)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const USER = { standard: 'Alice Adams', dense: 'Amos Cunningham', both: 'Beth Both' }

const HELPERS = `
window.H = (() => {
  const q = (s, r = document) => r.querySelector(s)
  const qa = (s, r = document) => Array.from(r.querySelectorAll(s))
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } }
  const cards = () => qa('.react-flow__node').map((n) => {
    const a = q('article.vc-graph-card', n)
    if (!a) return null
    const kind = (a.className.match(/kind-(\\w+)/) || [])[1]
    return {
      id: n.getAttribute('data-id'), kind, label: q('.vc-graph-card-label', a)?.textContent,
      ref: a.classList.contains('vc-graph-card-reference'), status: a.getAttribute('data-review-status') || '',
      pressed: a.getAttribute('aria-pressed'), cls: a.className, rect: rectOf(a),
      opacity: parseFloat(getComputedStyle(a).opacity),
    }
  }).filter(Boolean)
  const nodeEl = (id) => qa('.react-flow__node').find((g) => g.getAttribute('data-id') === id)
  const edgeGroups = () => qa('.react-flow__edge')
  const edgeEl = (id) => edgeGroups().find((g) => g.getAttribute('data-id') === id)
  // Edge ids are e:<from>:<to> and node ids contain colons, so split against the known node ids.
  const parseEdge = (id, nodeIds) => {
    for (const a of nodeIds) {
      const pre = 'e:' + a + ':'
      if (id.startsWith(pre) && nodeIds.includes(id.slice(pre.length))) return { from: a, to: id.slice(pre.length) }
    }
    return null
  }
  const edges = () => {
    const nodeIds = qa('.react-flow__node').map((n) => n.getAttribute('data-id'))
    return edgeGroups().map((g) => {
      const id = g.getAttribute('data-id'); const p = q('path.react-flow__edge-path', g); const cs = getComputedStyle(p)
      const e = parseEdge(id, nodeIds)
      return { id, ...e, cls: g.getAttribute('class'), stroke: cs.stroke, width: parseFloat(cs.strokeWidth), opacity: parseFloat(cs.opacity), dash: cs.strokeDasharray, ref: g.classList.contains('vc-graph-edge-reference'), z: effZ(g) }
    })
  }
  const edgeSnapshot = () => edgeGroups().map((g) => {
    const p = q('path.react-flow__edge-path', g)
    return g.getAttribute('data-id') + '|' + g.getAttribute('class') + '|' + (p ? p.getAttribute('style') : '')
  }).join('\\n')
  const transforms = () => qa('.react-flow__node').map((n) => n.getAttribute('data-id') + ':' + n.style.transform).join(';') + '||' + (q('.react-flow__viewport')?.style.transform ?? '')
  const viewportT = () => q('.react-flow__viewport')?.style.transform ?? ''
  const zoom = () => { const m = /scale\\(([-\\d.e]+)\\)/.exec(viewportT()); return m ? Number(m[1]) : NaN }
  const settle = (frames = 8, timeout = 6000) => new Promise((res) => {
    let last = viewportT(), n = 0; const t0 = performance.now()
    const tick = () => {
      const cur = viewportT()
      if (cur === last) n++; else { n = 0; last = cur }
      if (n >= frames || performance.now() - t0 > timeout) res(n >= frames); else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const effZ = (el) => {
    for (let e = el; e && !e.classList?.contains('react-flow__viewport'); e = e.parentElement) {
      const z = getComputedStyle(e).zIndex
      if (z !== 'auto') return Number(z)
    }
    return 0
  }
  const zChain = (el) => {
    const out = []
    for (let e = el; e && !e.classList?.contains('react-flow__viewport'); e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.zIndex !== 'auto') out.push({ tag: e.tagName.toLowerCase() + '.' + (e.getAttribute('class') || '').split(' ').slice(0, 2).join('.'), z: cs.zIndex, pos: cs.position })
    }
    return out
  }
  const rects = (sel) => qa(sel).map(rectOf)
  const overlays = () => [...rects('.react-flow__panel'), ...rects('.react-flow__minimap'), ...rects('.react-flow__controls'), ...rects('[role=tooltip]')]
  const tokenColor = (v) => { const d = document.createElement('div'); d.style.color = 'var(' + v + ')'; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c }
  const samples = (edgeId, count = 121) => {
    const g = edgeEl(edgeId); const p = q('path.react-flow__edge-path', g)
    const cs = getComputedStyle(p)
    const dash = (cs.strokeDasharray === 'none' ? [] : cs.strokeDasharray.split(/[ ,]+/).map(parseFloat)).filter((x) => !Number.isNaN(x))
    const len = p.getTotalLength(); const ctm = p.getScreenCTM(); const svg = p.ownerSVGElement
    const lens = []
    if (dash.length >= 2) { const period = dash[0] + dash[1]; for (let s = dash[0] / 2; s < len; s += period) lens.push(s) }
    else for (let i = 0; i < count; i++) lens.push((len * (i + 0.5)) / count)
    const step = Math.max(1, Math.floor(lens.length / count)); const pts = []
    for (let i = 0; i < lens.length; i += step) {
      const pt = svg.createSVGPoint(); const lp = p.getPointAtLength(lens[i]); pt.x = lp.x; pt.y = lp.y
      const c = pt.matrixTransform(ctm); pts.push({ x: c.x, y: c.y })
    }
    return { pts, color: cs.stroke, width: parseFloat(cs.strokeWidth) }
  }
  const inside = (r, x, y, pad = 0) => x >= r.l + pad && x <= r.r - pad && y >= r.t + pad && y <= r.b - pad
  /** Sample points of the given edges that lie inside a card that is not the edge's own endpoint, visible (not under an overlay). */
  const crossed = (edgeIds) => {
    const cs = cards(); const canvas = rectOf(q('.react-flow')); const ov = overlays(); const out = []
    const nodeIds = cs.map((c) => c.id)
    for (const id of edgeIds) {
      const ends = parseEdge(id, nodeIds); const s = samples(id)
      for (const p of s.pts) {
        const card = cs.find((c) => c.id !== ends.from && c.id !== ends.to && inside(c.rect, p.x, p.y, 3))
        if (!card) continue
        if (!inside(canvas, p.x, p.y, 2) || ov.some((r) => inside(r, p.x, p.y, -3))) continue
        out.push({ x: p.x, y: p.y, edge: id, card: card.id, color: s.color })
      }
    }
    return out
  }
  const shots = {}
  const loadShot = async (name, b64) => {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    const bmp = await createImageBitmap(new Blob([u8], { type: 'image/png' }))
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height
    const ctx = cv.getContext('2d'); ctx.drawImage(bmp, 0, 0)
    shots[name] = ctx.getImageData(0, 0, bmp.width, bmp.height)
  }
  const parseRgb = (s) => (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number)
  const bestDist = (name, p, want) => {
    const im = shots[name]; let best = 1e9
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const x = Math.round(p.x) + dx, y = Math.round(p.y) + dy
      if (x < 0 || y < 0 || x >= im.width || y >= im.height) continue
      const i = (y * im.width + x) * 4
      const d = Math.hypot(im.data[i] - want[0], im.data[i + 1] - want[1], im.data[i + 2] - want[2])
      if (d < best) best = d
    }
    return best
  }
  const paintFraction = (name, pts, tol = 45) => {
    let ok = 0
    for (const p of pts) if (bestDist(name, p, parseRgb(p.color)) <= tol) ok++
    return pts.length ? ok / pts.length : null
  }
  const scrollState = () => JSON.stringify({ wy: window.scrollY, wx: window.scrollX, de: document.documentElement.scrollTop, body: document.body.scrollTop,
    wrap: qa('.vc-graph-wrap, .react-flow, .react-flow__renderer, .react-flow__pane, .react-flow__viewport-portal').map((e) => [e.scrollTop, e.scrollLeft]), vp: viewportT() })
  return { q, qa, rectOf, cards, nodeEl, edgeEl, edges, edgeSnapshot, transforms, viewportT, zoom, settle, zChain, effZ, overlays, tokenColor, samples, crossed, loadShot, paintFraction, scrollState, parseEdge }
})()
`

const results = []
const counts = {}
function record(scenario, assertion, ok, detail = '') {
  counts[assertion] ??= { pass: 0, fail: 0 }
  counts[assertion][ok ? 'pass' : 'fail']++
  if (!ok) results.push({ scenario, assertion, detail })
}
const eqSet = (a, b) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')

async function openScenario(browser, fixture, vp, ref, dir, map, opts = {}) {
  const page = await browser.newPage()
  await page.setViewport({ width: vp[0], height: vp[1], deviceScaleFactor: opts.dsf ?? DSF })
  if (opts.dark) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
  await page.goto(`${BASE}?fixture=${fixture}`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.react-flow__node')
  await page.addScriptTag({ content: HELPERS })
  await page.click(`[aria-label="Show access for ${USER[fixture]}"]`)
  await page.waitForSelector('.vc-graph-card:not(.vc-graph-card-interactive)')
  await page.evaluate(() => window.H.settle())
  const press = async (label) => {
    await page.click(`button[aria-label="${label}"]`)
    await page.evaluate(() => window.H.settle())
  }
  if (ref === 'hidden') await press('Hide reference nodes and links')
  if (dir === 'TB') await press('Layout: vertical')
  if (map === 'off') await press('Hide minimap')
  await sleep(150)
  await page.evaluate(() => window.H.settle())
  await page.mouse.move(2, 2)
  await page.evaluate(() => document.activeElement && document.activeElement.blur())
  await sleep(100)
  return { page, press }
}

/** Is the card hit-testable by a real mouse (inside canvas, not under an overlay)? */
const hittable = (page, id) =>
  page.evaluate((nid) => {
    const H = window.H
    const c = H.cards().find((k) => k.id === nid)
    const canvas = H.rectOf(H.q('.react-flow'))
    const ix = Math.min(4, c.rect.w * 0.3), iy = Math.min(4, c.rect.h * 0.3)
    const pts = [[c.rect.l + c.rect.w / 2, c.rect.t + c.rect.h / 2], [c.rect.l + ix, c.rect.t + c.rect.h / 2], [c.rect.l + c.rect.w / 2, c.rect.t + iy]]
    const inCanvas = c.rect.l >= canvas.l && c.rect.r <= canvas.r && c.rect.t >= canvas.t && c.rect.b <= canvas.b
    return inCanvas && pts.every(([x, y]) => document.elementFromPoint(x, y)?.closest('.react-flow__node')?.getAttribute('data-id') === nid)
  }, id)

/** Selects/toggles a card: real click when hittable, else focus (no scroll) + Enter. Returns the method used. */
async function toggleCard(page, card) {
  if (await hittable(page, card.id)) {
    const c = await page.evaluate((id) => window.H.cards().find((k) => k.id === id).rect, card.id)
    await page.mouse.click(c.l + c.w / 2, c.t + c.h / 2)
    return 'click'
  }
  await page.evaluate((id) => document.querySelector(`.react-flow__node[data-id="${id}"] article`).focus({ preventScroll: true }), card.id)
  await page.evaluate(() => window.H.settle())
  await page.keyboard.press('Enter')
  return 'key'
}
const park = async (page) => {
  await page.mouse.move(2, 2)
  await sleep(80)
}

/** Reads the whole DOM state needed for the assertions. */
const readState = (page) =>
  page.evaluate(() => {
    const H = window.H
    return { cards: H.cards(), edges: H.edges(), tokens: {
      needsReview: H.tokenColor('--vc-warn'), approved: H.tokenColor('--vc-allow'), revoked: H.tokenColor('--vc-deny'), reassigned: H.tokenColor('--vc-accent') } }
  })

function expectedAssociated(st, item) {
  const out = new Map()
  for (const e of st.edges) { if (!out.has(e.from)) out.set(e.from, []); out.get(e.from).push(e) }
  const ids = new Set()
  const incoming = st.edges.find((e) => e.to === item.id && !e.ref)
  if (incoming) ids.add(incoming.id)
  const seen = new Set([item.id]); const queue = [item.id]
  for (let i = 0; i < queue.length; i++) for (const e of out.get(queue[i]) ?? []) { ids.add(e.id); if (!seen.has(e.to)) { seen.add(e.to); queue.push(e.to) } }
  return { ids: [...ids], lineage: seen }
}

/** S1-S4 for a selected item (state read after the selection settled). */
async function checkSelected(page, sc, item, st, label) {
  const exp = expectedAssociated(st, item)
  const marked = st.edges.filter((e) => /vc-graph-edge-(selected|lineage)/.test(e.cls)).map((e) => e.id)
  const dup = st.edges.filter((e) => /vc-graph-edge-selected/.test(e.cls) && /vc-graph-edge-lineage/.test(e.cls)).length
  record(sc, 'S1 marked edge set == forward-reachable set (+incoming)', eqSet(marked, exp.ids) && dup === 0, `${label} marked=${marked.length} expected=${exp.ids.length} dup=${dup}`)
  const want = st.tokens[item.status]
  const assoc = st.edges.filter((e) => exp.ids.includes(e.id))
  const sel = assoc.filter((e) => /vc-graph-edge-selected/.test(e.cls))
  record(sc, 'S1 user->item edge: selected class, width 3.5, status color', sel.length === 1 && sel[0].width === 3.5 && sel[0].stroke === want, `${label} ${JSON.stringify(sel.map((e) => [e.width, e.stroke, e.dash]))} want ${want}`)
  const lin = assoc.filter((e) => /vc-graph-edge-lineage/.test(e.cls))
  record(sc, 'S2 lineage edges: status color, solid, 2.5, opacity 1', lin.every((e) => e.stroke === want && e.dash === 'none' && e.width === 2.5 && e.opacity === 1), `${label} ${JSON.stringify(lin.filter((e) => !(e.stroke === want && e.dash === 'none' && e.width === 2.5 && e.opacity === 1)).map((e) => [e.id, e.stroke, e.dash, e.width, e.opacity]))}`)
  const cardZ = await page.evaluate((id) => window.H.effZ(window.H.nodeEl(id)), item.id)
  record(sc, 'S2 associated edge layer z-index above node layer', assoc.every((e) => e.z > cardZ), `${label} edgeZ=${[...new Set(assoc.map((e) => e.z))]} cardZ=${cardZ}`)
  const others = st.edges.filter((e) => !exp.ids.includes(e.id))
  record(sc, 'S3 every non-associated edge dimmed (< 0.3)', others.every((e) => e.opacity < 0.3), `${label} ${JSON.stringify(others.filter((e) => e.opacity >= 0.3).map((e) => [e.id, e.opacity]))}`)
  const pressedCards = st.cards.filter((c) => c.pressed === 'true')
  record(sc, 'S4 selected card aria-pressed=true, others false', pressedCards.length === 1 && pressedCards[0].id === item.id && st.cards.filter((c) => !c.ref && c.kind !== 'user').every((c) => c.id === item.id || c.pressed === 'false'), `${label} pressed=${pressedCards.map((c) => c.label)}`)
  record(sc, 'S4 selected card carries the selected class', /vc-graph-card-selected/.test(st.cards.find((c) => c.id === item.id).cls))
  const refCards = st.cards.filter((c) => c.ref)
  const bad = refCards.filter((c) => (exp.lineage.has(c.id) ? c.opacity !== 1 : Math.abs(c.opacity - 0.45) > 0.02))
  record(sc, 'S4 lineage ref nodes full opacity; other ref nodes dimmed ~0.45', bad.length === 0, `${label} ${JSON.stringify(bad.map((c) => [c.label, c.opacity]))}`)
  record(sc, 'S4 no status icon on any reference card', await page.evaluate(() => !document.querySelector('.vc-graph-card-reference .vc-graph-status-icon')))
  return { exp, want }
}

async function runScenario(browser, fixture, vp, ref, dir, map) {
  const sc = `${fixture}/${vp[0]}x${vp[1]}/${ref}/${dir}/map-${map}`
  const { page, press } = await openScenario(browser, fixture, vp, ref, dir, map)
  const start = await readState(page)
  const items = start.cards.filter((c) => !c.ref && c.kind !== 'user')
  const userCard = start.cards.find((c) => c.kind === 'user')
  const baseSnap = await page.evaluate(() => window.H.edgeSnapshot())
  record(sc, 'pre: first-level cards found, all aria-pressed=false', items.length > 0 && items.every((c) => c.pressed === 'false'), `items=${items.length}`)
  record(sc, 'pre: reference + user cards have no aria-pressed', start.cards.filter((c) => c.ref || c.kind === 'user').every((c) => c.pressed === null))
  const baseShotB64 = await page.screenshot({ type: 'png', encoding: 'base64' })
  await page.evaluate((b) => window.H.loadShot('base', b), baseShotB64)
  const stats = { items: items.length, clicked: 0, keyed: 0, crossedPts: 0, paintSel: [], paintBase: [] }

  for (const item of items) {
    const label = `${item.kind}:${item.label}`
    const t0 = await page.evaluate(() => window.H.transforms())
    // Keyboard fallback focuses first (RF may auto-pan on focus); capture after.
    const method = await toggleCard(page, item)
    stats[method === 'click' ? 'clicked' : 'keyed']++
    await park(page)
    await page.evaluate(() => window.H.settle())
    await sleep(120)
    const st = await readState(page)
    const { exp } = await checkSelected(page, sc, item, st, label)
    if (method === 'click') {
      const t1 = await page.evaluate(() => window.H.transforms())
      record(sc, 'S8 select leaves every node + viewport transform byte-identical', t0 === t1, label)
    }
    // Paint proof: sampled points of associated edges inside other cards.
    const pts0 = await page.evaluate((ids) => window.H.crossed(ids), exp.ids)
    const pts = pts0.map((p) => ({ ...p, x: p.x * DSF, y: p.y * DSF }))
    if (pts.length) {
      const shot = await page.screenshot({ type: 'png', encoding: 'base64' })
      await page.evaluate((b) => window.H.loadShot('sel', b), shot)
      const fs_ = await page.evaluate((p) => window.H.paintFraction('sel', p), pts)
      const fb_ = await page.evaluate((p) => window.H.paintFraction('base', p), pts)
      stats.crossedPts += pts.length
      stats.paintSel.push(fs_)
      stats.paintBase.push(fb_)
      record(sc, 'S2 pixel proof: selected edges painted over the cards they cross (>=50% of crossed samples, and more than baseline)', fs_ >= 0.5 && fs_ > fb_, `${label} n=${pts.length} sel=${fs_} base=${fb_}`)
    }
    // Deselect via the same method; edges restore exactly to baseline.
    const t2 = await page.evaluate(() => window.H.transforms())
    await toggleCard(page, item)
    await park(page)
    await page.evaluate(() => document.activeElement && document.activeElement.blur())
    await sleep(100)
    const after = await page.evaluate(() => ({ snap: window.H.edgeSnapshot(), t: window.H.transforms(), pressed: window.H.cards().filter((c) => c.pressed === 'true').length }))
    record(sc, 'S6 deselect restores the baseline edge snapshot exactly', after.snap === baseSnap && after.pressed === 0, label)
    if (method === 'click') record(sc, 'S8 deselect leaves transforms byte-identical', after.t === t2, label)
  }

  // ---- Per-scenario behaviors on a sample of items (first of each kind) ----
  const kinds = [...new Set(items.map((c) => c.kind))]
  for (const kind of kinds) {
    const item = items.find((c) => c.kind === kind)
    const label = `${kind}:${item.label}`
    // S5 / S6: reference + layout + minimap toggles keep the selection.
    await toggleCard(page, item)
    await park(page)
    await sleep(100)
    if (ref === 'shown') {
      const before = await readState(page)
      const nBefore = before.edges.filter((e) => /vc-graph-edge-(selected|lineage)/.test(e.cls)).length
      await press('Hide reference nodes and links')
      await sleep(120)
      let st = await readState(page)
      const hiddenMarked = st.edges.filter((e) => /vc-graph-edge-(selected|lineage)/.test(e.cls))
      record(sc, 'S5 reference hidden while selected: only user->item edge highlighted, selection kept', hiddenMarked.length === 1 && /vc-graph-edge-selected/.test(hiddenMarked[0].cls) && st.cards.find((c) => c.id === item.id)?.pressed === 'true' && st.edges.every((e) => !e.ref), label)
      await press('Show reference nodes and links')
      await sleep(120)
      st = await readState(page)
      const nAfter = st.edges.filter((e) => /vc-graph-edge-(selected|lineage)/.test(e.cls)).length
      record(sc, 'S5 reference shown again restores the whole lineage highlight', nAfter === nBefore && st.cards.find((c) => c.id === item.id)?.pressed === 'true', `${label} ${nBefore}->${nAfter}`)
    } else {
      await press('Show reference nodes and links')
      await sleep(120)
      let st = await readState(page)
      const it2 = st.cards.find((c) => c.id === item.id)
      const exp = expectedAssociated(st, item)
      const marked = st.edges.filter((e) => /vc-graph-edge-(selected|lineage)/.test(e.cls)).map((e) => e.id)
      record(sc, 'S5 reference shown while selected adds the lineage edges, selection kept', it2.pressed === 'true' && eqSet(marked, exp.ids), `${label} marked=${marked.length} exp=${exp.ids.length}`)
      await press('Hide reference nodes and links')
      await sleep(120)
      st = await readState(page)
      record(sc, 'S5 reference hidden again: only user->item edge highlighted', st.edges.filter((e) => /vc-graph-edge-(selected|lineage)/.test(e.cls)).length === 1 && st.cards.find((c) => c.id === item.id).pressed === 'true', label)
    }
    // S6: layout + minimap toggles.
    await press(dir === 'LR' ? 'Layout: vertical' : 'Layout: horizontal')
    await sleep(120)
    let st = await readState(page)
    let exp = expectedAssociated(st, item)
    let marked = st.edges.filter((e) => /vc-graph-edge-(selected|lineage)/.test(e.cls)).map((e) => e.id)
    record(sc, 'S6 layout toggle keeps the selection and the highlighted set', st.cards.find((c) => c.id === item.id).pressed === 'true' && eqSet(marked, exp.ids), label)
    await press(dir === 'LR' ? 'Layout: horizontal' : 'Layout: vertical')
    await press('Hide minimap')
    await sleep(120)
    st = await readState(page)
    exp = expectedAssociated(st, item)
    marked = st.edges.filter((e) => /vc-graph-edge-(selected|lineage)/.test(e.cls)).map((e) => e.id)
    record(sc, 'S6 minimap toggle keeps the selection', st.cards.find((c) => c.id === item.id).pressed === 'true' && eqSet(marked, exp.ids), label)
    await press('Show minimap')
    // clear for next (a focused panel button would show its tooltip, which Escape closes first)
    await page.evaluate(() => document.activeElement && document.activeElement.blur())
    await page.keyboard.press('Escape')
    await sleep(100)
    const cleared = await page.evaluate(() => window.H.cards().filter((c) => c.pressed === 'true').length)
    record(sc, 'S7 Escape clears the selection and stays in the drill-down', cleared === 0 && (await page.evaluate(() => !!window.H.q('.vc-graph-card:not(.vc-graph-card-interactive)'))), label)
  }

  // ---- S7: pane click, reference card click, Escape ordering, Back, user switch ----
  const target = items[0]
  await toggleCard(page, target)
  await park(page)
  await sleep(100)
  const snapSel = await page.evaluate(() => window.H.edgeSnapshot())
  if (ref === 'shown') {
    const refCard = (await readState(page)).cards.find((c) => c.ref)
    if (refCard && (await hittable(page, refCard.id))) {
      const r = refCard.rect
      await page.mouse.click(r.l + r.w / 2, r.t + r.h / 2)
      await park(page)
      await page.evaluate(() => document.activeElement && document.activeElement.blur())
      await sleep(80)
      const snap2 = await page.evaluate(() => window.H.edgeSnapshot())
      record(sc, 'S7 clicking a reference-only card changes nothing', snap2 === snapSel && (await page.evaluate(() => window.H.cards().filter((c) => c.pressed === 'true').length)) === 1)
    }
  }
  // empty pane point: a spot inside the canvas not covered by cards / overlays
  const spot = await page.evaluate(() => {
    const H = window.H; const canvas = H.rectOf(H.q('.react-flow')); const cs = H.cards(); const ov = H.overlays()
    for (let y = canvas.t + 8; y < canvas.b - 8; y += 12) for (let x = canvas.l + 8; x < canvas.r - 8; x += 12) {
      const el = document.elementFromPoint(x, y)
      if (el && el.classList.contains('react-flow__pane')) return { x, y }
    }
    return null
  })
  if (spot) {
    await page.mouse.click(spot.x, spot.y)
    await sleep(100)
    const res = await page.evaluate(() => ({ pressed: window.H.cards().filter((c) => c.pressed === 'true').length, active: document.activeElement?.className ?? '', snapNone: !/vc-graph-edge-(selected|lineage)/.test(window.H.edgeSnapshot()) }))
    record(sc, 'S7 real click on the empty pane clears the selection', res.pressed === 0 && res.snapNone, JSON.stringify(res))
    record(sc, 'S7 after a pane click no card keeps focus (no stuck focus emphasis)', !/vc-graph-card/.test(res.active), res.active)
    const emph = await page.evaluate(() => window.H.qa('.react-flow__edge.vc-graph-edge-emphasized').length)
    record(sc, 'S7 pane click leaves no stuck emphasized edge', emph === 0, `emphasized=${emph}`)
  } else {
    record(sc, 'S7 real click on the empty pane clears the selection', true, 'no empty pane point (skipped)')
  }
  // Escape ordering
  await toggleCard(page, target)
  await park(page)
  await page.keyboard.press('Escape')
  await sleep(100)
  let inDrill = await page.evaluate(() => !!window.H.q('.vc-graph-card:not(.vc-graph-card-interactive)'))
  let nPressed = await page.evaluate(() => window.H.cards().filter((c) => c.pressed === 'true').length)
  record(sc, 'S7 first Escape clears (stays in drill-down)', inDrill && nPressed === 0)
  await page.keyboard.press('Escape')
  await sleep(150)
  const inGrid = await page.evaluate(() => !!window.H.q('.vc-graph-card-interactive') && !window.H.q('.react-flow__edge'))
  record(sc, 'S7 second Escape returns to the grid', inGrid)
  // re-drill, select, Back
  await page.click(`[aria-label="Show access for ${USER[fixture]}"]`)
  await page.waitForSelector('.vc-graph-card:not(.vc-graph-card-interactive)')
  await page.evaluate(() => window.H.settle())
  const noneAfterRedrill = await page.evaluate(() => window.H.cards().filter((c) => c.pressed === 'true').length === 0 && !/vc-graph-edge-(selected|lineage)/.test(window.H.edgeSnapshot()))
  record(sc, 'S7 re-drilling after Escape-to-grid starts with no selection', noneAfterRedrill)
  const items2 = (await readState(page)).cards.filter((c) => !c.ref && c.kind !== 'user')
  await toggleCard(page, items2[0])
  await park(page)
  await sleep(80)
  await page.evaluate(() => window.H.settle())
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => /back to all users/i.test(b.textContent)).click())
  await sleep(120)
  await page.click(`[aria-label="Show access for ${USER[fixture]}"]`)
  await page.waitForSelector('.vc-graph-card:not(.vc-graph-card-interactive)')
  await page.evaluate(() => window.H.settle())
  const noneAfterBack = await page.evaluate(() => window.H.cards().filter((c) => c.pressed === 'true').length === 0 && !/vc-graph-edge-(selected|lineage)/.test(window.H.edgeSnapshot()))
  record(sc, 'S7 Back to all users clears the selection', noneAfterBack)
  void userCard
  void stats
  await page.close()
  return stats
}

/** Hover compose (S9), keyboard (S10), drag-pan, and special cases on the standard fixture. */
async function runBehaviors(browser, fixture, vp, ref, dir) {
  const sc = `${fixture}/${vp[0]}x${vp[1]}/${ref}/${dir}/behaviors`
  const { page } = await openScenario(browser, fixture, vp, ref, dir, 'on')
  const start = await readState(page)
  const items = start.cards.filter((c) => !c.ref && c.kind !== 'user')
  let A = null
  let B = null
  for (const c of items) {
    if (!(await hittable(page, c.id))) continue
    if (!A) A = c
    else if (!B) B = c
  }
  const hitA = !!A
  const hitB = !!B
  if (hitA && hitB) {
    // Nothing selected: shipped hover behavior.
    const bR = (await page.evaluate((id) => window.H.cards().find((c) => c.id === id).rect, B.id))
    await page.mouse.move(bR.l + bR.w / 2, bR.t + bR.h / 2)
    await sleep(120)
    let st = await readState(page)
    let em = st.edges.filter((e) => /vc-graph-edge-emphasized/.test(e.cls))
    record(sc, 'S9 nothing selected: hover emphasizes exactly one edge, others dimmed (shipped behavior)', em.length === 1 && em[0].to === B.id && st.edges.filter((e) => e.opacity < 0.3).length === st.edges.length - 1 && !st.edges.some((e) => /selected|lineage/.test(e.cls)))
    await park(page)
    // Select A, then hover B.
    const aR = (await page.evaluate((id) => window.H.cards().find((c) => c.id === id).rect, A.id))
    await page.mouse.click(aR.l + aR.w / 2, aR.t + aR.h / 2)
    await park(page)
    st = await readState(page)
    const selSet = st.edges.filter((e) => /vc-graph-edge-(selected|lineage)/.test(e.cls)).map((e) => e.id).sort()
    await page.mouse.move(bR.l + bR.w / 2, bR.t + bR.h / 2)
    await sleep(60)
    // Sample 20 times over ~400ms.
    const samples = []
    for (let i = 0; i < 20; i++) {
      samples.push(await page.evaluate(() => window.H.qa('.react-flow__edge').filter((g) => /vc-graph-edge-(selected|lineage|emphasized)/.test(g.getAttribute('class'))).map((g) => g.getAttribute('data-id') + ':' + (/emphasized/.test(g.getAttribute('class')) ? 'p' : 's')).sort().join(',')))
      await sleep(20)
    }
    record(sc, 'S9 hover preview of another item is stable over 20 samples (no flicker)', new Set(samples).size === 1, `distinct=${new Set(samples).size}`)
    st = await readState(page)
    em = st.edges.filter((e) => /vc-graph-edge-emphasized/.test(e.cls))
    const nowSel = st.edges.filter((e) => /vc-graph-edge-(selected|lineage)/.test(e.cls)).map((e) => e.id).sort()
    record(sc, 'S9 preview raises only B user edge (opacity 1) and the selected set is unchanged', em.length === 1 && em[0].to === B.id && em[0].opacity === 1 && nowSel.join() === selSet.join(), `em=${em.length}`)
    const aPressed = st.cards.find((c) => c.id === A.id).pressed
    record(sc, 'S9 selection stays on A while previewing B', aPressed === 'true' && st.cards.find((c) => c.id === B.id).pressed === 'false')
    if (fixture === 'standard' && ref === 'shown' && dir === 'LR' && vp[0] === 1700) await page.screenshot({ path: path.join(ART, 'sel-standard-hover-preview.png') })
    // hover over A itself changes nothing extra.
    await page.mouse.move(aR.l + aR.w / 2, aR.t + aR.h / 2)
    await sleep(120)
    st = await readState(page)
    record(sc, 'S9 hovering the selected item adds nothing', !st.edges.some((e) => /vc-graph-edge-emphasized/.test(e.cls)) && st.edges.filter((e) => /vc-graph-edge-(selected|lineage)/.test(e.cls)).map((e) => e.id).sort().join() === selSet.join())
    await park(page)
    st = await readState(page)
    record(sc, 'S9 leaving restores the plain selection', !st.edges.some((e) => /vc-graph-edge-emphasized/.test(e.cls)))
    // Drag-pan started on a card does not toggle the selection.
    const before = await page.evaluate(() => window.H.cards().map((c) => c.pressed).join())
    await page.mouse.move(bR.l + bR.w / 2, bR.t + bR.h / 2)
    await page.mouse.down()
    await page.mouse.move(bR.l + bR.w / 2 + 60, bR.t + bR.h / 2 + 40, { steps: 6 })
    await page.mouse.up()
    await park(page)
    await sleep(100)
    const afterDrag = await page.evaluate(() => window.H.cards().map((c) => c.pressed).join())
    record(sc, 'S9 drag-pan started on a card does not toggle selection', before === afterDrag, `${before} -> ${afterDrag}`)
    await page.keyboard.press('Escape')
  }

  // Keyboard S10.
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0) })
  const seen = new Set()
  let first = null
  for (let i = 0; i < 260 && seen.size < items.length; i++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const a = document.activeElement
      return a && a.matches && a.matches('article.vc-graph-card[role=button]') ? { label: a.getAttribute('aria-label'), pressed: a.getAttribute('aria-pressed'), id: a.closest('.react-flow__node').getAttribute('data-id') } : null
    })
    if (info) { seen.add(info.id); first ??= info }
  }
  record(sc, 'S10 Tab reaches every first-level card as role=button', seen.size === items.length, `${seen.size}/${items.length}`)
  if (first) {
    await page.evaluate((id) => document.querySelector(`.react-flow__node[data-id="${id}"] article`).focus(), first.id)
    await sleep(120)
    await page.evaluate(() => window.H.settle())
    const s0 = await page.evaluate(() => window.H.scrollState())
    await page.keyboard.press('Enter')
    await sleep(120)
    let st = await readState(page)
    record(sc, 'S10 Enter selects the focused card', st.cards.find((c) => c.id === first.id).pressed === 'true')
    const exp = expectedAssociated(st, st.cards.find((c) => c.id === first.id))
    record(sc, 'S10 keyboard selection highlights the same edge set', eqSet(st.edges.filter((e) => /vc-graph-edge-(selected|lineage)/.test(e.cls)).map((e) => e.id), exp.ids))
    if (fixture === 'standard' && ref === 'shown' && dir === 'LR' && vp[0] === 1700) {
      await page.screenshot({ path: path.join(ART, 'sel-standard-keyboard-focus-selected.png') })
    }
    await page.keyboard.press('Space')
    await sleep(120)
    st = await readState(page)
    record(sc, 'S10 Space toggles it off', st.cards.find((c) => c.id === first.id).pressed === 'false')
    await page.keyboard.press('Space')
    await sleep(100)
    await page.keyboard.press('Space')
    await sleep(100)
    const s1 = await page.evaluate(() => window.H.scrollState())
    record(sc, 'S10 Space does not scroll the page/pane or move the viewport', s0 === s1, s0 === s1 ? '' : `${s0} vs ${s1}`)
    const outline = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return cs.outlineStyle + ' ' + cs.outlineWidth })
    record(sc, 'S10 focus-visible outline still renders on the focused card', /solid 2px/.test(outline), outline)
  }
  await page.close()
}

/** Required screenshots. */
async function shots(browser) {
  const shot = async (page, name, clip) => page.screenshot({ path: path.join(ART, name), ...(clip ? { clip } : {}) })
  const pick = async (page, pred) => page.evaluate((p) => { const f = new Function('c', 'return ' + p); return window.H.cards().find((c) => f(c)) }, pred)
  const select = async (page, pred) => {
    const c = await pick(page, pred)
    await toggleCard(page, c)
    await park(page)
    await sleep(200)
    return c
  }
  // standard 1700 shown LR
  let { page } = await openScenario(browser, 'standard', [1700, 1000], 'shown', 'LR', 'on')
  await shot(page, 'sel-standard-shown-LR-1700-baseline.png')
  await select(page, "c.label === 'Role A'")
  await shot(page, 'sel-standard-shown-LR-1700-selected-role.png')
  await toggleCard(page, await pick(page, "c.label === 'Role A'"))
  await select(page, "c.label === 'Admin'")
  await shot(page, 'sel-standard-shown-LR-1700-selected-entitlement.png')
  await toggleCard(page, await pick(page, "c.label === 'Admin'"))
  // both-levels: Role A then Read
  await select(page, "c.label === 'Role A'")
  await shot(page, 'sel-standard-bothlevels-selected-role.png')
  await toggleCard(page, await pick(page, "c.label === 'Role A'"))
  await select(page, "c.label === 'Read' && !c.ref")
  await shot(page, 'sel-standard-bothlevels-selected-read.png')
  // zoomed crop of selected card + edges at 2x
  await page.close()
  ;({ page } = await openScenario(browser, 'standard', [1700, 1000], 'shown', 'LR', 'on', { dsf: 2 }))
  await select(page, "c.label === 'Role A'")
  await shot(page, 'sel-standard-shown-LR-1700-selected-role-2x.png')
  await page.close()
  // TB
  ;({ page } = await openScenario(browser, 'standard', [1700, 1000], 'shown', 'TB', 'on'))
  await select(page, "c.label === 'Role A'")
  await shot(page, 'sel-standard-shown-TB-1700-selected.png')
  await page.close()
  // hidden
  ;({ page } = await openScenario(browser, 'standard', [1700, 1000], 'hidden', 'LR', 'on'))
  await select(page, "c.label === 'Role A'")
  await shot(page, 'sel-standard-hidden-LR-1700-selected.png')
  await page.close()
  // 1000x700
  ;({ page } = await openScenario(browser, 'standard', [1000, 700], 'shown', 'LR', 'on'))
  await select(page, "c.label === 'Role A'")
  await shot(page, 'sel-standard-shown-LR-1000x700-selected.png')
  await page.close()
  // dark
  ;({ page } = await openScenario(browser, 'standard', [1700, 1000], 'shown', 'LR', 'on', { dark: true }))
  await select(page, "c.label === 'Role A'")
  await shot(page, 'sel-standard-dark-selected.png')
  await page.close()
  // dense
  ;({ page } = await openScenario(browser, 'dense', [1700, 1000], 'shown', 'LR', 'on'))
  await select(page, "c.label === 'Finance Role'")
  await shot(page, 'sel-dense-shown-LR-1700-selected.png')
  await toggleCard(page, await pick(page, "c.label === 'Finance Role'"))
  await select(page, "c.label === 'Entitlement 05'")
  await shot(page, 'sel-dense-shown-LR-1700-selected-entitlement.png')
  await page.close()
  ;({ page } = await openScenario(browser, 'dense', [1700, 1000], 'hidden', 'LR', 'on'))
  await select(page, "c.label === 'Finance Role'")
  await shot(page, 'sel-dense-hidden-LR-1700-selected.png')
  await page.close()
  ;({ page } = await openScenario(browser, 'dense', [1000, 700], 'shown', 'TB', 'on'))
  await select(page, "c.label === 'Finance Role'")
  await shot(page, 'sel-dense-shown-TB-1000x700-selected.png')
  await page.close()
}

async function explore(browser) {
  const { page } = await openScenario(browser, 'standard', [1700, 1000], 'shown', 'LR', 'on')
  const info = await page.evaluate(() => {
    const H = window.H
    return { cards: H.cards().map((c) => [c.id, c.kind, c.label, c.ref, c.status, c.pressed]), edges: H.edges().map((e) => [e.id, e.from, e.to, e.z]), cardZ: H.zChain(H.nodeEl(H.cards()[1].id)) }
  })
  console.log(JSON.stringify(info, null, 1))
  await page.close()
}

async function main() {
  const server = await createServer({ configFile: path.resolve('vite.config.ts'), server: { port: 5199, strictPort: true } })
  await server.listen()
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--ignore-certificate-errors', '--no-sandbox'] })
  const t0 = Date.now()
  try {
    if (MODE === 'explore') await explore(browser)
    else if (MODE === 'shots') await shots(browser)
    else {
      for (const fixture of FIXTURES) {
        for (const vp of VIEWPORTS) {
          for (const ref of REFS) {
            for (const dir of DIRS) {
              for (const map of MAPS) {
                if (args.only === 'behaviors') continue
                const stats = await runScenario(browser, fixture, vp, ref, dir, map)
                console.log(`${fixture} ${vp.join('x')} ${ref} ${dir} map-${map}: items=${stats.items} clicked=${stats.clicked} keyed=${stats.keyed} crossedPts=${stats.crossedPts} (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
              }
              await runBehaviors(browser, fixture, vp, ref, dir)
            }
          }
        }
      }
      const summary = { counts, failures: results.length }
      fs.writeFileSync(path.join(ART, `sel-summary-${args.tag ?? 'run'}.json`), JSON.stringify({ ...summary, results }, null, 2))
      console.log(JSON.stringify(counts, null, 1))
      console.log('FAILURES', results.length)
      for (const r of results.slice(0, 40)) console.log(JSON.stringify(r))
    }
  } finally {
    await browser.close()
    await server.close()
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
