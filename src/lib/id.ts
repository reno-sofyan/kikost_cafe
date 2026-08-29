export function newId(): string {
  return crypto.randomUUID()
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}
