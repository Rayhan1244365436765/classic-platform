# casino_mobile

Flutter Android player app for the Casino Platform monorepo.

```bash
flutter pub get
flutter run
```

The app talks to `http://10.0.2.2:3000/api` (`10.0.2.2` = host localhost from the Android
emulator). On a physical device pass your machine's LAN IP:

```bash
flutter run --dart-define=API_BASE_URL=http://192.168.1.5:3000/api
```

## Screens

| Screen | File | Notes |
| --- | --- | --- |
| Login | `lib/features/auth/login_screen.dart` | phone + password → `POST /auth/login` |
| Register | `lib/features/auth/register_screen.dart` | phone + password → `POST /auth/register` |
| Home lobby | `lib/features/wallet/dashboard_screen.dart` | profile icon + phone, gold balance pill (tap to refresh), gradient `GameCard` grid (Roulette live, 5 locked), deposit/withdraw actions, 3-tab `NavigationBar` |
| Roulette | `lib/features/roulette/roulette_screen.dart` | sweep-gradient wheel + pointer, last-5 result dots, custom bet toggles, circular gold SPIN button, result dialog |

Design system: `lib/core/theme/app_theme.dart` (`AppColors` + `AppTheme.dark`) — navy `#0B132B`
background, `#1C2541` surfaces, gold `#F4C430` accent, red/green bet colours.

State: `provider` — `AuthProvider` (`lib/features/auth/auth_provider.dart`) owns the session and
persists it with `shared_preferences`. `AuthGate` in `main.dart` shows the lobby when a token is
stored, otherwise login.

## Note

This project was written by hand to mirror the output of:

```bash
flutter create mobile --org com.casinoplatform --project-name casino_mobile
```

The Flutter SDK was not available on the machine where the scaffold was generated, so run the
command above (with `.` as the directory, from inside `mobile/`) once locally to generate the
Gradle wrapper (`gradlew`, `gradlew.bat`, `gradle/wrapper/gradle-wrapper.jar`), `local.properties`,
launcher icons, and any other SDK-version-specific files. Your `lib/` code will be preserved.

Layout:

```
lib/
├── core/
│   ├── api/          # api_client.dart (dio + JWT + 401 hook), token_storage.dart
│   └── theme/        # app_theme.dart (AppColors palette + AppTheme.dark)
├── features/
│   ├── auth/         # auth_provider.dart, login_screen.dart, register_screen.dart
│   ├── wallet/       # dashboard_screen.dart (Home lobby + GameCard)
│   └── roulette/     # roulette_screen.dart
└── main.dart         # providers, AppTheme.dark, AuthGate
```

