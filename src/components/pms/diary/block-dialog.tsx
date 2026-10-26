"use client";
/** "Block time": leave, a meeting, training or admin time for a practitioner, or a room out of use. */
import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BLOCK_KIND_LABELS } from "@/modules/pms/diary/copy";
import { BLOCK_KINDS, type BlockKind } from "@/modules/pms/diary/rules";
import type { DiaryActionResult } from "@/modules/pms/diary/types";
import type { DiaryViewData } from "@/modules/pms/diary/view";
import { ActionError, SelectField, TextAreaField, TextField } from "./fields";
import type { DiaryActions } from "./types";

export interface BlockRequest {
  date: string;
  siteId: string;
  practitionerId?: string | null;
  roomId?: string | null;
  startTime?: string;
}

type Options = Pick<DiaryViewData, "sites" | "practitioners" | "rooms">;

export function BlockDialog({ request, options, block, onClose, onDone }: { request: BlockRequest | null; options: Options; block: DiaryActions["block"]; onClose: () => void; onDone: (message: string) => void }) {
  return (
    <Dialog open={request !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto bg-white text-slate-900">
        <DialogHeader>
          <DialogTitle>Block time</DialogTitle>
          <DialogDescription className="text-slate-600">Nothing can be booked for the practitioner or in the room during blocked time.</DialogDescription>
        </DialogHeader>
        {request ? <BlockForm key={JSON.stringify(request)} request={request} options={options} block={block} onDone={onDone} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function BlockForm({ request, options, block, onDone }: { request: BlockRequest; options: Options; block: DiaryActions["block"]; onDone: (message: string) => void }) {
  const [siteId, setSiteId] = useState(request.siteId);
  const [who, setWho] = useState<"practitioner" | "room">(request.roomId && !request.practitionerId ? "room" : "practitioner");
  const [practitionerId, setPractitionerId] = useState(request.practitionerId ?? options.practitioners[0]?.id ?? "");
  const [roomId, setRoomId] = useState(request.roomId ?? "");
  const [kind, setKind] = useState<BlockKind>(who === "room" ? "closed" : "leave");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(request.date);
  const [startTime, setStartTime] = useState(request.startTime ?? "09:00");
  const [endTime, setEndTime] = useState(request.startTime ? `${String(Math.min(23, Number(request.startTime.slice(0, 2)) + 1)).padStart(2, "0")}:${request.startTime.slice(3, 5)}` : "17:00");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<Extract<DiaryActionResult, { ok: false }> | null>(null);
  const [pending, startTransition] = useTransition();
  const rooms = options.rooms.filter((r) => r.siteId === siteId);
  const fe = result?.fieldErrors ?? {};
  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setResult(null);
        startTransition(async () => {
          const r = await block({
            siteId,
            practitionerId: who === "practitioner" ? practitionerId : null,
            roomId: who === "room" ? roomId : null,
            blockKind: kind,
            title,
            notes,
            date,
            startTime,
            endTime,
          });
          if (r.ok) onDone(r.message);
          else setResult(r);
        });
      }}
    >
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-1 text-sm font-medium text-slate-800">Block time for</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="block-who" checked={who === "practitioner"} onChange={() => setWho("practitioner")} className="h-4 w-4 text-teal-700 focus:ring-2 focus:ring-teal-600" />
          A practitioner
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="block-who" checked={who === "room"} onChange={() => setWho("room")} className="h-4 w-4 text-teal-700 focus:ring-2 focus:ring-teal-600" />
          A room
        </label>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          id="block-site"
          label="Site"
          value={siteId}
          onChange={(e) => {
            setSiteId(e.target.value);
            setRoomId("");
          }}
        >
          {options.sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        {who === "practitioner" ? (
          <SelectField id="block-practitioner" label="Practitioner" value={practitionerId} onChange={(e) => setPractitionerId(e.target.value)} error={fe.practitionerId}>
            {options.practitioners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
        ) : (
          <SelectField id="block-room" label="Room" value={roomId} onChange={(e) => setRoomId(e.target.value)} error={fe.practitionerId}>
            <option value="">Choose a room</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </SelectField>
        )}
        <SelectField id="block-kind" label="What for" value={kind} onChange={(e) => setKind(e.target.value as BlockKind)}>
          {BLOCK_KINDS.map((k) => (
            <option key={k} value={k}>
              {BLOCK_KIND_LABELS[k]}
            </option>
          ))}
        </SelectField>
        <TextField id="block-title" label="Label in the diary (optional)" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} hint="For example “Team meeting”. Not for patient details." error={fe.title} />
        <TextField id="block-date" label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={fe.date} />
        <div className="grid grid-cols-2 gap-3">
          <TextField id="block-start" label="From" type="time" step={300} value={startTime} onChange={(e) => setStartTime(e.target.value)} error={fe.startTime} />
          <TextField id="block-end" label="Until" type="time" step={300} value={endTime} onChange={(e) => setEndTime(e.target.value)} error={fe.endTime} />
        </div>
      </div>
      <TextAreaField id="block-notes" label="Note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
      <ActionError error={result?.error ?? null} details={result?.clashes} />
      <div className="flex justify-end">
        <button type="submit" disabled={pending} className="inline-flex min-h-[40px] items-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 disabled:opacity-60">
          {pending ? "Saving…" : "Block the time"}
        </button>
      </div>
    </form>
  );
}
