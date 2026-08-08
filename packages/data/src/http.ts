export type FetchLike = typeof fetch;

export interface JsonRequestOptions extends RequestInit {
  attempts?: number;
}

export async function requestJson<T>(
  fetcher: FetchLike,
  url: string,
  options: JsonRequestOptions = {},
): Promise<T> {
  const { attempts = 3, ...request } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetcher(url, request);
      if (response.ok) return (await response.json()) as T;

      if (response.status !== 429 && response.status < 500) {
        throw new Error(`HTTP_${response.status}`);
      }
      const retryAfterSeconds = Number(
        response.headers.get("retry-after") ?? 0,
      );
      const delayMs =
        retryAfterSeconds > 0
          ? retryAfterSeconds * 1000
          : 250 * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      lastError = new Error(`HTTP_${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt < attempts)
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("HTTP_REQUEST_FAILED");
}
