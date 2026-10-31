/** State of the "Book a demo" form between the server action and the form (src/components/clindesk/demo-form.tsx). */
export interface DemoFormState {
  /** Submissions so far (the form's fields remount with the posted values after each one). */
  attempt: number;
  status: "idle" | "invalid" | "error";
  message: string | null;
  /** Error message by field name (the inputs' `name`), "form" for the whole form. */
  fieldErrors: Record<string, string>;
  /** What was posted, to fill the form in again (never stored anywhere else). */
  values: Partial<Record<"name" | "clinic" | "email" | "phone" | "sites" | "practitioners" | "current_system" | "see", string>>;
}

export const INITIAL_DEMO_FORM_STATE: DemoFormState = { attempt: 0, status: "idle", message: null, fieldErrors: {}, values: {} };
