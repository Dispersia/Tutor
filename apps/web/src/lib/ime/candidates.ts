import { api } from '../api'

interface CandidatesReply {
  candidates?: string[]
}

export async function lookupCandidates(lang: string, keys: string): Promise<string[]> {
  const query = keys.trim()
  if (!query) return []
  try {
    const reply = await api<CandidatesReply>('/api/ime/candidates', {
      method: 'POST',
      body: JSON.stringify({ lang, keys: query }),
    })
    return Array.isArray(reply.candidates) ? reply.candidates : []
  } catch {
    return []
  }
}
