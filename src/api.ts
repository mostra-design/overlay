import type { Person, Project } from './protocol'

export type ReviewerSession = { token: string; reviewer: Person; project: Project }

export type SetupProblem = 'unknown_project'

export type JoinProblem = { reason: 'invalid' | 'expired' | 'revoked'; fromName: string | null } | { reason: SetupProblem }

export type ReviewerSessionResult =
  | { ok: true; session: ReviewerSession }
  | { ok: false; error: 'refused'; problem: JoinProblem }
  | { ok: false; error: 'network' | 'server' }

export async function fetchProject(fetcher: typeof fetch, endpoint: string, projectKey: string): Promise<Project | SetupProblem> {
  const response = await fetcher(`${endpoint}/api/v1/projects/${encodeURIComponent(projectKey)}/config`, {
    headers: { accept: 'application/json' },
    credentials: 'omit',
  })
  if (response.status === 404) return 'unknown_project'
  if (!response.ok) throw new Error(`Project config request failed with ${response.status}`)
  const body = (await response.json()) as { project: Project }
  return body.project
}

export async function createReviewerSession(fetcher: typeof fetch, endpoint: string, params: { projectKey: string; invite: string; builderOnly?: boolean }): Promise<ReviewerSessionResult> {
  let response: Response
  try {
    response = await fetcher(`${endpoint}/api/v1/reviewer_sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ project_key: params.projectKey, invite_token: params.invite, ...(params.builderOnly ? { builder_only: true } : {}) }),
    })
  } catch {
    return { ok: false, error: 'network' }
  }

  if (response.status === 201) return { ok: true, session: (await response.json()) as ReviewerSession }
  if (response.status === 404) return { ok: false, error: 'refused', problem: { reason: 'unknown_project' } }
  if (response.status === 401) {
    const body = (await response.json().catch(() => ({}))) as { reason?: string; from_name?: string | null }
    const reason = body.reason === 'expired' || body.reason === 'revoked' ? body.reason : 'invalid'
    return { ok: false, error: 'refused', problem: { reason, fromName: body.from_name ?? null } }
  }
  return { ok: false, error: 'server' }
}
