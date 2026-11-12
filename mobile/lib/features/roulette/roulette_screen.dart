import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api/api_client.dart';
import '../../core/theme/app_theme.dart';

/// Playable roulette table with a premium look.
///
/// API calls are unchanged: `GET /wallet/balance` and `POST /game/roulette/play`.
class RouletteScreen extends StatefulWidget {
  const RouletteScreen({super.key});

  @override
  State<RouletteScreen> createState() => _RouletteScreenState();
}

class _RouletteScreenState extends State<RouletteScreen> {
  static const List<String> _betTypes = ['red', 'black', 'green', 'number'];
  static const int _historyLength = 5;

  final TextEditingController _amountController =
      TextEditingController(text: '10');
  final TextEditingController _numberController =
      TextEditingController(text: '7');

  double? _balance;
  String? _balanceError;
  String _betType = 'red';
  bool _isSpinning = false;
  Map<String, dynamic>? _lastResult;
  final List<Map<String, dynamic>> _history = <Map<String, dynamic>>[];

  @override
  void initState() {
    super.initState();
    _loadBalance();
  }

  @override
  void dispose() {
    _amountController.dispose();
    _numberController.dispose();
    super.dispose();
  }

  Future<void> _loadBalance() async {
    try {
      final api = context.read<ApiClient>();
      final response = await api.dio.get<Map<String, dynamic>>('/wallet/balance');
      final balance = response.data?['balance'];

      if (!mounted) {
        return;
      }

      setState(() {
        _balance = balance is num ? balance.toDouble() : 0;
        _balanceError = null;
      });
    } on DioException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _balanceError =
            apiErrorMessage(error, fallback: 'Could not load your balance.');
      });
    }
  }

  void _snack(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  Future<void> _spin() async {
    if (_isSpinning) {
      return;
    }

    final amount = double.tryParse(_amountController.text.trim()) ?? 0;
    if (amount <= 0) {
      _snack('Enter a bet amount greater than 0.');
      return;
    }

    if (_betType == 'number') {
      final pocket = int.tryParse(_numberController.text.trim());
      if (pocket == null || pocket < 0 || pocket > 36) {
        _snack('Choose a number between 0 and 36.');
        return;
      }
    }

    setState(() => _isSpinning = true);

    try {
      final api = context.read<ApiClient>();
      final payload = <String, dynamic>{
        'betAmount': amount,
        'betType': _betType,
      };
      if (_betType == 'number') {
        payload['betValue'] = _numberController.text.trim();
      }

      final response = await api.dio.post<Map<String, dynamic>>(
        '/game/roulette/play',
        data: payload,
      );

      if (!mounted) {
        return;
      }

      final data = response.data ?? const <String, dynamic>{};
      setState(() {
        _isSpinning = false;
        _lastResult = data;
        final balanceAfter = data['balanceAfter'];
        if (balanceAfter is num) {
          _balance = balanceAfter.toDouble();
        }
        _history.insert(0, data);
        if (_history.length > _historyLength) {
          _history.removeRange(_historyLength, _history.length);
        }
      });

      await _loadBalance();

      if (!mounted) {
        return;
      }

      await _showResult(data);
    } on DioException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() => _isSpinning = false);
      _snack(apiErrorMessage(error, fallback: 'The spin could not be placed.'));
      await _loadBalance();
    }
  }

  Future<void> _showResult(Map<String, dynamic> data) {
    final number = data['resultNumber'];
    final color = data['resultColor'] is String ? data['resultColor'] as String : '';
    final label = color.isEmpty
        ? 'Result'
        : 'Result: ${color[0].toUpperCase()}${color.substring(1)}';
    final won = data['won'] == true;
    final payout =
        data['payout'] is num ? (data['payout'] as num).toDouble() : 0.0;

    return showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        title: Text(
          label,
          style: const TextStyle(
            color: AppColors.gold,
            fontWeight: FontWeight.w700,
          ),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Pocket: $number',
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 22,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              won
                  ? 'You won \$${payout.toStringAsFixed(2)}!'
                  : 'No win this time.',
              style: TextStyle(
                color: won ? AppColors.green : AppColors.textMuted,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }
  Color _pocketColor(Object? color) {
    switch (color) {
      case 'red':
        return AppColors.red;
      case 'black':
        return AppColors.blackPocket;
      case 'green':
        return AppColors.green;
      default:
        return AppColors.textMuted;
    }
  }

  Color _betColor(String type) {
    switch (type) {
      case 'red':
        return AppColors.red;
      case 'black':
        return AppColors.blackPocket;
      case 'green':
        return AppColors.green;
      default:
        return AppColors.gold;
    }
  }

  Widget _buildHistory() {
    return SizedBox(
      height: 26,
      child: _history.isEmpty
          ? const Center(
              child: Text(
                'No spins yet',
                style: TextStyle(color: AppColors.textMuted, fontSize: 11),
              ),
            )
          : Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text(
                  'Last',
                  style: TextStyle(color: AppColors.textMuted, fontSize: 11),
                ),
                const SizedBox(width: 8),
                for (final Map<String, dynamic> item in _history)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 3),
                    child: Container(
                      width: 18,
                      height: 18,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: _pocketColor(item['resultColor']),
                        border: Border.all(color: AppColors.divider),
                      ),
                      child: Text(
                        '${item['resultNumber']}',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 9,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
    );
  }

  /// Sweep-gradient wheel with a gold pointer on top.
  ///
  /// `borderRadius: circular(150)` is used instead of `shape: BoxShape.circle`
  /// (a BoxDecoration cannot set both).
  Widget _buildWheel() {
    final Object? number = _lastResult?['resultNumber'];

    return SizedBox(
      height: 292,
      child: Stack(
        alignment: Alignment.topCenter,
        children: [
          Positioned(
            top: 0,
            child: Icon(
              Icons.arrow_drop_down,
              size: 44,
              color: AppColors.gold,
            ),
          ),
          Positioned(
            top: 26,
            child: Container(
              width: 258,
              height: 258,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(150),
                gradient: const SweepGradient(
                  colors: <Color>[
                    AppColors.red,
                    AppColors.blackPocket,
                    AppColors.red,
                    AppColors.blackPocket,
                    AppColors.red,
                    AppColors.blackPocket,
                    AppColors.green,
                    AppColors.blackPocket,
                    AppColors.red,
                  ],
                ),
                border: Border.all(color: AppColors.gold, width: 4),
                boxShadow: const [
                  BoxShadow(
                    color: AppColors.goldGlow,
                    blurRadius: 26,
                    spreadRadius: 2,
                  ),
                ],
              ),
              child: Center(
                child: Container(
                  width: 108,
                  height: 108,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppColors.background,
                    border: Border.all(color: AppColors.gold, width: 3),
                  ),
                  child: Center(
                    child: _isSpinning
                        ? const SizedBox(
                            width: 34,
                            height: 34,
                            child: CircularProgressIndicator(
                              strokeWidth: 3,
                              color: AppColors.gold,
                            ),
                          )
                        : Text(
                            number == null ? '—' : '$number',
                            style: const TextStyle(
                              color: AppColors.gold,
                              fontSize: 34,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
  @override
  Widget build(BuildContext context) {
    final String balanceLabel = _balance == null
        ? 'Balance: —'
        : 'Balance: \$${_balance!.toStringAsFixed(2)}';

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text(
          'Roulette',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
        actions: [
          IconButton(
            onPressed: _loadBalance,
            icon: const Icon(Icons.refresh, color: AppColors.gold),
            tooltip: 'Refresh balance',
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
          children: [
            Row(
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                  decoration: BoxDecoration(
                    gradient: AppColors.goldGradient,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    balanceLabel,
                    style: const TextStyle(
                      color: AppColors.onGold,
                      fontWeight: FontWeight.w800,
                      fontSize: 14,
                    ),
                  ),
                ),
                const Spacer(),
                if (_balanceError != null)
                  const Icon(Icons.wifi_off, color: AppColors.red, size: 18),
              ],
            ),
            if (_balanceError != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  _balanceError!,
                  style: const TextStyle(color: AppColors.red, fontSize: 12),
                ),
              ),
            const SizedBox(height: 10),
            _buildHistory(),
            const SizedBox(height: 6),
            Center(child: _buildWheel()),
            const SizedBox(height: 12),
            TextField(
              controller: _amountController,
              enabled: !_isSpinning,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontWeight: FontWeight.w700,
              ),
              decoration: const InputDecoration(
                labelText: 'Bet amount (\$)',
                prefixIcon:
                    Icon(Icons.payments_outlined, color: AppColors.gold, size: 20),
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'BET ON',
              style: TextStyle(
                color: AppColors.textMuted,
                fontSize: 11,
                letterSpacing: 1.4,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                for (final String type in _betTypes) ...[
                  Expanded(
                    child: _BetToggle(
                      label: type[0].toUpperCase() + type.substring(1),
                      color: _betColor(type),
                      selected: _betType == type,
                      onTap: _isSpinning
                          ? null
                          : () => setState(() => _betType = type),
                    ),
                  ),
                  if (type != _betTypes.last) const SizedBox(width: 8),
                ],
              ],
            ),
            if (_betType == 'number') ...[
              const SizedBox(height: 14),
              TextField(
                controller: _numberController,
                enabled: !_isSpinning,
                keyboardType: TextInputType.number,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontWeight: FontWeight.w700,
                ),
                decoration: const InputDecoration(
                  labelText: 'Number (0–36)',
                  prefixIcon: Icon(Icons.tag, color: AppColors.gold, size: 20),
                ),
              ),
            ],
            const SizedBox(height: 24),
            Center(child: _buildSpinButton()),
            const SizedBox(height: 16),
            const Center(
              child: Text(
                'Provably fair · server seed committed before each spin',
                style: TextStyle(color: AppColors.textMuted, fontSize: 11),
              ),
            ),
          ],
        ),
      ),
    );
  }
  Widget _buildSpinButton() {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: _isSpinning ? null : _spin,
        child: Ink(
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: _isSpinning ? null : AppColors.goldGradient,
            color: _isSpinning ? AppColors.surfaceElevated : null,
            border: Border.all(color: AppColors.gold, width: 3),
            boxShadow: const [
              BoxShadow(
                color: AppColors.goldGlow,
                blurRadius: 30,
                offset: Offset(0, 10),
              ),
            ],
          ),
          child: SizedBox(
            width: 124,
            height: 124,
            child: Center(
              child: _isSpinning
                  ? const SizedBox(
                      width: 34,
                      height: 34,
                      child: CircularProgressIndicator(
                        strokeWidth: 3,
                        color: AppColors.gold,
                      ),
                    )
                  : const Text(
                      'SPIN',
                      style: TextStyle(
                        color: AppColors.onGold,
                        fontSize: 22,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 1.5,
                      ),
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Large custom bet-type toggle (replaces the old ChoiceChips).
class _BetToggle extends StatelessWidget {
  const _BetToggle({
    required this.label,
    required this.color,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final Color color;
  final bool selected;
  final VoidCallback? onTap;

  Color get _glow {
    if (color == AppColors.red) {
      return AppColors.redGlow;
    }
    if (color == AppColors.green) {
      return AppColors.greenGlow;
    }
    if (color == AppColors.blackPocket) {
      return AppColors.greyGlow;
    }
    return AppColors.goldGlow;
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: BoxDecoration(
          color: selected ? color : AppColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: selected ? color : AppColors.divider,
            width: selected ? 2 : 1,
          ),
          boxShadow: selected
              ? [
                  BoxShadow(
                    color: _glow,
                    blurRadius: 16,
                    spreadRadius: 1,
                  ),
                ]
              : null,
        ),
        child: Center(
          child: Text(
            label,
            style: TextStyle(
              color: selected ? Colors.white : AppColors.textMuted,
              fontSize: 13,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ),
    );
  }
}



