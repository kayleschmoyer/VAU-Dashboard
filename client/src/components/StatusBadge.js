import React from 'react';

const CheckIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const AlertIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2V9z" />
  </svg>
);

const CONFIG = {
  online: { label: 'Online', icon: <CheckIcon /> },
  error: { label: 'Error', icon: <AlertIcon /> },
  offline: { label: 'Offline', icon: null },
  unknown: { label: 'Unknown', icon: null },
};

export default function StatusBadge({ status }) {
  const { label, icon } = CONFIG[status] || { label: status, icon: null };
  return (
    <span className={`badge badge-${status}`}>
      {icon}
      {label}
    </span>
  );
}
