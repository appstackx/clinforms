import "server-only";

/**
 * Connector for the simulated TM3 sandbox: real HTTP + Bearer + paging against a simulated server
 * (`/api/tm3-sim/v1`, demo data, not affiliated with TM3). id "tm3-sim", status "connected",
 * simulated true, all capabilities including document write-back.
 *
 * A real TM3 connector (connectors/tm3) would implement the same interface against TM3's partner API.
 *
 * Owner: integration agent.
 */
import { ageOn, todayIso } from "../../core/dates";
import type { AttachReceipt, EpisodeSummary, PatientSummary } from "../../core/types";
import { ConnectorError, type ClinicSystemConnector } from "../types";
import { createTm3SimClient } from "./client";
import { mapSimEpisodeToBundle } from "./mapper";
import type { SimEpisode, SimPatient } from "./wire";

export const TM3_SIM_CONNECTOR_LABEL = "Simulated TM3 sandbox";
export const TM3_SIM_NOTICE = "Simulated TM3 sandbox – demo data, not affiliated with TM3";

export function createTm3SimConnector(): ClinicSystemConnector {
  return {
    id: "tm3-sim",
    label: TM3_SIM_CONNECTOR_LABEL,
    simulated: true,
    status: "connected",
    capabilities: {
      patients: true,
      clinicalNotes: true,
      appointments: true,
      outcomeMeasures: true,
      writeBackDocuments: true,
    },
    note: TM3_SIM_NOTICE,
    // Fictional patients: the public demo only, never a clinic (wave 2).
    demoOnly: true,

    async searchPatients(ctx, q) {
      const client = createTm3SimClient(ctx);
      const patients = await client.searchPatients(q.search);
      // Episode summaries only for patients that have episodes (registration-only patients skip the call).
      const episodes = await Promise.all(
        patients.map((p) => (p.episode_count > 0 ? client.listEpisodes(p.id) : Promise.resolve([] as SimEpisode[]))),
      );
      return patients.map((p, i) => toPatientSummary(p, episodes[i]));
    },

    async listEpisodes(ctx, patientId) {
      const client = createTm3SimClient(ctx);
      const episodes = await client.listEpisodes(patientId);
      return episodes.filter((e) => e.patient_id === patientId).map(toEpisodeSummary);
    },

    async getEpisodeBundle(ctx, ref) {
      if ("upload" in ref) {
        throw new ConnectorError("UNSUPPORTED", "The simulated TM3 connector reads episodes from the clinic system, not uploads.");
      }
      const client = createTm3SimClient(ctx);
      // Patient + episode list first (there is no GET /episodes/{id}); then the episode's records in parallel.
      const [patient, episodes] = await Promise.all([client.getPatient(ref.patientId), client.listEpisodes(ref.patientId)]);
      const episode = episodes.find((e) => e.id === ref.episodeId && e.patient_id === ref.patientId);
      if (!episode) {
        throw new ConnectorError("NOT_FOUND", `Episode ${ref.episodeId} was not found for patient ${ref.patientId}.`, 404);
      }
      const [notes, appointments, outcomeMeasures] = await Promise.all([
        client.listNotes(episode.id),
        client.listAppointments(episode.id),
        client.listOutcomeMeasures(episode.id),
      ]);
      return mapSimEpisodeToBundle(
        { patient, episode, notes, appointments, outcomeMeasures },
        { tenantId: ctx.tenantId, fetchedAt: new Date().toISOString() },
      );
    },

    async attachDocument(ctx, input): Promise<AttachReceipt> {
      const client = createTm3SimClient(ctx);
      const res = await client.attachDocument(input.patientId, {
        episode_id: input.episodeId,
        title: input.title,
        file_name: input.fileName,
        mime_type: input.mimeType as
          | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          | "application/pdf",
        content_base64: input.contentBase64,
        sha256: input.sha256,
        sign_receipt: {
          report_id: input.receipt.reportId,
          content_sha256: input.receipt.contentSha256,
          signer_name: input.receipt.signer.name,
          signer_hcpc: input.receipt.signer.hcpc,
          signed_at: input.receipt.signedAt,
          mac: input.receipt.mac,
        },
      });
      return { externalDocumentId: res.external_document_id, receivedAt: res.received_at, sha256: res.sha256 };
    },
  };
}

/** Wire patient (+ its episodes) → PatientSummary for the picker. */
export function toPatientSummary(p: SimPatient, episodes: SimEpisode[], today: string = todayIso()): PatientSummary {
  const summary: PatientSummary = {
    connectorId: "tm3-sim",
    id: p.id,
    displayName: `${p.first_name} ${p.last_name}`,
    dob: p.date_of_birth,
    sex: p.sex,
    simulated: true,
    registrationOnly: p.episode_count === 0 || episodes.length === 0,
    episodes: episodes.filter((e) => e.patient_id === p.id).map(toEpisodeSummary),
  };
  if (p.date_of_birth <= today) summary.ageYears = ageOn(p.date_of_birth, today);
  return summary;
}

export function toEpisodeSummary(e: SimEpisode): EpisodeSummary {
  const summary: EpisodeSummary = {
    id: e.id,
    title: e.title,
    status: e.status,
    startDate: e.start_date,
    instructingPartyName: e.referral.organisation_name,
  };
  if (e.end_date) summary.endDate = e.end_date;
  if (e.referral.source_type !== "self" && e.referral.source_type !== "gp") summary.referralType = e.referral.source_type;
  return summary;
}
