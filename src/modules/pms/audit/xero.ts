/**
 * Audit actions of the Xero sync (0172, xe03–xe06), part of the integration module's labels (./integration.ts spreads
 * them). Details hold ids, counts and amounts only – never a name, a token or Xero's message text.
 */
export const XERO_AUDIT_LABELS: Readonly<Record<string, string>> = {
  "pms.xero.settings": "Xero switched on or off for the clinic",
  "pms.xero.connect_start": "Xero connection started",
  "pms.xero.connect": "Xero connected",
  "pms.xero.disconnect": "Xero disconnected",
  "pms.xero.paused": "Xero stopped accepting the connection (reconnect needed)",
  "pms.xero.mapping_set": "Xero account or tax mapping changed",
  "pms.xero.options": "Xero sending options changed",
  "pms.xero.push": "Records sent to Xero",
  "pms.xero.retry": "Xero send retried",
  "pms.xero.skip": "Xero send skipped",
};

export const XERO_AUDIT_TARGETS: Readonly<Record<string, string>> = {
  pms_xero_connection: "Xero connection",
  pms_xero_sync_item: "Xero send",
};
