import { describe, expect, it } from 'vitest'
import { isUnread, nextLine, pinName, pinState, presenceWords, replyActions, statusWords, threadActions, threadStatusWords } from '../src/lifecycle'
import type { Comment, Person } from '../src/protocol'
import { agent, dima, jonas, makeComment, makeReply, maya, v15 } from './helpers'

const labels = (comment: Comment, viewer: Person, othersReplied = false) => threadActions(comment, viewer, othersReplied).transitions.map((transition) => transition.label)
const menu = (comment: Comment, viewer: Person, othersReplied = false) => threadActions(comment, viewer, othersReplied).menu

const byMaya = (overrides: Partial<Comment>) => makeComment({ author: maya, ...overrides })
const fixedBy = { by: agent, version: v15, commit: '1a2b3c4', at: '2026-10-25T08:00:00.000000Z' }

describe('presenceWords', () => {
  const person = (display_name: string) => ({ id: display_name, display_name, role: 'reviewer' as const, ink: 1 })
  it('names people instead of counting them', () => {
    expect(presenceWords([])).toBe('')
    expect(presenceWords([person('Maya')])).toBe('Maya is here')
    expect(presenceWords([person('Maya'), person('Jonas')])).toBe('Maya and Jonas are here')
    expect(presenceWords([person('Maya'), person('Jonas'), person('Kai')])).toBe('Maya and 2 others are here')
  })
})

describe('threadActions: the buttons of ux.md 3.4 per status and role', () => {
  it('open: builders mark fixed or answered or close; the author withdraws or deletes; others get nothing', () => {
    const open = byMaya({ status: 'open' })
    expect(labels(open, dima)).toEqual(['Mark fixed', 'Mark answered', "Won't fix…", 'Duplicate of…'])
    expect(threadActions(open, dima, false).transitions.filter((transition) => transition.under === 'close').map((transition) => transition.label)).toEqual(["Won't fix…", 'Duplicate of…'])
    expect(labels(open, maya)).toEqual([])
    expect(labels(open, jonas)).toEqual([])
    expect(menu(open, jonas)).toEqual([])
  })

  it('texts: marking fixed is optional, answers and reasons are required, duplicates take a number', () => {
    const [fixed, answered, wontFix, duplicate] = threadActions(byMaya({ status: 'open' }), dima, false).transitions
    expect(fixed).toMatchObject({ to: 'fixed', text: 'optional' })
    expect(answered).toMatchObject({ to: 'answered', text: 'required' })
    expect(wontFix).toMatchObject({ to: 'resolved', resolution: 'wont_fix', text: 'required' })
    expect(duplicate).toMatchObject({ to: 'resolved', resolution: 'duplicate' })
  })

  it('the author deletes while nobody else has replied, then can only withdraw', () => {
    const open = byMaya({ status: 'open' })
    expect(menu(open, maya, false)).toContain('delete')
    expect(menu(open, maya, false)).not.toContain('withdraw')
    expect(menu(open, maya, true)).toContain('withdraw')
    expect(menu(open, maya, true)).not.toContain('delete')
    expect(menu(open, dima, true)).toContain('delete')
  })

  it('fixed and checkable: the author gets Looks fixed and Not yet; Not yet asks what is still wrong', () => {
    const fixed = byMaya({ status: 'fixed', checkable: true, fixed: fixedBy })
    expect(labels(fixed, maya)).toEqual(['Looks fixed', 'Not yet'])
    const [looksFixed, notYet] = threadActions(fixed, maya, true).transitions
    expect(looksFixed).toMatchObject({ to: 'resolved', resolution: 'confirmed', text: 'none' })
    expect(notYet).toMatchObject({ to: 'open', text: 'required', prompt: "What's still wrong?" })
  })

  it('fixed but not on this version: the author waits; builders can still confirm or reopen', () => {
    const fixed = byMaya({ status: 'fixed', checkable: false, fixed: fixedBy })
    expect(labels(fixed, maya)).toEqual([])
    expect(labels(fixed, dima)).toEqual(['Confirm', 'Reopen'])
  })

  it('answered: Got it and Follow up for the author, Confirm and Reopen for builders', () => {
    const answered = byMaya({ status: 'answered', checkable: true })
    expect(labels(answered, maya)).toEqual(['Got it', 'Follow up'])
    expect(labels(answered, dima)).toEqual(['Confirm', 'Reopen'])
    expect(labels(answered, jonas)).toEqual([])
  })

  it('resolved: the author reopens only what was confirmed or withdrawn; builders reopen anything', () => {
    for (const resolution of ['confirmed', 'withdrawn'] as const) expect(labels(byMaya({ status: 'resolved', resolution }), maya)).toEqual(['Reopen'])
    for (const resolution of ['wont_fix', 'duplicate'] as const) {
      expect(labels(byMaya({ status: 'resolved', resolution }), maya)).toEqual([])
      expect(labels(byMaya({ status: 'resolved', resolution }), dima)).toEqual(['Reopen'])
    }
  })

  it('agents are never offered a closing or reopening transition', () => {
    for (const status of ['open', 'fixed', 'answered', 'resolved'] as const) {
      const comment = makeComment({ author: agent, status, resolution: status === 'resolved' ? 'confirmed' : null, checkable: true })
      expect(labels(comment, agent)).toEqual([])
    }
  })

  it('builders show team-only items to everyone, copy for the agent and re-pin; reviewers never see those', () => {
    const team = makeComment({ author: dima, visibility: 'team' })
    expect(menu(team, dima)).toEqual(['edit', 'repin', 'show_to_everyone', 'copy_for_agent', 'delete'])
    expect(menu(byMaya({}), maya)).toEqual(['edit', 'repin', 'delete'])
    expect(menu(byMaya({}), jonas)).toEqual([])
  })

  it('replies: the author edits, builders and the author delete, team notes can be shown to everyone', () => {
    const thread = byMaya({})
    const note = makeReply(thread, { author: dima, visibility: 'team' })
    expect(replyActions(note, thread, dima)).toEqual(['edit', 'show_to_everyone', 'delete'])
    expect(replyActions(makeReply(thread, { author: jonas }), thread, maya)).toEqual([])
    expect(replyActions(makeReply(thread, { author: maya }), thread, maya)).toEqual(['edit', 'delete'])
  })
})

