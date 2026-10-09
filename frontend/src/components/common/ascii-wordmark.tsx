import { cn } from "@/lib/utils";

/**
 * "MAC" in figlet's standard letters. Pure ASCII — slashes, bars, underscores —
 * so it lines up in any monospace font; the box-drawing and block alphabets
 * would pull glyphs from a taller fallback font on Windows and break the art.
 */
const MAC = String.raw` __  __    _    ____
|  \/  |  / \  / ___|
| |\/| | / _ \| |
| |  | |/ ___ \ |___
|_|  |_/_/   \_\____|`;

/**
 * The club's wordmark as a terminal banner. One image to assistive tech, named
 * MAC; the characters are its drawing, not text to read out.
 */
export function AsciiWordmark({ className }: { className?: string }) {
  return (
    <pre
      role="img"
      aria-label="MAC"
      // The leading comes after `className`: tailwind-merge lets a later size
      // class drop an earlier `leading-*`, and the rows need to stay tight.
      className={cn("font-mono whitespace-pre select-none", className, "leading-[1.05]")}
    >
      {MAC}
    </pre>
  );
}
