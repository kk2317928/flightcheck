'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    let response: Response;
    try {
      response = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: form.get('email'),
          password: form.get('password'),
        }),
      });
    } catch {
      setError('暫時無法登入，請稍後再試。');
      return;
    } finally {
      setSubmitting(false);
    }

    if (!response.ok) {
      setError(
        response.status === 429
          ? '登入嘗試過多，請稍後再試。'
          : '電郵或密碼不正確。',
      );
      return;
    }

    const next = searchParams.get('next');
    router.replace(next?.startsWith('/admin') ? next : '/admin');
    router.refresh();
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-4">
      <label className="grid gap-1">
        <span>管理員電郵</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="border p-2"
        />
      </label>
      <label className="grid gap-1">
        <span>密碼</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="border p-2"
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={submitting} className="border p-2">
        {submitting ? '登入中…' : '登入'}
      </button>
    </form>
  );
}
