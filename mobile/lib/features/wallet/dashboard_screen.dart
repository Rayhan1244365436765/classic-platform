import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../auth/auth_provider.dart';
import '../roulette/roulette_screen.dart';

/// Home / Lobby — premium dark-navy layout with a gold balance pill, a game
/// grid of gradient cards and a 3-tab bottom navigation bar.
///
/// API calls are unchanged: `GET /wallet/balance` and `POST /payment/{kind}`.
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  int _tabIndex = 0;

  double? _balance;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadBalance();
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
        _error = null;
        _loading = false;
      });
    } on DioException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _error = apiErrorMessage(error, fallback: 'Could not load your balance.');
        _loading = false;
      });
    }
  }

  Future<void> _refresh() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    await _loadBalance();
  }

  Future<void> _logout() async {
    // AuthGate reacts to the state change and shows the login screen.
    await context.read<AuthProvider>().logout();
  }

  Future<void> _openRoulette() async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const RouletteScreen()),
    );

    if (!mounted) {
      return;
    }

    await _refresh();
  }
  /// Cashier: asks for an amount, files a deposit/withdraw request.
  Future<void> _requestPayment(String kind) async {
    final controller = TextEditingController(text: '10');

    final amount = await showDialog<double>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        title: Text(
          kind == 'deposit' ? 'Deposit' : 'Withdraw',
          style: const TextStyle(
            color: AppColors.gold,
            fontWeight: FontWeight.w700,
          ),
        ),
        content: TextField(
          controller: controller,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(labelText: 'Amount (\$)'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext)
                .pop(double.tryParse(controller.text.trim())),
            child: const Text('Request'),
          ),
        ],
      ),
    );

    controller.dispose();

    if (!mounted || amount == null || amount <= 0) {
      return;
    }

    try {
      final api = context.read<ApiClient>();
      await api.dio.post<Map<String, dynamic>>(
        '/payment/$kind',
        data: <String, dynamic>{'amount': amount},
      );

      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Request pending admin approval.')),
      );

      await _refresh();
    } on DioException catch (error) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            apiErrorMessage(error, fallback: 'Could not send the request.'),
          ),
        ),
      );
    }
  }

  void _selectTab(int index) {
    setState(() => _tabIndex = index);
  }
  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final phone = auth.user?['phone'];
    final label = phone is String && phone.isNotEmpty ? phone : 'Player';

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            _Header(
              phone: label,
              balance: _balance,
              loading: _loading,
              hasError: _error != null,
              onRefresh: _refresh,
              onLogout: _logout,
            ),
            Expanded(
              child: _tabIndex == 0
                  ? _LobbyBody(
                      loading: _loading,
                      error: _error,
                      onRetry: _refresh,
                      onOpenRoulette: _openRoulette,
                      onDeposit: () => _requestPayment('deposit'),
                      onWithdraw: () => _requestPayment('withdraw'),
                    )
                  : _ComingSoonTab(
                      title: _tabIndex == 1 ? 'Promotions' : 'Profile',
                      icon: _tabIndex == 1
                          ? Icons.local_fire_department_outlined
                          : Icons.person_outline,
                    ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tabIndex,
        onDestinationSelected: _selectTab,
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined, color: AppColors.textMuted),
            selectedIcon: Icon(Icons.home, color: AppColors.gold),
            label: 'Home',
          ),
          NavigationDestination(
            icon: Icon(
              Icons.local_fire_department_outlined,
              color: AppColors.textMuted,
            ),
            selectedIcon:
                Icon(Icons.local_fire_department, color: AppColors.gold),
            label: 'Promotions',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline, color: AppColors.textMuted),
            selectedIcon: Icon(Icons.person, color: AppColors.gold),
            label: 'Profile',
          ),
        ],
      ),
    );
  }
}
/// Profile icon + phone on the left, gold balance pill on the right.
class _Header extends StatelessWidget {
  const _Header({
    required this.phone,
    required this.balance,
    required this.loading,
    required this.hasError,
    required this.onRefresh,
    required this.onLogout,
  });

  final String phone;
  final double? balance;
  final bool loading;
  final bool hasError;
  final Future<void> Function() onRefresh;
  final Future<void> Function() onLogout;

  String get _balanceLabel {
    if (loading) {
      return '···';
    }
    if (hasError) {
      return '—';
    }
    return '\$${(balance ?? 0).toStringAsFixed(2)}';
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: AppColors.surface,
              border: Border.all(color: AppColors.divider),
            ),
            child: const Icon(Icons.person, color: AppColors.gold, size: 24),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  phone,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                  ),
                ),
                const SizedBox(height: 2),
                const Text(
                  'Welcome back',
                  style: TextStyle(color: AppColors.textMuted, fontSize: 12),
                ),
              ],
            ),
          ),
          Material(
            color: Colors.transparent,
            child: InkWell(
              borderRadius: BorderRadius.circular(999),
              onTap: onRefresh,
              child: Ink(
                decoration: BoxDecoration(
                  gradient: AppColors.goldGradient,
                  borderRadius: BorderRadius.circular(999),
                  boxShadow: const [
                    BoxShadow(
                      color: AppColors.goldGlow,
                      blurRadius: 16,
                      offset: Offset(0, 6),
                    ),
                  ],
                ),
                child: Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.account_balance_wallet,
                        size: 16,
                        color: AppColors.onGold,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        _balanceLabel,
                        style: const TextStyle(
                          color: AppColors.onGold,
                          fontWeight: FontWeight.w800,
                          fontSize: 14,
                        ),
                      ),
                      const SizedBox(width: 6),
                      const Icon(
                        Icons.refresh,
                        size: 16,
                        color: AppColors.onGold,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          IconButton(
            onPressed: () => onLogout(),
            icon: const Icon(Icons.logout, color: AppColors.textMuted, size: 20),
            tooltip: 'Logout',
          ),
        ],
      ),
    );
  }
}
/// Scrollable lobby: error banner (if any), game grid, cashier buttons.
class _LobbyBody extends StatelessWidget {
  const _LobbyBody({
    required this.loading,
    required this.error,
    required this.onRetry,
    required this.onOpenRoulette,
    required this.onDeposit,
    required this.onWithdraw,
  });

