import { CoverPage } from "./pages/CoverPage";
import { ExecPage } from "./pages/ExecPage";
import {
  ScorecardPage,
  GapsPage,
  TendersPage,
  GrantsPage,
  NextPage,
  AppendixPage,
} from "./pages/RemainingPages";

export type ReportData = {
  // UUID — capability identifier, used in deep links from the PDF.
  reportId: string;
  // Zero-padded internal row number — what the human reads ("No. 0123").
  displayNumber: string;
  preparedAt: string;
  companyName: string;
  sector: string;
  score: number;
  scoreDelta: number;
  tier: string;
  dimensions: { label: string; value: number; peer: number }[];
  gaps: { title: string; dim: string; lift: number; effort: string; unlock: string; src: string }[];
  tenders: { title: string; value: string; due: string; fit: number; readiness: string; note: string }[];
  grants: { title: string; value: string; status: string; due: string; note: string }[];
  plan: { task: string; startDay: number; endDay: number; owner: string }[];
  citations: { scope: string; title: string; url: string }[];
};

export function ReportDocument({ data }: { data: ReportData }) {
  return (
    <article className="tp2-pdf-doc">
      <CoverPage data={data} />
      <ExecPage data={data} />
      <ScorecardPage data={data} />
      <GapsPage data={data} />
      <TendersPage data={data} />
      <GrantsPage data={data} />
      <NextPage data={data} />
      <AppendixPage data={data} />
    </article>
  );
}
