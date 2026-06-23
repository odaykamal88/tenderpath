"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import styles from "./admin.module.css";

interface Me {
  id: number;
  email: string;
  name: string | null;
  is_super_admin: boolean;
}

const NAV = [
  { href: "/admin",              label: "Overview",      hint: "01" },
  { href: "/admin/assessments",  label: "Assessments",   hint: "02" },
  { href: "/admin/work-orders",  label: "Work Orders",   hint: "03" },
  { href: "/admin/submissions",  label: "Submissions",   hint: "03b" },
  { href: "/admin/matching",     label: "Matching",      hint: "04" },
  { href: "/admin/network",      label: "Network",       hint: "05" },
  { href: "/admin/feedback",     label: "Feedback",      hint: "06" },
  { href: "/admin/proposal-health", label: "Health",     hint: "07" },
  { href: "/admin/grant-health", label: "Grant Health",  hint: "08" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [freshCount, setFreshCount] = useState(0);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
    const headers: HeadersInit = token ? { authorization: `Bearer ${token}` } : {};

    (async () => {
      const res = await fetch("/api/auth/me", {
        headers,
      });
      if (!res.ok) {
        localStorage.removeItem("tp_token");
        router.replace("/login");
        return;
      }
      const me: Me = await res.json();
      if (!me.is_super_admin) {
        router.replace("/dashboard");
        return;
      }
      setUser(me);
      setLoading(false);

      // Best-effort: fresh network-match count for the nav badge. Never blocks
      // render and stays hidden on any failure.
      try {
        const fc = await fetch("/api/admin/network-companies/fresh-count", {
          headers,
        });
        if (fc.ok) setFreshCount(Number((await fc.json()).count) || 0);
      } catch {
        // non-fatal; badge stays hidden
      }
    })();
  }, [router]);

  if (loading) {
    return (
      <div className={styles.bootScreen}>
        <span className={styles.mono}>Verifying admin access…</span>
      </div>
    );
  }

  if (!user) return null;

  const initials = (user.name ?? user.email).slice(0, 2).toUpperCase();

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarBrand}>
          <Link href="/" className={styles.brandMark}>
            <span className={styles.brandTp}>Tender</span>
            <span className={styles.brandPath}>Path</span>
          </Link>
          <div className={`${styles.brandEyebrow} ${styles.mono}`}>Admin Console · v2.3</div>
        </div>

        <nav className={styles.sidebarNav}>
          {NAV.map((item) => {
            const active = item.href === "/admin"
              ? pathname === "/admin"
              : pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
              >
                <span className={`${styles.navHint} ${styles.mono}`}>{item.hint}</span>
                <span className={styles.navLabel}>{item.label}</span>
                {item.href === "/admin/network" && freshCount > 0 && (
                  <span
                    aria-label={`${freshCount} fresh matches`}
                    style={{
                      marginLeft: "auto",
                      background: "var(--color-accent)",
                      color: "#fff",
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 600,
                      lineHeight: 1,
                      padding: "3px 6px",
                      minWidth: 16,
                      textAlign: "center",
                    }}
                  >
                    {freshCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className={styles.sidebarDivider} />

        <Link href="/dashboard" className={`${styles.navItem} ${styles.navSecondary}`}>
          <span className={`${styles.navHint} ${styles.mono}`}>←</span>
          <span className={styles.navLabel}>User Dashboard</span>
        </Link>

        <a
          href="/data-room"
          target="_blank"
          rel="noreferrer"
          className={`${styles.navItem} ${styles.navSecondary}`}
        >
          <span className={`${styles.navHint} ${styles.mono}`}>↗</span>
          <span className={styles.navLabel}>Investor Data Room</span>
        </a>

        <div className={styles.sidebarFoot}>
          <div className={styles.footUser}>
            <div className={styles.footAvatar}>{initials}</div>
            <div>
              <div className={styles.footName}>{user.name ?? "Admin"}</div>
              <div className={`${styles.footEmail} ${styles.mono}`}>{user.email}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem("tp_token");
              router.push("/");
            }}
            className={`${styles.footSignout} ${styles.mono}`}
          >
            Sign out ↗
          </button>
        </div>
      </aside>

      <main className={styles.main}>{children}</main>
    </div>
  );
}
