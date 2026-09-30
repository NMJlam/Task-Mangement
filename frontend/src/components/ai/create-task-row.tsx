import type { RosterMember } from "@ctp/shared";
import { RowShell } from "./row-shell";
import { AssigneeField } from "@/components/tasks/assignee-field";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import type { ResolvedCreateTask, RowErrors } from "@/lib/ai-sections";

/** A proposed task, every field editable in place — there is no edit mode. */
export function CreateTaskRow({
  rowKey,
  label,
  checked,
  onCheckedChange,
  value,
  onChange,
  errors,
  members,
  disabled = false,
  portalTarget = null,
}: {
  rowKey: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  value: ResolvedCreateTask;
  onChange: (value: ResolvedCreateTask) => void;
  errors: RowErrors;
  members: RosterMember[];
  disabled?: boolean;
  portalTarget?: HTMLElement | null;
}) {
  const inert = disabled || !checked;
  return (
    <RowShell
      rowKey={rowKey}
      label={label}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      titleValue={value.title}
      onTitleChange={(title) => onChange({ ...value, title })}
      titleError={errors.title}
    >
      <div className="flex flex-wrap items-center gap-2">
        <AssigneeField
          members={members}
          selectedIds={value.assignees.map((assignee) => assignee.id)}
          onChange={(ids) =>
            onChange({
              ...value,
              assignees: ids.map((id) => ({
                id,
                name:
                  members.find((member) => member.id === id)?.name ??
                  value.assignees.find((assignee) => assignee.id === id)?.name ??
                  "",
              })),
            })
          }
          portalTarget={portalTarget}
          subject={value.title || "this task"}
          idPrefix={`ai-${rowKey}`}
          busy={inert}
          error={errors.assigneeIds}
        />
        <DateTimePicker
          id={`ai-${rowKey}-due`}
          label="due date"
          timeLabel="Deadline time"
          defaultTime="23:59"
          value={value.dueAt}
          onChange={(dueAt) => onChange({ ...value, dueAt })}
          disabled={inert}
          portalTarget={portalTarget}
        />
      </div>
    </RowShell>
  );
}
