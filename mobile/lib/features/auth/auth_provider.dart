import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../../core/api/api_client.dart';
import '../../core/api/token_storage.dart';

/// Holds the session for the whole app.
///
/// `AuthGate` watches this notifier, so logging in or out swaps the visible
/// screen without any manual navigation.
class AuthProvider extends ChangeNotifier {
  AuthProvider({required ApiClient api}) : _api = api {
    // A 401 on a protected endpoint means the token is gone or expired.
    _api.onUnauthorized = _handleUnauthorized;
  }

  final ApiClient _api;

  String? _token;
  Map<String, dynamic>? _user;
  bool _isInitialized = false;
  bool _isBusy = false;
  String? _error;

  String? get token => _token;
  Map<String, dynamic>? get user => _user;
  bool get isLoggedIn => _token != null;

  /// False until the stored token has been checked at startup.
  bool get isInitialized => _isInitialized;
  bool get isBusy => _isBusy;
  String? get error => _error;

  /// Reads any saved session. Called once at startup.
  Future<void> loadToken() async {
    final savedToken = await TokenStorage.readToken();

    if (savedToken != null && savedToken.isNotEmpty) {
      _token = savedToken;
      _user = await TokenStorage.readUser();
    }

    _isInitialized = true;
    notifyListeners();
  }

  /// Returns true when the credentials were accepted.
  Future<bool> login(String phone, String password) async {
    _error = null;
    _isBusy = true;
    notifyListeners();

    try {
      final response = await _api.dio.post<Map<String, dynamic>>(
        '/auth/login',
        data: {'phone': phone, 'password': password},
      );

      final data = response.data ?? const <String, dynamic>{};
      final token = data['token'];
      final user = data['user'];

      if (token is! String || token.isEmpty) {
        _error = 'Login failed: the server did not return a token.';
        return false;
      }

      _token = token;
      _user = user is Map<String, dynamic> ? user : null;

      await TokenStorage.saveToken(token);
      if (_user != null) {
        await TokenStorage.saveUser(_user!);
      }

      return true;
    } on DioException catch (error) {
      _error = apiErrorMessage(
        error,
        fallback: 'Invalid phone number or password.',
      );
      return false;
    } catch (error) {
      _error = apiErrorMessage(error, fallback: 'Could not sign in.');
      return false;
    } finally {
      _isBusy = false;
      notifyListeners();
    }
  }

  /// Creates an account. The API returns no token, so the player signs in next.
  Future<bool> register(String phone, String password) async {
    _error = null;
    _isBusy = true;
    notifyListeners();

    try {
      await _api.dio.post<Map<String, dynamic>>(
        '/auth/register',
        data: {'phone': phone, 'password': password},
      );

      return true;
    } on DioException catch (error) {
      _error = apiErrorMessage(
        error,
        fallback: 'Could not create your account.',
      );
      return false;
    } catch (error) {
      _error = apiErrorMessage(error, fallback: 'Could not create your account.');
      return false;
    } finally {
      _isBusy = false;
      notifyListeners();
    }
  }

  Future<void> logout() async {
    _token = null;
    _user = null;
    _error = null;

    await TokenStorage.clear();
    notifyListeners();
  }

  /// Called by the Dio interceptor when the API rejects the token.
  void _handleUnauthorized() {
    if (_token == null) {
      return;
    }

    _token = null;
    _user = null;
    _error = 'Your session expired. Please sign in again.';
    unawaited(TokenStorage.clear());
    notifyListeners();
  }
}
