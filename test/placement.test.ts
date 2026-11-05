import { describe, expect, it } from 'vitest'
import { CARD_MARGIN, CARD_WIDTH, CLUSTER_DISTANCE, clusterPins, dockByToolbar, followsTarget, intersects, leaderCrosses, leaderLine, leaderRoute, union, aroundDot, dotAfterWords, dotOnText, faceBox, faceCorner, nearestFree, pinBounds, pinOutline, placeCard, placeFaces, textLines, type LabelPlace, type PinRequest, screenArea, SURFACE_GAP, tickTop, wordsBox, type CardInput, type Rect } from '../src/placement'

const viewport = { width: 1440, height: 900 }
const card = { width: CARD_WIDTH, height: 300 }
const toolbar: Rect = { left: 16, top: 844, width: 420, height: 40 }

function place(target: Rect | null, overrides: Partial<CardInput> = {}) {
  return placeCard({ target, pin: target ? { x: target.left + 4, y: target.top + 4 } : null, card, viewport, toolbar, ...overrides })
}

function cardRect(placement: ReturnType<typeof place>): Rect {
  if (placement.kind !== 'card') throw new Error('expected a card')
  return { left: placement.left, top: placement.top, ...card }
}

describe('placeCard (ux.md 7.3)', () => {
  it('puts the card right of R, its top aligned with R', () => {
    const target = { left: 400, top: 200, width: 200, height: 60 }
    const placement = place(target)
    expect(placement).toEqual({ kind: 'card', side: 'right', left: 612, top: 200, overlaps: false })
    expect(intersects(cardRect(placement), target)).toBe(false)
  })

  it('tries left when the right side has no room', () => {
    const target = { left: 1000, top: 200, width: 300, height: 60 }
    expect(place(target)).toMatchObject({ kind: 'card', side: 'left', left: 1000 - CARD_MARGIN - CARD_WIDTH, top: 200 })
  })

  it('tries below when neither side has room, lined up with the pin', () => {
    const narrow = { width: 700, height: 900 }
    const target = { left: 200, top: 100, width: 300, height: 80 }
    expect(place(target, { viewport: narrow, pin: { x: 480, y: 110 } })).toMatchObject({ kind: 'card', side: 'below', left: 480 + 48 - CARD_WIDTH, top: 192 })
  })

  it('tries above when below has no room either', () => {
    const narrow = { width: 700, height: 900 }
    const target = { left: 200, top: 520, width: 300, height: 300 }
    expect(place(target, { viewport: narrow, pin: { x: 480, y: 530 } })).toMatchObject({ kind: 'card', side: 'above', left: 480 + 48 - CARD_WIDTH, top: 520 - CARD_MARGIN - 300 })
  })

  it('only tries below and above when R is wider than the viewport minus two card widths', () => {
    const target = { left: 40, top: 100, width: 800, height: 120 }
    const placement = place(target)
    expect(placement).toMatchObject({ side: 'below', top: 232 })
  })

  it('clamps the aligned edge into the viewport with 12px margins', () => {
    const target = { left: 400, top: 800, width: 200, height: 40 }
    expect(place(target)).toMatchObject({ side: 'right', top: 900 - 300 - CARD_MARGIN })
    const offLeft = { left: -50, top: 100, width: 1400, height: 100 }
    expect(place(offLeft)).toMatchObject({ side: 'below', left: CARD_MARGIN })
  })

  it('docks to the right edge, level with the pin, when nothing fits; only then it may cover R', () => {
    const target = { left: 100, top: 40, width: 1240, height: 820 }
    const placement = place(target, { pin: { x: 300, y: 400 } })
    expect(placement).toEqual({ kind: 'card', side: 'dock', left: 1440 - CARD_WIDTH - CARD_MARGIN, top: 388, overlaps: true })
  })

  it('docks to the left edge when the pin is in the right 40% of the viewport', () => {
    const target = { left: 100, top: 40, width: 1240, height: 820 }
    expect(place(target, { pin: { x: 1000, y: 400 } })).toMatchObject({ side: 'dock', left: CARD_MARGIN })
  })

  it('shortens a card that is taller than the viewport allows, beside R', () => {
    const target = { left: 500, top: 200, width: 100, height: 40 }
    expect(place(target, { card: { width: CARD_WIDTH, height: 890 } })).toMatchObject({ side: 'right', top: CARD_MARGIN, maxHeight: 900 - 2 * CARD_MARGIN })
  })

  it('shrinks to a stub at the edge R left through', () => {
    expect(place({ left: 300, top: -200, width: 200, height: 100 })).toEqual({ kind: 'stub', edge: 'above', left: 300 })
    expect(place({ left: 300, top: 950, width: 200, height: 100 })).toEqual({ kind: 'stub', edge: 'below', left: 300 })
  })

  it('docks a whole-page card above the toolbar, on its side of the screen', () => {
    expect(place(null)).toEqual({ kind: 'card', side: 'toolbar', left: 16, top: 844 - CARD_MARGIN + 4 - 300, overlaps: false })
    const right = { left: 1004, top: 844, width: 420, height: 40 }
    expect(place(null, { toolbar: right })).toMatchObject({ left: 1004 + 420 - CARD_WIDTH })
    const centered = { left: 510, top: 844, width: 420, height: 40 }
    expect(place(null, { toolbar: centered })).toMatchObject({ left: 720 - CARD_WIDTH / 2 })
    const top = { left: 16, top: 16, width: 420, height: 40 }
    expect(place(null, { toolbar: top })).toMatchObject({ top: 16 + 40 + SURFACE_GAP })
  })
})

