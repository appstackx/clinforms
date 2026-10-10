"use client";

/** A header link that marks itself as the current page (aria-current="page") while its own path is open. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

export function NavLink({ href, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const pathname = usePathname();
  return <Link href={href} aria-current={pathname === href ? "page" : undefined} {...props} />;
}
