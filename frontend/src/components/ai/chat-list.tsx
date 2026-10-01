import type { AiChat } from "@ctp/shared";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const lastActive = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/**
 * The left column of AI Breakdown: New chat, then the member's chats with the
 * open one marked. Laid out like the Messages list, including the horizontal
 * strip it becomes on a narrow screen. Rows are links — a chat has an address —
 * with rename and delete beside each as their own buttons, so neither is nested
 * inside the link.
 */
export function ChatList({
  chats,
  activeId,
  onRename,
  onRemove,
  pinned,
}: {
  chats: AiChat[];
  activeId: string | undefined;
  onRename: (chat: AiChat, title: string) => void;
  onRemove: (chat: AiChat) => void;
  /** Sits between New chat and the chats: the briefing entry. */
  pinned?: ReactNode;
}) {
  const [renaming, setRenaming] = useState<string>();
  const [title, setTitle] = useState("");
  const [removing, setRemoving] = useState<AiChat>();
  const titleInput = useRef<HTMLInputElement>(null);
  const renameButtons = useRef(new Map<string, HTMLButtonElement>());

  // Focus the field when a rename starts — what a member expects after
  // pressing Rename, and what lets Escape and Enter work without a click.
  useEffect(() => {
    if (!renaming) return;
    // select() alone does not necessarily move focus.
    titleInput.current?.focus();
    titleInput.current?.select();
  }, [renaming]);

  function commit(chat: AiChat) {
    const next = title.trim();
    if (next && next !== chat.title) onRename(chat, next);
    setRenaming(undefined);
  }

  return (
    <nav aria-label="Chats" className="flex gap-1 overflow-x-auto p-3 lg:block lg:overflow-y-auto">
      <Button asChild variant="outline" className="shrink-0 lg:mb-3 lg:w-full">
        <Link to="/ai">
          <Plus aria-hidden="true" />
          New chat
        </Link>
      </Button>
      {pinned}
      {chats.map((chat) => {
        const active = chat.id === activeId;
        return (
          <div
            key={chat.id}
            className={cn(
              "flex min-w-56 items-center gap-1 rounded-md pr-1 text-sm text-muted-foreground transition-[background-color,color] hover:bg-secondary hover:text-foreground lg:mb-1 lg:min-w-0",
              active && "bg-accent font-medium text-accent-foreground",
            )}
          >
            {renaming === chat.id ? (
              <Input
                ref={titleInput}
                aria-label="Chat title"
                value={title}
                maxLength={80}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => setRenaming(undefined)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== "Escape") return;
                  // Or this same Enter press would go on to click the Rename
                  // button focused below, and reopen the field.
                  event.preventDefault();
                  if (event.key === "Enter") commit(chat);
                  else setRenaming(undefined);
                  // The field is going away; without this, focus would fall
                  // to the top of the page. Rename is where the member came from.
                  renameButtons.current.get(chat.id)?.focus();
                }}
                className="m-1 h-8 flex-1"
              />
            ) : (
              <Link
                to={`/ai/${chat.id}`}
                aria-current={active ? "page" : undefined}
                className="min-w-0 flex-1 rounded-md px-3 py-2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="block truncate">{chat.title}</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {lastActive.format(chat.lastMessageAt)}
                </span>
              </Link>
            )}
            <Button
              ref={(node) => {
                if (node) renameButtons.current.set(chat.id, node);
                else renameButtons.current.delete(chat.id);
              }}
              variant="ghost"
              size="icon-xs"
              aria-label={`Rename ${chat.title}`}
              onClick={() => {
                setTitle(chat.title);
                setRenaming(chat.id);
              }}
            >
              <Pencil aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Delete ${chat.title}`}
              onClick={() => setRemoving(chat)}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        );
      })}

      <Dialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this chat?</DialogTitle>
            <DialogDescription>
              “{removing?.title}” and its messages will be removed. Tasks and events it created
              stay.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (removing) onRemove(removing);
                setRemoving(undefined);
              }}
            >
              Delete chat
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </nav>
  );
}
