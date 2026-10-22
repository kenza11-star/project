'use client';
import { User } from 'lucide-react';
export default function ProfileCard({ name, id, avatar }: { name: string; id: string | null; avatar: string | null }) {
  return (
    <div className="profile">
      <span className="avatar">{avatar ? <img src={avatar} alt="" /> : <User size={26} />}</span>
      <span className="pinfo"><span className="pbox">{name}</span><span className="pbox">{id ? `ID: ${id}` : 'GUEST'}</span></span>
    </div>
  );
}