describe('status words and Next lines', () => {
  it("are the reviewer's words on their own comments", () => {
    expect(statusWords(byMaya({ status: 'open' }), maya, null)).toBeNull()
    expect(statusWords(byMaya({ status: 'fixed', checkable: false }), maya, null)).toBe('Marked fixed. Not on this version yet.')
    expect(statusWords(byMaya({ status: 'fixed', checkable: true }), maya, null)).toBe('Fixed - check it')
    expect(statusWords(byMaya({ status: 'answered' }), maya, null)).toBe('Answered')
    expect(statusWords(byMaya({ status: 'resolved', resolution: 'confirmed' }), maya, null)).toBe('Resolved')
    expect(statusWords(byMaya({ status: 'resolved', resolution: 'wont_fix' }), maya, 'Out of scope')).toBe("Won't fix: Out of scope")
    expect(statusWords(byMaya({ status: 'resolved', resolution: 'duplicate', duplicate_of: 12 }), maya, null)).toBe('Same as #12')
    expect(statusWords(byMaya({ status: 'fixed', checkable: true }), jonas, null)).toBe('Marked fixed')
  })

  it('leave out, under a thread, what a reply above already says', () => {
    const answered = byMaya({ status: 'answered' })
    const answer = makeReply(answered, { event: { status: 'answered', resolution: null } })
    expect(threadStatusWords(answered, maya, null, [answer])).toBeNull()
    expect(threadStatusWords(answered, jonas, null, [answer])).toBeNull()

    const fixed = byMaya({ status: 'fixed', checkable: true })
    const note = makeReply(fixed, { event: { status: 'fixed', resolution: null } })
    expect(threadStatusWords(fixed, jonas, null, [note])).toBeNull()
  })

  it('keep, under a thread, what no reply says and what the author has to do', () => {
    const fixed = byMaya({ status: 'fixed', checkable: true })
    const note = makeReply(fixed, { event: { status: 'fixed', resolution: null } })
    const reopened = makeReply(fixed, { event: { status: 'open', resolution: null } })
    expect(threadStatusWords(fixed, jonas, null, [])).toBe('Marked fixed')
    expect(threadStatusWords(fixed, jonas, null, [note, reopened])).toBe('Marked fixed')
    expect(threadStatusWords(fixed, maya, null, [note])).toBe('Fixed - check it')
    expect(threadStatusWords(byMaya({ status: 'fixed', checkable: false }), maya, null, [note])).toBe('Marked fixed. Not on this version yet.')
    expect(threadStatusWords(byMaya({ status: 'resolved', resolution: 'confirmed' }), maya, null, [])).toBe('Resolved')
  })

  it('are the "Next" lines builders read', () => {
    expect(nextLine(byMaya({ status: 'open' }), 'Lumen')).toBe('Next: the Lumen team')
    expect(nextLine(byMaya({ status: 'fixed', checkable: false }), 'Lumen')).toBe('Next: Maya checks it on a newer version')
    expect(nextLine(byMaya({ status: 'fixed', checkable: true }), 'Lumen')).toBe('Next: Maya checks the fix')
    expect(nextLine(byMaya({ status: 'answered' }), 'Lumen')).toBe('Next: Maya reads the answer')
    expect(nextLine(byMaya({ status: 'resolved', resolution: 'confirmed', resolved: { by: maya, version: v15, at: '' } }), 'Lumen')).toBe('Resolved · confirmed by Maya on v15')
  })
})

describe('pins', () => {
  it('carry state in the glyph and the accessible name, never color alone', () => {
    const fixed = byMaya({ number: 38, status: 'fixed', checkable: true, anchor: { selectors: [], label: "'Choose Pro' button" } })
    const state = pinState(fixed, maya, false, true)
    expect(state).toEqual({ visible: true, sending: false, done: true, checkIt: true, unread: true })
    expect(pinName(fixed, state)).toBe("Comment 38 by Maya on 'Choose Pro' button. Fixed, check it. New replies.")
    expect(pinState(byMaya({ status: 'resolved' }), maya, false, false).visible).toBe(false)
    expect(pinName(byMaya({ number: null }), pinState(byMaya({}), maya, true, false))).toMatch(/sending/)
  })

  it('count replies as unread only after a first look, and never my own', () => {
    const thread = byMaya({})
    const reply = makeReply(thread, { author: jonas, inserted_at: '2026-10-25T10:00:00.000000Z' })
    expect(isUnread(reply, maya, '2026-10-25T09:00:00.000000Z')).toBe(true)
    expect(isUnread(reply, maya, '2026-10-25T11:00:00.000000Z')).toBe(false)
    expect(isUnread(reply, maya, null)).toBe(false)
    expect(isUnread(reply, maya, null, new Set([reply.id]))).toBe(true)
    expect(isUnread({ ...reply, author: maya }, maya, '2026-10-25T09:00:00.000000Z')).toBe(false)
  })
})
