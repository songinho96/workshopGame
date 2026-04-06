# Okestro Workshop Scoreboard

## Supabase 연결 방법

1. Supabase 프로젝트를 만든 뒤 `Project URL`과 `anon public key`를 확인합니다.
2. `supabase-schema.sql` 파일 내용을 Supabase SQL Editor에서 실행합니다.
이 SQL에는 테이블 생성, RLS 정책, 그리고 Realtime publication 등록까지 포함되어 있습니다.
3. `supabase-config.example.js`를 참고해서 `supabase-config.js`에 실제 값을 넣습니다.

```js
window.WORKSHOP_SUPABASE_CONFIG = {
  url: "https://YOUR_PROJECT_REF.supabase.co",
  anonKey: "YOUR_SUPABASE_ANON_KEY",
};
```

4. 사이트를 새로고침하면 상단 저장 방식이 `Supabase 실시간 저장`으로 바뀝니다.
5. 점수판을 만들면 세션 코드가 생성되고, 같은 `supabase-config.js`를 쓰는 다른 기기에서도 같은 세션을 불러올 수 있습니다.

## 포함된 파일

- `index.html`: 화면 구조
- `styles.css`: 하늘/클라우드 톤 스타일
- `script.js`: 점수판 로직 + Supabase 저장/복원/실시간 동기화
- `supabase-config.js`: 실제 연결 정보 입력 파일
- `supabase-config.example.js`: 예시 설정
- `supabase-schema.sql`: 테이블/RLS 정책 생성용 SQL
