import { nanoid } from 'nanoid'

declare const GateIdBrand: unique symbol
export type GateId = string & { readonly [GateIdBrand]: void }

export function createGateId(): GateId {
  return nanoid() as GateId
}