describe('placeCard and the page\'s words', () => {
  const target = { left: 560, top: 200, width: 300, height: 80 }
  const wordsRight = [{ left: 880, top: 180, width: 500, height: 400 }]

  it('takes the side that covers fewer words when both have room for the whole card', () => {
    expect(place(target)).toMatchObject({ side: 'right' })
    expect(place(target, { text: wordsRight })).toMatchObject({ side: 'left' })
  })
  it('stays on the side it stood on unless another covers far fewer words', () => {
    const fewWordsLeft = [{ left: 300, top: 220, width: 20, height: 20 }]
    expect(place(target, { text: fewWordsLeft })).toMatchObject({ side: 'right' })
    expect(place(target, { text: fewWordsLeft, prefer: 'left' })).toMatchObject({ side: 'left' })
    expect(place(target, { text: wordsRight, prefer: 'right' })).toMatchObject({ side: 'left' })
  })
  it('slides a card under a wide element off the words beside it, keeping the pin over it', () => {
    const heading = { left: 70, top: 140, width: 1860, height: 120 }
    const pin = { x: 1266, y: 180 }
    const paragraph = [{ left: 70, top: 290, width: 940, height: 40 }, { left: 70, top: 330, width: 950, height: 40 }]
    const placement = placeCard({ target: heading, pin, card, viewport: { width: 2000, height: 1100 }, toolbar, text: paragraph })
    if (placement.kind !== 'card') throw new Error('expected a card')
    expect(placement.side).toBe('below')
    expect(placement.left).toBeGreaterThanOrEqual(1020)
    expect(placement.left).toBeLessThanOrEqual(pin.x)
    expect(placement.left + CARD_WIDTH).toBeGreaterThanOrEqual(pin.x)
  })
  it('still covers words when no side is free of them', () => {
    const everywhere = [{ left: 0, top: 0, width: 1440, height: 900 }]
    expect(place(target, { text: everywhere })).toMatchObject({ kind: 'card', side: 'right' })
  })
})

describe('followsTarget', () => {
  it('holds for a card on any side of R, where that side puts it', () => {
    const narrow = { width: 700, height: 900 }
    const right = { left: 400, top: 200, width: 200, height: 60 }
    const left = { left: 1000, top: 200, width: 300, height: 60 }
    const below = { left: 200, top: 100, width: 300, height: 80 }
    const above = { left: 200, top: 520, width: 300, height: 300 }
    expect(followsTarget(place(right), right, card)).toBe(true)
    expect(followsTarget(place(left), left, card)).toBe(true)
    expect(followsTarget(place(below, { viewport: narrow }), below, card)).toBe(true)
    expect(followsTarget(place(above, { viewport: narrow }), above, card)).toBe(true)
  })

  it('fails for a card held on screen while R goes past the top edge', () => {
    const target = { left: 400, top: -40, width: 200, height: 60 }
    const placement = place(target)
    expect(placement).toMatchObject({ kind: 'card', side: 'right', top: CARD_MARGIN })
    expect(followsTarget(placement, target, card)).toBe(false)
  })

  it('fails for whole-page cards and stubs', () => {
    const offscreen = { left: 400, top: -400, width: 200, height: 60 }
    expect(followsTarget(place(null), { left: 0, top: 0, width: 0, height: 0 }, card)).toBe(false)
    expect(followsTarget(place(offscreen), offscreen, card)).toBe(false)
  })
})

describe('a card for a full-width heading, pinned at its right end', () => {
  for (const width of [1440, 2000]) {
    it(`opens under the pin at ${width} wide, with a leader to it`, () => {
      const heading = { left: 90, top: 140, width: width - 180, height: 120 }
      const pin = { x: Math.round(width * 0.78), y: 175 }
      const label = { left: pin.x + 8, top: pin.y - 32, width: 50, height: 24 }
      const placement = placeCard({ target: union([heading, label]), pin, card, viewport: { width, height: 900 }, toolbar })
      if (placement.kind !== 'card') throw new Error('expected a card')
      expect(placement.side).toBe('below')
      expect(placement.left).toBeLessThanOrEqual(pin.x)
      expect(placement.left + CARD_WIDTH).toBeGreaterThanOrEqual(pin.x)
      const route = leaderRoute({ left: placement.left, top: placement.top, ...card }, label, [heading])
      expect(route.length).toBeGreaterThan(1)
    })
  }
})

