import { nanoid } from 'nanoid'

declare const ServiceIdBrand: unique symbol
export type ServiceId = string & { readonly [ServiceIdBrand]: void }

export function createServiceId(): ServiceId {
  return nanoid() as ServiceId
}
