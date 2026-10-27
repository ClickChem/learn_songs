# 가사 노트

일본어·러시아어 노래 가사를 붙여넣으면 줄별 해석, 핵심 단어, 문법, 러시아어 강세(일본어는 후리가나)를 정리해 주는 PWA입니다.
Anthropic API 키로 동작하고, 안드로이드 휴대폰에 앱처럼 설치할 수 있습니다.

## 1. API 키 준비
1. https://platform.claude.com 에 로그인해 결제 수단(크레딧)을 등록합니다.
2. API Keys 메뉴에서 키를 만듭니다. 이 앱 전용으로 따로 만들고, Console에서 월 사용 한도를 걸어 두는 것을 권합니다.

## 2. 무료로 배포 (GitHub Pages)
1. GitHub에 새 저장소를 만들고 이 폴더 전체를 올립니다 (`node_modules`, `dist`는 제외됨).
2. 저장소 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 바꿉니다.
3. `main` 브랜치에 푸시하면 `.github/workflows/deploy.yml` 이 빌드해서 `https://<아이디>.github.io/<저장소>/` 에 올립니다.

## 3. 안드로이드에 설치
1. 휴대폰 Chrome으로 위 주소를 엽니다.
2. 메뉴(⋮) → **앱 설치** 또는 **홈 화면에 추가** 를 누릅니다.
3. 앱을 열고 오른쪽 위 **설정 · API 키** 에 키를 넣고 저장합니다.

## 로컬에서 실행
```bash
npm install
npm run dev      # 개발 서버 (같은 Wi-Fi의 휴대폰에서도 접속 가능, 단 설치는 HTTPS 주소에서만 됨)
npm run build    # dist/ 생성
```

## 보안·비용 메모
- API 키는 휴대폰 브라우저 저장소(localStorage)에 평문으로 저장되고 `api.anthropic.com` 으로만 전송됩니다. 본인 기기 전용으로 쓰고, 앱 주소를 다른 사람과 공유하더라도 키는 각자 넣어야 합니다.
- 모델은 설정에서 고릅니다 (기본: Claude Opus 5.5). Opus·Sonnet 선택 시 거절 응답이 나오면 서버가 다른 모델로 다시 시도하는 `fallbacks: "default"` 옵션을 켜 두었습니다.
- 앱은 가사를 가져오지 않습니다. 붙여넣은 텍스트만 분석하도록 지시되어 있습니다.
- 강세·읽기는 AI 결과라 틀릴 수 있으니 사전으로 확인하세요.
