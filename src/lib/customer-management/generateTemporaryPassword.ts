import { createHash, randomBytes } from 'node:crypto'

export function generateTemporaryPassword(): { password: string; hash: string } {
  const randomPart = randomBytes(4).toString('hex').toUpperCase()
  const password = `KP@2026${randomPart}`
  const hash = createHash('sha256').update(password).digest('hex')
  return { password, hash }
}
