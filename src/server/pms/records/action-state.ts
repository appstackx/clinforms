/** A records service Result as the answer of a server action (forms show `error` and the field errors). */
import "server-only";
import type { RecordsActionState } from "../../../modules/pms/records/types";
import type { Result } from "./access";

export function actionState<T>(result: Result<T>, success: (value: T) => Extract<RecordsActionState, { ok: true }>): RecordsActionState {
  if (result.ok) return success(result.value);
  return {
    ok: false,
    error: result.error,
    ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
    ...(result.code === "conflict" ? { conflict: true } : {}),
    ...(result.rev !== undefined ? { rev: result.rev } : {}),
  };
}