describe('leaderLine', () => {
  const label = { left: 500, top: 300, width: 30, height: 22 }

  it('runs straight from the card edge when the label is level with it', () => {
    expect(leaderLine({ left: 600, top: 250, width: 320, height: 300 }, label)).toEqual([
      { x: 600, y: 311 },
      { x: 530, y: 311 },
    ])
  })

  it('turns once toward the label when it sits above or below the card', () => {
    expect(leaderLine({ left: 600, top: 400, width: 320, height: 300 }, label)).toEqual([
      { x: 600, y: 416 },
      { x: 515, y: 416 },
      { x: 515, y: 322 },
    ])
    expect(leaderLine({ left: 380, top: 400, width: 320, height: 200 }, label)).toEqual([
      { x: 515, y: 400 },
      { x: 515, y: 322 },
    ])
  })

  it('is empty when the card overlaps the label', () => {
    expect(leaderLine({ left: 490, top: 290, width: 320, height: 300 }, label)).toEqual([])
  })
})

describe('clusterPins (ux.md 7.2)', () => {
  const pin = (id: string, left: number, top: number): { id: string } & Rect => ({ id, left, top, width: 30, height: 31 })

  it('merges pins whose boxes come within 24px, transitively', () => {
    const clusters = clusterPins([pin('a', 0, 0), pin('b', 50, 0), pin('c', 100, 0), pin('d', 400, 400)])
    expect(clusters.map((cluster) => cluster.ids)).toEqual([['a', 'b', 'c'], ['d']])
    expect(clusters[0]!.box).toEqual({ left: 0, top: 0, width: 130, height: 31 })
  })

  it('keeps pins further apart than 24px separate', () => {
    expect(clusterPins([pin('a', 0, 0), pin('b', 55, 0)]).map((cluster) => cluster.ids)).toEqual([['a'], ['b']])
    expect(clusterPins([pin('a', 0, 0), pin('b', 0, 50)]).map((cluster) => cluster.ids)).toEqual([['a', 'b']])
  })
})

describe('tickTop (ux.md 7.5)', () => {
  it('puts a comment at its proportional place in the document, inside the viewport', () => {
    expect(tickTop(0, 3000, 900)).toBe(0)
    expect(tickTop(1500, 3000, 900)).toBe(450)
    expect(tickTop(3000, 3000, 900)).toBe(897)
    expect(tickTop(100, 0, 900)).toBe(0)
  })
})

describe('leaderCrosses', () => {
  const mark = { left: 100, top: 100, width: 200, height: 40 }
  it('catches a line through the marked element', () => {
    expect(leaderCrosses([{ x: 200, y: 50 }, { x: 200, y: 300 }], [mark])).toBe(true)
  })
  it('allows a line that only touches it with its ends', () => {
    expect(leaderCrosses([{ x: 200, y: 130 }, { x: 200, y: 300 }], [mark])).toBe(false)
    expect(leaderCrosses([{ x: 400, y: 50 }, { x: 400, y: 300 }], [mark])).toBe(false)
  })
})

describe('leaderRoute', () => {
  const card = { left: 500, top: 420, width: CARD_WIDTH, height: 200 }
  const label = { left: 655, top: 333, width: 24, height: 24 }
  const marked = { left: 529, top: 371, width: 118, height: 32 }

  it('leaves the leader out rather than run it through words on the page', () => {
    expect(leaderRoute(card, label, [marked], [{ left: 65, top: 371, width: 671, height: 32 }])).toEqual([])
  })
  it('draws it where the words end before it', () => {
    expect(leaderRoute(card, label, [marked], [{ left: 65, top: 371, width: 582, height: 32 }]).length).toBeGreaterThan(1)
    expect(leaderRoute(card, label, [marked]).length).toBeGreaterThan(1)
  })
})

describe('nearestFree', () => {
  const area = screenArea(viewport)
  const box = { left: 100, top: 100, width: 200, height: 100 }

  it('keeps a box that is already clear', () => {
    expect(nearestFree(box, area, [])).toEqual(box)
  })
  it('moves as little as it can, and stays the gap away', () => {
    const obstacle = { left: 100, top: 180, width: 200, height: 40 }
    expect(nearestFree(box, area, [obstacle])).toEqual({ ...box, top: 180 - SURFACE_GAP - 100 })
  })
  it('slides only along the axis it is given', () => {
    const obstacle = { left: 90, top: 90, width: 800, height: 700 }
    expect(nearestFree(box, area, [obstacle], { axis: 'x' })).toMatchObject({ top: 100, left: 898 })
    expect(nearestFree(box, area, [{ ...obstacle, height: 788 }], { axis: 'y' })).toBeNull()
  })
  it('returns null when nothing is free', () => {
    expect(nearestFree(box, area, [{ left: 0, top: 0, width: 1440, height: 900 }])).toBeNull()
  })
})

