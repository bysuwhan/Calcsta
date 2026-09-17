### Cloudflare Pages

브라우저 앱에는 다음 Pages 빌드 설정을 사용하세요.

- 루트 디렉터리: `web`
- 빌드 명령: `npm run build:pages`
- 빌드 출력 디렉터리: `dist`
- Node.js: `22.16.0` (`web/.node-version`에도 고정됨)

Pages 빌드 이미지에서 Rust와 `wasm-pack`을 사용할 수 있어야 합니다. `build:pages`는 Vite가
앱을 번들링하기 전에 솔버를 컴파일합니다. Cloudflare는 `CF_PAGES=1`을 자동으로 주입하며,
이 값이 설정된 상태에서 생성된 솔버가 없으면 UI 전용 번들이 배포되지 않도록 빌드가 실패합니다.

`npm run build`와 `npm run build:only`는 Vite 번들을 생성합니다. 실제 솔버를 먼저 생성해야 하는
배포 환경에서는 `npm run build:pages`를 사용하세요.