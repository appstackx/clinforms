/** HTTP status of a records service failure (route handlers). */
import type { FailureCode } from "./access";

export function failureStatus(code: FailureCode): number {
  switch (code) {
    case "forbidden":
    case "registration":
      return 403;
    case "not_found":
      return 404;
    case "conflict":
    case "locked":
      return 409;
    case "invalid":
      return 400;
    default:
      return 500;
  }
}