  final bool loading;
  final String? error;
  final Future<void> Function() onRetry;
  final VoidCallback onOpenRoulette;
  final VoidCallback onDeposit;
  final VoidCallback onWithdraw;

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      color: AppColors.gold,
      onRefresh: onRetry,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
        children: [
          if (error != null)
            Container(
              margin: const EdgeInsets.only(bottom: 16),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.red),
              ),
              child: Row(
                children: [
                  const Icon(Icons.warning_amber_rounded,
                      color: AppColors.red, size: 20),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      error!,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 13,
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: onRetry,
                    child: const Text('Retry'),
                  ),
                ],
              ),
            ),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Games',
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
              Text(
                '1 live · 5 soon',
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 12,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 16,
            crossAxisSpacing: 16,
            childAspectRatio: 0.92,
            children: [
              GameCard(
                title: 'Roulette',
                subtitle: 'Play now',
                icon: Icons.casino,
                gradient: AppColors.rouletteCardGradient,
                glow: AppColors.redGlow,
                enabled: true,
                onTap: onOpenRoulette,
              ),
              const GameCard(
                title: 'Blackjack',
                subtitle: 'Coming Soon',
                icon: Icons.lock,
                gradient: AppColors.lockedCardGradient,
                enabled: false,
              ),
              const GameCard(
                title: 'Slots',
                subtitle: 'Coming Soon',
                icon: Icons.lock,
                gradient: AppColors.lockedCardGradient,
                enabled: false,
              ),
              const GameCard(
                title: 'Baccarat',
                subtitle: 'Coming Soon',
                icon: Icons.lock,
                gradient: AppColors.lockedCardGradient,
                enabled: false,
              ),
              const GameCard(
                title: 'Dice',
                subtitle: 'Coming Soon',
                icon: Icons.lock,
                gradient: AppColors.lockedCardGradient,
                enabled: false,
              ),
              const GameCard(
                title: 'Poker',
                subtitle: 'Coming Soon',
                icon: Icons.lock,
                gradient: AppColors.lockedCardGradient,
                enabled: false,
              ),
            ],
          ),
          const SizedBox(height: 22),
          Row(
            children: [
              Expanded(
                child: _CashierButton(
                  label: 'Deposit',
                  icon: Icons.arrow_downward,
                  onTap: onDeposit,
                  filled: true,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: _CashierButton(
                  label: 'Withdraw',
                  icon: Icons.arrow_upward,
                  onTap: onWithdraw,
                  filled: false,
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Center(
            child: Text(
              loading ? 'Updating balance…' : 'Provably fair roulette is live',
              style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}
/// Gradient game tile: large icon, bottom title + subtitle.
class GameCard extends StatelessWidget {
  const GameCard({
    super.key,
    required this.title,
    required this.icon,
    required this.gradient,
    required this.enabled,
    this.subtitle,
    this.glow,
    this.onTap,
  });

  final String title;
  final String? subtitle;
  final IconData icon;
  final LinearGradient gradient;
  final bool enabled;
  final Color? glow;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: enabled ? onTap : null,
        child: Ink(
          decoration: BoxDecoration(
            gradient: gradient,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: enabled ? AppColors.gold : AppColors.divider,
              width: enabled ? 1.4 : 1,
            ),
            boxShadow: enabled
                ? [
                    BoxShadow(
                      color: glow ?? AppColors.goldGlow,
                      blurRadius: 18,
                      offset: const Offset(0, 8),
                    ),
                  ]
                : null,
          ),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Align(
                  alignment: Alignment.topRight,
                  child: Icon(
                    enabled ? Icons.bolt : Icons.lock_outline,
                    size: 16,
                    color: enabled ? AppColors.gold : AppColors.textMuted,
                  ),
                ),
                Center(
                  child: Icon(
                    icon,
                    size: 50,
                    color: enabled ? Colors.white : AppColors.textMuted,
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle ?? '',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color:
                            enabled ? AppColors.gold : AppColors.textMuted,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Gold pill (deposit) or gold-outlined (withdraw) cashier action.
class _CashierButton extends StatelessWidget {
  const _CashierButton({
    required this.label,
    required this.icon,
    required this.onTap,
    required this.filled,
  });

  final String label;
  final IconData icon;
  final VoidCallback onTap;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Ink(
          decoration: BoxDecoration(
            gradient: filled ? AppColors.goldGradient : null,
            color: filled ? null : AppColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: filled ? AppColors.gold : AppColors.divider,
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 14),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  icon,
                  size: 18,
                  color: filled ? AppColors.onGold : AppColors.gold,
                ),
                const SizedBox(width: 8),
                Text(
                  label,
                  style: TextStyle(
                    color: filled ? AppColors.onGold : AppColors.gold,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Placeholder body for the Promotions / Profile tabs.
class _ComingSoonTab extends StatelessWidget {
  const _ComingSoonTab({required this.title, required this.icon});

  final String title;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 56, color: AppColors.textMuted),
          const SizedBox(height: 16),
          Text(
            title,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 18,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Coming soon',
            style: TextStyle(color: AppColors.textMuted),
          ),
        ],
      ),
    );
  }
}




