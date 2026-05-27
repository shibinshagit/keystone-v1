type PublicBhuNakshaParamValue =
  | string
  | number
  | boolean
  | null
  | undefined;

export async function postPublicBhuNakshaFormJson<T>(options: {
  baseUrl: string;
  path: string;
  params: Record<string, PublicBhuNakshaParamValue>;
  refererPath?: string;
}) {
  const body = new URLSearchParams();
  Object.entries(options.params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    body.set(key, String(value));
  });

  const baseReferer = options.baseUrl.endsWith("/")
    ? options.baseUrl
    : `${options.baseUrl}/`;

  const response = await fetch(new URL(options.path, baseReferer), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0",
      Referer: options.refererPath
        ? new URL(options.refererPath, baseReferer).toString()
        : baseReferer,
    },
    body: body.toString(),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `BhuNaksha request failed (${response.status}) for ${options.path}`,
    );
  }

  return (await response.json()) as T;
}
