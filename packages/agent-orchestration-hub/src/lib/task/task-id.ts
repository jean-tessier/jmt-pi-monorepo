import { nanoid } from 'nanoid'

declare const TaskIdBrand: unique symbol
export type TaskId = string & { readonly [TaskIdBrand]: void }

export function createTaskId(): TaskId {
  return nanoid() as TaskId
}
