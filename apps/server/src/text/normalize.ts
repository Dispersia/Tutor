export const bareText = (s: string): string => s.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()

export const wordKey = (s: string): string => bareText(s.normalize('NFKC'))

export const lettersAndDigits = (s: string): string =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')

export const sentenceKey = (s: string): string => s.replace(/[\s.,!?。，！？、；：'"]/g, '').trim()

function squash(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[.,!?;:'"“”‘’。，！？、；：（）()[\]…·-]/g, '')
}

export const answerKey = (s: string): string => squash(s.normalize('NFKC'))

export const tonelessKey = (s: string): string =>
  squash(s.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''))
