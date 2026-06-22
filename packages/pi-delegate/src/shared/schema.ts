/**
 * TypeBox schema compilation wrapper for pi-delegate (Task 17)
 *
 * Provides schema validation using typebox Compile.
 */

import type { TSchema } from 'typebox';
import { Compile } from 'typebox/compile';

/**
 * Compile a JSON Schema object into a validator using TypeBox TypeCompiler.
 *
 * @param schema - A JSON Schema object to compile
 * @returns An object with a `validate` function that checks a value against the schema
 * @throws Error if the schema cannot be compiled
 */
export function compileSchema(schema: object): { validate: (value: unknown) => boolean } {
  try {
    const compiled = Compile(schema as TSchema);
    return { validate: (value: unknown) => compiled.Check(value) };
  } catch {
    throw new Error('Invalid JSON Schema: cannot compile');
  }
}

/**
 * Type guard to check if a value is a JSON Schema object (non-null, non-array object).
 *
 * @param schema - The value to check
 * @returns true if the value is a plain object (valid JSON Schema container)
 */
export function isJsonSchemaObject(schema: unknown): schema is object {
  return typeof schema === 'object' && schema !== null && !Array.isArray(schema);
}
