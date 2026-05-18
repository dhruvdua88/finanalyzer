import React from 'react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  compact?: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  secondaryAction,
  compact = false,
}) => (
  <div
    className={`flex flex-col items-center justify-center text-center ${
      compact ? 'py-10 px-4' : 'py-20 px-8'
    }`}
  >
    {icon && (
      <div className="mb-4 text-slate-300 dark:text-slate-600">
        {icon}
      </div>
    )}
    <h3 className={`font-semibold text-slate-700 dark:text-slate-300 ${compact ? 'text-base' : 'text-lg'}`}>
      {title}
    </h3>
    {description && (
      <p className={`mt-2 text-slate-500 dark:text-slate-400 max-w-md leading-relaxed ${compact ? 'text-xs' : 'text-sm'}`}>
        {description}
      </p>
    )}
    {(action || secondaryAction) && (
      <div className="mt-5 flex gap-3 flex-wrap justify-center">
        {action && (
          <button
            onClick={action.onClick}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            {action.label}
          </button>
        )}
        {secondaryAction && (
          <button
            onClick={secondaryAction.onClick}
            className="px-4 py-2 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors"
          >
            {secondaryAction.label}
          </button>
        )}
      </div>
    )}
  </div>
);

export default EmptyState;
