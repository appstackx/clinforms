/** The booking pages' data as the browser gets it (pure types – no patient data). */

export interface FlowSite {
  id: string;
  name: string;
  address: string;
  /** Outward code of the site's postcode ("MK9") – the browser places a typed postcode near a site with the same one. */
  outward: string | null;
  next: string | null;
  position: { latitude: number; longitude: number } | null;
}

export interface FlowService {
  id: string;
  name: string;
  minutes: number;
  price: string | null;
  description: string;
}

export interface FlowPractitioner {
  id: string;
  name: string;
  subtitle: string;
}

export interface FlowData {
  sites: FlowSite[];
  services: FlowService[];
  practitioners: Record<string, FlowPractitioner[]>;
  policy: string;
  cancelNoticeHours: number;
  intro: string | null;
  today: string;
  lastDate: string;
  contactPhone: string | null;
}

export interface FlowDay {
  date: string;
  slots: { startsAt: string; time: string; practitionerId: string }[];
}

export type SlotsAnswer = { ok: true; days: FlowDay[]; fromDate: string; nextFrom: string | null } | { ok: false; error: string };


/** What the patient sees once booked (or moved). */
export interface BookResultView {
  ok: true;
  reference: string;
  when: string;
  startsAt: string;
  endsAt: string;
  practitioner: string;
  site: string;
  service: string;
  managePath: string | null;
  formPath: string | null;
  forms: number;
}

/** One appointment as the patient's panel shows it. */
export interface AppointmentPanelData {
  id: string;
  rev: number;
  when: string;
  service: string;
  practitioner: string;
  site: string;
  siteAddress: string;
  status: string;
  statusWords: string;
  reference: string | null;
  canCancel: boolean;
  late: boolean;
  canMove: boolean;
  freeUntil: string;
  lateFee: string | null;
  noticeHours: number;
  refusal: string | null;
}

