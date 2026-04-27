/**
 * UpdatePlanViewer
 *
 * Renders Codex `update_plan` calls as a checklist with status indicators.
 */

import React from 'react';

import {
  COLOR_TEXT,
  COLOR_TEXT_MUTED,
  COLOR_TEXT_SECONDARY,
} from '@renderer/constants/cssVariables';
import { CheckCircle2, Circle, CircleDashed } from 'lucide-react';

import type { LinkedToolItem } from '@renderer/types/groups';

interface UpdatePlanViewerProps {
  linkedTool: LinkedToolItem;
}

type PlanStatus = 'pending' | 'in_progress' | 'completed';

interface PlanStep {
  step: string;
  status: PlanStatus;
}

export const UpdatePlanViewer: React.FC<UpdatePlanViewerProps> = ({ linkedTool }) => {
  const steps = extractPlanSteps(linkedTool.input.plan);
  const explanation =
    typeof linkedTool.input.explanation === 'string' ? linkedTool.input.explanation : undefined;

  return (
    <div className="space-y-2">
      {explanation && (
        <p className="text-xs italic" style={{ color: COLOR_TEXT_MUTED }}>
          {explanation}
        </p>
      )}
      <ol className="space-y-1.5">
        {steps.map((step, idx) => (
          <PlanStepRow key={idx} step={step} />
        ))}
        {steps.length === 0 && (
          <li className="text-xs italic" style={{ color: COLOR_TEXT_MUTED }}>
            (empty plan)
          </li>
        )}
      </ol>
    </div>
  );
};

const PlanStepRow: React.FC<{ step: PlanStep }> = ({ step }) => {
  const { icon, color, textColor, lineThrough } = getStepStyle(step.status);

  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0" style={{ color }}>
        {icon}
      </span>
      <span
        className="text-sm"
        style={{
          color: textColor,
          textDecoration: lineThrough ? 'line-through' : undefined,
        }}
      >
        {step.step}
      </span>
    </li>
  );
};

function getStepStyle(status: PlanStatus): {
  icon: React.ReactNode;
  color: string;
  textColor: string;
  lineThrough: boolean;
} {
  switch (status) {
    case 'completed':
      return {
        icon: <CheckCircle2 className="size-4" />,
        color: '#22c55e',
        textColor: COLOR_TEXT_MUTED,
        lineThrough: true,
      };
    case 'in_progress':
      return {
        icon: <CircleDashed className="size-4 animate-spin" style={{ animationDuration: '3s' }} />,
        color: '#eab308',
        textColor: COLOR_TEXT,
        lineThrough: false,
      };
    case 'pending':
    default:
      return {
        icon: <Circle className="size-4" />,
        color: COLOR_TEXT_MUTED,
        textColor: COLOR_TEXT_SECONDARY,
        lineThrough: false,
      };
  }
}

function extractPlanSteps(value: unknown): PlanStep[] {
  if (!Array.isArray(value)) return [];
  const steps: PlanStep[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const step = typeof record.step === 'string' ? record.step : undefined;
    if (!step) continue;
    const rawStatus = typeof record.status === 'string' ? record.status : 'pending';
    const status: PlanStatus =
      rawStatus === 'completed' || rawStatus === 'in_progress' ? rawStatus : 'pending';
    steps.push({ step, status });
  }
  return steps;
}
