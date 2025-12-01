import { describe, it, expect, vi, afterEach } from "vitest";
import axios from "axios";
import instance from "./axiosInstance";

vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("axios")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      create: actual.default.create,
      post: vi.fn(),
    },
  };
});

describe("Axios 클라이언트 테스트", () => {
  // 테스트 하나 끝날 때마다 초기화
  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("로그인한 유저라면 헤더에 토큰이 자동으로 실려야 한다", async () => {
    const fakeToken = "my-secret-token-123";
    localStorage.setItem("accessToken:user", fakeToken);

    const mockAdapter = vi.fn().mockResolvedValue({
      data: {},
      status: 200,
      statusText: "OK",
      headers: {},
      config: {},
    });
    instance.defaults.adapter = mockAdapter;

    await instance.get("/api/user/me");

    const sentConfig = mockAdapter.mock.calls[0][0];
    expect(sentConfig.headers.Authorization).toBe(`Bearer ${fakeToken}`);
  });

  it("토큰이 없으면 헤더에 아무것도 없어야 한다", async () => {
    const mockAdapter = vi.fn().mockResolvedValue({
      data: {},
      status: 200,
      statusText: "OK",
      headers: {},
      config: {},
    });
    instance.defaults.adapter = mockAdapter;

    await instance.get("/api/public");

    const sentConfig = mockAdapter.mock.calls[0][0];
    expect(sentConfig.headers.Authorization).toBeUndefined();
  });

  it("401 에러(토큰 만료) 발생 시, 토큰을 갱신하고 재요청해야 한다", async () => {
    // 1. [준비] 만료된 토큰 상황 연출
    localStorage.setItem("accessToken:user", "expired-token");
    localStorage.setItem("refreshToken:user", "valid-refresh-token");

    // 리프레시 토큰 요청(axios.post)이 오면 'new-fresh-token'을 준다고 설정
    (axios.post as any).mockResolvedValue({
      data: { accessToken: "new-fresh-token" },
    });

    // 2. [조작] 시나리오 설정: 첫 요청은 401, 재요청은 200
    let callCount = 0;
    const mockAdapter = vi.fn(async (config) => {
      callCount++;
      // 첫 번째 호출: 401 에러 (토큰 만료)
      if (callCount === 1) {
        return Promise.reject({
          response: { status: 401 },
          config: config,
        });
      }
      // 두 번째 호출: 성공
      return {
        data: "success",
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    });
    instance.defaults.adapter = mockAdapter;

    // 3. [실행]
    await instance.get("/api/protected-data");

    // 4. [검증]
    // 총 2번 호출되었는지 확인 (실패 -> 재시도)
    expect(mockAdapter).toHaveBeenCalledTimes(2);

    // 두 번째 호출(재시도) 때 새 토큰이 헤더에 들어갔는지 확인
    const retryConfig = mockAdapter.mock.calls[1][0];
    expect(retryConfig.headers.Authorization).toBe("Bearer new-fresh-token");
  });
});