describe('placeCard with the toolbar in every spot', () => {
  const size = { width: 400, height: 44 }
  const spots: Array<[string, Rect]> = [
    ['bottom-left', { left: 16, top: 840, ...size }],
    ['bottom-center', { left: 520, top: 840, ...size }],
    ['bottom-right', { left: 1024, top: 840, ...size }],
    ['top-left', { left: 16, top: 16, ...size }],
    ['top-right', { left: 1024, top: 16, ...size }],
    ['custom, mid-screen', { left: 430, top: 400, ...size }],
    ['custom, against the elements', { left: 300, top: 760, ...size }],
  ]
  const targets: Array<[string, Rect]> = [
    ['at the very bottom left', { left: 40, top: 800, width: 300, height: 60 }],
    ['at the very bottom center', { left: 560, top: 820, width: 300, height: 60 }],
    ['at the very bottom right', { left: 1100, top: 820, width: 300, height: 60 }],
    ['at the very top', { left: 560, top: 10, width: 300, height: 60 }],
    ['full width at the bottom', { left: 20, top: 760, width: 1400, height: 120 }],
  ]

  for (const [spot, toolbarBox] of spots) {
    for (const [where, target] of targets) {
      it(`never covers the toolbar at ${spot} with R ${where}`, () => {
        const tall = { width: CARD_WIDTH, height: 480 }
        const placement = place(target, { toolbar: toolbarBox, card: tall })
        if (placement.kind !== 'card') throw new Error('expected a card')
        const box = { left: placement.left, top: placement.top, width: CARD_WIDTH, height: placement.maxHeight ?? tall.height }
        expect(intersects(box, toolbarBox)).toBe(false)
        expect(box.top).toBeGreaterThanOrEqual(CARD_MARGIN)
        expect(box.top + box.height).toBeLessThanOrEqual(900 - CARD_MARGIN)
      })
    }
  }

  it('slides up beside R instead of sitting on the bar', () => {
    const target = { left: 40, top: 800, width: 300, height: 60 }
    const bar = { left: 340, top: 840, ...size }
    const placement = place(target, { toolbar: bar })
    expect(placement).toMatchObject({ side: 'right', left: 352 })
    expect(cardRect(placement).top + 300).toBeLessThanOrEqual(840 - SURFACE_GAP)
  })

  it('flips to the other side before it shortens', () => {
    const target = { left: 500, top: 600, width: 300, height: 60 }
    const wall = { left: 812, top: 12, width: 40, height: 876 }
    expect(place(target, { obstacles: [wall] })).toMatchObject({ side: 'left' })
  })

  it('shortens only when no side has room for all of it', () => {
    const short = { width: 1000, height: 420 }
    const bar = { left: 300, top: 360, ...size }
    const placement = place({ left: 60, top: 300, width: 860, height: 40 }, { viewport: short, toolbar: bar, card: { width: CARD_WIDTH, height: 400 } })
    if (placement.kind !== 'card') throw new Error('expected a card')
    expect(placement.maxHeight).toBeDefined()
    expect(placement.maxHeight!).toBeGreaterThanOrEqual(200)
    expect(intersects({ left: placement.left, top: placement.top, width: CARD_WIDTH, height: placement.maxHeight! }, bar)).toBe(false)
  })

  it('prefers a whole card at the screen edge to a shortened one, when that leaves R clear', () => {
    const laptop = { width: 1280, height: 800 }
    const ticks = { left: 1264, top: 0, width: 16, height: 800 }
    const bar = { left: 16, top: 744, width: 540, height: 40 }
    const wide = { left: 57, top: 320, width: 660, height: 150 }
    const placement = place(wide, { viewport: laptop, toolbar: bar, obstacles: [ticks], pin: { x: 690, y: 330 }, card: { width: CARD_WIDTH, height: 390 } })
    expect(placement).toMatchObject({ kind: 'card', side: 'dock', left: 1264 - SURFACE_GAP - CARD_WIDTH, overlaps: false })
    if (placement.kind !== 'card') throw new Error('expected a card')
    expect(placement.maxHeight).toBeUndefined()
  })

  it('docks whole-page cards against the bar on either edge, shortening to fit', () => {
    expect(dockByToolbar(card, viewport, spots[0]![1])).toMatchObject({ left: 16, top: 840 - SURFACE_GAP - 300 })
    expect(dockByToolbar(card, viewport, spots[3]![1])).toMatchObject({ left: 16, top: 60 + SURFACE_GAP })
    expect(dockByToolbar({ width: CARD_WIDTH, height: 860 }, viewport, spots[0]![1])).toMatchObject({ top: CARD_MARGIN, maxHeight: 840 - SURFACE_GAP - CARD_MARGIN })
  })
})

describe('textLines', () => {
  it('joins the runs of one line, keeps lines apart, and keeps columns apart', () => {
    const runs = [
      { left: 10, top: 100, width: 200, height: 20 },
      { left: 210, top: 102, width: 40, height: 16 },
      { left: 10, top: 124, width: 120, height: 20 },
      { left: 600, top: 100, width: 80, height: 20 },
    ]
    expect(textLines(runs)).toEqual([
      { left: 10, top: 100, width: 240, height: 20 },
      { left: 600, top: 100, width: 80, height: 20 },
      { left: 10, top: 124, width: 120, height: 20 },
    ])
  })
})

