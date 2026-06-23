"use client";

import { useState } from "react";
import { C, F } from "@/components/workbench/tokens";
import { useMedia } from "@/components/workbench/useMedia";
import { Eyebrow } from "@/components/workbench/ui";

const GETS: [string, string][] = [
  ["Readiness score", "Scored 0–100 across four dimensions"],
  ["Live tender matches", "Ranked by fit, with deadlines"],
  ["Grants you may qualify for", "Filtered by relevance, not buzzwords"],
  ["The fixes that matter", "Sequenced by leverage and lead time"],
];

const clean = (s: string) => s.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
const valid = (s: string) => /^([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i.test(clean(s));

export function EntryScreen({
  initialUrl = "",
  authedEmail,
  onReadSite,
  onStartScratch,
}: {
  initialUrl?: string;
  authedEmail: string | null;
  onReadSite: (url: string) => void;
  onStartScratch: () => void;
}) {
  const mobile = useMedia("(max-width: 860px)");
  const [val, setVal] = useState(initialUrl);
  const [err, setErr] = useState("");

  const submit = () => {
    const c = clean(val);
    if (!valid(c)) {
      setErr("Enter a valid domain — e.g. yourcompany.com");
      return;
    }
    setErr("");
    onReadSite(c);
  };

  return (
    <div style={{ paddingTop: mobile ? 30 : 70 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: mobile ? "1fr" : "1.12fr 0.88fr",
          gap: mobile ? 36 : 60,
          alignItems: "center",
        }}
      >
        {/* left */}
        <div>
          <Eyebrow color={C.accent} style={{ marginBottom: 18, letterSpacing: "0.18em", fontSize: 11 }}>
            {authedEmail ? "Signed in · run a new assessment" : "For vendors & NGOs bidding on UN, EU & donor contracts"}
          </Eyebrow>
          <h1
            style={{
              fontFamily: F.display,
              fontSize: mobile ? 44 : 68,
              fontWeight: 400,
              lineHeight: 0.98,
              letterSpacing: "-0.025em",
              color: C.ink,
              margin: 0,
            }}
          >
            See if you&rsquo;d win the bid
            <br />
            <span style={{ color: C.mute, fontStyle: "italic" }}>before you write it.</span>
          </h1>
          <p
            style={{
              fontFamily: F.sans,
              fontSize: mobile ? 15 : 16.5,
              color: C.ink2,
              lineHeight: 1.55,
              maxWidth: 500,
              margin: "22px 0 30px",
            }}
          >
            Paste your website. In about a minute you&rsquo;ll have a readiness score, every live tender
            you actually fit, and the things to fix this week.
          </p>

          {/* paste box */}
          <div style={{ maxWidth: 540 }}>
            <div style={{ display: "flex", border: `2px solid ${err ? C.neg : C.ink}`, background: C.white, transition: "border-color .15s" }}>
              <span style={{ padding: "0 4px 0 16px", color: C.faint, fontSize: 14, fontFamily: F.mono, display: "flex", alignItems: "center" }}>
                https://
              </span>
              <input
                value={val}
                onChange={(e) => {
                  setVal(e.target.value);
                  if (err) setErr("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                spellCheck={false}
                aria-label="Your website"
                placeholder="yourcompany.com"
                style={{
                  flex: 1,
                  border: 0,
                  outline: "none",
                  background: "transparent",
                  fontFamily: F.mono,
                  fontSize: 15,
                  color: C.ink,
                  padding: "16px 6px 16px 0",
                  minWidth: 0,
                }}
              />
              <button
                onClick={submit}
                style={{
                  background: C.ink,
                  color: C.paper,
                  border: 0,
                  padding: mobile ? "0 18px" : "0 26px",
                  fontFamily: F.mono,
                  fontSize: 11.5,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Read site →
              </button>
            </div>
            <div style={{ minHeight: 18, marginTop: 9 }}>
              {err ? (
                <span style={{ fontFamily: F.mono, fontSize: 10.5, color: C.neg, letterSpacing: "0.04em" }}>{err}</span>
              ) : (
                <span style={{ fontFamily: F.mono, fontSize: 10.5, color: C.mute, letterSpacing: "0.04em" }}>
                  No signup to see your score · No website?{" "}
                  <button
                    onClick={onStartScratch}
                    style={{
                      background: "none",
                      border: 0,
                      cursor: "pointer",
                      fontFamily: F.mono,
                      fontSize: 10.5,
                      color: C.ink,
                      borderBottom: `1px solid ${C.accent}`,
                      padding: 0,
                      whiteSpace: "nowrap",
                    }}
                  >
                    Answer a few questions instead →
                  </button>
                </span>
              )}
            </div>
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 10.5,
                color: C.faint,
                letterSpacing: "0.04em",
                marginTop: 14,
                display: "flex",
                alignItems: "center",
                gap: 8,
                lineHeight: 1.5,
              }}
            >
              <span style={{ width: 5, height: 5, borderRadius: 999, background: C.pos, display: "inline-block", flexShrink: 0 }} />
              Free to see your score · free dashboard the moment you open it — no card.
            </div>
          </div>
        </div>

        {/* right — what you'll get */}
        <aside>
          <div style={{ background: C.ink, color: C.paper, padding: mobile ? 24 : 30 }}>
            <Eyebrow color={C.accent2}>What you&rsquo;ll get</Eyebrow>
            <ol style={{ listStyle: "none", margin: "16px 0 0", padding: 0 }}>
              {GETS.map(([title, sub], i) => (
                <li
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "26px 1fr",
                    gap: 12,
                    padding: "15px 0",
                    borderTop: i ? "1px solid rgba(246,243,236,0.14)" : "none",
                  }}
                >
                  <span style={{ fontFamily: F.mono, fontSize: 11, color: C.accent2 }}>0{i + 1}</span>
                  <span>
                    <div style={{ fontFamily: F.sans, fontSize: 14.5, color: C.paper, fontWeight: 500 }}>{title}</div>
                    <div style={{ fontFamily: F.sans, fontSize: 12.5, color: "rgba(246,243,236,0.62)", marginTop: 2, lineHeight: 1.45 }}>
                      {sub}
                    </div>
                  </span>
                </li>
              ))}
            </ol>
            <div style={{ fontFamily: F.mono, fontSize: 9.5, color: "rgba(246,243,236,0.5)", marginTop: 18, letterSpacing: "0.05em", lineHeight: 1.5 }}>
              Free to see your score · free dashboard, no card.
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
