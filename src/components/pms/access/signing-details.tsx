"use client";
/**
 * Member access → "Signing details" (design round 2, Member access – one person): the register, the registration
 * number and "may sign", kept on the member's practitioner record – the records module's sign check reads them.
 * Owners and administrators edit them here; anyone else (and My account) sees them read only.
 */
import * as React from "react";
import { REGISTRATION_BODIES, REGISTRATION_BODY_LABELS, signedByLine, type RegistrationBody } from "@/modules/pms/core/signing";
import { PmsButton } from "../ui/button";
import { Checkbox, SelectInput, TextInput } from "../ui/inputs";

export interface SigningDetailsValue {
  linked: boolean;
  registrationBody: RegistrationBody;
  registrationNumber: string | null;
  maySign: boolean;
  title: string | null;
}

export type SaveSigning = (input: { userId: string; registrationBody: string; registrationNumber: string; maySign: boolean }) => Promise<
  { ok: true; message: string; signing: SigningDetailsValue } | { ok: false; error: string; fieldErrors?: Record<string, string> }
>;

export function SigningDetailsReadOnly({ name, value }: { name: string; value: SigningDetailsValue }) {
  return (
    <div className="flex flex-col gap-3">
      <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3">
        <div className="flex flex-col gap-1">
          <dt className="font-medium">Registration body</dt>
          <dd className="m-0 text-[#334155]">{value.registrationNumber ? value.registrationBody : "Not set"}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="font-medium">Registration number</dt>
          <dd className="m-0 text-[#334155]" data-testid="signing-number">{value.registrationNumber ?? "Not added yet"}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="font-medium">May sign clinical notes</dt>
          <dd className="m-0 text-[#334155]">{value.maySign && value.registrationNumber ? "Yes" : "No"}</dd>
        </div>
      </dl>
      <div className="flex flex-col gap-1 rounded-[10px] border border-border bg-[#F8FAFC] px-3.5 py-3">
        <span className="text-xs text-[#475569]">How signed notes and letters show it</span>
        <span className="font-semibold">{signedByLine(name, value.title, value.registrationBody, value.registrationNumber)}</span>
      </div>
    </div>
  );
}

export function SigningDetailsEditor({ userId, name, value, save }: { userId: string; name: string; value: SigningDetailsValue; save: SaveSigning }) {
  const [current, setCurrent] = React.useState(value);
  const [body, setBody] = React.useState<string>(value.registrationBody);
  const [number, setNumber] = React.useState(value.registrationNumber ?? "");
  const [maySign, setMaySign] = React.useState(value.registrationNumber ? value.maySign : true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [message, setMessage] = React.useState<string | null>(null);
  const dirty = body !== current.registrationBody || number.trim() !== (current.registrationNumber ?? "") || maySign !== current.maySign;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    setMessage(null);
    const r = await save({ userId, registrationBody: body, registrationNumber: number, maySign });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      setFieldErrors(r.fieldErrors ?? {});
      return;
    }
    setCurrent(r.signing);
    setNumber(r.signing.registrationNumber ?? "");
    setMaySign(r.signing.maySign);
    setMessage(r.message);
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" aria-label="Signing details" noValidate>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sign-body" className="font-medium">
            Registration body
          </label>
          <SelectInput id="sign-body" value={body} onChange={(e) => setBody(e.target.value)} aria-invalid={fieldErrors.registrationBody ? true : undefined}>
            {REGISTRATION_BODIES.map((b) => (
              <option key={b} value={b}>
                {REGISTRATION_BODY_LABELS[b]}
              </option>
            ))}
          </SelectInput>
          {fieldErrors.registrationBody ? <span className="text-xs font-medium text-destructive-strong">{fieldErrors.registrationBody}</span> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sign-number" className="font-medium">
            Registration number
          </label>
          <TextInput
            id="sign-number"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="PH123456"
            autoComplete="off"
            aria-invalid={fieldErrors.registrationNumber ? true : undefined}
            aria-describedby="sign-number-hint"
          />
          <span id="sign-number-hint" className={fieldErrors.registrationNumber ? "text-xs font-medium text-destructive-strong" : "text-xs text-[#475569]"}>
            {fieldErrors.registrationNumber ?? "HCPC: PH followed by digits."}
          </span>
        </div>
      </div>
      <Checkbox checked={maySign} onChange={(e) => setMaySign(e.target.checked)} label="May sign clinical notes" />
      <div className="flex flex-col gap-1 rounded-[10px] border border-border bg-[#F8FAFC] px-3.5 py-3">
        <span className="text-xs text-[#475569]">How signed notes and letters show it</span>
        <span className="font-semibold">{signedByLine(name, current.title ?? "Physiotherapist", body, number.trim() ? number.trim().toUpperCase() : null)}</span>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sm font-medium text-destructive-strong">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="m-0 text-sm font-medium text-[#166534]">
          {message}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-xs text-[#475569]">{current.linked ? "Kept on their practitioner record." : "Saving creates their practitioner record (not shown in the diary until set-up says so)."}</p>
        <PmsButton type="submit" loading={busy} disabled={!dirty && current.linked}>
          Save signing details
        </PmsButton>
      </div>
    </form>
  );
}