describe('dotOnText', () => {
  const paragraph = textLines([
    { left: 40, top: 200, width: 620, height: 24 },
    { left: 40, top: 224, width: 600, height: 24 },
    { left: 40, top: 248, width: 180, height: 24 },
  ])

  it('puts a spoken comment, with no point, just past the end of the first line', () => {
    expect(dotOnText(paragraph, null, 1440)).toEqual({ x: 666, y: 212 })
  })
  it('follows the line that was pointed at, even where it wrapped short', () => {
    expect(dotOnText(paragraph, { x: 600, y: 255 }, 1440)).toEqual({ x: 226, y: 260 })
  })
  it('puts it beside the words of a short heading, not at the far edge of its wide box', () => {
    const heading = textLines([{ left: 40, top: 80, width: 300, height: 48 }])
    expect(dotOnText(heading, { x: 1300, y: 90 }, 1440)).toEqual({ x: 346, y: 104 })
  })
  it('puts it just past a button\'s label', () => {
    expect(dotOnText(textLines([{ left: 120, top: 400, width: 90, height: 18 }]), null, 390)).toEqual({ x: 216, y: 409 })
  })
  it('goes before a line that runs to the right edge of the screen', () => {
    expect(dotOnText(textLines([{ left: 40, top: 100, width: 346, height: 20 }]), null, 390)).toEqual({ x: 34, y: 110 })
  })
  it('goes before a line whose end leaves no room for a label to open to the right', () => {
    expect(dotOnText(textLines([{ left: 16, top: 100, width: 347, height: 20 }]), null, 390)).toEqual({ x: 10, y: 110 })
  })
  it('on a narrow screen, takes the nearest line whose end leaves room for the label', () => {
    const heading = textLines([{ left: 18, top: 90, width: 350, height: 48 }, { left: 18, top: 138, width: 112, height: 48 }])
    expect(dotOnText(heading, { x: 300, y: 100 }, 390)).toEqual({ x: 136, y: 162 })
    expect(dotOnText(heading, null, 390)).toEqual({ x: 136, y: 162 })
    expect(dotOnText(heading, { x: 300, y: 100 }, 1440)).toEqual({ x: 374, y: 114 })
  })
  it('has nowhere to go without text', () => {
    expect(dotOnText([], { x: 10, y: 10 }, 390)).toBeNull()
  })
  it('goes above the end of a line that fills the screen from edge to edge', () => {
    expect(dotOnText(textLines([{ left: 2, top: 100, width: 386, height: 20 }]), null, 390)).toEqual({ x: 383, y: 94 })
  })
})

describe('dotAfterWords', () => {
  const heading = { left: 65, top: 260, width: 400, height: 60 }
  const paragraph = [
    { left: 65, top: 371, width: 671, height: 32 },
    { left: 65, top: 405, width: 615, height: 32 },
    { left: 65, top: 439, width: 548, height: 32 },
  ]
  const page = [heading, ...paragraph]

  it('puts the dot just past the selected words when nothing follows them on the line', () => {
    expect(dotAfterWords([{ left: 600, top: 405, width: 80, height: 32 }], page, 1440)).toEqual({ x: 686, y: 421 })
  })
  it('puts it just above the end of the words when the line goes on and the space above is clear', () => {
    expect(dotAfterWords([{ left: 529, top: 371, width: 118, height: 32 }], page, 1440)).toEqual({ x: 647, y: 365 })
  })
  it('puts it just below the end of the words on a paragraph\'s last line', () => {
    expect(dotAfterWords([{ left: 200, top: 439, width: 100, height: 32 }], page, 1440)).toEqual({ x: 300, y: 477 })
  })
  it('follows the last line of a selection that wraps', () => {
    expect(dotAfterWords([{ left: 600, top: 371, width: 136, height: 32 }, { left: 65, top: 405, width: 0, height: 32 }, { left: 65, top: 405, width: 615, height: 32 }], page, 1440)).toEqual({ x: 686, y: 421 })
  })
  it('finds no spot inside a paragraph, where words are on every side', () => {
    expect(dotAfterWords([{ left: 300, top: 405, width: 100, height: 32 }], page, 1440)).toBeNull()
  })
  it('finds no spot where the label has no room to open beside the dot', () => {
    expect(dotAfterWords([{ left: 100, top: 100, width: 250, height: 20 }], [{ left: 100, top: 100, width: 250, height: 20 }], 390)).toBeNull()
  })
  it('has nothing to pin without words', () => {
    expect(dotAfterWords([], page, 1440)).toBeNull()
  })
})

