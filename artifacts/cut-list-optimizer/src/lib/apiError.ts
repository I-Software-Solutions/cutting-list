export async function responseError(response: Response, fallback: string): Promise<Error> {
  let detail = '';

  try {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
        detail = body.error;
      }
    } else if (contentType.includes('text/plain')) {
      detail = (await response.text()).trim();
    }
  } catch {
    // The HTTP status is still useful if the error body is unreadable.
  }

  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  return new Error(`${fallback} (${status})${detail ? `: ${detail.slice(0, 500)}` : ''}`);
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}