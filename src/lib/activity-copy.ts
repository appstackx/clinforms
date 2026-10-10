/**
 * Customer-facing wording for the clinic's activity page (/app/settings/activity) and the platform page
 * (/app/platform): plain-English names for audit_log actions and short descriptions of their details
 * (browser-safe: no env, no server imports). Neutral wording only – checked with the module's banned terms by
 * src/server/admin/admin.test.ts.
 *
 * Every audit action the app writes should have a label here. An action without one is still shown, with a
 * readable name made from its code (activityLabel), so new actions never break the page.
 */

export interface ActivityGroup {
  label: string;
  actions: readonly string[];
}

/** Labels by action code, grouped for the action filter. */
export const ACTIVITY_GROUPS: readonly ActivityGroup[] = [
  {
    label: "Sign-in and security",
    actions: [
      "auth.sign_in",
      "auth.two_factor_enable",
      "auth.backup_codes_regenerate",
      "auth.session_revoke",
      "auth.password_reset",
      "auth.password_reset_link",
      "auth.password_reset_link_refused",
      "auth.two_factor_reset",
    ],
  },
  {
    label: "Members",
    actions: ["member.invite", "member.invite_cancel", "member.join", "member.add", "member.role_change", "member.profile_update", "member.remove"],
  },
  {
    label: "Clinic account",
    actions: ["clinic.create", "clinic.update", "clinic.offboard", "api_key.create", "api_key.revoke", "audit.export"],
  },
  {
    label: "Forms",
    actions: ["file.upload", "form.create", "form.update", "form.analyse_live", "form.confirm", "form.store_confirmed", "form.delete", "settings.update"],
  },
  {
    label: "Reports",
    actions: [
      "notes.imported",
      "report.create",
      "report.update",
      "report.draft_live",
      "report.sign",
      "report.store_signed",
      "report.render_final",
      "report.file_back",
      "report.export",
      "report.delete",
      "launch.issue",
    ],
  },
];

export const ACTIVITY_LABELS: Readonly<Record<string, string>> = {
  "auth.sign_in": "Signed in",
  "auth.two_factor_enable": "Two-step verification set up",
  "auth.backup_codes_regenerate": "New backup codes created",
  "auth.session_revoke": "Signed out on other devices",
  "auth.password_reset": "Password changed with a reset link",
  "auth.password_reset_link": "Password reset link created",
  "auth.password_reset_link_refused": "Password reset link refused",
  "auth.two_factor_reset": "Two-step verification reset by ClinForms support",
  "member.invite": "Member invited",
  "member.invite_cancel": "Invitation cancelled",
  "member.join": "Invitation accepted",
  "member.add": "Member added by ClinForms support",
  "member.role_change": "Role changed",
  "member.profile_update": "Signing details updated",
  "member.remove": "Member removed",
  "clinic.create": "Clinic account opened",
  "clinic.update": "Clinic details updated",
  "clinic.offboard": "Clinic account closed",
  "api_key.create": "API key created",
  "api_key.revoke": "API key revoked",
  "audit.export": "Activity downloaded",
  // The Studio and the Report API (src/modules/medreport: auth/actor.ts AUDIT_ACTIONS and the /store handlers).
  "file.upload": "Form file uploaded",
  "form.create": "Form added to the library",
  "form.update": "Form mapping saved",
  "form.analyse_live": "Form questions read from the file",
  "form.confirm": "Form mapping confirmed",
  "form.store_confirmed": "Confirmed form mapping saved",
  "form.delete": "Form removed from the library",
  "settings.update": "Referrer form links updated",
  "notes.imported": "Patient notes imported",
  "report.create": "Report started",
  "report.update": "Report saved",
  "report.draft_live": "Answers drafted from the notes",
  "report.sign": "Report approved",
  "report.store_signed": "Approved report saved",
  "report.render_final": "Final document produced",
  "report.file_back": "Final document saved to the clinic system",
  "report.export": "Report exported",
  "report.delete": "Report deleted",
  "launch.issue": "Opened from the clinic system",
  // The platform's own trail (/app/platform; pseudo-tenant "platform").
  "platform.clinic_create": "Clinic created",
  "platform.clinic_update": "Clinic details updated",
  "platform.member_add": "Owner added to a clinic",
  "platform.demo_forms_seed": "Demonstration forms added to a clinic",
  "platform.demo_reports_seed": "Demonstration reports added to a clinic",
  "platform.access_request_contacted": "Access request marked as contacted",
  "platform.access_request_reopened": "Access request marked as not contacted",
};

