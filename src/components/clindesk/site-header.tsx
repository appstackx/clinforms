import { Logo } from "./logo";

/** Paths with an entry in the main navigation (the header marks the current one). */
export type ClindeskNavPath = "/" | "/features" | "/reports" | "/pricing" | "/switching" | "/security" | "/demo" | "other";

const NAV = [
  { href: "/features", label: "Features" },
  { href: "/reports", label: "Referrer reports", addon: true },
  { href: "/pricing", label: "Pricing" },
  { href: "/switching", label: "Switching" },
  { href: "/security", label: "Security" },
] as const;

function NavLinks({ current }: { current: ClindeskNavPath }) {
  return (
    <>
      {NAV.map((item) => (
        <a key={item.href} href={item.href} aria-current={current === item.href ? "page" : undefined}>
          {item.label}
          {"addon" in item ? (
            <>
              {" "}
              <span className="addon">Add-on</span>
            </>
          ) : null}
        </a>
      ))}
    </>
  );
}

/**
 * Sticky header: the logo, the main navigation and Sign in / Book a demo from 1100 px; below that a native
 * <details> menu (works without JavaScript) and a short Book a demo button. Sign in goes to the app's sign-in page.
 */
export function SiteHeader({ current }: { current: ClindeskNavPath }) {
  const demoCurrent = current === "/demo" ? ("page" as const) : undefined;
  return (
    <header className="site-header">
      <div className="wrap hbar">
        <Logo id="hdr" />
        <nav className="nav" aria-label="Main">
          <NavLinks current={current} />
        </nav>
        <div className="hactions">
          <a className="signin" href="/login">
            Sign in
          </a>{" "}
          <a className="btn btn-coral" href="/demo" aria-current={demoCurrent}>
            Book a demo <span className="arr" aria-hidden="true">→</span>
          </a>
        </div>
        <div className="hright">
          <a className="btn btn-coral hdemo-s" href="/demo" aria-current={demoCurrent}>
            Book a demo
          </a>{" "}
          <details className="menu">
            <summary>
              <span className="tb tb--teal" aria-hidden="true" />
              Menu
            </summary>
            <nav className="menu-sheet" aria-label="Main">
              <NavLinks current={current} />
              <a href="/login">Sign in</a>
              <a className="btn btn-coral" href="/demo" aria-current={demoCurrent}>
                Book a demo <span className="arr" aria-hidden="true">→</span>
              </a>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
