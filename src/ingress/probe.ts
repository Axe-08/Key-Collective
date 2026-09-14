export async function forceErrorGcpProbe(rawKey: string, provider: string): Promise<string | null> {
  if (provider !== 'google' && provider !== 'gemini') {
    return null;
  }

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/invalid-model?key=${encodeURIComponent(rawKey)}`);
    if (res.status !== 400) {
      return null;
    }

    const data = await res.json() as any;
    const details = data?.error?.details;
    if (!Array.isArray(details)) {
      return null;
    }

    const errorInfo = details.find((d: any) => d['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo');
    if (errorInfo && errorInfo.metadata && errorInfo.metadata.consumer) {
      // consumer is like "projects/123456789"
      const consumer = errorInfo.metadata.consumer;
      if (consumer.startsWith('projects/')) {
        return consumer.substring('projects/'.length);
      }
    }
  } catch (err) {
    // Fail gracefully
    return null;
  }

  return null;
}
