"use client";

/** A next/link that records one allow-listed analytics event when clicked (no-op without consent). */
import Link from "next/link";
import type { ComponentProps } from "react";
import type { AnalyticsEvent, AnalyticsProps } from "./events";
import { track } from "./posthog";

type TrackedLinkProps = ComponentProps<typeof Link> & {
  event: AnalyticsEvent;
  eventProps?: AnalyticsProps;
};

export function TrackedLink({ event, eventProps, onClick, ...props }: TrackedLinkProps) {
  return (
    <Link
      {...props}
      onClick={(e) => {
        track(event, eventProps);
        onClick?.(e);
      }}
    />
  );
}
