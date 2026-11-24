import { Link } from 'react-router-dom';

import { useAuth } from '../context/auth-context';
import { ChevronRightIcon, UserIcon } from './Icons';

/** Pill-shaped account button for the top bar; opens the Member Center. */
export function ProfileButton() {
  const { user } = useAuth();
  const phone = user?.phone ?? 'Player';

  return (
    <Link to="/profile" className="profile-btn" aria-label={`Member Center, ${phone}`}>
      <span className="profile-btn__avatar" aria-hidden="true">
        <UserIcon className="icon icon--sm" />
      </span>
      <span className="profile-btn__phone">{phone}</span>
      <ChevronRightIcon className="icon icon--sm profile-btn__chev" />
    </Link>
  );
}
