/**
 * The record's Forms tab: referrer and insurer forms completed in ClinForms and filed back to a case (design round 3
 * ReferrerForm, Forms tab) – the form, where it came from, its status and who approved it when. "View" only for members
 * who may see clinical notes (the completed form holds clinical content).
 */
import { formatFiledLine, ukDateTimeAt } from "./format";

export interface FiledFormsListRow {
  id: string;
  title: string;
  caseTitle: string | null;
  mimeType: string;
  sizeBytes: number;
  signerName: string | null;
  signerRegistration: string | null;
  signedAt: string | null;
  filedAt: string;
  href: string | null;
}

export function FiledFormsList({ rows }: { rows: FiledFormsListRow[] }) {
  return (
    <section
      aria-labelledby="filed-forms-title"
      className="rounded-xl border border-border bg-white"
      data-testid="filed-forms"
    >
      <h2
        id="filed-forms-title"
        className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground"
      >
        Referrer and insurer forms
      </h2>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-[#475569]">
          No referrer or insurer forms filed yet. Complete one from a case
          (Cases → the case → Complete referrer form).
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#F8FAFC] text-xs text-[#475569]">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold">
                  Form
                </th>
                <th scope="col" className="px-4 py-2 font-semibold">
                  Source
                </th>
                <th scope="col" className="px-4 py-2 font-semibold">
                  Status
                </th>
                <th scope="col" className="px-4 py-2 font-semibold">
                  Approved / signed
                </th>
                <th scope="col" className="px-4 py-2 font-semibold">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-border"
                  data-testid="filed-form-row"
                >
                  <td className="px-4 py-2.5 font-medium text-foreground">
                    {r.title}
                  </td>
                  <td className="px-4 py-2.5 text-[#334155]">
                    ClinForms{r.caseTitle ? ` · case: ${r.caseTitle}` : ""}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex h-6 items-center rounded-full border border-[#BBF7D0] bg-[#DCFCE7] px-2 text-xs font-semibold text-[#166534]">
                      Approved
                    </span>
                  </td>
                  <td
                    className="px-4 py-2.5 text-[#334155]"
                    title={formatFiledLine(r)}
                  >
                    {[
                      r.signerName,
                      ukDateTimeAt(r.signedAt ?? r.filedAt).replace(
                        " at ",
                        " ",
                      ),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {r.href ? (
                      <a
                        href={r.href}
                        className="font-medium text-primary-strong underline underline-offset-2"
                      >
                        View{" "}
                        {r.mimeType === "application/pdf" ? "PDF" : "Word file"}
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
