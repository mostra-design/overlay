import { afterEach, describe, expect, it } from 'vitest'
import { HOST_TAG, peekDuration } from '../src/ui/mount'

describe('peekDuration', () => {
  afterEach(() => document.querySelector(HOST_TAG)?.remove())

  it('is nothing before the overlay is mounted', () => {
    expect(peekDuration(window)).toBeNull()
  })

  it('adds the delay and the time the host is given, however the CSS writes them', () => {
    const host = document.createElement(HOST_TAG)
    host.style.setProperty('--peek-delay', '.44s')
    host.style.setProperty('--peek-time', '7560ms')
    document.body.append(host)
    expect(peekDuration(window)).toBe(8000)
  })

  it('is nothing when a value is not a duration', () => {
    const host = document.createElement(HOST_TAG)
    host.style.setProperty('--peek-delay', 'soon')
    host.style.setProperty('--peek-time', '2960ms')
    document.body.append(host)
    expect(peekDuration(window)).toBeNull()
  })
})