describe('placeFaces', () => {
  const bounds = pinBounds(390, 0)
  const pin = (id: string, x: number, y: number, surroundings: PinRequest['surroundings'] = null): PinRequest => ({ id, dot: { x, y }, width: 30, surroundings })

  it('prefers up and to the right', () => {
    expect(placeFaces([pin('a', 100, 200)], bounds).get('a')?.side).toBe('up-right')
  })
  it('opens to the left against the right edge, and below against the top', () => {
    expect(placeFaces([pin('a', 360, 200)], bounds).get('a')?.side).toBe('up-left')
    expect(placeFaces([pin('a', 100, 20)], bounds).get('a')?.side).toBe('down-right')
    expect(placeFaces([pin('a', 360, 20)], bounds).get('a')?.side).toBe('down-left')
  })
  it('measures the top from the document, so a pin never changes sides as the page scrolls', () => {
    expect(placeFaces([pin('a', 100, 20)], pinBounds(390, 600)).get('a')?.side).toBe('up-right')
  })
  it('keeps the label off the words around it', () => {
    const words = { text: [{ left: -200, top: -40, width: 400, height: 24 }], controls: [] }
    expect(placeFaces([pin('a', 100, 200, words)], bounds).get('a')?.side).toBe('down-right')
  })
  it('takes the side with the least words when every side has some', () => {
    const words = { text: [{ left: -200, top: -40, width: 400, height: 24 }, { left: -200, top: 6, width: 400, height: 6 }], controls: [] }
    expect(placeFaces([pin('a', 100, 200, words)], bounds).get('a')?.side).toMatch(/^down/)
  })
  it('keeps off a button when a side is free', () => {
    const button = { text: [], controls: [{ left: 0, top: -40, width: 60, height: 40 }] }
    expect(placeFaces([pin('a', 100, 200, button)], bounds).get('a')?.side).toBe('down-right')
  })
  it('keeps clear of the corner of the button its dot is in, not just off it', () => {
    const button = { left: -127.5, top: -24, width: 142, height: 48 }
    const surroundings = { text: [{ left: -110, top: -10, width: 104, height: 20 }], controls: [button] }
    const wide = pinBounds(1440, 0)
    const { side, reach } = placeFaces([{ id: 'a', dot: { x: 0, y: 0 }, width: 33, surroundings }], wide).get('a')!
    const face = faceBox({ x: 0, y: 0 }, 33, side, wide, reach)
    const apart = Math.max(face.left - (button.left + button.width), button.left - (face.left + face.width), face.top - (button.top + button.height), button.top - (face.top + face.height))
    expect(apart).toBeGreaterThanOrEqual(8)
  })
  it('finds the one side that is free of both words and a button', () => {
    const crowded = {
      text: [{ left: -100, top: 0, width: 200, height: 40 }, { left: -100, top: -40, width: 99, height: 40 }],
      controls: [{ left: -1, top: -40, width: 61, height: 41 }],
    }
    expect(placeFaces([pin('a', 100, 200, crowded)], bounds).get('a')?.side).toBe('up-right')
  })
  it('stays up and to the right when it only grazes a letter', () => {
    const graze = { text: [{ left: 10, top: -34, width: 4, height: 4 }], controls: [] }
    expect(placeFaces([pin('a', 100, 200, graze)], bounds).get('a')?.side).toBe('up-right')
  })
  it('keeps the label on the right and drops it below before crossing to the left', () => {
    const above = { text: [{ left: -300, top: -40, width: 600, height: 36 }], controls: [] }
    expect(placeFaces([pin('a', 100, 200, above)], bounds).get('a')?.side).toBe('down-right')
  })
  it('puts the label below and to the right of a dot at the end of a line with more text above, as drawn', () => {
    const words = [
      { left: 90, top: 430, width: 700, height: 36 },
      { left: 790, top: 430, width: 530, height: 36 },
      { left: 90, top: 466, width: 330, height: 36 },
      { left: 420, top: 466, width: 230, height: 36 },
      { left: 90, top: 502, width: 380, height: 36 },
    ]
    const dot = dotOnText(textLines(words), { x: 400, y: 480 }, 1440)!
    expect(dot).toEqual({ x: 656, y: 484 })
    const wide = pinBounds(1440, 0)
    const { side, reach } = placeFaces([{ id: 'a', dot, width: 30, surroundings: aroundDot(dot, words, []) }], wide).get('a')!
    expect(side).toBe('down-right')
    const face = faceBox(dot, 30, side, wide, reach)
    expect(face).toEqual({ left: 664, top: 492, width: 30, height: 24 })
    const corner = faceCorner(face, side)
    expect(corner.x > dot.x && corner.y > dot.y).toBe(true)
    const tip = { left: dot.x, top: dot.y, width: corner.x - dot.x, height: corner.y - dot.y }
    expect(words.some((word) => intersects(word, face) || intersects(word, tip))).toBe(false)
  })
  it('keeps two pins\' labels off each other and off each other\'s dots', () => {
    const sides = placeFaces([pin('a', 100, 200), pin('b', 120, 190)], bounds)
    expect(sides.get('a')).not.toEqual({ side: 'up-right', reach: { x: 8, y: 8 } })
    const first = faceBox({ x: 100, y: 200 }, 30, sides.get('a')!.side, bounds, sides.get('a')!.reach)
    const second = faceBox({ x: 120, y: 190 }, 30, sides.get('b')!.side, bounds, sides.get('b')!.reach)
    expect(intersects(first, second)).toBe(false)
  })
  it('goes further on a longer line into empty space rather than onto words', () => {
    const words = { text: [{ left: -300, top: -48, width: 360, height: 24 }, { left: -300, top: -12, width: 0.1, height: 24 }, { left: -300, top: 24, width: 340, height: 24 }], controls: [] }
    const place = placeFaces([pin('a', 300, 300, words)], pinBounds(1440, 0)).get('a')!
    const face = faceBox({ x: 300, y: 300 }, 30, place.side, pinBounds(1440, 0), place.reach)
    const around = words.text.map((rect) => ({ ...rect, left: rect.left + 300, top: rect.top + 300 }))
    expect(around.some((rect) => intersects(rect, face))).toBe(false)
    expect(place.reach.x + place.reach.y).toBeGreaterThan(16)
  })
  it('reaches less far on a phone', () => {
    const wall = { text: [{ left: -400, top: -200, width: 800, height: 400 }], controls: [] }
    const place = placeFaces([pin('a', 200, 300, wall)], pinBounds(390, 0)).get('a')!
    expect(Math.max(place.reach.x, place.reach.y)).toBeLessThanOrEqual(64)
  })
  it('stays on screen at every edge, for a two-digit label too', () => {
    for (const [x, y] of [[6, 300], [384, 300], [200, 6], [6, 6], [384, 6], [389, 300]] as const) {
      const wide = { ...pin('a', x, y), width: 40 }
      const place = placeFaces([wide], bounds).get('a')!
      const face = faceBox(wide.dot, 40, place.side, bounds, place.reach)
      expect(face.left).toBeGreaterThanOrEqual(bounds.left)
      expect(face.left + face.width).toBeLessThanOrEqual(bounds.right)
      expect(face.top).toBeGreaterThanOrEqual(bounds.top)
    }
  })
})

