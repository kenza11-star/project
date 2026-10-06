'use client';
import { User } from 'lucide-react';
export default function ProfileCard({ name, uid, avatar }: { name: string; uid: string; avatar: string | null }) {
  return (
    <div className="profile">
      <span className="avatar">{avatar ? <img src={avatar} alt="" /> : <User size={26} />}</span>
      <span className="pinfo"><span className="pbox">{name}</span><span className="pbox">UID: {uid}</span></span>
    </div>
  );
}
