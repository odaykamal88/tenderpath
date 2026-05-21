import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

const TIERS = new Set(["T1", "T2", "REF"]);
const UNGM_STATUSES = new Set(["registered", "pending", "unregistered", "unknown"]);

export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const assessmentId = Number(b.assessment_id);
  if (!Number.isInteger(assessmentId) || assessmentId <= 0) {
    return NextResponse.json({ error: "assessment_id required" }, { status: 400 });
  }

  const tierRaw = b.tier == null ? null : String(b.tier).trim() || null;
  const ungmRaw = b.ungm_status == null ? null : String(b.ungm_status).trim() || null;

  if (tierRaw !== null && !TIERS.has(tierRaw)) {
    return NextResponse.json({ error: `tier must be one of: ${[...TIERS].join(", ")} or null` }, { status: 400 });
  }
  if (ungmRaw !== null && !UNGM_STATUSES.has(ungmRaw)) {
    return NextResponse.json({ error: `ungm_status must be one of: ${[...UNGM_STATUSES].join(", ")} or null` }, { status: 400 });
  }

  const contactName = b.contact_name == null ? null : (String(b.contact_name).trim() || null);
  const contactEmail = b.contact_email == null ? null : (String(b.contact_email).trim() || null);
  const contactPhone = b.contact_phone == null ? null : (String(b.contact_phone).trim() || null);
  const notes = b.relationship_notes == null ? null : (String(b.relationship_notes).trim() || null);

  if (contactEmail && contactEmail.length > 320) {
    return NextResponse.json({ error: "contact_email too long" }, { status: 400 });
  }
  if (notes && notes.length > 4000) {
    return NextResponse.json({ error: "relationship_notes too long (max 4000 chars)" }, { status: 400 });
  }

  try {
    const rows = await sql`
      INSERT INTO vendor_profiles (
        assessment_id, tier, ungm_status,
        contact_name, contact_email, contact_phone, relationship_notes
      ) VALUES (
        ${assessmentId}, ${tierRaw}, ${ungmRaw},
        ${contactName}, ${contactEmail}, ${contactPhone}, ${notes}
      )
      ON CONFLICT (assessment_id) DO UPDATE SET
        tier = EXCLUDED.tier,
        ungm_status = EXCLUDED.ungm_status,
        contact_name = EXCLUDED.contact_name,
        contact_email = EXCLUDED.contact_email,
        contact_phone = EXCLUDED.contact_phone,
        relationship_notes = EXCLUDED.relationship_notes,
        updated_at = NOW()
      RETURNING id, assessment_id, tier, ungm_status,
                contact_name, contact_email, contact_phone, relationship_notes,
                created_at, updated_at
    `;
    return NextResponse.json({ profile: rows[0] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("violates foreign key")) {
      return NextResponse.json({ error: "assessment_id not found" }, { status: 404 });
    }
    console.error("[matching:vendor-profile-upsert:db_error]", err);
    return NextResponse.json({ error: "Failed to save vendor profile" }, { status: 500 });
  }
}