describe('faceBox inside a margin', () => {
  const bounds = pinBounds(390, 0)

  it('slides the label away from a dot that sits inside the margin, and the tip reaches further', () => {
    const dot = { x: 384, y: 300 }
    expect(placeFaces([{ id: 'a', dot, width: 40, surroundings: null }], bounds).get('a')?.side).toBe('up-left')
    const face = faceBox(dot, 40, 'up-left', bounds)
    expect(face).toEqual({ left: 330, top: 268, width: 40, height: 24 })
    expect(faceCorner(face, 'up-left')).toEqual({ x: 370, y: 292 })
    expect(pinOutline(dot, 40, 'up-left', bounds)).toEqual({ left: 330, top: 268, width: 57, height: 35 })
  })
  it('never slides a label back over its dot', () => {
    expect(faceBox({ x: 384, y: 300 }, 40, 'up-right', bounds).left).toBe(392)
    expect(faceBox({ x: 384, y: 300 }, 40, 'up-right', bounds).left).toBe(faceBox({ x: 384, y: 300 }, 40, 'up-right').left)
  })
  it('leaves a label that fits where it is', () => {
    expect(faceBox({ x: 100, y: 300 }, 40, 'up-left', bounds)).toEqual(faceBox({ x: 100, y: 300 }, 40, 'up-left'))
  })
})

describe('aroundDot', () => {
  it('keeps what a label could reach, relative to the dot, so scrolling changes nothing', () => {
    const text = [{ left: 90, top: 190, width: 40, height: 20 }, { left: 900, top: 190, width: 40, height: 20 }, { left: 90, top: 400, width: 40, height: 20 }]
    expect(aroundDot({ x: 100, y: 200 }, text, [])).toEqual({ text: [{ left: -10, top: -10, width: 40, height: 20 }], controls: [] })
    expect(aroundDot({ x: 100, y: -300 }, text.map((rect) => ({ ...rect, top: rect.top - 500 })), [])).toEqual(aroundDot({ x: 100, y: 200 }, text, []))
  })
})

