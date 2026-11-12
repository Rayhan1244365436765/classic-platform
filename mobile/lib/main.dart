import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'core/api/api_client.dart';
import 'core/theme/app_theme.dart';
import 'features/auth/auth_provider.dart';
import 'features/auth/login_screen.dart';
import 'features/wallet/dashboard_screen.dart';

void main() {
  runApp(const CasinoApp());
}

class CasinoApp extends StatelessWidget {
  const CasinoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider<ApiClient>(create: (_) => ApiClient()),
        ChangeNotifierProvider<AuthProvider>(
          lazy: false,
          create: (context) =>
              AuthProvider(api: context.read<ApiClient>())..loadToken(),
        ),
      ],
      child: MaterialApp(
        title: 'Casino Platform',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.dark,
        home: const AuthGate(),
      ),
    );
  }
}

/// Chooses the first screen from the stored session.
///
/// This replaces a fixed `initialRoute`: the token is read asynchronously at
/// startup, so a splash is shown until `loadToken()` finishes. Because the gate
/// watches [AuthProvider], logging in or out swaps the screen with no explicit
/// navigation.
class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();

    if (!auth.isInitialized) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    return auth.isLoggedIn ? const DashboardScreen() : const LoginScreen();
  }
}

