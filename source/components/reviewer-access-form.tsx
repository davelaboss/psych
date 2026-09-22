'use client';

import { useState } from 'react';

export function ReviewerAccessForm() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/reviewer-access', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      window.location.assign('/admin');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo activar el acceso.');
      setBusy(false);
    }
  }

  return <form className="reviewer-code-form" onSubmit={submit}>
    <label>Código de acceso de un solo uso
      <input value={code} onChange={(event) => setCode(event.target.value.replace(/[^\d-]/g, '').slice(0, 7))} inputMode="numeric" autoComplete="one-time-code" placeholder="824-731" pattern="\d{3}-?\d{3}" required />
    </label>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <button className="admin-primary" disabled={busy || !code.trim()}>{busy ? 'Ingresando…' : 'Ingresar como revisor'}</button>
  </form>;
}
