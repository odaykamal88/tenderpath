/* Opens the Stripe billing portal for the current user. Returns the portal URL
 * to redirect to, or an honest message (e.g. no billing account yet). */
export async function requestBillingPortal(token: string | null): Promise<{ url?: string; message?: string }> {
  try {
    const res = await fetch("/api/dashboard/billing-portal", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    const body = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
    if (!res.ok) return { message: body.message ?? "Couldn't open the billing portal." };
    return { url: body.url };
  } catch {
    return { message: "Couldn't open the billing portal." };
  }
}
