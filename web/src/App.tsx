import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { ProtectedRoute } from './components/ProtectedRoute';
import Aviator from './pages/Aviator';
import Baccarat from './pages/Baccarat';
import BoxingKing from './pages/BoxingKing';
import Blackjack from './pages/Blackjack';
import Cascade from './pages/Cascade';
import ClassicRoulette from './pages/ClassicRoulette';
import Dice from './pages/Dice';
import Dice3D from './pages/Dice3D';
import FruitBonanza from './pages/FruitBonanza';
import FortuneGems from './pages/FortuneGems';
import DragonTiger from './pages/DragonTiger';
import Keno from './pages/Keno';
import History from './pages/History';
import Lobby from './pages/Lobby';
import Login from './pages/Login';
import Register from './pages/Register';
import ProfilePage from './pages/Profile';
import Mines from './pages/Mines';
import Plinko from './pages/Plinko';
import Roulette from './pages/Roulette';
import Slots from './pages/Slots';
import TeenPatti from './pages/TeenPatti';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Lobby />
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/roulette"
          element={
            <ProtectedRoute>
              <Roulette />
            </ProtectedRoute>
          }
        />
        <Route
          path="/slots"
          element={
            <ProtectedRoute>
              <Slots />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dice"
          element={
            <ProtectedRoute>
              <Dice />
            </ProtectedRoute>
          }
        />
        <Route
          path="/keno"
          element={
            <ProtectedRoute>
              <Keno />
            </ProtectedRoute>
          }
        />
        <Route
          path="/aviator"
          element={
            <ProtectedRoute>
              <Aviator />
            </ProtectedRoute>
          }
        />
        <Route
          path="/mines"
          element={
            <ProtectedRoute>
              <Mines />
            </ProtectedRoute>
          }
        />
        <Route
          path="/plinko"
          element={
            <ProtectedRoute>
              <Plinko />
            </ProtectedRoute>
          }
        />
        <Route
          path="/blackjack"
          element={
            <ProtectedRoute>
              <Blackjack />
            </ProtectedRoute>
          }
        />
        <Route
          path="/baccarat"
          element={
            <ProtectedRoute>
              <Baccarat />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dragontiger"
          element={
            <ProtectedRoute>
              <DragonTiger />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teenpatti"
          element={
            <ProtectedRoute>
              <TeenPatti />
            </ProtectedRoute>
          }
        />
        <Route
          path="/cascade"
          element={
            <ProtectedRoute>
              <Cascade />
            </ProtectedRoute>
          }
        />
        <Route
          path="/classic-roulette"
          element={
            <ProtectedRoute>
              <ClassicRoulette />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fruit-bonanza"
          element={
            <ProtectedRoute>
              <FruitBonanza />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dice3d"
          element={
            <ProtectedRoute>
              <Dice3D />
            </ProtectedRoute>
          }
        />
        <Route
          path="/boxing-king"
          element={
            <ProtectedRoute>
              <BoxingKing />
            </ProtectedRoute>
          }
        />
        <Route
          path="/fortune-gems"
          element={
            <ProtectedRoute>
              <FortuneGems />
            </ProtectedRoute>
          }
        />
        <Route
          path="/history"
          element={
            <ProtectedRoute>
              <History />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
