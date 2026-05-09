import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

type HttpMethod = "GET" | "POST";

type RequestOptions = {
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: string | Buffer;
  maxRedirects?: number;
};

type RawHttpResponse = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
};

type SessionCacheEntry = {
  cookie: string;
  expiresAt: number;
};

const DEFAULT_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "User-Agent": "Mozilla/5.0",
} as const;

const sessionCache = new Map<string, SessionCacheEntry>();

function getCookieHeaderValue(
  headers: Record<string, string | string[] | undefined>,
  cookieName: string,
) {
  const values = headers["set-cookie"];
  const cookieHeaders = Array.isArray(values) ? values : values ? [values] : [];

  for (const header of cookieHeaders) {
    const match = header.match(new RegExp(`${cookieName}=([^;]+)`));
    if (match?.[0]) {
      return match[0];
    }
  }

  return null;
}

function performRequest(
  url: URL,
  options: RequestOptions,
): Promise<RawHttpResponse> {
  const transport = url.protocol === "http:" ? httpRequest : httpsRequest;

  return new Promise((resolve, reject) => {
    const req = transport(
      url,
      {
        method: options.method || "GET",
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
        );
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks),
          });
        });
      },
    );

    req.on("error", reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

async function requestWithRedirects(
  input: string | URL,
  options: RequestOptions = {},
): Promise<RawHttpResponse> {
  const url = typeof input === "string" ? new URL(input) : input;
  const response = await performRequest(url, options);
  const statusCode = response.statusCode;

  if (
    statusCode >= 300 &&
    statusCode < 400 &&
    response.headers.location &&
    (options.maxRedirects ?? 5) > 0
  ) {
    const locationHeader = Array.isArray(response.headers.location)
      ? response.headers.location[0]
      : response.headers.location;
    if (!locationHeader) {
      return response;
    }

    const nextUrl = new URL(locationHeader, url);
    return requestWithRedirects(nextUrl, {
      ...options,
      maxRedirects: (options.maxRedirects ?? 5) - 1,
    });
  }

  return response;
}

export async function getBhuNakshaSessionCookie(options: {
  baseUrl: string;
  landingPath: string;
  cookieName?: string;
  ttlMs?: number;
}) {
  const cookieName = options.cookieName || "bnxpx9vG";
  const ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  const cacheKey = `${options.baseUrl}|${options.landingPath}|${cookieName}`;
  const cached = sessionCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.cookie;
  }

  let cookie = cached?.cookie || "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await requestWithRedirects(
      new URL(options.landingPath, options.baseUrl),
      {
        method: "GET",
        headers: {
          ...DEFAULT_HEADERS,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        maxRedirects: 0,
      },
    );

    const nextCookie = getCookieHeaderValue(response.headers, cookieName);
    if (nextCookie) {
      cookie = nextCookie;
    }

    if (response.statusCode === 200 && cookie) {
      sessionCache.set(cacheKey, {
        cookie,
        expiresAt: Date.now() + ttlMs,
      });
      return cookie;
    }
  }

  throw new Error(`Failed to initialize BhuNaksha session for ${options.baseUrl}`);
}

export async function postBhuNakshaFormJson<T>(options: {
  baseUrl: string;
  landingPath: string;
  path: string;
  refererPath?: string;
  params: Record<string, string | number | boolean | null | undefined>;
}) {
  const cookie = await getBhuNakshaSessionCookie({
    baseUrl: options.baseUrl,
    landingPath: options.landingPath,
  });

  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(options.params)) {
    if (value === null || value === undefined) continue;
    body.set(key, String(value));
  }

  const response = await requestWithRedirects(
    new URL(options.path, options.baseUrl),
    {
      method: "POST",
      headers: {
        ...DEFAULT_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Origin: options.baseUrl,
        Referer: new URL(
          options.refererPath || options.landingPath,
          options.baseUrl,
        ).toString(),
        Cookie: cookie,
      },
      body: body.toString(),
    },
  );

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `BhuNaksha request failed (${response.statusCode}) for ${options.path}`,
    );
  }

  return JSON.parse(response.body.toString("utf8")) as T;
}

export async function getBhuNakshaBinary(options: {
  baseUrl: string;
  landingPath: string;
  url: string;
  headers?: Record<string, string>;
}) {
  const cookie = await getBhuNakshaSessionCookie({
    baseUrl: options.baseUrl,
    landingPath: options.landingPath,
  });

  const response = await requestWithRedirects(options.url, {
    method: "GET",
    headers: {
      Accept: "image/png,*/*",
      "User-Agent": "Mozilla/5.0",
      Referer: new URL(options.landingPath, options.baseUrl).toString(),
      Cookie: cookie,
      ...(options.headers || {}),
    },
  });

  return response;
}
