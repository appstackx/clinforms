/** GET /api/tm3-sim/v1/patients/[id]/episodes – SIMULATED TM3 API (demo scaffolding, not affiliated with TM3). */
import { simListEpisodes } from "@/sandbox/tm3-sim/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = simListEpisodes;
