import { Link } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GO_TO, useBindings, useShortcutsEnabled } from "@/lib/shortcuts";

function KeyGroup({ title, keys }: { title: string; keys: [string, string][] }) {
  return (
    <section>
      <h3 className="text-xs tracking-[0.14em] text-muted-foreground uppercase">{title}</h3>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {keys.map(([key, action]) => (
          <div key={key} className="contents">
            <dt>
              <kbd className="border bg-secondary px-1.5 py-0.5 font-mono text-xs">{key}</kbd>
            </dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * Every shortcut, opened by `?` or the status line's `keys`, written from the
 * current bindings so it always matches what the keys do.
 */
export function ShortcutHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { actions, pages } = useBindings();
  const enabled = useShortcutsEnabled();
  const onAPage: [string, string][] = [
    [actions.new, "The page’s new action"],
    [actions.search, "The page’s search"],
    [actions.help, "This list"],
    ["Ctrl K", "Search, on the Overview"],
  ];
  const inAList: [string, string][] = [
    [`${actions.previous} / ${actions.next}`, "Previous / next row"],
    [`${actions.left} / ${actions.right}`, "Previous / next column"],
    ["enter", "Open the row"],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            {enabled
              ? "Single keys work anywhere except while you are typing in a field."
              : "Single-key shortcuts are off. Only Ctrl K works until you turn them back on."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-2">
          <KeyGroup
            title="Go to"
            keys={GO_TO.map(
              (page) => [`${actions.go} ${pages[page.id]}`, page.label] as [string, string],
            )}
          />
          <div className="grid content-start gap-5">
            <KeyGroup title="On a page" keys={onAPage} />
            <KeyGroup title="In a list" keys={inAList} />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Turn single-key shortcuts on or off, or change their keys, in{" "}
          <Link
            to="/settings"
            onClick={() => onOpenChange(false)}
            className="text-foreground underline underline-offset-4"
          >
            Settings
          </Link>
          .
        </p>
      </DialogContent>
    </Dialog>
  );
}
