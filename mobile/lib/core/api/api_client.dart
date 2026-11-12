import 'package:dio/dio.dart';

import 'token_storage.dart';

/// HTTP client for the Casino Platform REST API.
///
/// `10.0.2.2` is the Android emulator's alias for the host machine's localhost.
/// Override at build time with:
/// `flutter run --dart-define=API_BASE_URL=http://192.168.1.5:3000/api`
class ApiClient {
  ApiClient({Dio? dio})
      : dio = dio ??
            Dio(
              BaseOptions(
                baseUrl: baseUrl,
                connectTimeout: const Duration(seconds: 10),
                receiveTimeout: const Duration(seconds: 10),
                headers: const {'Content-Type': 'application/json'},
              ),
            ) {
    this.dio.interceptors.add(_AuthInterceptor());
    this.dio.interceptors.add(_UnauthorizedInterceptor(() => onUnauthorized?.call()));
  }

  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:3000/api',
  );

  final Dio dio;

  /// Invoked when the API answers 401 on a non-auth endpoint.
  /// The auth provider subscribes to this to drop the session.
  void Function()? onUnauthorized;
}

/// Attaches the stored JWT (if any) to every outgoing request.
class _AuthInterceptor extends Interceptor {
  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final token = await TokenStorage.readToken();

    if (token != null && token.isNotEmpty) {
      options.headers['Authorization'] = 'Bearer $token';
    }

    handler.next(options);
  }
}

/// Surfaces expired/invalid sessions.
///
/// Login and register legitimately return 401 for bad credentials, so those
/// paths are excluded — otherwise a wrong password would look like a logout.
class _UnauthorizedInterceptor extends Interceptor {
  _UnauthorizedInterceptor(this._onUnauthorized);

  final void Function() _onUnauthorized;

  static const List<String> _authPaths = ['/auth/login', '/auth/register'];

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    final path = err.requestOptions.path;
    final isAuthCall = _authPaths.any((authPath) => path.contains(authPath));

    if (err.response?.statusCode == 401 && !isAuthCall) {
      _onUnauthorized();
    }

    handler.next(err);
  }
}

/// Turns a failed request into a message worth showing to a player.
String apiErrorMessage(
  Object error, {
  String fallback = 'Something went wrong. Please try again.',
}) {
  if (error is DioException) {
    final data = error.response?.data;

    if (data is Map) {
      final envelope = data['error'];

      if (envelope is Map) {
        final message = envelope['message'];

        if (message is String && message.isNotEmpty) {
          return message;
        }
      }
    }

    if (error.type == DioExceptionType.connectionError ||
        error.type == DioExceptionType.connectionTimeout) {
      return 'Cannot reach the server. Is the API running?';
    }
  }

  return fallback;
}
