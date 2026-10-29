import { SectionLoading } from "@/components/pms/ui/section-loading";

/** A record tab loading: the record layout (banner and tabs) stays; only the tab's panel is a skeleton. */
export default function RecordTabLoading() {
  return <SectionLoading label="this part of the record" layout="panel" width="full" header={false} />;
}
