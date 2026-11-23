import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/auth-context';
import { useWallet } from '../context/wallet-context';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/Toast';Um nnmj
export const ProfilePage: React.FC = () => {
  const { user, logout } = useAuth();
  const { balance, refreshBalance } = useWallet();
  const { showToast } = useToast();
  const navigate = useNavigate();

  // Sample join date - in production this would come from backend
  const joinDate = 'January 15, 2024';

  // Format currency
  const formattedBalance = balance ? `${balance} ৳` : '0.00 ৳';

  // Quick action handlers
  const handleDeposit = () => navigate('/deposit');
  const handleWithdraw = () => navigate('/withdraw');

  return (
    <div className="profile-page">
      {/* Gradient Header Section */}
      <header className="header-section gradient-bg">
        <div className="header-content max-w-7xl mx-auto px-4 py-6">
          <div className="user-info">
            <div className="avatar-container">
              <div className="w-20 h-20 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold">
                {user?.name?.split(' ').reduce((a, b) => a[b[0]?.charAt(0) ?? ''], '') ?? 'U'}
              </div>
              {user?.vipLevel && (
                <div className="absolute top-0 right-0 bg-indigo-100 text-indigo-800 text-xs rounded-bell">
                  VIP {user.vipLevel}
                </div>
              )}
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">{user?.name ?? 'Welcome'}</h1>
              <p className="text-gray-200 text-sm">{joinDate}</p>
            </div>
          </div>

          {/* Balance & Quick Actions */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            {/* Balance */}
            <div className="balance-display">
              {formattedBalance}
            </div>

            {/* Refresh Balance Button */}
            <button
              onClick={refreshBalance}
              className="ml-2 px-3 py-1.5 text-sm font-medium bg-white text-indigo-600 rounded-full hover:bg-gray-100 transition-colors"
              aria-label="Refresh balance"
            >
              ↻
            </button>

            {/* Quick Action Buttons */}
            <div className="flex sm:flex-wrap gap-2">
              <Link to="/deposit" className="action-button">
                জমা দিন
              </Link>
              <Link to="/withdraw" className="action-button">
                উত্তোলন
              </Link>
              <Link to="/my-card" className="action-button">
                আমার কার্ড
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Menu Grid Section */}
      <main className="py-6">
        <div className="max-w-7xl mx-auto px-4">
          <div className="menu-grid">
            {/* My Rewards */}
            <Link to="/my-rewards" className="menu-item">
              <div className="icon">
                <svg
                  className="w-5 h-5 text-indigo-500"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
              </div>
              <span>My Rewards</span>
            </Link>

            {/* Bet History */}
            <Link to="/bet-history" className="menu-item">
              <div className="icon">
                <svg
                  className="w-5 h-5 text-indigo-500"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-3zM1 3v21a1 1 0 0 0 1 1h21a1 1 0 0 0 1-1V3L5.14 7.38a1 1 0 0 0-.52-.22L1 3z" />
                </svg>
              </div>
              <span>Bet History</span>
            </Link>

            {/* Deposit & Withdraw History */}
            <Link to="/transaction-history" className="menu-item">
              <div className="icon">
                <svg
                  className="w-5 h-5 text-indigo-500"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-3zM1 3v21a1 1 0 0 0 1 1h21a1 1 0 0 0 1-1V3L5.14 7.38a1 1 0 0 0-.52-.22L1 3z" />
                </svg>
              </div>
              <span>Deposit & Withdraw History</span>
            </Link>

            {/* My Account */}
            <Link to "/my-account" className="menu-item">
              <div className="icon">
                <svg
                  className="w-5 h-5 text-indigo-500"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 5-5M12 4h6l2 6h-6l-2 6zm0-2c-3.3 0-6 2.7-6 6s2.7 6 6 6 6-2.7 6-6-2.7-6-6-6z" />
                </svg>
              </div>
              <span>My Account</span>
            </Link>

            {/* Security Center */}
            <div className="menu-item text-gray-400 cursor-not-allowed">
              <div className="icon">
                <svg
                  className="w-5 h-5 text-indigo-500"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15l-5-5 5-5M12 8l6 4v10l-6 3-6-3V8l6-4z" />
                </svg>
              </div>
              <span>Security Center</span>
            </div>

            {/* Invite Friends */}
            <div className="menu-item cursor-pointer" onClick={() => showToast('Coming Soon')}>
              <div className="icon bg-indigo-100 text-indigo-600">
                <svg
                  className="w-5 h-5 text-indigo-600"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M18 13v3a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h5zm0 4h2v2h-2v-2zm-4-6v2h2V9H9v2H7V7H5zm0 8v2h2v-2H7v-2H5z" />
                </svg>
              </div>
              <span>Invite Friends</span>
            </div>

            {/* Missions */}
            <div className="menu-item cursor-pointer" onClick={() => showToast('Coming Soon')}>
              <div className="icon bg-indigo-100 text-indigo-600">
                <svg
                  className="w-5 h-5 text-indigo-600"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v2zM3 7v10h3v-5H3zm4 0v10h5v-5H7z" />
                </svg>
              </div>
              <span>Missions</span>
            </div>

            {/* Rebate */}
            <div className="menu-item cursor-pointer" onClick={() => showToast('Coming Soon')}>
              <div className="icon bg-indigo-100 text-indigo-600">
                <svg
                  className="w-5 h-5 text-indigo-600"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5.66 3.34a1 1 0 0 1 0 1.41l-.71.71-2.83-2.83a1 1 0 1 1 1.41-1.41l2.83 2.83a1 1 0 1 1 1.41-1.41l-2.83 2.83zm-9.19 9.19a1 1 0 0 1 0 1.41l.71.71 2.83-2.83a1 1 0 1 1-1.41 1.41l-2.83 2.83zm12.72-8.72a1 1 0 0 1 0 1.41l-.71.71 2.83 2.83a1 1 0 1 1-1.41 1.41l-2.83-2.83zm-9.25 9.25a1 1 0 0 1 1.41 0l.71-.71-2.83 2.83a1 1 0 1 1-1.41-1.41l2.83-2.83zm8.74-8.74a1 1 0 0 1 1.41 0l.71-.71-2.83-2.83a1 1 0 1 1-1.41 1.41l2.83 2.83z" />
                </svg>
              </div>
              <span>Rebate</span>
            </div>

            {/* Mail */}
            <Link to="/mail" className="menu-item">
              <div className="icon">
                <svg
                  className="w-5 h-5 text-indigo-500"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M4 4h16v2H4V4zm5 13l2-2 2 2H5zm3 3l2 2v2l-2-2zm3-5a2 2 0 1 1-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <span>Mail</span>
            </Link>

            {/* Support */}
            <Link to="/support" className="menu-item">
              <div className="icon">
                <svg
                  className="w-5 h-5 text-indigo-500"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15l-5-5 5-5M12 8l6 4v10l-6 3-6-3V8l6-4z" />
                </svg>
              </div>
              <span>Support</span>
            </Link>

            {/* App Download */}
            <div className="menu-item cursor-pointer" onClick={() => showToast('Coming Soon')}>
              <div className="icon bg-indigo-100 text-indigo-600">
                <svg
                  className="w-5 h-5 text-indigo-600"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M18 13v3a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h5zm0 4h2v2h-2v-2zm-4-6v2h2V9H9v2H7V7H5zm0 8v2h2v-2H7v-2H5z" />
                </svg>
              </div>
              <span>App Download</span>
            </div>

            {/* Customer Service */}
            <Link to="/customer-service" className="menu-item">
              <div className="icon">
                <svg
                  className="w-5 h-5 text-indigo-500"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15l-5-5 5-5M12 8l6 4v10l-6 3-6-3V8l6-4z" />
                </svg>
              </div>
              <span>Customer Service</span>
            </Link>

            {/* Logout */}
            <div className="menu-item cursor-pointer text-red-500">
              <div className="icon bg-red-50 text-red-600">
                <svg
                  className="w-5 h-5 text-red-500"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M19 7c0 1.66-1.34 3-3 3s-3.08.34-3.3-.94L9 15l3 3-.96-1.89A5.06 5.06 0 0 0 11.94 19c1.47 0 2.74-1.23 2.95-2.95L19 7zM8.16 10l1.54 1.54a3.13 3.13 0 0 1-1.83 3.99l-2.31.64L5 21l6-6-.96-1.89c-.37-.7-1.09-1.43-2.05-2.05L8.16 10zM5 19h14a5 5 0 0 0 0-10H5a5 5 0 0 0 0 10z" />
                </svg>
              </div>
              <span>Logout</span>
            </div>