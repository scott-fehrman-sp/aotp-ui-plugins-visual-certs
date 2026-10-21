// TEMPORARY real-browser driver (never committed). Run from the worktree root:
//   node harness-driver.mjs --mode=explore
//   node harness-driver.mjs --mode=h1 [--fixtures=standard,dense] [--viewports=1700x1000,1000x700]
// Starts Vite (JS API, project vite.config.ts) on 5199 and drives real Chrome.
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'

const ART = '/Users/scott.fehrman/Documents/Projects/SailPoint/ui-plugins-apps/visual-certs/.agents/tasks/hover-and-zoom'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'https://localhost:5199/graph-harness.html'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? 'true']
  }),
)
const MODE = args.mode ?? 'h1'
const FIXTURES = (args.fixtures ?? 'standard,dense').split(',')
const VIEWPORTS = (args.viewports ?? '1700x1000,1000x700').split(',').map((s) => s.split('x').map(Number))
const REFS = (args.refs ?? 'shown,hidden').split(',')
const DIRS = (args.dirs ?? 'LR,TB').split(',')
const MAPS = (args.maps ?? 'on,off').split(',')
const MAXCARDS = args.maxcards ? Number(args.maxcards) : Infinity
const FAST = args.fast === 'true' // skip 500ms flicker window per card (spot checks only)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Helpers injected into the page. */
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
      rect: rectOf(a), nodeRect: rectOf(n),
    }
  }).filter(Boolean)
  const edgeGroups = () => qa('.react-flow__edge')
  const edgeSnapshot = () => edgeGroups().map((g) => {
    const p = q('path.react-flow__edge-path', g)
    return g.getAttribute('data-id') + '|' + g.getAttribute('class') + '|' + (p ? p.getAttribute('style') : '')
  }).join('\\n')
  const edgeInfo = () => Object.fromEntries(edgeGroups().map((g) => {
    const p = q('path.react-flow__edge-path', g)
    const cs = getComputedStyle(p)
    return [g.getAttribute('data-id'), {
      cls: g.getAttribute('class'), stroke: cs.stroke, width: parseFloat(cs.strokeWidth), opacity: parseFloat(cs.opacity),
      dash: cs.strokeDasharray, ref: g.classList.contains('vc-graph-edge-reference'), status: g.classList.contains('vc-graph-edge-status'),
    }]
  }))
  const emphasized = () => qa('.react-flow__edge.vc-graph-edge-emphasized').map((g) => g.getAttribute('data-id'))
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
  /** Effective z-index chain (non-auto) from el up to the viewport. */
  const zChain = (el) => {
    const out = []
    for (let e = el; e && !e.classList?.contains('react-flow__viewport'); e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.zIndex !== 'auto') out.push({ tag: e.tagName.toLowerCase() + '.' + (e.getAttribute('class') || '').split(' ').slice(0, 2).join('.'), z: cs.zIndex, pos: cs.position })
    }
    return out
  }
  const edgeEl = (id) => qa('.react-flow__edge').find((g) => g.getAttribute('data-id') === id)
  const nodeEl = (id) => qa('.react-flow__node').find((g) => g.getAttribute('data-id') === id)
  const rects = (sel) => qa(sel).map(rectOf)
  const overlays = () => [...rects('.react-flow__panel'), ...rects('.react-flow__minimap'), ...rects('.react-flow__controls'), ...rects('[role=tooltip]')]
  /** Sample "dash-on" centres along the edge path in client coords. */
  const samples = (edgeId, count = 121) => {
    const g = edgeEl(edgeId); const p = q('path.react-flow__edge-path', g)
    const cs = getComputedStyle(p)
    const dash = (cs.strokeDasharray === 'none' ? [] : cs.strokeDasharray.split(/[ ,]+/).map(parseFloat)).filter((x) => !Number.isNaN(x))
    const len = p.getTotalLength()
    const ctm = p.getScreenCTM()
    const svg = p.ownerSVGElement
    const lens = []
    if (dash.length >= 2) {
      const period = dash[0] + dash[1]
      for (let s = dash[0] / 2; s < len; s += period) lens.push(s)
    } else for (let i = 0; i < count; i++) lens.push((len * (i + 0.5)) / count)
    const step = Math.max(1, Math.floor(lens.length / count))
    const pts = []
    for (let i = 0; i < lens.length; i += step) {
      const pt = svg.createSVGPoint(); const lp = p.getPointAtLength(lens[i]); pt.x = lp.x; pt.y = lp.y
      const c = pt.matrixTransform(ctm); pts.push({ x: c.x, y: c.y })
    }
    return { pts, color: cs.stroke, width: parseFloat(cs.strokeWidth), dash }
  }
  const inside = (r, x, y, pad = 0) => x >= r.l + pad && x <= r.r - pad && y >= r.t + pad && y <= r.b - pad
  /** Samples that lie inside a different card and are not hidden by an overlay / outside the canvas. */
  const crossed = (edgeId, userId, targetId) => {
    const s = samples(edgeId)
    const others = cards().filter((c) => c.id !== userId && c.id !== targetId)
    const canvas = rectOf(q('.react-flow'))
    const ov = overlays()
    const pts = []; let excluded = 0
    for (const p of s.pts) {
      const card = others.find((c) => inside(c.rect, p.x, p.y, 3))
      if (!card) continue
      if (!inside(canvas, p.x, p.y, 2) || ov.some((r) => inside(r, p.x, p.y, -3))) { excluded++; continue }
      pts.push({ x: p.x, y: p.y, card: card.id })
    }
    return { pts, excluded, color: s.color, width: s.width }
  }
  const shots = {}
  const loadShot = async (name, b64) => {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    const blob = new Blob([u8], { type: 'image/png' })
    const bmp = await createImageBitmap(blob)
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height
    const ctx = cv.getContext('2d'); ctx.drawImage(bmp, 0, 0)
    shots[name] = ctx.getImageData(0, 0, bmp.width, bmp.height)
    return [bmp.width, bmp.height]
  }
  const parseRgb = (s) => (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number)
  const matchFraction = (name, pts, color, tol = 45) => {
    const im = shots[name]; const want = parseRgb(color)
    let ok = 0
    for (const p of pts) {
      let best = 1e9
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const x = Math.round(p.x) + dx, y = Math.round(p.y) + dy
        if (x < 0 || y < 0 || x >= im.width || y >= im.height) continue
        const i = (y * im.width + x) * 4
        const d = Math.hypot(im.data[i] - want[0], im.data[i + 1] - want[1], im.data[i + 2] - want[2])
        if (d < best) best = d
      }
      if (best <= tol) ok++
    }
    return pts.length ? ok / pts.length : null
  }
  /** Colour distance of the best pixel in the 3x3 neighbourhood to the wanted colour. */
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
  /** Fraction of points where the hover screenshot is clearly closer to the status colour than the baseline
   *  (thin strokes at low zoom are sub-pixel, so an exact colour match is impossible; "much closer" is the evidence). */
  const improvedFraction = (pts, color, tol = 45) => {
    const want = parseRgb(color); let ok = 0
    for (const p of pts) {
      const h = bestDist('hover', p, want), b = bestDist('base', p, want)
      if (h <= tol || h <= b - 8) ok++
    }
    return pts.length ? ok / pts.length : null
  }
  const sampleEmphasis = (n, ms) => new Promise((res) => {
    const out = []; const tick = () => { out.push(emphasized().join(',')); if (out.length >= n) res(out); else setTimeout(tick, ms) }; tick()
  })
  return { q, qa, rectOf, cards, edgeSnapshot, edgeInfo, emphasized, transforms, viewportT, zoom, settle, zChain, edgeEl, nodeEl, samples, crossed, loadShot, matchFraction, improvedFraction, sampleEmphasis, overlays }
})()
`

const results = [] // {scenario, assertion, ok, detail}
const counts = {} // assertion -> {pass, fail}
function record(scenario, assertion, ok, detail = '') {
  counts[assertion] ??= { pass: 0, fail: 0 }
  counts[assertion][ok ? 'pass' : 'fail']++
  if (!ok) results.push({ scenario, assertion, detail })
}

async function openScenario(browser, fixture, vp, ref, dir, map) {
  const page = await browser.newPage()
  await page.setViewport({ width: vp[0], height: vp[1], deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
  await page.goto(`${BASE}?fixture=${fixture}`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.react-flow__node')
  await page.addScriptTag({ content: HELPERS })
  // Drill in (first user card).
  const userBtn = fixture === 'dense' ? 'Show access for Amos Cunningham' : 'Show access for Alice Adams'
  await page.click(`[aria-label="${userBtn}"]`)
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
  if (args.zoomin) {
    // Supplemental: zoom in (ctrl+wheel) around the first access-profile card so thin strokes are >1px, then run the same suite.
    const target = await page.evaluate(() => { const c = window.H.cards().find((k) => k.kind === 'accessProfile' && !k.ref); return { x: c.rect.l + c.rect.w / 2, y: c.rect.t + c.rect.h / 2 } })
    await page.mouse.move(target.x, target.y)
    await page.keyboard.down('Control')
    for (let i = 0; i < Number(args.zoomin); i++) { await page.mouse.wheel({ deltaY: -120 }); await sleep(60) }
    await page.keyboard.up('Control')
    await page.evaluate(() => window.H.settle())
    console.log('zoomed to', await page.evaluate(() => window.H.zoom()))
  }
  await page.mouse.move(2, 2)
  await sleep(100)
  return page
}

async function explore(browser) {
  const page = await openScenario(browser, 'standard', [1700, 1000], 'shown', 'LR', 'on')
  const info = await page.evaluate(() => {
    const H = window.H
    const cards = H.cards()
    const first = cards.find((c) => c.status && !c.ref)
    const g = H.edgeEl('e:' + cards.find((c) => c.kind === 'user').id + ':' + first.id)
    return {
      cards: cards.map((c) => ({ id: c.id, kind: c.kind, label: c.label, ref: c.ref, status: c.status })),
      edgeIds: H.qa('.react-flow__edge').map((e) => e.getAttribute('data-id')),
      edgeGroupZ: H.zChain(g), cardZ: H.zChain(H.nodeEl(first.id)),
      edgeContainerHtml: g.parentElement.outerHTML.slice(0, 300),
      zoom: H.zoom(),
    }
  })
  console.log(JSON.stringify(info, null, 1))
  await page.screenshot({ path: path.join(ART, 'explore-standard-shown.png') })
  await page.close()
}

const PNG = (name) => path.join(ART, name)

/** H1 over one scenario. Returns the best hover candidate (most crossings) for screenshots. */
async function runH1(browser, fixture, vp, ref, dir, map) {
  const sc = `${fixture}/${vp[0]}x${vp[1]}/${ref}/${dir}/map-${map}`
  const page = await openScenario(browser, fixture, vp, ref, dir, map)
  const all = await page.evaluate(() => window.H.cards())
  const user = all.find((c) => c.kind === 'user')
  const allItems = all.filter((c) => c.kind !== 'user' && !c.ref && c.status).slice(0, MAXCARDS)
  // A card is hover-testable only if its centre and probe points hit it (it can be off-canvas / under an overlay
  // when the whole lane cannot fit at minZoom; that is the long-list case FEAT-002 handles). Others get focus() tests only.
  const reach = await page.evaluate((cs) => {
    const canvas = window.H.rectOf(window.H.q('.react-flow'))
    return cs.map((c) => {
      const ix = Math.min(4, c.rect.w * 0.3), iy = Math.min(4, c.rect.h * 0.3)
      const pts = [[c.rect.l + c.rect.w / 2, c.rect.t + c.rect.h / 2], [c.rect.l + ix, c.rect.t + c.rect.h / 2], [c.rect.l + c.rect.w / 2, c.rect.t + iy]]
      const inCanvas = c.rect.l >= canvas.l && c.rect.r <= canvas.r && c.rect.t >= canvas.t && c.rect.b <= canvas.b
      return inCanvas && pts.every(([x, y]) => document.elementFromPoint(x, y)?.closest('.react-flow__node')?.getAttribute('data-id') === c.id)
    })
  }, allItems)
  const items = allItems.filter((_, i) => reach[i])
  const unreachable = allItems.length - items.length
  const refCards = all.filter((c) => c.ref)
  const baseInfo = await page.evaluate(() => window.H.edgeInfo())
  const baseSnap = await page.evaluate(() => window.H.edgeSnapshot())
  const baseTrans = await page.evaluate(() => window.H.transforms())
  const baseZoom = await page.evaluate(() => window.H.zoom())
  record(sc, 'H1-pre: expected first-level card count', items.length > 0, `items=${items.length}`)
  // Baseline screenshot (pointer parked) for the before/after paint comparison.
  const baseShot = await page.screenshot({ type: 'png', encoding: 'base64' })
  await page.evaluate((b) => window.H.loadShot('base', b), baseShot)
  let best = null
  const stats = { cards: items.length, unreachableOffCanvas: unreachable, crossedCards: 0, crossedPts: 0, excludedPts: 0, minHover: 1, maxBase: 0 }

  for (const card of items) {
    const edgeId = `e:${user.id}:${card.id}`
    const cx = card.rect.l + card.rect.w / 2
    const cy = card.rect.t + card.rect.h / 2
    // The paint samples come from the baseline geometry.
    const cr = await page.evaluate((e, u, t) => window.H.crossed(e, u, t), edgeId, user.id, card.id)

    // H1-a: hover.
    await page.mouse.move(cx, cy)
    await sleep(60)
    const hov = await page.evaluate((eid, nid) => {
      const H = window.H
      const em = H.emphasized()
      const info = H.edgeInfo()
      const g = H.edgeEl(eid)
      return {
        em, info, tip: !!H.q('[role=tooltip]'),
        edgeZ: g ? H.zChain(g) : null, cardZ: H.zChain(H.nodeEl(nid)),
        trans: H.transforms(),
      }
    }, edgeId, card.id)
    record(sc, 'H1-a exactly one emphasized edge, it is the card\'s incoming edge', hov.em.length === 1 && hov.em[0] === edgeId, `${card.label}: ${hov.em.join(',')}`)
    const baseW = baseInfo[edgeId]?.width
    record(sc, 'H1-a emphasized edge thicker than default', hov.info[edgeId] && hov.info[edgeId].width > baseW, `${card.label}: ${baseW} -> ${hov.info[edgeId]?.width}`)
    const topZ = (chain) => Math.max(...chain.map((c) => Number(c.z)).filter((n) => !Number.isNaN(n)), -Infinity)
    record(sc, 'H1-a edge layer z-index above card z-index', topZ(hov.edgeZ) > topZ(hov.cardZ), `${card.label}: edge ${JSON.stringify(hov.edgeZ)} card ${JSON.stringify(hov.cardZ)}`)
    record(sc, 'H1-g tooltip opens on hover', hov.tip, card.label)

    // H1-b: dimming + colors unchanged.
    let dimOk = true; let colOk = true; let dimDetail = ''
    for (const [id, info] of Object.entries(hov.info)) {
      if (id === edgeId) { if (info.stroke !== baseInfo[id].stroke || info.dash !== baseInfo[id].dash) colOk = false; continue }
      const want = info.ref ? 0.12 : 0.25
      if (Math.abs(info.opacity - want) > 0.02) { dimOk = false; dimDetail += ` ${id}:${info.opacity}!=${want}` }
      if (info.stroke !== baseInfo[id].stroke) colOk = false
    }
    record(sc, 'H1-b every other edge dimmed (status .25 / reference .12)', dimOk, `${card.label}${dimDetail}`)
    record(sc, 'H1-b stroke colors and dashes unchanged', colOk, card.label)

    // H1-e: nothing moved.
    record(sc, 'H1-e node + viewport transforms identical during hover', hov.trans === baseTrans, card.label)

    // H1-c: paint. Samples hidden by the (portal) tooltip are not paint evidence; drop them.
    cr.pts = await page.evaluate((pts) => {
      const t = window.H.q('[role=tooltip]')
      if (!t) return pts
      const r = window.H.rectOf(t)
      return pts.filter((p) => !(p.x >= r.l - 3 && p.x <= r.r + 3 && p.y >= r.t - 3 && p.y <= r.b + 3))
    }, cr.pts)
    if (cr.pts.length) {
      const baseFrac = await page.evaluate((p, c) => window.H.matchFraction('base', p, c), cr.pts, cr.color)
      const shot = await page.screenshot({ type: 'png', encoding: 'base64' })
      await page.evaluate((b) => window.H.loadShot('hover', b), shot)
      const hovFrac = await page.evaluate((p, c) => window.H.improvedFraction(p, c), cr.pts, cr.color)
      const exactFrac = await page.evaluate((p, c) => window.H.matchFraction('hover', p, c), cr.pts, cr.color)
      stats.exactMin = Math.min(stats.exactMin ?? 1, exactFrac)
      stats.crossedCards++; stats.crossedPts += cr.pts.length; stats.excludedPts += cr.excluded
      stats.minHover = Math.min(stats.minHover, hovFrac); stats.maxBase = Math.max(stats.maxBase, baseFrac ?? 0)
      record(sc, 'H1-c raised edge painted over crossed cards (>=95% of samples; >=90% when the stroke is sub-pixel, i.e. 3.5*zoom < 1px)', hovFrac >= (3.5 * baseZoom >= 1 ? 0.95 : 0.9), `${card.label}: hover(improved) ${hovFrac.toFixed(2)} exact ${exactFrac.toFixed(2)} zoom-px ${(cr.width * baseZoom).toFixed(2)} over ${cr.pts.length} pts`)
      record(sc, 'H1-c before hover the edge was NOT painted over those cards (<50%)', baseFrac < 0.5, `${card.label}: base ${baseFrac?.toFixed(2)}`)
      if (!best || cr.pts.length > best.n) best = { n: cr.pts.length, label: card.label, cx, cy, id: card.id }
    }

    // H1-d: stability at center / left border / top border.
    const insetX = Math.min(4, card.rect.w * 0.3), insetY = Math.min(4, card.rect.h * 0.3)
    const probes = [
      ['center', cx, cy],
      ['left border', card.rect.l + insetX, cy],
      ['top border', cx, card.rect.t + insetY],
    ]
    for (const [name, px, py] of probes) {
      await page.mouse.move(px, py)
      const n = FAST ? 3 : name === 'center' ? 10 : 6
      const samples = await page.evaluate((k) => window.H.sampleEmphasis(k, 50), n)
      const stable = samples.every((s) => s === edgeId)
      const hit = await page.evaluate((x, y, id) => {
        const el = document.elementFromPoint(x, y)
        return !!el && el.closest('.react-flow__node')?.getAttribute('data-id') === id
      }, px, py, card.id)
      record(sc, 'H1-d emphasis stable (no flicker) at ' + name, stable, `${card.label}: ${JSON.stringify(samples)}`)
      record(sc, 'H1-d elementFromPoint stays inside the card at ' + name, hit, card.label)
    }

    // H1-f: restore.
    await page.mouse.move(2, 2)
    await sleep(60)
    const snap = await page.evaluate(() => window.H.edgeSnapshot())
    const trans = await page.evaluate(() => window.H.transforms())
    record(sc, 'H1-f edge classes/styles string-identical after leave', snap === baseSnap, card.label)
    record(sc, 'H1-e transforms identical after leave', trans === baseTrans, card.label)
  }

  // Screenshots for the evidence list.
  const shotName = (k) => `h1${args.zoomin ? 'zoomin' : ''}-${fixture}-${ref}${dir === 'TB' ? '-tb' : ''}-${k}-${vp[0]}${vp[0] === 1000 ? 'x' + vp[1] : ''}${map === 'off' ? '-nomap' : ''}.png`
  // The Tab traversal leaves a browser focus ring on whatever it stopped at; clear it for clean evidence.
  await page.evaluate(() => document.activeElement?.blur?.())
  if (best && map === 'on') {
    await page.mouse.move(best.cx, best.cy)
    await sleep(120)
    await page.screenshot({ path: PNG(shotName('hover')) })
    await page.mouse.move(2, 2)
    await sleep(80)
    await page.screenshot({ path: PNG(shotName('before')) })
  } else if (map === 'on' && items.length) {
    const c = items[Math.floor(items.length / 2)]
    await page.mouse.move(c.rect.l + c.rect.w / 2, c.rect.t + c.rect.h / 2)
    await sleep(120)
    await page.screenshot({ path: PNG(shotName('hover')) })
    await page.mouse.move(2, 2)
  }
  if (best && fixture === 'standard' && ref === 'shown' && dir === 'LR' && map === 'on' && vp[0] === 1700) {
    await page.evaluate((id) => window.H.nodeEl(id).querySelector('article.vc-graph-card').focus({ preventScroll: true }), best.id)
    await sleep(150)
    await page.screenshot({ path: PNG('h1-keyboard-focus-1700.png') })
    await page.evaluate(() => document.activeElement?.blur?.())
  }

  // H1-g keyboard: programmatic focus per card, then blur.
  for (const card of allItems) {
    const edgeId = `e:${user.id}:${card.id}`
    const r = await page.evaluate((nid) => {
      const H = window.H
      H.nodeEl(nid).querySelector('article.vc-graph-card').focus({ preventScroll: true })
      return null
    }, card.id)
    await sleep(40)
    const f = await page.evaluate(() => ({ em: window.H.emphasized(), tip: !!window.H.q('[role=tooltip]'), snapLen: window.H.edgeSnapshot().length }))
    record(sc, 'H1-g focus() emphasizes the card\'s edge', f.em.length === 1 && f.em[0] === edgeId, `${card.label}: ${f.em.join(',')}`)
    record(sc, 'H1-g tooltip opens on focus', f.tip, card.label)
    await page.evaluate(() => document.activeElement.blur())
    await sleep(40)
    const snap = await page.evaluate(() => window.H.edgeSnapshot())
    record(sc, 'H1-g blur restores edges', snap === baseSnap, card.label)
    void r
  }
  record(sc, 'H1-e viewport zoom unchanged by hover/focus', Math.abs((await page.evaluate(() => window.H.zoom())) - baseZoom) < 1e-9, `${baseZoom}`)

  // H1-g: reference node hover changes nothing.
  for (const rc of refCards) {
    await page.mouse.move(rc.rect.l + rc.rect.w / 2, rc.rect.t + rc.rect.h / 2)
    await sleep(60)
    const s = await page.evaluate(() => ({ snap: window.H.edgeSnapshot(), em: window.H.emphasized().length }))
    record(sc, 'H1-g reference-only node hover changes no edge', s.snap === baseSnap && s.em === 0, rc.label)
  }
  await page.mouse.move(2, 2)
  await sleep(60)

  // H1-g: real Tab traversal.
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0) })
  await page.focus('body').catch(() => {})
  const tabbed = []
  // Nodes and edges are both tabbable (node wrapper then its card), so budget for all of them.
  const tabBudget = 2 * all.length + Object.keys(baseInfo).length + 30
  for (let i = 0; i < tabBudget; i++) {
    await page.keyboard.press('Tab')
    await sleep(25)
    const s = await page.evaluate(() => {
      const a = document.activeElement
      const node = a?.closest?.('.react-flow__node')
      const art = a?.matches?.('article.vc-graph-card') ? a : null
      return { nid: node?.getAttribute('data-id') ?? null, card: !!art, ref: art?.classList.contains('vc-graph-card-reference') ?? false, em: window.H.emphasized(), tip: !!window.H.q('[role=tooltip]') }
    })
    tabbed.push(s)
  }
  const itemIds = new Set(allItems.map((c) => c.id))
  const seenItems = new Set()
  for (const s of tabbed) {
    if (s.card && s.nid && itemIds.has(s.nid)) {
      seenItems.add(s.nid)
      record(sc, 'H1-g Tab focus emphasizes that card\'s edge', s.em.length === 1 && s.em[0] === `e:${user.id}:${s.nid}`, `${s.nid}: ${s.em.join(',')}`)
      record(sc, 'H1-g Tab focus shows tooltip', s.tip, s.nid)
    } else if (s.card) {
      record(sc, 'H1-g Tab focus on user/reference card emphasizes nothing', s.em.length === 0, `${s.nid}: ${s.em.join(',')}`)
    }
  }
  record(sc, 'H1-g real Tab reaches every first-level card', seenItems.size === allItems.length, `${seenItems.size}/${allItems.length}`)

  await page.close()
  return { sc, stats }
}


// ---------------------------------------------------------------------------
// FEAT-002: Z1 (dense, long list) and Z2 (standard, unchanged short graph).
// ---------------------------------------------------------------------------
const READABLE = 0.65

/** Page-side snapshot of everything the Z assertions need. */
const ZSNAP = () => {
  const H = window.H
  const canvas = H.rectOf(H.q('.react-flow'))
  const panels = H.qa('.react-flow__panel').map((el) => ({ cls: el.className.replace(/react-flow__panel /, '').slice(0, 60), ...H.rectOf(el), hint: el.classList.contains('vc-graph-hint-panel') }))
  const extra = [...H.qa('.react-flow__minimap'), ...H.qa('.react-flow__controls')].map((el) => ({ cls: el.className.slice(0, 40), ...H.rectOf(el), hint: false }))
  const overlays = [...panels, ...extra].filter((o) => o.w > 0 && o.h > 0)
  const cards = H.cards().map((c) => ({ id: c.id, kind: c.kind, label: c.label, ref: c.ref, status: c.status, l: c.rect.l, t: c.rect.t, r: c.rect.r, b: c.rect.b }))
  const label = H.q('.vc-graph-card-label')
  const hintEl = H.q('p.vc-graph-hint[role=status]')
  return {
    canvas, overlays, cards, zoom: H.zoom(),
    fontPx: label ? parseFloat(getComputedStyle(label).fontSize) : NaN,
    hint: hintEl ? { text: hintEl.textContent, rect: H.rectOf(hintEl.closest('.react-flow__panel')) } : null,
    statusRoles: H.qa('[role=status]').length,
  }
}

const inter = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5
const rectOfBox = (o) => ({ l: o.l ?? o.left, t: o.t ?? o.top, r: (o.l ?? o.left) + o.w, b: (o.t ?? o.top) + o.h })
const insideCanvas = (c, cv, tol = 1) => c.l >= cv.l - tol && c.r <= cv.r + tol && c.t >= cv.t - tol && c.b <= cv.b + tol
const clearOfOverlays = (c, overlays) => !overlays.some((o) => inter(c, rectOfBox(o)))

async function snap(page) { return page.evaluate(ZSNAP) }

async function runZ1(browser, vp, ref, dir, map, shots) {
  const fixture = 'dense'
  const sc = `${fixture}/${vp[0]}x${vp[1]}/${ref}/${dir}/map-${map}`
  const page = await openScenario(browser, fixture, vp, ref, dir, map)
  const out = { sc }
  let sn = await snap(page)
  const cv = sn.canvas
  const user = sn.cards.find((c) => c.kind === 'user')
  const first = sn.cards.filter((c) => c.kind !== 'user' && !c.ref && c.status)
  const center = (c) => ({ x: (c.l + c.r) / 2, y: (c.t + c.b) / 2 })
  const uc = center(user)
  const nearest = [...first].sort((a, b) => Math.hypot(center(a).x - uc.x, center(a).y - uc.y) - Math.hypot(center(b).x - uc.x, center(b).y - uc.y)).slice(0, 3)

  record(sc, 'Z1 zoom == READABLE_MIN_ZOOM (+/-0.005)', Math.abs(sn.zoom - READABLE) <= 0.005, `zoom ${sn.zoom}`)
  record(sc, 'Z1 effective label font >= 9.5px', sn.fontPx * sn.zoom >= 9.5, `${(sn.fontPx * sn.zoom).toFixed(2)}px`)
  for (const [name, c] of [['user card', user], ...nearest.map((n, i) => ['nearest item ' + (i + 1) + ' ' + n.label, n])]) {
    record(sc, 'Z1 user + 3 nearest items fully inside canvas', insideCanvas(c, cv, 0.5), `${name} ${JSON.stringify([c.l, c.t, c.r, c.b].map(Math.round))} canvas ${JSON.stringify([cv.l, cv.t, cv.r, cv.b].map(Math.round))}`)
    record(sc, 'Z1 user + 3 nearest items clear of every overlay', clearOfOverlays(c, sn.overlays), `${name}`)
  }
  // Hint.
  record(sc, 'Z1 hint present with role=status and the count text', sn.hint?.text === '25 items — scroll or drag to see all', JSON.stringify(sn.hint?.text))
  if (sn.hint) {
    const others = sn.overlays.filter((o) => !o.hint)
    const hr = { l: sn.hint.rect.l, t: sn.hint.rect.t, r: sn.hint.rect.r, b: sn.hint.rect.b }
    const hit = others.filter((o) => inter(hr, rectOfBox(o)))
    record(sc, 'Z1 hint does not overlap toolbar/Back/legend/minimap/Controls', hit.length === 0, JSON.stringify(hit.map((h) => h.cls)))
    record(sc, 'Z1 hint inside the canvas', insideCanvas(hr, cv, 0.5), JSON.stringify(hr))
  }
  // Exempt-node counts (revised invariant B-iv).
  const exempt = { total: sn.cards.length, fullyVisibleClear: 0, outsideCanvas: 0, cutByCanvas: 0, underOverlay: 0 }
  for (const c of sn.cards) {
    const inter0 = Math.min(c.r, cv.r) - Math.max(c.l, cv.l) > 0 && Math.min(c.b, cv.b) - Math.max(c.t, cv.t) > 0
    if (!inter0) exempt.outsideCanvas++
    else if (!insideCanvas(c, cv, 1)) exempt.cutByCanvas++
    else if (!clearOfOverlays(c, sn.overlays)) exempt.underOverlay++
    else exempt.fullyVisibleClear++
  }
  out.exempt = exempt
  out.zoom = sn.zoom
  if (shots.open) await page.screenshot({ path: PNG(shots.open) })

  // Scroll to the LAST then FIRST item along the scroll axis.
  const axis = dir === 'LR' ? 'y' : 'x'
  const key = (c) => (axis === 'y' ? (c.t + c.b) / 2 : (c.l + c.r) / 2)
  const lastId = [...first].sort((a, b) => key(b) - key(a))[0].id
  const firstId = [...first].sort((a, b) => key(a) - key(b))[0].id
  const wheel = (d) => (axis === 'y' ? page.mouse.wheel({ deltaY: d }) : page.mouse.wheel({ deltaX: d }))
  // Park the pointer on the canvas middle (cards pan on scroll too).
  await page.mouse.move((cv.l + cv.r) / 2, (cv.t + cv.b) / 2)
  async function scrollUntil(id, sign) {
    // 1) scroll along the scroll axis only (the hint's promise).
    for (let i = 0; i < 80; i++) {
      const s = await snap(page)
      const c = s.cards.find((k) => k.id === id)
      if (insideCanvas(c, s.canvas, 0.5) && clearOfOverlays(c, s.overlays)) return { ok: true, steps: i, s, via: '1D' }
      await wheel(sign * 120)
      await sleep(40)
    }
    // 2) the rank axis can also overflow (wide shown graph in a small canvas): pan both axes toward the canvas middle.
    for (let i = 0; i < 80; i++) {
      const s = await snap(page)
      const c = s.cards.find((k) => k.id === id)
      if (insideCanvas(c, s.canvas, 0.5) && clearOfOverlays(c, s.overlays)) return { ok: true, steps: 80 + i, s, via: '2D' }
      const dx = Math.max(-120, Math.min(120, (c.l + c.r) / 2 - (s.canvas.l + s.canvas.r) / 2))
      const dy = Math.max(-120, Math.min(120, (c.t + c.b) / 2 - (s.canvas.t + s.canvas.b) / 2))
      await page.mouse.wheel({ deltaX: dx, deltaY: dy })
      await sleep(40)
    }
    return { ok: false, steps: 160, s: await snap(page), via: 'none' }
  }
  const toLast = await scrollUntil(lastId, +1)
  record(sc, 'Z1 wheel reaches the LAST item fully inside canvas, clear of overlays', toLast.ok, `steps ${toLast.steps} via ${toLast.via}`)
  out.stepsToLast = toLast.steps; out.lastVia = toLast.via
  record(sc, 'Z1 scrolling does not change zoom', Math.abs(toLast.s.zoom - sn.zoom) < 1e-6, `${toLast.s.zoom}`)
  if (shots.end) await page.screenshot({ path: PNG(shots.end) })
  const toFirst = await scrollUntil(firstId, -1)
  record(sc, 'Z1 wheel reaches the FIRST item fully inside canvas, clear of overlays', toFirst.ok, `steps ${toFirst.steps} via ${toFirst.via}`)
  out.firstVia = toFirst.via

  // Drag pans.
  const before = await page.evaluate(() => window.H.viewportT())
  const spot = await page.evaluate(() => {
    const H = window.H; const cv = H.rectOf(H.q('.react-flow'))
    for (let y = cv.t + 8; y < cv.b - 8; y += 12) for (let x = cv.l + 8; x < cv.r - 8; x += 12) {
      const el = document.elementFromPoint(x, y)
      if (el && el.classList.contains('react-flow__pane')) return { x, y }
    }
    return null
  })
  if (spot) {
    await page.mouse.move(spot.x, spot.y)
    await page.mouse.down()
    await page.mouse.move(spot.x + 40, spot.y + 60, { steps: 6 })
    await page.mouse.up()
    await sleep(80)
    const after = await page.evaluate(() => window.H.viewportT())
    record(sc, 'Z1 drag pans the viewport', after !== before, `${before} -> ${after}`)
  } else record(sc, 'Z1 drag pans the viewport', false, 'no empty pane point found')

  // ctrl-wheel zoom-out bottoms at minZoom 0.15.
  await page.mouse.move((cv.l + cv.r) / 2, (cv.t + cv.b) / 2)
  await page.keyboard.down('Control')
  for (let i = 0; i < 40; i++) { await page.mouse.wheel({ deltaY: 120 }); await sleep(25) }
  await page.keyboard.up('Control')
  await page.evaluate(() => window.H.settle())
  const zmin = await page.evaluate(() => window.H.zoom())
  record(sc, 'Z1 ctrl-wheel zoom out bottoms at 0.15', Math.abs(zmin - 0.15) < 0.002, `${zmin}`)

  // Controls fit-view.
  await page.click('.react-flow__controls-fitview')
  await page.evaluate(() => window.H.settle())
  await sleep(150)
  const fv = await snap(page)
  const notInside = fv.cards.filter((c) => !insideCanvas(c, fv.canvas, 1.5))
  record(sc, 'Z1 fit-view: zoom >= 0.15', fv.zoom >= 0.1499, `${fv.zoom}`)
  const pinned = fv.zoom <= 0.1501
  // At the 0.15 minZoom a very long shown graph cannot fit the canvas at all (fit-view is clamped, unchanged behavior): reported, not failed.
  record(sc, 'Z1 fit-view shows every node inside the canvas (unless pinned at minZoom 0.15)', notInside.length === 0 || pinned, `${notInside.length} cut at zoom ${fv.zoom}`)
  record(sc, 'Z1 hint hidden after fit-view iff everything is in view', (notInside.length === 0) === (fv.hint === null), `cut ${notInside.length} hint ${JSON.stringify(fv.hint?.text)}`)
  out.fitView = { zoom: fv.zoom, cut: notInside.length, hintShown: !!fv.hint }
  if (shots.fit) await page.screenshot({ path: PNG(shots.fit) })

  // Refit trigger / resize round trip (only the headline scenario).
  if (shots.roundtrip) {
    await page.setViewport({ width: 1100, height: 760, deviceScaleFactor: 1 })
    await sleep(500); await page.evaluate(() => window.H.settle())
    await page.setViewport({ width: vp[0], height: vp[1], deviceScaleFactor: 1 })
    await sleep(500); await page.evaluate(() => window.H.settle())
    const rt = await snap(page)
    const u = rt.cards.find((c) => c.kind === 'user')
    record(sc, 'Z1 resize round trip refits to the readable zoom', Math.abs(rt.zoom - READABLE) <= 0.005, `${rt.zoom}`)
    record(sc, 'Z1 resize round trip keeps the user card clear', insideCanvas(u, rt.canvas, 0.5) && clearOfOverlays(u, rt.overlays), '')
  }
  await page.close()
  return out
}

async function runZ2(browser, vp, ref, dir, map, shots, baseline) {
  const fixture = 'standard'
  const sc = `${fixture}/${vp[0]}x${vp[1]}/${ref}/${dir}/map-${map}`
  const page = await openScenario(browser, fixture, vp, ref, dir, map)
  const sn = await snap(page)
  const cv = sn.canvas
  const out = { sc, zoom: sn.zoom }
  let under = 0, outside = 0
  for (const c of sn.cards) {
    if (!insideCanvas(c, cv, 1)) outside++
    if (!clearOfOverlays(c, sn.overlays.filter((o) => !o.hint))) under++
  }
  record(sc, 'Z2 old strict invariant: no node under an overlay (>0.5px)', under === 0, `${under} nodes`)
  record(sc, 'Z2 old strict invariant: every node inside the canvas (1px)', outside === 0, `${outside} nodes`)
  record(sc, 'Z2 no hint', sn.hint === null && sn.statusRoles === 0, '')
  if (baseline && baseline[sc] !== undefined) record(sc, 'Z2 zoom equals the pre-change baseline (+/-0.01)', Math.abs(sn.zoom - baseline[sc]) <= 0.01, `${sn.zoom} vs ${baseline[sc]}`)
  const table = { 'LR/shown/1700': 0.644, 'LR/hidden/1700': 0.785, 'LR/shown/1000': 0.404, 'LR/hidden/1000': 0.492 }
  const t = table[`${dir}/${ref}/${vp[0]}`]
  if (map === 'on' && t !== undefined) record(sc, 'Z2 zoom equals the documented baseline table (+/-0.01)', Math.abs(sn.zoom - t) <= 0.01, `${sn.zoom} vs ${t}`)
  // Lane regression.
  const first = sn.cards.filter((c) => c.kind !== 'user' && !c.ref && c.status)
  const rank = new Set(first.map((c) => Math.round(dir === 'LR' ? c.l : c.t)))
  if (ref === 'hidden') record(sc, 'Z2 reference hidden: first-level items share ONE lane', rank.size === 1, `${rank.size} lanes`)
  else record(sc, 'Z2 reference shown: first-level items in per-kind lanes', rank.size >= 2, `${rank.size} lanes`)
  if (shots.shot) await page.screenshot({ path: PNG(shots.shot) })
  await page.close()
  return out
}

async function mainZ(browser) {
  const FILE = args.baseline ? path.join(ART, args.baseline) : null
  const baselineIn = FILE && fs.existsSync(FILE) && MODE !== 'z2base' ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : null
  const rows = []
  for (const vp of VIEWPORTS) for (const ref of REFS) for (const dir of DIRS) for (const map of MAPS) {
    const tag = `${vp[0]}x${vp[1]}/${ref}/${dir}/map-${map}`
    const big = vp[0] === 1700
    if (MODE === 'z1' || MODE === 'z') {
      const shots = {}
      if (map === 'on' && dir === 'LR' && ref === 'hidden' && big) Object.assign(shots, { open: 'z1-dense-hidden-open-1700.png', end: 'z1-dense-hidden-scrolled-end-1700.png', roundtrip: true })
      if (map === 'on' && dir === 'LR' && ref === 'hidden' && !big) shots.open = 'z1-dense-hidden-open-1000x700.png'
      if (map === 'on' && dir === 'LR' && ref === 'shown' && big) { shots.open = 'z1-dense-shown-open-1700.png'; shots.fit = 'z1-dense-fitview-1700.png' }
      if (map === 'on' && dir === 'TB' && ref === 'hidden' && big) shots.open = 'z1-dense-hidden-tb-1700.png'
      if (map === 'off' && dir === 'LR' && ref === 'shown' && big) shots.open = 'z1-dense-shown-open-nomap-1700.png'
      if (map === 'on' && dir === 'TB' && ref === 'shown' && big) shots.open = 'z1-dense-shown-tb-open-1700.png'
      if (map === 'on' && dir === 'TB' && ref === 'hidden' && !big) shots.open = 'z1-dense-hidden-tb-open-1000x700.png'
      if (map === 'on' && dir === 'LR' && ref === 'shown' && !big) shots.open = 'z1-dense-shown-open-1000x700.png'
      const t0 = Date.now()
      const r = await runZ1(browser, vp, ref, dir, map, shots)
      rows.push({ z: 'Z1', ...r })
      console.log('done Z1', r.sc, JSON.stringify({ zoom: r.zoom, exempt: r.exempt, fitView: r.fitView, via: [r.lastVia, r.firstVia] }), `${((Date.now() - t0) / 1000).toFixed(0)}s`)
    }
    if (MODE === 'z2' || MODE === 'z' || MODE === 'z2base') {
      const shots = {}
      if (map === 'on' && dir === 'LR' && ref === 'shown' && big) shots.shot = 'z2-standard-shown-1700.png'
      if (map === 'on' && dir === 'LR' && ref === 'hidden' && !big) shots.shot = 'z2-standard-hidden-1000x700.png'
      if (MODE === 'z2base') delete shots.shot
      const r = await runZ2(browser, vp, ref, dir, map, shots, baselineIn)
      rows.push({ z: 'Z2', ...r })
      console.log('done Z2', r.sc, r.zoom)
    }
    void tag
  }
  if (MODE === 'z2base') {
    fs.writeFileSync(path.join(ART, 'z2-baseline-zooms.json'), JSON.stringify(Object.fromEntries(rows.filter((r) => r.z === 'Z2').map((r) => [r.sc, r.zoom])), null, 1))
  }
  const summary = { rows, counts, failures: results.length, failureSample: results.slice(0, 60) }
  fs.writeFileSync(PNG(`${MODE}-summary-${args.tag ?? 'run'}.json`), JSON.stringify(summary, null, 1))
  console.log('SUMMARY ' + JSON.stringify({ failures: summary.failures, counts }, null, 1))
  if (results.length) console.log('FAILURES (first 40):\n' + results.slice(0, 40).map((f) => `${f.scenario} :: ${f.assertion} :: ${f.detail}`).join('\n'))
}

async function main() {
  const server = await createServer({
    configFile: path.resolve('vite.config.ts'),
    server: { port: 5199, strictPort: true },
    logLevel: 'error',
  })
  await server.listen()
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox', '--force-color-profile=srgb', '--disable-gpu'],
  })
  try {
    if (MODE === 'explore') {
      await explore(browser)
    } else if (MODE.startsWith('z')) {
      await mainZ(browser)
    } else {
      const scenarios = []
      for (const fixture of FIXTURES)
        for (const vp of VIEWPORTS)
          for (const ref of REFS)
            for (const dir of DIRS)
              for (const map of MAPS) scenarios.push([fixture, vp, ref, dir, map])
      const perScenario = []
      for (const s of scenarios) {
        const t0 = Date.now()
        const r = await runH1(browser, ...s)
        perScenario.push(r)
        console.log('done', r.sc, JSON.stringify(r.stats), `${((Date.now() - t0) / 1000).toFixed(0)}s`)
      }
      const summary = { scenarios: scenarios.length, counts, failures: results.length, perScenario: perScenario.map((p) => ({ sc: p.sc, ...p.stats })), failureSample: results.slice(0, 40) }
      fs.writeFileSync(PNG(`h1-summary-${args.tag ?? 'run'}.json`), JSON.stringify(summary, null, 1))
      console.log('SUMMARY ' + JSON.stringify({ scenarios: summary.scenarios, failures: summary.failures, counts }, null, 1))
      if (results.length) console.log('FAILURES (first 25):\n' + results.slice(0, 25).map((f) => `${f.scenario} :: ${f.assertion} :: ${f.detail}`).join('\n'))
    }
  } finally {
    await browser.close()
    await server.close()
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
