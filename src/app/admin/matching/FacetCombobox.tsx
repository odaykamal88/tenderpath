"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "../admin.module.css";

interface Props {
  /** Caption shown above the control. */
  label: string;
  placeholder: string;
  /** Harmonized suggestion universe (deduped canonical labels). */
  options: string[];
  /** Currently-chosen values. */
  selected: string[];
  onChange: (next: string[]) => void;
  /**
   * Allow committing text that doesn't match a suggestion (the API still
   * resolves it via a partial match). Default true — long-tail agencies/sectors
   * aren't always in the harmonized list.
   */
  allowFreeText?: boolean;
}

/**
 * A small, dependency-free multi-select combobox: chips for what's chosen, a
 * real (click-and-keyboard) dropdown of the remaining suggestions, and optional
 * free-text commit. Replaces the native <datalist>, which rendered no visible
 * options on focus in the admin filters. Shared by the country / agency / sector
 * facets so all three behave identically.
 */
export default function FacetCombobox({
  label,
  placeholder,
  options,
  selected,
  onChange,
  allowFreeText = true,
}: Props) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close the menu on an outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const selectedLc = useMemo(() => new Set(selected.map((s) => s.toLowerCase())), [selected]);
  const filtered = useMemo(() => {
    const q = input.trim().toLowerCase();
    return options
      .filter((o) => !selectedLc.has(o.toLowerCase()))
      .filter((o) => (q ? o.toLowerCase().includes(q) : true))
      .slice(0, 60);
  }, [options, selectedLc, input]);

  // Clamp the keyboard highlight at read time, so a shrinking list never points
  // past the end (no effect → no cascading renders).
  const activeIdx = filtered.length ? Math.min(active, filtered.length - 1) : 0;

  const typed = input.trim();
  const typedIsNew =
    allowFreeText &&
    typed.length > 0 &&
    !options.some((o) => o.toLowerCase() === typed.toLowerCase()) &&
    !selectedLc.has(typed.toLowerCase());

  function add(value: string) {
    const v = value.trim();
    if (!v) return;
    // Snap to a canonical option when the text matches one (case-insensitive).
    const canon = options.find((o) => o.toLowerCase() === v.toLowerCase()) ?? v;
    if (!selectedLc.has(canon.toLowerCase())) onChange([...selected, canon]);
    setInput("");
    setActive(0);
    inputRef.current?.focus();
  }

  function remove(value: string) {
    onChange(selected.filter((s) => s !== value));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive(Math.min(activeIdx + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(activeIdx - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && filtered[activeIdx]) add(filtered[activeIdx]);
      else if (typedIsNew) add(typed);
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && !input && selected.length) {
      onChange(selected.slice(0, -1));
    }
  }

  const menuOpen = open && (filtered.length > 0 || typedIsNew);

  return (
    <div className={styles.filterCell}>
      <span className={styles.filterCellLabel}>{label}</span>
      <div ref={rootRef} className={styles.combo}>
        <div
          className={styles.comboControl}
          onClick={() => {
            setOpen(true);
            inputRef.current?.focus();
          }}
        >
          {selected.map((c) => (
            <span key={c} className={styles.comboChip}>
              {c}
              <button
                type="button"
                aria-label={`Remove ${c}`}
                className={styles.comboChipX}
                onClick={(e) => {
                  e.stopPropagation();
                  remove(c);
                }}
              >
                ×
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            className={styles.comboInput}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={selected.length ? "Add another…" : placeholder}
            autoComplete="off"
            role="combobox"
            aria-expanded={menuOpen}
            aria-controls={`combo-${label}`}
          />
        </div>

        {menuOpen && (
          <ul className={styles.comboMenu} id={`combo-${label}`} role="listbox">
            {filtered.map((o, i) => (
              <li
                key={o}
                role="option"
                aria-selected={i === activeIdx}
                className={i === activeIdx ? styles.comboOptActive : styles.comboOpt}
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(o);
                }}
                onMouseEnter={() => setActive(i)}
              >
                {o}
              </li>
            ))}
            {typedIsNew && (
              <li
                role="option"
                aria-selected={false}
                className={styles.comboOpt}
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(typed);
                }}
              >
                <span className={styles.comboAdd}>Add</span> “{typed}”
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
