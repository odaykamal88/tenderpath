"use client";

import { useState } from "react";

export default function SupportWidget() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="mb-1 w-72 rounded-xl border border-gray-200 bg-white shadow-2xl shadow-black/10 overflow-hidden">
          <div className="bg-gray-900 px-4 py-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-white">TenderPath Support</div>
              <div className="text-xs text-gray-400">We typically reply within 1 business day</div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-gray-400 hover:text-white transition-colors"
              aria-label="Close"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-4 space-y-2">
            {[
              {
                icon: (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                ),
                label: "Email Support",
                sub: "hello@tenderpath.co",
                href: "mailto:hello@tenderpath.co",
              },
              {
                icon: (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                ),
                label: "Book a Free Call",
                sub: "15-min expert consultation",
                href: "mailto:hello@tenderpath.co?subject=Book a call",
              },
              {
                icon: (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                ),
                label: "Browse FAQ",
                sub: "Quick answers",
                href: "/faq",
              },
              {
                icon: (
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                    <path d="M11.5 2C6.262 2 2 6.262 2 11.5c0 1.65.43 3.2 1.18 4.55L2 22l6.13-1.16A9.45 9.45 0 0011.5 21C16.738 21 21 16.738 21 11.5S16.738 2 11.5 2zm0 17.25a7.73 7.73 0 01-3.93-1.07l-.28-.17-2.9.55.57-2.82-.18-.29A7.72 7.72 0 013.75 11.5c0-4.27 3.48-7.75 7.75-7.75s7.75 3.48 7.75 7.75-3.48 7.75-7.75 7.75z"/>
                  </svg>
                ),
                label: "WhatsApp",
                sub: "Quick questions via WhatsApp",
                href: "https://wa.me/message/tenderpath",
              },
            ].map((item) => (
              <a
                key={item.label}
                href={item.href}
                target={item.href.startsWith("http") ? "_blank" : undefined}
                rel={item.href.startsWith("http") ? "noreferrer" : undefined}
                className="flex items-center gap-3 rounded-lg p-3 hover:bg-gray-50 transition-colors group"
              >
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-600 group-hover:bg-amber-100 transition-colors">
                  {item.icon}
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900">{item.label}</div>
                  <div className="text-xs text-gray-400">{item.sub}</div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Open support"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-900 text-white shadow-xl hover:bg-gray-700 transition-colors"
      >
        {open ? (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
      </button>
    </div>
  );
}
