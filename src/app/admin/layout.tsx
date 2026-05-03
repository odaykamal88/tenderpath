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
  { href: "/admin",             label: "Overview",      hint: "01" },
  { href: "/admin/work-orders", label: "Work Orders",   hint: "02" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
    if (!token) {
      router.replace("/login?next=/admin");
      return;
    }

    (async () => {
      const res = await fetch("/api/auth/me", {
        headers: { authorization: `Bearer ${token}` },
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
              </Link>
            );
          })}
        </nav>

        <div className={styles.sidebarDivider} />

        <Link href="/dashboard" className={`${styles.navItem} ${styles.navSecondary}`}>
          <span className={`${styles.navHint} ${styles.mono}`}>←</span>
          <span className={styles.navLabel}>User Dashboard</span>
        </Link>

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
