/**
 * What a failed assistant request means. Two different things answer 503:
 * `AI_DISABLED` — this deployment has no assistant, a state of the page — and
 * `AI_UNAVAILABLE` — the provider is momentarily busy, an error to retry. The
 * status alone cannot tell them apart, so the body's code decides.
 */
export async function readAiError(
  response: Response,
  fallback: string,
): Promise<{ disabled: boolean; message: string }> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return {
      disabled: body.error?.code === "AI_DISABLED",
      message: body.error?.message ?? fallback,
    };
  } catch {
    return { disabled: false, message: fallback };
  }
}
