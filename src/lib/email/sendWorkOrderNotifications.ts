import { Resend } from "resend";

interface WorkOrderNotification {
  id: number;
  plan: string;
  serviceSlug: string | null;
  email: string | null;
  tenderTitle: string | null;
  agency: string | null;
  paymentStatus: string | null;
  amountCents: number | null;
  currency: string | null;
}

interface WorkOrderStatusNotification extends WorkOrderNotification {
  status: string;
  fulfillmentNotes: string | null;
}

function envValue(key: string): string | null {
  const value = process.env[key]?.trim();
  return value ? value : null;
}

function money(cents: number | null, currency: string | null): string {
  if (cents == null) return "Not recorded";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency ?? "usd").toUpperCase(),
  }).format(cents / 100);
}

function subjectPlan(plan: string): string {
  return plan.replace(/-/g, " ");
}

function statusLabel(status: string): string {
  return status.replace(/-/g, " ").replace(/_/g, " ");
}

export async function sendWorkOrderPaidNotifications(order: WorkOrderNotification): Promise<void> {
  const resendKey = envValue("RESEND_API_KEY");
  if (!resendKey) {
    console.warn("[tp:work_order_email:skipped]", {
      workOrderId: order.id,
      reason: "RESEND_API_KEY missing",
    });
    return;
  }

  const from = envValue("RESEND_FROM_EMAIL") ?? "TenderPath <no-reply@tenderpath.me>";
  const opsEmail = envValue("WORK_ORDER_OPS_EMAIL") ?? envValue("OPS_EMAIL") ?? "info@tenderpath.me";
  const appUrl = envValue("NEXT_PUBLIC_APP_URL") ?? "https://www.tenderpath.me";
  const resend = new Resend(resendKey);
  const plan = subjectPlan(order.plan);
  const context = [
    order.tenderTitle ? `Tender: ${order.tenderTitle}` : null,
    order.agency ? `Agency: ${order.agency}` : null,
    `Payment: ${order.paymentStatus ?? "paid"} (${money(order.amountCents, order.currency)})`,
  ].filter(Boolean).join("\n");

  const userEmail = order.email;
  if (userEmail) {
    await resend.emails.send({
      from,
      to: userEmail,
      subject: `TenderPath received your ${plan} order`,
      text: [
        `We received your ${plan} order.`,
        "",
        context,
        "",
        "The TenderPath team will review the intake and follow up with the next step.",
        `${appUrl}/dashboard/services`,
      ].join("\n"),
    });
  }

  await resend.emails.send({
    from,
    to: opsEmail,
    subject: `New paid work order #${order.id}: ${plan}`,
    text: [
      `Work order #${order.id}`,
      `Plan: ${order.plan}`,
      `Service: ${order.serviceSlug ?? "unknown"}`,
      `Customer: ${userEmail ?? "unknown"}`,
      context,
      "",
      `${appUrl}/admin/work-orders`,
    ].join("\n"),
  });
}

export async function sendWorkOrderStatusNotification(order: WorkOrderStatusNotification): Promise<void> {
  const resendKey = envValue("RESEND_API_KEY");
  if (!resendKey) {
    console.warn("[tp:work_order_status_email:skipped]", {
      workOrderId: order.id,
      reason: "RESEND_API_KEY missing",
    });
    return;
  }

  if (!order.email) {
    console.warn("[tp:work_order_status_email:skipped]", {
      workOrderId: order.id,
      reason: "work order email missing",
    });
    return;
  }

  const from = envValue("RESEND_FROM_EMAIL") ?? "TenderPath <no-reply@tenderpath.me>";
  const appUrl = envValue("NEXT_PUBLIC_APP_URL") ?? "https://www.tenderpath.me";
  const resend = new Resend(resendKey);
  const plan = subjectPlan(order.plan);
  const status = statusLabel(order.status);

  await resend.emails.send({
    from,
    to: order.email,
    subject: `TenderPath work order #${order.id} is now ${status}`,
    text: [
      `Your ${plan} work order is now ${status}.`,
      "",
      order.tenderTitle ? `Tender: ${order.tenderTitle}` : null,
      order.agency ? `Agency: ${order.agency}` : null,
      order.fulfillmentNotes ? `Fulfillment note: ${order.fulfillmentNotes}` : null,
      "",
      `View status: ${appUrl}/dashboard/work-orders/${order.id}`,
    ].filter(Boolean).join("\n"),
  });
}
