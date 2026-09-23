'use client';
import { useState } from 'react';

type OperationResult = {
  error?: string;
  settlementStatus?: string;
  status?: string;
};

function isOperationResult(value: unknown): value is OperationResult {
  return typeof value === 'object' && value !== null;
}

export function OperationButtons({ serviceDate }: { serviceDate: string }) {
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const run = async (path: string, body: object) => {
    setMessage('處理中…');
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const value: unknown = await response.json();
    const result = isOperationResult(value) ? value : {};
    setMessage(
      response.ok
        ? `完成：${result.status ?? result.settlementStatus}`
        : `失敗：${result.error}`,
    );
  };
  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-xl font-semibold">人工操作</h2>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          onClick={() => {
            void run('/api/admin/sync', { serviceDate });
          }}
        >
          立即同步
        </button>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          我確認要重算此日期
        </label>
        <button
          disabled={!confirmed}
          onClick={() => {
            void run('/api/admin/statistics/recalculate', {
              serviceDate,
              confirmed: true,
            });
          }}
        >
          確認重算
        </button>
      </div>
      <p role="status" className="mt-3">
        {message}
      </p>
    </section>
  );
}
