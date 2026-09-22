import { Suspense } from 'react';

import { LoginForm } from './login-form';

export default function AdminLoginPage() {
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="mb-6 text-2xl font-semibold">FlightCheck 管理員登入</h1>
      <Suspense fallback={<p>載入中…</p>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
