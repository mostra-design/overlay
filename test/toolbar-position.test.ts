import { describe, expect, it } from 'vitest'
import { parseToolbarPosition, restToolbar, snapToolbar, SNAP_DISTANCE, toolbarBox, TOOLBAR_MARGIN, type ToolbarPosition } from '../src/toolbar-position'

const viewport = { width: 1440, height: 900 }
const size = { width: 400, height: 40 }
const center = (viewport.width - size.width) / 2
const rightEdge = viewport.width - size.width - TOOLBAR_MARGIN
const bottomEdge = viewport.height - size.height - TOOLBAR_MARGIN

const at = (left: number, top: number) => ({ left, top, ...size })
const rightEdgePosition: ToolbarPosition = { horizontal: 'right', x: TOOLBAR_MARGIN, vertical: 'bottom', y: TOOLBAR_MARGIN }

describe('parseToolbarPosition', () => {
  it('defaults to bottom left', () => {
    expect(parseToolbarPosition(null)).toEqual({ horizontal: 'left', x: TOOLBAR_MARGIN, vertical: 'bottom', y: TOOLBAR_MARGIN })
  })

  it('reads a stored position back as it was written', () => {
    const position: ToolbarPosition = { horizontal: 'right', x: 120, vertical: 'top', y: 300 }
    expect(parseToolbarPosition(JSON.stringify(position))).toEqual(position)
  })

  it.each(['', 'nonsense', 'constructor', 'bottom-center', '{"horizontal":"left"}', '{"horizontal":"sideways","x":1,"vertical":"top","y":1}', '{"horizontal":"left","x":"1","vertical":"top","y":1}', 'null', '[]'])(
    'falls back to bottom left for %j',
    (stored) => {
      expect(parseToolbarPosition(stored)).toEqual(parseToolbarPosition(null))
    },
  )
})

describe('snapToolbar', () => {
  it('stays exactly where it is put, away from every line', () => {
    expect(snapToolbar(at(187, 233), viewport)).toEqual(at(187, 233))
  })

  it.each([
    ['the left margin', TOOLBAR_MARGIN],
    ['the center line', center],
    ['the right margin', rightEdge],
  ])('settles on %s from either side, within reach', (_line, line) => {
    expect(snapToolbar(at(line + SNAP_DISTANCE, 300), viewport).left).toBe(line)
    if (line > TOOLBAR_MARGIN + SNAP_DISTANCE) expect(snapToolbar(at(line - SNAP_DISTANCE, 300), viewport).left).toBe(line)
  })

  it('lets go the moment it is past the reach, so nothing feels sticky', () => {
    expect(snapToolbar(at(center + SNAP_DISTANCE + 1, 300), viewport).left).toBe(center + SNAP_DISTANCE + 1)
    expect(snapToolbar(at(center - SNAP_DISTANCE - 1, 300), viewport).left).toBe(center - SNAP_DISTANCE - 1)
  })

  it('settles on the top and bottom margins too, each axis on its own', () => {
    expect(snapToolbar(at(187, bottomEdge - 6), viewport)).toEqual(at(187, bottomEdge))
    expect(snapToolbar(at(center + 6, TOOLBAR_MARGIN + 6), viewport)).toEqual(at(center, TOOLBAR_MARGIN))
  })

  it('stops at the margins, however far the pointer goes', () => {
    expect(snapToolbar(at(-500, -500), viewport)).toEqual(at(TOOLBAR_MARGIN, TOOLBAR_MARGIN))
    expect(snapToolbar(at(5000, 5000), viewport)).toEqual(at(rightEdge, bottomEdge))
  })

  it('takes the nearest line when two are in reach', () => {
    const narrow = { width: 440, height: 900 }
    expect(snapToolbar(at(19, 300), narrow).left).toBe(20)
    expect(snapToolbar(at(17, 300), narrow).left).toBe(TOOLBAR_MARGIN)
  })
})

describe('restToolbar', () => {
  it('keeps a bar on the center line centered, whatever the window', () => {
    const position = restToolbar(at(center, bottomEdge), viewport)
    expect(position).toEqual({ horizontal: 'center', x: 0, vertical: 'bottom', y: TOOLBAR_MARGIN })
    expect(toolbarBox(position, size, { width: 1000, height: 700 })).toEqual(at(300, 644))
  })

  it('measures from the nearest edge', () => {
    expect(restToolbar(at(100, 200), viewport)).toEqual({ horizontal: 'left', x: 100, vertical: 'top', y: 200 })
    expect(restToolbar(at(940, 600), viewport)).toEqual({ horizontal: 'right', x: 100, vertical: 'bottom', y: 260 })
  })

  it('measures from the center when that is nearest, on either side of it', () => {
    expect(restToolbar(at(center + 80, 300), viewport)).toMatchObject({ horizontal: 'center', x: 80 })
    expect(restToolbar(at(center - 80, 300), viewport)).toMatchObject({ horizontal: 'center', x: -80 })
  })

  it.each([
    [at(187, 233)],
    [at(center, bottomEdge)],
    [at(rightEdge, TOOLBAR_MARGIN)],
    [at(center + 80, 500)],
    [at(900, 600)],
  ])('comes back exactly where it was dropped: %j', (box) => {
    expect(toolbarBox(restToolbar(box, viewport), size, viewport)).toEqual(box)
  })
})

describe('toolbarBox', () => {
  it('stays on a screen that shrinks, and goes back when it grows', () => {
    const position = restToolbar(at(940, 600), viewport)
    const small = { width: 700, height: 420 }
    const box = toolbarBox(position, size, small)
    expect(box.left).toBeGreaterThanOrEqual(TOOLBAR_MARGIN)
    expect(box.left + box.width).toBeLessThanOrEqual(small.width - TOOLBAR_MARGIN)
    expect(box.top).toBeGreaterThanOrEqual(TOOLBAR_MARGIN)
    expect(box.top + box.height).toBeLessThanOrEqual(small.height - TOOLBAR_MARGIN)
    expect(toolbarBox(position, size, viewport)).toEqual(at(940, 600))
  })

  it('grows from the line it rests on: a right-hand bar grows leftwards, a centered one both ways', () => {
    const wider = { width: 600, height: 40 }
    expect(toolbarBox(rightEdgePosition, wider, viewport).left).toBe(viewport.width - 600 - TOOLBAR_MARGIN)
    expect(toolbarBox({ horizontal: 'center', x: 0, vertical: 'bottom', y: TOOLBAR_MARGIN }, wider, viewport).left).toBe(420)
    expect(toolbarBox(parseToolbarPosition(null), wider, viewport).left).toBe(TOOLBAR_MARGIN)
  })

  it('keeps a bar too wide for the screen at the left margin rather than off it', () => {
    expect(toolbarBox(rightEdgePosition, { width: 900, height: 40 }, { width: 700, height: 420 }).left).toBe(TOOLBAR_MARGIN)
  })
})
