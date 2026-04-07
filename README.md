# Okestro Workshop Scoreboard React

React + Vite + Supabase 기반 워크숍 점수판입니다.

## 실행 방법

```bash
npm install
npm run dev
```

## Supabase 연결 방법

1. Supabase 프로젝트를 만든 뒤 `Project URL`과 `anon public key`를 확인합니다.
2. `supabase-schema.sql` 파일 내용을 Supabase SQL Editor에서 실행합니다.
   이 SQL에는 테이블 생성, RLS 정책, 그리고 Realtime publication 등록까지 포함되어 있습니다.
3. `public/supabase-config.example.js`를 참고해서 `public/supabase-config.js`에 실제 값을 넣습니다.

```js
window.WORKSHOP_SUPABASE_CONFIG = {
  url: "https://YOUR_PROJECT_REF.supabase.co",
  anonKey: "YOUR_SUPABASE_ANON_KEY",
};
```

4. 개발 서버를 다시 실행하거나 배포 후 새로고침하면 Supabase 연결이 반영됩니다.
5. 점수판을 만들면 세션 코드가 생성되고, 같은 `public/supabase-config.js`를 쓰는 다른 기기에서도 같은 세션을 불러올 수 있습니다.

## 포함된 파일

- `src/App.jsx`: 메인 React 앱
- `src/main.jsx`: React 엔트리
- `styles.css`: 전체 스타일
- `public/supabase-config.js`: 실제 연결 정보 입력 파일
- `public/supabase-config.example.js`: 예시 설정
- `package.json`: React/Vite 의존성 및 스크립트
- `supabase-schema.sql`: 테이블/RLS 정책 생성용 SQL
