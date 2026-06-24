import { nanoid } from 'nanoid'

declare const SubagentIdBrand: unique symbol
export type SubagentId = string & { readonly [SubagentIdBrand]: void }

export function createSubagentId(): SubagentId {
  return nanoid() as SubagentId
}
