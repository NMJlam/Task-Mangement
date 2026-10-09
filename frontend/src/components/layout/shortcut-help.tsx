import { Link } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GO_TO } from "@/lib/shortcuts";

const ON_A_PAGE: [string, string][] = [
  ["n", "The page’s new action"],
  ["/", "The page’s search"],
  ["?", "This list"],
  ["Ctrl K", "Search, on the Overview"],
];

const IN_A_LIST: [string, string][] = [
  ["j / k", "Next / previous row"],
  ["h / l", "Previous / next column"],
  ["enter", "Open the row"],
];

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

/** Every shortcut, opened by `?` or the status line's `keys`. */
export function ShortcutHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Single keys work anywhere except while you are typing in a field.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-2">
          <KeyGroup
            title="Go to"
            keys={GO_TO.map((entry) => [`g ${entry.key}`, entry.label] as [string, string])}
          />
          <div className="grid content-start gap-5">
            <KeyGroup title="On a page" keys={ON_A_PAGE} />
            <KeyGroup title="In a list" keys={IN_A_LIST} />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Turn single-key shortcuts off in{" "}
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
