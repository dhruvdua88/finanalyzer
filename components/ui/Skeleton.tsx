import React from 'react';

interface SkeletonProps {
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className = '' }) => (
  <div className={`skeleton-shimmer rounded ${className}`} />
);

export const TableSkeleton: React.FC<{ rows?: number; cols?: number }> = ({
  rows = 8,
  cols = 6,
}) => (
  <div className="space-y-2">
    {/* Header */}
    <div className="flex gap-3 px-3 py-2">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} className={`h-4 ${i === 0 ? 'w-32' : 'flex-1'}`} />
      ))}
    </div>
    {/* Rows */}
    {Array.from({ length: rows }).map((_, r) => (
      <div
        key={r}
        className={`flex gap-3 px-3 py-2.5 rounded ${r % 2 === 0 ? 'bg-slate-50 dark:bg-slate-800/40' : ''}`}
      >
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton
            key={i}
            className={`h-3.5 ${
              i === 0 ? 'w-36' : i === cols - 1 ? 'w-20' : 'flex-1'
            }`}
          />
        ))}
      </div>
    ))}
  </div>
);

export const CardSkeleton: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <div className={`grid grid-cols-2 md:grid-cols-${Math.min(count, 4)} gap-4`}>
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700 space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-2 w-16" />
      </div>
    ))}
  </div>
);

export const ModuleSkeleton: React.FC = () => (
  <div className="space-y-5 animate-pulse">
    {/* Top filter bar */}
    <div className="flex gap-3 items-center">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-9 w-32" />
      <Skeleton className="h-9 w-32" />
      <div className="flex-1" />
      <Skeleton className="h-9 w-28" />
    </div>
    {/* KPI cards */}
    <CardSkeleton count={4} />
    {/* Table */}
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="p-3">
        <TableSkeleton rows={7} cols={5} />
      </div>
    </div>
  </div>
);