const NOUNS: Readonly<Record<string, string>> = {
  auth: "Sign-in",
  member: "Member",
  clinic: "Clinic",
  api_key: "API key",
  audit: "Activity",
  report: "Report",
  form: "Form",
  file: "File",
  settings: "Settings",
  launch: "Clinic system",
  platform: "Platform",
  notes: "Notes",
};

const NOTES_FORMATS: Readonly<Record<string, string>> = {
  pdf: "from a PDF",
  docx: "from a Word document",
  csv: "from a CSV export",
  text: "from text or pasted notes",
  json: "from an export",
};

/** The plain-English name of an action code; codes without a label get a readable name made from the code. */
export function activityLabel(action: string): string {
  const known = ACTIVITY_LABELS[action];
  if (known) return known;
  const [head, ...rest] = String(action).split(".");
  const noun = NOUNS[head] ?? head.replace(/[_:-]+/g, " ");
  const verb = rest.join(" ").replace(/[_:.-]+/g, " ").trim();
  const text = verb ? `${noun}: ${verb}` : noun;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const ROLE_NAMES: Readonly<Record<string, string>> = { owner: "Owner", admin: "Administrator", clinician: "Clinician", staff: "Staff" };
const role = (value: unknown) => (typeof value === "string" ? (ROLE_NAMES[value] ?? value) : "unknown");

const CLINIC_FIELDS: Readonly<Record<string, string>> = {
  displayName: "name",
  legalName: "legal name",
  address: "address",
  postcode: "postcode",
  phone: "phone",
  email: "email",
  retentionDays: "how long reports are kept",
  draftingEnabled: "drafting from the notes",
  created: "first saved",
};

const SESSION_SCOPES: Readonly<Record<string, string>> = {
  "revoke-session": "One device",
  "revoke-other-sessions": "All other devices",
  "revoke-sessions": "All devices",
};

const RESET_REFUSALS: Readonly<Record<string, string>> = {
  other_clinic_email_off: "The member also belongs to another clinic, so only an email to them is allowed",
  other_clinic_email_failed: "The member also belongs to another clinic and the email could not be sent",
};

/**
 * A short description of an entry's details, or null. Only fields known to be safe and useful are shown
 * (audit details never hold patient data, but unknown fields are not shown either).
 */
export function describeActivityDetail(action: string, detail: Record<string, unknown> | null | undefined): string | null {
  if (!detail || typeof detail !== "object") return null;
  switch (action) {
    case "member.invite":
    case "member.join":
    case "member.remove":
      return "role" in detail ? `Role: ${role(detail.role)}` : null;
    case "member.role_change":
      return detail.from ? `${role(detail.from)} → ${role(detail.to)}` : `Now ${role(detail.to)}`;
    case "member.profile_update":
      return detail.canSign === true ? "May sign forms" : "Does not sign forms";
    case "clinic.update": {
      const fields = Array.isArray(detail.fields) ? detail.fields.map((f) => CLINIC_FIELDS[String(f)] ?? String(f)) : [];
      return fields.length ? `Changed: ${fields.join(", ")}` : null;
    }
    case "clinic.create":
      return typeof detail.retentionDays === "number" ? `Reports kept for ${detail.retentionDays} days` : null;
    case "auth.sign_in":
      return detail.method === "backup_code" ? "With a backup code" : "With an authenticator code";
    case "auth.session_revoke":
      return SESSION_SCOPES[String(detail.scope)] ?? null;
    case "auth.password_reset_link":
      return detail.delivery === "sent" ? "Emailed to the member" : "Shown to the administrator to pass on";
    case "auth.password_reset_link_refused":
      return RESET_REFUSALS[String(detail.reason)] ?? null;
    case "api_key.create":
      return typeof detail.last4 === "string" ? `Key ending …${detail.last4}` : null;
    case "audit.export":
      return typeof detail.rows === "number" ? `${detail.rows} ${detail.rows === 1 ? "entry" : "entries"}` : null;
    case "report.draft_live":
      return typeof detail.paragraphs === "number" && typeof detail.sections === "number"
        ? `${detail.sections} ${detail.sections === 1 ? "question" : "questions"}, ${detail.paragraphs} ${detail.paragraphs === 1 ? "paragraph" : "paragraphs"}`
        : null;
    case "form.analyse_live":
    case "form.confirm":
      return typeof detail.fields === "number" ? `${detail.fields} ${detail.fields === 1 ? "question" : "questions"}` : null;
    case "notes.imported": {
      const n = (key: string, one: string, many: string) => (typeof detail[key] === "number" ? `${detail[key]} ${detail[key] === 1 ? one : many}` : null);
      const counts = [n("notes", "note", "notes"), n("appointments", "appointment", "appointments"), n("outcomeScores", "outcome score", "outcome scores")].filter(Boolean);
      const from = NOTES_FORMATS[String(detail.format)];
      const parts = [counts.join(", "), from ?? null, detail.layout === "general" ? "checked before use" : null].filter(Boolean);
      return parts.length ? parts.join(" · ") : null;
    }
    case "report.render_final":
      return detail.format === "pdf" ? "PDF" : detail.format === "original" ? "In the referrer's own format" : detail.format === "docx" ? "Word" : null;
    case "report.update":
    case "report.create":
    case "report.store_signed":
      return typeof detail.rev === "number" ? `Version ${detail.rev}` : null;
    case "platform.clinic_create":
      return typeof detail.tenantId === "string" ? `Clinic id ${detail.tenantId}` : null;
    default:
      return null;
  }
}

/** Names of the people and things an entry points at, for display. */
export const ACTIVITY_ACTORS = {
  platform: "ClinForms support",
  system: "Automatic",
  formerMember: "Former member",
  deletedAccount: "Deleted account",
} as const;

export const ACTIVITY_TARGETS: Readonly<Record<string, string>> = {
  user: "Member",
  member: "Member",
  invitation: "Invitation",
  partner_key: "API key",
  organization: "Clinic account",
  clinic: "Clinic details",
  report: "Report",
  form: "Form",
  form_file: "Form file",
  template: "Report template",
  tenant_settings: "Clinic settings",
  access_request: "Access request",
};

export const ACTIVITY_COPY = {
  title: "Activity",
  managerIntro:
    "What happened in your clinic account and who did it: sign-ins, members, clinic details, API keys, forms and reports. Entries cannot be changed or deleted, and they hold ids and actions only – never patient details.",
  memberIntro:
    "Your own activity in this clinic account. Owners and administrators can see the whole clinic's activity. Entries cannot be changed or deleted.",
  timesNote: "Times are UK time.",
  empty: "No activity matches these filters.",
  emptyAll: "No activity yet.",
  allActions: "All actions",
  everyone: "Everyone",
  filterAction: "Action",
  filterPerson: "Person",
  apply: "Show",
  clear: "Clear filters",
  newer: "Newer",
  older: "Older",
  newest: "Back to the newest",
  includeSaves: "Include routine saves of drafts and form mappings",
  savesHidden: "Routine saves of drafts and form mappings are hidden.",
  showSaves: "Show them",
  openTarget: "Open",
  download: "Download these entries (CSV)",
  downloadNote: "The download holds ids and action codes only, for the entries on this page.",
} as const;
