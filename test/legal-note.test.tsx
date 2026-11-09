import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Controller, MostraState } from '../src/controller'
import type { Transcription } from '../src/protocol'
import { createStore } from '../src/store'
import { ControllerContext } from '../src/ui/hooks'
import { LegalNote } from '../src/ui/Notices'

let root: HTMLElement

function show(talkTranscription: Transcription | null) {
  const store = createStore({
    talkTranscription,
  } as unknown as MostraState)
  const controller = { store } as unknown as Controller
  act(() => {
    render(
      <ControllerContext.Provider value={controller}>
        <LegalNote />
      </ControllerContext.Provider>,
      root,
    )
  })
  return root.querySelector('.fine')!
}

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>'
  root = document.querySelector('#root')!
})

afterEach(() => {
  act(() => {
    render(null, root)
  })
})

describe("the welcome card's small print", () => {
  it('links to the Terms and the Privacy Policy before any feedback is given', () => {
    const links = [...show(null).querySelectorAll('a')].map((link) => [link.textContent, link.href, link.target])
    expect(links).toEqual([
      ['Terms', 'https://mostra.design/terms', '_blank'],
      ['Privacy Policy', 'https://mostra.design/privacy#reviewers', '_blank'],
    ])
  })

  it('says nothing about voice where Talk is not offered or stays on the device', () => {
    expect(show(null).textContent).not.toContain('voice')
    expect(show('local').textContent).not.toContain('voice')
  })

  it("says the browser's maker may get the voice with browser speech recognition", () => {
    expect(show('browser').textContent).toContain("may send your voice to the browser's maker")
  })

  it('says the voice goes to a speech-to-text service with smart transcription', () => {
    expect(show('smart').textContent).toContain('sends your voice to a speech-to-text service')
  })
})
