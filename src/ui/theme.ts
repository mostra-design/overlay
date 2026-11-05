import tokens from '../../design/tokens.css?inline'
import type { Person } from '../protocol'
import styles from './styles.css?inline'

export const stylesheet = `${tokens}\n${styles}`

export function inkOf(person: Person | null | undefined): string {
  if (!person || person.role === 'agent' || !person.ink) return 'var(--color-action)'
  return `var(--color-reviewer-${((person.ink - 1) % 8) + 1})`
}

export function onInkOf(person: Person | null | undefined): string {
  return !person || person.role === 'agent' || !person.ink ? 'var(--color-action-ink)' : 'var(--color-on-reviewer)'
}

export function inkStyle(person: Person | null | undefined): Record<string, string> {
  return { '--ink': inkOf(person), '--on-ink': onInkOf(person) }
}
