// axiosInstance.ts
import axios, {
  AxiosError,
  AxiosHeaders,
  type InternalAxiosRequestConfig,
} from "axios";

type Realm = "user" | "admin";

interface RealmConfig {
  accessKey: string;
  refreshKey: string;
  refreshUrl: string; // 포스트 바디 { refreshToken: string }
  match: (url?: string) => boolean; // 이 URL이면 이 realm의 토큰을 쓴다
  isRefreshEndpoint: (url?: string) => boolean;
}

const BASE_URL = import.meta.env.VITE_API_URL;

const PUBLIC_URLS = ["/calendar"] as const;

const isPublicUrl = (url?: string): boolean =>
  !!url && PUBLIC_URLS.some((u) => url.includes(u));

const REALMS: Record<Realm, RealmConfig> = {
  // 일반 유저 — refreshUrl은 서버 스펙에 맞게 수정
  user: {
    accessKey: "accessToken:user",
    refreshKey: "refreshToken:user",
    refreshUrl: "/auth/refresh", // 카카오 로그인 url 맞게 수정하자
    match: (url?: string) =>
      !!url && !isPublicUrl(url) && !url.startsWith("/pubOffice"),
    isRefreshEndpoint: (url?: string) => !!url && url.includes("/auth/refresh"),
  },

  // 주점 관리자 영역
  admin: {
    accessKey: "accessToken:admin",
    refreshKey: "refreshToken:admin",
    refreshUrl: "/pubOffice/auth/refresh", // 관리자 엔드포인트
    match: (url?: string) =>
      !!url && !isPublicUrl(url) && url.startsWith("/pubOffice"),
    isRefreshEndpoint: (url?: string) =>
      !!url && url.includes("/pubOffice/auth/refresh"),
  },
};

const instance = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
});

function getRealmByUrl(url?: string): Realm | null {
  if (REALMS.admin.match(url)) return "admin";
  if (REALMS.user.match(url)) return "user";
  return null;
}

function applyAuthHeader(
  config: InternalAxiosRequestConfig,
  token: string
): InternalAxiosRequestConfig {
  const headers = new AxiosHeaders(config.headers);
  headers.set("Authorization", `Bearer ${token}`);
  config.headers = headers;
  return config;
}

// 요청 인터셉트
instance.interceptors.request.use((config) => {
  const realm = getRealmByUrl(config.url);
  if (!realm) return config;

  const token = localStorage.getItem(REALMS[realm].accessKey);
  if (token) return applyAuthHeader(config, token);
  return config;
});

// 이미 처리중이면 패스
const isRefreshing: Record<Realm, boolean> = { user: false, admin: false };
const subscribers: Record<Realm, Array<(t: string) => void>> = {
  user: [],
  admin: [],
};

function subscribe(realm: Realm, cb: (t: string) => void): void {
  subscribers[realm].push(cb);
}
function broadcast(realm: Realm, token: string): void {
  subscribers[realm].forEach((cb) => cb(token));
  subscribers[realm] = [];
}

async function refreshAccessToken(realm: Realm): Promise<string> {
  const config = REALMS[realm];
  const refreshToken = localStorage.getItem(config.refreshKey);
  if (!refreshToken) throw new Error("No refresh token in storage");

  const { data } = await axios.post(
    `${BASE_URL}${config.refreshUrl}`,
    { refreshToken },
    { headers: { "Content-Type": "application/json" } }
  );

  // 서버 응답 키에 맞게 조정 (accessToken / token 등)
  const newAccess: string =
    data?.accessToken ?? data?.token ?? data?.data?.accessToken;
  const newRefresh: string | undefined =
    data?.refreshToken ?? data?.data?.refreshToken;

  if (!newAccess) throw new Error("No access token returned from refresh API");

  localStorage.setItem(config.accessKey, newAccess);
  if (newRefresh) localStorage.setItem(config.refreshKey, newRefresh);

  return newAccess;
}

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

// 응답 인터셉터: 401/403 → realm별 refresh & 재시도
instance.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined;
    const status = error.response?.status;
    const url = originalRequest?.url;

    // 퍼블릭 API + 토큰 오류 → 토큰 제거 후 재시도
    if (
      url &&
      isPublicUrl(url) &&
      (status === 401 || status === 403) &&
      !originalRequest?._retry
    ) {
      originalRequest._retry = true;

      // 잘못된 토큰 제거
      localStorage.removeItem(REALMS.user.accessKey);
      localStorage.removeItem(REALMS.user.refreshKey);

      // 헤더에서 Authorization 제거
      delete originalRequest.headers?.Authorization;

      // 토큰 없이 다시 요청
      return instance(originalRequest);
    }

    const realm = url ? getRealmByUrl(url) : null;

    const shouldTryRefresh =
      originalRequest &&
      realm !== null &&
      !originalRequest._retry &&
      (status === 401 || status === 403) &&
      !isPublicUrl(url) &&
      !REALMS[realm].isRefreshEndpoint(url);

    if (!shouldTryRefresh) return Promise.reject(error);

    originalRequest._retry = true;

    if (isRefreshing[realm]) {
      return new Promise((resolve) => {
        subscribe(realm, (token) => {
          resolve(instance(applyAuthHeader(originalRequest, token)));
        });
      });
    }

    isRefreshing[realm] = true;

    try {
      const newToken = await refreshAccessToken(realm);
      broadcast(realm, newToken);
      return instance(applyAuthHeader(originalRequest, newToken));
    } catch (e) {
      // refresh 실패하면 해당 영역 토큰 정리
      localStorage.removeItem(REALMS[realm].accessKey);
      localStorage.removeItem(REALMS[realm].refreshKey);
      // window.location.href = realm === "admin" ? "/pubOffice/login" : "/login";
      return Promise.reject(e);
    } finally {
      isRefreshing[realm] = false;
    }
  }
);

export default instance;
