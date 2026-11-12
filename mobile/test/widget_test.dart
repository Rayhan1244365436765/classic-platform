import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:casino_mobile/main.dart';

void main() {
  testWidgets('shows the login screen when no session is stored',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});

    await tester.pumpWidget(const CasinoApp());
    await tester.pumpAndSettle();

    expect(find.text('Sign in'), findsOneWidget);
  });
}