describe('placeFaces with an arrival\'s words', () => {
  const wide = pinBounds(1440, 0)
  const arrival = (id: string, x: number, y: number, wanted = 240, minimum = 150): PinRequest => ({ id, dot: { x, y }, width: 40, surroundings: null, peek: { wanted, minimum } })
  const face = (request: PinRequest, place: LabelPlace) => faceBox(request.dot, request.width, place.side, wide, place.reach)

  it('opens the words to the right of a label up and to the right when they fit', () => {
    expect(placeFaces([arrival('a', 300, 300)], wide).get('a')).toEqual({ side: 'up-right', reach: { x: 8, y: 8 }, peek: { left: false, room: 240 } })
  })
  it('opens them away from the dot, to the left, near the right edge', () => {
    const place = placeFaces([arrival('a', 1400, 300)], wide).get('a')!
    expect(place.side).toBe('up-left')
    expect(place.peek).toEqual({ left: true, room: 240 })
  })
  it('takes the label further out, on a longer line, to a row where all the words fit', () => {
    const request = arrival('a', 300, 300)
    const words = [{ left: 0, top: 262, width: 280, height: 80 }, { left: 360, top: 262, width: 1000, height: 80 }]
    const place = placeFaces([request], wide, { peekObstacles: words }).get('a')!
    expect(place.peek).toEqual({ left: false, room: 240 })
    expect(place.reach.y).toBeGreaterThan(8)
    const box = wordsBox(face(request, place), place.peek!)
    expect(words.some((word) => intersects(word, box))).toBe(false)
  })
  const between = (request: PinRequest, left: number, right: number): [PinRequest, Rect[]] => {
    const walls = [{ left: 0, top: 0, width: left, height: 900 }, { left: right, top: 0, width: 1440 - right, height: 900 }]
    return [{ ...request, surroundings: aroundDot(request.dot, walls, []) }, walls]
  }

  it('shortens the words only when no place within reach fits them all', () => {
    const [request, walls] = between(arrival('a', 300, 300), 200, 420)
    const place = placeFaces([request], wide, { peekObstacles: walls }).get('a')!
    expect(place.peek!.room).toBeLessThan(240)
    expect(place.peek!.room).toBeGreaterThanOrEqual(150)
    expect(walls.some((wall) => intersects(wall, wordsBox(face(request, place), place.peek!)))).toBe(false)
  })
  it('drops the words when nothing within reach fits a few, and still places the label', () => {
    const [request, walls] = between(arrival('a', 300, 300), 250, 360)
    const place = placeFaces([request], wide, { peekObstacles: walls }).get('a')!
    expect(place.peek).toBeUndefined()
    expect(place.side).toBe('up-right')
  })
  it('shows a short comment whole, which needs only its own length', () => {
    const [request, walls] = between(arrival('a', 300, 300, 80), 250, 440)
    expect(placeFaces([request], wide, { peekObstacles: walls }).get('a')?.peek).toEqual({ left: false, room: 80 })
  })
  it('keeps two arrivals\' words off each other, the earlier one first', () => {
    const first = arrival('first', 300, 300)
    const second = arrival('second', 420, 300)
    const places = placeFaces([first, second], wide)
    expect(places.get('first')?.peek).toEqual({ left: false, room: 240 })
    const firstWords = wordsBox(face(first, places.get('first')!), places.get('first')!.peek!)
    const secondPlace = places.get('second')!
    expect(intersects(firstWords, face(second, secondPlace))).toBe(false)
    if (secondPlace.peek) expect(intersects(firstWords, wordsBox(face(second, secondPlace), secondPlace.peek))).toBe(false)
  })
  it('stays clear of an open card, as of anything in the way', () => {
    const openCard = { left: 340, top: 100, width: 320, height: 400 }
    const request = arrival('a', 300, 300)
    const place = placeFaces([request], wide, { peekObstacles: [openCard] }).get('a')!
    expect(place.peek).toBeDefined()
    expect(intersects(openCard, wordsBox(face(request, place), place.peek!))).toBe(false)
  })
})

describe('which way a label opens', () => {
  const bounds = pinBounds(1440, 0)
  const request = (dot: PinRequest['dot'], surroundings: PinRequest['surroundings'] = null): PinRequest => ({ id: 'a', dot, width: 30, surroundings })
  const left = { side: 'up-left' as const, reach: { x: 8, y: 8 } }

  it('leaves the left for a free place on the right, so the tip runs to the right of its dot', () => {
    const side = placeFaces([request({ x: 300, y: 300 })], bounds, { previous: new Map([['a', left]]) }).get('a')!.side
    expect(side).toBe('up-right')
  })
  it('stays left rather than cover words on the right', () => {
    const words = { text: [{ left: 0, top: -200, width: 400, height: 400 }], controls: [] }
    expect(placeFaces([request({ x: 300, y: 300 }, words)], bounds).get('a')!.side).toMatch(/left$/)
  })
  it('goes left when a label would not fit on the right', () => {
    expect(placeFaces([request({ x: bounds.right - 10, y: 300 })], bounds).get('a')!.side).toMatch(/left$/)
  })
})

describe('placeFaces from last time', () => {
  const bounds = pinBounds(1440, 0)
  const request = (surroundings: PinRequest['surroundings'] = null): PinRequest => ({ id: 'a', dot: { x: 300, y: 300 }, width: 30, surroundings })
  const before = { side: 'down-right' as const, reach: { x: 28, y: 16 } }

  it('keeps a label where it was while that place stays free, though a nearer one is free too', () => {
    expect(placeFaces([request()], bounds, { previous: new Map([['a', before]]) }).get('a')).toEqual(before)
  })
  it('moves it when words land under it, and only then', () => {
    const words = { text: [{ left: 0, top: 10, width: 80, height: 40 }], controls: [] }
    const place = placeFaces([request(words)], bounds, { previous: new Map([['a', before]]) }).get('a')!
    expect(place).not.toEqual(before)
    expect(place.side).toBe('up-right')
  })
  it('keeps the label out where its words had room once they have closed', () => {
    const peeked = { side: 'up-right' as const, reach: { x: 8, y: 28 }, peek: { left: false, room: 240 } }
    expect(placeFaces([request()], bounds, { previous: new Map([['a', peeked]]) }).get('a')).toEqual({ side: 'up-right', reach: { x: 8, y: 28 } })
  })
})

describe('placeFaces between neighbours', () => {
  it('keeps a label far enough from another pin that the two don\'t merge into a count', () => {
    const bounds = pinBounds(1440, 0)
    const requests: PinRequest[] = [
      { id: 'a', dot: { x: 300, y: 300 }, width: 30, surroundings: null },
      { id: 'b', dot: { x: 300, y: 350 }, width: 30, surroundings: null },
    ]
    const places = placeFaces(requests, bounds)
    const boxes = requests.map(({ id, dot, width }) => ({ id, ...pinOutline(dot, width, places.get(id)!.side, bounds, places.get(id)!.reach) }))
    expect(clusterPins(boxes, CLUSTER_DISTANCE)).toHaveLength(2)
  })
})
