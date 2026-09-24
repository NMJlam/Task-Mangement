import { insertAfter, type Task, type TaskStatus } from "@ctp/shared";

/**
 * Board order for one column. `Array.prototype.sort` is stable, so the ties a
 * column default leaves behind (every slot `0` until someone reorders it) keep
 * the order the read returned — newest first, exactly as before this change.
 */
export function byBoardOrder(a: Task, b: Task): number {
  return a.boardOrder - b.boardOrder;
}

/** A card the user has just dropped: the column it lands in, and what it follows. */
export interface Move {
  id: string;
  status: TaskStatus;
  /** The card the moved one now sits under, or `null` for the top of the column. */
  after: string | null;
}

/**
 * The board after `move`, with the destination column renumbered `0..n-1` and
 * the moved card in its new column. Every other column comes back untouched: a
 * move changes one column's order, and the source only loses a card.
 *
 * The destination is built through the same `insertAfter` the endpoint uses, so
 * the optimistic board and the stored board cannot disagree about where a card
 * landed. Other cards keep their identity — only `boardOrder` (and, for the
 * moved card, `status`) changes, so a React key never changes because of a drop.
 */
export function reorder(tasks: readonly Task[], move: Move): Task[] {
  const destination = tasks
    .filter((task) => (task.id === move.id ? move.status : task.status) === move.status)
    .sort(byBoardOrder);

  const order = insertAfter(
    destination.map((task) => task.id),
    move.id,
    move.after,
  );

  const slots = new Map(order.map((id, index) => [id, index]));

  return tasks.map((task) => {
    const boardOrder = slots.get(task.id);
    if (boardOrder === undefined) return task;
    return task.id === move.id
      ? { ...task, status: move.status, boardOrder }
      : { ...task, boardOrder };
  });
}
