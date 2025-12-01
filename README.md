# Safe Axios Client

[![CI Check](https://github.com/Kimbyul88/safe_axios_client/actions/workflows/test.yml/badge.svg)](https://github.com/Kimbyul88/safe_axios_client/actions/workflows/test.yml)

> **JWT 인증 환경에서 발생하는 '경쟁 상태(Race Condition)'를 해결하기 위해 설계된 HTTP 클라이언트 라이브러리**

이 라이브러리는 기존 **'대학 축제 웹 서비스'** 운영 중 발생했던 토큰 만료 및 요청 유실 문제를 해결하기 위해, 핵심 통신 로직을 추출하여 리팩토링한 프로젝트입니다.

대학 축제 사이트 레포 링크 : https://github.com/likelion-13th-official/cardinal_client

## ✧ 문제 해결 (Motivation)

기존 웹 서비스에서는 액세스 토큰이 만료되었을 때, 동시에 여러 API 요청이 발생하면(예: 대시보드 진입) 다음과 같은 문제가 있었습니다.

1. **중복 갱신 요청:** 만료된 토큰으로 인해 401 에러가 여러 번 발생하고, 리프레시 토큰 갱신 요청도 중복으로 서버에 전송됨.
2. **요청 유실:** 갱신 중에 발생한 요청들이 실패 처리되거나, 순서가 꼬이는 현상 발생.

이 문제를 해결하기 위해 **Request Queueing (요청 줄 세우기)** 패턴을 도입하여, 토큰 갱신 중 들어오는 요청을 메모리에 대기시켰다가 갱신 완료 후 일괄 처리하도록 구현했습니다.

## ✧ 주요 기능 (Key Features)

- **Silent Token Refresh:** 401 Unauthorized 발생 시 자동으로 토큰을 갱신하고 재요청합니다.

- **Concurrency Control (동시성 제어):** 토큰 갱신이 진행되는 동안 발생하는 추가 요청들을 실패시키지 않고 `Subscribers Queue`에 적재하여 보호합니다.

- **Multi-Realm Support:** 일반 유저(`user`)와 관리자(`admin`)의 인증 컨텍스트를 분리하여 관리합니다.

- **100% Test Coverage:** 핵심 비즈니스 로직(인터셉터, 큐 처리)에 대한 Unit Test를 작성하여 안정성을 검증했습니다.

## ✧ 설치 및 사용 (Installation)

```bash
npm install safe-axios-client
```

```typescript
import instance from "safe-axios-client";

const fetchUserData = async () => {
  try {
    const response = await instance.get("/api/user/me");
    console.log(response.data);
  } catch (error) {
    console.error("인증 실패", error);
  }
};
```

테스트 (Testing)
이 프로젝트는 Vitest를 사용하여 작성된 단위 테스트를 포함하고 있습니다. 특히 네트워크 비동기 상황에서의 큐 처리 로직을 중점적으로 검증합니다.

```bash
# 의존성 설치
npm install
# 테스트 실행
npm test
```

### ♦︎ 테스트 시나리오

Header Injection: 유효한 토큰이 있을 경우 자동으로 헤더에 주입되는가?

Token Refresh: 401 에러 발생 시 리프레시 토큰으로 갱신을 시도하는가?

Queueing: 갱신 중 들어온 요청들이 유실되지 않고 순차적으로 재실행되는가?
